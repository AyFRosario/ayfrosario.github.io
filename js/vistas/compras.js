// ============================================================
//  A&F · Compras y proveedores
// ============================================================
// Una compra suma stock a los insumos (y actualiza su costo) y a los
// productos que controlan stock (bebidas, etc.). Se paga con efectivo
// de la caja (queda como gasto en el arqueo), con otro medio, o queda
// debiendo: la deuda se acumula en el proveedor, como una cuenta
// corriente. Los pagos al proveedor van en la misma colección.
import { S, UNIDADES, fmtCantidad, fechaStr, deFechaStr, productoPorCodigo, waLink, log } from "../store.js";
import { db, inc } from "../db.js";
import { esc, fmt, num, fecha, icon, modal, toast, confirmar } from "../util.js";
import { buscar } from "../buscar.js";
import { abrirEscaner } from "../scanner.js";

export const PAGOS_COMPRA = { caja: "Efectivo de la caja", otro: "Transferencia u otro medio", debe: "Queda debiendo" };
let proveedores = [];

export function mount(root, { param } = {}) {
  let tab = param === "proveedores" ? "proveedores" : "compras";
  let compras = [];
  const subs = [];

  root.innerHTML = `
    <div class="compras">
      <div class="segmentado pestanas" id="cTabs"><button data-tab="compras">Compras</button><button data-tab="proveedores">Proveedores</button></div>
      <div class="kpis dos" id="cpKpis"></div>
      <div class="barra-acciones"><span></span><div class="prod-botones" id="cpBotones"></div></div>
      <div id="cpLista"></div>
    </div>`;

  subs.push(db.listen("proveedores", {}, (a) => { proveedores = a.sort((x, y) => x.nombre.localeCompare(y.nombre, "es")); render(); }));
  subs.push(db.listen("compras", { orderBy: ["ts", "desc"], limit: 200 }, (a) => { compras = a; render(); }));

  function render() {
    root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("activo", b.dataset.tab === tab));
    const deuda = proveedores.reduce((s, p) => s + Math.max(0, Number(p.deuda) || 0), 0);
    const desde = Date.now() - 30 * 86400000;
    const mes = compras.filter((c) => c.tipo !== "pago" && c.estado !== "anulada" && c.ts >= desde).reduce((s, c) => s + (c.total || 0), 0);
    root.querySelector("#cpKpis").innerHTML = `
      <div class="kpi"><small>Compras · últimos 30 días</small><b>${fmt(mes)}</b></div>
      <div class="kpi"><small>Le debés a proveedores</small><b>${fmt(deuda)}</b><span>${proveedores.filter((p) => (Number(p.deuda) || 0) > 0).length} con saldo</span></div>`;
    root.querySelector("#cpBotones").innerHTML = tab === "compras"
      ? `<button class="btn btn-pri" data-act="compra">${icon("mas")} Compra</button>`
      : `<button class="btn btn-pri" data-act="proveedor">${icon("mas")} Proveedor</button>`;
    const cont = root.querySelector("#cpLista");
    if (tab === "compras") {
      cont.innerHTML = compras.length ? `<div class="lista">${compras.map(filaCompra).join("")}</div>`
        : `<div class="vacio">${icon("camion")}<p>Todavía no hay compras cargadas.<br>Cada compra suma stock a los insumos y a las bebidas.</p><button class="btn btn-pri" data-act="compra">${icon("mas")} Cargar la primera</button></div>`;
    } else {
      cont.innerHTML = proveedores.length ? `<div class="tabla-prod">${proveedores.map((p) => {
        const d = Number(p.deuda) || 0;
        return `<button class="fila-prod" data-prov="${esc(p.id)}"><span class="fp-nom"><b>${esc(p.nombre)}</b><small>${esc(p.rubro || p.telefono || "")}</small></span><span></span>
          <b class="fp-precio ${d > 0 ? "neg" : ""}">${d > 0 ? `Le debés ${fmt(d)}` : d < 0 ? `A favor ${fmt(-d)}` : "Al día"}</b></button>`;
      }).join("")}</div>` : `<div class="vacio">${icon("camion")}<p>Cargá los proveedores (carnicería, verdulería, distribuidora de bebidas…).</p></div>`;
    }
  }

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; history.replaceState(null, "", "#/compras" + (tab === "proveedores" ? "/proveedores" : "")); render(); return; }
    const a = e.target.closest("[data-act]");
    if (a?.dataset.act === "compra") return nuevaCompra();
    if (a?.dataset.act === "proveedor") return editarProveedor();
    const c = e.target.closest("[data-compra]");
    if (c) return verCompra(compras.find((x) => x.id === c.dataset.compra));
    const p = e.target.closest("[data-prov]");
    if (p) return verProveedor(proveedores.find((x) => x.id === p.dataset.prov));
  });
  render();
  return { unmount() { subs.forEach((u) => u()); } };
}

