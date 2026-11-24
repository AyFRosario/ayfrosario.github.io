// ============================================================
//  A&F · Arranque, sesión, menú y navegación
// ============================================================
import { CONFIG } from "./config.js";
import { initDB, db, auth, MODO, onError } from "./db.js";
import { S, emit, onStore, puede, ROLES, CONFIG_DEF, fechaStr, categorias, ordenarProductos, dispositivo } from "./store.js";
import { firmaHTML } from "./firma.js";
import { $, esc, icon, toast, modal, confirmar, iniciales, fmt, normalizar } from "./util.js";
import { reconectarImpresora } from "./print.js";
import { iniciarPublicacion, detenerPublicacion } from "./publicar.js";
import { nuevaVentaRapida, rapidasLocales } from "./pedidos.js";
import { activarDeslizables } from "./desliza.js";

const VERSION = "1.2.8";
import * as vSalon from "./vistas/salon.js";
import * as vMesa from "./vistas/mesa.js";
import * as vCocina from "./vistas/cocina.js";
import * as vCaja from "./vistas/caja.js";
import * as vProductos from "./vistas/productos.js";
import * as vReportes from "./vistas/reportes.js";
import * as vResultado from "./vistas/resultado.js";
import * as vUsuarios from "./vistas/usuarios.js";
import * as vAjustes from "./vistas/ajustes.js";
import * as vReservas from "./vistas/reservas.js";
import * as vCompras from "./vistas/compras.js";
import * as vClientes from "./vistas/clientes.js";
import * as vRecordatorios from "./vistas/recordatorios.js";

// El orden de RUTAS es el orden del menú, de la más usada a la menos usada.
// Es el mismo en la PC (menú de la izquierda) y en el celular (barra de abajo:
// las primeras 4 y el resto en "Más").
const RUTAS = {
  // Venta rápida (mostrador): primera del menú. No es una pantalla: abre una venta nueva desde cualquier lado.
  // La app igual abre en Salón (ver rutaInicio), así no se crea una venta cada vez que se entra.
  rapida: { mod: { mount() {} }, perm: "mesa", titulo: "Venta rápida", icono: "flash", menu: true, grupo: "Servicio", accion: () => nuevaVentaRapida({ reemplazar: true }) },
  salon: { mod: vSalon, perm: "salon", titulo: "Salón", icono: "mesas", menu: true, grupo: "Servicio" },
  caja: { mod: vCaja, perm: "caja", titulo: "Caja", icono: "caja", menu: true, grupo: "Servicio" },
  reservas: { mod: vReservas, perm: "reservas", titulo: "Reservas", icono: "calendario", menu: true, grupo: "Servicio" },
  cocina: { mod: vCocina, perm: "cocina", titulo: "Cocina y barra", icono: "cocina", menu: true, grupo: "Servicio" },
  productos: { mod: vProductos, perm: "productos", titulo: "Productos", icono: "productos", menu: true, grupo: "Administración" },
  compras: { mod: vCompras, perm: "compras", titulo: "Compras", icono: "camion", menu: true, grupo: "Administración" },
  reportes: { mod: vReportes, perm: "reportes", titulo: "Reportes", icono: "grafico", menu: true, grupo: "Administración" },
  resultado: { mod: vResultado, perm: "resultado", titulo: "Gastos y resultado", icono: "dinero", menu: true, grupo: "Administración" },
  clientes: { mod: vClientes, perm: "clientes", titulo: "Clientes", icono: "libreta", menu: true, grupo: "Administración" },
  recordatorios: { mod: vRecordatorios, perm: "recordatorios", titulo: "Vencimientos", icono: "alarma", menu: true, grupo: "Administración" },
  usuarios: { mod: vUsuarios, perm: "usuarios", titulo: "Usuarios", icono: "usuarios", menu: true, grupo: "Configuración" },
  ajustes: { mod: vAjustes, perm: "ajustes", titulo: "Ajustes", icono: "ajustes", menu: true, grupo: "Configuración" },
  mesa: { mod: vMesa, perm: "mesa", titulo: "Mesa" },
};


const appEl = document.getElementById("app");
let unsubs = [];
let actual = null;
let iniciada = false;

