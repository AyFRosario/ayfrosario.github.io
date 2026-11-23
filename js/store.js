// ============================================================
//  A&F · Estado compartido, roles y datos del dispositivo
// ============================================================
import { db } from "./db.js";

export const CONFIG_DEF = {
  nombre: "A&F",
  lema: "Comé como en casa",
  pieTicket: "¡Gracias por venir!",
  mozoCobra: false,
  medios: ["efectivo", "mp", "debito", "credito", "transferencia"],
  direccion: "",
  horario: "",
  instagram: "",
  whatsapp: "",
  propina: true,          // se puede sumar propina al cobrar
  propinaPct: 10,         // porcentaje sugerido
  propinaPrecuenta: false, // imprimir la propina sugerida en la precuenta
  turnos: [],             // turnos de caja: [{ id, nombre, desde: "08:00", hasta: "16:00" }]; vacío = una sola caja
};

export const S = {
  user: null,      // { uid, email }
  perfil: null,    // documento usuarios/{uid}
  rol: null,
  config: { ...CONFIG_DEF },
  mesas: [],
  productos: [],
  comandas: [],    // abiertas o con cuenta pedida
  items: [],       // ítems de comandas sin cobrar (cerrado == false)
  jornada: null,   // caja abierta
  usuarios: [],
  insumos: [],
  clientes: [],
  reservas: [],        // de hoy en adelante
  recordatorios: [],
  cargados: new Set(), // colecciones que ya respondió el servidor
};

const subs = new Set();
export const onStore = (fn) => (subs.add(fn), () => subs.delete(fn));
export function emit(clave) {
  subs.forEach((fn) => { try { fn(clave); } catch (e) { console.error(e); } });
}

export const ROLES = { admin: "Administrador", dueno: "Dueño", encargado: "Encargado", mozo: "Mozo", cocina: "Cocina" };
// El Administrador (quien desarrolla y mantiene el sistema) no aparece en Usuarios ni en el respaldo para los demás
export const visibleParaMi = (u) => u?.rol !== "admin" || S.rol === "admin";
export const rolesAsignables = () => Object.entries(ROLES).filter(([k]) => k !== "admin" || S.rol === "admin");
export const MEDIOS = { efectivo: "Efectivo", mp: "Mercado Pago", debito: "Débito", credito: "Crédito", transferencia: "Transferencia", cuenta: "Cuenta corriente" };
export const SECTORES = { cocina: "Cocina", barra: "Barra", ninguno: "Lo sirve el mozo" };
export const ESTADOS_ITEM = { nuevo: "Sin enviar", pendiente: "Pendiente", preparando: "En preparación", listo: "Listo", entregado: "Entregado", anulado: "Anulado" };

const PERMISOS = {
  admin: ["salon", "mesa", "cocina", "caja", "reportes", "resultado", "productos", "reservas", "compras", "clientes", "recordatorios", "usuarios", "ajustes", "ajustesNegocio", "anular"],
  // "resultado" (gastos fijos y resultado del mes) es solo para el dueño: incluye sueldos
  dueno: ["salon", "mesa", "cocina", "caja", "reportes", "resultado", "productos", "reservas", "compras", "clientes", "recordatorios", "usuarios", "ajustes", "ajustesNegocio", "anular"],
  encargado: ["salon", "mesa", "cocina", "caja", "reportes", "productos", "reservas", "compras", "clientes", "recordatorios", "ajustes", "ajustesNegocio", "anular"],
  mozo: ["salon", "mesa", "reservas", "ajustes"],
  cocina: ["cocina", "ajustes"],
};
export function puede(accion) {
  if (accion === "cobrar") return ["admin", "dueno", "encargado"].includes(S.rol) || (S.rol === "mozo" && !!S.config.mozoCobra);
  return (PERMISOS[S.rol] || []).includes(accion);
}

