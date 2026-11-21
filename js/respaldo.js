// ============================================================
//  A&F · Respaldo completo en Excel
// ============================================================
// Descarga un .xlsx con todo lo importante: carta (en el mismo formato
// del importador, así se puede volver a cargar), insumos, ventas con
// detalle, cajas, clientes, proveedores, compras, reservas y más.
// Guarda la fecha del último respaldo para recordarlo al cerrar caja.
import { S, MEDIOS, ROLES, fmtCantidad, log, visibleParaMi, puede, turnoDeVenta } from "./store.js";
import { db } from "./db.js";
import { toast } from "./util.js";
import { cargarXLSX, hojaCartaActual } from "./importar.js";

export const DIAS_RESPALDO = 7;
export const diasSinRespaldo = () => (S.config.ultimoRespaldo ? Math.floor((Date.now() - S.config.ultimoRespaldo) / 86400000) : Infinity);
export const tocaRespaldo = () => diasSinRespaldo() >= DIAS_RESPALDO;

const sello = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
// Fecha completa con año (las pantallas muestran la versión corta)
const fechaHora = (ts) => (ts ? new Date(ts).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "") : "");
const medios = (pagos) => (pagos || []).map((p) => `${MEDIOS[p.medio] || p.medio}${p.clienteNombre ? ` (${p.clienteNombre})` : ""}: ${Math.round(p.monto)}`).join(" · ");

