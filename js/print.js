// ============================================================
//  A&F · Impresión en térmicas de 58 y 80 mm
// ============================================================
// Cada dispositivo elige su modo en Ajustes → Este dispositivo:
//  · sistema   → diálogo de impresión del navegador (impresora instalada
//                en Windows/Android, por USB o por red)
//  · bluetooth → Web Bluetooth directo a la térmica (Chrome Android/PC)
//  · usb       → WebUSB directo (Chrome Android con cable OTG)
//  · rawbt     → app RawBT de Android (Bluetooth clásico, USB y red)
//  · ninguna
//
// Los tickets se arman una sola vez como una lista de renglones y
// se traducen a HTML (modo sistema) o a comandos ESC/POS (resto).
import { S, dispositivo, guardarDispositivo, MEDIOS } from "./store.js";
import { esc, fmt, hora, fechaHora, toast, sleep, normalizar, modal, icon } from "./util.js";

// ── Renglones ──
const T = (txt, o = {}) => ({ t: "txt", txt: String(txt ?? ""), ...o });   // o: { al:'c'|'d', neg, grande }
const F = (izq, der, o = {}) => ({ t: "fila", izq: String(izq ?? ""), der: String(der ?? ""), ...o });
const L = () => ({ t: "linea" });
const E = (n = 1) => ({ t: "esp", n });

function encabezado(titulo) {
  const c = S.config || {};
  return [T(c.nombre || "A&F", { al: "c", neg: true, grande: true }), c.lema ? T(c.lema, { al: "c" }) : null, titulo ? T(titulo, { al: "c", neg: true }) : null, L()].filter(Boolean);
}
// Tickets que se lleva el cliente: logo, lema y datos del local
// (la comanda de cocina y el cierre de caja van sin logo: salen más rápido)
const LOGO = { t: "logo" };
function encabezadoCliente(titulo) {
  const c = S.config || {};
  const contacto = [c.direccion, c.whatsapp ? `WhatsApp ${c.whatsapp}` : ""].filter(Boolean);
  return [
    LOGO,
    c.lema ? T(c.lema, { al: "c", lema: true }) : null,
    ...contacto.map((x) => T(x, { al: "c" })),
    titulo ? E(1) : null,
    titulo ? T(titulo, { al: "c", neg: true }) : null,
    L(),
  ].filter(Boolean);
}

// Pedidos sin mesa: tipo y hora, para que se vean bien en el papel
const TIPO_TICKET = { llevar: "PARA LLEVAR", delivery: "DELIVERY", mostrador: "MOSTRADOR" };
const HORA_TICKET = { llevar: "Retira", delivery: "Entrega" };

// Comanda para cocina/barra. items: [{cant, desc, nota, sector}]
export function ticketComanda({ mesa, mozo, comensales, items, ts = Date.now(), reimpresion = false, pedido = null }) {
  const tipo = pedido?.tipo || items[0]?.tipo;
  const hh = pedido?.hora ?? items[0]?.hora;
  const porSector = {};
  for (const i of items) (porSector[i.sector || "cocina"] ||= []).push(i);
  const r = [];
  for (const [sector, its] of Object.entries(porSector)) {
    if (r.length) r.push(E(1), L());
    r.push(T(sector === "barra" ? "BARRA" : sector === "cocina" ? "COCINA" : "MOZO", { al: "c", neg: true }));
    if (TIPO_TICKET[tipo]) r.push(T(`*** ${TIPO_TICKET[tipo]} ***`, { al: "c", neg: true, grande: true }));
    if (hh && HORA_TICKET[tipo]) r.push(T(`${HORA_TICKET[tipo]} ${hh} h`, { al: "c", neg: true }));
    r.push(T(mesa, { al: "c", grande: true }));
    r.push(T(`${mozo || ""}${comensales ? ` · ${comensales} pers.` : ""} · ${hora(ts)}`, { al: "c" }));
    if (reimpresion) r.push(T("(REIMPRESIÓN)", { al: "c" }));
    r.push(L());
    for (const i of its) {
      r.push(T(`${i.cant} x ${i.desc}`, { grande: true }));
      if (i.detalle) r.push(T(`  > ${i.detalle}`, { neg: true, grande: true }));
      if (i.nota) r.push(T(`  > ${i.nota}`, { neg: true }));
    }
  }
  r.push(L(), E(2));
  return r;
}

