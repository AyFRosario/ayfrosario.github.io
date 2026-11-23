// ============================================================
//  A&F · Ajustes: este dispositivo, negocio y mesas
// ============================================================
import { S, puede, MEDIOS, dispositivo, guardarDispositivo, sectoresMesas, comandaDeMesa, log, PANTALLAS_INICIO, turnosCaja } from "../store.js";
import { db, auth, MODO } from "../db.js";
import { esc, icon, modal, toast, confirmar, pedirTexto, fechaHora, num } from "../util.js";
import { imprimir, imprimirHoja, ticketPrueba, conectarBluetooth, conectarUSB, btConectada, usbConectada } from "../print.js";
import { urlCarta } from "../publicar.js";
import { qrcode } from "../vendor/qrcode.mjs";
import { descargarRespaldo, diasSinRespaldo } from "../respaldo.js";
import { firmaHTML, iconoContacto, usuarioRed } from "../firma.js";

const VERSION_APP = "1.2.4";

const MODOS = {
  ninguna: { t: "Sin impresora", d: "Este dispositivo no imprime." },
  sistema: { t: "Impresora de la PC", d: "Usa el diálogo de impresión. Sirve para cualquier térmica instalada en Windows (USB o de red). Para que la cocina imprima sin preguntar, abrí Chrome con la opción --kiosk-printing (ver LEEME)." },
  bluetooth: { t: "Bluetooth directo", d: "Chrome en Android o en la PC. Imprime sin preguntar. Funciona con la mayoría de las térmicas Bluetooth de 58 y 80 mm (BLE)." },
  usb: { t: "USB directo", d: "Chrome en Android con cable OTG. Imprime sin preguntar. En Windows usá \"Impresora de la PC\"." },
  rawbt: { t: "App RawBT (Android)", d: "Instalá RawBT desde Google Play y configurá ahí la impresora (Bluetooth clásico, USB o de red/wifi). Cada impresión abre RawBT un instante." },
};

const PERM_INICIO = { salon: "salon", caja: "caja", reservas: "reservas", cocina: "cocina", productos: "productos" };
const inicios = () => PANTALLAS_INICIO.filter(([k]) => puede(PERM_INICIO[k]));
const puedeInicio = (k) => !!k && inicios().some(([x]) => x === k);