const escuchar = (col, opts, cb) => unsubs.push(db.listen(col, opts, cb));
function limpiar() {
  unsubs.forEach((u) => { try { u(); } catch {} });
  unsubs = [];
  actual?.inst?.unmount?.();
  actual = null;
  iniciada = false;
  S.cargados.clear();
  migro = false;
  detenerPublicacion();
}

function pantalla(html) {
  appEl.innerHTML = `<div class="pantalla-centro"><div class="tarjeta-login">
    <img src="img/logo.svg" alt="A&F" class="login-logo">${html}${firmaHTML("firma-login")}</div></div>`;
}
const cargando = (txt = "Cargando…") => pantalla(`<p class="ayuda centro">${esc(txt)}</p>`);

function mensajeError(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "No tenés permiso para hacer eso.";
  if (c.includes("unavailable")) return "Sin conexión con el servidor. Se reintenta solo.";
  if (c.includes("resource-exhausted")) return "Se alcanzó el límite del plan de Firebase.";
  return "Error: " + (e?.message || e);
}

// ── Inicio ──
async function arrancar() {
  cargando();
  try {
    await initDB();
  } catch (e) {
    console.error(e);
    pantalla(`<p class="error">No se pudo iniciar la base de datos. Revisá la conexión y la configuración de Firebase.</p><button class="btn btn-pri btn-bloque" onclick="location.reload()">Reintentar</button>`);
    return;
  }
  onError((e, ctx) => toast(mensajeError(e), "error"));
  window.addEventListener("online", actualizarBarra);
  window.addEventListener("offline", actualizarBarra);
  window.addEventListener("hashchange", navegar);
  // Filas de etiquetas: en la PC se deslizan con la rueda, arrastrando o con flechas
  activarDeslizables(".chips.desliza");
  // F2: venta rápida desde cualquier pantalla (PC del mostrador)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "F2" || !iniciada || !S.rol || !puede("mesa") || document.querySelector(".modal-fondo, .escaner")) return;
    e.preventDefault();
    nuevaVentaRapida();
  });
  auth.onUser(alCambiarUsuario);
}

function alCambiarUsuario(u) {
  limpiar();
  S.user = u;
  S.perfil = null;
  S.rol = null;
  if (!u) { marcarSesion(false); return pantallaLogin(); }
  cargando("Verificando usuario…");
  let resuelto = false;
  const espera = setTimeout(() => {
    if (!resuelto) pantalla(`<p class="error">No se pudo verificar tu usuario. Revisá la conexión.</p>
      <button class="btn btn-bloque" id="btnSalir">Salir</button>`), $("#btnSalir").onclick = () => auth.logout();
  }, 12000);

  escuchar("usuarios", { id: u.uid, meta: true }, async (p, meta) => {
    if (!p && meta?.fromCache) return; // esperar respuesta del servidor
    resuelto = true;
    clearTimeout(espera);
    if (!p) {
      const neg = await db.get("_negocio", CONFIG.negocioId).catch(() => null);
      if (!neg) return pantallaAltaNegocio(u);
      return pantallaSinAcceso("Tu usuario todavía no tiene acceso a este negocio. Pedile al dueño que te habilite.");
    }
    if (p.activo === false) return pantallaSinAcceso("Tu usuario está desactivado.");
    const cambioRol = S.rol && S.rol !== p.rol;
    S.perfil = p;
    S.rol = p.rol;
    if (!iniciada) iniciarApp();
    else if (cambioRol) { renderShell(); navegar(); }
    emit("perfil");
  });
}