// Precuenta y ticket de venta (no fiscal)
function lineasItems(items) {
  const r = [];
  for (const i of items) {
    r.push(T(i.desc));
    if (i.detalle) r.push(T(`  ${i.detalle}`));
    r.push(F(`  ${i.cant} x ${fmt(i.precio)}`, fmt(i.cant * i.precio)));
  }
  return r;
}
// Datos del cliente para retirar o para el delivery
function lineasCliente(tipo, cli = {}, hh = "") {
  if (!TIPO_TICKET[tipo] || tipo === "mostrador") return [];
  const r = [T(`*** ${TIPO_TICKET[tipo]} ***`, { al: "c", neg: true })];
  if (cli.nombre) r.push(T(cli.nombre, { neg: true, grande: true }));
  if (cli.telefono) r.push(T(`Tel: ${cli.telefono}`));
  if (cli.direccion) r.push(T(`Dir: ${cli.direccion}`, { neg: true }));
  if (hh) r.push(T(`${HORA_TICKET[tipo]}: ${hh} h`));
  if (cli.nota) r.push(T(`Nota: ${cli.nota}`));
  r.push(L());
  return r;
}

export function ticketPrecuenta({ mesa, mozo, items, total, pedido = null }) {
  return [
    ...encabezadoCliente(pedido?.tipo === "delivery" ? "PEDIDO" : "PRECUENTA"),
    ...lineasCliente(pedido?.tipo, pedido?.cliente, pedido?.hora),
    F(mesa, hora(Date.now())), T(`Atendió: ${mozo || ""}`), L(),
    ...lineasItems(items), L(),
    F("TOTAL", fmt(total), { neg: true, grande: true }),
    ...(S.config.propina !== false && S.config.propinaPrecuenta && !pedido
      ? [F(`Propina sugerida (${Number(S.config.propinaPct) || 10}%)`, fmt(Math.round(total * (Number(S.config.propinaPct) || 10) / 100))), F("Total con propina", fmt(total + Math.round(total * (Number(S.config.propinaPct) || 10) / 100)))]
      : []),
    E(1),
    T("No válido como factura", { al: "c" }), E(3),
  ];
}
export function ticketVenta(v) {
  const r = [
    ...encabezadoCliente(""),
    ...lineasCliente(v.tipo, v.cliente, v.hora),
    F(`Nº ${v.nro}`, fechaHora(v.ts)), F(v.mesaNombre || "", `Atendió: ${v.mozo || ""}`), L(),
    ...lineasItems(v.items), L(),
    F("Subtotal", fmt(v.subtotal)),
  ];
  if (v.descuento?.monto) r.push(F(`Descuento${v.descuento.tipo === "pct" ? ` ${v.descuento.valor}%` : ""}`, "-" + fmt(v.descuento.monto)));
  r.push(F("TOTAL", fmt(v.total), { neg: true, grande: true }));
  if (v.propina) r.push(F("Propina", fmt(v.propina)), F("Total pagado", fmt(v.total + v.propina), { neg: true }));
  r.push(L());
  for (const p of v.pagos || []) r.push(F(p.medio === "cuenta" && p.clienteNombre ? `Cta. cte. ${p.clienteNombre}` : MEDIOS[p.medio] || p.medio, fmt(p.monto)));
  if (v.vuelto) r.push(F("Su vuelto", fmt(v.vuelto)));
  r.push(E(1));
  if (S.config.pieTicket) r.push(T(S.config.pieTicket, { al: "c", neg: true }));
  r.push(T("No válido como factura", { al: "c" }));
  r.push(E(3));
  return r;
}
export function ticketCierre(j, res) {
  const r = [
    ...encabezado("CIERRE DE CAJA"),
    ...(j.turno ? [T(`Turno: ${j.turno.nombre}`, { neg: true, al: "c" })] : []),
    F("Apertura", fechaHora(j.aperturaTs)), F("Cierre", fechaHora(j.cierreTs || Date.now())),
    F("Abrió", j.apertura?.usuario || ""), F("Cerró", j.cierre?.usuario || ""), L(),
    T("COBRADO POR MEDIO DE PAGO", { neg: true }),
  ];
  for (const [m, monto] of Object.entries(res.porMedio)) if (monto) r.push(F(MEDIOS[m] || m, fmt(monto)));
  r.push(F("Total vendido", fmt(res.total), { neg: true }), F("Cantidad de ventas", String(res.cant)));
  if (res.propinas) {
    r.push(F("Propinas cobradas", fmt(res.propinas), { neg: true }));
    for (const [mozo, monto] of Object.entries(res.propinasMozo || {})) r.push(F(`  ${mozo}`, fmt(monto)));
  }
  r.push(L());
  r.push(T("EFECTIVO", { neg: true }), F("Fondo inicial", fmt(j.apertura?.fondo || 0)), F("+ Cobrado en efectivo", fmt(res.porMedio.efectivo || 0)));
  if (res.ingresos) r.push(F("+ Ingresos", fmt(res.ingresos)));
  if (res.gastosEf) r.push(F("- Gastos", fmt(res.gastosEf)));
  if (res.retiros) r.push(F("- Retiros", fmt(res.retiros)));
  r.push(F("Esperado en caja", fmt(res.esperado), { neg: true }));
  if (j.cierre) {
    r.push(F("Contado", fmt(j.cierre.contado)));
    const d = j.cierre.diferencia || 0;
    r.push(F("Diferencia", (d > 0 ? "+" : "") + fmt(d), { neg: true }));
  }
  if (res.anuladas) r.push(L(), F("Ventas anuladas", String(res.anuladas)));
  r.push(E(3));
  return r;
}
export function ticketPrueba() {
  const d = dispositivo();
  return [...encabezadoCliente("PRUEBA DE IMPRESIÓN"), T(`Dispositivo ${d.codigo} · ${d.impresora.ancho} mm`), T("Ñandú, acción, café, pingüino"), F("Izquierda", "Derecha"), T("Texto grande", { grande: true }), L(), E(3)];
}