export async function descargarRespaldo(boton) {
  const txt = boton?.innerHTML;
  if (boton) { boton.disabled = true; boton.textContent = "Armando el respaldo…"; }
  try {
    const XLSX = await cargarXLSX();
    const q = (col, opts = {}) => db.query(col, opts).catch((e) => { console.warn("respaldo", col, e); return []; });
    const [ventas, jornadas, movCaja, clientes, movClientes, proveedores, compras, reservas, recordatorios, logs] = await Promise.all([
      q("ventas"), q("jornadas"), q("movCaja"), q("clientes"), q("movClientes"), q("proveedores"), q("compras"),
      q("reservas"), q("recordatorios"), q("logs", { orderBy: ["ts", "desc"], limit: 3000 }),
    ]);
    const gastos = puede("resultado") ? await q("gastos") : []; // incluye sueldos: solo dueño y administrador
    const por = (k) => (a, b) => (a[k] || 0) - (b[k] || 0);
    const wb = XLSX.utils.book_new();
    const hoja = (nombre, filas, anchos) => {
      const ws = XLSX.utils.aoa_to_sheet(filas);
      ws["!cols"] = anchos.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, nombre);
    };
    const r = Math.round;

    XLSX.utils.book_append_sheet(wb, hojaCartaActual(XLSX), "Carta");
    hoja("Insumos", [["Insumo", "Unidad", "Stock", "Mínimo", "Costo por unidad"],
      ...S.insumos.map((i) => [i.nombre, i.unidad, Number(i.stock) || 0, Number(i.stockMin) || 0, r(i.costo || 0)])], [30, 8, 10, 10, 16]);
    hoja("Recetas", [["Producto", "Insumo", "Cantidad"],
      ...S.productos.flatMap((p) => (p.receta || []).map((x) => { const i = S.insumos.find((y) => y.id === x.insumoId); return [p.nombre, i?.nombre || "(borrado)", i ? fmtCantidad(x.cant, i.unidad) : x.cant]; }))], [34, 30, 14]);
    hoja("Mesas", [["Mesa", "Sector", "Lugares"], ...S.mesas.map((m) => [m.nombre, m.sector || "", m.capacidad || ""])], [16, 16, 10]);

    ventas.sort(por("ts"));
    hoja("Ventas", [["Fecha", "Turno", "Nº", "Tipo", "Mesa / pedido", "Cliente", "Teléfono", "Dirección", "Mozo", "Subtotal", "Descuento", "Total", "Pagos", "Estado"],
      ...ventas.map((v) => [fechaHora(v.ts), turnoDeVenta(v), v.nro || "", { llevar: "Para llevar", delivery: "Delivery", mostrador: "Venta rápida" }[v.tipo] || "Mesa", v.mesaNombre || "", v.cliente?.nombre || "", v.cliente?.telefono || "", v.cliente?.direccion || "", v.mozo || "", r(v.subtotal || 0), r(v.descuento?.monto || 0), r(v.total || 0), medios(v.pagos), v.estado === "anulada" ? "Anulada" : "OK"])], [17, 14, 12, 12, 20, 18, 14, 24, 14, 11, 11, 11, 40, 9]);
    hoja("Ventas detalle", [["Fecha", "Nº", "Producto", "Cantidad", "Precio", "Subtotal", "Estado"],
      ...ventas.flatMap((v) => (v.items || []).map((i) => [fechaHora(v.ts), v.nro || "", i.desc, i.cant, r(i.precio), r(i.precio * i.cant), v.estado === "anulada" ? "Anulada" : "OK"]))], [17, 12, 34, 9, 10, 11, 9]);

    jornadas.sort(por("aperturaTs"));
    hoja("Cajas", [["Turno", "Abrió", "Por", "Cerró", "Por", "Fondo", "Vendido", "Ventas", "Efectivo esperado", "Contado", "Diferencia", "Nota"],
      ...jornadas.map((j) => { const c = j.cierre || {}; return [j.turno?.nombre || "", fechaHora(j.aperturaTs), j.apertura?.usuario || "", j.cierreTs ? fechaHora(j.cierreTs) : "Abierta", c.usuario || "", r(j.apertura?.fondo || 0), j.cierreTs ? r(c.total || 0) : "", j.cierreTs ? c.cant || 0 : "", j.cierreTs ? r(c.esperado || 0) : "", j.cierreTs ? r(c.contado || 0) : "", j.cierreTs ? r(c.diferencia || 0) : "", c.nota || ""]; })], [14, 17, 12, 17, 12, 10, 12, 8, 16, 11, 11, 24]);
    movCaja.sort(por("ts"));
    hoja("Movimientos de caja", [["Fecha", "Tipo", "Descripción", "Monto", "Usuario"],
      ...movCaja.map((m) => [fechaHora(m.ts), m.tipo, m.desc || "", r(m.monto), m.usuario || ""])], [17, 10, 36, 11, 14]);

    hoja("Clientes", [["Cliente", "Teléfono", "Saldo (debe)", "Nota"], ...clientes.map((c) => [c.nombre, c.telefono || "", r(c.saldo || 0), c.nota || ""])], [26, 16, 13, 30]);
    movClientes.sort(por("ts"));
    hoja("Cuentas corrientes", [["Fecha", "Cliente", "Movimiento", "Monto", "Medio", "Detalle", "Usuario"],
      ...movClientes.map((m) => [fechaHora(m.ts), m.clienteNombre || "", m.tipo, r(m.monto), MEDIOS[m.medio] || "", m.desc || "", m.usuario || ""])], [17, 24, 12, 11, 14, 24, 14]);

    hoja("Proveedores", [["Proveedor", "Rubro", "Teléfono", "Le debés", "Nota"], ...proveedores.map((p) => [p.nombre, p.rubro || "", p.telefono || "", r(p.deuda || 0), p.nota || ""])], [26, 16, 16, 12, 30]);
    compras.sort(por("ts"));
    hoja("Compras", [["Fecha", "Tipo", "Proveedor", "Detalle", "Total", "Pago", "Comprobante", "Estado"],
      ...compras.map((c) => [fechaHora(c.ts), c.tipo === "pago" ? "Pago" : "Compra", c.proveedorNombre || "", (c.lineas || []).map((l) => `${l.nombre} ${fmtCantidad(l.cant, l.unidad)}`).join(", "), r(c.total || 0), { caja: "Caja", otro: "Otro medio", debe: "Debe" }[c.pago] || "", c.comprobante || "", c.estado === "anulada" ? "Anulada" : "OK"])], [17, 8, 22, 50, 11, 11, 18, 9]);

    if (puede("resultado")) {
      gastos.sort((a, b) => String(a.mes).localeCompare(String(b.mes)) || String(a.categoria).localeCompare(String(b.categoria)));
      hoja("Gastos fijos", [["Mes", "Categoría", "Detalle", "Monto", "Se repite", "Cargó"], ...gastos.map((g) => [g.mes, g.categoria || "", g.desc || "", r(g.monto || 0), g.fijo ? "Sí" : "No", g.usuario || ""])], [9, 30, 30, 12, 10, 14]);
    }

    reservas.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
    hoja("Reservas", [["Día", "Hora", "Nombre", "Personas", "Teléfono", "Estado", "Nota"],
      ...reservas.map((x) => [x.fecha, x.hora, x.nombre, x.personas, x.telefono || "", x.estado, x.nota || ""])], [12, 7, 24, 9, 16, 12, 30]);
    hoja("Recordatorios", [["Qué", "Vence", "Cada (meses)", "Nota"], ...recordatorios.map((x) => [x.titulo, x.vence, x.cadaMeses || "", x.nota || ""])], [36, 12, 12, 30]);
    hoja("Usuarios", [["Nombre", "Rol", "Activo"], ...S.usuarios.filter(visibleParaMi).map((u) => [u.nombre, ROLES[u.rol] || u.rol, u.activo === false ? "No" : "Sí"])], [24, 14, 8]);
    hoja("Registro", [["Fecha", "Usuario", "Tipo", "Detalle"], ...logs.map((l) => [fechaHora(l.ts), l.usuario || "", l.tipo || "", l.desc || ""])], [17, 14, 12, 70]);

    XLSX.writeFile(wb, `respaldo-${(S.config.nombre || "AyF").replace(/[^\w-]+/g, "")}-${sello()}.xlsx`);
    db.merge("config", "general", { ultimoRespaldo: Date.now() });
    log("respaldo", `Respaldo completo descargado (${ventas.length} ventas)`);
    toast("Respaldo descargado");
    return true;
  } catch (e) {
    console.error(e);
    toast("No se pudo armar el respaldo. Revisá la conexión.", "error");
    return false;
  } finally {
    if (boton) { boton.disabled = false; boton.innerHTML = txt; }
  }
}