function filaCompra(c) {
  const anulada = c.estado === "anulada";
  if (c.tipo === "pago") return `<button class="fila-lista boton ${anulada ? "anulada" : ""}" data-compra="${esc(c.id)}"><div><b>Pago a ${esc(c.proveedorNombre || "proveedor")}</b><small>${fecha(c.ts)} · ${esc(PAGOS_COMPRA[c.pago] || "")}</small></div><span class="pos">${fmt(c.total)}</span></button>`;
  return `<button class="fila-lista boton ${anulada ? "anulada" : ""}" data-compra="${esc(c.id)}">
    <div><b>${esc(c.proveedorNombre || "Sin proveedor")}</b><small>${fecha(c.ts)} · ${(c.lineas || []).length} ítem${(c.lineas || []).length === 1 ? "" : "s"}${c.comprobante ? ` · ${esc(c.comprobante)}` : ""} · ${anulada ? "Anulada" : esc(PAGOS_COMPRA[c.pago] || "")}</small></div>
    <span class="${c.pago === "debe" && !anulada ? "neg" : ""}">${fmt(c.total)}</span></button>`;
}

// ── Proveedores ──
export function editarProveedor(p = null, alCrear) {
  const nuevo = !p;
  p = p || { nombre: "", rubro: "", telefono: "", nota: "" };
  const m = modal({
    titulo: nuevo ? "Nuevo proveedor" : "Editar proveedor",
    clase: "modal-chico",
    cuerpo: `<form class="form" id="fProv">
      <label class="campo"><span>Nombre</span><input class="input" id="pvNom" value="${esc(p.nombre)}" required autofocus></label>
      <label class="campo"><span>Rubro</span><input class="input" id="pvRubro" value="${esc(p.rubro || "")}" placeholder="Carnicería, bebidas, verdulería…"></label>
      <label class="campo"><span>Teléfono / WhatsApp</span><input class="input" id="pvTel" inputmode="tel" value="${esc(p.telefono || "")}"></label>
      <label class="campo"><span>Nota</span><input class="input" id="pvNota" value="${esc(p.nota || "")}" placeholder="Días de entrega, CBU/alias…"></label>
    </form>`,
    pie: `${!nuevo ? `<button type="button" class="btn" data-borrar>${icon("basura")}</button>` : ""}<button type="submit" form="fProv" class="btn btn-pri">${nuevo ? "Crear" : "Guardar"}</button>`,
  });
  const $ = (s) => m.el.querySelector(s);
  $("#fProv").onsubmit = (e) => {
    e.preventDefault();
    const datos = { nombre: $("#pvNom").value.trim(), rubro: $("#pvRubro").value.trim(), telefono: $("#pvTel").value.trim(), nota: $("#pvNota").value.trim() };
    if (!datos.nombre) return;
    if (nuevo) { const id = db.add("proveedores", { ...datos, deuda: 0, creado: Date.now() }); alCrear?.({ id, ...datos, deuda: 0 }); }
    else db.update("proveedores", p.id, datos);
    m.cerrar();
  };
  const b = m.el.querySelector("[data-borrar]");
  if (b) b.onclick = async () => {
    if ((Number(p.deuda) || 0) !== 0) return toast("Tiene saldo: primero dejalo en cero", "error");
    if (!(await confirmar(`¿Borrar a ${p.nombre}? Las compras pasadas quedan registradas.`, { ok: "Borrar", peligro: true }))) return;
    db.remove("proveedores", p.id);
    m.cerrar();
  };
}

