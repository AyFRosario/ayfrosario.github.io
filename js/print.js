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
import { esc, fmt, hora, fechaHora, toast, sleep, normalizar } from "./util.js";

// ── Renglones ──
const T = (txt, o = {}) => ({ t: "txt", txt: String(txt ?? ""), ...o });   // o: { al:'c'|'d', neg, grande }
const F = (izq, der, o = {}) => ({ t: "fila", izq: String(izq ?? ""), der: String(der ?? ""), ...o });
const L = () => ({ t: "linea" });
const E = (n = 1) => ({ t: "esp", n });

function encabezado(titulo) {
  const c = S.config || {};
  return [T(c.nombre || "A&F", { al: "c", neg: true, grande: true }), c.lema ? T(c.lema, { al: "c" }) : null, titulo ? T(titulo, { al: "c", neg: true }) : null, L()].filter(Boolean);
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
    ...encabezado(pedido?.tipo === "delivery" ? "PEDIDO" : "PRECUENTA"),
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
    ...encabezado(""),
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
  r.push(E(1), T("No válido como factura", { al: "c" }));
  if (S.config.pieTicket) r.push(T(S.config.pieTicket, { al: "c" }));
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
  return [...encabezado("PRUEBA DE IMPRESIÓN"), T(`Dispositivo ${d.codigo} · ${d.impresora.ancho} mm`), T("Ñandú, acción, café, pingüino"), F("Izquierda", "Derecha"), T("Texto grande", { grande: true }), L(), E(3)];
}

// ── Salida HTML (modo sistema) ──
function html(lineas, ancho) {
  const g = (l, s) => `${l.neg ? "n " : ""}${l.grande ? "g " : ""}${l.al === "c" ? "c " : l.al === "d" ? "d " : ""}${s || ""}`;
  return lineas.map((l) => {
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
  setTimeout(() => window.print(), 30);
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
export function escpos(lineas, { ancho = 80, cortar = true, sinAcentos = false } = {}) {
  const cols = ancho === 58 ? 32 : 48;
  const o = [0x1b, 0x40, 0x1b, 0x74, 2]; // inicializar + página de códigos PC850 (ñ y acentos)
  const txt = (s) => o.push(...bytesTexto(s, sinAcentos), 0x0a);
  for (const l of lineas) {
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

export async function imprimir(lineas, { silencioso = false } = {}) {
  const imp = dispositivo().impresora;
  try {
    switch (imp.modo) {
      case "sistema": return imprimirSistema(lineas, imp.ancho);
      case "bluetooth": await enviarBT(escpos(lineas, imp)); return true;
      case "usb": await enviarUSB(escpos(lineas, imp)); return true;
      case "rawbt": enviarRawBT(escpos(lineas, imp)); return true;
      default:
        if (!silencioso) toast("Este dispositivo no tiene impresora (Ajustes → Este dispositivo)");
        return false;
    }
  } catch (e) {
    toast("No se pudo imprimir: " + (e.message || e), "error");
    return false;
  }
}
