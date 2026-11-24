// ============================================================
//  A&F · Utilidades de interfaz
// ============================================================

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
export const fmt = (n) => "$ " + nf0.format(Math.round(Number(n) || 0));
export const fmtNum = (n) => nf0.format(Math.round(Number(n) || 0));

// Interpreta montos escritos "a la argentina": 1.234,50 · 1234,5 · 1234.5 · $ 12.000
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/[$\s]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export const hora = (ts) => (ts ? new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—");
export const fecha = (ts) =>
  ts ? new Date(ts).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }) : "—";
export const fechaHora = (ts) => (ts ? `${fecha(ts)} ${hora(ts)}` : "—");
export const minutos = (ts) => Math.max(0, Math.floor((Date.now() - (ts || Date.now())) / 60000));
export function durTxt(ts) {
  const m = minutos(ts);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

export const normalizar = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function iniciales(nombre) {
  const p = String(nombre || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
}

// ── Toast ──
let toastWrap;
export function toast(msg, tipo = "") {
  if (!toastWrap) {
    toastWrap = document.createElement("div");
    toastWrap.className = "toasts";
    toastWrap.setAttribute("aria-live", "polite");
    document.body.appendChild(toastWrap);
  }
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(() => t.classList.add("sale"), tipo === "error" ? 4200 : 2200);
  setTimeout(() => t.remove(), tipo === "error" ? 4600 : 2600);
}

// ── Sonido ──
let audioCtx = null;
export function activarAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
document.addEventListener("pointerdown", activarAudio, { once: true, capture: true });

function tono(freq, ini, dur, vol = 0.15) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g);
  g.connect(audioCtx.destination);
  o.type = "sine";
  o.frequency.value = freq;
  const t = audioCtx.currentTime + ini;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t);
  o.stop(t + dur);
}
export function beep(tipo = "ok") {
  try {
    activarAudio();
    if (tipo === "ok") tono(880, 0, 0.12);
    else if (tipo === "error") { tono(300, 0, 0.18); tono(220, 0.2, 0.25); }
    else if (tipo === "pedido") { tono(660, 0, 0.15, 0.25); tono(880, 0.18, 0.15, 0.25); tono(1100, 0.36, 0.25, 0.25); }
  } catch {}
}
export function vibrar(ms = 40) {
  try { navigator.vibrate?.(ms); } catch {}
}

// ── Modales (hoja inferior en celular, ventana centrada en pantallas grandes) ──
const pila = [];
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pila.length) { e.preventDefault(); pila[pila.length - 1](); }
});

export function modal({ titulo = "", cuerpo = "", pie = "", clase = "", onMount, onClose } = {}) {
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo";
  fondo.innerHTML = `<div class="modal ${clase}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-cab"><h2>${esc(titulo)}</h2><button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">${icon("x")}</button></div>
      <div class="modal-cuerpo">${cuerpo}</div>
      ${pie ? `<div class="modal-pie">${pie}</div>` : ""}
    </div>`;
  document.body.appendChild(fondo);
  document.body.classList.add("con-modal");
  let cerrado = false;
  const cerrar = (valor) => {
    if (cerrado) return;
    cerrado = true;
    const i = pila.indexOf(cerrar);
    if (i >= 0) pila.splice(i, 1);
    fondo.remove();
    if (!pila.length) document.body.classList.remove("con-modal");
    onClose?.(valor);
  };
  pila.push(cerrar);
  fondo.addEventListener("click", (e) => {
    if (e.target === fondo || e.target.closest("[data-cerrar]")) cerrar();
  });
  const el = fondo.firstElementChild;
  onMount?.(el, cerrar);
  const foco = el.querySelector("[autofocus]");
  if (foco) setTimeout(() => foco.focus(), 60);
  return { el, cerrar };
}

export function confirmar(texto, { titulo = "Confirmar", ok = "Aceptar", cancelar = "Cancelar", peligro = false } = {}) {
  return new Promise((res) => {
    const m = modal({
      titulo,
      clase: "modal-chico",
      cuerpo: `<p class="texto-modal">${esc(texto)}</p>`,
      pie: `<button type="button" class="btn" data-no>${esc(cancelar)}</button><button type="button" class="btn ${peligro ? "btn-peligro" : "btn-pri"}" data-si>${esc(ok)}</button>`,
      onClose: (v) => res(v === true),
    });
    m.el.querySelector("[data-no]").onclick = () => m.cerrar(false);
    m.el.querySelector("[data-si]").onclick = () => m.cerrar(true);
  });
}

export function pedirTexto(titulo, { valor = "", placeholder = "", tipo = "text", ayuda = "", sugerencias = [], ok = "Aceptar" } = {}) {
  return new Promise((res) => {
    const m = modal({
      titulo,
      clase: "modal-chico",
      cuerpo: `<form class="form" id="ptForm">
        ${ayuda ? `<p class="ayuda">${esc(ayuda)}</p>` : ""}
        <input class="input" id="ptInput" ${tipo === "numero" ? 'inputmode="decimal"' : ""} type="text" value="${esc(valor)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus>
        ${sugerencias.length ? `<div class="chips">${sugerencias.map((s) => `<button type="button" class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}
      </form>`,
      pie: `<button type="button" class="btn" data-no>Cancelar</button><button type="submit" form="ptForm" class="btn btn-pri">${esc(ok)}</button>`,
      onClose: (v) => res(v === undefined ? null : v),
    });
    const inp = m.el.querySelector("#ptInput");
    m.el.querySelector("[data-no]").onclick = () => m.cerrar(null);
    m.el.querySelector("#ptForm").onsubmit = (e) => { e.preventDefault(); m.cerrar(inp.value.trim()); };
    m.el.querySelectorAll("[data-sug]").forEach((b) => (b.onclick = () => {
      const s = b.dataset.sug;
      inp.value = inp.value ? `${inp.value}, ${s}` : s;
      inp.focus();
    }));
  });
}

// ── Íconos (trazo 2px, 24×24) ──
const P = {
  mesas: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cocina: '<path d="M6 13.9A4 4 0 0 1 7.6 6.2a5 5 0 0 1 8.8 0A4 4 0 0 1 18 13.9V20H6z"/><path d="M6 17h12"/>',
  caja: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  productos: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  atras: '<path d="m15 18-6-6 6-6"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  nota: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  basura: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  flash: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  puntos: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  recibo: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  mover: '<path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  pantalla: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  campana: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  personas: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  dinero: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  grafico: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  bolsa: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  moto: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M8.5 17h6l3-6h-4l-2 3H6M14 6h3l1.5 5M3 11h5"/>',
  estrella: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  arriba: '<path d="m6 15 6-6 6 6"/>',
  pin: '<path d="M9 3h6l-1 6 3.5 3.5V15h-11v-2.5L10 9z"/><path d="M12 15v6"/>',
  abajo: '<path d="m6 9 6 6 6-6"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  subir: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  bajar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  tabla: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  compartir: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  mensaje: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.6A8.4 8.4 0 1 1 21 11.5z"/>',
  externo: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  calendario: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01"/>',
  camion: '<path d="M2 5h12v11H2zM14 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  libreta: '<path d="M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z"/><path d="M5 3v18M9 8h6M9 12h6M3 7h4M3 12h4M3 17h4"/>',
  alarma: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M5 3 2 6M19 3l3 3"/>',
  menu: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  respaldo: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
};
export const icon = (n, clase = "") =>
  `<svg class="ico ${clase}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;
