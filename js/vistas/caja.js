// ============================================================
//  A&F · Caja por jornada
// ============================================================
// La jornada no depende de la fecha: se abre a las 19 y se cierra a
// las 3 de la mañana sin partirse a medianoche. Al cerrar se cuenta
// el efectivo y se registra la diferencia (arqueo).
import { CONFIG } from "../config.js";
import { S, puede, MEDIOS, itemsDe, totalItems, log, turnosCaja, turnoPorHora } from "../store.js";
import { db, inc } from "../db.js";
import { esc, fmt, num, hora, fechaHora, durTxt, icon, modal, toast, confirmar, pedirTexto } from "../util.js";
import { opcionesTicket, ticketCierre, ticketVenta } from "../print.js";
import { opsCuenta } from "./clientes.js";
import { tocaRespaldo, diasSinRespaldo, descargarRespaldo } from "../respaldo.js";

export function resumenJornada(j, ventas, movs) {
  const porMedio = Object.fromEntries(Object.keys(MEDIOS).map((m) => [m, 0]));
  let total = 0, cant = 0, anuladas = 0, descuentos = 0, propinas = 0;
  const propinasMozo = {};
  for (const v of ventas) {
    if (v.estado === "anulada") { anuladas++; continue; }
    cant++;
    total += v.total || 0;
    descuentos += v.descuento?.monto || 0;
    if (v.propina) { propinas += v.propina; propinasMozo[v.mozo || "Sin mozo"] = (propinasMozo[v.mozo || "Sin mozo"] || 0) + v.propina; }
    for (const p of v.pagos || []) porMedio[p.medio] = (porMedio[p.medio] || 0) + (p.monto || 0);
  }
  let gastos = 0, gastosEf = 0, retiros = 0, ingresos = 0;
  for (const m of movs) {
    const ef = (m.medio || "efectivo") === "efectivo";
    if (m.tipo === "gasto") { gastos += m.monto; if (ef) gastosEf += m.monto; }
    else if (m.tipo === "retiro") retiros += m.monto;
    else if (m.tipo === "ingreso" && ef) ingresos += m.monto;
  }
  const esperado = (j?.apertura?.fondo || 0) + (porMedio.efectivo || 0) + ingresos - gastosEf - retiros;
  return { porMedio, total, cant, anuladas, descuentos, propinas, propinasMozo, gastos, gastosEf, retiros, ingresos, esperado, promedio: cant ? total / cant : 0 };
}