function verProveedor(p) {
  if (!p) return;
  let soltar = null;
  const m = modal({
    titulo: p.nombre,
    cuerpo: `<div id="vpCab"></div><h4 class="subtitulo">Movimientos</h4><div class="lista" id="vpMovs"><p class="ayuda">Cargando…</p></div>`,
    pie: `<button class="btn" data-a="editar">${icon("nota")}</button>${p.telefono ? `<button class="btn" data-a="wa">WhatsApp</button>` : ""}
      <button class="btn" data-a="compra">${icon("mas")} Compra</button><button class="btn btn-pri" data-a="pago">${icon("dinero")} Pagar</button>`,
    onClose: () => soltar?.(),
  });
  const actual = () => proveedores.find((x) => x.id === p.id) || p;
  const cab = () => {
    const d = Number(actual().deuda) || 0;
    m.el.querySelector("#vpCab").innerHTML = `<div class="saldo-cli ${d > 0 ? "debe" : ""}"><small>${d > 0 ? "Le debés" : d < 0 ? "Saldo a favor" : "Saldo"}</small><b>${fmt(Math.abs(d))}</b></div>
      <p class="ayuda">${esc([actual().rubro, actual().telefono, actual().nota].filter(Boolean).join(" · "))}</p>`;
  };
  cab();
  soltar = db.listen("compras", { where: [["proveedorId", "==", p.id]] }, (a) => {
    cab();
    a.sort((x, y) => y.ts - x.ts);
    m.el.querySelector("#vpMovs").innerHTML = a.length ? a.slice(0, 60).map(filaCompra).join("") : `<p class="ayuda">Sin compras todavía.</p>`;
  });
  m.el.addEventListener("click", (e) => {
    const c = e.target.closest("[data-compra]");
    if (c) db.get("compras", c.dataset.compra).then((x) => x && verCompra(x));
  });
  m.el.querySelector('[data-a="editar"]').onclick = () => { m.cerrar(); editarProveedor(actual()); };
  m.el.querySelector('[data-a="compra"]').onclick = () => { m.cerrar(); nuevaCompra(actual()); };
  m.el.querySelector('[data-a="pago"]').onclick = () => pagarProveedor(actual());
  const wa = m.el.querySelector('[data-a="wa"]');
  if (wa) wa.onclick = () => { const u = waLink(actual().telefono); if (u) window.open(u, "_blank", "noopener"); else toast("Teléfono no válido", "error"); };
}

function selectorPago(id, valor = "caja") {
  return `<div class="segmentado ancho" id="${id}">${Object.entries(PAGOS_COMPRA).map(([k, v]) => `<button type="button" data-pago="${k}" class="${k === valor ? "activo" : ""}">${v.replace("Transferencia u otro medio", "Transf. / otro")}</button>`).join("")}</div>`;
}

