// ============================================================
//  A&F · Pedidos sin mesa: para llevar, delivery y venta rápida
// ============================================================
// Un pedido es una comanda sin mesa (mesaId vacío) con un "tipo":
//   llevar    → el cliente lo retira (nombre, teléfono, hora)
//   delivery  → se manda (además dirección y costo de envío)
//   mostrador → venta rápida en el mostrador, sin datos del cliente
// Va a cocina y barra igual que una mesa, y se cobra igual.
import { S, puede, itemsDe, vigentes, totalItems, waLink, log } from "./store.js";
import { db } from "./db.js";
import { esc, fmt, num, hora, icon, modal, toast } from "./util.js";
import { iconoContacto } from "./firma.js";

export const TIPOS_PEDIDO = {
  llevar: { t: "Para llevar", corto: "Llevar", icono: "bolsa" },
  delivery: { t: "Delivery", corto: "Delivery", icono: "moto" },
  mostrador: { t: "Venta rápida", corto: "Mostrador", icono: "flash" },
};
export const esPedido = (c) => !!c && !!TIPOS_PEDIDO[c.tipo];

// Nombre corto que se ve en el salón, la cocina y los tickets
export function etiquetaPedido(tipo, cliente = {}, ts = Date.now()) {
  if (tipo === "mostrador") return `Mostrador ${hora(ts)}`;
  return `${TIPOS_PEDIDO[tipo]?.corto || "Pedido"} · ${(cliente.nombre || "Sin nombre").trim()}`;
}

// Estado del pedido según sus ítems (para la tarjeta del salón)
export function estadoPedido(c) {
  const its = vigentes(itemsDe(c.id)).filter((i) => i.productoId !== "envio");
  if (!its.length) return { clave: "vacio", texto: "Sin productos", clase: "" };
  if (its.some((i) => i.estado === "nuevo")) return { clave: "sinEnviar", texto: "Sin enviar", clase: "rojo" };
  if (its.some((i) => ["pendiente", "preparando"].includes(i.estado))) {
    const tarde = c.hora && Date.now() > horaHoy(c.hora, c.abierta);
    return { clave: "preparando", texto: tarde ? "Demorado" : "En preparación", clase: tarde ? "ambar" : "" };
  }
  if (its.some((i) => i.estado === "listo")) return { clave: "listo", texto: c.tipo === "delivery" ? "Listo para salir" : "Listo para retirar", clase: "verde" };
  if (c.tipo === "delivery" && c.salio) return { clave: "enCamino", texto: "En camino · falta cobrar", clase: "azul" };
  return { clave: "entregado", texto: "Entregado · falta cobrar", clase: "azul" };
}