export function mount(root) {
  let ventas = [], movs = [], historial = [];
  let subs = [];
  let jornadaId = null;
  let turnoElegido = null; // id del turno que se va a abrir

  root.innerHTML = `<div class="caja" id="caja"></div>`;
  const cont = root.querySelector("#caja");

  function suscribir() {
    subs.forEach((u) => u());
    subs = [];
    ventas = []; movs = [];
    jornadaId = S.jornada?.id || null;
    if (jornadaId) {
      subs.push(db.listen("ventas", { where: [["jornadaId", "==", jornadaId]] }, (a) => { ventas = a.sort((x, y) => y.ts - x.ts); render(); }));
      subs.push(db.listen("movCaja", { where: [["jornadaId", "==", jornadaId]] }, (a) => { movs = a.sort((x, y) => y.ts - x.ts); render(); }));
    }
    subs.push(db.listen("jornadas", { orderBy: ["aperturaTs", "desc"], limit: 12 }, (a) => { historial = a.filter((j) => j.estado === "cerrada"); render(); }));
  }

  function render() {
    const j = S.jornada;
    if (!j) {
      // No pisar el fondo que se está escribiendo
      if (!cont.querySelector("#fAbrir")) cont.innerHTML = vistaCerrada();
      cont.querySelector("#cFondoHint").innerHTML = hintFondo();
      cont.querySelector("#cHist").innerHTML = historialHtml();
      return;
    }
    const r = resumenJornada(j, ventas, movs);
    const abiertas = S.comandas.length;
    const enMesas = S.comandas.reduce((s, c) => s + totalItems(itemsDe(c.id)), 0);
    const maxMedio = Math.max(1, ...Object.values(r.porMedio));
    cont.innerHTML = `
      <div class="caja-cab">
        <div>
          <h2>Caja abierta${j.turno ? ` · ${esc(j.turno.nombre)}` : ""} <span class="pill verde">${durTxt(j.aperturaTs)}</span></h2>
          <p class="ayuda">Desde ${fechaHora(j.aperturaTs)} · abrió ${esc(j.apertura?.usuario || "")} · fondo ${fmt(j.apertura?.fondo)}</p>
        </div>
        <div class="caja-botones">
          <button class="btn" data-act="arca">${icon("externo")} Facturar en ARCA</button>
          <button class="btn btn-peligro" data-act="cerrar">Cerrar caja</button>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi"><small>Vendido</small><b>${fmt(r.total)}</b><span>${r.cant} venta${r.cant === 1 ? "" : "s"}${r.propinas ? ` · propinas ${fmt(r.propinas)}` : ""}</span></div>
        <div class="kpi"><small>Ticket promedio</small><b>${fmt(r.promedio)}</b><span>${r.descuentos ? `Descuentos ${fmt(r.descuentos)}` : "&nbsp;"}</span></div>
        <div class="kpi"><small>Efectivo en caja</small><b>${fmt(r.esperado)}</b><span>esperado</span></div>
        <div class="kpi"><small>En mesas abiertas</small><b>${fmt(enMesas)}</b><span>${abiertas} mesa${abiertas === 1 ? "" : "s"}</span></div>
      </div>

      <div class="caja-grid">
        <section class="tarjeta">
          <h3>Cobrado por medio de pago</h3>
          ${Object.entries(r.porMedio).filter(([m, v]) => v || (S.config.medios || []).includes(m)).map(([m, v]) => `
            <div class="barra-medio"><span>${MEDIOS[m]}</span><div class="barra"><i style="width:${(v / maxMedio) * 100}%"></i></div><b>${fmt(v)}</b></div>`).join("")}
          ${r.propinas ? `<p class="ayuda caja-propinas">Incluye ${fmt(r.propinas)} de propinas: ${Object.entries(r.propinasMozo).map(([n, v]) => `${esc(n)} ${fmt(v)}`).join(" · ")}</p>` : ""}
        </section>

        <section class="tarjeta">
          <div class="tarjeta-cab"><h3>Movimientos de caja</h3>
            <div class="chips"><button class="chip" data-mov="gasto">+ Gasto</button><button class="chip" data-mov="retiro">+ Retiro</button><button class="chip" data-mov="ingreso">+ Ingreso</button></div></div>
          ${movs.length ? `<div class="lista">${movs.map((m) => `
            <div class="fila-lista"><div><b>${esc(m.desc || m.tipo)}</b><small>${hora(m.ts)} · ${esc(m.usuario || "")} · ${esc(MEDIOS[m.medio] || "Efectivo")}</small></div>
              <span class="${m.tipo === "ingreso" ? "pos" : "neg"}">${m.tipo === "ingreso" ? "+" : "−"} ${fmt(m.monto)}</span>
              <button class="btn-icono" data-borrarmov="${esc(m.id)}" aria-label="Borrar">${icon("basura")}</button></div>`).join("")}</div>`
            : `<p class="ayuda">Gastos (hielo, proveedor que cobra en el momento), retiros del dueño o ingresos extra. Los de efectivo se descuentan del arqueo.</p>`}
        </section>
      </div>

      <section class="tarjeta">
        <h3>Ventas de la jornada</h3>
        ${ventas.length ? `<div class="tabla-ventas">${ventas.map((v) => `
          <button class="fila-venta ${v.estado === "anulada" ? "anulada" : ""}" data-venta="${esc(v.id)}">
            <span class="fv-hora">${hora(v.ts)}</span>
            <span class="fv-mesa"><b>${esc(v.mesaNombre)}</b><small>${esc(v.nro)} · ${esc(v.mozo || "")}</small></span>
            <span class="fv-medios">${(v.pagos || []).map((p) => `<i class="medio ${p.medio}">${MEDIOS[p.medio]}</i>`).join("")}</span>
            <b class="fv-total">${v.estado === "anulada" ? "Anulada" : fmt(v.total)}</b>
          </button>`).join("")}</div>` : `<p class="ayuda">Todavía no hay ventas en esta jornada.</p>`}
      </section>`;
  }

  function vistaCerrada() {
    const ts = turnosCaja();
    if (ts.length > 1 && !ts.some((t) => t.id === turnoElegido)) turnoElegido = turnoPorHora(Date.now(), ts)?.id || ts[0].id;
    return `
      <div class="tarjeta abrir-caja">
        <h2>Abrir caja</h2>
        <p class="ayuda">${ts.length > 1 ? "Elegí el turno y contá el efectivo con el que arranca." : "Contá el efectivo con el que arranca la noche."} La caja queda abierta hasta que la cierres, aunque pase la medianoche.</p>
        <form class="form" id="fAbrir">
          ${ts.length > 1 ? `<div class="campo"><span>Turno</span><div class="segmentado ancho turnos-caja" id="cTurno">${ts.map((t) => `<button type="button" data-turno="${esc(t.id)}" class="${t.id === turnoElegido ? "activo" : ""}"><b>${esc(t.nombre)}</b><small>${esc(t.desde)} a ${esc(t.hasta)}</small></button>`).join("")}</div></div>` : ""}
          <label class="campo"><span>Fondo inicial</span><input class="input grande" id="cFondo" inputmode="decimal" placeholder="$ 0" autofocus>
            <small class="ayuda" id="cFondoHint"></small></label>
          <button class="btn btn-pri btn-bloque btn-grande">Abrir caja</button>
        </form>
      </div>
      <div id="cHist"></div>`;
  }

  // El efectivo que quedó en la caja anterior suele ser el fondo de la siguiente
  function hintFondo() {
    const ult = historial[0];
    if (!ult || Date.now() - (ult.cierreTs || 0) > 14 * 3600000 || ult.cierre?.contado == null) return "";
    return `${ult.turno ? `El turno ${esc(ult.turno.nombre)}` : "La caja anterior"} cerró con ${fmt(ult.cierre.contado)} contados. <button type="button" class="btn-texto" data-act="usarFondo" data-monto="${Math.round(ult.cierre.contado)}">Usar ese monto</button>`;
  }

  function historialHtml() {
    return historial.length ? `<section class="tarjeta"><h3>${turnosCaja().length > 1 ? "Turnos anteriores" : "Jornadas anteriores"}</h3><div class="lista">${historial.map((j) => `
        <button class="fila-lista boton" data-jornada="${esc(j.id)}">
          <div><b>${fechaHora(j.aperturaTs)} → ${hora(j.cierreTs)}</b><small>${j.turno ? `${esc(j.turno.nombre)} · ` : ""}${esc(j.apertura?.usuario || "")} · ${j.cierre?.cant || 0} ventas</small></div>
          <span>${fmt(j.cierre?.total)}</span>
          <span class="${Math.abs(j.cierre?.diferencia || 0) < 1 ? "pos" : "neg"}">${Math.abs(j.cierre?.diferencia || 0) < 1 ? "Cuadró" : (j.cierre.diferencia > 0 ? "+" : "") + fmt(j.cierre.diferencia)}</span>
        </button>`).join("")}</div></section>` : "";
  }

  // ── Acciones ──
  function abrir(fondo) {
    if (S.jornada) return;
    const t = Date.now();
    const ts = turnosCaja();
    const tu = ts.length > 1 ? ts.find((x) => x.id === turnoElegido) || turnoPorHora(t, ts) : null;
    db.add("jornadas", { estado: "abierta", aperturaTs: t, apertura: { fondo, usuario: S.perfil.nombre, uid: S.user.uid }, ...(tu ? { turno: { id: tu.id, nombre: tu.nombre } } : {}) });
    log("caja", `Caja abierta${tu ? ` (${tu.nombre})` : ""} con fondo ${fmt(fondo)}`);
    toast(tu ? `Caja abierta · ${tu.nombre}` : "Caja abierta");
  }

  async function movimiento(tipo) {
    const titulos = { gasto: "Nuevo gasto", retiro: "Retiro de efectivo", ingreso: "Ingreso de dinero" };
    const medios = S.config.medios || Object.keys(MEDIOS);
    const m = modal({
      titulo: titulos[tipo],
      clase: "modal-chico",
      cuerpo: `<form class="form" id="fMov">
        <label class="campo"><span>Monto</span><input class="input grande" id="mMonto" inputmode="decimal" placeholder="$ 0" autofocus required></label>
        <label class="campo"><span>${tipo === "retiro" ? "Quién retira / para qué" : "Descripción"}</span><input class="input" id="mDesc" placeholder="${tipo === "gasto" ? "Ej: hielo, pan, verdulería" : ""}"></label>
        ${tipo !== "retiro" ? `<label class="campo"><span>Medio</span><select class="input" id="mMedio">${medios.map((x) => `<option value="${x}">${MEDIOS[x]}</option>`).join("")}</select></label>` : ""}
      </form>`,
      pie: `<button type="submit" form="fMov" class="btn btn-pri btn-bloque">Guardar</button>`,
    });
    m.el.querySelector("#fMov").onsubmit = (e) => {
      e.preventDefault();
      const monto = Math.round(num(m.el.querySelector("#mMonto").value));
      if (!monto) return toast("Ingresá un monto", "error");
      const desc = m.el.querySelector("#mDesc").value.trim();
      const medio = m.el.querySelector("#mMedio")?.value || "efectivo";
      db.add("movCaja", { jornadaId: S.jornada.id, tipo, monto, desc, medio, ts: Date.now(), usuario: S.perfil.nombre });
      log("caja", `${titulos[tipo]}: ${fmt(monto)} ${desc}`);
      m.cerrar();
    };
  }

  function verVenta(v) {
    const m = modal({
      titulo: `${v.mesaNombre} · ${v.nro}`,
      cuerpo: `
        <p class="ayuda">${fechaHora(v.ts)} · Atendió ${esc(v.mozo || "")} · Cobró ${esc(v.cobradoPor || "")}${v.estado === "anulada" ? ` · <b class="neg">Anulada: ${esc(v.motivo || "")}</b>` : ""}</p>
        <div class="co-items">${(v.items || []).map((i) => `<div class="co-linea"><span>${i.cant}× ${esc(i.desc)}${i.detalle ? `<small>${esc(i.detalle)}</small>` : ""}</span><span>${fmt(i.precio * i.cant)}</span></div>`).join("")}</div>
        ${v.descuento ? `<div class="co-linea"><span>Descuento</span><span>− ${fmt(v.descuento.monto)}</span></div>` : ""}
        <div class="co-linea total"><span>Total</span><b>${fmt(v.total)}</b></div>
        ${v.propina ? `<div class="co-linea"><span>Propina</span><span>+ ${fmt(v.propina)}</span></div><div class="co-linea"><span>Total pagado</span><b>${fmt(v.total + v.propina)}</b></div>` : ""}
        ${(v.pagos || []).map((p) => `<div class="co-linea"><span>${MEDIOS[p.medio]}${p.clienteNombre ? ` · ${esc(p.clienteNombre)}` : ""}</span><span>${fmt(p.monto)}</span></div>`).join("")}`,
      pie: `${v.estado !== "anulada" && puede("anular") ? `<button class="btn btn-peligro" data-a="anular">Anular venta</button>` : ""}
            <button class="btn" data-a="arca">${icon("externo")} ARCA</button>
            <button class="btn btn-pri" data-a="ticket">${icon("print")} Ticket</button>`,
    });
    m.el.querySelector('[data-a="ticket"]').onclick = () => opcionesTicket(ticketVenta(v), { titulo: `Ticket ${v.nro}`, nombre: `Ticket ${v.nro} - ${v.mesaNombre}` });
    m.el.querySelector('[data-a="arca"]').onclick = () => window.open(CONFIG.arcaUrl, "_blank", "noopener");
    const an = m.el.querySelector('[data-a="anular"]');
    if (an) an.onclick = async () => {
      const motivo = await pedirTexto("Anular venta", { placeholder: "Motivo", sugerencias: ["Error de cobro", "Cobrada dos veces", "Devolución"], ok: "Anular" });
      if (motivo === null) return;
      const ops = [{ op: "update", col: "ventas", id: v.id, data: { estado: "anulada", motivo: motivo || "Sin motivo", anuladaPor: S.perfil.nombre, anuladaTs: Date.now() } }];
      for (const i of v.items || []) {
        const p = S.productos.find((x) => x.id === i.productoId);
        if (p?.controlStock) ops.push({ op: "update", col: "productos", id: p.id, data: { stock: inc(i.cant) } });
      }
      // Si se cargó a una cuenta corriente, se descuenta del saldo del cliente
      ops.push(...opsCuenta(v.pagos || [], { ventaId: v.id, desc: `Anulación Nº ${v.nro}`, signo: -1 }));
      db.batch(ops);
      log("anulacion", `Venta ${v.nro} (${v.mesaNombre}) anulada: ${fmt(v.total)} · ${motivo || "sin motivo"}`, { ventaId: v.id });
      toast("Venta anulada. El stock se devolvió.");
      m.cerrar();
    };
  }

  function cerrarCaja() {
    const j = S.jornada;
    const r = resumenJornada(j, ventas, movs);
    const abiertas = S.comandas.length;
    const m = modal({
      titulo: j.turno ? `Cerrar caja · ${j.turno.nombre}` : "Cerrar caja",
      cuerpo: `
        ${abiertas ? `<div class="banda ambar">${icon("alerta")} Hay ${abiertas} mesa${abiertas > 1 ? "s" : ""} abierta${abiertas > 1 ? "s" : ""}. Lo que se cobre después va a la próxima jornada.</div>` : ""}
        <div class="co-linea"><span>Fondo inicial</span><span>${fmt(j.apertura?.fondo)}</span></div>
        <div class="co-linea"><span>+ Cobrado en efectivo${r.propinas ? " (con propinas)" : ""}</span><span>${fmt(r.porMedio.efectivo)}</span></div>
        ${r.ingresos ? `<div class="co-linea"><span>+ Ingresos</span><span>${fmt(r.ingresos)}</span></div>` : ""}
        ${r.gastosEf ? `<div class="co-linea"><span>− Gastos en efectivo</span><span>${fmt(r.gastosEf)}</span></div>` : ""}
        ${r.retiros ? `<div class="co-linea"><span>− Retiros</span><span>${fmt(r.retiros)}</span></div>` : ""}
        <div class="co-linea total"><span>Debería haber</span><b>${fmt(r.esperado)}</b></div>
        ${r.propinas ? `<p class="ayuda cierre-prop">Propinas del turno: ${fmt(r.propinas)} (${Object.entries(r.propinasMozo).map(([n, v]) => `${esc(n)} ${fmt(v)}`).join(" · ")}). Si las repartís en efectivo antes de contar, cargalas como retiro.</p>` : ""}
        <form class="form" id="fCierre">
          <label class="campo"><span>Efectivo contado</span><input class="input grande" id="ciCont" inputmode="decimal" placeholder="$ 0" autofocus required></label>
          <div class="arqueo" id="ciDif"></div>
          <label class="campo"><span>Nota (opcional)</span><input class="input" id="ciNota"></label>
        </form>`,
      pie: `<button type="submit" form="fCierre" class="btn btn-peligro btn-bloque">Cerrar caja</button>`,
    });
    const inp = m.el.querySelector("#ciCont");
    const dif = m.el.querySelector("#ciDif");
    inp.oninput = () => {
      if (!inp.value.trim()) { dif.textContent = ""; return; }
      const d = Math.round(num(inp.value) - r.esperado);
      dif.className = "arqueo " + (Math.abs(d) < 1 ? "ok" : d > 0 ? "sobra" : "falta");
      dif.textContent = Math.abs(d) < 1 ? "La caja cuadra" : d > 0 ? `Sobran ${fmt(d)}` : `Faltan ${fmt(-d)}`;
    };
    m.el.querySelector("#fCierre").onsubmit = async (e) => {
      e.preventDefault();
      const contado = Math.round(num(inp.value));
      const d = contado - Math.round(r.esperado);
      if (Math.abs(d) >= 1 && !(await confirmar(`La diferencia es de ${fmt(d)}. ¿Cerrar igual?`, { ok: "Cerrar igual", peligro: true }))) return;
      const t = Date.now();
      const cierre = {
        usuario: S.perfil.nombre, uid: S.user.uid, contado, esperado: Math.round(r.esperado), diferencia: d,
        nota: m.el.querySelector("#ciNota").value.trim(),
        porMedio: r.porMedio, total: r.total, cant: r.cant, anuladas: r.anuladas,
        gastos: r.gastos, gastosEf: r.gastosEf, retiros: r.retiros, ingresos: r.ingresos,
        ...(r.propinas ? { propinas: r.propinas, propinasMozo: r.propinasMozo } : {}),
      };
      db.update("jornadas", j.id, { estado: "cerrada", cierreTs: t, cierre });
      log("caja", `Caja cerrada${j.turno ? ` (${j.turno.nombre})` : ""} · vendido ${fmt(r.total)} · diferencia ${fmt(d)}`);
      m.cerrar();
      const jc = { ...j, cierreTs: t, cierre };
      const fin = modal({
        titulo: "Caja cerrada",
        clase: "modal-chico",
        cuerpo: `<p>Vendido: <b>${fmt(r.total)}</b> en ${r.cant} ventas.</p><p>${Math.abs(d) < 1 ? "La caja cuadró." : d > 0 ? `Sobraron ${fmt(d)}.` : `Faltaron ${fmt(-d)}.`}</p>
          ${puede("ajustesNegocio") && tocaRespaldo() ? `<div class="banda ambar respaldo-aviso">${icon("respaldo")}<span>${diasSinRespaldo() === Infinity ? "Todavía no descargaste ningún respaldo." : `Hace ${diasSinRespaldo()} días que no descargás un respaldo.`} Es un Excel con todo: carta, ventas, cajas, clientes y compras.</span><button class="btn chico" data-a="resp">${icon("bajar")} Descargar</button></div>` : ""}`,
        pie: `<button class="btn" data-a="imp">${icon("print")} Ticket de cierre</button><button class="btn btn-pri" data-cerrar>Listo</button>`,
      });
      fin.el.querySelector('[data-a="imp"]').onclick = () => opcionesTicket(ticketCierre(jc, r), { titulo: "Cierre de caja", nombre: nombreCierre(jc) });
      const br = fin.el.querySelector('[data-a="resp"]');
      if (br) br.onclick = async () => { if (await descargarRespaldo(br)) br.closest(".respaldo-aviso").innerHTML = `${icon("check")}<span>Respaldo descargado.</span>`; };
    };
  }

  const nombreCierre = (j) => `Cierre de caja ${new Date(j.aperturaTs).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-")}${j.turno ? ` ${j.turno.nombre}` : ""}`;

  function verJornada(j) {
    const c = j.cierre || {};
    const r = { porMedio: c.porMedio || {}, total: c.total || 0, cant: c.cant || 0, anuladas: c.anuladas || 0, ingresos: c.ingresos || 0, gastosEf: c.gastosEf || 0, retiros: c.retiros || 0, esperado: c.esperado || 0, propinas: c.propinas || 0, propinasMozo: c.propinasMozo || {} };
    const m = modal({
      titulo: `${j.turno ? `${j.turno.nombre} · ` : "Jornada "}${fechaHora(j.aperturaTs)}`,
      cuerpo: `
        ${Object.entries(r.porMedio).filter(([, v]) => v).map(([k, v]) => `<div class="co-linea"><span>${MEDIOS[k] || k}</span><span>${fmt(v)}</span></div>`).join("")}
        <div class="co-linea total"><span>Total vendido</span><b>${fmt(r.total)}</b></div>
        ${r.propinas ? `<div class="co-linea"><span>Propinas (aparte)</span><span>${fmt(r.propinas)}</span></div>` : ""}
        <div class="co-linea"><span>Esperado en efectivo</span><span>${fmt(r.esperado)}</span></div>
        <div class="co-linea"><span>Contado</span><span>${fmt(c.contado)}</span></div>
        <div class="co-linea"><span>Diferencia</span><b>${fmt(c.diferencia)}</b></div>
        ${c.nota ? `<p class="ayuda">${esc(c.nota)}</p>` : ""}
        <p class="ayuda">Abrió ${esc(j.apertura?.usuario || "")} · cerró ${esc(c.usuario || "")} a las ${hora(j.cierreTs)}</p>`,
      pie: `<button class="btn btn-pri" data-a="imp">${icon("print")} Ticket de cierre</button>`,
    });
    m.el.querySelector('[data-a="imp"]').onclick = () => opcionesTicket(ticketCierre(j, r), { titulo: "Cierre de caja", nombre: nombreCierre(j) });
  }

  root.addEventListener("submit", (e) => {
    if (e.target.id !== "fAbrir") return;
    e.preventDefault();
    abrir(Math.round(num(root.querySelector("#cFondo").value)));
  });
  root.addEventListener("click", async (e) => {
    const t = e.target;
    const bt = t.closest("[data-turno]");
    if (bt) { turnoElegido = bt.dataset.turno; root.querySelectorAll("[data-turno]").forEach((b) => b.classList.toggle("activo", b === bt)); return; }
    const uf = t.closest('[data-act="usarFondo"]');
    if (uf) { const i = root.querySelector("#cFondo"); i.value = uf.dataset.monto; i.focus(); return; }
    const mov = t.closest("[data-mov]");
    if (mov) return movimiento(mov.dataset.mov);
    const bm = t.closest("[data-borrarmov]");
    if (bm) {
      const mv = movs.find((x) => x.id === bm.dataset.borrarmov);
      if (mv && (await confirmar(`¿Borrar "${mv.desc || mv.tipo}" por ${fmt(mv.monto)}?`, { ok: "Borrar", peligro: true }))) {
        db.remove("movCaja", mv.id);
        log("caja", `Movimiento borrado: ${mv.tipo} ${fmt(mv.monto)} ${mv.desc || ""}`);
      }
      return;
    }
    const v = t.closest("[data-venta]");
    if (v) { const x = ventas.find((y) => y.id === v.dataset.venta); if (x) verVenta(x); return; }
    const jb = t.closest("[data-jornada]");
    if (jb) { const x = historial.find((y) => y.id === jb.dataset.jornada); if (x) verJornada(x); return; }
    const a = t.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "cerrar") cerrarCaja();
    else if (a.dataset.act === "arca") window.open(CONFIG.arcaUrl, "_blank", "noopener");
  });

  suscribir();
  render();
  return {
    update(claves) {
      if ((S.jornada?.id || null) !== jornadaId) suscribir();
      if (claves.some((k) => ["jornada", "comandas", "items", "config"].includes(k))) render();
    },
    unmount() { subs.forEach((u) => u()); },
  };
}