function pagarProveedor(p) {
  const d = Number(p.deuda) || 0;
  let pago = S.jornada ? "caja" : "otro";
  const m = modal({
    titulo: `Pago a ${p.nombre}`,
    clase: "modal-chico",
    cuerpo: `<form class="form" id="fPP">
      <label class="campo"><span>Monto</span><input class="input grande" id="ppMonto" inputmode="decimal" value="${d > 0 ? Math.round(d) : ""}" required autofocus></label>
      <div class="campo"><span>¿Cómo le pagás?</span>${selectorPago("ppPago", pago).replace(/<button[^>]*data-pago="debe"[^>]*>[^<]*<\/button>/, "")}</div>
      <p class="ayuda" id="ppAyuda"></p>
    </form>`,
    pie: `<button type="submit" form="fPP" class="btn btn-pri btn-bloque">Registrar pago</button>`,
  });
  const ayuda = () => { m.el.querySelector("#ppAyuda").textContent = pago === "caja" ? (S.jornada ? "Sale de la caja abierta como gasto." : "La caja está cerrada: abrila o elegí otro medio.") : ""; };
  m.el.querySelector("#ppPago").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pago]"); if (!b) return;
    pago = b.dataset.pago;
    m.el.querySelectorAll("#ppPago [data-pago]").forEach((x) => x.classList.toggle("activo", x === b));
    ayuda();
  });
  ayuda();
  m.el.querySelector("#fPP").onsubmit = (e) => {
    e.preventDefault();
    const monto = Math.round(num(m.el.querySelector("#ppMonto").value));
    if (!(monto > 0)) return toast("Ingresá un monto", "error");
    if (pago === "caja" && !S.jornada) return toast("La caja está cerrada", "error");
    const t = Date.now();
    const id = db.newId("compras");
    const ops = [
      { op: "set", col: "compras", id, data: { tipo: "pago", proveedorId: p.id, proveedorNombre: p.nombre, total: monto, pago, ts: t, fecha: fechaStr(t), usuario: S.perfil.nombre, estado: "ok", jornadaId: S.jornada?.id || "" } },
      { op: "update", col: "proveedores", id: p.id, data: { deuda: inc(-monto) } },
    ];
    if (pago === "caja") { const mc = db.newId("movCaja"); ops[0].data.movCajaId = mc; ops.push({ op: "set", col: "movCaja", id: mc, data: { jornadaId: S.jornada.id, tipo: "gasto", monto, desc: `Pago a ${p.nombre}`, medio: "efectivo", ts: t, usuario: S.perfil.nombre, compraId: id } }); }
    db.batch(ops);
    log("compra", `Pago a ${p.nombre}: ${fmt(monto)} (${PAGOS_COMPRA[pago]})`);
    toast(`Pago registrado: ${fmt(monto)}`);
    m.cerrar();
  };
}

// ── Nueva compra ──
function itemsComprables() {
  const ins = S.insumos.map((i) => ({ tipo: "insumo", id: i.id, nombre: i.nombre, unidad: i.unidad, costo: i.costo || 0, stock: i.stock }));
  const prods = S.productos.filter((p) => p.controlStock).map((p) => ({ tipo: "producto", id: p.id, nombre: p.nombre, unidad: "u", costo: p.costo || 0, stock: p.stock }));
  return [...ins, ...prods];
}