// ── Salida HTML (modo sistema) ──
function html(lineas, ancho) {
  const g = (l, s) => `${l.lema ? "l " : ""}${l.neg ? "n " : ""}${l.grande ? "g " : ""}${l.al === "c" ? "c " : l.al === "d" ? "d " : ""}${s || ""}`;
  return lineas.map((l) => {
    if (l.t === "logo") return `<img class="logo" src="img/logo.svg" alt="${esc(S.config?.nombre || "A&F")}">`;
    if (l.t === "linea") return "<hr>";
    if (l.t === "esp") return `<div style="height:${l.n * 1.2}em"></div>`;
    if (l.t === "fila") return `<div class="f ${g(l)}"><span>${esc(l.izq)}</span><span>${esc(l.der)}</span></div>`;
    return `<div class="${g(l)}">${esc(l.txt)}</div>`;
  }).join("");
}
function imprimirSistema(lineas, ancho) {
  const zona = document.getElementById("zonaImpresion");
  const anchoUtil = ancho === 58 ? 48 : 72;
  let estilo = document.getElementById("estiloImpresion");
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "estiloImpresion";
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@media print { @page { size: ${ancho}mm auto; margin: 0; } #zonaImpresion { width: ${anchoUtil}mm; } }`;
  zona.innerHTML = html(lineas, ancho);
  const limpiar = () => { zona.innerHTML = ""; window.removeEventListener("afterprint", limpiar); };
  window.addEventListener("afterprint", limpiar);
  // Esperar el logo antes de abrir el diálogo (si tarda, se imprime igual)
  const imgs = [...zona.querySelectorAll("img")].filter((i) => !i.complete);
  Promise.race([Promise.all(imgs.map((i) => new Promise((ok) => { i.onload = i.onerror = ok; }))), sleep(1500)]).then(() => window.print());
  return true;
}

// Hoja A4 (códigos QR de las mesas) por el diálogo de impresión
export function imprimirHoja(htmlHoja) {
  const zona = document.getElementById("zonaImpresion");
  let estilo = document.getElementById("estiloImpresion");
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "estiloImpresion";
    document.head.appendChild(estilo);
  }
  estilo.textContent = "@media print { @page { size: A4 portrait; margin: 10mm; } #zonaImpresion { width: auto; } }";
  zona.innerHTML = htmlHoja;
  const limpiar = () => { zona.innerHTML = ""; window.removeEventListener("afterprint", limpiar); };
  window.addEventListener("afterprint", limpiar);
  setTimeout(() => window.print(), 80);
}

