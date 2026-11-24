// ============================================================
//  A&F · Carta en Excel: importar, exportar y plantilla
// ============================================================
// Idea tomada del importador de Dairus: reconoce los encabezados
// aunque tengan otros nombres, entiende precios "a la argentina",
// muestra qué va a cambiar ANTES de guardar y descarga un respaldo.
//
// También acepta una carta "cruda", sin encabezados: una fila con
// el nombre de la categoría y abajo los productos con su precio.
import { S, productoPorCodigo, categorias, log } from "./store.js";
import { db } from "./db.js";
import { esc, fmt, num, normalizar, icon, modal, toast, confirmar } from "./util.js";

const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
let xlsxP = null;
export function cargarXLSX() {
  if (!xlsxP) xlsxP = import(XLSX_URL).catch((e) => { xlsxP = null; throw e; });
  return xlsxP;
}
export const precargarExcel = () => cargarXLSX().catch(() => {});

// ── Columnas reconocidas (encabezado → campo) ──
const COLUMNAS = [
  { clave: "nombre", titulo: "Nombre", ancho: 34, alias: ["nombre", "producto", "productos", "item", "articulo", "plato"] },
  { clave: "categoria", titulo: "Categoría", ancho: 16, alias: ["categoria", "rubro", "seccion", "grupo", "tipo", "familia"] },
  { clave: "precio", titulo: "Precio", ancho: 10, alias: ["precio", "precios", "precio venta", "precio de venta", "pvp", "importe", "valor", "precio final"] },
  { clave: "descripcion", titulo: "Descripción (carta QR)", ancho: 40, alias: ["descripcion", "detalle", "ingredientes", "descripcion carta qr", "aclaracion"] },
  { clave: "sector", titulo: "Prepara (Cocina/Barra/Mozo)", ancho: 26, alias: ["prepara", "sector", "quien prepara", "destino", "area"] },
  { clave: "codigo", titulo: "Código de barras", ancho: 18, alias: ["codigo de barras", "codigo", "cod", "ean", "barcode", "cod barras"] },
  { clave: "controlStock", titulo: "Controla stock (Sí/No)", ancho: 20, alias: ["controla stock", "control stock", "control de stock"] },
  { clave: "stock", titulo: "Stock", ancho: 8, alias: ["stock", "existencia", "stock actual"] },
  { clave: "stockMin", titulo: "Stock mínimo", ancho: 13, alias: ["stock minimo", "minimo", "stock min", "avisar con menos de"] },
  { clave: "activo", titulo: "Activo (Sí/No)", ancho: 14, alias: ["activo", "disponible", "habilitado"] },
  { clave: "enCarta", titulo: "En la carta QR (Sí/No)", ancho: 20, alias: ["en la carta qr", "en carta", "carta qr", "mostrar en carta", "visible", "publicar"] },
];
const NOMBRE_SECTOR = { cocina: "Cocina", barra: "Barra", ninguno: "Mozo" };

const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
const vacio = (v) => txt(v) === "";
const limpiarEnc = (s) => normalizar(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const pareceNumero = (v) => typeof v === "number" || /^\$?\s*-?\d{1,3}(\.\d{3})*(,\d+)?$|^\$?\s*-?\d+([.,]\d+)?$/.test(txt(v));

function siNo(v) {
  if (typeof v === "boolean") return v;
  const t = normalizar(v);
  if (["si", "s", "yes", "1", "true", "x", "verdadero"].includes(t)) return true;
  if (["no", "n", "0", "false", "falso"].includes(t)) return false;
  return undefined;
}
function sector(v) {
  const t = normalizar(v);
  if (!t) return undefined;
  if (t.startsWith("coc")) return "cocina";
  if (t.startsWith("bar")) return "barra";
  if (/mozo|ningun|directo|sin prep|no prepara/.test(t)) return "ninguno";
  return undefined;
}
function codigo(v) {
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v)) : "";
  return txt(v).replace(/\s+/g, "");
}