// "13:30" del día del pedido → timestamp (si ya pasó la medianoche, del día siguiente)
export function horaHoy(hhmm, base = Date.now()) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return Infinity;
  const d = new Date(base);
  d.setHours(h, m || 0, 0, 0);
  if (d.getTime() < base - 6 * 3600000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const pedidosAbiertos = () => S.comandas.filter(esPedido).sort((a, b) => horaHoy(a.hora, a.abierta) - horaHoy(b.hora, b.abierta) || a.abierta - b.abierta);

// ── Alta y edición ──
export function nuevoPedido(tipo = "llevar") { formPedido({ tipo }); }

export function editarPedido(c) { formPedido({ c }); }

function formPedido({ tipo, c = null }) {
  if (!puede("mesa")) return;
  const nuevo = !c;
  let t = c?.tipo || tipo;
  const cli = c?.cliente || {};
  const envioAct = c ? itemsDe(c.id).find((i) => i.productoId === "envio" && i.estado !== "anulado") : null;
  const sugeridos = S.clientes.filter((x) => x.telefono || x.direccion);
  const m = modal({
    titulo: nuevo ? "Nuevo pedido" : "Datos del pedido",
    clase: "modal-chico",
    cuerpo: `<form class="form" id="fPed">
      <div class="segmentado ancho" id="pTipo">
        <button type="button" data-t="llevar" class="${t === "llevar" ? "activo" : ""}">${icon("bolsa")} Para llevar</button>
        <button type="button" data-t="delivery" class="${t === "delivery" ? "activo" : ""}">${icon("moto")} Delivery</button>
      </div>
      <label class="campo"><span>Nombre</span><input class="input" id="pNom" value="${esc(cli.nombre || "")}" list="pCli" required autocomplete="off" ${nuevo ? "autofocus" : ""}>
        <datalist id="pCli">${sugeridos.map((x) => `<option value="${esc(x.nombre)}">`).join("")}</datalist></label>
      <div class="dos-col">
        <label class="campo"><span>Teléfono</span><input class="input" id="pTel" inputmode="tel" value="${esc(cli.telefono || "")}" placeholder="341 555-1234"></label>
        <label class="campo"><span id="pHoraTxt">Hora de retiro</span><input class="input" id="pHora" type="time" value="${esc(c?.hora || "")}"></label>
      </div>
      <div id="pDel">
        <label class="campo"><span>Dirección</span><input class="input" id="pDir" value="${esc(cli.direccion || "")}" placeholder="Calle 1234, piso, depto"></label>
        <div class="dos-col">
          <label class="campo"><span>Costo de envío</span><input class="input" id="pEnv" inputmode="decimal" value="${envioAct ? Math.round(envioAct.precio) : nuevo ? (S.config.envio || "") : ""}" placeholder="$ 0"></label>
          <label class="campo"><span>Pago</span><select class="input" id="pPago">
            <option value="">Paga al recibir</option>
            <option value="pagado" ${cli.pago === "pagado" ? "selected" : ""}>Ya pagó (transferencia o MP)</option></select></label>
        </div>
      </div>
      <label class="campo"><span>Nota</span><input class="input" id="pNota" value="${esc(cli.nota || "")}" placeholder="Pagó por transferencia, tocar timbre…"></label>
      <p class="ayuda">Si no ponés hora, es para lo antes posible.</p>
    </form>`,
    pie: `<button type="submit" form="fPed" class="btn btn-pri btn-bloque">${nuevo ? "Crear y cargar productos" : "Guardar"}</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  const pintarTipo = () => {
    m.el.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("activo", b.dataset.t === t));
    $("#pDel").hidden = t !== "delivery";
    $("#pHoraTxt").textContent = t === "delivery" ? "Hora de entrega" : "Hora de retiro";
  };
  $("#pTipo").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { t = b.dataset.t; pintarTipo(); } });
  // Elegir un cliente guardado completa teléfono y dirección
  $("#pNom").addEventListener("change", () => {
    const x = S.clientes.find((y) => y.nombre === $("#pNom").value);
    if (!x) return;
    if (x.telefono && !$("#pTel").value) $("#pTel").value = x.telefono;
    if (x.direccion && !$("#pDir").value) $("#pDir").value = x.direccion;
  });
  pintarTipo();

  $("#fPed").onsubmit = (e) => {
    e.preventDefault();
    const cliente = { nombre: $("#pNom").value.trim(), telefono: $("#pTel").value.trim(), direccion: t === "delivery" ? $("#pDir").value.trim() : "", nota: $("#pNota").value.trim(), pago: t === "delivery" ? $("#pPago").value : "" };
    if (!cliente.nombre) return toast("Poné el nombre de quien pide", "error");
    if (t === "delivery" && !cliente.direccion) { $("#pDir").focus(); return toast("Falta la dirección", "error"); }
    const hh = $("#pHora").value;
    const envio = t === "delivery" ? Math.round(num($("#pEnv").value)) : 0;
    const etiqueta = etiquetaPedido(t, cliente, c?.abierta);
    const ops = [];
    if (nuevo) {
      const cid = db.newId("comandas");
      ops.push({ op: "set", col: "comandas", id: cid, data: {
        tipo: t, mesaId: "", mesaNombre: etiqueta, cliente, hora: hh,
        mozo: S.perfil.nombre, mozoUid: S.user.uid, comensales: 1,
        abierta: Date.now(), estado: "abierta", abiertaPor: S.perfil.nombre,
      } });
      if (envio > 0) ops.push({ op: "set", col: "items", id: db.newId("items"), data: itemEnvio(cid, t, etiqueta, hh, envio) });
      db.batch(ops);
      log("pedido", `${TIPOS_PEDIDO[t].t}: ${cliente.nombre}${hh ? ` (${hh})` : ""}`, { comandaId: cid });
      m.cerrar();
      location.hash = "#/mesa/" + cid;
      return;
    }
    // Edición: también se actualizan los ítems (la cocina muestra nombre, tipo y hora)
    ops.push({ op: "update", col: "comandas", id: c.id, data: { tipo: t, mesaNombre: etiqueta, cliente, hora: hh } });
    for (const i of itemsDe(c.id)) ops.push({ op: "update", col: "items", id: i.id, data: { mesaNombre: etiqueta, tipo: t, hora: hh } });
    if (envioAct && envio !== Math.round(envioAct.precio)) {
      if (envio > 0) ops.push({ op: "update", col: "items", id: envioAct.id, data: { precio: envio } });
      else ops.push(envioAct.estado === "nuevo" ? { op: "delete", col: "items", id: envioAct.id } : { op: "update", col: "items", id: envioAct.id, data: { estado: "anulado", motivo: "Sin envío", anuladoPor: S.perfil.nombre, anuladoTs: Date.now() } });
    } else if (!envioAct && envio > 0) ops.push({ op: "set", col: "items", id: db.newId("items"), data: itemEnvio(c.id, t, etiqueta, hh, envio) });
    db.batch(ops);
    m.cerrar();
    toast("Pedido actualizado");
  };
}

function itemEnvio(cid, tipo, etiqueta, hh, precio) {
  return {
    comandaId: cid, mesaId: "", mesaNombre: etiqueta, tipo, hora: hh,
    productoId: "envio", desc: "Envío", precio, cant: 1, nota: "", sector: "ninguno",
    estado: "nuevo", cerrado: false, mozo: S.perfil.nombre, mozoUid: S.user.uid, cargadoPor: S.perfil.nombre, ts: Date.now(),
  };
}

// ── Venta rápida ──
// Ventas rápidas abiertas desde este dispositivo: el menú las marca enseguida,
// antes de que la base de datos devuelva la comanda nueva.
export const rapidasLocales = new Set();
// reemplazar: sin dejar un paso extra en el historial (el botón "atrás" vuelve a donde estaba)
export function nuevaVentaRapida({ reemplazar = false } = {}) {
  if (!puede("mesa")) return;
  const cid = db.newId("comandas");
  const t = Date.now();
  rapidasLocales.add(cid);
  db.set("comandas", cid, {
    tipo: "mostrador", mesaId: "", mesaNombre: etiquetaPedido("mostrador", {}, t), cliente: {}, hora: "",
    mozo: S.perfil.nombre, mozoUid: S.user.uid, comensales: 1, abierta: t, estado: "abierta", abiertaPor: S.perfil.nombre,
  });
  if (reemplazar) location.replace("#/mesa/" + cid);
  else location.hash = "#/mesa/" + cid;
}

// Si se sale de una venta rápida sin cargar nada, no queda abierta
export function descartarSiVacia(cid) {
  const c = S.comandas.find((x) => x.id === cid);
  if (!c || c.tipo !== "mostrador" || itemsDe(cid).length) return;
  db.update("comandas", cid, { estado: "anulada", cerrada: Date.now(), motivo: "Sin consumo", cerradaPor: S.perfil.nombre });
}

// ── Entregar / salió ──
// Marca como entregado lo que está listo. En un delivery sin cobrar, queda "en camino".
export function entregarPedido(comandaId) {
  const its = S.items.filter((i) => i.comandaId === comandaId && i.estado === "listo");
  const t = Date.now();
  const ops = its.map((i) => ({ op: "update", col: "items", id: i.id, data: { estado: "entregado", entregadoTs: t, ...(i.comandaCerrada ? { cerrado: true } : {}) } }));
  const c = S.comandas.find((x) => x.id === comandaId);
  if (c?.tipo === "delivery") ops.push({ op: "update", col: "comandas", id: comandaId, data: { salio: t } });
  if (ops.length) db.batch(ops);
  return its[0]?.tipo || c?.tipo || "";
}

// ── WhatsApp al cliente ──
export function mensajesPedido(c) {
  const n = (c.cliente?.nombre || "").split(" ")[0];
  const neg = S.config.nombre || "A&F";
  const its = vigentes(itemsDe(c.id));
  const total = totalItems(itemsDe(c.id));
  const detalle = its.filter((i) => i.productoId !== "envio").map((i) => `${i.cant}× ${i.desc}`).join(", ");
  const dir = S.config.direccion ? ` en ${S.config.direccion}` : "";
  const r = [];
  r.push({ k: "recibido", t: "Pedido recibido", txt: `¡Hola ${n}! Recibimos tu pedido en ${neg}${detalle ? `: ${detalle}` : ""}. Total: ${fmt(total)}.${c.hora ? ` ${c.tipo === "delivery" ? "Te lo llevamos" : "Va a estar listo"} a las ${c.hora} h.` : ""} ¡Gracias!` });
  if (c.tipo === "delivery") r.push({ k: "camino", t: "Va en camino", txt: `¡Hola ${n}! Tu pedido de ${neg} ya salió y va en camino. Total: ${fmt(total)}. ¡Que lo disfrutes!` });
  else r.push({ k: "listo", t: "Está listo para retirar", txt: `¡Hola ${n}! Tu pedido de ${neg} ya está listo para retirar${dir}. ¡Te esperamos!` });
  return r;
}

// ── Avisar al cadete (propio, del barrio o una cadetería) ──
// Le manda por WhatsApp a quién entregar, la dirección y cuánto cobrar.
// Sin número cargado, WhatsApp deja elegir el contacto.
export function mensajeCadete(c) {
  const cli = c.cliente || {};
  const neg = S.config.nombre || "A&F";
  const total = totalItems(itemsDe(c.id));
  const its = vigentes(itemsDe(c.id)).filter((i) => i.productoId !== "envio");
  const bultos = its.reduce((s, i) => s + i.cant, 0);
  return [
    `Envío de ${neg}`,
    `Retirar en: ${S.config.direccion || neg}`,
    `Entregar a: ${cli.nombre || "Sin nombre"}${cli.telefono ? ` · ${cli.telefono}` : ""}`,
    `Dirección: ${cli.direccion || "(a confirmar)"}`,
    `Hora: ${c.hora ? `${c.hora} h` : "lo antes posible"}`,
    cli.nota ? `Nota: ${cli.nota}` : "",
    bultos ? `Lleva: ${bultos} producto${bultos === 1 ? "" : "s"}` : "",
    cli.pago === "pagado" ? "Ya está pagado: no cobrar." : `Cobrar: ${fmt(total)}`,
  ].filter(Boolean).join("\n");
}

export function avisarCadete(c) {
  if (c?.tipo !== "delivery") return;
  const num = S.config.cadeteWa;
  const txt = mensajeCadete(c);
  window.open(num && waLink(num) ? waLink(num, txt) : "https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener");
  log("pedido", `Aviso al cadete${S.config.cadeteNombre ? ` (${S.config.cadeteNombre})` : ""}: ${c.cliente?.nombre || ""}`, { comandaId: c.id });
}

export function whatsappPedido(c) {
  if (!c?.cliente?.telefono || !waLink(c.cliente.telefono)) return toast("El pedido no tiene un teléfono válido", "error");
  const m = modal({
    titulo: `WhatsApp a ${c.cliente.nombre}`,
    clase: "modal-chico",
    cuerpo: `<div class="menu-lista">${mensajesPedido(c).map((x) => `<button data-k="${x.k}">${iconoContacto("whatsapp", 18)} <span><b>${esc(x.t)}</b><small>${esc(x.txt)}</small></span></button>`).join("")}</div>`,
  });
  m.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    const x = mensajesPedido(c).find((y) => y.k === b.dataset.k);
    window.open(waLink(c.cliente.telefono, x.txt), "_blank", "noopener");
    m.cerrar();
  });
}