// ── ESC/POS ──
const CP850 = { "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "Á": 0xb5, "É": 0x90, "Í": 0xd6, "Ó": 0xe0, "Ú": 0xe9, "ü": 0x81, "Ü": 0x9a, "¿": 0xa8, "¡": 0xad, "°": 0xf8, "º": 0xa7, "ª": 0xa6, "·": 0xfa, "×": 0x9e };
function bytesTexto(s, sinAcentos) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (!sinAcentos && CP850[ch] !== undefined) out.push(CP850[ch]);
    else if ("—–".includes(ch)) out.push(45);
    else if ("“”«»".includes(ch)) out.push(34);
    else {
      const a = normalizar(ch);
      const base = ch === ch.toUpperCase() ? a.toUpperCase() : a;
      out.push(base && base.charCodeAt(0) < 127 && base.charCodeAt(0) >= 32 ? base.charCodeAt(0) : 63);
    }
  }
  return out;
}
function cortarEn(texto, ancho) {
  const res = [];
  for (const parrafo of String(texto).split("\n")) {
    let linea = "";
    for (const pal of parrafo.split(" ")) {
      if (!linea) linea = pal;
      else if ((linea + " " + pal).length <= ancho) linea += " " + pal;
      else { res.push(linea); linea = pal; }
      while (linea.length > ancho) { res.push(linea.slice(0, ancho)); linea = linea.slice(ancho); }
    }
    res.push(linea);
  }
  return res;
}
export function escpos(lineas, { ancho = 80, cortar = true, sinAcentos = false, logo = null } = {}) {
  const cols = ancho === 58 ? 32 : 48;
  const o = [0x1b, 0x40, 0x1b, 0x74, 2]; // inicializar + página de códigos PC850 (ñ y acentos)
  const txt = (s) => o.push(...bytesTexto(s, sinAcentos), 0x0a);
  for (const l of lineas) {
    if (l.t === "logo") {
      if (logo) { o.push(0x1b, 0x61, 1); for (const b of logo) o.push(b); o.push(0x0a); }
      else { o.push(0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11); txt(S.config?.nombre || "A&F"); o.push(0x1d, 0x21, 0, 0x1b, 0x45, 0); }
      continue;
    }
    if (l.t === "esp") { o.push(0x1b, 0x64, l.n); continue; }
    if (l.t === "linea") { o.push(0x1b, 0x61, 0); txt("-".repeat(cols)); continue; }
    const w = l.grande ? Math.floor(cols / 2) : cols;
    o.push(0x1b, 0x61, l.al === "c" ? 1 : l.al === "d" ? 2 : 0);
    o.push(0x1b, 0x45, l.neg ? 1 : 0);
    o.push(0x1d, 0x21, l.grande ? 0x11 : 0x00);
    if (l.t === "fila") {
      const der = l.der.slice(0, w);
      const izqMax = Math.max(1, w - der.length - 1);
      const izqs = cortarEn(l.izq, izqMax);
      izqs.forEach((iz, k) => {
        if (k < izqs.length - 1) txt(iz);
        else txt(iz + " ".repeat(Math.max(1, w - iz.length - der.length)) + der);
      });
    } else {
      cortarEn(l.txt, w).forEach(txt);
    }
    o.push(0x1d, 0x21, 0x00, 0x1b, 0x45, 0);
  }
  o.push(0x1b, 0x61, 0);
  if (cortar) o.push(0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00);
  else o.push(0x1b, 0x64, 2);
  return new Uint8Array(o);
}

// ── Bluetooth (BLE) ──
const SERVICIOS_BT = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
];
let bt = { device: null, char: null };
export const btConectada = () => !!bt.char;