// Si el archivo no dice quién lo prepara, se deduce (y se ve en la vista previa)
const BEBIDA = /cervez|pinta|chopp|trago|cocktail|coctel|vinos?\b|espumante|champ|cafe|cortado|capuchino|lagrima|\bte\b|infusion|bebida|gaseosa|\bjugos?\b|limonada|licuado|aperitivo|vermu|fernet|\bgin\b|whisk|vodka|\bron\b|campari|aperol|sin alcohol|\bagua\b|\bsoda\b|medialuna/;
const ENVASADO = /\blata\b|botella|porron|\b\d{3}\s?(ml|cc)\b|\b\d([.,]\d+)?\s?(l|lt|litros?)\b/;
function deducirSector(nombre, categoria, cod) {
  if (cod) return "ninguno";
  const t = normalizar(`${categoria} ${nombre}`);
  if (BEBIDA.test(t)) return ENVASADO.test(t) ? "ninguno" : "barra";
  return "cocina";
}

// "CERVEZAS" o "cervezas" → la categoría que ya existe ("Cervezas")
export function ajustarCategoria(c) {
  c = txt(c);
  if (!c) return "";
  const existente = categorias().find((x) => normalizar(x) === normalizar(c));
  if (existente) return existente;
  return c === c.toUpperCase() ? c.charAt(0) + c.slice(1).toLowerCase() : c;
}

// ── Lectura de la hoja ──
function mapearEncabezado(fila) {
  const map = {};
  (fila || []).forEach((celda, idx) => {
    const h = limpiarEnc(celda);
    if (!h) return;
    let mejor = null, peso = 0;
    for (const c of COLUMNAS) {
      for (const a of c.alias) {
        const p = h === a ? 100 + a.length : ` ${h} `.includes(` ${a} `) ? a.length : 0;
        if (p > peso) { peso = p; mejor = c.clave; }
      }
    }
    if (mejor && map[mejor] === undefined) map[mejor] = idx;
  });
  return map;
}

function detectar(aoa) {
  for (let r = 0; r < Math.min(15, aoa.length); r++) {
    const map = mapearEncabezado(aoa[r]);
    if (map.nombre === undefined && map.descripcion !== undefined) { map.nombre = map.descripcion; delete map.descripcion; }
    if (map.nombre !== undefined && map.precio !== undefined) return { map, desde: r + 1, conEncabezado: true };
  }
  // Sin encabezado: la columna con más textos es el nombre, la con más números el precio
  const cols = Math.max(0, ...aoa.slice(0, 80).map((f) => (f || []).length));
  let colNom = -1, colPre = -1, maxT = 0, maxN = 0;
  for (let c = 0; c < cols; c++) {
    let t = 0, n = 0;
    for (const f of aoa.slice(0, 80)) {
      const v = (f || [])[c];
      if (vacio(v)) continue;
      if (pareceNumero(v)) n++; else t++;
    }
    if (t > maxT) { maxT = t; colNom = c; }
    if (n > maxN && c !== colNom) { maxN = n; colPre = c; }
  }
  if (colPre === colNom) colPre = -1;
  return colNom >= 0 && colPre >= 0 ? { map: { nombre: colNom, precio: colPre }, desde: 0, conEncabezado: false } : null;
}