// ── Turnos de caja ──
// Cada bar define cuántas veces abre y cierra la caja por día. Sin turnos (o uno solo) no se elige nada.
export const turnosCaja = () => (Array.isArray(S.config.turnos) ? S.config.turnos.filter((t) => t && t.nombre) : []);
const aMinutos = (hhmm) => { const [h, m] = String(hhmm || "").split(":").map(Number); return ((h || 0) * 60 + (m || 0)) % 1440; };
// El turno que corresponde a una hora. Si cae fuera de todos, el próximo en empezar.
export function turnoPorHora(ts = Date.now(), lista = turnosCaja()) {
  if (!lista.length) return null;
  const d = new Date(ts);
  const m = d.getHours() * 60 + d.getMinutes();
  const dentro = (t) => {
    const a = aMinutos(t.desde), b = aMinutos(t.hasta);
    if (a === b) return true;
    return a < b ? m >= a && m < b : m >= a || m < b; // los que pasan la medianoche
  };
  return lista.find(dentro) || [...lista].sort((x, y) => ((aMinutos(x.desde) - m + 1440) % 1440) - ((aMinutos(y.desde) - m + 1440) % 1440))[0];
}
// Nombre del turno de una venta (las ventas viejas, sin turno guardado, se ubican por la hora)
export function turnoDeVenta(v) {
  if (v.turno?.nombre) return v.turno.nombre;
  const lista = turnosCaja();
  return lista.length > 1 ? turnoPorHora(v.ts, lista)?.nombre || "" : "";
}

// ── Derivados ──
export const itemsDe = (cid) => S.items.filter((i) => i.comandaId === cid);
export const vigentes = (its) => its.filter((i) => i.estado !== "anulado");
export const totalItems = (its) => vigentes(its).reduce((s, i) => s + (Number(i.precio) || 0) * (Number(i.cant) || 0), 0);
// Junta renglones iguales (mismo producto y precio) para tickets y cobro
export function agrupar(its) {
  const m = new Map();
  for (const i of its) {
    const k = `${i.productoId}|${i.precio}|${i.desc}|${i.detalle || ""}`;
    if (m.has(k)) m.get(k).cant += Number(i.cant) || 0;
    else m.set(k, { productoId: i.productoId, desc: i.desc, ...(i.detalle ? { detalle: i.detalle } : {}), precio: Number(i.precio) || 0, cant: Number(i.cant) || 0 });
  }
  return [...m.values()];
}
export const comandaDeMesa = (m) => (m?.comandaId ? S.comandas.find((c) => c.id === m.comandaId) || null : null);

// ── Fechas ──
export const fechaStr = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const deFechaStr = (s, hhmm = "00:00") => { const [y, m, d] = s.split("-").map(Number); const [h, mi] = hhmm.split(":").map(Number); return new Date(y, m - 1, d, h || 0, mi || 0).getTime(); };
export function fechaLarga(s) {
  const d = new Date(deFechaStr(s, "12:00"));
  const hoy = fechaStr(), man = fechaStr(Date.now() + 86400000);
  const base = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return s === hoy ? `Hoy, ${base}` : s === man ? `Mañana, ${base}` : base.charAt(0).toUpperCase() + base.slice(1);
}

