// ============================================================
//  A&F · Escáner de códigos de barras
// ============================================================
// · Android (Chrome): usa el lector nativo BarcodeDetector.
// · iPhone / Firefox: Safari no trae BarcodeDetector, así que se
//   carga una versión en WebAssembly (ZXing) la primera vez.
// · PC con lector USB/Bluetooth tipo "teclado": se detecta solo
//   por la velocidad de tipeo (idea de Dietética Josué).
import { beep, vibrar, esc, icon } from "./util.js";

const FORMATOS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];
const POLYFILL = "https://fastly.jsdelivr.net/npm/barcode-detector@3/dist/es/ponyfill.min.js";

let detectorP = null;
function obtenerDetector() {
  if (!detectorP) {
    detectorP = (async () => {
      if ("BarcodeDetector" in window) {
        try {
          const sop = await window.BarcodeDetector.getSupportedFormats();
          const f = FORMATOS.filter((x) => sop.includes(x));
          if (f.length) return { det: new window.BarcodeDetector({ formats: f }), tipo: "nativo" };
        } catch {}
      }
      const mod = await import(POLYFILL);
      return { det: new mod.BarcodeDetector({ formats: FORMATOS }), tipo: "zxing" };
    })();
    detectorP.catch(() => { detectorP = null; });
  }
  return detectorP;
}
// Llamar al entrar a pantallas que escanean, para que el primer uso sea rápido
export function precargarEscaner() {
  obtenerDetector().catch(() => {});
}

/**
 * Abre la cámara a pantalla completa.
 * onCodigo(codigo) puede devolver { ok:boolean, texto:string } para mostrar el resultado.
 * continuo: true → sigue escaneando (ingreso de mercadería, cargar varias latas)
 * Devuelve una promesa con el último código leído (o null si se cerró).
 */
