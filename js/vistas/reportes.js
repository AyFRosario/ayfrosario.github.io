// ============================================================
//  A&F · Reportes
// ============================================================
// Ventas por período con comparación contra el período anterior,
// por día, por hora de llegada, por medio de pago, por categoría,
// productos más vendidos y rendimiento por mozo. Exporta a Excel.
//
// El "día comercial" empieza a las 6 de la mañana: lo que se vende
// a las 2 de la madrugada cuenta para la noche anterior.
import { S, MEDIOS, turnosCaja, turnoDeVenta } from "../store.js";
import { db } from "../db.js";
import { esc, fmt, fmtNum, icon, toast } from "../util.js";
import { cargarXLSX } from "../importar.js";

export const CORTE = 6; // hora en que empieza el día comercial
const DIA = 86400000;
const PERIODOS = { jornada: "Última jornada", semana: "Últimos 7 días", mes: "Este mes", mesAnt: "Mes anterior", rango: "Elegir fechas" };
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function inicioDia(d) {
  const x = new Date(d);
  if (x.getHours() < CORTE) x.setDate(x.getDate() - 1);
  x.setHours(CORTE, 0, 0, 0);
  return x.getTime();
}
const diaComercial = (ts) => inicioDia(ts);
const etiquetaDia = (t) => { const d = new Date(t); return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
const aInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const deInput = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, CORTE).getTime(); };

async function rangos(tipo, desdeTxt, hastaTxt) {
  const ahora = Date.now();
  const hoy = inicioDia(ahora);
  if (tipo === "jornada") {
    const j = S.jornada || (await db.query("jornadas", { orderBy: ["aperturaTs", "desc"], limit: 1 }))[0];
    if (!j) return null;
    const hasta = j.cierreTs || ahora;
    const largo = hasta - j.aperturaTs;
    return { desde: j.aperturaTs, hasta, prev: [j.aperturaTs - 7 * DIA, j.aperturaTs - 7 * DIA + largo], vs: j.turno ? `el mismo turno (${j.turno.nombre}) de la semana pasada` : "misma noche de la semana pasada", jornadaId: j.id };
  }
  if (tipo === "semana") {
    const desde = hoy - 6 * DIA;
    return { desde, hasta: ahora, prev: [desde - 7 * DIA, ahora - 7 * DIA], vs: "los 7 días anteriores" };
  }
  const primero = (y, m) => new Date(y, m, 1, CORTE).getTime();
  const h = new Date(ahora - CORTE * 3600000);
  if (tipo === "mes") {
    const desde = primero(h.getFullYear(), h.getMonth());
    const pDesde = primero(h.getFullYear(), h.getMonth() - 1);
    return { desde, hasta: ahora, prev: [pDesde, Math.min(pDesde + (ahora - desde), desde)], vs: "el mismo tramo del mes pasado" };
  }
  if (tipo === "mesAnt") {
    const desde = primero(h.getFullYear(), h.getMonth() - 1);
    const hasta = primero(h.getFullYear(), h.getMonth());
    return { desde, hasta, prev: [primero(h.getFullYear(), h.getMonth() - 2), desde], vs: "el mes anterior" };
  }
  // rango elegido
  const desde = deInput(desdeTxt);
  const hasta = deInput(hastaTxt) + DIA;
  if (!(hasta > desde)) return null;
  return { desde, hasta, prev: [desde - (hasta - desde), desde], vs: "el período anterior de igual largo" };
}

const TIPOS_VENTA = { mesa: "Mesas", llevar: "Para llevar", delivery: "Delivery", mostrador: "Venta rápida" };