function leerFilas(aoa, det) {
  const { map, desde } = det;
  const val = (fila, k) => (map[k] === undefined ? undefined : fila[map[k]]);
  const extras = ["categoria", "descripcion", "sector", "codigo", "controlStock", "stock", "stockMin", "activo", "enCarta"];
  const out = [];
  let catActual = "";
  for (let r = desde; r < aoa.length; r++) {
    const fila = aoa[r] || [];
    const nombre = txt(val(fila, "nombre"));
    const pr = val(fila, "precio");
    const hayExtras = extras.some((k) => !vacio(val(fila, k)));
    if (!nombre && vacio(pr) && !hayExtras) continue;
    // Fila con solo un texto: es el título de una categoría
    if (nombre && vacio(pr) && !hayExtras) { catActual = nombre.replace(/[:\-–]+$/, "").trim(); continue; }
    const base = { fila: r + 1, nombre };
    if (!nombre) { out.push({ ...base, error: "Falta el nombre" }); continue; }
    const precio = Math.round(typeof pr === "number" ? pr : num(pr));
    if (!(precio > 0)) { out.push({ ...base, error: "Precio vacío o inválido" }); continue; }
    const cat = ajustarCategoria(txt(val(fila, "categoria")) || catActual);
    const cod = codigo(val(fila, "codigo"));
    const secExp = sector(val(fila, "sector"));
    const stockV = val(fila, "stock");
    const minV = val(fila, "stockMin");
    out.push({
      ...base, precio, categoria: cat, codigo: cod,
      sector: secExp || deducirSector(nombre, cat, cod),
      sectorExplicito: !!secExp,
      controlStock: siNo(val(fila, "controlStock")),
      stock: vacio(stockV) ? undefined : num(stockV),
      stockMin: vacio(minV) ? undefined : num(minV),
      activo: siNo(val(fila, "activo")),
      enCarta: siNo(val(fila, "enCarta")),
      descripcion: map.descripcion === undefined ? undefined : txt(val(fila, "descripcion")),
    });
  }
  return out;
}

// ── Comparación con lo que ya está cargado ──
function planificar(filas) {
  const porNombre = new Map(S.productos.map((p) => [normalizar(p.nombre), p]));
  const vistos = new Set();
  const plan = [];
  for (const f of filas) {
    if (f.error) { plan.push({ ...f, tipo: "error" }); continue; }
    const kn = "n:" + normalizar(f.nombre);
    const kc = f.codigo ? "c:" + f.codigo : null;
    if (vistos.has(kn) || (kc && vistos.has(kc))) { plan.push({ ...f, tipo: "error", error: "Repetido en el archivo" }); continue; }
    vistos.add(kn);
    if (kc) vistos.add(kc);
    const prev = (f.codigo && productoPorCodigo(f.codigo)) || porNombre.get(normalizar(f.nombre));
    if (!prev) { plan.push({ ...f, tipo: "nuevo" }); continue; }
    const c = {};
    if (f.precio !== Math.round(Number(prev.precio) || 0)) c.precio = f.precio;
    if (f.nombre !== prev.nombre) c.nombre = f.nombre;
    if (f.categoria && f.categoria !== (prev.categoria || "")) c.categoria = f.categoria;
    if (f.sectorExplicito && f.sector !== (prev.sector || "cocina")) c.sector = f.sector;
    if (f.codigo && f.codigo !== (prev.codigo || "")) c.codigo = f.codigo;
    if (f.controlStock !== undefined && f.controlStock !== !!prev.controlStock) c.controlStock = f.controlStock;
    if (f.stock !== undefined && f.stock !== (Number(prev.stock) || 0)) c.stock = f.stock;
    if (f.stockMin !== undefined && f.stockMin !== (Number(prev.stockMin) || 0)) c.stockMin = f.stockMin;
    if (f.activo !== undefined && f.activo !== (prev.activo !== false)) c.activo = f.activo;
    if (f.enCarta !== undefined && f.enCarta !== (prev.enCarta !== false)) c.enCarta = f.enCarta;
    if (f.descripcion !== undefined && f.descripcion !== (prev.descripcion || "")) c.descripcion = f.descripcion;
    plan.push({ ...f, tipo: Object.keys(c).length ? "cambia" : "igual", prev, cambios: c });
  }
  return plan;
}

// Los CSV que guarda Excel en Windows suelen venir en "ANSI" (Windows-1252), no en UTF-8
function decodificarTexto(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, ""); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

// ── Importar ──
export function abrirImportador() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.xls,.csv,.ods";
  input.onchange = async () => {
    const archivo = input.files?.[0];
    if (!archivo) return;
    let XLSX, wb;
    try { XLSX = await cargarXLSX(); }
    catch { toast("No se pudo cargar el lector de Excel. Revisá la conexión.", "error"); return; }
    try {
      const buf = await archivo.arrayBuffer();
      // raw: no convertir "7.200" en 7,2 (los CSV de Excel en español usan punto de miles)
      if (/\.(csv|txt)$/i.test(archivo.name)) wb = XLSX.read(decodificarTexto(buf), { type: "string", raw: true });
      else wb = XLSX.read(buf, { type: "array", raw: true });
    } catch (e) { toast("No se pudo leer el archivo: " + (e.message || e), "error"); return; }
    vistaPrevia(XLSX, wb, archivo.name);
  };
  input.click();
}

