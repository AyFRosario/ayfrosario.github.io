# A&F — versión 1.2.6

PWA para celular, tablet y PC. HTML, CSS y JS sin compilar, igual que el resto de JPSoft. Se publica en GitHub Pages y usa Firebase (Firestore + Auth) con caché sin conexión.

## Qué hace esta versión

| Pantalla | Quién la usa | Qué hace |
|---|---|---|
| **Salón** | Mozo, encargado, dueño | Mesas por sector, con total, tiempo abierta y avisos (por ejemplo, "2 listos", "sin enviar" o "pidió la cuenta"). Arriba aparece la franja "Listo para llevar". |
| **Comanda** | Mozo | Carta por categorías con buscador tolerante: "milaneza" encuentra "milanesa". Escáner de códigos con la cámara o con un lector USB. Notas por ítem y **opciones** (guarnición, punto, agregados con precio). Enviar a cocina o barra. Precuenta, pasar a otra mesa, cerrar sin cobrar. |
| **Cocina y barra** | Cocina | Pedidos en columnas: Pendiente → En preparación → Listo. Suena un aviso al entrar un pedido y se puede imprimir solo. La pantalla no se apaga. |
| **Cobro** | Encargado (y mozos si se habilita) | Descuento en % o $, **propina** aparte, pago dividido entre varios medios, vuelto, ticket no fiscal y botón **Facturar en ARCA**. |
| **Caja** | Encargado, dueño | La jornada no se corta a medianoche. Muestra totales por medio de pago, y permite cargar gastos, retiros e ingresos. El cierre hace el arqueo (contado contra esperado) y la anulación de ventas devuelve el stock. Uno o varios **turnos de caja** por día, según el bar. |
| **Productos** | Encargado, dueño | Alta y edición con código de barras. Control de stock con aviso de stock bajo. **Ingreso de mercadería escaneando con el celular**. Precios en tanda. |
| **Gastos y resultado** | Dueño | Gastos fijos del mes (alquiler, sueldos, servicios…) y el **resultado**: lo vendido menos compras y gastos. |
| **Reservas** | Mozo, encargado, dueño | Reservas por día: confirmar por WhatsApp, sentar en una mesa, "no vino". Las de hoy aparecen arriba del salón. |
| **Compras** | Encargado, dueño | Compras que suman stock (insumos y bebidas) y actualizan el costo. Proveedores con lo que se les debe. |
| **Clientes** | Encargado, dueño | Cuenta corriente: cobrar "a cuenta", registrar pagos y mandar el saldo por WhatsApp. |
| **Vencimientos** | Encargado, dueño | Matafuegos, campana, plagas, habilitación, seguro… con aviso en el salón. |
| **Usuarios** | Dueño | Cuatro roles: dueño, encargado, mozo y cocina. Además está el **Administrador** (quien mantiene el sistema), que no aparece en la lista. |
| **Ajustes** | Todos | Impresora de cada dispositivo. Datos del negocio, mesas y respaldo completo en Excel (solo encargado y dueño). |

En el celular, la barra de abajo muestra hasta cuatro pantallas y el botón **Más** con el resto. Al mozo le entran todas, así que no lo ve.

## 1. Probarlo ya (modo demo)

Con `firebase: null` en `js/config.js`, la app arranca en **modo demo**: los datos se guardan solo en ese navegador y trae una carta y mesas de ejemplo.

- Subí la carpeta a un repo y activá GitHub Pages, o probá en la PC con `python -m http.server` y abrí `http://localhost:8000`.
- Elegí un usuario (Juan es mozo, Laura es encargada, también está Cocina).
- **Para ver el circuito completo** abrí dos pestañas del mismo navegador: una como Juan y otra como Cocina. Lo que carga el mozo aparece al instante en la cocina.

Con `?demo` al final de la dirección se fuerza el modo demo aunque Firebase esté configurado.

## 2. Conectarlo a Firebase