// WhatsApp: números argentinos con o sin 0/15/54
export function waLink(numero, texto = "") {
  let d = String(numero || "").replace(/\D+/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  // Con el 15 quedan 12 dígitos: se saca el 15 que va después de la característica
  if (d.length === 12) {
    if (d.startsWith("11") && d.slice(2, 4) === "15") d = "11" + d.slice(4);
    else if (d.slice(3, 5) === "15") d = d.slice(0, 3) + d.slice(5);
    else if (d.slice(4, 6) === "15") d = d.slice(0, 4) + d.slice(6);
  }
  return `https://wa.me/549${d}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

// ── Recordatorios (vencimientos) ──
export function estadoRecordatorio(r) {
  const dias = Math.ceil((deFechaStr(r.vence) - deFechaStr(fechaStr())) / 86400000);
  return { dias, estado: dias < 0 ? "vencido" : dias <= (Number(r.avisar) || 15) ? "proximo" : "ok" };
}

// ── Insumos y recetas ──
export const UNIDADES = { kg: "kg", g: "g", l: "l", ml: "ml", u: "u." };
export function fmtCantidad(n, unidad) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return `${v.toLocaleString("es-AR", { maximumFractionDigits: 3 })} ${UNIDADES[unidad] || unidad || ""}`.trim();
}
export const usosDeInsumo = (id) => S.productos.filter((p) => (p.receta || []).some((r) => r.insumoId === id));
// Insumos que consume una cantidad de un producto: [{ id, cant }]
export function consumoReceta(productoId, cant) {
  const p = S.productos.find((x) => x.id === productoId);
  return (p?.receta || [])
    .filter((r) => r.insumoId && r.cant > 0 && S.insumos.some((i) => i.id === r.insumoId))
    .map((r) => ({ id: r.insumoId, cant: Math.round(r.cant * cant * 1000) / 1000 }));
}
// Suma consumos de varios ítems por insumo → operaciones de stock
export function opsInsumos(consumos, signo = -1) {
  const tot = {};
  for (const c of consumos) tot[c.id] = (tot[c.id] || 0) + c.cant;
  return Object.entries(tot).map(([id, cant]) => ({ op: "update", col: "insumos", id, data: { stock: { __op: "inc", n: signo * Math.round(cant * 1000) / 1000 } } }));
}
export const faltantesDe = (p) => (p.receta || []).map((r) => S.insumos.find((i) => i.id === r.insumoId)).filter((i) => i && (Number(i.stock) || 0) <= 0);
export const insumosBajos = () => S.insumos.filter((i) => (Number(i.stockMin) || 0) > 0 && (Number(i.stock) || 0) <= (Number(i.stockMin) || 0));

// UPC-A (12 dígitos) y EAN-13 con 0 adelante son el mismo producto
export function productoPorCodigo(codigo) {
  const c = String(codigo || "").trim();
  if (!c) return null;
  const variantes = [c];
  if (c.length === 12) variantes.push("0" + c);
  if (c.length === 13 && c[0] === "0") variantes.push(c.slice(1));
  return S.productos.find((p) => p.codigo && variantes.includes(String(p.codigo).trim())) || null;
}

export function categorias() {
  const orden = new Map();
  for (const p of S.productos) {
    const c = p.categoria || "Otros";
    const o = Number(p.orden) || 0;
    if (!orden.has(c) || o < orden.get(c)) orden.set(c, o);
  }
  const lista = [...orden.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map((x) => x[0]);
  // Una categoría fijada (Productos → Categorías) va siempre primera: en la comanda,
  // en Productos y en la carta QR, aunque se vuelva a importar el Excel.
  const fija = S.config?.catFija;
  return fija && lista.includes(fija) ? [fija, ...lista.filter((c) => c !== fija)] : lista;
}

export function sectoresMesas() {
  const out = [];
  for (const m of S.mesas) if (!out.includes(m.sector || "Salón")) out.push(m.sector || "Salón");
  return out;
}

// ── Este dispositivo (se guarda en el navegador, no en la nube) ──
const DISP_KEY = "af_dispositivo";
const DISP_DEF = {
  codigo: "",
  impresora: { modo: "sistema", ancho: 80, cortar: true, sinAcentos: false, alEnviar: false, btNombre: "" },
  cocina: { sector: "cocina", auto: false, sonido: true },
};
// Pantallas que se pueden elegir para abrir la app en cada dispositivo
export const PANTALLAS_INICIO = [["salon", "Salón"], ["caja", "Caja"], ["reservas", "Reservas"], ["cocina", "Cocina y barra"], ["productos", "Productos"]];

export function dispositivo() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DISP_KEY)); } catch {}
  d = {
    ...DISP_DEF, ...(d || {}),
    impresora: { ...DISP_DEF.impresora, ...(d?.impresora || {}) },
    cocina: { ...DISP_DEF.cocina, ...(d?.cocina || {}) },
  };
  if (!d.codigo) {
    d.codigo = "C" + Math.floor(10 + Math.random() * 89);
    try { localStorage.setItem(DISP_KEY, JSON.stringify(d)); } catch {}
  }
  return d;
}
export function guardarDispositivo(cambios) {
  const d = dispositivo();
  const n = {
    ...d, ...cambios,
    impresora: { ...d.impresora, ...(cambios.impresora || {}) },
    cocina: { ...d.cocina, ...(cambios.cocina || {}) },
  };
  try { localStorage.setItem(DISP_KEY, JSON.stringify(n)); } catch {}
  return n;
}

// Nº de venta: código del dispositivo + correlativo por jornada.
// Nunca choca entre dispositivos y funciona sin conexión.
export function nroVenta(jornadaId) {
  const k = "af_seq_" + jornadaId;
  let n = 0;
  try { n = parseInt(localStorage.getItem(k), 10) || 0; } catch {}
  n += 1;
  try { localStorage.setItem(k, String(n)); } catch {}
  return `${dispositivo().codigo}-${String(n).padStart(4, "0")}`;
}

// ── Registro de actividad ──
export function log(tipo, desc, extra = {}) {
  db.add("logs", { tipo, desc, ...extra, ts: Date.now(), uid: S.user?.uid || "", usuario: S.perfil?.nombre || "" });
}