// Cambios de datos que se hacen una sola vez (los hace un dueño o encargado)
let migro = false;
function migraciones() {
  if (migro || !puede("productos") || !S.cargados.has("productos") || !S.cargados.has("config")) return;
  migro = true;
  if (!S.config.migMenus) {
    // v0.7: la categoría "Menúes" pasa a llamarse "Menús"
    for (const c of categorias()) if (normalizar(c) === "menues") vProductos.renombrarCategoria(c, "Menús");
    db.merge("config", "general", { migMenus: true });
  }
  if (!S.config.migCatFija) {
    // v1.2.5: "Menús" queda fija primera (comanda: después de Todas; carta QR: primera)
    const menus = categorias().find((c) => ["menus", "menues"].includes(normalizar(c)));
    db.merge("config", "general", { migCatFija: true, ...(menus && !S.config.catFija ? { catFija: "Menús" } : {}) });
  }
  if (!S.config.migCatFinal) {
    // v1.2.8: las bebidas y los tragos van siempre al final (comanda, Productos y carta QR)
    const fin = S.config.catFinal || ["Bebidas sin alcohol", "Bebidas con alcohol", "Tragos"];
    S.config.catFinal = fin;
    db.merge("config", "general", { migCatFinal: true, catFinal: fin });
    // Los productos se renumeran en ese orden, así el Excel exportado sale igual
    const ops = vProductos.reordenarOps(categorias());
    for (let i = 0; i < ops.length; i += 400) db.batch(ops.slice(i, i + 400));
    ordenarProductos();
    emit("productos");
  }
}

// La carta QR muestra el botón "Volver a A&F" solo si en este navegador
// hay alguien con sesión iniciada. Un cliente que escanea el QR no lo ve.
function marcarSesion(si) {
  try {
    if (si) localStorage.setItem("af_sesion", JSON.stringify({ rol: S.rol, ts: Date.now() }));
    else localStorage.removeItem("af_sesion");
  } catch {}
}

function iniciarApp() {
  iniciada = true;
  marcarSesion(true);
  // "cargado" = ya llegó la respuesta del servidor (no solo la copia local)
  const marcar = (k, meta) => { if (!meta?.fromCache) S.cargados.add(k); };
  escuchar("config", { id: "general", meta: true }, (c, meta) => {
    const antes = JSON.stringify([S.config?.catFija, S.config?.catFinal]);
    S.config = { ...CONFIG_DEF, ...(c || {}) };
    marcar("config", meta);
    emit("config");
    // Si cambió la categoría fija o las del final, cambia el orden de los productos
    if (JSON.stringify([S.config.catFija, S.config.catFinal]) !== antes && S.productos.length) { ordenarProductos(); emit("productos"); }
    migraciones();
  });
  escuchar("mesas", { meta: true }, (a, meta) => {
    S.mesas = a.sort((x, y) => (x.orden ?? 999) - (y.orden ?? 999) || String(x.nombre).localeCompare(String(y.nombre), "es", { numeric: true }));
    marcar("mesas", meta);
    emit("mesas");
  });
  escuchar("productos", { meta: true }, (a, meta) => {
    S.productos = a;
    ordenarProductos();
    marcar("productos", meta);
    emit("productos");
    migraciones();
  });
  escuchar("comandas", { where: [["estado", "in", ["abierta", "cuenta"]]] }, (a) => { S.comandas = a; emit("comandas"); });
  escuchar("items", { where: [["cerrado", "==", false]] }, (a) => { S.items = a.sort((x, y) => (x.ts || 0) - (y.ts || 0)); emit("items"); });
  escuchar("jornadas", { where: [["estado", "==", "abierta"]] }, (a) => {
    S.jornada = a.sort((x, y) => (y.aperturaTs || 0) - (x.aperturaTs || 0))[0] || null;
    emit("jornada");
  });
  escuchar("usuarios", {}, (a) => { S.usuarios = a; emit("usuarios"); });
  if (S.rol !== "cocina") escuchar("insumos", {}, (a) => { S.insumos = a.sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), "es")); emit("insumos"); });
  if (S.rol !== "cocina") escuchar("clientes", {}, (a) => { S.clientes = a.sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), "es")); emit("clientes"); });
  if (puede("reservas")) escuchar("reservas", { where: [["fecha", ">=", fechaStr()]] }, (a) => { S.reservas = a; emit("reservas"); });
  if (puede("recordatorios")) escuchar("recordatorios", {}, (a) => { S.recordatorios = a; emit("recordatorios"); });
  renderShell();
  navegar();
  reconectarImpresora();
  if (puede("ajustesNegocio")) iniciarPublicacion();
}