async function prepararBT(device) {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const servicios = await server.getPrimaryServices();
  for (const s of servicios) {
    const chars = await s.getCharacteristics();
    const c = chars.find((x) => x.properties.writeWithoutResponse || x.properties.write);
    if (c) {
      bt = { device, char: c };
      if (!device._afListener) {
        device._afListener = true;
        device.addEventListener("gattserverdisconnected", () => { bt.char = null; });
      }
      return;
    }
  }
  throw new Error("La impresora no ofrece un canal de escritura conocido");
}
export async function conectarBluetooth() {
  if (!navigator.bluetooth) throw new Error("Este navegador no tiene Bluetooth web. Usá Chrome en Android o en la PC (o la app RawBT).");
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS_BT });
  await prepararBT(device);
  guardarDispositivo({ impresora: { btNombre: device.name || "Impresora", btId: device.id } });
  return device.name || "Impresora";
}
async function enviarBT(bytes) {
  if (!bt.char) {
    if (bt.device) await prepararBT(bt.device);
    else if (navigator.bluetooth?.getDevices) {
      const ds = await navigator.bluetooth.getDevices();
      const id = dispositivo().impresora.btId;
      const d = ds.find((x) => x.id === id) || (ds.length === 1 ? ds[0] : null);
      if (d) await prepararBT(d);
    }
  }
  if (!bt.char) throw new Error("Conectá la impresora Bluetooth (Ajustes → Este dispositivo)");
  const sinResp = bt.char.properties.writeWithoutResponse && bt.char.writeValueWithoutResponse;
  for (let i = 0; i < bytes.length; i += 100) {
    const parte = bytes.slice(i, i + 100);
    if (sinResp) await bt.char.writeValueWithoutResponse(parte);
    else await bt.char.writeValue(parte);
    await sleep(sinResp ? 25 : 5);
  }
}

// ── USB (WebUSB) ──
let usb = null;
export const usbConectada = () => !!usb;
async function prepararUSB(device) {
  if (!device.opened) await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const ifaces = [...device.configuration.interfaces].sort((a, b) => (b.alternates[0]?.interfaceClass === 7) - (a.alternates[0]?.interfaceClass === 7));
  for (const itf of ifaces) {
    for (const alt of itf.alternates) {
      const ep = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
      if (!ep) continue;
      await device.claimInterface(itf.interfaceNumber);
      if (alt.alternateSetting) await device.selectAlternateInterface(itf.interfaceNumber, alt.alternateSetting);
      usb = { device, ep: ep.endpointNumber };
      return;
    }
  }
  throw new Error("No encontré la salida de datos de la impresora USB");
}
export async function conectarUSB() {
  if (!navigator.usb) throw new Error("Este navegador no tiene USB web. Usá Chrome; en Windows elegí el modo 'Impresora de la PC'.");
  const device = await navigator.usb.requestDevice({ filters: [] });
  await prepararUSB(device);
  return device.productName || "Impresora USB";
}
async function enviarUSB(bytes) {
  if (!usb && navigator.usb?.getDevices) {
    const ds = await navigator.usb.getDevices();
    if (ds[0]) await prepararUSB(ds[0]);
  }
  if (!usb) throw new Error("Conectá la impresora USB (Ajustes → Este dispositivo)");
  await usb.device.transferOut(usb.ep, bytes);
}

// ── RawBT (Android) ──
function enviarRawBT(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  location.href = "intent:base64," + btoa(bin) + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
}

// Reconecta en silencio al abrir la app (si el navegador lo permite)
export async function reconectarImpresora() {
  const imp = dispositivo().impresora;
  try {
    if (imp.modo === "usb" && navigator.usb?.getDevices) {
      const ds = await navigator.usb.getDevices();
      if (ds[0]) await prepararUSB(ds[0]);
    } else if (imp.modo === "bluetooth" && navigator.bluetooth?.getDevices) {
      const ds = await navigator.bluetooth.getDevices();
      const d = ds.find((x) => x.id === imp.btId);
      if (d) await prepararBT(d);
    }
  } catch (e) { console.warn("No se pudo reconectar la impresora", e); }
}