export function mount(root) {
  const negocio = puede("ajustesNegocio");
  root.innerHTML = `
    <div class="ajustes">
      <section class="tarjeta" id="aDisp"></section>
      ${negocio ? `<section class="tarjeta" id="aCarta"></section><section class="tarjeta" id="aResp"></section><section class="tarjeta" id="aMesas"></section><section class="tarjeta" id="aTurnos"></section><section class="tarjeta" id="aNeg"></section>` : ""}
      ${MODO === "demo" ? `<section class="tarjeta"><h3>Modo demo</h3><p class="ayuda">Los datos están solo en este navegador.</p><button class="btn btn-peligro" data-act="reset">Reiniciar datos del demo</button></section>` : ""}
      <footer class="ajustes-pie"><img src="img/logo.svg" alt="A&F"><small>Versión ${VERSION_APP}</small>${firmaHTML()}</footer>
    </div>`;

  // ── Este dispositivo ──
  function renderDisp() {
    const d = dispositivo();
    const imp = d.impresora;
    const conectada = imp.modo === "bluetooth" ? btConectada() : imp.modo === "usb" ? usbConectada() : null;
    root.querySelector("#aDisp").innerHTML = `
      <h3>Este dispositivo</h3>
      <p class="ayuda">Estos ajustes quedan guardados solo en este celular, tablet o PC.</p>
      <div class="form">
        ${inicios().length > 1 ? `<label class="campo"><span>Al abrir la app, mostrar</span><select class="input" id="dInicio">${inicios().map(([k, t]) => `<option value="${k}" ${k === (puedeInicio(d.inicio) ? d.inicio : S.rol === "cocina" ? "cocina" : "salon") ? "selected" : ""}>${t}</option>`).join("")}</select>
          <small class="ayuda">Por ejemplo: la PC del mostrador en Caja, la tablet de la cocina en Cocina y barra.</small></label>` : ""}
        <label class="campo"><span>Código del dispositivo</span><input class="input chico" id="dCod" value="${esc(d.codigo)}" maxlength="4"><small class="ayuda">Va adelante del número de venta (${esc(d.codigo)}-0001). Que no se repita entre dispositivos.</small></label>
        <label class="campo"><span>Impresora</span><select class="input" id="dModo">${Object.entries(MODOS).map(([k, v]) => `<option value="${k}" ${imp.modo === k ? "selected" : ""}>${v.t}</option>`).join("")}</select>
          <small class="ayuda">${esc(MODOS[imp.modo]?.d || "")}</small></label>
        ${imp.modo !== "ninguna" ? `
          <div class="campo"><span>Ancho del papel</span><div class="segmentado"><button type="button" data-ancho="58" class="${imp.ancho === 58 ? "activo" : ""}">58 mm</button><button type="button" data-ancho="80" class="${imp.ancho === 80 ? "activo" : ""}">80 mm</button></div></div>
          ${imp.modo !== "sistema" ? `
            <label class="switch"><input type="checkbox" id="dCorte" ${imp.cortar ? "checked" : ""}><span>Cortar el papel al terminar</span></label>
            <label class="switch"><input type="checkbox" id="dAcentos" ${imp.sinAcentos ? "checked" : ""}><span>Imprimir sin acentos (si salen símbolos raros)</span></label>
            <label class="switch"><input type="checkbox" id="dLogo" ${imp.logo !== false ? "checked" : ""}><span>Logo en el ticket del cliente (si sale cortado o con rayas, apagalo)</span></label>` : ""}
          ${S.rol !== "cocina" ? `<label class="switch"><input type="checkbox" id="dEnviar" ${imp.alEnviar ? "checked" : ""}><span>Imprimir la comanda cuando el mozo envía un pedido desde este dispositivo</span></label>` : ""}
          <div class="fila-botones">
            ${imp.modo === "bluetooth" || imp.modo === "usb" ? `<button class="btn" data-act="conectar">${icon(imp.modo === "bluetooth" ? "bluetooth" : "print")} ${conectada ? "Cambiar impresora" : "Conectar impresora"}</button>` : ""}
            <button class="btn btn-pri" data-act="prueba">${icon("print")} Imprimir prueba</button>
          </div>
          ${conectada !== null ? `<p class="ayuda">${conectada ? `Conectada${imp.btNombre ? `: ${esc(imp.btNombre)}` : ""}` : "Sin conectar"}</p>` : ""}` : ""}
      </div>`;
  }

  // ── Negocio ──
  function renderNeg() {
    const el = root.querySelector("#aNeg");
    if (!el || el.querySelector("form")) return; // no pisar lo que se está escribiendo
    const c = S.config;
    el.innerHTML = `
      <h3>Negocio</h3>
      <form class="form" id="fNeg">
        <label class="campo"><span>Nombre</span><input class="input" id="nNom" value="${esc(c.nombre)}"></label>
        <label class="campo"><span>Lema (sale en los tickets)</span><input class="input" id="nLema" value="${esc(c.lema || "")}"></label>
        <label class="campo"><span>Pie del ticket</span><input class="input" id="nPie" value="${esc(c.pieTicket || "")}"></label>
        <label class="campo"><span>Costo de envío habitual (delivery)</span><input class="input" id="nEnvio" inputmode="decimal" value="${c.envio ? Math.round(c.envio) : ""}" placeholder="$ 0"><small class="ayuda">Se propone al crear un delivery; se puede cambiar en cada pedido.</small></label>
        <div class="dos-col">
          <label class="campo"><span>Dirección</span><input class="input" id="nDir" value="${esc(c.direccion || "")}" placeholder="San Martín 2920"></label>
          <label class="campo"><span>Horario</span><input class="input" id="nHor" value="${esc(c.horario || "")}" placeholder="Mar a dom de 19 a 1"></label>
        </div>
        <div class="dos-col">
          <label class="campo"><span>${iconoContacto("whatsapp", 16)} WhatsApp (reservas)</span><input class="input" id="nWa" inputmode="tel" value="${esc(c.whatsapp || "")}" placeholder="341 281-5624"></label>
          <label class="campo"><span>${iconoContacto("instagram", 16)} Instagram</span><input class="input" id="nIg" value="${esc(c.instagram || "")}" placeholder="@usuario o enlace"></label>
        </div>
        <div class="dos-col">
          <label class="campo"><span>${iconoContacto("facebook", 16)} Facebook</span><input class="input" id="nFb" value="${esc(c.facebook || "")}" placeholder="facebook.com/tu.pagina o el usuario"></label>
          <label class="campo"><span>${iconoContacto("mapa", 16)} Enlace de Google Maps (opcional)</span><input class="input" id="nMapa" inputmode="url" value="${esc(c.mapa || "")}" placeholder="https://maps.app.goo.gl/…"></label>
        </div>
        <p class="ayuda">WhatsApp, Instagram, Facebook y la dirección aparecen al pie de la carta QR como enlaces directos. Los que quedan vacíos no se muestran. Si no ponés el enlace de Maps, la dirección abre una búsqueda en Google Maps.</p>
        <label class="switch"><input type="checkbox" id="nMozo" ${c.mozoCobra ? "checked" : ""}><span>Los mozos pueden cobrar</span></label>
        <label class="switch"><input type="checkbox" id="nCuenta" ${c.cuentaCorriente !== false ? "checked" : ""}><span>Permitir cobrar a cuenta corriente (clientes que pagan después)</span></label>
        <label class="switch"><input type="checkbox" id="nResCarta" ${c.reservasCarta !== false ? "checked" : ""}><span>Botón "Reservar por WhatsApp" en la carta QR</span></label>
        <div class="aj-propina">
          <label class="switch"><input type="checkbox" id="nProp" ${c.propina !== false ? "checked" : ""}><span>Registrar propinas al cobrar</span></label>
          <div class="aj-prop-det" ${c.propina === false ? "hidden" : ""}>
            <label class="campo"><span>Propina sugerida (%)</span><input class="input" id="nPropPct" inputmode="numeric" value="${Number(c.propinaPct) || 10}" style="max-width:110px"></label>
            <label class="switch"><input type="checkbox" id="nPropPre" ${c.propinaPrecuenta ? "checked" : ""}><span>Mostrar la propina sugerida en la precuenta impresa</span></label>
          </div>
          <p class="ayuda">La propina se cobra junto con la cuenta pero no se suma a lo vendido: en Caja y Reportes aparece aparte y por mozo.</p>
        </div>
        <div class="campo"><span>Medios de pago</span><div class="checks">${Object.entries(MEDIOS).filter(([k]) => k !== "cuenta").map(([k, v]) => `<label class="check"><input type="checkbox" data-medio="${k}" ${(c.medios || []).includes(k) ? "checked" : ""}> ${v}</label>`).join("")}</div></div>
        <button class="btn btn-pri">Guardar</button>
      </form>`;
    el.querySelector("#nProp").onchange = (e) => { el.querySelector(".aj-prop-det").hidden = !e.target.checked; };
    el.querySelector("#fNeg").onsubmit = (e) => {
      e.preventDefault();
      const medios = [...el.querySelectorAll("[data-medio]:checked")].map((x) => x.dataset.medio);
      if (!medios.length) return toast("Elegí al menos un medio de pago", "error");
      db.merge("config", "general", {
        nombre: el.querySelector("#nNom").value.trim() || "A&F",
        lema: el.querySelector("#nLema").value.trim(),
        pieTicket: el.querySelector("#nPie").value.trim(),
        envio: Math.max(0, Math.round(num(el.querySelector("#nEnvio").value)) || 0),
        mozoCobra: el.querySelector("#nMozo").checked,
        cuentaCorriente: el.querySelector("#nCuenta").checked,
        reservasCarta: el.querySelector("#nResCarta").checked,
        propina: el.querySelector("#nProp").checked,
        propinaPct: Math.min(50, Math.max(1, Math.round(num(el.querySelector("#nPropPct").value)) || 10)),
        propinaPrecuenta: el.querySelector("#nPropPre").checked,
        medios,
        direccion: el.querySelector("#nDir").value.trim(),
        horario: el.querySelector("#nHor").value.trim(),
        instagram: usuarioRed(el.querySelector("#nIg").value),
        facebook: el.querySelector("#nFb").value.trim(),
        mapa: el.querySelector("#nMapa").value.trim(),
        whatsapp: el.querySelector("#nWa").value.trim(),
      });
      log("ajustes", "Datos del negocio actualizados");
      toast("Guardado");
    };
  }

  // ── Respaldo ──
  function renderResp() {
    const el = root.querySelector("#aResp");
    if (!el) return;
    const d = diasSinRespaldo();
    el.innerHTML = `<h3>Respaldo</h3>
      <p class="ayuda">Un Excel con todo: carta (se puede volver a importar), insumos y recetas, ventas con detalle, cajas, clientes, proveedores, compras, reservas y el registro de cambios. Guardalo en el Drive o en la PC.</p>
      <p class="ayuda">${d === Infinity ? "Todavía no se descargó ningún respaldo." : `Último respaldo: ${fechaHora(S.config.ultimoRespaldo)}${d >= 7 ? ` · hace ${d} días` : ""}.`}</p>
      <button class="btn btn-pri" data-act="respaldo">${icon("bajar")} Descargar respaldo completo</button>`;
  }

  // ── Carta QR ──
  let publicada = null;
  const soltarCarta = negocio ? db.listen("publico", { id: "carta" }, (d) => { publicada = d; renderCarta(); }) : null;
  function renderCarta() {
    const el = root.querySelector("#aCarta");
    if (!el) return;
    let n = 0;
    try { n = publicada ? JSON.parse(publicada.json).cats.reduce((s, c) => s + c.p.length, 0) : 0; } catch {}
    const url = urlCarta();
    el.innerHTML = `
      <h3>Carta QR</h3>
      <p class="ayuda">Los clientes escanean el código de la mesa y ven la carta con los precios siempre al día. Se actualiza sola cuando cambiás productos, precios o stock (los agotados aparecen como "Agotado").</p>
      <div class="campo" style="margin-top:12px"><span>Dirección de la carta</span>
        <div class="input-boton"><input class="input" readonly value="${esc(url)}"><button class="btn" data-act="copiarCarta">Copiar</button></div></div>
      <div class="fila-botones" style="margin-top:12px">
        <a class="btn" href="${esc(url)}">${icon("externo")} Ver la carta</a>
        <button class="btn btn-pri" data-act="qrMesas">${icon("print")} QR de las mesas</button>
        <button class="btn" data-act="qrGeneral">${icon("bajar")} QR general (imagen)</button>
      </div>
      <p class="ayuda" style="margin-top:10px">${publicada ? `Publicada ${fechaHora(publicada.ts)} · ${n} productos.` : "Todavía no se publicó: se publica sola en unos segundos."} En la carta solo se ven los productos activos y marcados "Mostrar en la carta QR".</p>`;
  }

  function qrSvg(texto) {
    const qr = qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  function tarjetaQr(titulo, url) {
    return `<div class="qr-tarjeta"><img src="img/logo.svg" alt="" class="qr-logo"><div class="qr-codigo">${qrSvg(url)}</div><b class="qr-mesa">${esc(titulo)}</b><span class="qr-txt">Escaneá y mirá la carta</span></div>`;
  }
  function hojaQr() {
    return `<div class="hoja-qr">${S.mesas.map((m) => tarjetaQr(m.nombre, urlCarta(m.id))).join("")}${tarjetaQr("Carta", urlCarta())}</div>`;
  }
  function qrMesas() {
    if (!S.mesas.length) return toast("Primero cargá las mesas");
    const m = modal({
      titulo: "Códigos QR de las mesas",
      clase: "modal-ancho",
      cuerpo: `<p class="ayuda">Uno por mesa, más uno general. En una hoja A4 entran 12. Cada código abre la carta con el nombre de la mesa; si después renombrás una mesa, el código sigue sirviendo.</p><div class="vista-hoja">${hojaQr()}</div>`,
      pie: `<button class="btn btn-pri" data-a="imp">${icon("print")} Imprimir</button>`,
    });
    m.el.querySelector('[data-a="imp"]').onclick = () => imprimirHoja(hojaQr());
  }
  function qrGeneral() {
    const qr = qrcode(0, "M");
    qr.addData(urlCarta());
    qr.make();
    const n = qr.getModuleCount(), celda = 16, margen = 4 * celda;
    const cv = document.createElement("canvas");
    cv.width = cv.height = n * celda + margen * 2;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#1e1e1e";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(margen + c * celda, margen + r * celda, celda, celda);
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = "qr-carta.png";
    a.click();
  }

  // ── Mesas ──
  function renderMesas() {
    const el = root.querySelector("#aMesas");
    if (!el) return;
    const sectores = sectoresMesas();
    const por = {};
    for (const m of S.mesas) (por[m.sector || "Salón"] ||= []).push(m);
    el.innerHTML = `
      <div class="tarjeta-cab"><h3>Mesas</h3>
        <div class="chips"><button class="chip" data-act="agregarMesa">${icon("mas")} Mesa</button><button class="chip" data-act="agregarVarias">${icon("mas")} Varias</button></div></div>
      ${sectores.map((s) => `<h4 class="subtitulo">${esc(s)}</h4><div class="mesas-edit">${por[s].map((m) => `
        <div class="mesa-edit"><button class="btn-texto" data-renombrar="${esc(m.id)}">${esc(m.nombre)}</button><small>${m.capacidad || "–"} lug.</small>
          <button class="btn-icono" data-borrarmesa="${esc(m.id)}" aria-label="Borrar">${icon("basura")}</button></div>`).join("")}</div>`).join("")
        || `<p class="ayuda">No hay mesas todavía.</p>`}`;
  }

  // ── Turnos de caja ──
  const PRESET_TURNOS = {
    2: [["Mañana/tarde", "08:00", "16:00"], ["Tarde/noche", "16:00", "02:00"]],
    3: [["Mañana", "07:00", "13:00"], ["Tarde", "13:00", "19:00"], ["Noche", "19:00", "02:00"]],
    4: [["Mañana", "07:00", "12:00"], ["Mediodía", "12:00", "16:00"], ["Tarde", "16:00", "20:00"], ["Noche", "20:00", "02:00"]],
  };
  const idTurno = () => "t" + Math.random().toString(36).slice(2, 8);
  let borrador = null; // turnos en edición (no se pisa con cambios de otro dispositivo mientras se edita)
  function renderTurnos() {
    const el = root.querySelector("#aTurnos");
    if (!el) return;
    if (!borrador) borrador = turnosCaja().map((t) => ({ ...t }));
    const n = Math.max(1, borrador.length);
    el.innerHTML = `
      <h3>Turnos de caja</h3>
      <p class="ayuda">Cuántas veces se abre y se cierra la caja por día. Al abrir la caja se elige el turno (se sugiere según la hora) y en Reportes se ven las ventas de cada turno.</p>
      <div class="segmentado ancho" id="tCant">${[1, 2, 3, 4].map((k) => `<button type="button" data-tn="${k}" class="${k === n ? "activo" : ""}">${["", "Uno", "Dos", "Tres", "Cuatro"][k]}</button>`).join("")}</div>
      ${n === 1 ? `<p class="ayuda">Una sola caja por día: no hace falta elegir turno al abrir.</p>` : `
        <div class="turnos-ed">
          <div class="te-fila te-cab"><span>Nombre</span><span>Desde</span><span>Hasta</span></div>
          ${borrador.map((t, k) => `<div class="te-fila"><input class="input" data-tnom="${k}" value="${esc(t.nombre)}" placeholder="Turno ${k + 1}" maxlength="24"><input class="input te-hora" inputmode="numeric" maxlength="5" placeholder="08:00" data-tdesde="${k}" value="${esc(t.desde)}"><input class="input te-hora" inputmode="numeric" maxlength="5" placeholder="16:00" data-thasta="${k}" value="${esc(t.hasta)}"></div>`).join("")}
        </div>
        <p class="ayuda">El horario sirve para sugerir el turno al abrir la caja y para ubicar las ventas anteriores a este cambio. Un turno puede pasar la medianoche (por ejemplo, de 16:00 a 02:00).</p>`}
      <button type="button" class="btn btn-pri" data-act="guardarTurnos">Guardar turnos</button>`;
  }
  // "8" → 08:00 · "1630" → 16:30 · "2:5" → 02:05 · cualquier otra cosa → null
  function normalizarHora(v) {
    const s = String(v || "").trim().replace(/[.h]/gi, ":");
    let h, m;
    if (/^\d{1,2}$/.test(s)) [h, m] = [Number(s), 0];
    else if (/^\d{3,4}$/.test(s)) [h, m] = [Number(s.slice(0, -2)), Number(s.slice(-2))];
    else if (/^\d{1,2}:\d{1,2}$/.test(s)) [h, m] = s.split(":").map(Number);
    else return null;
    if (h === 24 && m === 0) h = 0;
    return h < 24 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null;
  }
  function guardarTurnos() {
    const lista = borrador.map((t) => ({ id: t.id || idTurno(), nombre: String(t.nombre || "").trim(), desde: normalizarHora(t.desde), hasta: normalizarHora(t.hasta) }));
    if (lista.length > 1) {
      if (lista.some((t) => !t.desde || !t.hasta)) return toast("Revisá los horarios: van como 08:00 o 16:30", "error");
      if (lista.some((t) => !t.nombre)) return toast("Poné un nombre a cada turno", "error");
      if (new Set(lista.map((t) => t.nombre.toLowerCase())).size !== lista.length) return toast("Hay dos turnos con el mismo nombre", "error");
    }
    const final = lista.length > 1 ? lista : [];
    db.merge("config", "general", { turnos: final });
    log("ajustes", final.length ? `Turnos de caja: ${final.map((t) => `${t.nombre} (${t.desde}-${t.hasta})`).join(", ")}` : "Turnos de caja: una sola caja por día");
    toast(final.length ? `${final.length} turnos guardados` : "Una sola caja por día");
    borrador = null;
    setTimeout(renderTurnos, 50);
  }

  async function agregarMesas(varias) {
    const sectores = sectoresMesas();
    const nums = S.mesas.map((m) => parseInt(String(m.nombre).replace(/\D+/g, ""), 10)).filter((n) => !isNaN(n));
    const sig = (nums.length ? Math.max(...nums) : 0) + 1;
    const m = modal({
      titulo: varias ? "Agregar varias mesas" : "Agregar mesa",
      clase: "modal-chico",
      cuerpo: `<form class="form" id="fMesa">
        ${varias
          ? `<div class="dos-col"><label class="campo"><span>Desde el número</span><input class="input" id="mDesde" inputmode="numeric" value="${sig}"></label><label class="campo"><span>Hasta</span><input class="input" id="mHasta" inputmode="numeric" value="${sig + 3}"></label></div>`
          : `<label class="campo"><span>Nombre</span><input class="input" id="mNom" value="Mesa ${sig}" autofocus></label>`}
        <label class="campo"><span>Sector</span><input class="input" id="mSec" list="mSecs" value="${esc(sectores[0] || "Salón")}"><datalist id="mSecs">${sectores.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>
        <label class="campo"><span>Lugares</span><input class="input" id="mCap" inputmode="numeric" value="4"></label>
      </form>`,
      pie: `<button type="submit" form="fMesa" class="btn btn-pri btn-bloque">Agregar</button>`,
    });
    const $ = (s) => m.el.querySelector(s);
    $("#fMesa").onsubmit = (e) => {
      e.preventDefault();
      const sector = $("#mSec").value.trim() || "Salón";
      const capacidad = parseInt($("#mCap").value, 10) || 0;
      let orden = Math.max(0, ...S.mesas.map((x) => Number(x.orden) || 0));
      const nombres = varias
        ? (() => { const a = parseInt($("#mDesde").value, 10), b = parseInt($("#mHasta").value, 10); return a && b && b >= a && b - a < 60 ? Array.from({ length: b - a + 1 }, (_, i) => `Mesa ${a + i}`) : []; })()
        : [$("#mNom").value.trim()].filter(Boolean);
      if (!nombres.length) return toast("Revisá los datos", "error");
      const repetidas = nombres.filter((n) => S.mesas.some((x) => x.nombre.toLowerCase() === n.toLowerCase()));
      if (repetidas.length) return toast(`Ya existe: ${repetidas.join(", ")}`, "error");
      db.batch(nombres.map((nombre) => ({ op: "set", col: "mesas", id: db.newId("mesas"), data: { nombre, sector, capacidad, orden: ++orden, comandaId: null } })));
      log("ajustes", `Mesas agregadas: ${nombres.join(", ")}`);
      m.cerrar();
    };
  }

  // ── Eventos ──
  // Al salir de un horario, se acomoda el formato (8 → 08:00)
  root.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!borrador || !t.classList?.contains("te-hora")) return;
    const h = normalizarHora(t.value);
    if (h) { t.value = h; if (t.dataset.tdesde !== undefined) borrador[Number(t.dataset.tdesde)].desde = h; else borrador[Number(t.dataset.thasta)].hasta = h; }
  });
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (!borrador) return;
    if (t.dataset.tnom !== undefined) borrador[Number(t.dataset.tnom)].nombre = t.value;
    else if (t.dataset.tdesde !== undefined) borrador[Number(t.dataset.tdesde)].desde = t.value;
    else if (t.dataset.thasta !== undefined) borrador[Number(t.dataset.thasta)].hasta = t.value;
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "dModo") { guardarDispositivo({ impresora: { modo: t.value } }); renderDisp(); }
    else if (t.id === "dCorte") guardarDispositivo({ impresora: { cortar: t.checked } });
    else if (t.id === "dAcentos") guardarDispositivo({ impresora: { sinAcentos: t.checked } });
    else if (t.id === "dLogo") guardarDispositivo({ impresora: { logo: t.checked } });
    else if (t.id === "dEnviar") guardarDispositivo({ impresora: { alEnviar: t.checked } });
    else if (t.id === "dInicio") { guardarDispositivo({ inicio: t.value }); toast("Listo: este dispositivo abre en " + (PANTALLAS_INICIO.find(([k]) => k === t.value)?.[1] || "")); }
    else if (t.id === "dCod") {
      const v = t.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (v) { guardarDispositivo({ codigo: v }); toast("Código guardado"); }
      renderDisp();
    }
  });
  root.addEventListener("click", async (e) => {
    const tn = e.target.closest("[data-tn]");
    if (tn) {
      const n = Number(tn.dataset.tn);
      if (n === Math.max(1, borrador.length)) return;
      // Al cambiar la cantidad se proponen nombres y horarios típicos; se pueden editar antes de guardar
      const actuales = turnosCaja();
      borrador = n === 1 ? [] : actuales.length === n ? actuales.map((t) => ({ ...t })) : PRESET_TURNOS[n].map(([nombre, desde, hasta]) => ({ id: idTurno(), nombre, desde, hasta }));
      renderTurnos();
      return;
    }
    const an = e.target.closest("[data-ancho]");
    if (an) { guardarDispositivo({ impresora: { ancho: Number(an.dataset.ancho) } }); renderDisp(); return; }
    const rn = e.target.closest("[data-renombrar]");
    if (rn) {
      const m = S.mesas.find((x) => x.id === rn.dataset.renombrar);
      const n = await pedirTexto("Nombre de la mesa", { valor: m.nombre });
      if (n && n !== m.nombre) db.update("mesas", m.id, { nombre: n });
      return;
    }
    const bm = e.target.closest("[data-borrarmesa]");
    if (bm) {
      const m = S.mesas.find((x) => x.id === bm.dataset.borrarmesa);
      if (comandaDeMesa(m)) return toast("La mesa está ocupada", "error");
      if (await confirmar(`¿Borrar ${m.nombre}?`, { ok: "Borrar", peligro: true })) { db.remove("mesas", m.id); log("ajustes", `Mesa borrada: ${m.nombre}`); }
      return;
    }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    switch (a.dataset.act) {
      case "prueba": imprimir(ticketPrueba()); break;
      case "conectar":
        try {
          const n = dispositivo().impresora.modo === "usb" ? await conectarUSB() : await conectarBluetooth();
          toast(`Conectada: ${n}`);
        } catch (err) { if (err.name !== "NotFoundError") toast(err.message || "No se pudo conectar", "error"); }
        renderDisp();
        break;
      case "copiarCarta":
        try { await navigator.clipboard.writeText(urlCarta()); toast("Enlace copiado"); } catch { toast("No se pudo copiar"); }
        break;
      case "qrMesas": qrMesas(); break;
      case "qrGeneral": qrGeneral(); break;
      case "agregarMesa": agregarMesas(false); break;
      case "agregarVarias": agregarMesas(true); break;
      case "respaldo": descargarRespaldo(a); break;
      case "guardarTurnos": guardarTurnos(); break;
      case "reset": if (await confirmar("Se borran todas las ventas y cambios del demo.", { ok: "Reiniciar", peligro: true })) auth.demoReset(); break;
    }
  });

  renderDisp();
  renderNeg();
  renderMesas();
  renderTurnos();
  renderCarta();
  renderResp();
  return {
    update(claves) {
      if (claves.includes("mesas")) renderMesas();
      if (claves.includes("config")) { renderNeg(); renderResp(); }
    },
    unmount() { soltarCarta?.(); },
  };
}