// ── Pantallas de acceso ──
function pantallaLogin() {
  if (MODO === "demo") {
    // El administrador no se lista en el demo (se entra con ?demo&admin)
    const us = auth.demoUsuarios().filter((u) => u.rol !== "admin" || new URLSearchParams(location.search).has("admin"));
    pantalla(`
      <h1>Ingresar</h1>
      <p class="ayuda centro"><b>Modo demo.</b> Los datos quedan solo en este navegador. Elegí con qué usuario entrar. Abrí otra pestaña con otro usuario (por ejemplo, Cocina) para ver el circuito completo.</p>
      <div class="lista-usuarios">${us.map((u) => `<button class="btn btn-bloque usuario-demo" data-uid="${esc(u.id)}"><span class="avatar">${esc(iniciales(u.nombre))}</span><span>${esc(u.nombre)}</span><small>${esc(ROLES[u.rol] || u.rol)}</small></button>`).join("")}</div>
      <button class="btn-texto" id="btnReset">Reiniciar datos del demo</button>`);
    appEl.querySelectorAll("[data-uid]").forEach((b) => (b.onclick = () => auth.login(b.dataset.uid)));
    $("#btnReset").onclick = async () => { if (await confirmar("Se borran todas las ventas y cambios del demo.", { ok: "Reiniciar", peligro: true })) auth.demoReset(); };
    return;
  }
  pantalla(`
    <h1>Ingresar</h1>
    <form class="form" id="fLogin">
      <label class="campo"><span>Email</span><input class="input" type="email" id="lEmail" autocomplete="username" required></label>
      <label class="campo"><span>Contraseña</span><input class="input" type="password" id="lPass" autocomplete="current-password" required></label>
      <p class="error" id="lErr" hidden></p>
      <button class="btn btn-pri btn-bloque" id="lBtn">Entrar</button>
    </form>`);
  $("#fLogin").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#lBtn"), err = $("#lErr");
    btn.disabled = true; btn.textContent = "Entrando…"; err.hidden = true;
    try {
      await auth.login($("#lEmail").value.trim(), $("#lPass").value);
    } catch (ex) {
      const c = ex.code || "";
      err.textContent = c.includes("invalid") || c.includes("wrong-password") || c.includes("user-not-found")
        ? "Email o contraseña incorrectos."
        : c.includes("network") ? "Sin conexión. Para entrar por primera vez hace falta internet." : "No se pudo entrar: " + (ex.message || ex);
      err.hidden = false;
      btn.disabled = false; btn.textContent = "Entrar";
    }
  };
}

function pantallaSinAcceso(msg) {
  pantalla(`<p class="error">${esc(msg)}</p><button class="btn btn-bloque" id="btnSalir">Salir</button>`);
  $("#btnSalir").onclick = () => auth.logout();
}

function pantallaAltaNegocio(u) {
  pantalla(`
    <h1>Primera vez</h1>
    <p class="ayuda centro">Todavía no existe el negocio en la base de datos. Quien lo crea queda como <b>dueño</b>.</p>
    <form class="form" id="fAlta">
      <label class="campo"><span>Nombre del negocio</span><input class="input" id="aNeg" value="A&F" required></label>
      <label class="campo"><span>Tu nombre</span><input class="input" id="aNom" required></label>
      <button class="btn btn-pri btn-bloque">Crear negocio</button>
    </form>
    <button class="btn-texto" id="btnSalir">Salir</button>`);
  $("#btnSalir").onclick = () => auth.logout();
  $("#fAlta").onsubmit = async (e) => {
    e.preventDefault();
    const ahora = Date.now();
    const ops = [
      { op: "set", col: "_negocio", id: CONFIG.negocioId, data: { nombre: $("#aNeg").value.trim(), owner: u.uid, creado: ahora } },
      { op: "set", col: "usuarios", id: u.uid, data: { nombre: $("#aNom").value.trim(), email: u.email || "", rol: "dueno", activo: true, creado: ahora } },
    ];
    // Esperar a que el servidor confirme antes de abrir la app: si los
    // listados se piden antes de que exista el usuario, las reglas los rechazan.
    limpiar();
    cargando("Creando negocio…");
    await db.batch(ops);
    const ok = await db.get("usuarios", u.uid).catch(() => null);
    if (ok) location.reload();
    else {
      pantalla(`<p class="error">No se pudo crear el negocio. Revisá que las reglas de Firestore estén publicadas (archivo firestore.rules).</p>
        <button class="btn btn-bloque" id="btnReint">Reintentar</button>`);
      $("#btnReint").onclick = () => location.reload();
    }
  };
}