1. Creá un proyecto nuevo en [console.firebase.google.com](https://console.firebase.google.com) (por ejemplo, `jpsoft-af`).
2. **Authentication → Método de acceso → Correo/contraseña → Habilitar.**
3. **Firestore Database → Crear base de datos** (modo producción, región `southamerica-east1`).
4. **Firestore → Reglas:** pegá el contenido de `firestore.rules` y tocá **Publicar**.
5. **Configuración del proyecto → Tus apps → Web (</>)**. Copiá el objeto `firebaseConfig` y pegalo en `js/config.js`, en lugar de `firebase: null`.
6. **Authentication → Configuración → Dominios autorizados:** agregá `tuusuario.github.io`.
7. En **Authentication → Usuarios → Agregar usuario**, creá tu propia cuenta (la del dueño).
8. Entrá a la app con esa cuenta. Como el negocio todavía no existe, te ofrece **Crear negocio** y quedás como dueño. Hacelo apenas publicás: el primero que entra queda como dueño.
9. Desde **Usuarios** creá a los mozos, al encargado y a la cuenta de cocina. Cada uno entra con su email y su contraseña.
10. **Tu usuario como Administrador:** en **Firestore → Datos → negocios → af → usuarios →** tu documento (el que tiene tu email), cambiá el campo `rol` de `dueno` a `admin`. Después creá desde la app el usuario del dueño real del bar. (Antes tienen que estar publicadas las reglas de la versión 0.9.1.)

Todo queda guardado en `negocios/af/…`. Si después A&F se vende a otro bar, se cambia `negocioId` y los datos no se mezclan.

## 3. Impresoras (58 y 80 mm)

Cada dispositivo elige su impresora en **Ajustes → Este dispositivo**.

| Modo | Dónde | Conexión | ¿Imprime sin preguntar? |
|---|---|---|---|
| **Bluetooth directo** | Chrome en Android o PC | Térmicas Bluetooth (BLE) | Sí. **Es el recomendado para la tablet de cocina.** |
| **USB directo** | Chrome en Android con cable OTG | USB | Sí |
| **App RawBT** | Android | Bluetooth clásico, USB y **de red/wifi** | Abre RawBT un instante |
| **Impresora de la PC** | Windows | Cualquier impresora instalada (USB o red) | Solo si se configura Chrome en modo kiosco (ver abajo) |

- Los tickets salen con ñ y acentos (página de códigos PC850). Si alguna impresora imprime símbolos raros, activá "Imprimir sin acentos".
- Desde el navegador **no se puede mandar datos directo a una impresora de red**. Para eso están RawBT (en Android) o el driver de Windows (en la PC).
- **Cocina en PC con impresión automática:** creá un acceso directo de Chrome con `--kiosk-printing` al final del destino. Así imprime en la impresora predeterminada sin mostrar el diálogo:
  `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://tuusuario.github.io/AF/`
- En la tablet de cocina, activá **Imprimir solo** en la pantalla de cocina. Con Bluetooth, la primera vez de cada sesión hay que tocar "Conectar impresora".
- **Ticket del cliente (v1.1):**
  - El botón **Ticket** (al cobrar, en el detalle de una venta y en el cierre de caja) abre una vista previa con dos opciones:
    - **Imprimir:** sale por la impresora del dispositivo. Si no hay ninguna configurada, se abre el diálogo de impresión del navegador.
    - **Guardar en el dispositivo:** baja un PDF del ancho del ticket (58 u 80 mm), por ejemplo "Ticket C11-0001 - Mesa 3.pdf" o "Cierre de caja 21-11-2026.pdf". Se puede reimprimir o mandar después.
  - **Arriba:** el **logo**, el lema (**Comé como en casa**) y la dirección y el WhatsApp del local. El lema, la dirección y el WhatsApp salen de Ajustes → Negocio.
  - **Abajo:** el pie del ticket (¡Gracias por venir!).
  - **Dónde va el logo:** en el ticket de la venta y en la precuenta. La comanda de cocina y el cierre van sin logo, para que salgan rápido.
  - **En la térmica (Bluetooth, USB o RawBT)** el logo se manda como imagen en blanco y negro. Si alguna impresora lo imprime cortado o con rayas, se apaga en **Ajustes → Este dispositivo → Logo en el ticket del cliente**, y sale el nombre en letras grandes. La **impresión de prueba** también lleva el logo, para probarlo.
- **Antes de comprar la impresora**, conviene que sea térmica ESC/POS con Bluetooth BLE o USB. Las Xprinter, Gprinter y las "58mm Bluetooth" genéricas suelen funcionar.

## 3 bis. Cargar la carta desde Excel

**Productos → Excel** tiene tres opciones:

- **Descargar plantilla:** un Excel con las columnas (Nombre, Categoría, Precio, Prepara, Código de barras, Controla stock, Stock, Stock mínimo, Activo), ejemplos y una hoja de instrucciones. Se lo podés pasar al bar para que lo complete.
- **Importar desde Excel** (.xlsx, .xls, .csv, .ods):
  - Reconoce encabezados con otros nombres: "Producto", "Rubro", "Precio ($)", "Cod. barras"…
  - Entiende precios escritos como `15500`, `15.500` o `$ 15.500`, y los CSV que guarda Excel en Windows.
  - También acepta una **carta sin encabezados**: una fila con la categoría y abajo los productos con su precio.
  - Si no dice quién prepara cada producto, lo deduce: bebidas → Barra; latas, botellas o con código → Mozo; el resto → Cocina.
  - **Antes de guardar muestra qué es nuevo, qué cambia y qué tiene errores**, y descarga una copia de la carta anterior.
  - Los productos se reconocen por código de barras o por nombre, así que reimportar no duplica nada.
  - Opciones: ordenar la carta como en el archivo (activada sola cuando el archivo es la carta completa) y desactivar los productos que no están en el archivo (no los borra).
- **Exportar la carta actual:** sirve de respaldo y para actualizar precios en Excel y volver a importarla.

El lector de Excel (SheetJS) se descarga la primera vez que se usa.

## 3 ter. Carta QR para los clientes

- **Dónde está:** **Ajustes → Carta QR**. Ahí están la dirección de la carta (`carta.html`) y los botones para verla, **Imprimir QR** y **Descargar QR** (una imagen PNG para Instagram, la vidriera o un volante).
- **Un solo QR para todo (v1.2.6):** el mismo código va en todas las mesas, el mostrador y la puerta. **Imprimir QR** arma hojas A4 con 12 copias para recortar (12, 24, 36 o 48). La carta muestra el botón "Reservar mesa" por WhatsApp si está activado en Ajustes → Negocio.
- **Actualización:** la carta se publica sola. Cuando un encargado o el dueño tiene la app abierta y cambia productos, precios, stock o mesas, se vuelve a publicar en unos segundos.
- **Qué ven los clientes:**
  - los productos activos con "Mostrar en la carta QR" marcado;
  - los que se quedaron sin stock, como "Agotado";
  - la descripción de cada producto (se carga en el producto o en la columna "Descripción" del Excel);
  - al pie, dirección, horario, Instagram y WhatsApp (se cargan en Ajustes → Negocio).
- **Por qué no expone datos:** la página no inicia sesión. Lee un único documento (`negocios/af/publico/carta`) por la API de Firestore, así que cada visita gasta una sola lectura y no puede ver stock ni ventas.
- **Sin señal:** el teléfono del cliente guarda la última carta que vio y la muestra si se queda sin conexión.
- **Requisito:** **hay que volver a publicar `firestore.rules`**, que ahora incluye la regla `publico`.

## 3 quater. Reportes

En **Reportes** (encargado y dueño) se elige el período: última jornada, últimos 7 días, este mes, mes anterior o fechas a elección. Cada número se compara con el período anterior equivalente.

- **Totales:** vendido, mesas cobradas, ticket promedio, gasto por persona, descuentos y ventas anuladas (las anuladas no se suman).
- **Gráficos:** ventas por día, hora de llegada de las mesas, medios de pago y ventas por categoría. Pasando el mouse o tocando una barra se ve el detalle.
- **Rankings:** productos más vendidos (y los menos pedidos) y rendimiento por mozo.
- **Excel:** exporta el período con las hojas Resumen, Ventas, Productos, Mozos y Días.

El **día comercial empieza a las 6 de la mañana**: lo que se cobra a las 2 de la madrugada cuenta para la noche anterior.

## 3 quinquies. Stock por receta (insumos)

- **Insumos:** se cargan en **Productos → Insumos** (carne, muzzarella, papas, harina, aceite…), cada uno con su unidad (kg, g, l, ml o unidades), el stock, el mínimo para avisar y el costo opcional.
- **Recetas:** en cada producto, la sección **Receta** dice qué insumos usa cada unidad vendida. Por ejemplo, una milanesa napolitana usa 0,25 kg de carne, 0,1 kg de muzzarella y 0,3 kg de papas. Si los insumos tienen costo, se ve el costo del plato y su margen.
- **Cuándo se descuenta:** cuando el mozo **envía** el pedido, no al cobrar. Así el aviso llega durante el servicio. Si se anula un ítem enviado, los insumos vuelven. Lo que se cobra sin haberse enviado se descuenta al cobrar.
- **Avisos:**
  - en el **Salón**, una banda roja con los insumos por debajo del mínimo (solo para encargado y dueño);
  - en la pestaña **Insumos**, un contador;
  - en la carta del mozo, la etiqueta "falta muzzarella" cuando un insumo llega a 0. Avisa pero no bloquea la venta.
- **Ingreso de insumos:** tocás el insumo, escribís cuánto entró y se suma. Un conteo físico se carga editando el stock del insumo.
- **Diferencia con los productos envasados:** el stock de las bebidas y otros envasados (con "Controlar stock") se sigue descontando al cobrar.
- **Requisito:** hay que volver a publicar `firestore.rules`, que ahora incluye la regla `insumos`.

## 3 sexies. Reservas, compras, clientes, vencimientos y respaldo (v0.6)

**Antes de usar esta versión hay que volver a publicar `firestore.rules`.** Trae reglas para `reservas`, `proveedores`, `compras`, `clientes`, `movClientes` y `recordatorios`. Sin ellas, esas pantallas no guardan.

### Reservas
- Se cargan por día con nombre, teléfono, hora, personas, mesa (opcional) y una nota.
- **WhatsApp** abre el chat con el mensaje de confirmación ya escrito. Al volver, la app pregunta si confirmó.
- **Sentar** abre la mesa con los comensales de la reserva y la marca como sentada. Si la mesa asignada está ocupada, deja elegir otra.
- En el **Salón**:
  - las reservas de hoy aparecen arriba, con el botón Sentar;
  - una reserva pasa a "demorada" 15 minutos después de la hora;
  - la mesa reservada se marca en azul desde 3 horas antes;
  - al abrir una mesa reservada, la app pregunta si es la reserva.
- En la **carta QR** hay un botón **Reservar mesa**: el cliente completa nombre, día, hora y personas, y se abre WhatsApp con el pedido. No se guarda solo; lo carga el bar al confirmar. Aparece si en Ajustes hay un WhatsApp cargado, y se puede apagar.

### Compras y proveedores
- **Nueva compra:** se elige el proveedor y se buscan o escanean los ítems que llegaron, con cantidad y costo.
- **Qué se actualiza:**
  - los insumos suman stock y toman el costo nuevo, así el costo de las recetas queda al día;
  - las bebidas y los envasados suman stock y guardan el último costo.
- **Cómo se paga:**
  - con **efectivo de la caja**: queda como gasto en el arqueo;
  - por **transferencia u otro medio**: no toca la caja;
  - **queda debiendo**: se suma a lo que se le debe al proveedor.
- Los **pagos a proveedores** se registran desde la ficha de cada uno.
- Una compra o un pago se pueden **anular**: se revierte el stock y la deuda. Si fue con la caja todavía abierta, también se quita el gasto.

### Clientes con cuenta corriente
- **Cobrar a cuenta:** en el cobro aparece el medio **Cuenta corriente**. Al elegirlo, se elige el cliente (o se crea uno nuevo, solo encargado y dueño). Se puede combinar con otros medios; por ejemplo, la mitad en efectivo y la otra mitad a cuenta.
- La venta queda registrada como cualquier otra. Lo que va a cuenta **no entra al arqueo** de efectivo.
- En **Clientes**:
  - el saldo de cada uno y el total que te deben;
  - los movimientos;
  - **Registrar pago**: un pago en efectivo con la caja abierta entra como ingreso en el arqueo;
  - **WhatsApp**: manda el saldo pendiente.
- **Anular** una venta cargada a cuenta descuenta ese monto del saldo.
- Se puede apagar en **Ajustes → Negocio**.

### Vencimientos
- Hay plantillas listas: matafuegos, campana, plagas, tanque de agua, habilitación, seguro y carnet de manipulación.
- Cada vencimiento tiene una fecha, cada cuánto se repite y con cuántos días de anticipación avisar.
- El **Salón** muestra los vencidos (en rojo) y los próximos (en ámbar) a encargado y dueño.
- **Hecho** pasa la fecha al próximo vencimiento.

### Respaldo
- **Dónde:** en **Ajustes → Respaldo**, que descarga un Excel con todo.
- **Qué incluye:**
  - la carta, en el mismo formato del importador, así se puede volver a cargar;
  - insumos y recetas;
  - mesas;
  - ventas y su detalle;
  - cajas y movimientos de caja;
  - clientes y cuentas corrientes;
  - proveedores y compras;
  - reservas, vencimientos y usuarios;
  - el registro de cambios.
- Al **cerrar la caja**, si pasaron 7 días desde el último respaldo, la app lo sugiere con un botón para descargarlo ahí mismo.
- Los datos ya están en Firebase. El respaldo sirve como copia propia, para guardarla en el Drive o en la PC.

## 3 septies. Logo, contactos y firma (v0.7)

- **Logo:** debajo de A&F van las dos hojas con el tenedor, como en el cartel del bar. En el menú de la PC, el logo va sobre una tarjeta blanca. En toda la app dice solo "A&F".
- **Íconos al instalar:** el logo ocupa casi todo el ícono.
  - En la PC y en Windows, el ícono va sin fondo.
  - En Android se adapta a la forma del celular (círculo, cuadrado redondeado), sobre fondo blanco.
  - En iPhone usa `apple-touch-icon.png`.
  - Para ver el ícono nuevo hay que desinstalar la app y volver a instalarla.
- **Contactos de la carta QR:** van al pie, como en la carta de Dairus: WhatsApp, Instagram, Facebook y la dirección, cada uno con su logo y como enlace directo.
  - Se cargan en **Ajustes → Negocio**. Los que quedan vacíos no aparecen.
  - La dirección abre Google Maps. Se puede pegar el enlace exacto del local, el de "Compartir" en Maps.
- **Firma "Desarrollado por Joaquín Pedemonte"** con WhatsApp, en:
  - la pantalla de inicio;
  - el pie del menú en la PC;
  - el menú de usuario, en el celular;
  - el final de Ajustes;
  - la carta QR.
- **Categorías:**
  - en el alta de producto, el desplegable muestra todas las categorías y la opción **＋ Nueva categoría…**;
  - en **Productos → Categorías** se renombran y se ordenan; el orden es el de la carta QR y el de la comanda;
  - la categoría "Menúes" pasa sola a llamarse "Menús" la primera vez que un dueño o encargado abre esta versión.
- **Carta QR:** las etiquetas de arriba quedan marcadas al tocarlas y siguen la sección que se está viendo. El desplazamiento con el dedo ya no se corta.

## 3 octies. Menú ordenado por uso (v0.7.2)

- **Orden:** el menú va de lo más usado a lo menos usado y es el mismo en la PC y en el celular.
  - **Servicio:** Salón, Caja, Reservas, Cocina y barra.
  - **Administración:** Productos, Compras, Reportes, Clientes, Vencimientos.
  - **Configuración:** Usuarios, Ajustes.
- **Celular:** la barra de abajo muestra las cuatro primeras que puede ver cada rol. El resto queda en **Más**, agrupado igual que en la PC.
  - Dueño y encargado: Salón, Caja, Reservas, Cocina y barra, y Más.
  - Mozo: Salón, Reservas y Ajustes.
- **Pantalla al abrir:** en **Ajustes → Este dispositivo → Al abrir la app, mostrar** se elige con qué pantalla arranca cada equipo. Por ejemplo, la PC del mostrador en Caja y la tablet de la cocina en Cocina y barra. Si el rol no puede ver la pantalla elegida, abre en Salón.
- **Ajustes:** Este dispositivo, Carta QR, Respaldo, Mesas y Negocio, en ese orden.

## 3 nonies. Para llevar, delivery y venta rápida (v0.8)

- **Dónde:** el **Salón** tiene dos pestañas, **Mesas** y **Para llevar y delivery** (en el celular, "Pedidos"). Cada dispositivo recuerda la última que se usó.
- **Pedido para llevar o delivery:**
  - Se cargan nombre, teléfono, hora de retiro o entrega y una nota.
  - En los delivery también la dirección y el costo de envío. El envío habitual se configura en Ajustes → Negocio y se puede cambiar en cada pedido.
  - Si el nombre es de un cliente guardado (Clientes, que ahora tiene dirección), completa solo el teléfono y la dirección.
  - Después se cargan los productos igual que en una mesa y se envían a cocina o barra.
- **En la cocina:**
  - Las tarjetas de los pedidos tienen una banda clara arriba, por ejemplo "LLEVAR · 13:30 h" o "DELIVERY · 21:15 h".
  - La comanda impresa dice "*** PARA LLEVAR ***" o "*** DELIVERY ***", con la hora.
- **Tarjetas del Salón:** muestran el estado de cada pedido: sin enviar, en preparación, demorado (si pasó la hora), listo para retirar o para salir, y en camino o entregado si falta cobrar.
- **Cuando la cocina termina:** el pedido aparece en **Listo para entregar** con el botón **Entregado** o, si es delivery, **Salió**.
- **Cobro:** se puede cobrar antes, al tomar el pedido, o después, cuando vuelve el repartidor o el cliente lo retira.
- **WhatsApp al cliente:** el ícono de WhatsApp de la comanda tiene mensajes listos: "pedido recibido" con el detalle y el total, "está listo para retirar" y "va en camino".
- **Ticket para el envío:** en el delivery, la precuenta sale con nombre, teléfono, dirección, hora y nota.
- **Venta rápida:**
  - **Siempre a mano (v1.2):** es lo primero del menú, arriba de Salón; en el celular, el primer botón de la barra de abajo. La app igual abre en Salón. En el celular y la tablet, la barra de abajo se ve también adentro de la venta, de las mesas y de los pedidos (v1.2.4), así se cambia de sección sin volver. En la PC también está la tecla **F2** (el menú lo recuerda al lado de "Venta rápida"), que la abre desde cualquier pantalla. Si hay una ventana abierta, F2 no hace nada.
  - Para el mostrador, sin datos del cliente. Arranca en ★ Favoritos y se cobra directo; lo que es de barra o cocina se envía solo.
  - Al terminar, el botón **Otra venta rápida** abre la siguiente.
  - Si se sale sin cargar nada, no queda abierta.
- **Favoritos:** la estrella en **Productos** (o el interruptor en la ficha) marca los productos que aparecen primero.
- **Reportes:**
  - Hay una sección nueva, "Mesas, para llevar y delivery".
  - El gasto por persona se calcula solo con las mesas.
  - El Excel y el respaldo traen el tipo de venta y los datos del cliente.

## 3 decies. Opciones de los productos y propina (v0.9)

### Opciones: guarnición, punto, agregados
- **Dónde se arman:** **Productos → Opciones**. Cada grupo tiene:
  - un nombre (Guarnición, Punto de la carne, Agregados…);
  - si se elige **una** o **varias** (con un máximo opcional);
  - si es **obligatorio**;
  - las opciones, cada una con un precio extra si suma algo (por ejemplo, "Huevo frito + $800").
- **Plantillas:** hay tres listas para empezar (Guarnición, Punto de la carne y Agregados). Se tocan, se ajustan y se guardan.
- **A qué productos se aplica:** en el mismo grupo se tildan los productos (buscador y lista por categoría). También se puede hacer desde la ficha de cada producto, en "Opciones al cargarlo en la comanda". Un grupo sirve para muchos productos.
- **En la comanda:** al tocar un producto con opciones se abre una ventana para elegir. No deja agregar hasta completar lo obligatorio, y el botón muestra el precio con los extras. Se puede elegir la cantidad ahí mismo.
- **Cómo queda cargado:** el ítem muestra lo elegido debajo del nombre ("Puré · Jugoso"). Dos milanesas con distinta guarnición quedan en líneas separadas; iguales se suman.
- **Cocina e impresión:** la pantalla de cocina lo muestra resaltado y la comanda impresa lo agrega en una línea aparte, en letra grande.
- **Cobro, ticket y caja:** muestran el detalle. El precio de la línea ya incluye los extras.
- **Carta QR:** debajo de cada producto con opciones aparece un resumen, por ejemplo "Guarnición: papas fritas, puré o ensalada".
- **Reportes:** los productos se siguen contando por producto (la milanesa es una sola fila, con cualquier guarnición).

### Propina
- **Al cobrar:** debajo del total hay una fila **Propina** con tres botones: **No**, el **porcentaje sugerido** (10% de fábrica) o **$** para poner un monto. Si hay propina, aparece "A pagar con propina" y los medios de pago se completan con ese importe.
- **No es venta:** se guarda aparte. "Vendido", ticket promedio y reportes no la suman.
- **Ticket del cliente:** muestra Total, Propina y Total pagado.
- **Caja:**
  - "Cobrado por medio de pago" incluye la propina, porque es plata que entró.
  - Abajo se ve cuánto fue de propinas y cuánto le toca a cada mozo.
  - En el cierre se ven las propinas del turno por mozo. Si se reparten en efectivo antes de contar, se cargan como **retiro** para que la caja cuadre. El ticket de cierre también las lista.
- **Reportes:**
  - Las propinas se ven aparte y por mozo, en una columna nueva.
  - En "Medios de pago" se descuentan, así esa sección muestra solo lo vendido.
  - El Excel trae la propina de cada venta.
- **Ajustes → Negocio:**
  - registrar propinas sí o no (si se apaga, desaparece del cobro);
  - el porcentaje sugerido;
  - si la precuenta impresa muestra la propina sugerida (solo en mesas).

## 3 undecies. Administrador oculto (v0.9.1)

- **Para qué:** es el rol de quien desarrolla y mantiene el sistema. Tiene los mismos permisos que el dueño.
- **Oculto:** no aparece en **Usuarios** ni en la hoja "Usuarios" del respaldo, salvo para otro administrador. Tampoco se ofrece en la lista de roles al crear o editar un usuario.
- **Protegido:** las reglas de Firebase no dejan que el dueño lo cree, lo edite, lo desactive ni lo borre. El dueño tampoco puede pasarse a sí mismo a administrador.
- **No atiende:** si abre una mesa, elige a qué mozo queda asignada, así no aparece en los reportes por mozo.
- **Lo que sí queda a la vista:** lo que hace con su usuario queda firmado con su nombre como cualquier otro (quién cobró, quién abrió la caja, el registro del respaldo). Así siempre se sabe quién hizo cada cambio.
- **En el demo:** se entra con `?demo&admin`.

## 3 duodecies. Turnos de caja, gastos fijos y resultado del mes (v1.0)

### Turnos de caja
- **Se configuran en Ajustes → Turnos de caja:** uno, dos, tres o cuatro por día, cada uno con nombre y horario. Al elegir la cantidad se proponen nombres y horarios típicos (por ejemplo, "Mañana/tarde" de 08:00 a 16:00 y "Tarde/noche" de 16:00 a 02:00), que se pueden cambiar. Un turno puede pasar la medianoche.
- **Con uno solo** (como venía hasta ahora) no se elige nada al abrir la caja.
- **Al abrir la caja:** se elige el turno. Viene marcado el que corresponde a la hora. Si el turno anterior cerró hace poco, se ofrece usar como fondo el efectivo que se contó.
- **Dónde se ve el turno:** arriba de la caja abierta, en la lista de cajas anteriores, en el cierre y en el ticket de cierre.
- **Cada venta guarda su turno.** Las ventas anteriores a este cambio se ubican por la hora.
- **Reportes:** la sección **Por turno de caja** muestra cuánto se vendió en cada turno, cuántas ventas hubo y el ticket promedio. "Última jornada" pasa a llamarse **Último turno** y se compara con el mismo turno de la semana pasada. El Excel y el respaldo traen el turno de cada venta y de cada caja.

### Gastos y resultado (solo dueño y administrador)
- **Dónde:** **Gastos y resultado**, en Administración. Se recorre mes por mes con las flechas.
- **Gastos fijos:** son los que no pasan por la caja: alquiler, sueldos y cargas sociales, servicios, impuestos y tasas, mantenimiento, seguros, abonos. Cada uno tiene categoría, detalle y monto. Se pueden crear categorías nuevas.
- **"Se repite todos los meses":** al empezar un mes aparece el aviso "Octubre tiene 6 gastos fijos que se repiten" con el botón **Copiarlos**. Después se corrigen los montos que hayan cambiado.
- **Resultado:** lo vendido, menos las compras de mercadería, menos los gastos pagados de la caja, menos los gastos fijos. Se ven el margen y el resultado del mes anterior.
- **Para que no se cuente nada dos veces:**
  - Las propinas no son venta.
  - Las compras se cuentan en el mes en que se cargan, aunque se paguen después.
  - Si una compra o un pago a proveedor salió de la caja, ese gasto de caja no se vuelve a sumar.
  - Los retiros del dueño no son gastos.
- **"¿En qué se va la plata?"** muestra las barras por categoría, con la mercadería y los gastos de caja incluidos.
- **Quién lo ve:** solo el dueño y el administrador, porque incluye sueldos. El encargado no lo ve, y el respaldo que él descarga no trae la hoja de gastos fijos.
- **Reglas de Firebase:** esta versión agrega la colección `gastos`. Hay que volver a pegar `firestore.rules` y publicarlas.

## 3 terdecies. Etiquetas en la PC y categoría fija (v1.2.5)

- **Filas de etiquetas en la PC** (categorías de la comanda y de Productos, sectores del Salón, períodos de Reportes y categorías de la carta QR):
  - Se mueven con la rueda del mouse o arrastrando.
  - Cuando hay más etiquetas para un costado, aparece una flecha ‹ › en ese borde.
  - En el celular siguen deslizándose con el dedo, sin flechas.
- **Categoría fija:**
  - En **Productos → Categorías**, el botón del pin deja una categoría **siempre primera**: en la comanda (después de Todas), en Productos y en la carta QR. Queda primera aunque se vuelva a importar el Excel.
  - Se puede fijar una sola. Tocando el pin de nuevo se suelta. Si se renombra, sigue fija.
  - Al actualizar a esta versión, **Menús** queda fija sola.

## 4. Escáner de códigos

- **Android (Chrome):** usa el lector que trae el navegador. Es rápido y funciona sin conexión.
- **iPhone:** Safari no trae ese lector, así que la primera vez se descarga uno en WebAssembly (ZXing, unos cientos de KB). Después queda guardado.
- **Lector de mano (gatillo):** cualquier lector USB o Bluetooth "tipo teclado" funciona en PC, tablet o celular, sin configurar nada. Puede terminar con Enter o con Tab.
  - **En la ficha del producto,** el código siempre va al recuadro **Código**, aunque el cursor esté en otro campo. El Enter del lector no guarda la ficha. Si el código ya es de otro producto, avisa en el momento.
  - **Al tocar el recuadro Código** se selecciona lo que tiene, así el próximo escaneo reemplaza el código viejo. Ahí funciona a cualquier velocidad, aunque el lector Bluetooth haga pausas.
  - **En la lista de Productos,** escanear abre ese producto, o uno nuevo con el código ya puesto si no existe.
  - **En la comanda** carga el producto a la mesa. Si hay una ventana abierta (cobro, opciones…), no carga nada.
  - **En Nueva compra** cada lectura suma una unidad del producto.
  - **Botones de escanear en PC:** la ventana espera el gatillo del lector y no prende la cámara de la computadora. Si querés usar la cámara, está el botón "Usar la cámara de la computadora", y desde ahí "Lector" para volver. La elección queda recordada.
  - **En el celular** esos botones siguen abriendo la cámara.
  - **En cualquier modo,** lo que manda el lector va al recuadro de abajo de esa ventana, aunque el cursor no esté ahí.
- **Dónde se escanea:**
  - en la comanda, para cargar una lata o una botella a la mesa;
  - en Productos, para cargar el código;
  - en **Productos → Escanear → Asignar códigos**, que muestra uno por uno los productos sin código (primero bebidas y envasados): escaneás el envase y pasa al siguiente, con botones para saltear o volver;
  - en **Productos → Escanear → Ingreso de mercadería**, donde cada escaneo suma stock y se puede elegir de a 1, 6, 12 o 24. Los códigos que no existen se pueden **asignar a un producto que ya está cargado** (y se suman las unidades) o dar de alta como producto nuevo.
- La cámara solo funciona con `https` (GitHub Pages ya lo tiene) o en `localhost`.

**v1.0.1:** el lector de mano borraba el código cuando el cursor estaba en el recuadro **Código** de la ficha del producto. Ya está corregido.

**v1.0.2:** en PC, la ventana de escanear prendía la webcam y no recibía lo que mandaba el lector. Ahora espera el gatillo. Además, cada vez que se recarga, la app busca si hay una versión nueva: antes el navegador podía seguir usando archivos viejos hasta 10 minutos después de publicar.

## 5. Sin conexión

Firestore guarda una copia local. Si se corta el wifi, la app sigue funcionando: se abren mesas, se cargan pedidos y se cobra. Todo se sube solo cuando vuelve la red. Arriba aparece "Sin conexión" en rojo.

Para que eso no rompa los números:
- el stock se descuenta siempre con **incrementos**, nunca pisando el valor, así dos celulares vendiendo a la vez no se pisan;
- el número de venta lleva el código del dispositivo (`C15-0001`), así nunca se repite.

Lo único que necesita conexión es **entrar por primera vez** en cada dispositivo.

## 6. Archivos

```
index.html  carta.html  manifest.json  sw.js  firestore.rules
css/app.css
js/config.js       ← configuración (Firebase, ARCA)
js/app.js          ← arranque, sesión, menú, navegación
js/db.js           ← capa de datos (demo o Firebase)
js/db-demo.js  js/db-firebase.js
js/store.js        ← estado, roles, datos del dispositivo
js/util.js  js/buscar.js  js/scanner.js  js/print.js
js/importar.js     ← carta desde/hacia Excel
js/publicar.js     ← mantiene publicada la carta QR
js/carta.js        ← página pública de la carta
js/vendor/qrcode.mjs ← generador de QR (Kazuhiko Arase, licencia MIT)
js/respaldo.js     ← respaldo completo en Excel
js/firma.js        ← firma del desarrollador y contactos (WhatsApp, redes, Maps)
js/pedidos.js      ← pedidos para llevar, delivery y venta rápida
js/opciones.js     ← grupos de opciones (guarnición, punto, agregados)
js/vistas/resultado.js ← gastos fijos y resultado del mes
js/vistas/         ← salon, mesa, cobro, cocina, caja, productos, insumos, reportes,
                     reservas, compras, clientes, recordatorios, usuarios, ajustes
```

**Colecciones** (dentro de `negocios/{id}/`): `config`, `usuarios`, `mesas`, `productos`, `insumos`, `comandas`, `items`, `ventas`, `jornadas`, `movCaja`, `gastos`, `reservas`, `proveedores`, `compras`, `clientes`, `movClientes`, `recordatorios`, `logs`, `publico`.

## 7. De dónde salió cada cosa

- **JPSoft Tienda:**
  - cobro con descuento y medios de pago;
  - caja por turnos (pasó a jornada con arqueo);
  - anulaciones con historial;
  - alta de usuarios con una segunda instancia de Firebase;
  - modo sin conexión.
- **Dietética Josué:** buscador tolerante y fonético, escáner con cámara y detección del lector USB.
- **Dairus Rosario:** precios en tanda y reservas.
- **JPSoft Cocheras:** grilla (pasó a mapa de mesas), botón de ARCA, recordatorios y respaldo a Excel.

Problemas de los proyectos anteriores que esta versión no hereda:
- se descuenta stock con incrementos;
- los ítems guardan el id del producto, así las anulaciones devuelven bien el stock;
- no se guarda ninguna contraseña en el navegador;
- si falla la lectura del rol, no se entra como administrador;
- los roles se controlan en las reglas de Firestore.

## 8. Lo que sigue

- "Llamar al mozo" desde la carta QR
- Fotos de los productos en la carta QR
- Promos tipo "2 pintas + papas" o 2x1 en tragos
- Facturación electrónica con ARCA (cuando haga falta)
