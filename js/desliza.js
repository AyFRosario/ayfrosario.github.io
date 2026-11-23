// ============================================================
//  A&F · Filas de etiquetas que se deslizan de costado
// ============================================================
// En el celular las filas de etiquetas (categorías, sectores, períodos)
// se deslizan con el dedo. En la PC la rueda del mouse solo sube y baja
// y la barra de desplazamiento está oculta, así que no se llegaba a las
// etiquetas de la derecha. Acá se suma, sin tocar cada pantalla:
//   · la rueda del mouse mueve la fila de costado,
//   · se puede arrastrar con el mouse,
//   · flechas ‹ › en los bordes cuando hay más etiquetas para ese lado
//     (solo en dispositivos con mouse).
// Sirve para la app y para la carta QR: el estilo viene acá adentro.

const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>';

const CSS = `
.desliza-env { position: relative; min-width: 0; }
.desliza-flecha { display: none; position: absolute; top: 50%; z-index: 3; width: 32px; height: 32px; margin-top: -16px;
  border-radius: 50%; border: 1px solid rgba(0,0,0,.14); background: #fff; color: #1e1e1e; box-shadow: 0 2px 10px rgba(0,0,0,.18);
  cursor: pointer; align-items: center; justify-content: center; padding: 0; }
.desliza-flecha svg { width: 16px; height: 16px; }
.desliza-flecha.izq { left: -6px; }
.desliza-flecha.der { right: -6px; }
.desliza-flecha.der svg { transform: rotate(180deg); }
.desliza-flecha:hover { background: #f3f3f3; }
@media (hover: hover) and (pointer: fine) {
  .desliza-env.puede-izq > .desliza-flecha.izq, .desliza-env.puede-der > .desliza-flecha.der { display: flex; }
  .desliza-env > .arrastrando { cursor: grabbing; user-select: none; }
}`;

function ponerEstilo() {
  if (document.getElementById("desliza-css")) return;
  const st = document.createElement("style");
  st.id = "desliza-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

// Arrastre con el mouse: un solo estado para toda la página
let arrastre = null;
function iniciarArrastreGlobal() {
  addEventListener("pointermove", (e) => {
    if (!arrastre) return;
    const dx = e.clientX - arrastre.x;
    if (!arrastre.movio && Math.abs(dx) < 6) return;
    arrastre.movio = true;
    arrastre.fila.classList.add("arrastrando");
    arrastre.fila.scrollLeft = arrastre.inicio - dx;
  });
  addEventListener("pointerup", () => {
    if (!arrastre) return;
    const { fila, movio } = arrastre;
    arrastre = null;
    fila.classList.remove("arrastrando");
    if (!movio) return;
    // Si se arrastró, el clic que viene después no elige la etiqueta
    const anular = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    fila.addEventListener("click", anular, { capture: true, once: true });
    setTimeout(() => fila.removeEventListener("click", anular, true), 0);
  });
}

function preparar(fila) {
  if (fila.dataset.deslizable) return;
  fila.dataset.deslizable = "1";
  // Envoltorio para las flechas; toma el lugar de la fila en el diseño
  const cs = getComputedStyle(fila);
  const env = document.createElement("div");
  env.className = "desliza-env";
  env.style.flex = cs.flex;
  env.style.alignSelf = cs.alignSelf;
  env.style.gridColumn = cs.gridColumn;
  env.style.gridRow = cs.gridRow;
  fila.before(env);
  env.append(fila);
  const flecha = (lado) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `desliza-flecha ${lado}`;
    b.tabIndex = -1;
    b.setAttribute("aria-label", lado === "izq" ? "Ver las anteriores" : "Ver más");
    b.innerHTML = CHEVRON;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fila.scrollBy({ left: (lado === "izq" ? -1 : 1) * Math.max(140, fila.clientWidth * 0.7), behavior: "smooth" });
    });
    return b;
  };
  env.append(flecha("izq"), flecha("der"));

  const actualizar = () => {
    const max = fila.scrollWidth - fila.clientWidth;
    const visible = !fila.hidden && fila.offsetParent !== null;
    env.classList.toggle("puede-izq", visible && fila.scrollLeft > 2);
    env.classList.toggle("puede-der", visible && max > 2 && fila.scrollLeft < max - 2);
  };
  fila.addEventListener("scroll", actualizar, { passive: true });
  new ResizeObserver(actualizar).observe(fila);
  new MutationObserver(actualizar).observe(fila, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  document.fonts?.ready.then(actualizar);
  actualizar();

  // Rueda del mouse: de costado. En el borde, la página sigue bajando normalmente.
  fila.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;
    const max = fila.scrollWidth - fila.clientWidth;
    if (max <= 0) return;
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
    if ((d < 0 && fila.scrollLeft <= 0) || (d > 0 && fila.scrollLeft >= max - 1)) return;
    e.preventDefault();
    fila.scrollLeft += d;
  }, { passive: false });

  fila.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if (fila.scrollWidth <= fila.clientWidth) return;
    arrastre = { fila, x: e.clientX, inicio: fila.scrollLeft, movio: false };
  });
}

/** Prepara todas las filas que coinciden con el selector, también las que aparezcan después. */
export function activarDeslizables(selector) {
  ponerEstilo();
  iniciarArrastreGlobal();
  const revisar = () => document.querySelectorAll(selector).forEach(preparar);
  revisar();
  new MutationObserver(revisar).observe(document.body, { childList: true, subtree: true });
}