function vistaPrevia(XLSX, wb, nombreArchivo) {
  const hojas = wb.SheetNames.filter((n) => !/instruc|como completar/i.test(n));
  const leer = (nombreHoja) => {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, raw: true, defval: "", blankrows: false });
    const det = detectar(aoa);
    return det ? { det, plan: planificar(leerFilas(aoa, det)) } : null;
  };
  let hoja = hojas.find((h) => leer(h)) || hojas[0];
  let res = hoja ? leer(hoja) : null;
  let filtro = "cambios";
  // Reordenar la carta solo si el archivo es la carta completa (o casi):
  // un Excel con 3 precios nuevos no tiene que mandar esos 3 al principio.
  const esCartaCompleta = (r) => {
    if (!r || !S.productos.length) return true;
    const ids = new Set(r.plan.filter((p) => p.prev).map((p) => p.prev.id));
    return ids.size >= S.productos.length * 0.5;
  };
  let usarOrden = esCartaCompleta(res);
  let desactivarResto = false;

  const m = modal({
    titulo: "Importar carta",
    clase: "modal-ancho",
    cuerpo: `<div id="impCuerpo"></div>`,
    pie: `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-pri" id="impOk">Importar</button>`,
  });
  const $ = (s) => m.el.querySelector(s);

  function render() {
    const cuerpo = $("#impCuerpo");
    if (!res) {
      cuerpo.innerHTML = `<div class="banda rojo">${icon("alerta")} No encontré una columna de nombres y otra de precios en "${esc(nombreArchivo)}".</div>
        <p class="ayuda">Usá la plantilla (Productos → Excel → Descargar plantilla) o revisá que el archivo tenga al menos una columna "Nombre" y otra "Precio".</p>`;
      $("#impOk").disabled = true;
      return;
    }
    const { det, plan } = res;
    const n = { nuevo: 0, cambia: 0, igual: 0, error: 0 };
    plan.forEach((p) => n[p.tipo]++);
    const enArchivo = new Set(plan.filter((p) => p.prev).map((p) => p.prev.id));
    const resto = S.productos.filter((p) => !enArchivo.has(p.id) && p.activo !== false);
    const columnas = COLUMNAS.filter((c) => det.map[c.clave] !== undefined).map((c) => c.titulo.replace(/ \(.*\)$/, ""));
    const visibles = plan.filter((p) => filtro === "todos" || (filtro === "cambios" ? p.tipo === "nuevo" || p.tipo === "cambia" : p.tipo === filtro));

    cuerpo.innerHTML = `
      <p class="ayuda">${esc(nombreArchivo)}${hojas.length > 1 ? ` · Hoja <select class="input chico en-linea" id="impHoja">${hojas.map((h) => `<option ${h === hoja ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>` : ""}
        · ${det.conEncabezado ? `Columnas: ${esc(columnas.join(", "))}` : "Sin encabezados: tomé la columna de textos como nombre y la de números como precio"}</p>
      <div class="imp-resumen">
        <button class="imp-tot nuevo ${filtro === "nuevo" ? "activo" : ""}" data-f="nuevo"><b>${n.nuevo}</b> nuevos</button>
        <button class="imp-tot cambia ${filtro === "cambia" ? "activo" : ""}" data-f="cambia"><b>${n.cambia}</b> con cambios</button>
        <button class="imp-tot igual ${filtro === "igual" ? "activo" : ""}" data-f="igual"><b>${n.igual}</b> sin cambios</button>
        <button class="imp-tot error ${filtro === "error" ? "activo" : ""}" data-f="error"><b>${n.error}</b> con error</button>
      </div>
      <div class="chips"><button class="chip ${filtro === "cambios" ? "activo" : ""}" data-f="cambios">Nuevos y cambios</button><button class="chip ${filtro === "todos" ? "activo" : ""}" data-f="todos">Todo el archivo</button></div>
      <div class="imp-tabla">
        ${visibles.length ? visibles.slice(0, 300).map(filaHtml).join("") : `<p class="ayuda centro">Nada para mostrar en este filtro.</p>`}
        ${visibles.length > 300 ? `<p class="ayuda centro">… y ${visibles.length - 300} más</p>` : ""}
      </div>
      <div class="imp-opciones">
        <label class="switch"><input type="checkbox" id="impOrden" ${usarOrden ? "checked" : ""}><span>Ordenar la carta como en el archivo</span></label>
        ${S.productos.length ? `<label class="switch"><input type="checkbox" id="impResto" ${desactivarResto ? "checked" : ""}><span>Desactivar los ${resto.length} productos que no están en el archivo</span></label>` : ""}
        ${plan.some((p) => p.cambios?.stock !== undefined) ? `<p class="ayuda">${icon("alerta", "mini")} El stock del archivo reemplaza al stock cargado.</p>` : ""}
        ${plan.some((p) => p.tipo === "nuevo" && !p.sectorExplicito) ? `<p class="ayuda">Quién prepara cada producto nuevo se dedujo del nombre y la categoría. Revisalo en la columna "Prepara"; se puede cambiar después en cada producto.</p>` : ""}
      </div>`;
    const total = n.nuevo + n.cambia + (desactivarResto ? resto.length : 0);
    $("#impOk").disabled = !total && !usarOrden;
    $("#impOk").textContent = total ? `Importar (${n.nuevo} nuevos, ${n.cambia} cambios${desactivarResto && resto.length ? `, ${resto.length} desactivados` : ""})` : "Aplicar orden";
  }

  function filaHtml(p) {
    const estado = { nuevo: "Nuevo", cambia: "Cambia", igual: "Igual", error: esc(p.error || "Error") }[p.tipo];
    let precio = p.precio ? fmt(p.precio) : "";
    if (p.tipo === "cambia" && p.cambios.precio !== undefined) precio = `<s>${fmt(p.prev.precio)}</s> ${fmt(p.precio)}`;
    const otros = p.tipo === "cambia"
      ? Object.keys(p.cambios).filter((k) => k !== "precio").map((k) => ({ nombre: "nombre", categoria: "categoría", sector: "prepara", codigo: "código", controlStock: "control de stock", stock: "stock", stockMin: "mínimo", activo: "activo", enCarta: "carta QR", descripcion: "descripción" }[k])).join(", ")
      : "";
    return `<div class="imp-fila ${p.tipo}">
      <span class="imp-n">${p.fila}</span>
      <span class="imp-prod"><b>${esc(p.nombre || "—")}</b><small>${esc(p.categoria || (p.tipo === "error" ? "" : "Otros"))}${p.sector ? ` · ${NOMBRE_SECTOR[p.sector]}` : ""}${p.codigo ? ` · ${esc(p.codigo)}` : ""}${otros ? ` · cambia ${esc(otros)}` : ""}</small></span>
      <span class="imp-pre">${precio}</span>
      <span class="imp-est">${estado}</span>
    </div>`;
  }

  m.el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]");
    if (f) { filtro = f.dataset.f; render(); }
  });
  m.el.addEventListener("change", (e) => {
    if (e.target.id === "impHoja") { hoja = e.target.value; res = leer(hoja); usarOrden = esCartaCompleta(res); render(); }
    else if (e.target.id === "impOrden") { usarOrden = e.target.checked; render(); }
    else if (e.target.id === "impResto") { desactivarResto = e.target.checked; render(); }
  });

  $("#impOk").onclick = async () => {
    const { plan } = res;
    const nuevos = plan.filter((p) => p.tipo === "nuevo");
    const cambios = plan.filter((p) => p.tipo === "cambia");
    const enArchivo = new Set(plan.filter((p) => p.prev).map((p) => p.prev.id));
    const resto = desactivarResto ? S.productos.filter((p) => !enArchivo.has(p.id) && p.activo !== false) : [];
    if (resto.length && !(await confirmar(`Se van a desactivar ${resto.length} productos que no están en el archivo. No se borran: se pueden volver a activar.`, { ok: "Continuar" }))) return;

    // Respaldo antes de tocar nada
    if (S.productos.length && (cambios.length || resto.length || usarOrden)) {
      try { exportarCarta(XLSX, `carta-respaldo-${sello()}.xlsx`); } catch (e) { console.warn(e); }
    }

    const ops = [];
    const ordenNuevo = new Map(); // fila del plan → orden
    if (usarOrden) {
      let i = 0;
      for (const p of plan) if (p.tipo !== "error") ordenNuevo.set(p, ++i);
      const fuera = S.productos.filter((p) => !enArchivo.has(p.id)).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      fuera.forEach((p, k) => { if (p.orden !== i + k + 1) ops.push({ op: "update", col: "productos", id: p.id, data: { orden: i + k + 1 } }); });
    }
    let ordenMax = Math.max(0, ...S.productos.map((p) => Number(p.orden) || 0));
    for (const p of nuevos) {
      ops.push({ op: "set", col: "productos", id: db.newId("productos"), data: {
        nombre: p.nombre, categoria: p.categoria || "Otros", precio: p.precio, sector: p.sector, codigo: p.codigo || "",
        controlStock: p.controlStock ?? p.stock !== undefined,
        stock: p.stock ?? 0, stockMin: p.stockMin ?? 0, activo: p.activo ?? true,
        enCarta: p.enCarta ?? true, descripcion: p.descripcion || "",
        orden: usarOrden ? ordenNuevo.get(p) : ++ordenMax,
      } });
    }
    for (const p of plan.filter((x) => x.prev)) {
      const data = { ...(p.cambios || {}) };
      if (usarOrden && p.prev.orden !== ordenNuevo.get(p)) data.orden = ordenNuevo.get(p);
      if (Object.keys(data).length) ops.push({ op: "update", col: "productos", id: p.prev.id, data });
    }
    for (const p of resto) ops.push({ op: "update", col: "productos", id: p.id, data: { activo: false } });
    for (let i = 0; i < ops.length; i += 400) db.batch(ops.slice(i, i + 400));

    log("producto", `Carta importada desde ${nombreArchivo}: ${nuevos.length} nuevos, ${cambios.length} con cambios${resto.length ? `, ${resto.length} desactivados` : ""}`);
    m.cerrar();
    toast(`Listo: ${nuevos.length} nuevos, ${cambios.length} actualizados${resto.length ? `, ${resto.length} desactivados` : ""}`);
  };

  render();
}

// ── Exportar y plantilla ──
const sello = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

function hojaCarta(XLSX, filas) {
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS.map((c) => c.titulo), ...filas]);
  ws["!cols"] = COLUMNAS.map((c) => ({ wch: c.ancho }));
  return ws;
}

// Hoja "Carta" con el mismo formato que el importador (sirve para volver a cargarla)
export function hojaCartaActual(XLSX) {
  // S.productos ya está en el orden de las categorías (la fijada primera, las bebidas al final)
  const filas = [...S.productos]
    .map((p) => [
      p.nombre, p.categoria || "Otros", Math.round(Number(p.precio) || 0), p.descripcion || "", NOMBRE_SECTOR[p.sector || "cocina"],
      p.codigo || "", p.controlStock ? "Sí" : "No",
      p.controlStock ? Number(p.stock) || 0 : "", p.controlStock ? Number(p.stockMin) || 0 : "",
      p.activo === false ? "No" : "Sí", p.enCarta === false ? "No" : "Sí",
    ]);
  return hojaCarta(XLSX, filas);
}

function exportarCarta(XLSX, nombre) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaCartaActual(XLSX), "Carta");
  XLSX.writeFile(wb, nombre);
}

export async function descargarCarta() {
  if (!S.productos.length) return toast("Todavía no hay productos para exportar");
  try { exportarCarta(await cargarXLSX(), `carta-${(S.config.nombre || "AyF").replace(/[^\w-]+/g, "")}-${sello()}.xlsx`); }
  catch { toast("No se pudo generar el Excel. Revisá la conexión.", "error"); }
}

export async function descargarPlantilla() {
  let XLSX;
  try { XLSX = await cargarXLSX(); } catch { return toast("No se pudo generar el Excel. Revisá la conexión.", "error"); }
  const ejemplos = [
    ["Milanesa napolitana con papas", "Minutas", 15500, "Con jamón, salsa y muzzarella", "Cocina", "", "No", "", "", "Sí", "Sí"],
    ["Sorrentinos de jamón y queso", "Pastas", 13500, "Con salsa a elección", "Cocina", "", "No", "", "", "Sí", "Sí"],
    ["Pinta rubia", "Cervezas", 5500, "", "Barra", "", "No", "", "", "Sí", "Sí"],
    ["Gaseosa 500 ml", "Sin alcohol", 2800, "", "Mozo", "", "Sí", 24, 6, "Sí", "Sí"],
  ];
  const instrucciones = [
    ["Cómo completar la carta de A&F"],
    [""],
    ["• Nombre y Precio son obligatorios. Las demás columnas son opcionales."],
    ["• Categoría agrupa la carta (Cervezas, Pastas, Postres…). El orden de las filas es el orden en que la ven los mozos."],
    ["• Prepara: Cocina, Barra o Mozo (latas, botellas o agua que no pasan por cocina ni barra). Si queda vacío, el sistema lo deduce."],
    ["• Código de barras: solo para productos envasados. Conviene darle formato de Texto a esa columna para que Excel no lo redondee."],
    ["• Controla stock: Sí o No. Stock y Stock mínimo son cantidades; si se completan, reemplazan el stock cargado."],
    ["• Descripción: un texto corto que ven los clientes en la carta QR (ingredientes, acompañamiento). Opcional."],
    ["• Activo: Sí o No. Los productos inactivos no aparecen en la carta de los mozos ni en la carta QR."],
    ["• En la carta QR: Sí o No. Con No, el producto se puede vender pero los clientes no lo ven en la carta."],
    ["• Los precios pueden escribirse como 15500, 15.500 o $ 15.500."],
    [""],
    ["También se puede importar una carta sin encabezados: una fila con el nombre de la categoría y debajo los productos con su precio."],
    ["Para actualizar precios: en A&F, Productos → Excel → Exportar la carta actual; cambiá la columna Precio y volvé a importarla."],
    ["Antes de guardar, A&F muestra qué productos son nuevos, cuáles cambian y descarga una copia de la carta anterior."],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaCarta(XLSX, ejemplos), "Carta");
  const wi = XLSX.utils.aoa_to_sheet(instrucciones);
  wi["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wi, "Instrucciones");
  XLSX.writeFile(wb, "plantilla-carta-AyF.xlsx");
}

// Menú "Excel" de la pantalla de productos
export function menuExcel() {
  precargarExcel();
  const m = modal({
    titulo: "Carta en Excel",
    clase: "modal-chico",
    cuerpo: `<div class="menu-lista">
      <button data-x="importar">${icon("subir")}<span><b>Importar desde Excel</b><small>Agrega los productos nuevos y actualiza los que ya están. Antes de guardar te muestra los cambios.</small></span></button>
      <button data-x="plantilla">${icon("bajar")}<span><b>Descargar plantilla</b><small>Un Excel con las columnas y ejemplos, para completar la carta.</small></span></button>
      <button data-x="exportar">${icon("bajar")}<span><b>Exportar la carta actual</b><small>Sirve de respaldo o para cambiar precios en Excel y volver a importarla.</small></span></button>
    </div>`,
  });
  m.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-x]");
    if (!b) return;
    m.cerrar();
    if (b.dataset.x === "importar") abrirImportador();
    else if (b.dataset.x === "plantilla") descargarPlantilla();
    else descargarCarta();
  });
}
