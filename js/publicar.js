// ============================================================
//  A&F · Publicación de la carta pública (carta QR)
// ============================================================
// La página carta.html no inicia sesión: lee UN solo documento,
// negocios/{id}/publico/carta, con la carta ya armada. Así cada
// cliente que escanea el QR gasta una sola lectura y no puede ver
// nada más que lo que está en la carta (ni stock, ni ventas).
//
// Cualquier dispositivo con rol encargado o dueño mantiene ese
// documento al día: cuando cambian productos, mesas o datos del
// negocio, lo vuelve a publicar (solo si algo cambió de verdad).
import { S, onStore, categorias, waLink } from "./store.js";
import { db } from "./db.js";
import { resumenGrupos } from "./opciones.js";

let ultimoHash = null;
let timer = 0;
let soltar = [];

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function construirCarta() {
  const c = S.config;
  const visibles = S.productos.filter((p) => p.activo !== false && p.enCarta !== false);
  const cats = categorias()
    .map((cat) => ({
      n: cat,
      p: visibles
        .filter((p) => (p.categoria || "Otros") === cat)
        .map((p) => {
          const item = { n: p.nombre, p: Math.round(Number(p.precio) || 0) };
          if (p.descripcion) item.d = p.descripcion;
          const op = resumenGrupos(p);
          if (op) item.o = op;
          if (p.controlStock && (Number(p.stock) || 0) <= 0) item.a = 1; // agotado
          return item;
        }),
    }))
    .filter((cat) => cat.p.length);
  return {
    v: 1,
    nombre: c.nombre || "A&F",
    lema: c.lema || "",
    direccion: c.direccion || "",
    horario: c.horario || "",
    instagram: c.instagram || "",
    facebook: c.facebook || "",
    mapa: c.mapa || "",
    whatsapp: c.whatsapp || "",
    wa: waLink(c.whatsapp).replace("https://wa.me/", ""),
    reservas: c.reservasCarta !== false,
    mesas: Object.fromEntries(S.mesas.map((m) => [m.id, m.nombre])),
    cats,
  };
}

function publicar() {
  // No publicar hasta tener los datos reales (si no, se publicaría una carta vacía)
  if (ultimoHash === null || !["productos", "config", "mesas"].every((k) => S.cargados.has(k))) return;
  const json = JSON.stringify(construirCarta());
  const h = hash(json);
  if (h === ultimoHash) return;
  ultimoHash = h;
  db.set("publico", "carta", { json, hash: h, ts: Date.now() });
}

const programar = (ms) => { clearTimeout(timer); timer = setTimeout(publicar, ms); };

export function iniciarPublicacion() {
  detenerPublicacion();
  soltar.push(db.listen("publico", { id: "carta" }, (d) => {
    ultimoHash = d?.hash || "";
    programar(1500);
  }));
  soltar.push(onStore((k) => { if (["productos", "config", "mesas"].includes(k)) programar(3000); }));
}

export function detenerPublicacion() {
  clearTimeout(timer);
  soltar.forEach((u) => { try { u(); } catch {} });
  soltar = [];
  ultimoHash = null;
}

// Dirección pública de la carta (con el id de mesa si corresponde)
export function urlCarta(mesaId = "", { reservar = false } = {}) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "") + "carta.html";
  const q = new URLSearchParams();
  if (mesaId) q.set("m", mesaId);
  if (new URLSearchParams(location.search).has("demo")) q.set("demo", "");
  if (reservar) q.set("reservar", "");
  const s = q.toString().replace(/=(&|$)/g, "$1");
  return s ? `${base}?${s}` : base;
}

// Enlace para reservar: la misma carta, con el formulario de reserva ya abierto
export const urlReservas = () => urlCarta("", { reservar: true });