export function abrirEscaner({ titulo = "Escanear código", continuo = false, onCodigo, extraHtml = "" } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "escaner";
    el.innerHTML = `
      <div class="esc-top"><b>${esc(titulo)}</b><button type="button" class="btn-icono claro" data-cerrar aria-label="Cerrar">${icon("x")}</button></div>
      <div class="esc-video">
        <video playsinline muted autoplay></video>
        <div class="esc-marco"><span></span></div>
        <div class="esc-estado">Abriendo cámara…</div>
      </div>
      <div class="esc-pie">
        ${extraHtml}
        <div class="esc-ultimo" aria-live="polite"></div>
        <div class="esc-acciones">
          <button type="button" class="btn claro" data-linterna hidden>${icon("flash")} Linterna</button>
          <form class="esc-manual"><input class="input" inputmode="numeric" autocomplete="off" placeholder="o escribí el código"><button class="btn claro">OK</button></form>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add("con-modal");

    const video = el.querySelector("video");
    const estado = el.querySelector(".esc-estado");
    const ultimoEl = el.querySelector(".esc-ultimo");
    const btnLuz = el.querySelector("[data-linterna]");
    let stream = null, track = null, activo = true, ultimo = "", ultimoTs = 0, ocupado = false, luz = false;

    function cerrar(valor = null) {
      if (!activo) return;
      activo = false;
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      el.remove();
      if (!document.querySelector(".modal-fondo")) document.body.classList.remove("con-modal");
      document.removeEventListener("keydown", onEsc);
      resolve(valor);
    }
    const onEsc = (e) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", onEsc);
    el.querySelector("[data-cerrar]").onclick = () => cerrar();

    function manejar(codigo) {
      codigo = String(codigo || "").trim();
      if (!codigo || !activo) return;
      const t = Date.now();
      if (codigo === ultimo && t - ultimoTs < 2200) return; // misma lata dos veces seguidas
      ultimo = codigo;
      ultimoTs = t;
      let r = null;
      try { r = onCodigo ? onCodigo(codigo) : null; } catch (e) { console.error(e); }
      const ok = r?.ok !== false;
      beep(ok ? "ok" : "error");
      vibrar(ok ? 40 : [60, 40, 60]);
      ultimoEl.className = "esc-ultimo " + (ok ? "ok" : "mal");
      ultimoEl.textContent = r?.texto || codigo;
      el.classList.remove("flash-ok", "flash-mal");
      void el.offsetWidth;
      el.classList.add(ok ? "flash-ok" : "flash-mal");
      if (!continuo && ok) setTimeout(() => cerrar(codigo), 250);
    }

    el.querySelector(".esc-manual").onsubmit = (e) => {
      e.preventDefault();
      const inp = e.target.querySelector("input");
      const v = inp.value.trim();
      inp.value = "";
      if (v) { ultimo = ""; manejar(v); }
    };

    btnLuz.onclick = async () => {
      luz = !luz;
      try { await track.applyConstraints({ advanced: [{ torch: luz }] }); btnLuz.classList.toggle("activo", luz); } catch {}
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        estado.textContent = "Este navegador no permite usar la cámara. Escribí el código abajo.";
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        estado.textContent = e.name === "NotAllowedError"
          ? "No hay permiso para la cámara. Habilitalo en el candado de la barra de direcciones."
          : "No se pudo abrir la cámara. Podés escribir el código abajo.";
        return;
      }
      if (!activo) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      track = stream.getVideoTracks()[0];
      await video.play().catch(() => {});
      try { if (track.getCapabilities?.().torch) btnLuz.hidden = false; } catch {}

      estado.textContent = "Preparando lector…";
      let det;
      try { ({ det } = await obtenerDetector()); }
      catch { estado.textContent = "No se pudo cargar el lector (¿sin conexión?). Escribí el código abajo."; return; }
      estado.textContent = "Apuntá al código de barras";

      const ciclo = async () => {
        if (!activo) return;
        if (video.readyState >= 2 && !ocupado) {
          ocupado = true;
          try {
            const r = await det.detect(video);
            if (r && r.length) manejar(r[0].rawValue);
          } catch {}
          ocupado = false;
        }
        setTimeout(ciclo, 110);
      };
      ciclo();
    })();
  });
}

// ── Recuadros de código (data-codigo) ──
// Al tocarlos se selecciona lo que tienen: el próximo código leído lo reemplaza.
let recienEnfocado = null;
document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (!t.matches?.("[data-codigo]")) return;
  t.select();
  recienEnfocado = t;
  setTimeout(() => { if (recienEnfocado === t) recienEnfocado = null; }, 500);
});
document.addEventListener("mouseup", (e) => {
  // el clic que dio el foco no debe deshacer la selección
  if (recienEnfocado && e.target === recienEnfocado) { e.preventDefault(); recienEnfocado.select(); recienEnfocado = null; }
});

/** Escribe un código en un recuadro de código, reemplazando lo que hubiera, y avisa. */
export function ponerCodigo(input, codigo) {
  input.value = codigo;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  avisarCodigo(input);
}
/** Marca el recuadro, suena y dispara "codigo-leido" con lo que tiene escrito. */
function avisarCodigo(input) {
  const codigo = input.value.trim();
  if (!codigo) return;
  if (codigo !== input.value) input.value = codigo;
  input.classList.remove("cod-leido");
  void input.offsetWidth;
  input.classList.add("cod-leido");
  beep("ok");
  vibrar(40);
  input.dispatchEvent(new CustomEvent("codigo-leido", { bubbles: true, detail: codigo }));
}

/**
 * Lector de mano (USB o Bluetooth) que "tipea" el código y aprieta Enter o Tab.
 *
 * - Si el cursor está en un recuadro de código (data-codigo), lo que llega queda
 *   escrito ahí, a cualquier velocidad, y el Enter no envía el formulario.
 * - Si no, se lo distingue de una persona porque las teclas llegan muy seguidas,
 *   y se llama a onCodigo(codigo, destino). Si devuelve false, la pantalla
 *   no lo usa y todo queda como si se hubiera tipeado (no se borra nada).
 *   Si lo usa, se saca el código del recuadro donde se tipeó.
 * Devuelve una función para dejar de escuchar.
 */
export function escucharLectorUSB(onCodigo) {
  let buf = "", ultimoT = 0, inicio = 0;
  const h = (e) => {
    if (document.querySelector(".escaner") || e.repeat) return;
    const t = performance.now();
    const tgt = e.target;
    const editable = tgt && typeof tgt.value === "string";
    if (e.key === "Enter" && editable && tgt.matches?.("[data-codigo]")) {
      e.preventDefault();
      e.stopPropagation();
      buf = "";
      avisarCodigo(tgt);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const codigo = buf;
      const rapido = codigo.length >= 4 && (t - inicio) / codigo.length < 70 && t - ultimoT < 300;
      buf = "";
      if (!rapido || (editable && tgt.matches?.("[data-codigo]"))) return;
      if (onCodigo(codigo, tgt) === false) return;
      e.preventDefault();
      e.stopPropagation();
      if (editable && tgt.value.endsWith(codigo)) {
        tgt.value = tgt.value.slice(0, -codigo.length);
        tgt.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (e.key.length !== 1) return;
    // Entre tecla y tecla un lector tarda pocos milisegundos; los Bluetooth a veces hacen una pausa
    if (t - ultimoT > 300) { buf = ""; inicio = t; }
    buf += e.key;
    ultimoT = t;
  };
  document.addEventListener("keydown", h, true);
  return () => document.removeEventListener("keydown", h, true);
}
