// ============================================================
//  A&F · Gastos fijos y resultado del mes (dueño y administrador)
// ============================================================
// Resultado = lo vendido − compras de mercadería − gastos pagados
// de la caja − gastos fijos del mes (alquiler, sueldos, servicios…).
//
// - Las propinas no son venta: no entran.
// - Las compras cuentan el mes en que se cargan, aunque se paguen después.
// - Los gastos de caja que salen de una compra o de un pago a proveedor
//   no se cuentan dos veces (ya están en Compras).
// - Retiros e ingresos de caja no son gastos ni ventas.
import { S, log } from "../store.js";
import { db } from "../db.js";
import { esc, fmt, fmtNum, num, icon, modal, toast, confirmar, fecha } from "../util.js";
import { CORTE, barras } from "./reportes.js";

export const CATEGORIAS_GASTO = ["Alquiler", "Sueldos y cargas sociales", "Servicios (luz, gas, agua, internet)", "Impuestos y tasas", "Mantenimiento y reparaciones", "Seguros", "Abonos y sistemas", "Otros"];
const EJEMPLOS = { "Alquiler": "Alquiler del local", "Sueldos y cargas sociales": "Sueldo de…", "Servicios (luz, gas, agua, internet)": "Luz", "Impuestos y tasas": "Ingresos brutos, DReI…", "Mantenimiento y reparaciones": "Service de la cámara de frío", "Seguros": "Seguro del local", "Abonos y sistemas": "Alarma, música, sistema de gestión" };
const NUEVA = "__nueva";

const claveMes = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;            // m: 0-11
const partesMes = (k) => { const [y, m] = k.split("-").map(Number); return [y, m - 1]; };
const mesActual = () => { const d = new Date(Date.now() - CORTE * 3600000); return claveMes(d.getFullYear(), d.getMonth()); };
const moverMes = (k, d) => { const [y, m] = partesMes(k); const x = new Date(y, m + d, 1); return claveMes(x.getFullYear(), x.getMonth()); };
const rangoMes = (k) => { const [y, m] = partesMes(k); return [new Date(y, m, 1, CORTE).getTime(), new Date(y, m + 1, 1, CORTE).getTime()]; };
const nombreMes = (k, conAnio = true) => { const [y, m] = partesMes(k); const t = new Date(y, m, 15).toLocaleDateString("es-AR", { month: "long" }); return t.charAt(0).toUpperCase() + t.slice(1) + (conAnio ? ` ${y}` : ""); };

// Trae y calcula un mes completo
async function calcularMes(k) {
  const [desde, hasta] = rangoMes(k);
  const rango = (a, b) => ({ where: [["ts", ">=", a], ["ts", "<", b]] });
  const [ventas, compras, movs, gastos] = await Promise.all([
    db.query("ventas", rango(desde, hasta)),
    db.query("compras", rango(desde - 62 * 86400000, hasta)), // más atrás: solo para no contar dos veces sus gastos de caja
    db.query("movCaja", rango(desde, hasta)),
    db.query("gastos", { where: [["mes", "==", k]] }),
  ]);
  const ok = ventas.filter((v) => v.estado !== "anulada");
  const vendido = ok.reduce((s, v) => s + (v.total || 0), 0);
  const delMes = compras.filter((c) => c.ts >= desde && c.tipo !== "pago" && c.estado !== "anulada");
  const comprasTot = delMes.reduce((s, c) => s + (c.total || 0), 0);
  const deCompras = new Set(compras.map((c) => c.movCajaId).filter(Boolean));
  const gastosCaja = movs.filter((m) => m.tipo === "gasto" && !m.compraId && !deCompras.has(m.id)).sort((a, b) => a.ts - b.ts);
  const cajaTot = gastosCaja.reduce((s, m) => s + (m.monto || 0), 0);
  const fijosTot = gastos.reduce((s, g) => s + (g.monto || 0), 0);
  const porCat = new Map();
  for (const g of gastos) porCat.set(g.categoria || "Otros", (porCat.get(g.categoria || "Otros") || 0) + (g.monto || 0));
  const egresos = comprasTot + cajaTot + fijosTot;
  return {
    k, desde, hasta, vendido, cantVentas: ok.length, propinas: ok.reduce((s, v) => s + (Number(v.propina) || 0), 0),
    comprasTot, cantCompras: delMes.length, gastosCaja, cajaTot, gastos, fijosTot, porCat, egresos,
    resultado: vendido - egresos, margen: vendido ? ((vendido - egresos) / vendido) * 100 : 0,
  };
}