// ── Estructura de la app ──
function rutasMenu() {
  return Object.entries(RUTAS).filter(([, r]) => r.menu && puede(r.perm));
}
function renderShell() {
  const rutas = rutasMenu();
  const compacto = S.rol === "cocina";
  const link = ([k, r]) => `<a href="#/${k}" data-ruta="${k}">${icon(r.icono)}<span>${r.titulo}</span></a>`;
  // En el menú lateral de la PC, la venta rápida muestra su atajo de teclado
  const linkLateral = ([k, r]) => k === "rapida"
    ? `<a href="#/${k}" data-ruta="${k}" title="Atajo de teclado: F2">${icon(r.icono)}<span>${r.titulo}</span><kbd class="nav-atajo">F2</kbd></a>`
    : link([k, r]);
  const links = rutas.map(link).join("");
  let grupo = null;
  const lateral = rutas.map((x) => { const g = x[1].grupo || ""; const sep = g !== grupo && g ? `<small class="nav-grupo">${g}</small>` : ""; grupo = g; return sep + linkLateral(x); }).join("");
  // Celular: hasta 5 lugares; si no entran, 4 + "Más"
  const ordenInf = rutas;
  const visiblesInf = ordenInf.length > 5 ? ordenInf.slice(0, 4) : ordenInf;
  masRutas = ordenInf.length > 5 ? ordenInf.slice(4).map(([k]) => k) : [];
  const inferior = visiblesInf.map(link).join("") + (masRutas.length ? `<button type="button" class="nav-mas" data-act="mas">${icon("menu")}<span>Más</span></button>` : "");
  appEl.innerHTML = `
  <div class="shell ${compacto ? "compacto" : ""}" id="shell">
    <aside class="nav-lateral">
      <div class="marca"><img src="img/logo.svg" alt=""><b>${esc(S.config.nombre || "A&F")}</b></div>
      <nav>${lateral}</nav>
      <button class="nav-usuario" data-act="usuario"><span class="avatar">${esc(iniciales(S.perfil?.nombre))}</span><span><b>${esc(S.perfil?.nombre || "")}</b><small>${esc(ROLES[S.rol] || "")}</small></span></button>
      ${firmaHTML("firma-lateral")}
    </aside>
    <header class="barra-sup">
      <div class="bs-izq"><img src="img/logo.svg" alt="" class="bs-logo"><h1 id="bsTitulo"></h1></div>
      <div class="bs-der">
        ${compacto ? `<nav class="bs-links">${links}</nav>` : ""}
        <span id="bsEstado"></span>
        <a id="bsCaja" class="chip-caja" href="#/caja" hidden></a>
        <button class="avatar boton" data-act="usuario" aria-label="Usuario">${esc(iniciales(S.perfil?.nombre))}</button>
      </div>
    </header>
    <main id="vista"></main>
    <nav class="nav-inferior">${inferior}</nav>
  </div>`;
  appEl.querySelectorAll('[data-act="usuario"]').forEach((b) => (b.onclick = menuUsuario));
  appEl.querySelector('[data-act="mas"]')?.addEventListener("click", menuMas);
  actualizarBarra();
}

let masRutas = [];
function menuMas() {
  const m = modal({
    titulo: "Más",
    clase: "modal-chico hoja-mas",
    cuerpo: [...new Set(masRutas.map((k) => RUTAS[k].grupo))].map((g) => `<h4 class="mas-grupo">${esc(g)}</h4>
      <nav class="mas-grilla">${masRutas.filter((k) => RUTAS[k].grupo === g).map((k) => `<a href="#/${k}" data-ruta="${k}" class="${actual?.key === k ? "activo" : ""}">${icon(RUTAS[k].icono)}<span>${RUTAS[k].titulo}</span></a>`).join("")}</nav>`).join(""),
  });
  m.el.addEventListener("click", (e) => { if (e.target.closest("a")) m.cerrar(); });
}