function analizar(ventas) {
  const ok = ventas.filter((v) => v.estado !== "anulada");
  const r = {
    total: 0, cant: ok.length, comensales: 0, descuentos: 0, propinas: 0,
    anuladas: ventas.length - ok.length, montoAnulado: 0,
    porMedio: {}, porDia: new Map(), porHora: new Map(), porMozo: new Map(), productos: new Map(), porCat: new Map(),
    porTipo: new Map(), totalMesas: 0, porTurno: new Map(),
  };
  for (const v of ventas) if (v.estado === "anulada") r.montoAnulado += v.total || 0;
  const catDe = new Map(S.productos.map((p) => [p.id, p.categoria || "Otros"]));
  for (const v of ok) {
    r.total += v.total || 0;
    const tipo = TIPOS_VENTA[v.tipo] ? v.tipo : "mesa";
    const tn = turnoDeVenta(v);
    if (tn) { const x = r.porTurno.get(tn) || { total: 0, cant: 0 }; x.total += v.total || 0; x.cant++; r.porTurno.set(tn, x); }
    const pt = r.porTipo.get(tipo) || { total: 0, cant: 0 };
    pt.total += v.total || 0; pt.cant++;
    r.porTipo.set(tipo, pt);
    // El gasto por persona sale solo de las mesas (un pedido no tiene comensales)
    if (tipo === "mesa") { r.comensales += Number(v.comensales) || 0; r.totalMesas += v.total || 0; }
    r.descuentos += v.descuento?.monto || 0;
    for (const p of v.pagos || []) r.porMedio[p.medio] = (r.porMedio[p.medio] || 0) + (p.monto || 0);
    // La propina se cobra junto con la cuenta pero no es venta: se descuenta del medio en que entró
    const prop = Number(v.propina) || 0;
    if (prop) {
      r.propinas += prop;
      const mp = r.porMedio[v.propinaMedio] != null ? v.propinaMedio : Object.keys(r.porMedio)[0];
      if (mp) r.porMedio[mp] -= prop;
    }
    const d = diaComercial(v.ts);
    const pd = r.porDia.get(d) || { total: 0, cant: 0 };
    pd.total += v.total || 0; pd.cant++;
    r.porDia.set(d, pd);
    const hLlegada = new Date(v.abierta || v.ts).getHours();
    r.porHora.set(hLlegada, (r.porHora.get(hLlegada) || 0) + 1);
    const m = r.porMozo.get(v.mozo || "—") || { mesas: 0, total: 0, comensales: 0, propinas: 0 };
    m.mesas++; m.total += v.total || 0; m.comensales += Number(v.comensales) || 0; m.propinas += prop;
    r.porMozo.set(v.mozo || "—", m);
    for (const it of v.items || []) {
      const imp = (it.precio || 0) * (it.cant || 0);
      const k = it.productoId || it.desc;
      const pr = r.productos.get(k) || { desc: it.desc, cat: catDe.get(it.productoId) || "Otros", cant: 0, importe: 0 };
      pr.cant += it.cant || 0; pr.importe += imp;
      r.productos.set(k, pr);
      r.porCat.set(pr.cat, (r.porCat.get(pr.cat) || 0) + imp);
    }
  }
  for (const k of Object.keys(r.porMedio)) if (r.porMedio[k] <= 0) delete r.porMedio[k];
  r.promedio = r.cant ? r.total / r.cant : 0;
  r.porPersona = r.comensales ? r.totalMesas / r.comensales : 0;
  return r;
}

