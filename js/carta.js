// ============================================================
//  A&F · Carta pública (la que abre el cliente con el QR)
// ============================================================
// No usa el SDK de Firebase: lee un solo documento por la API REST
// de Firestore (más liviano para un celular con datos móviles).
// Guarda la última carta en el teléfono: si no hay señal, muestra esa.
import { CONFIG } from "./config.js";
import { buscar } from "./buscar.js";
import { firmaHTML, contactoHTML } from "./firma.js";
import { activarDeslizables } from "./desliza.js";

const params = new URLSearchParams(location.search);
// Dos páginas con la misma carta: carta.html (el QR del bar, solo para mirar) y
// pedidos.html (la de pedidos: delivery y para llevar). Se actualizan juntas.
const MODO_PEDIDOS = document.body.dataset.modo === "pedidos" || params.has("pedir");
const DEMO = !CONFIG.firebase || params.has("demo");
const CACHE = "af_carta_publica";
const raiz = document.getElementById("carta");
let carta = null;
let q = "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const precio = (n) => "$ " + nf.format(n);

async function obtener() {
  if (DEMO) {
    const d = JSON.parse(localStorage.getItem("af_demo_v1") || "null");
    const j = d?.publico?.carta?.json;
    if (!j) throw new Error("sin-publicar");
    return { carta: JSON.parse(j), ts: d.publico.carta.ts };
  }
  const f = CONFIG.firebase;
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(f.projectId)}/databases/(default)/documents/negocios/${encodeURIComponent(CONFIG.negocioId)}/publico/carta?key=${encodeURIComponent(f.apiKey)}`;
  const r = await fetch(url, { cache: "no-store" });
  if (r.status === 404) throw new Error("sin-publicar");
  if (!r.ok) throw new Error("http-" + r.status);
  const doc = await r.json();
  return { carta: JSON.parse(doc.fields.json.stringValue), ts: Number(doc.fields.ts?.integerValue) || 0 };
}

// El número ya viene normalizado desde la app (campo "wa"); el resto es por compatibilidad
function waLink(c, texto = "") {
  let d = c.wa || "";
  if (!d) {
    d = String(c.whatsapp || "").replace(/\D+/g, "").replace(/^0+/, "");
    if (!d) return "";
    if (!d.startsWith("54")) d = "549" + d;
  }
  return "https://wa.me/" + d + (texto ? "?text=" + encodeURIComponent(texto) : "");
}

const hoyStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Reserva: arma el mensaje y abre WhatsApp. No guarda nada: la confirma el bar.
// directo: se abrió solo, desde el enlace para reservar (carta.html?reservar)
function abrirReserva(directo = false) {
  const fondo = document.createElement("div");
  fondo.className = "hoja-fondo";
  fondo.innerHTML = `<form class="hoja" role="dialog" aria-modal="true" aria-label="Reservar mesa">
    <h2>Reservar mesa</h2>
    <label>Nombre<input name="nombre" required autocomplete="name"></label>
    <div class="dos"><label>Día<input name="dia" type="date" min="${hoyStr()}" value="${hoyStr()}" required></label>
      <label>Hora<input name="hora" type="time" value="21:00" required></label></div>
    <label>Personas<select name="pers">${Array.from({ length: 12 }, (_, i) => `<option ${i === 1 ? "selected" : ""}>${i + 1}</option>`).join("")}<option value="más de 12">Más de 12</option></select></label>
    <label>Comentario (opcional)<input name="nota" placeholder="Cumpleaños, silla para bebé…"></label>
    <button class="btn-wa">Enviar por WhatsApp</button>
    <button type="button" class="btn-sec" data-cerrar>${directo ? "Ver la carta" : "Cancelar"}</button>
    <p class="nota">Te contestamos por WhatsApp para confirmar.</p>
  </form>`;
  document.body.appendChild(fondo);
  const cerrar = () => {
    fondo.remove();
    if (directo) cerrarDirecta = null;
    // Al cerrar queda la dirección de la carta, así al recargar no se vuelve a abrir
    if (params.has("reservar")) {
      params.delete("reservar");
      const s = params.toString().replace(/=(&|$)/g, "$1");
      history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash);
    }
  };
  fondo.addEventListener("click", (e) => { if (e.target === fondo || e.target.closest("[data-cerrar]")) cerrar(); });
  if (directo) cerrarDirecta = cerrar;
  const f = fondo.querySelector("form");
  f.nombre.focus();
  f.onsubmit = (e) => {
    e.preventDefault();
    const [y, m, d] = f.dia.value.split("-").map(Number);
    const dia = new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    const txt = `¡Hola! Quiero reservar una mesa para ${f.pers.value} persona${f.pers.value === "1" ? "" : "s"} el ${dia} a las ${f.hora.value} h, a nombre de ${f.nombre.value.trim()}.${f.nota.value.trim() ? ` ${f.nota.value.trim()}.` : ""}`;
    window.open(waLink(carta, txt), "_blank", "noopener");
    cerrar();
  };
}

let reservaAbierta = false;
let cerrarDirecta = null;
function render() {
  const c = carta;
  const mesa = mesaActual();
  const conDatos = c.cats.reduce((s, x) => s + x.p.length, 0);
  const ped = MODO_PEDIDOS && !mesa && pedidosOn() && conDatos;
  const res = !MODO_PEDIDOS && !mesa && c.reservas !== false && waLink(c);
  const cfgPed = c.pedidos || {};
  raiz.innerHTML = `
    <header class="cab">
      <img src="img/logo.svg" alt="${esc(c.nombre)}" class="logo" width="620" height="460">
      ${c.lema ? `<p class="lema">${esc(c.lema)}</p>` : ""}
      ${mesa ? `<p class="mesa">${esc(mesa)}</p>` : ""}
      ${res ? `<div class="acciones"><button class="btn-reservar" id="btnRes">Reservar mesa</button></div>` : ""}
      ${MODO_PEDIDOS ? (ped
        ? `<p class="modo-ped">Pedidos · ${esc(textoPedir())}</p>
           ${cfgPed.d && (cfgPed.envio || cfgPed.zona) ? `<p class="ped-info">${[cfgPed.envio ? `Envío ${precio(cfgPed.envio)}` : "", cfgPed.zona ? `Zona: ${esc(cfgPed.zona)}` : ""].filter(Boolean).join(" · ")}</p>` : ""}
           <p class="ped-ayuda" id="pedAyuda">Tocá <b>+</b> en lo que quieras y después <b>Ver pedido</b>, abajo. Te confirmamos por WhatsApp.</p>`
        : `<p class="modo-ped">Pedidos</p><p class="ped-ayuda" id="pedCerrado">Por ahora no estamos tomando pedidos por acá.${waLink(c) ? ` <a href="${esc(waLink(c))}" target="_blank" rel="noopener">Escribinos por WhatsApp</a>.` : ""}</p>`) : ""}
    </header>
    ${conDatos ? `
    <div class="barra">
      <input id="busq" type="search" placeholder="Buscar en la carta…" autocomplete="off" value="${esc(q)}" aria-label="Buscar en la carta">
      <nav class="cats" id="cats" aria-label="Secciones de la carta">${c.cats.map((x, i) => `<button type="button" data-i="${i}">${esc(x.n)}</button>`).join("")}</nav>
    </div>
    <div id="lista"></div>` : `<p class="estado">La carta se está preparando. ¡Volvé a mirar en un rato!</p>`}
    <footer class="pie">
      ${c.horario ? `<div class="horario">${RELOJ}<span>${esc(c.horario)}</span></div>` : ""}
      ${contactoHTML(c)}
      ${firmaHTML()}
    </footer>`;
  document.getElementById("btnRes")?.addEventListener("click", () => abrirReserva());
  // Enlace para reservar: el formulario se abre solo, una vez (la carta se vuelve a dibujar al actualizarse)
  if (params.has("reservar") && !reservaAbierta && document.getElementById("btnRes")) {
    reservaAbierta = true;
    abrirReserva(true);
  }
  // Se abrió con la carta guardada en el teléfono y la recién bajada ya no tiene reservas: se cierra
  if (cerrarDirecta && !document.getElementById("btnRes")) cerrarDirecta();
  pintarBarra();
  if (!conDatos) return;
  renderLista();
  const busq = document.getElementById("busq");
  busq.addEventListener("input", () => { q = busq.value.trim(); renderLista(); if (!q) { marcada = -1; elegida = null; alDesplazar(); } });
  observarCategorias();
}

function renderLista() {
  const lista = document.getElementById("lista");
  if (!q) {
    lista.innerHTML = carta.cats.map((x, i) => `
      <section class="cat" id="cat${i}">
        <h2>${esc(x.n)}</h2>
        ${x.p.map(item).join("")}
      </section>`).join("");
    document.getElementById("cats").hidden = false;
    return;
  }
  const todos = carta.cats.flatMap((x) => x.p.map((p) => ({ ...p, nombre: p.n, cat: x.n })));
  const res = buscar(todos, q, (p) => `${p.n} ${p.d || ""} ${p.cat}`);
  document.getElementById("cats").hidden = true;
  lista.innerHTML = res.length
    ? `<section class="cat">${res.map(item).join("")}</section>`
    : `<p class="estado">No encontramos "${esc(q)}".</p>`;
}

function item(p) {
  return `<article class="item ${p.a ? "agotado" : ""}" data-n="${esc(p.n)}">
    <div class="item-linea"><h3>${esc(p.n)}</h3><span class="puntos"></span><span class="precio">${p.a ? "Agotado" : precio(p.p)}</span>${pidiendo && !p.a && pedidosOn() ? `<span class="ped-ctrl">${ctrlHTML(p.n)}</span>` : ""}</div>
    ${p.d ? `<p class="desc">${esc(p.d)}</p>` : ""}
    ${p.o ? `<p class="desc op">${esc(p.o)}</p>` : ""}
  </article>`;
}

// ── Pedidos por WhatsApp: delivery o para retirar ──
// El cliente arma el pedido en la carta y lo manda por WhatsApp con el
// detalle, el envío y el total. No se guarda nada en el sistema: el bar lo
// confirma por WhatsApp y lo carga. El pedido queda en el teléfono hasta
// enviarlo (12 horas), y los datos del cliente para la próxima vez.
const PEDIDO = "af_pedido";
const CLIENTE = "af_cliente";
const pidiendo = MODO_PEDIDOS;
let pedido = leerPedido(); // [{ n: nombre del producto, cant, nota }]

function leerPedido() {
  try {
    const x = JSON.parse(localStorage.getItem(PEDIDO) || "null");
    if (x && Date.now() - x.ts < 12 * 3600e3 && Array.isArray(x.items)) return x.items;
  } catch {}
  return [];
}
function guardarPedido() { try { localStorage.setItem(PEDIDO, JSON.stringify({ ts: Date.now(), items: pedido })); } catch {} }
function leerCliente() { try { return JSON.parse(localStorage.getItem(CLIENTE) || "{}") || {}; } catch { return {}; } }

function mesaActual() { return params.get("m") ? carta?.mesas?.[params.get("m")] || "" : ""; }
const pedidosOn = () => !!(carta?.pedidos && (carta.pedidos.d || carta.pedidos.r) && waLink(carta) && !mesaActual());
const textoPedir = () => { const x = carta.pedidos; return x.d && x.r ? "Delivery y para llevar" : x.d ? "Delivery" : "Para retirar en el local"; };

function producto(n) {
  for (const c of carta.cats) for (const p of c.p) if (p.n === n) return p;
  return null;
}
// Las líneas que se pueden pedir, con el precio de la carta de ahora (las agotadas o borradas no)
const lineas = () => pedido.map((l) => ({ ...l, p: producto(l.n) })).filter((l) => l.p && !l.p.a && l.cant > 0);
const cantDe = (n) => pedido.find((l) => l.n === n)?.cant || 0;
const subtotal = () => lineas().reduce((s, l) => s + l.p.p * l.cant, 0);

function ctrlHTML(n) {
  const k = cantDe(n);
  return k
    ? `<span class="cant-ctrl"><button type="button" data-menos="${esc(n)}" aria-label="Sacar uno">−</button><b>${k}</b><button type="button" data-mas="${esc(n)}" aria-label="Sumar uno">+</button></span>`
    : `<button type="button" class="btn-mas" data-mas="${esc(n)}" aria-label="Agregar ${esc(n)}">+</button>`;
}

function cambiar(n, d) {
  const l = pedido.find((x) => x.n === n);
  if (l) l.cant = Math.max(0, l.cant + d);
  else if (d > 0) pedido.push({ n, cant: d, nota: "" });
  pedido = pedido.filter((x) => x.cant > 0);
  guardarPedido();
  // Solo se redibujan los botones de ese producto (así no se mueve la página)
  document.querySelectorAll(".item[data-n]").forEach((a) => { if (a.dataset.n === n) { const c = a.querySelector(".ped-ctrl"); if (c) c.innerHTML = ctrlHTML(n); } });
  pintarBarra();
}

const barra = document.createElement("div");
barra.className = "barra-pedido";
barra.hidden = true;
barra.innerHTML = `<button type="button" id="verPed"><span class="bp-cant"></span><span class="bp-txt">Ver pedido</span><b class="bp-total"></b></button>`;
document.body.appendChild(barra);
barra.addEventListener("click", () => abrirPedido());

function pintarBarra() {
  const ls = pidiendo && pedidosOn() ? lineas() : [];
  barra.hidden = !ls.length;
  document.body.classList.toggle("con-pedido", !!ls.length);
  if (!ls.length) return;
  const n = ls.reduce((s, l) => s + l.cant, 0);
  barra.querySelector(".bp-cant").textContent = n;
  barra.querySelector(".bp-total").textContent = precio(subtotal());
}

raiz.addEventListener("click", (e) => {
  const mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
  if (mas) cambiar(mas.dataset.mas, 1);
  else if (menos) cambiar(menos.dataset.menos, -1);
});

function abrirPedido() {
  if (!pedidosOn()) return;
  const cfg = carta.pedidos;
  const cli = leerCliente();
  let tipo = cfg.d && cfg.r ? (cli.tipo === "retiro" ? "retiro" : "delivery") : cfg.d ? "delivery" : "retiro";
  let pago = cli.pago === "transf" ? "transf" : "efectivo";
  let ultimo = "";
  const fondo = document.createElement("div");
  fondo.className = "hoja-fondo";
  fondo.innerHTML = `<form class="hoja larga" role="dialog" aria-modal="true" aria-label="Tu pedido" novalidate>
    <h2>Tu pedido</h2>
    <div class="lineas" id="pLineas"></div>
    ${cfg.d && cfg.r ? `<div class="seg" id="pTipo"><button type="button" data-t="delivery">Delivery${cfg.envio ? ` (+ ${precio(cfg.envio)})` : ""}</button><button type="button" data-t="retiro">Retiro en el local</button></div>`
      : `<p class="ped-tipo">${cfg.d ? `Delivery${cfg.envio ? ` · envío ${precio(cfg.envio)}` : ""}` : `Para retirar en el local${carta.direccion ? `: ${esc(carta.direccion)}` : ""}`}</p>`}
    <label>Nombre<input name="nombre" required autocomplete="name" value="${esc(cli.nombre || "")}"></label>
    <div class="grupo" id="pDel">
      <label>Dirección<input name="dir" autocomplete="street-address" placeholder="Calle y número" value="${esc(cli.dir || "")}"></label>
      <label>Piso, depto o entre calles (opcional)<input name="ref" value="${esc(cli.ref || "")}"></label>
      ${cfg.zona ? `<p class="nota zona">Zona de envío: ${esc(cfg.zona)}</p>` : ""}
    </div>
    <p class="nota zona" id="pRet">${carta.direccion ? `Retirás en ${esc(carta.direccion)}.` : ""}</p>
    <label>Hora (opcional; si no, lo antes posible)<input name="hora" type="time"></label>
    <div class="grupo"><span class="lbl">Pago</span>
      <div class="seg" id="pPago"><button type="button" data-p="efectivo">Efectivo</button><button type="button" data-p="transf">Transferencia o Mercado Pago</button></div></div>
    <label id="pCon">¿Con cuánto pagás? (opcional, para el vuelto)<input name="con" inputmode="numeric" placeholder="$"></label>
    <p class="nota alias" id="pAlias">${cfg.alias ? `Alias: <b>${esc(cfg.alias)}</b>. ` : ""}Cuando el bar te confirme, mandá el comprobante por WhatsApp.</p>
    <label>Comentario (opcional)<input name="nota" placeholder="Sin sal, tocar timbre B…"></label>
    <div class="totales" id="pTot"></div>
    <button class="btn-wa" id="pEnviar">Enviar pedido por WhatsApp</button>
    <button type="button" class="btn-sec" data-cerrar>Seguir mirando la carta</button>
    <p class="nota">El bar te confirma el pedido y el horario por WhatsApp.</p>
  </form>`;
  document.body.appendChild(fondo);
  document.body.classList.add("con-hoja");
  const f = fondo.querySelector("form");
  const $ = (s) => f.querySelector(s);
  const cerrar = () => { fondo.remove(); document.body.classList.remove("con-hoja"); };
  fondo.addEventListener("click", (e) => { if (e.target === fondo || e.target.closest("[data-cerrar]")) cerrar(); });

  const pintarLineas = () => {
    const ls = lineas();
    const fuera = pedido.filter((l) => !ls.some((x) => x.n === l.n)).map((l) => l.n);
    $("#pLineas").innerHTML = (ls.length
      ? ls.map((l) => `<div class="linea" data-n="${esc(l.n)}">
          <div class="linea-cab"><span class="linea-n">${esc(l.n)}</span>${ctrlHTML(l.n)}<b class="linea-p">${precio(l.p.p * l.cant)}</b></div>
          ${l.p.o ? `<small class="desc op">${esc(l.p.o)}</small>` : ""}
          <input class="linea-nota" data-nota="${esc(l.n)}" value="${esc(l.nota || "")}" maxlength="80" placeholder="${l.p.o ? "Aclaración: qué opción querés" : "Aclaración (opcional)"}" aria-label="Aclaración para ${esc(l.n)}">
        </div>`).join("")
      : `<p class="nota vacio">Tu pedido está vacío. Tocá <b>+</b> en la carta para sumar productos.</p>`)
      + (fuera.length ? `<p class="nota">Se sacó del pedido (agotado): ${fuera.map(esc).join(", ")}.</p>` : "");
    pintarTotales();
  };
  const envio = () => (tipo === "delivery" ? cfg.envio || 0 : 0);
  const pintarTotales = () => {
    const sub = subtotal();
    $("#pTot").innerHTML = (envio() ? `<div><span>Subtotal</span><span>${precio(sub)}</span></div><div><span>Envío</span><span>${precio(envio())}</span></div>` : "")
      + `<div class="total"><span>Total</span><span>${precio(sub + envio())}</span></div>`;
    $("#pEnviar").disabled = !lineas().length;
  };
  const pintarOpciones = () => {
    f.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("activo", b.dataset.t === tipo));
    f.querySelectorAll("[data-p]").forEach((b) => b.classList.toggle("activo", b.dataset.p === pago));
    $("#pDel").hidden = tipo !== "delivery";
    $("#pRet").hidden = tipo !== "retiro" || !carta.direccion || !cfg.d;
    $("#pCon").hidden = pago !== "efectivo";
    $("#pAlias").hidden = pago !== "transf";
    pintarTotales();
  };
  f.addEventListener("click", (e) => {
    const t = e.target.closest("[data-t]"), pg = e.target.closest("[data-p]");
    const mas = e.target.closest("[data-mas]"), menos = e.target.closest("[data-menos]");
    if (t) { tipo = t.dataset.t; pintarOpciones(); }
    else if (pg) { pago = pg.dataset.p; pintarOpciones(); }
    else if (mas || menos) { cambiar((mas || menos).dataset[mas ? "mas" : "menos"], mas ? 1 : -1); pintarLineas(); }
  });
  f.addEventListener("input", (e) => {
    e.target.classList?.remove("falta");
    const n = e.target.dataset?.nota;
    if (n == null) return;
    const l = pedido.find((x) => x.n === n);
    if (l) { l.nota = e.target.value; guardarPedido(); }
  });
  pintarLineas();
  pintarOpciones();

  f.onsubmit = (e) => {
    e.preventDefault();
    const ls = lineas();
    if (!ls.length) return;
    const nombre = f.nombre.value.trim(), dir = f.dir.value.trim(), ref = f.ref.value.trim();
    if (!nombre) { f.nombre.focus(); f.nombre.classList.add("falta"); return; }
    if (tipo === "delivery" && !dir) { f.dir.focus(); f.dir.classList.add("falta"); return; }
    try { localStorage.setItem(CLIENTE, JSON.stringify({ nombre, dir, ref, tipo, pago })); } catch {}
    const sub = subtotal(), total = sub + envio();
    const con = Math.round(Number(String(f.con.value).replace(/\D+/g, "")) || 0);
    const nota = f.nota.value.trim();
    const txt = [
      `¡Hola! Quiero hacer un pedido ${tipo === "delivery" ? "para delivery" : "para retirar en el local"}:`,
      ls.map((l) => `• ${l.cant}× ${l.n}: ${precio(l.p.p * l.cant)}${(l.nota || "").trim() ? `\n   (${l.nota.trim()})` : ""}`).join("\n"),
      [envio() ? `Subtotal: ${precio(sub)}` : "", envio() ? `Envío: ${precio(envio())}` : "", `Total: ${precio(total)}`].filter(Boolean).join("\n"),
      [
        `Nombre: ${nombre}`,
        tipo === "delivery" ? `Dirección: ${dir}${ref ? ` (${ref})` : ""}` : "",
        `Hora: ${f.hora.value ? `${f.hora.value} h` : "lo antes posible"}`,
        `Pago: ${pago === "efectivo" ? `efectivo${con ? ` (pago con ${precio(con)})` : ""}` : "transferencia o Mercado Pago"}`,
        nota ? `Comentario: ${nota}` : "",
      ].filter(Boolean).join("\n"),
    ].join("\n\n");
    ultimo = waLink(carta, txt);
    window.open(ultimo, "_blank", "noopener");
    // Listo: se vacía el pedido y queda el aviso (por si WhatsApp no se abrió)
    pedido = [];
    guardarPedido();
    document.querySelectorAll(".item[data-n] .ped-ctrl").forEach((c) => { c.innerHTML = ctrlHTML(c.closest(".item").dataset.n); });
    pintarBarra();
    f.innerHTML = `<h2>¡Listo!</h2>
      <p class="listo">Te abrimos WhatsApp con el pedido. <b>Tocá enviar</b> ahí y el bar te lo confirma.</p>
      <a class="btn-wa" id="pReabrir" href="${esc(ultimo)}" target="_blank" rel="noopener">Abrir WhatsApp de nuevo</a>
      <button type="button" class="btn-sec" data-cerrar>Volver a la carta</button>`;
  };
}

// ── Etiquetas de categorías ──
// Marca la que se está viendo. Ojo: nada de scrollIntoView acá, porque en
// Android corta el desplazamiento con el dedo a mitad de camino. La fila de
// etiquetas se mueve sola, de costado, sin tocar el scroll de la página.
let marcada = -1;
let elegida = null; // la que se tocó: queda marcada hasta que la persona vuelva a desplazar
const altoBarra = () => document.querySelector(".barra")?.getBoundingClientRect().height || 0;

function marcar(i) {
  marcada = i;
  const cont = document.getElementById("cats");
  if (!cont) return;
  cont.querySelectorAll("button").forEach((b) => {
    const si = Number(b.dataset.i) === i;
    b.classList.toggle("activo", si);
    if (si) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
  const b = cont.querySelector(`[data-i="${i}"]`);
  if (b) cont.scrollTo({ left: b.offsetLeft - (cont.clientWidth - b.offsetWidth) / 2, behavior: "smooth" });
}

function seccionActual() {
  const secs = [...document.querySelectorAll(".cat[id]")];
  if (!secs.length) return -1;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) return secs.length - 1;
  const linea = altoBarra() + 24;
  let act = 0;
  secs.forEach((s, k) => { if (s.getBoundingClientRect().top <= linea) act = k; });
  return act;
}

function irA(i) {
  const sec = document.getElementById("cat" + i);
  if (!sec) return;
  elegida = i;
  marcar(i);
  const y = sec.getBoundingClientRect().top + scrollY - altoBarra() + 1;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

let pendiente = false;
function alDesplazar() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => {
    pendiente = false;
    if (elegida !== null || q) return;
    const i = seccionActual();
    if (i !== marcada && i >= 0) marcar(i);
  });
}
const soltarElegida = () => { if (elegida !== null) { elegida = null; alDesplazar(); } };
addEventListener("scroll", alDesplazar, { passive: true });
for (const ev of ["wheel", "touchstart", "keydown"]) addEventListener(ev, soltarElegida, { passive: true });

function observarCategorias() {
  document.getElementById("cats")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (b) irA(Number(b.dataset.i));
  });
  marcada = -1;
  marcar(Math.max(0, seccionActual()));
}

const RELOJ = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.4 2"/></svg>';

// Botón para volver a la app: solo si en este navegador hay sesión iniciada
function botonVolver() {
  let sesion = null;
  try { sesion = JSON.parse(localStorage.getItem("af_sesion") || "null"); } catch {}
  const b = document.getElementById("alApp");
  if (!b || !sesion) return;
  b.href = "./" + (DEMO && params.has("demo") ? "?demo" : "");
  b.hidden = false;
  document.body.classList.add("con-volver");
}

async function iniciar() {
  botonVolver();
  let guardada = null;
  try { guardada = JSON.parse(localStorage.getItem(CACHE) || "null"); } catch {}
  if (guardada?.carta) { carta = guardada.carta; render(); }
  try {
    const r = await obtener();
    try { localStorage.setItem(CACHE, JSON.stringify(r)); } catch {}
    if (JSON.stringify(r.carta) !== JSON.stringify(carta)) { carta = r.carta; render(); }
  } catch (e) {
    if (carta) return; // se queda con la guardada
    raiz.innerHTML = e.message === "sin-publicar"
      ? `<p class="estado">La carta todavía no está publicada.</p>`
      : `<p class="estado">No pudimos cargar la carta. Revisá la conexión.</p><p class="estado"><button onclick="location.reload()">Reintentar</button></p>`;
  }
  document.title = `${MODO_PEDIDOS ? "Pedidos" : "Carta"} · ${carta?.nombre || "A&F"}`;
}

activarDeslizables(".cats");
iniciar();
