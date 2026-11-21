// ============================================================
//  A&F · Productos, stock e ingreso de mercadería por escáner
// ============================================================
import { S, categorias, productoPorCodigo, SECTORES, log, insumosBajos } from "../store.js";
import { db, inc } from "../db.js";
import { esc, fmt, num, icon, modal, toast, confirmar, pedirTexto } from "../util.js";
import { buscar } from "../buscar.js";
import { abrirEscaner, escucharLectorUSB, precargarEscaner, ponerCodigo } from "../scanner.js";
import { menuExcel, abrirImportador, descargarPlantilla, precargarExcel, ajustarCategoria } from "../importar.js";
import { normalizar } from "../util.js";
import { administrarOpciones, htmlGruposProducto, leerGruposProducto } from "../opciones.js";
import { montarInsumos, editorReceta } from "./insumos.js";

export function mount(root, { param } = {}) {
  let q = "";
  let filtro = "Todas";
  let pestana = param === "insumos" ? "insumos" : "carta";

  root.innerHTML = `
    <div class="segmentado pestanas" id="pTabs"><button data-tab="carta">Carta</button><button data-tab="insumos">Insumos <span class="contador rojo" id="pBajos"></span></button></div>
    <div id="pInsumos"></div>
    <div class="productos" id="pCarta">
      <div class="prod-barra">
        <div class="input-icono">${icon("buscar")}<input id="pBusq" class="input" type="search" placeholder="Buscar producto o código…" autocomplete="off"></div>
        <div class="prod-botones">
          <button class="btn" data-act="escanear">${icon("scan")} Escanear</button>
          <button class="btn" data-act="tanda">${icon("dinero")} Precios en tanda</button>
          <button class="btn" data-act="categorias">${icon("lista")} Categorías</button>
          <button class="btn" data-act="opciones">${icon("lista")} Opciones</button>
          <button class="btn" data-act="excel">${icon("tabla")} Excel</button>
          <button class="btn btn-pri" data-act="nuevo">${icon("mas")} Producto</button>
        </div>
      </div>
      <div class="chips desliza" id="pCats"></div>
      <div id="pLista"></div>
    </div>`;
  precargarEscaner();
  if (!S.productos.length) precargarExcel();

  function render() {
    const cats = categorias();
    const bajos = S.productos.filter((p) => p.controlStock && (Number(p.stock) || 0) <= (Number(p.stockMin) || 0));
    root.querySelector("#pCats").innerHTML = ["Todas", ...cats, ...(bajos.length ? ["Stock bajo"] : [])]
      .map((c) => `<button class="chip ${c === filtro ? "activo" : ""} ${c === "Stock bajo" ? "alerta" : ""}" data-filtro="${esc(c)}">${esc(c)}${c === "Stock bajo" ? ` (${bajos.length})` : ""}</button>`).join("");

    let lista = S.productos;
    if (q) lista = buscar(lista, q, (p) => `${p.nombre} ${p.categoria || ""}`);
    else if (filtro === "Stock bajo") lista = bajos;
    else if (filtro !== "Todas") lista = lista.filter((p) => (p.categoria || "Otros") === filtro);

    root.querySelector("#pLista").innerHTML = lista.length ? `<div class="tabla-prod">
      ${lista.map((p) => {
        const bajo = p.controlStock && (Number(p.stock) || 0) <= (Number(p.stockMin) || 0);
        return `<button class="fila-prod ${p.activo === false ? "inactivo" : ""}" data-editar="${esc(p.id)}">
          <span class="fp-fav ${p.favorito ? "si" : ""}" data-fav="${esc(p.id)}" role="button" aria-label="${p.favorito ? "Quitar de favoritos" : "Marcar como favorito"}" title="Favorito">${icon("estrella")}</span>
          <span class="fp-nom"><b>${esc(p.nombre)}</b><small>${esc(p.categoria || "Otros")} · ${esc(SECTORES[p.sector] || "Cocina")}${p.codigo ? ` · ${icon("scan", "mini")} ${esc(p.codigo)}` : ""}${p.activo === false ? " · desactivado" : ""}</small></span>
          <span class="fp-stock ${bajo ? "bajo" : ""}">${p.controlStock ? `${fmtCant(p.stock)} u.` : ""}</span>
          <b class="fp-precio">${fmt(p.precio)}</b>
        </button>`;
      }).join("")}</div>`
      : q || S.productos.length
        ? `<div class="vacio">${icon("productos")}<p>${q ? `No encontré "${esc(q)}".` : "No hay productos en este filtro."}</p></div>`
        : `<div class="vacio inicio-carta">${icon("productos")}
            <p><b>Todavía no hay productos.</b><br>Cargá la carta desde un Excel o de a uno.</p>
            <div class="fila-botones">
              <button class="btn btn-pri" data-act="importar">${icon("subir")} Importar desde Excel</button>
              <button class="btn" data-act="plantilla">${icon("bajar")} Descargar plantilla</button>
              <button class="btn" data-act="nuevo">${icon("mas")} Cargar a mano</button>
            </div></div>`;
  }

  // ── Alta / edición ──
  function editar(p = null, codigoInicial = "", stockInicial = 0) {
    const cats = categorias();
    const nuevo = !p;
    p = p || { nombre: "", categoria: cats.includes(filtro) ? filtro : "", precio: "", sector: codigoInicial ? "ninguno" : "cocina", codigo: codigoInicial, controlStock: !!codigoInicial, stock: stockInicial, stockMin: 0, activo: true, enCarta: true, descripcion: "" };
    const receta = editorReceta(p.receta || [], Number(p.precio) || 0);
    const m = modal({
      titulo: nuevo ? "Nuevo producto" : "Editar producto",
      cuerpo: `<form class="form" id="fProd">
        <label class="campo"><span>Nombre</span><input class="input" id="eNom" value="${esc(p.nombre)}" required ${nuevo && !codigoInicial ? "autofocus" : ""}></label>
        <div class="dos-col">
          <div class="campo"><span>Categoría</span>
            <select class="input" id="eCat">
              ${p.categoria ? "" : `<option value="" selected disabled>Elegí una categoría…</option>`}
              ${cats.map((c) => `<option value="${esc(c)}" ${c === (p.categoria || "") ? "selected" : ""}>${esc(c)}</option>`).join("")}
              <option value="__nueva">＋ Nueva categoría…</option>
            </select>
            <input class="input" id="eCatNueva" placeholder="Nombre de la categoría nueva" maxlength="40" hidden>
          </div>
          <label class="campo"><span>Precio</span><input class="input" id="ePre" inputmode="decimal" value="${p.precio === "" ? "" : Math.round(p.precio)}" required ${codigoInicial ? "autofocus" : ""}></label>
        </div>
        <label class="campo"><span>Descripción para la carta QR (opcional)</span><textarea class="input" id="eDesc" rows="2" maxlength="160" placeholder="Ej: con salsa pomodoro y albahaca">${esc(p.descripcion || "")}</textarea></label>
        <div class="campo"><span>¿Quién lo prepara?</span>
          <div class="segmentado ancho" id="eSec">${Object.entries(SECTORES).map(([k, v]) => `<button type="button" data-sec="${k}" class="${(p.sector || "cocina") === k ? "activo" : ""}">${v}</button>`).join("")}</div>
          <small class="ayuda">"Lo sirve el mozo": latas, botellas o agua que no pasan por cocina ni barra.</small>
        </div>
        <label class="campo"><span>Código de barras</span>
          <div class="input-boton"><input class="input" id="eCod" data-codigo inputmode="numeric" autocomplete="off" value="${esc(p.codigo || "")}" placeholder="Opcional: tocá acá y escaneá"><button type="button" class="btn" data-act="scanCod">${icon("scan")}</button></div>
        </label>
        <label class="switch"><input type="checkbox" id="eCtl" ${p.controlStock ? "checked" : ""}><span>Controlar stock</span></label>
        <div class="dos-col" id="eStockWrap" ${p.controlStock ? "" : "hidden"}>
          <label class="campo"><span>Stock actual</span><input class="input" id="eStock" inputmode="decimal" value="${fmtCant(p.stock)}"></label>
          <label class="campo"><span>Avisar con menos de</span><input class="input" id="eMin" inputmode="decimal" value="${fmtCant(p.stockMin)}"></label>
        </div>
        <label class="switch"><input type="checkbox" id="eAct" ${p.activo !== false ? "checked" : ""}><span>Activo (lo pueden cargar los mozos)</span></label>
        <label class="switch"><input type="checkbox" id="eCarta" ${p.enCarta !== false ? "checked" : ""}><span>Mostrar en la carta QR de los clientes</span></label>
        <label class="switch"><input type="checkbox" id="eFav" ${p.favorito ? "checked" : ""}><span>Favorito: aparece primero en la venta rápida y en la comanda</span></label>
        <div id="eGrupos">${htmlGruposProducto(p)}</div>
        <div id="eReceta">${receta.html}</div>
      </form>`,
      pie: `${nuevo ? "" : `<button class="btn btn-peligro" data-act="borrar">${icon("basura")}</button>`}<button type="submit" form="fProd" class="btn btn-pri">${nuevo ? "Crear" : "Guardar"}</button>`,
    });
    const $ = (s) => m.el.querySelector(s);
    let sector = p.sector || "cocina";
    receta.montar($("#eReceta"));
    $("#ePre").addEventListener("input", () => receta.precio(num($("#ePre").value)));
    $("#eSec").onclick = (e) => {
      const b = e.target.closest("[data-sec]");
      if (!b) return;
      sector = b.dataset.sec;
      m.el.querySelectorAll("[data-sec]").forEach((x) => x.classList.toggle("activo", x === b));
    };
    $("#eCtl").onchange = () => { $("#eStockWrap").hidden = !$("#eCtl").checked; };
    const catSel = $("#eCat"), catNueva = $("#eCatNueva");
    const verNueva = () => { catNueva.hidden = catSel.value !== "__nueva"; if (!catNueva.hidden) catNueva.focus(); };
    catSel.addEventListener("change", verNueva);
    if (!cats.length) { catSel.value = "__nueva"; catNueva.hidden = false; }
    m.el.querySelector('[data-act="scanCod"]').onclick = async () => {
      const c = await abrirEscaner({ titulo: "Código del producto" });
      if (c) ponerCodigo($("#eCod"), c);
    };
    // Al leer un código (lector o cámara), avisar enseguida si ya es de otro producto
    $("#eCod").addEventListener("codigo-leido", (e) => {
      const otro = productoPorCodigo(e.detail);
      if (otro && otro.id !== p.id) toast(`Ese código ya es de "${otro.nombre}"`, "error");
      else toast(`Código ${e.detail} cargado`);
    });
    const borrar = m.el.querySelector('[data-act="borrar"]');
    if (borrar) borrar.onclick = async () => {
      if (!(await confirmar(`¿Borrar "${p.nombre}"? Las ventas pasadas no se modifican. Si lo vas a volver a usar, mejor desactivalo.`, { ok: "Borrar", peligro: true }))) return;
      db.remove("productos", p.id);
      log("producto", `Producto borrado: ${p.nombre}`);
      m.cerrar();
    };
    $("#fProd").onsubmit = (e) => {
      e.preventDefault();
      const codigo = $("#eCod").value.trim();
      const otro = codigo && productoPorCodigo(codigo);
      if (otro && otro.id !== p.id) return toast(`Ese código ya es de "${otro.nombre}"`, "error");
      const categoria = catSel.value === "__nueva" ? ajustarCategoria(catNueva.value) : catSel.value;
      if (!categoria) { toast(catSel.value === "__nueva" ? "Escribí el nombre de la categoría nueva" : "Elegí una categoría", "error"); (catSel.value === "__nueva" ? catNueva : catSel).focus(); return; }
      const datos = {
        nombre: $("#eNom").value.trim(),
        categoria,
        precio: Math.round(num($("#ePre").value)),
        sector, codigo,
        controlStock: $("#eCtl").checked,
        stockMin: num($("#eMin").value),
        activo: $("#eAct").checked,
        enCarta: $("#eCarta").checked,
        favorito: $("#eFav").checked,
        grupos: leerGruposProducto($("#eGrupos"), p),
        descripcion: $("#eDesc").value.trim(),
        receta: receta.valor(),
      };
      if (!datos.nombre) return toast("Falta el nombre", "error");
      const stockNuevo = num($("#eStock").value);
      if (nuevo) {
        const orden = Math.max(0, ...S.productos.map((x) => Number(x.orden) || 0)) + 1;
        db.add("productos", { ...datos, stock: stockNuevo, orden });
        log("producto", `Producto creado: ${datos.nombre} ${fmt(datos.precio)}`);
      } else {
        // El stock solo se pisa si alguien lo cambió a mano (ajuste por conteo)
        if (datos.controlStock && stockNuevo !== (Number(p.stock) || 0)) {
          datos.stock = stockNuevo;
          log("stock", `Ajuste de stock ${datos.nombre}: ${fmtCant(p.stock)} → ${fmtCant(stockNuevo)}`);
        }
        if (datos.precio !== p.precio) log("precio", `${datos.nombre}: ${fmt(p.precio)} → ${fmt(datos.precio)}`);
        db.update("productos", p.id, datos);
      }
      m.cerrar();
      toast(nuevo ? "Producto creado" : "Guardado");
    };
  }

  // ── Ingreso de mercadería con el celular ──
  function ingreso() {
    let cantidad = Number(localStorage.getItem("af_ingreso_cant")) || 1;
    const sesion = new Map(); // id → cantidad sumada
    const desconocidos = new Map(); // código → unidades escaneadas
    const chips = [1, 6, 12, 24];
    const promesa = abrirEscaner({
      titulo: "Ingreso de mercadería",
      continuo: true,
      extraHtml: `<div class="esc-cantidad"><span>Suma por cada escaneo:</span>${chips.map((n) => `<button type="button" class="chip claro" data-cant="${n}">${n}</button>`).join("")}<button type="button" class="chip claro" data-cant="otra">Otra</button></div>`,
      onCodigo(codigo) {
        const p = productoPorCodigo(codigo);
        if (!p) { desconocidos.set(codigo, (desconocidos.get(codigo) || 0) + cantidad); return { ok: false, texto: `${codigo}: no está cargado. Al terminar lo asignás a un producto.` }; }
        db.update("productos", p.id, { controlStock: true, stock: inc(cantidad) });
        sesion.set(p.id, (sesion.get(p.id) || 0) + cantidad);
        return { ok: true, texto: `+${cantidad} ${p.nombre} · ahora ${fmtCant((Number(p.stock) || 0) + cantidad)}` };
      },
    });
    const esc_ = document.querySelector(".escaner");
    const marcar = () => esc_?.querySelectorAll("[data-cant]").forEach((b) => b.classList.toggle("activo", Number(b.dataset.cant) === cantidad));
    esc_?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cant]");
      if (!b) return;
      if (b.dataset.cant === "otra") {
        const n = Math.round(num(prompt("¿Cuántas unidades por escaneo?", String(cantidad))));
        if (n > 0) cantidad = n;
      } else cantidad = Number(b.dataset.cant);
      localStorage.setItem("af_ingreso_cant", String(cantidad));
      marcar();
    });
    marcar();

    promesa.then(() => {
      if (!sesion.size && !desconocidos.size) return;
      const filas = [...sesion.entries()].map(([id, n]) => ({ p: S.productos.find((x) => x.id === id), n })).filter((x) => x.p);
      if (filas.length) log("stock", `Ingreso de mercadería: ${filas.map((f) => `${f.p.nombre} +${f.n}`).join(", ")}`);
      const m = modal({
        titulo: "Ingreso de mercadería",
        cuerpo: `
          ${filas.length ? `<div class="lista">${filas.map((f) => `<div class="fila-lista"><div><b>${esc(f.p.nombre)}</b><small>stock actual ${fmtCant(f.p.stock)}</small></div><span class="pos">+${f.n}</span><button class="btn chico" data-deshacer="${esc(f.p.id)}" data-n="${f.n}">Deshacer</button></div>`).join("")}</div>` : ""}
          ${desconocidos.size ? `<h4 class="subtitulo">Códigos sin cargar</h4><p class="ayuda">Si el producto ya existe en la carta (por ejemplo, lo importaste desde Excel), asignale el código: se guarda y se suman las unidades. Si es nuevo, dalo de alta.</p>
            <div class="lista">${[...desconocidos].map(([c, n]) => `<div class="fila-lista"><div><b>${esc(c)}</b><small>${n} unidad${n === 1 ? "" : "es"} escaneada${n === 1 ? "" : "s"}</small></div>
              <button class="btn chico btn-pri" data-asignar="${esc(c)}" data-n="${n}">Asignar a…</button><button class="btn chico" data-alta="${esc(c)}" data-n="${n}">Nuevo</button></div>`).join("")}</div>` : ""}`,
        pie: `<button class="btn btn-pri" data-cerrar>Listo</button>`,
      });
      m.el.addEventListener("click", (e) => {
        const d = e.target.closest("[data-deshacer]");
        if (d) {
          db.update("productos", d.dataset.deshacer, { stock: inc(-Number(d.dataset.n)) });
          d.closest(".fila-lista").remove();
          toast("Ingreso deshecho");
          return;
        }
        const a = e.target.closest("[data-alta]");
        if (a) { a.closest(".fila-lista").remove(); editar(null, a.dataset.alta, Number(a.dataset.n) || 0); return; }
        const as = e.target.closest("[data-asignar]");
        if (as) {
          const codigo = as.dataset.asignar, n = Number(as.dataset.n) || 0;
          elegirProducto(`¿De qué producto es el código ${codigo}?`, (p) => {
            db.update("productos", p.id, { codigo, controlStock: true, stock: inc(n) });
            log("stock", `Código ${codigo} asignado a ${p.nombre} · ingreso +${n}`);
            toast(`${p.nombre}: código guardado y +${n}`);
            as.closest(".fila-lista").remove();
          });
        }
      });
    });
  }

  function menuEscanear() {
    const sinCod = S.productos.filter((p) => p.activo !== false && !p.codigo).length;
    const m = modal({
      titulo: "Escanear",
      clase: "modal-chico",
      cuerpo: `<div class="menu-lista">
        <button data-e="asignar">${icon("scan")}<span><b>Asignar códigos</b><small>Te muestra uno por uno los productos sin código (${sinCod}) y los vas escaneando. Ideal para las bebidas recién importadas.</small></span></button>
        <button data-e="ingreso">${icon("productos")}<span><b>Ingreso de mercadería</b><small>Cada escaneo suma stock (de a 1, 6, 12 o 24).</small></span></button>
      </div>`,
    });
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-e]");
      if (!b) return;
      m.cerrar();
      b.dataset.e === "asignar" ? asignarCodigos() : ingreso();
    });
  }

  // ── Asignar códigos de barras en serie ──
  function asignarCodigos() {
    const sinCodigo = S.productos.filter((p) => p.activo !== false && !p.codigo);
    if (!sinCodigo.length) return toast("Todos los productos activos ya tienen código");
    const delMozo = sinCodigo.filter((p) => p.sector === "ninguno");
    if (!delMozo.length) return asignarSerie(sinCodigo);
    const m = modal({
      titulo: "Asignar códigos de barras",
      clase: "modal-chico",
      cuerpo: `<p class="ayuda">Te muestro cada producto sin código: escaneás el envase y pasa al siguiente. Si alguno no lo tenés a mano, lo salteás.</p>
        <div class="menu-lista">
          <button data-g="mozo">${icon("scan")}<span><b>Bebidas y envasados (${delMozo.length})</b><small>Los que sirve el mozo y todavía no tienen código.</small></span></button>
          <button data-g="todos">${icon("scan")}<span><b>Todos los que no tienen código (${sinCodigo.length})</b><small>Incluye platos de cocina y barra, que normalmente no llevan código.</small></span></button>
        </div>`,
    });
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-g]");
      if (!b) return;
      m.cerrar();
      asignarSerie(b.dataset.g === "mozo" ? delMozo : sinCodigo);
    });
  }

  function asignarSerie(lista) {
    const cola = [...lista];
    let i = 0, asignados = 0;
    const promesa = abrirEscaner({
      titulo: "Asignar códigos",
      continuo: true,
      extraHtml: `<div class="esc-asignar"><small id="asgPos"></small><b id="asgNom"></b>
        <div class="esc-asg-botones"><button type="button" class="chip claro" data-asg="atras">Anterior</button><button type="button" class="chip claro" data-asg="saltear">Saltear</button></div></div>`,
      onCodigo(codigo) {
        const p = cola[i];
        if (!p) return { ok: false, texto: "Ya terminaste la lista" };
        const otro = productoPorCodigo(codigo);
        if (otro && otro.id !== p.id) return { ok: false, texto: `Ese código ya es de "${otro.nombre}"` };
        db.update("productos", p.id, { codigo });
        asignados++;
        i++;
        pintar();
        if (i >= cola.length) { setTimeout(cerrarEsc, 1200); return { ok: true, texto: `${p.nombre} ✓ · ¡Terminaste!` }; }
        return { ok: true, texto: `${p.nombre} ✓` };
      },
    });
    const el = document.querySelector(".escaner");
    const cerrarEsc = () => el?.querySelector("[data-cerrar]")?.click();
    function pintar() {
      if (!el) return;
      el.querySelector("#asgPos").textContent = i < cola.length ? `${i + 1} de ${cola.length} · escaneá:` : "Lista terminada";
      el.querySelector("#asgNom").textContent = cola[i]?.nombre || "✓";
    }
    el?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-asg]");
      if (!b) return;
      i = b.dataset.asg === "saltear" ? i + 1 : Math.max(0, i - 1);
      pintar();
      if (i >= cola.length) cerrarEsc();
    });
    pintar();
    promesa.then(() => {
      if (!asignados) return;
      log("producto", `Códigos de barras asignados a ${asignados} productos`);
      toast(`${asignados} código${asignados === 1 ? "" : "s"} cargado${asignados === 1 ? "" : "s"}`);
    });
  }

  // Selector de producto con buscador (para asignar un código suelto)
  function elegirProducto(titulo, alElegir) {
    const m = modal({
      titulo,
      cuerpo: `<div class="input-icono">${icon("buscar")}<input class="input" id="epB" placeholder="Buscar producto…" autocomplete="off" autofocus></div><div class="lista" id="epL"></div>`,
    });
    const inp = m.el.querySelector("#epB");
    const pintar = () => {
      const q = inp.value.trim();
      const act = S.productos.filter((p) => p.activo !== false);
      const l = q ? buscar(act, q) : [...act.filter((p) => !p.codigo && p.sector === "ninguno"), ...act.filter((p) => !p.codigo && p.sector !== "ninguno")];
      m.el.querySelector("#epL").innerHTML = l.slice(0, 40).map((p) => `<button class="fila-lista boton" data-p="${esc(p.id)}"><div><b>${esc(p.nombre)}</b><small>${esc(p.categoria || "")}${p.codigo ? ` · ya tiene el código ${esc(p.codigo)}` : ""}</small></div></button>`).join("")
        || `<p class="ayuda">No encontré productos${q ? ` para "${esc(q)}"` : " sin código"}.</p>`;
    };
    inp.addEventListener("input", pintar);
    m.el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-p]");
      if (!b) return;
      const p = S.productos.find((x) => x.id === b.dataset.p);
      if (p.codigo && !(await confirmar(`${p.nombre} ya tiene el código ${p.codigo}. ¿Reemplazarlo?`, { ok: "Reemplazar" }))) return;
      m.cerrar();
      alElegir(p);
    });
    pintar();
  }

  // ── Precios en tanda (de Dairus) ──
  function tanda() {
    const cats = categorias();
    const m = modal({
      titulo: "Actualizar precios en tanda",
      cuerpo: `<form class="form" id="fTanda">
        <label class="campo"><span>¿Qué productos?</span><select class="input" id="tAlc"><option value="">Todos</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
        <div class="dos-col">
          <label class="campo"><span>Porcentaje</span><input class="input" id="tPct" inputmode="decimal" placeholder="Ej: 10 o -5" required></label>
          <label class="campo"><span>Redondear a</span><select class="input" id="tRed"><option value="1">Sin redondeo</option><option value="10">$ 10</option><option value="50">$ 50</option><option value="100" selected>$ 100</option><option value="500">$ 500</option></select></label>
        </div>
        <div id="tPrev" class="ayuda"></div>
      </form>`,
      pie: `<button type="submit" form="fTanda" class="btn btn-pri btn-bloque">Aplicar</button>`,
    });
    const $ = (s) => m.el.querySelector(s);
    const calc = () => {
      const pct = num($("#tPct").value), red = Number($("#tRed").value), alc = $("#tAlc").value;
      const ps = S.productos.filter((p) => !alc || (p.categoria || "Otros") === alc);
      return { pct, ps: ps.map((p) => ({ p, nuevo: Math.max(0, Math.round((p.precio * (1 + pct / 100)) / red) * red) })) };
    };
    const prev = () => {
      const { pct, ps } = calc();
      $("#tPrev").innerHTML = pct ? `${ps.length} productos. Ej: ${ps.slice(0, 3).map((x) => `${esc(x.p.nombre)} ${fmt(x.p.precio)} → <b>${fmt(x.nuevo)}</b>`).join(" · ")}` : "";
    };
    m.el.addEventListener("input", prev);
    m.el.addEventListener("change", prev);
    $("#fTanda").onsubmit = async (e) => {
      e.preventDefault();
      const { pct, ps } = calc();
      if (!pct) return;
      if (!(await confirmar(`¿Cambiar el precio de ${ps.length} productos (${pct > 0 ? "+" : ""}${pct}%)?`))) return;
      const ops = ps.filter((x) => x.nuevo !== x.p.precio).map((x) => ({ op: "update", col: "productos", id: x.p.id, data: { precio: x.nuevo } }));
      for (let i = 0; i < ops.length; i += 400) db.batch(ops.slice(i, i + 400));
      log("precio", `Precios en tanda ${pct > 0 ? "+" : ""}${pct}% (${$("#tAlc").value || "todos"}): ${ops.length} productos`);
      toast(`${ops.length} precios actualizados`);
      m.cerrar();
    };
  }

  // ── Eventos ──
  root.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filtro]");
    if (f) { filtro = f.dataset.filtro; q = ""; root.querySelector("#pBusq").value = ""; render(); return; }
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      e.stopPropagation();
      const p = S.productos.find((x) => x.id === fav.dataset.fav);
      if (p) { db.update("productos", p.id, { favorito: !p.favorito }); toast(p.favorito ? `${p.nombre}: ya no es favorito` : `${p.nombre}: favorito ★`); }
      return;
    }
    const ed = e.target.closest("[data-editar]");
    if (ed) { const p = S.productos.find((x) => x.id === ed.dataset.editar); if (p) editar(p); return; }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "nuevo") editar();
    else if (a.dataset.act === "escanear") menuEscanear();
    else if (a.dataset.act === "ingreso") ingreso();
    else if (a.dataset.act === "asignar") asignarCodigos();
    else if (a.dataset.act === "tanda") tanda();
    else if (a.dataset.act === "categorias") gestionarCategorias();
    else if (a.dataset.act === "opciones") administrarOpciones();
    else if (a.dataset.act === "excel") menuExcel();
    else if (a.dataset.act === "importar") abrirImportador();
    else if (a.dataset.act === "plantilla") descargarPlantilla();
  });
  const busq = root.querySelector("#pBusq");
  busq.addEventListener("input", () => { q = busq.value.trim(); render(); });
  const soltar = escucharLectorUSB((codigo) => {
    // Con la ficha abierta, el código va al recuadro "Código" aunque el cursor esté en otro lado
    const ficha = document.querySelector("#fProd #eCod");
    if (ficha) { ponerCodigo(ficha, codigo); return true; }
    if (document.querySelector(".modal-fondo")) return false;
    const p = productoPorCodigo(codigo);
    if (p) editar(p);
    else editar(null, codigo);
    return true;
  });

  let insumos = null;
  function mostrarPestana() {
    root.querySelectorAll("#pTabs [data-tab]").forEach((b) => b.classList.toggle("activo", b.dataset.tab === pestana));
    root.querySelector("#pCarta").hidden = pestana !== "carta";
    const cont = root.querySelector("#pInsumos");
    cont.hidden = pestana !== "insumos";
    if (pestana === "insumos" && !insumos) insumos = montarInsumos(cont);
    history.replaceState(null, "", pestana === "insumos" ? "#/productos/insumos" : "#/productos");
  }
  function marcarBajos() {
    const n = insumosBajos().length;
    root.querySelector("#pBajos").textContent = n || "";
  }
  root.querySelector("#pTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { pestana = b.dataset.tab; mostrarPestana(); }
  });

  render();
  mostrarPestana();
  marcarBajos();
  return {
    update(claves) {
      if (claves.includes("productos")) render();
      if (claves.includes("insumos")) marcarBajos();
      insumos?.update(claves);
    },
    unmount() { soltar(); },
  };
}