function menuUsuario() {
  const m = modal({
    titulo: S.perfil?.nombre || "Usuario",
    clase: "modal-chico",
    cuerpo: `<p class="ayuda">${esc(ROLES[S.rol] || "")}${S.user?.email && MODO !== "demo" ? " · " + esc(S.user.email) : ""}</p>
      <p class="ayuda">${MODO === "demo" ? "Modo demo: los datos quedan en este navegador." : "Conectado a Firebase."} Versión ${VERSION}.</p>
      ${firmaHTML()}`,
    pie: `<button class="btn btn-bloque" data-salir>${icon("salir")} ${MODO === "demo" ? "Cambiar de usuario" : "Cerrar sesión"}</button>`,
  });
  m.el.querySelector("[data-salir]").onclick = () => { m.cerrar(); auth.logout(); };
}

function actualizarBarra() {
  const est = $("#bsEstado");
  if (!est) return;
  const off = !navigator.onLine;
  est.innerHTML = MODO === "demo"
    ? `<span class="chip-estado demo">DEMO</span>`
    : off ? `<span class="chip-estado off" title="Lo que cargues se guarda y se sube cuando vuelva la conexión">Sin conexión</span>` : "";
  document.body.classList.toggle("offline", off && MODO !== "demo");
  const caja = $("#bsCaja");
  if (caja) {
    const ver = puede("caja");
    caja.hidden = !ver;
    if (ver) {
      caja.className = "chip-caja " + (S.jornada ? "abierta" : "cerrada");
      caja.innerHTML = S.jornada ? `${icon("caja")} Caja abierta` : `${icon("caja")} Caja cerrada`;
    }
  }
}

// ── Navegación ──
// Al abrir: la pantalla elegida para este dispositivo (Ajustes), si el rol la puede ver
function rutaInicio() {
  const elegida = dispositivo().inicio;
  if (elegida && RUTAS[elegida] && puede(RUTAS[elegida].perm)) return elegida;
  return S.rol === "cocina" ? "cocina" : "salon";
}
function navegar() {
  if (!iniciada || !$("#vista")) return;
  const partes = location.hash.replace(/^#\/?/, "").split("/");
  const clave = partes[0];
  let k = RUTAS[clave] && puede(RUTAS[clave].perm) ? clave : rutaInicio();
  if (k !== clave) { location.replace("#/" + k); return; }
  if (RUTAS[k].accion) { RUTAS[k].accion(); return; }
  actual?.inst?.unmount?.();
  const cont = document.createElement("div");
  cont.className = "vista vista-" + k;
  $("#vista").replaceChildren(cont);
  $("#shell").classList.toggle("en-mesa", k === "mesa");
  $("#shell").classList.toggle("en-cocina", k === "cocina");
  $("#bsTitulo").textContent = RUTAS[k].titulo;
  window.scrollTo(0, 0);
  actual = { key: k, param: partes[1] ? decodeURIComponent(partes[1]) : null, inst: null };
  marcarMenu();
  actual.inst = RUTAS[k].mod.mount(cont, { param: actual.param }) || {};
}

// Sección marcada en el menú. En una comanda: Venta rápida si es de mostrador, si no Salón.
// Se vuelve a calcular cuando llegan las comandas (la venta recién creada tarda un instante).
function marcarMenu() {
  if (!actual) return;
  let marcada = actual.key;
  if (marcada === "mesa") {
    const c = S.comandas.find((x) => x.id === actual.param);
    marcada = rapidasLocales.has(actual.param) || c?.tipo === "mostrador" ? "rapida" : "salon";
  }
  appEl.querySelectorAll("[data-ruta]").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === marcada));
  appEl.querySelector(".nav-mas")?.classList.toggle("activo", masRutas.includes(marcada));
}

// Cambios en los datos → refrescar la vista actual (agrupados)
let pendientes = new Set(), timer = 0;
onStore((clave) => {
  pendientes.add(clave);
  if (timer) return;
  timer = setTimeout(() => {
    timer = 0;
    const claves = [...pendientes];
    pendientes.clear();
    if (claves.includes("config")) {
      const b = appEl.querySelector(".marca b");
      if (b) b.textContent = S.config.nombre || "A&F";
    }
    try { actual?.inst?.update?.(claves); } catch (e) { console.error(e); }
    if (claves.includes("comandas")) marcarMenu();
    actualizarBarra();
  }, 25);
});

arrancar();