export function nuevaCompra(provInicial = null) {
  let prov = provInicial;
  let pago = S.jornada ? "caja" : "otro";
  const lineas = [];
  const m = modal({
    titulo: "Nueva compra",
    clase: "modal-grande",
    cuerpo: `<form class="form" id="fCompra">
      <div class="dos-col">
        <div class="campo"><span>Proveedor</span><button type="button" class="input selector" id="ncProv"></button></div>
        <label class="campo"><span>Fecha</span><input class="input" type="date" id="ncFecha" value="${fechaStr()}"></label>
      </div>
      <div class="campo"><span>Qué entró</span>
        <div class="nc-agregar"><div class="input-icono">${icon("buscar")}<input class="input" id="ncBus" placeholder="Insumo o bebida…" autocomplete="off"></div><button type="button" class="btn" data-a="scan" aria-label="Escanear">${icon("scan")}</button></div>
        <div class="lista sugerencias" id="ncSug"></div>
        <div id="ncLineas"></div>
      </div>
      <div class="nc-total"><span>Total</span><b id="ncTotal">$ 0</b></div>
      <div class="campo"><span>¿Cómo se paga?</span>${selectorPago("ncPago", pago)}<small class="ayuda" id="ncAyuda"></small></div>
      <label class="campo"><span>Factura / remito (opcional)</span><input class="input" id="ncComp" placeholder="Ej: FC A 0003-00012345"></label>
    </form>`,
    pie: `<button type="submit" form="fCompra" class="btn btn-pri btn-bloque">Guardar compra</button>`,
  });
  const $ = (s) => m.el.querySelector(s);

  const pintarProv = () => { $("#ncProv").innerHTML = prov ? `<b>${esc(prov.nombre)}</b>` : `<span class="ayuda">Elegir proveedor (opcional)</span>`; };
  const ayuda = () => {
    $("#ncAyuda").textContent = pago === "caja" ? (S.jornada ? "Sale de la caja abierta como gasto." : "La caja está cerrada: abrila o elegí otro medio.")
      : pago === "debe" ? (prov ? `Se suma a lo que le debés a ${prov.nombre}.` : "Para dejar debiendo, elegí el proveedor.") : "No toca la caja.";
  };
  const total = () => lineas.reduce((s, l) => s + Math.round((l.cant || 0) * (l.costo || 0)), 0);
  function pintarLineas() {
    $("#ncLineas").innerHTML = lineas.length ? `<div class="nc-cab"><span>Ítem</span><span>Cantidad</span><span>Costo unit.</span><span>Subtotal</span><span></span></div>` + lineas.map((l, k) => `
      <div class="nc-linea">
        <span class="nc-nom"><b>${esc(l.nombre)}</b><small>${l.tipo === "insumo" ? "Insumo" : "Producto"} · hay ${fmtCantidad(l.stock, l.unidad)}</small></span>
        <label class="nc-cant"><input class="input" data-lc="${k}" inputmode="decimal" value="${l.cant ? String(l.cant).replace(".", ",") : ""}" placeholder="0"><small>${esc(UNIDADES[l.unidad] || l.unidad)}</small></label>
        <input class="input" data-lp="${k}" inputmode="decimal" value="${l.costo ? Math.round(l.costo) : ""}" placeholder="$ por ${esc(UNIDADES[l.unidad] || l.unidad)}">
        <span class="nc-sub" data-ls="${k}">${fmt((l.cant || 0) * (l.costo || 0))}</span>
        <button type="button" class="btn-icono" data-lx="${k}" aria-label="Quitar">${icon("x")}</button>
      </div>`).join("") : `<p class="ayuda">Buscá o escaneá lo que llegó. Los insumos se cargan en Productos → Insumos; las bebidas y otros productos, si controlan stock.</p>`;
    $("#ncTotal").textContent = fmt(total());
  }
  function sugerir() {
    const q = $("#ncBus").value.trim();
    if (!q) { $("#ncSug").innerHTML = ""; return; }
    const l = buscar(itemsComprables(), q).slice(0, 8);
    $("#ncSug").innerHTML = l.map((x) => `<button type="button" class="fila-lista boton" data-it="${x.tipo}:${esc(x.id)}"><div><b>${esc(x.nombre)}</b><small>${x.tipo === "insumo" ? "Insumo" : "Producto"} · hay ${fmtCantidad(x.stock, x.unidad)}</small></div>${icon("mas")}</button>`).join("") || `<p class="ayuda">Nada coincide con "${esc(q)}".</p>`;
  }
  function agregar(x, cant = 0) {
    const ya = lineas.find((l) => l.tipo === x.tipo && l.id === x.id);
    if (ya) { if (cant) ya.cant = (ya.cant || 0) + cant; }
    else lineas.push({ ...x, cant });
    $("#ncBus").value = "";
    sugerir();
    pintarLineas();
    const k = lineas.findIndex((l) => l.tipo === x.tipo && l.id === x.id);
    if (!cant) setTimeout(() => m.el.querySelector(`[data-lc="${k}"]`)?.focus(), 30);
  }

  $("#ncBus").addEventListener("input", sugerir);
  $("#ncBus").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); m.el.querySelector("#ncSug [data-it]")?.click(); } });
  m.el.addEventListener("click", async (e) => {
    const it = e.target.closest("[data-it]");
    if (it) { const [tipo, id] = it.dataset.it.split(":"); const x = itemsComprables().find((y) => y.tipo === tipo && y.id === id); if (x) agregar(x); return; }
    const lx = e.target.closest("[data-lx]");
    if (lx) { lineas.splice(Number(lx.dataset.lx), 1); pintarLineas(); return; }
    const pg = e.target.closest("#ncPago [data-pago]");
    if (pg) { pago = pg.dataset.pago; m.el.querySelectorAll("#ncPago [data-pago]").forEach((b) => b.classList.toggle("activo", b === pg)); ayuda(); return; }
    if (e.target.closest("#ncProv")) return elegirProveedor((p) => { prov = p; pintarProv(); ayuda(); });
    if (e.target.closest('[data-a="scan"]')) {
      const cod = await abrirEscaner({ titulo: "Escaneá el producto" });
      if (!cod) return;
      const p = productoPorCodigo(cod);
      if (!p) return toast(`El código ${cod} no está asignado a ningún producto`, "error");
      if (!p.controlStock) db.update("productos", p.id, { controlStock: true, stock: Number(p.stock) || 0 });
      agregar({ tipo: "producto", id: p.id, nombre: p.nombre, unidad: "u", costo: p.costo || 0, stock: p.stock || 0 }, 1);
    }
  });
  m.el.addEventListener("input", (e) => {
    const c = e.target.dataset.lc, p = e.target.dataset.lp;
    if (c !== undefined) lineas[Number(c)].cant = num(e.target.value);
    if (p !== undefined) lineas[Number(p)].costo = num(e.target.value);
    const k = Number(c ?? p);
    if (c !== undefined || p !== undefined) { m.el.querySelector(`[data-ls="${k}"]`).textContent = fmt((lineas[k].cant || 0) * (lineas[k].costo || 0)); $("#ncTotal").textContent = fmt(total()); }
  });

  $("#fCompra").onsubmit = async (e) => {
    e.preventDefault();
    const validas = lineas.filter((l) => l.cant > 0);
    if (!validas.length) return toast("Agregá al menos un ítem con cantidad", "error");
    if (pago === "debe" && !prov) return toast("Para dejar debiendo, elegí el proveedor", "error");
    if (pago === "caja" && !S.jornada) return toast("La caja está cerrada: elegí otro medio", "error");
    const sinCosto = validas.filter((l) => !(l.costo > 0));
    if (sinCosto.length && !(await confirmar(`${sinCosto.map((l) => l.nombre).join(", ")} no tiene${sinCosto.length > 1 ? "n" : ""} costo. ¿Guardar igual?`, { ok: "Guardar" }))) return;
    const f = $("#ncFecha").value || fechaStr();
    const ts = f === fechaStr() ? Date.now() : deFechaStr(f, "12:00");
    const tot = validas.reduce((s, l) => s + Math.round(l.cant * (l.costo || 0)), 0);
    const id = db.newId("compras");
    const compra = {
      tipo: "compra", proveedorId: prov?.id || "", proveedorNombre: prov?.nombre || "", fecha: f, ts, creada: Date.now(),
      lineas: validas.map((l) => ({ tipo: l.tipo, id: l.id, nombre: l.nombre, unidad: l.unidad, cant: l.cant, costo: Math.round(l.costo || 0) })),
      total: tot, pago, comprobante: $("#ncComp").value.trim(), usuario: S.perfil.nombre, estado: "ok", jornadaId: S.jornada?.id || "",
    };
    const ops = [];
    for (const l of validas) {
      const data = l.tipo === "insumo" ? { stock: inc(l.cant) } : { stock: inc(l.cant), controlStock: true };
      if (l.costo > 0) data.costo = Math.round(l.costo);
      ops.push({ op: "update", col: l.tipo === "insumo" ? "insumos" : "productos", id: l.id, data });
    }
    if (pago === "debe") ops.push({ op: "update", col: "proveedores", id: prov.id, data: { deuda: inc(tot) } });
    if (pago === "caja" && tot > 0) {
      compra.movCajaId = db.newId("movCaja");
      ops.push({ op: "set", col: "movCaja", id: compra.movCajaId, data: { jornadaId: S.jornada.id, tipo: "gasto", monto: tot, desc: `Compra${prov ? ` a ${prov.nombre}` : ""}`, medio: "efectivo", ts: Date.now(), usuario: S.perfil.nombre, compraId: id } });
    }
    ops.unshift({ op: "set", col: "compras", id, data: compra });
    db.batch(ops);
    log("compra", `Compra${prov ? ` a ${prov.nombre}` : ""}: ${fmt(tot)} (${PAGOS_COMPRA[pago]}) — ${validas.map((l) => `${l.nombre} +${fmtCantidad(l.cant, l.unidad)}`).join(", ")}`);
    toast(`Compra guardada · stock actualizado`);
    m.cerrar();
  };
  pintarProv();
  pintarLineas();
  ayuda();
}