function fmtCant(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

// ── Categorías: renombrar y ordenar ──
// La categoría es un texto en cada producto: renombrar cambia todos los
// productos de esa categoría. El orden de la carta sale del orden de los
// productos, así que mover una categoría reordena sus productos en bloque.
function reordenarOps(nuevoOrden) {
  const ops = [];
  let n = 0;
  for (const cat of nuevoOrden) {
    const ps = S.productos.filter((p) => (p.categoria || "Otros") === cat).sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
    for (const p of ps) { n++; if (Number(p.orden) !== n) ops.push({ op: "update", col: "productos", id: p.id, data: { orden: n } }); }
  }
  return ops;
}

export function gestionarCategorias() {
  const m = modal({
    titulo: "Categorías",
    cuerpo: `<p class="ayuda">El orden es el de la carta QR y el de la comanda de los mozos. Renombrar cambia todos los productos de la categoría.</p><div class="lista" id="gcL"></div>`,
  });
  const cont = m.el.querySelector("#gcL");
  const pintar = () => {
    const cats = categorias();
    cont.innerHTML = cats.map((c, k) => {
      const n = S.productos.filter((p) => (p.categoria || "Otros") === c).length;
      return `<div class="fila-lista gc-fila"><div><b>${esc(c)}</b><small>${n} producto${n === 1 ? "" : "s"}</small></div>
        <div class="gc-acc">
          <button class="btn-icono" data-sube="${k}" ${k === 0 ? "disabled" : ""} aria-label="Subir">${icon("arriba")}</button>
          <button class="btn-icono" data-baja="${k}" ${k === cats.length - 1 ? "disabled" : ""} aria-label="Bajar">${icon("abajo")}</button>
          <button class="btn-icono" data-ren="${k}" aria-label="Renombrar">${icon("nota")}</button>
        </div></div>`;
    }).join("") || `<p class="ayuda">Todavía no hay productos.</p>`;
  };
  cont.addEventListener("click", async (e) => {
    const cats = categorias();
    const sube = e.target.closest("[data-sube]"), baja = e.target.closest("[data-baja]"), ren = e.target.closest("[data-ren]");
    if (sube || baja) {
      const k = Number((sube || baja).dataset[sube ? "sube" : "baja"]);
      const j = sube ? k - 1 : k + 1;
      if (j < 0 || j >= cats.length) return;
      [cats[k], cats[j]] = [cats[j], cats[k]];
      const ops = reordenarOps(cats);
      if (ops.length) db.batch(ops);
      setTimeout(pintar, 40);
      return;
    }
    if (ren) {
      const viejo = cats[Number(ren.dataset.ren)];
      const nuevoTxt = await pedirTexto(`Renombrar "${viejo}"`, { valor: viejo, ok: "Renombrar" });
      if (nuevoTxt == null) return;
      const limpio = nuevoTxt.trim();
      if (!limpio || limpio === viejo) return;
      const existente = cats.find((c) => c !== viejo && normalizar(c) === normalizar(limpio));
      if (existente && !(await confirmar(`Ya existe "${existente}". ¿Juntar los productos de "${viejo}" en "${existente}"?`, { ok: "Juntar" }))) return;
      renombrarCategoria(viejo, existente || limpio);
      toast(`"${viejo}" ahora es "${existente || limpio}"`);
      setTimeout(pintar, 40);
    }
  });
  pintar();
}

export function renombrarCategoria(viejo, nuevo) {
  const ops = S.productos.filter((p) => (p.categoria || "Otros") === viejo).map((p) => ({ op: "update", col: "productos", id: p.id, data: { categoria: nuevo } }));
  for (let i = 0; i < ops.length; i += 400) db.batch(ops.slice(i, i + 400));
  if (ops.length) log("productos", `Categoría "${viejo}" → "${nuevo}" (${ops.length} productos)`);
  return ops.length;
}