// ── Piezas de gráfico (barras finas, un solo color, valores en el tooltip) ──
function columnas(datos, { alto = 150, etiquetaCada = 1 } = {}) {
  const max = Math.max(1, ...datos.map((d) => d.v));
  const iMax = datos.findIndex((d) => d.v === max);
  return `<div class="cols" style="--alto:${alto}px">
    ${datos.map((d, i) => `<div class="col" data-tip="${esc(d.tip)}">
      ${i === iMax && d.v ? `<span class="col-valor">${esc(d.corto)}</span>` : ""}
      <i style="height:${(d.v / max) * 100}%"></i>
      <small>${i % etiquetaCada === 0 ? esc(d.et) : ""}</small></div>`).join("")}
  </div>`;
}
export function barras(datos) {
  const max = Math.max(1, ...datos.map((d) => d.v));
  return `<div class="barras">${datos.map((d) => `
    <div class="barra-fila" data-tip="${esc(d.tip || "")}"><span class="bf-et">${esc(d.et)}</span>
      <span class="bf-pista"><i style="width:${(d.v / max) * 100}%"></i></span><b class="bf-val">${esc(d.val)}</b></div>`).join("")}</div>`;
}
const compacto = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M` : n >= 1e4 ? `${Math.round(n / 1000)} mil` : fmtNum(n));
function delta(actual, anterior) {
  if (!anterior) return `<span class="delta neutro">sin datos para comparar</span>`;
  const p = ((actual - anterior) / anterior) * 100;
  const sube = p >= 0;
  return `<span class="delta ${Math.abs(p) < 0.5 ? "neutro" : sube ? "sube" : "baja"}">${sube ? "▲" : "▼"} ${Math.abs(p).toLocaleString("es-AR", { maximumFractionDigits: 0 })}%</span>`;
}

export function mount(root) {
  let tipo = localStorage.getItem("af_rep_periodo") || "semana";
  let desdeTxt = aInput(Date.now() - 6 * DIA), hastaTxt = aInput(Date.now());
  let ultimo = null;
  let pedido = 0;

  root.innerHTML = `
    <div class="reportes">
      <div class="rep-filtros">
        <div class="chips desliza" id="rPer">${Object.entries(PERIODOS).map(([k, v]) => `<button class="chip" data-per="${k}">${k === "jornada" && turnosCaja().length > 1 ? "Último turno" : v}</button>`).join("")}</div>
        <div class="rep-rango" id="rRango" hidden>
          <input class="input chico" type="date" id="rDesde" value="${desdeTxt}"> a <input class="input chico" type="date" id="rHasta" value="${hastaTxt}">
        </div>
        <button class="btn" data-act="excel">${icon("bajar")} Excel</button>
      </div>
      <div id="rCuerpo"><p class="ayuda">Cargando…</p></div>
    </div>`;
  const cuerpo = root.querySelector("#rCuerpo");
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.hidden = true;
  document.body.appendChild(tip);

  async function cargar() {
    const n = ++pedido;
    root.querySelectorAll("[data-per]").forEach((b) => b.classList.toggle("activo", b.dataset.per === tipo));
    root.querySelector("#rRango").hidden = tipo !== "rango";
    cuerpo.innerHTML = `<p class="ayuda">Cargando…</p>`;
    try {
      const rg = await rangos(tipo, desdeTxt, hastaTxt);
      if (n !== pedido) return;
      if (!rg) { cuerpo.innerHTML = `<div class="vacio">${icon("caja")}<p>Todavía no hay jornadas para mostrar.</p></div>`; return; }
      const filtro = (a, b) => ({ where: [["ts", ">=", a], ["ts", "<", b]] });
      const [ventas, previas] = await Promise.all([db.query("ventas", filtro(rg.desde, rg.hasta)), db.query("ventas", filtro(rg.prev[0], rg.prev[1]))]);
      if (n !== pedido) return;
      ultimo = { rg, ventas: ventas.sort((a, b) => a.ts - b.ts), r: analizar(ventas), p: analizar(previas) };
      pintar();
    } catch (e) {
      console.error(e);
      if (n === pedido) cuerpo.innerHTML = `<p class="error">No se pudieron cargar las ventas: ${esc(e.message || e)}</p>`;
    }
  }

  function pintar() {
    const { rg, r, p } = ultimo;
    if (!r.cant && !r.anuladas) {
      cuerpo.innerHTML = `<div class="vacio">${icon("caja")}<p>No hay ventas entre ${etiquetaDia(rg.desde)} y ${etiquetaDia(rg.hasta - 1)}.</p></div>`;
      return;
    }
    // Días del período (también los que no tuvieron ventas)
    const dias = [];
    if (tipo !== "jornada") for (let d = inicioDia(rg.desde); d < rg.hasta; d += DIA) dias.push(inicioDia(d + 3600000));
    const datosDias = dias.map((d) => {
      const x = r.porDia.get(d) || { total: 0, cant: 0 };
      return { v: x.total, et: dias.length > 10 ? String(new Date(d).getDate()) : etiquetaDia(d), corto: compacto(x.total), tip: `${etiquetaDia(d)}: ${fmt(x.total)} · ${x.cant} mesa${x.cant === 1 ? "" : "s"}` };
    });
    // Horas de llegada, de 12 a 5 de la mañana
    const horas = [];
    const hs = [...r.porHora.keys()];
    if (hs.length) {
      const orden = (h) => (h - CORTE + 24) % 24;
      const ini = Math.min(...hs.map(orden)), fin = Math.max(...hs.map(orden));
      for (let o = ini; o <= fin; o++) horas.push((o + CORTE) % 24);
    }
    const datosHoras = horas.map((h) => {
      const c = r.porHora.get(h) || 0;
      return { v: c, et: `${h}`, corto: String(c), tip: `${h}:00 a ${h}:59 · ${c} mesa${c === 1 ? "" : "s"}` };
    });
    const medios = Object.entries(r.porMedio).sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ et: MEDIOS[m] || m, v, val: fmt(v), tip: `${MEDIOS[m] || m}: ${r.total ? Math.round((v / r.total) * 100) : 0}% de lo vendido` }));
    const tipos = [...r.porTipo.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, x]) => ({ et: TIPOS_VENTA[k], v: x.total, val: fmt(x.total), tip: `${TIPOS_VENTA[k]}: ${fmtNum(x.cant)} venta${x.cant === 1 ? "" : "s"} · ${r.total ? Math.round((x.total / r.total) * 100) : 0}% de lo vendido` }));
    // Turnos en el orden de Ajustes; los nombres viejos (si se renombró un turno) van al final
    const ordenT = turnosCaja().map((t) => t.nombre);
    const turnos = [...r.porTurno.entries()].sort((a, b) => ((ordenT.indexOf(a[0]) + 1) || 99) - ((ordenT.indexOf(b[0]) + 1) || 99))
      .map(([k, x]) => ({ et: k, v: x.total, val: fmt(x.total), tip: `${k}: ${fmtNum(x.cant)} venta${x.cant === 1 ? "" : "s"} · ticket promedio ${fmt(x.total / x.cant)} · ${r.total ? Math.round((x.total / r.total) * 100) : 0}% de lo vendido` }));
    const cats = [...r.porCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ et: c, v, val: fmt(v), tip: `${c}: ${fmt(v)}` }));
    const prods = [...r.productos.values()].sort((a, b) => b.cant - a.cant || b.importe - a.importe);
    const maxCant = Math.max(1, ...prods.map((x) => x.cant));
    const mozos = [...r.porMozo.entries()].sort((a, b) => b[1].total - a[1].total);

    cuerpo.innerHTML = `
      <p class="ayuda rep-rango-txt">${etiquetaDia(rg.desde)} ${new Date(rg.desde).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} → ${etiquetaDia(rg.hasta - 1)} · comparado con ${rg.vs}</p>
      <div class="kpis">
        <div class="kpi"><small>Vendido</small><b>${fmt(r.total)}</b>${delta(r.total, p.total)}</div>
        <div class="kpi"><small>Ventas</small><b>${fmtNum(r.cant)}</b>${delta(r.cant, p.cant)}</div>
        <div class="kpi"><small>Ticket promedio</small><b>${fmt(r.promedio)}</b>${delta(r.promedio, p.promedio)}</div>
        <div class="kpi"><small>Gasto por persona</small><b>${fmt(r.porPersona)}</b><span>${fmtNum(r.comensales)} comensales</span></div>
      </div>
      ${r.descuentos || r.anuladas || r.propinas ? `<p class="ayuda">${[r.propinas ? `Propinas: ${fmt(r.propinas)} (aparte de lo vendido)` : "", r.descuentos ? `Descuentos: ${fmt(r.descuentos)}` : "", r.anuladas ? `Ventas anuladas: ${r.anuladas} (${fmt(r.montoAnulado)}), no se suman` : ""].filter(Boolean).join(" · ")}</p>` : ""}
      <div class="rep-grid">
        ${datosDias.length > 1 ? `<section class="tarjeta"><h3>Ventas por día</h3>${columnas(datosDias, { etiquetaCada: datosDias.length > 16 ? 3 : 1 })}</section>` : ""}
        ${datosHoras.length ? `<section class="tarjeta"><h3>¿A qué hora llegan?</h3><p class="ayuda">Mesas y pedidos según la hora en que se abrieron.</p>${columnas(datosHoras, { alto: 120 })}</section>` : ""}
        ${turnos.length > 1 ? `<section class="tarjeta"><h3>Por turno de caja</h3>${barras(turnos)}<p class="ayuda">${turnos.map((x) => `${esc(x.et)}: ${fmtNum(r.porTurno.get(x.et).cant)} venta${r.porTurno.get(x.et).cant === 1 ? "" : "s"}, ticket promedio ${fmt(r.porTurno.get(x.et).total / r.porTurno.get(x.et).cant)}`).join(" · ")}</p></section>` : ""}
        ${tipos.length > 1 ? `<section class="tarjeta"><h3>Mesas, para llevar y delivery</h3>${barras(tipos)}</section>` : ""}
        <section class="tarjeta"><h3>Medios de pago</h3>${barras(medios)}</section>
        <section class="tarjeta"><h3>Por categoría</h3>${barras(cats)}</section>
      </div>
      <section class="tarjeta">
        <h3>Productos más vendidos</h3>
        <div class="tabla-rep prods">
          <div class="tr cab"><span>Producto</span><span>Cantidad</span><span>Importe</span></div>
          ${prods.slice(0, 25).map((x, i) => `<div class="tr"><span><small>${i + 1}</small> ${esc(x.desc)}<em>${esc(x.cat)}</em></span>
            <span class="tr-cant"><i style="width:${(x.cant / maxCant) * 100}%"></i><b>${fmtNum(x.cant)}</b></span><span>${fmt(x.importe)}</span></div>`).join("")}
        </div>
        ${prods.length > 25 ? `<p class="ayuda">Y ${prods.length - 25} productos más (están todos en el Excel).</p>` : ""}
        ${prods.length > 5 ? `<p class="ayuda"><b>Menos pedidos:</b> ${prods.slice(-5).reverse().map((x) => `${esc(x.desc)} (${fmtNum(x.cant)})`).join(" · ")}</p>` : ""}
      </section>
      <section class="tarjeta">
        <h3>Por mozo</h3>
        <div class="tabla-rep mozos${r.propinas ? " con-prop" : ""}">
          <div class="tr cab"><span>Mozo</span><span>Ventas</span><span>Comensales</span><span>Vendido</span><span>Ticket prom.</span>${r.propinas ? "<span>Propinas</span>" : ""}</div>
          ${mozos.map(([n, m]) => `<div class="tr"><span>${esc(n)}</span><span>${fmtNum(m.mesas)}</span><span>${fmtNum(m.comensales)}</span><span>${fmt(m.total)}</span><span>${fmt(m.total / m.mesas)}</span>${r.propinas ? `<span>${fmt(m.propinas)}</span>` : ""}</div>`).join("")}
        </div>
      </section>`;
  }

  async function exportar() {
    if (!ultimo || !ultimo.ventas.length) return toast("No hay ventas en el período elegido");
    let XLSX;
    try { XLSX = await cargarXLSX(); } catch { return toast("No se pudo generar el Excel. Revisá la conexión.", "error"); }
    const { rg, r, ventas } = ultimo;
    const fecha = (t) => new Date(t).toLocaleDateString("es-AR");
    const horaTxt = (t) => new Date(t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const hoja = (filas, anchos) => { const ws = XLSX.utils.aoa_to_sheet(filas); ws["!cols"] = anchos.map((w) => ({ wch: w })); return ws; };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hoja([
      ["Período", `${fecha(rg.desde)} al ${fecha(rg.hasta - 1)}`], ["Vendido", r.total], ["Ventas", r.cant], ["Ticket promedio", Math.round(r.promedio)],
      ["Comensales", r.comensales], ["Gasto por persona", Math.round(r.porPersona)], ["Descuentos", r.descuentos], ["Propinas (aparte)", r.propinas], ["Ventas anuladas", r.anuladas], ["Monto anulado", r.montoAnulado],
      [], ["Medio de pago", "Monto"], ...Object.entries(r.porMedio).map(([m, v]) => [MEDIOS[m] || m, v]),
      [], ["Tipo de venta", "Ventas", "Monto"], ...[...r.porTipo.entries()].map(([k, x]) => [TIPOS_VENTA[k], x.cant, x.total]),
      ...(r.porTurno.size ? [[], ["Turno de caja", "Ventas", "Monto", "Ticket promedio"], ...[...r.porTurno.entries()].map(([k, x]) => [k, x.cant, x.total, Math.round(x.total / x.cant)])] : []),
    ], [22, 22]), "Resumen");
    XLSX.utils.book_append_sheet(wb, hoja([
      ["Día comercial", "Hora", "Turno", "Nº", "Tipo", "Mesa / pedido", "Mozo", "Comensales", "Subtotal", "Descuento", "Total", "Propina", "Medios de pago", "Estado"],
      ...ventas.map((v) => [fecha(diaComercial(v.ts)), horaTxt(v.ts), turnoDeVenta(v), v.nro, TIPOS_VENTA[v.tipo] || "Mesas", v.mesaNombre, v.mozo, v.comensales || "", v.subtotal, v.descuento?.monto || 0, v.total, v.propina || 0,
        (v.pagos || []).map((x) => `${MEDIOS[x.medio] || x.medio} ${x.monto}`).join(" + "), v.estado === "anulada" ? "Anulada" : "OK"]),
    ], [13, 7, 14, 10, 12, 18, 12, 11, 11, 11, 11, 9, 34, 9]), "Ventas");
    XLSX.utils.book_append_sheet(wb, hoja([
      ["Producto", "Categoría", "Cantidad", "Importe (sin descuentos)"],
      ...[...r.productos.values()].sort((a, b) => b.cant - a.cant).map((x) => [x.desc, x.cat, x.cant, x.importe]),
    ], [34, 16, 10, 22]), "Productos");
    XLSX.utils.book_append_sheet(wb, hoja([
      ["Mozo", "Ventas", "Comensales", "Vendido", "Ticket promedio", "Propinas"],
      ...[...r.porMozo.entries()].map(([n, m]) => [n, m.mesas, m.comensales, m.total, Math.round(m.total / m.mesas), m.propinas]),
    ], [16, 8, 11, 12, 15, 10]), "Mozos");
    XLSX.utils.book_append_sheet(wb, hoja([
      ["Día comercial", "Mesas", "Vendido"],
      ...[...r.porDia.entries()].sort((a, b) => a[0] - b[0]).map(([d, x]) => [fecha(d), x.cant, x.total]),
    ], [14, 8, 12]), "Días");
    XLSX.writeFile(wb, `ventas-${aInput(rg.desde)}-al-${aInput(rg.hasta - 1)}.xlsx`);
  }

  // Tooltip: sigue al mouse; en el celular aparece al tocar
  const mostrarTip = (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t || !t.dataset.tip) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, e.clientX - tip.offsetWidth / 2));
    tip.style.left = x + "px";
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 14) + "px";
  };
  root.addEventListener("pointermove", mostrarTip);
  root.addEventListener("pointerdown", mostrarTip);
  root.addEventListener("pointerleave", () => { tip.hidden = true; });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-per]");
    if (b) { tipo = b.dataset.per; localStorage.setItem("af_rep_periodo", tipo); cargar(); return; }
    if (e.target.closest('[data-act="excel"]')) exportar();
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "rDesde") { desdeTxt = e.target.value; cargar(); }
    if (e.target.id === "rHasta") { hastaTxt = e.target.value; cargar(); }
  });

  cargar();
  return {
    update(claves) { if (claves.includes("jornada") && tipo === "jornada") cargar(); },
    unmount() { tip.remove(); },
  };
}