// ── Logo ──
let logoP = null;
function cargarLogo() {
  if (!logoP) {
    logoP = new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = mal;
      img.src = "img/logo.svg";
    });
    logoP.catch(() => { logoP = null; });
  }
  return logoP;
}
// Logo en blanco y negro para la térmica (comando de imagen GS v 0)
async function logoTermica(cols) {
  const img = await cargarLogo();
  const puntos = cols === 32 ? 384 : 576;                  // ancho imprimible de 58 y 80 mm
  const w = Math.round((puntos * 0.56) / 8) * 8;
  const h = Math.round((w * img.height) / img.width);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const bpl = w / 8;
  const datos = new Uint8Array(bpl * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11 < 170) datos[y * bpl + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return [0x1d, 0x76, 0x30, 0, bpl & 0xff, bpl >> 8, h & 0xff, h >> 8, ...datos];
}

// ── Ticket como imagen y PDF (vista previa y "Guardar en el dispositivo") ──
// Se dibuja con letra de ancho fijo y las mismas columnas que la térmica,
// así el PDF queda igual al papel.
const MONO = '"DM Mono", ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';
async function dibujarTicket(lineas, ancho = 80) {
  const cols = ancho === 58 ? 32 : 48;
  const fs = 26, alto = Math.round(fs * 1.38), pad = 28;
  try { await Promise.race([document.fonts.load(`${fs}px "DM Mono"`), sleep(1200)]); } catch {}
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  ctx.font = `${fs}px ${MONO}`;
  const cw = ctx.measureText("0").width;
  // Renglones ya cortados como en la impresora
  const filas = [];
  const logo = lineas.some((l) => l.t === "logo") ? await cargarLogo().catch(() => null) : null;
  const hasta = lineas.length - [...lineas].reverse().findIndex((l) => l.t !== "esp"); // sin el avance de papel del final
  for (const l of lineas.slice(0, hasta)) {
    if (l.t === "logo") {
      if (logo) filas.push({ logo });
      else filas.push({ txt: S.config?.nombre || "A&F", al: "c", grande: true, neg: true });
      continue;
    }
    if (l.t === "esp") { filas.push({ esp: l.n }); continue; }
    if (l.t === "linea") { filas.push({ linea: true }); continue; }
    const w = l.grande ? Math.floor(cols / 2) : cols;
    const base = { neg: l.neg, grande: l.grande, al: l.al, lema: l.lema };
    if (l.t === "fila") {
      const der = l.der.slice(0, w);
      const izqs = cortarEn(l.izq, Math.max(1, w - der.length - 1));
      izqs.forEach((iz, k) => filas.push({ ...base, al: "", txt: k < izqs.length - 1 ? iz : iz + " ".repeat(Math.max(1, w - iz.length - der.length)) + der }));
    } else cortarEn(l.txt, w).forEach((t) => filas.push({ ...base, txt: t }));
  }
  const anchoLogo = Math.round(cols * cw * 0.56);
  const altoFila = (f) => (f.logo ? Math.round((anchoLogo * f.logo.height) / f.logo.width) + 10 : f.esp ? f.esp * alto * 0.6 : f.linea ? alto * 0.7 : f.grande ? alto * 2 : f.lema ? alto * 1.25 : alto);
  cv.width = Math.ceil(cols * cw + pad * 2);
  cv.height = Math.ceil(filas.reduce((h, f) => h + altoFila(f), 0) + pad * 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "middle";
  let y = pad;
  for (const f of filas) {
    const h = altoFila(f);
    if (f.logo) {
      ctx.drawImage(f.logo, (cv.width - anchoLogo) / 2, y, anchoLogo, h - 10);
    } else if (f.lema) {
      ctx.font = `italic 600 ${Math.round(fs * 1.15)}px Georgia, "Times New Roman", serif`;
      const tw = ctx.measureText(f.txt).width;
      ctx.fillText(f.txt, (cv.width - tw) / 2, y + h / 2);
    } else if (f.linea) {
      ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pad, y + h / 2); ctx.lineTo(cv.width - pad, y + h / 2); ctx.stroke();
    } else if (!f.esp) {
      const tam = f.grande ? fs * 2 : fs;
      ctx.font = `${f.neg || f.grande ? "600 " : ""}${tam}px ${MONO}`;
      const tw = ctx.measureText(f.txt).width;
      const x = f.al === "c" ? (cv.width - tw) / 2 : f.al === "d" ? cv.width - pad - tw : pad;
      ctx.fillText(f.txt, x, y + h / 2);
    }
    y += h;
  }
  return cv;
}

// PDF de una página con la imagen del ticket (sin librerías: un JPEG dentro de un PDF mínimo)
function pdfDeJpeg(jpeg, wPx, hPx, anchoMm) {
  const W = (anchoMm * 72) / 25.4, H = (W * hPx) / wPx;
  const n2 = (x) => x.toFixed(2);
  const enc = new TextEncoder();
  const partes = [];
  const offsets = [];
  let largo = 0;
  const poner = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; partes.push(b); largo += b.length; };
  const objeto = (n, cuerpo, stream) => {
    offsets[n] = largo;
    poner(`${n} 0 obj\n${cuerpo}\n`);
    if (stream) { poner("stream\n"); poner(stream); poner("\nendstream\n"); }
    poner("endobj\n");
  };
  const contenido = enc.encode(`q ${n2(W)} 0 0 ${n2(H)} 0 0 cm /Im0 Do Q`);
  poner("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objeto(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  objeto(4, `<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  objeto(5, `<< /Length ${contenido.length} >>`, contenido);
  const xref = largo;
  poner(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((k) => `${String(offsets[k]).padStart(10, "0")} 00000 n \n`).join("")}`);
  poner(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(partes, { type: "application/pdf" });
}

const nombreArchivo = (s) => String(s || "Ticket").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

/** Guarda el ticket como PDF en el dispositivo (Descargas). */
export async function guardarTicket(lineas, nombre = "Ticket") {
  const ancho = dispositivo().impresora.ancho === 58 ? 58 : 80;
  const cv = await dibujarTicket(lineas, ancho);
  const jpeg = new Uint8Array(await (await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.92))).arrayBuffer());
  const blob = pdfDeJpeg(jpeg, cv.width, cv.height, ancho);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo(nombre) + ".pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(`Ticket guardado: ${a.download}`);
  return true;
}

const MODOS_IMP = { sistema: "Diálogo de impresión", bluetooth: "Impresora Bluetooth", usb: "Impresora USB", rawbt: "RawBT" };
/**
 * Ventana del ticket: vista previa + Imprimir + Guardar en el dispositivo.
 * Sin impresora configurada, "Imprimir" abre el diálogo de impresión del navegador.
 */
export function opcionesTicket(lineas, { titulo = "Ticket", nombre = "Ticket" } = {}) {
  const imp = dispositivo().impresora;
  const conImpresora = imp.modo && imp.modo !== "ninguna";
  const m = modal({
    titulo,
    clase: "modal-chico modal-ticket",
    cuerpo: `<div class="tk-previa"><p class="ayuda">Preparando…</p></div>`,
    pie: `<button class="btn" data-tk="guardar">${icon("bajar")} Guardar en el dispositivo</button>
          <button class="btn btn-pri" data-tk="imprimir">${icon("print")} Imprimir</button>
          <p class="ayuda tk-modo">${conImpresora ? `${MODOS_IMP[imp.modo] || imp.modo} · ${imp.ancho} mm` : "Sin impresora configurada: se abre el diálogo de impresión"}</p>`,
  });
  dibujarTicket(lineas, imp.ancho === 58 ? 58 : 80).then((cv) => {
    const img = new Image();
    img.alt = "Vista previa del ticket";
    img.src = cv.toDataURL("image/png");
    const prev = m.el.querySelector(".tk-previa");
    prev.innerHTML = "";
    prev.appendChild(img);
  }).catch(() => { m.el.querySelector(".tk-previa").innerHTML = ""; });
  m.el.querySelector('[data-tk="imprimir"]').onclick = async () => {
    if (!conImpresora) { imprimirSistema(lineas, imp.ancho === 58 ? 58 : 80); return; }
    if (await imprimir(lineas)) toast("Ticket enviado a la impresora");
  };
  m.el.querySelector('[data-tk="guardar"]').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await guardarTicket(lineas, nombre); }
    catch (err) { console.error(err); toast("No se pudo guardar el ticket", "error"); }
    b.disabled = false;
  };
  return m;
}

export const __logoTermica = logoTermica; // para las pruebas
// El logo en papel se puede apagar por dispositivo (Ajustes → Este dispositivo)
async function conLogo(lineas, imp) {
  if (imp.logo === false || !lineas.some((l) => l.t === "logo")) return imp;
  try { return { ...imp, logo: await logoTermica(imp.ancho === 58 ? 32 : 48) }; } catch { return imp; }
}

export async function imprimir(lineas, { silencioso = false } = {}) {
  const imp = dispositivo().impresora;
  try {
    switch (imp.modo) {
      case "sistema": return imprimirSistema(lineas, imp.ancho);
      case "bluetooth": await enviarBT(escpos(lineas, await conLogo(lineas, imp))); return true;
      case "usb": await enviarUSB(escpos(lineas, await conLogo(lineas, imp))); return true;
      case "rawbt": enviarRawBT(escpos(lineas, await conLogo(lineas, imp))); return true;
      default:
        if (!silencioso) toast("Este dispositivo no tiene impresora (Ajustes → Este dispositivo)");
        return false;
    }
  } catch (e) {
    toast("No se pudo imprimir: " + (e.message || e), "error");
    return false;
  }
}