function elegirProveedor(alElegir) {
  const m = modal({
    titulo: "Proveedor",
    clase: "modal-chico",
    cuerpo: `<div class="lista">${proveedores.map((p) => `<button class="fila-lista boton" data-p="${esc(p.id)}"><div><b>${esc(p.nombre)}</b><small>${esc(p.rubro || "")}</small></div></button>`).join("") || `<p class="ayuda">Todavía no hay proveedores.</p>`}</div>`,
    pie: `<button class="btn" data-sin>Sin proveedor</button><button class="btn btn-pri" data-nuevo>${icon("mas")} Nuevo</button>`,
  });
  m.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b) { m.cerrar(); alElegir(proveedores.find((p) => p.id === b.dataset.p)); }
    if (e.target.closest("[data-sin]")) { m.cerrar(); alElegir(null); }
    if (e.target.closest("[data-nuevo]")) { m.cerrar(); editarProveedor(null, alElegir); }
  });
}

function verCompra(c) {
  if (!c) return;
  const anulada = c.estado === "anulada";
  const esPago = c.tipo === "pago";
  const m = modal({
    titulo: esPago ? `Pago a ${c.proveedorNombre}` : `Compra${c.proveedorNombre ? ` a ${c.proveedorNombre}` : ""}`,
    cuerpo: `<p class="ayuda">${fecha(c.ts)} · ${esc(PAGOS_COMPRA[c.pago] || "")} · cargó ${esc(c.usuario || "")}${c.comprobante ? ` · ${esc(c.comprobante)}` : ""}${anulada ? ` · <b class="neg">Anulada</b>` : ""}</p>
      ${esPago ? "" : (c.lineas || []).map((l) => `<div class="co-linea"><span>${esc(l.nombre)} · ${fmtCantidad(l.cant, l.unidad)}${l.costo ? ` × ${fmt(l.costo)}` : ""}</span><span>${fmt(l.cant * (l.costo || 0))}</span></div>`).join("")}
      <div class="co-linea total"><span>Total</span><b>${fmt(c.total)}</b></div>`,
    pie: anulada ? "" : `<button class="btn btn-peligro" data-anular>${icon("x")} Anular</button>`,
  });
  const b = m.el.querySelector("[data-anular]");
  if (b) b.onclick = async () => {
    const mismaCaja = c.movCajaId && S.jornada?.id === c.jornadaId;
    const aviso = esPago ? `Se vuelve a sumar ${fmt(c.total)} a la deuda con ${c.proveedorNombre}.`
      : `Se descuenta del stock lo que entró${c.pago === "debe" ? ` y se resta ${fmt(c.total)} de la deuda` : ""}.`;
    const caja = c.pago === "caja" ? (mismaCaja ? " El gasto se quita de la caja abierta." : " Ojo: la caja de ese día ya se cerró, el gasto queda en ese arqueo.") : "";
    if (!(await confirmar(aviso + caja, { titulo: "Anular", ok: "Anular", peligro: true }))) return;
    const ops = [{ op: "update", col: "compras", id: c.id, data: { estado: "anulada", anuladaPor: S.perfil.nombre, anuladaTs: Date.now() } }];
    if (esPago) ops.push({ op: "update", col: "proveedores", id: c.proveedorId, data: { deuda: inc(c.total) } });
    else {
      for (const l of c.lineas || []) {
        const existe = l.tipo === "insumo" ? S.insumos.some((i) => i.id === l.id) : S.productos.some((p) => p.id === l.id);
        if (existe) ops.push({ op: "update", col: l.tipo === "insumo" ? "insumos" : "productos", id: l.id, data: { stock: inc(-l.cant) } });
      }
      if (c.pago === "debe" && c.proveedorId) ops.push({ op: "update", col: "proveedores", id: c.proveedorId, data: { deuda: inc(-c.total) } });
    }
    if (mismaCaja) ops.push({ op: "delete", col: "movCaja", id: c.movCajaId });
    db.batch(ops);
    log("compra", `${esPago ? "Pago" : "Compra"} anulado: ${c.proveedorNombre || ""} ${fmt(c.total)}`);
    toast("Anulado");
    m.cerrar();
  };
}