export function mount(root) {
  let mes = mesActual();
  let datos = null, previo = null;
  let gastos = [];       // gastos fijos del mes, en vivo
  let soltarGastos = null;
  let pedido = 0;

  root.innerHTML = `
    <div class="resultado">
      <div class="res-cab">
        <button class="btn-icono" data-mes="-1" aria-label="Mes anterior">${icon("atras")}</button>
        <h2 id="rsMes"></h2>
        <button class="btn-icono" data-mes="1" aria-label="Mes siguiente" id="rsSig"><span class="gira">${icon("atras")}</span></button>
      </div>
      <div id="rsCuerpo"><p class="ayuda">Cargando…</p></div>
    </div>`;
  const cuerpo = root.querySelector("#rsCuerpo");

  async function cargar() {
    const n = ++pedido;
    root.querySelector("#rsMes").textContent = nombreMes(mes);
    root.querySelector("#rsSig").disabled = mes >= mesActual();
    cuerpo.innerHTML = `<p class="ayuda">Cargando…</p>`;
    soltarGastos?.();
    soltarGastos = db.listen("gastos", { where: [["mes", "==", mes]] }, (a) => { gastos = a; if (datos && n === pedido) { datos = recalcularFijos(datos); pintar(); } });
    try {
      const [d, p] = await Promise.all([calcularMes(mes), calcularMes(moverMes(mes, -1))]);
      if (n !== pedido) return;
      datos = recalcularFijos(d); previo = p;
      pintar();
    } catch (e) {
      console.error(e);
      if (n === pedido) cuerpo.innerHTML = `<p class="error">No se pudo calcular el mes: ${esc(e.message || e)}</p>`;
    }
  }

  // Los gastos fijos se editan en vivo: se recalcula sin volver a traer ventas y compras
  function recalcularFijos(d) {
    const porCat = new Map();
    for (const g of gastos) porCat.set(g.categoria || "Otros", (porCat.get(g.categoria || "Otros") || 0) + (g.monto || 0));
    const fijosTot = gastos.reduce((s, g) => s + (g.monto || 0), 0);
    const egresos = d.comprasTot + d.cajaTot + fijosTot;
    return { ...d, gastos, fijosTot, porCat, egresos, resultado: d.vendido - egresos, margen: d.vendido ? ((d.vendido - egresos) / d.vendido) * 100 : 0 };
  }

  function pintar() {
    const d = datos, p = previo;
    const enCurso = mes === mesActual();
    const pct = (x) => `${x.toLocaleString("es-AR", { maximumFractionDigits: 0 })}%`;
    const signo = (x) => (x < 0 ? "− " : "") + fmt(Math.abs(x));
    const gastosMap = [
      ...(d.comprasTot ? [{ et: "Mercadería (compras)", v: d.comprasTot, val: fmt(d.comprasTot), tip: `${d.cantCompras} compra${d.cantCompras === 1 ? "" : "s"}` }] : []),
      ...(d.cajaTot ? [{ et: "Gastos de caja", v: d.cajaTot, val: fmt(d.cajaTot), tip: `${d.gastosCaja.length} gasto${d.gastosCaja.length === 1 ? "" : "s"} pagados de la caja` }] : []),
      ...[...d.porCat.entries()].map(([c, v]) => ({ et: c, v, val: fmt(v), tip: `${c}: ${d.egresos ? Math.round((v / d.egresos) * 100) : 0}% de los gastos` })),
    ].sort((a, b) => b.v - a.v);
    const porCat = new Map();
    for (const g of [...d.gastos].sort((a, b) => (b.monto || 0) - (a.monto || 0))) (porCat.get(g.categoria || "Otros") || porCat.set(g.categoria || "Otros", []).get(g.categoria || "Otros")).push(g);
    const ordenCats = [...porCat.keys()].sort((a, b) => ((CATEGORIAS_GASTO.indexOf(a) + 1) || 98) - ((CATEGORIAS_GASTO.indexOf(b) + 1) || 98));
    const paraCopiar = copiables();
    const comparacion = p.vendido || p.egresos
      ? `<span class="delta neutro">${nombreMes(p.k, false)}: ${signo(p.resultado)}</span>` : `<span class="delta neutro">&nbsp;</span>`;

    cuerpo.innerHTML = `
      ${enCurso ? `<p class="ayuda">Mes en curso: suma lo que pasó hasta hoy.</p>` : ""}
      <div class="kpis">
        <div class="kpi"><small>Vendido</small><b>${fmt(d.vendido)}</b><span>${fmtNum(d.cantVentas)} venta${d.cantVentas === 1 ? "" : "s"}</span></div>
        <div class="kpi"><small>Gastos y compras</small><b>${fmt(d.egresos)}</b><span>${d.vendido ? `${pct((d.egresos / d.vendido) * 100)} de lo vendido` : "&nbsp;"}</span></div>
        <div class="kpi res-kpi ${d.resultado < 0 ? "res-neg" : "res-pos"}"><small>Resultado</small><b>${signo(d.resultado)}</b>${comparacion}</div>
        <div class="kpi"><small>Margen</small><b>${d.vendido ? pct(d.margen) : "—"}</b><span>${!d.vendido ? "&nbsp;" : d.margen >= 0 ? `de cada $ 100 vendidos quedan ${fmt(d.margen)}` : `por cada $ 100 vendidos se pierden ${fmt(-d.margen)}`}</span></div>
      </div>
      <div class="rep-grid">
        <section class="tarjeta res-cuenta">
          <h3>Cómo se llega al resultado</h3>
          <div class="co-linea"><span>Vendido <small>${fmtNum(d.cantVentas)} ventas${d.propinas ? ` · sin ${fmt(d.propinas)} de propinas` : ""}</small></span><b>${fmt(d.vendido)}</b></div>
          <a class="co-linea enlace" href="#/compras"><span>− Compras de mercadería <small>${d.cantCompras} compra${d.cantCompras === 1 ? "" : "s"} cargada${d.cantCompras === 1 ? "" : "s"} en el mes</small></span><span>${fmt(d.comprasTot)}</span></a>
          <button type="button" class="co-linea enlace" data-act="verCaja" ${d.gastosCaja.length ? "" : "disabled"}><span>− Gastos pagados de la caja <small>${d.gastosCaja.length ? `${d.gastosCaja.length} gasto${d.gastosCaja.length === 1 ? "" : "s"} · ver detalle` : "hielo, verdulería, arreglos…"}</small></span><span>${fmt(d.cajaTot)}</span></button>
          <div class="co-linea"><span>− Gastos fijos <small>${d.gastos.length} cargado${d.gastos.length === 1 ? "" : "s"}</small></span><span>${fmt(d.fijosTot)}</span></div>
          <div class="co-linea total ${d.resultado < 0 ? "res-neg" : "res-pos"}"><span>Resultado</span><b>${signo(d.resultado)}</b></div>
        </section>
        <section class="tarjeta"><h3>¿En qué se va la plata?</h3>${gastosMap.length ? barras(gastosMap) : `<p class="ayuda">Todavía no hay gastos ni compras en ${nombreMes(mes, false).toLowerCase()}.</p>`}</section>
      </div>
      <section class="tarjeta">
        <div class="tarjeta-cab"><h3>Gastos fijos de ${nombreMes(mes, false).toLowerCase()}</h3>
          <div class="chips"><button class="chip" data-act="gasto">${icon("mas")} Gasto</button></div></div>
        ${paraCopiar.length ? `<div class="banda azul res-copiar">${icon("calendario")}<span>${nombreMes(moverMes(mes, -1), false)} tiene ${paraCopiar.length} gasto${paraCopiar.length === 1 ? "" : "s"} fijo${paraCopiar.length === 1 ? "" : "s"} que se repite${paraCopiar.length === 1 ? "" : "n"} (${fmt(paraCopiar.reduce((s, g) => s + (g.monto || 0), 0))}).</span><button class="btn chico" data-act="copiar">Copiarlos</button></div>` : ""}
        ${d.gastos.length ? ordenCats.map((c) => `
          <div class="res-cat"><h4 class="subtitulo">${esc(c)}<span>${fmt(d.porCat.get(c))}</span></h4>
            <div class="lista">${porCat.get(c).map((g) => `<button class="fila-lista boton" data-gasto="${esc(g.id)}"><div><b>${esc(g.desc || c)}</b><small>${g.fijo ? "Se repite todos los meses" : "Solo este mes"}${g.usuario ? ` · cargó ${esc(g.usuario)}` : ""}</small></div><span>${fmt(g.monto)}</span></button>`).join("")}</div></div>`).join("")
          : `<div class="vacio chico">${icon("dinero")}<p>Cargá los gastos que no pasan por la caja: alquiler, sueldos, luz, gas, impuestos…<br>Los que se repiten se copian solos al mes siguiente con un toque.</p></div>`}
      </section>
      <p class="ayuda">Las propinas no se cuentan como venta. Las compras se cuentan en el mes en que se cargan, aunque se paguen después. Los gastos de caja que salen de una compra o de un pago a proveedor no se cuentan dos veces. Los retiros del dueño no son gastos.</p>`;
  }

  // Gastos "se repite" del mes anterior que todavía no están en este
  function copiables() {
    if (!previo) return [];
    const ya = new Set(gastos.map((g) => `${g.categoria}|${(g.desc || "").toLowerCase()}`));
    return previo.gastos.filter((g) => g.fijo && !ya.has(`${g.categoria}|${(g.desc || "").toLowerCase()}`));
  }

  async function copiar() {
    const lista = copiables();
    if (!lista.length) return;
    const total = lista.reduce((s, g) => s + (g.monto || 0), 0);
    if (!(await confirmar(`Se copian ${lista.length} gastos de ${nombreMes(moverMes(mes, -1), false).toLowerCase()} (${fmt(total)}). Después podés cambiar los montos que hayan subido.`, { ok: "Copiar" }))) return;
    const t = Date.now();
    db.batch(lista.map((g) => ({ op: "set", col: "gastos", id: db.newId("gastos"), data: { mes, categoria: g.categoria, desc: g.desc || "", monto: g.monto || 0, fijo: true, ts: t, usuario: S.perfil.nombre } })));
    log("gasto", `Gastos fijos copiados a ${nombreMes(mes)}: ${lista.length} (${fmt(total)})`);
    toast(`${lista.length} gastos copiados`);
  }

  function editar(g = null) {
    const nuevo = !g;
    const usadas = [...new Set([...gastos, ...(previo?.gastos || [])].map((x) => x.categoria).filter((c) => c && !CATEGORIAS_GASTO.includes(c)))];
    const cats = [...CATEGORIAS_GASTO, ...usadas];
    const cat0 = g?.categoria || "";
    const m = modal({
      titulo: nuevo ? `Gasto de ${nombreMes(mes, false).toLowerCase()}` : g.desc || g.categoria,
      clase: "modal-chico",
      cuerpo: `<form class="form" id="fGasto">
        <label class="campo"><span>Categoría</span><select class="input" id="gCat" required>
          <option value="" ${cat0 ? "" : "selected"} disabled>Elegí una categoría…</option>
          ${cats.map((c) => `<option ${c === cat0 ? "selected" : ""}>${esc(c)}</option>`).join("")}
          <option value="${NUEVA}">+ Nueva categoría…</option></select></label>
        <label class="campo" id="gCatNW" hidden><span>Nombre de la categoría</span><input class="input" id="gCatN" maxlength="40"></label>
        <label class="campo"><span>Detalle</span><input class="input" id="gDesc" value="${esc(g?.desc || "")}" placeholder="${esc(EJEMPLOS[cat0] || "Ej: Alquiler del local")}" maxlength="60"></label>
        <label class="campo"><span>Monto</span><input class="input grande" id="gMonto" inputmode="decimal" value="${g?.monto ? Math.round(g.monto) : ""}" placeholder="$ 0" required></label>
        <label class="switch"><input type="checkbox" id="gFijo" ${g ? (g.fijo ? "checked" : "") : "checked"}><span>Se repite todos los meses</span></label>
      </form>`,
      pie: `${nuevo ? "" : `<button type="button" class="btn" data-a="borrar" aria-label="Borrar">${icon("basura")}</button>`}<button type="submit" form="fGasto" class="btn btn-pri">${nuevo ? "Agregar" : "Guardar"}</button>`,
    });
    const $ = (s) => m.el.querySelector(s);
    $("#gCat").onchange = () => {
      const v = $("#gCat").value;
      $("#gCatNW").hidden = v !== NUEVA;
      if (v === NUEVA) $("#gCatN").focus();
      else $("#gDesc").placeholder = EJEMPLOS[v] || "Detalle";
    };
    $("#fGasto").onsubmit = (e) => {
      e.preventDefault();
      let categoria = $("#gCat").value;
      if (categoria === NUEVA) categoria = $("#gCatN").value.trim().replace(/^./, (x) => x.toUpperCase());
      if (!categoria) return toast("Elegí una categoría", "error");
      const monto = Math.round(num($("#gMonto").value));
      if (!(monto > 0)) return toast("Ingresá el monto", "error");
      const datos = { mes, categoria, desc: $("#gDesc").value.trim(), monto, fijo: $("#gFijo").checked };
      if (nuevo) db.add("gastos", { ...datos, ts: Date.now(), usuario: S.perfil.nombre });
      else db.update("gastos", g.id, datos);
      log("gasto", `${nuevo ? "Gasto" : "Gasto editado"} ${nombreMes(mes)}: ${categoria}${datos.desc ? ` · ${datos.desc}` : ""} ${fmt(monto)}`);
      m.cerrar();
    };
    const b = m.el.querySelector('[data-a="borrar"]');
    if (b) b.onclick = async () => {
      if (!(await confirmar(`¿Borrar ${g.desc || g.categoria} (${fmt(g.monto)}) de ${nombreMes(mes, false).toLowerCase()}?`, { ok: "Borrar", peligro: true }))) return;
      db.remove("gastos", g.id);
      log("gasto", `Gasto borrado ${nombreMes(mes)}: ${g.categoria} ${fmt(g.monto)}`);
      m.cerrar();
    };
  }

  function verCaja() {
    modal({
      titulo: `Gastos de caja · ${nombreMes(mes, false).toLowerCase()}`,
      cuerpo: `<div class="lista">${datos.gastosCaja.map((x) => `<div class="fila-lista"><div><b>${esc(x.desc || "Gasto")}</b><small>${fecha(x.ts)} · ${esc(x.usuario || "")}</small></div><span>${fmt(x.monto)}</span></div>`).join("")}</div>
        <div class="co-linea total"><span>Total</span><b>${fmt(datos.cajaTot)}</b></div>`,
    });
  }

  root.addEventListener("click", (e) => {
    const bm = e.target.closest("[data-mes]");
    if (bm) { const nm = moverMes(mes, Number(bm.dataset.mes)); if (nm <= mesActual()) { mes = nm; cargar(); } return; }
    const bg = e.target.closest("[data-gasto]");
    if (bg) { const g = gastos.find((x) => x.id === bg.dataset.gasto); if (g) editar(g); return; }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "gasto") editar();
    else if (a.dataset.act === "copiar") copiar();
    else if (a.dataset.act === "verCaja") verCaja();
  });

  cargar();
  return { unmount() { soltarGastos?.(); } };
}
