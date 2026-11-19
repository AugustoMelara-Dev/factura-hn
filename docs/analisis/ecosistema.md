# Ecosistema e integraciones: qué conectores traerían más usuarios en Honduras

**Fecha:** 19 de noviembre de 2026 · **Alcance:** análisis, sin cambios de código · **Fuentes:** al final.

Este informe no interpreta reglas fiscales. Cuando un punto depende del Reglamento, cita el artículo como lo
recoge el repositorio (`docs/investigacion.md`, `docs/consulta-sar.md`). Lo que no está resuelto se marca
**«por confirmar»**. Las cifras de mercado son de terceros. Las que son estimaciones mías se marcan como
**«estimación»**.

---

## 1. Resumen

- **El cuello de botella no es la API alojada, sino dónde corre el sistema.** La lectura provisional de P-02
  recomienda «instalar el sistema en el establecimiento del negocio» (Art. 47, «el establecimiento donde se
  encuentre el servidor»). Por eso quedan detenidos los conectores que exigen nuestra API alojada (Shopify,
  Make/Zapier, Google Sheets). También quedan en duda los que corren en la nube *del propio negocio*:
  WooCommerce en un hosting o Next.js en Vercel. **Propuesta:** añadir a la consulta P-02 una subpregunta sobre
  el sistema propio del negocio alojado en la nube de un tercero.
- **Lo que se puede hacer ya, sin depender del SAR,** son las piezas que usan la API en modo local (LAN del
  negocio) o el SDK en el equipo: colecciones de Bruno y Postman, clientes de .NET, PHP y Python, nodo de n8n
  autoalojado y recetas de Excel. Todas son baratas porque ya existen `openapi.json` (OpenAPI 3.1, 23
  operaciones) y la imagen de Docker.
- **Antes de generar SDK hay que hacer un arreglo pequeño:** ninguna de las 23 operaciones del OpenAPI tiene
  `operationId`. Algunos generadores las omiten y otros inventan nombres inestables. Hay que añadirlos y probar
  los generadores con la versión 3.1 (NSwag y el generador de PHP de openapi-generator no la soportan del todo).
- **Por lenguaje, en Honduras:** JavaScript y TypeScript dominan, seguidos de Python. PHP y C# están casi
  empatados (GitHub, 2.º trimestre de 2026: JS 3,030 · TS 1,473 · Python 1,043 · PHP 505 · C# 493). En el
  comercio en línea, Shopify (987 tiendas) supera a WooCommerce (643). Ninguna de las dos se puede atender
  bien antes de P-02.
- **Orden recomendado:** (0) `operationId` e imagen Docker publicada; (1) Bruno, Postman y una plantilla
  Next.js de demostración; (2) clientes de .NET (POS de escritorio en el local) y PHP/Laravel, y luego Python;
  (3) n8n autoalojado y un módulo de Odoo con un partner; (4) después de P-02: WooCommerce, Shopify y
  Make/Zapier.

---

## 2. Contexto del mercado

### 2.1 Negocios

| Dato | Valor | Fuente y nota |
|---|---|---|
| Población, usuarios de Internet | 10.9 M; 7.19 M (65.8 %) | DataReportal, *Digital 2025: Honduras* |
| Sistema operativo móvil | Android 73.3 %, iOS 26.7 % (oct. 2026) | StatCounter |
| Negocios en operación / formalizados | ~1.2 M / menos del 30 % | La Prensa (31-08-2025), con datos del SAR |
| Empresas en el Sistema de Facturación del SAR | 374,993 | La Prensa, misma nota |
| Inscripciones nuevas en el régimen de facturación | 7,190 (2024); 3,782 (2025, hasta agosto) | La Prensa, misma nota |
| Autoimpresores por sistema computarizado | **No encontrado** | Ninguna fuente pública los desglosa: **por confirmar** con el SAR |

**Lectura:** el mercado direccionable no son los 1.2 M de negocios. Son los formales que eligen la modalidad
de autoimpresor, que exige inscribirse (Art. 47) y firmar la Declaración Jurada del Art. 53. **Estimación:**
son unas decenas de miles como mucho, y casi todos ya emiten con imprenta o con un sistema. Un conector atrae
usuarios si reduce el costo de *cambiar* a un sistema propio. No se trata de captar negocios nuevos.

### 2.2 Comercio en línea

| Plataforma | Tiendas con sede en Honduras | Fuente |
|---|---|---|
| Shopify | 987 (Cortés 364, Francisco Morazán 300) | StoreLeads, actualizado el 13-11-2026 |
| WooCommerce | 643 (97.7 % de las 658 tiendas con WordPress) | StoreLeads, mismo corte |
| Wix y otras | Sin dato fiable | AfterShip publica cifras, pero bloqueó la lectura. Sus números (WooCommerce 659, Shopify 530) no coinciden con los de StoreLeads: no los uso |

Ojo: StoreLeads cuenta dominios activos. Incluye tiendas de dropshipping y tiendas sin ventas reales. El número
de tiendas que facturan conforme al Reglamento es menor (**estimación:** una fracción, sin base para dar un
porcentaje). Statista (2021) también señalaba a WooCommerce como la plataforma más usada por los minoristas en
línea de Honduras, pero el dato es antiguo y está tras un muro de pago.

### 2.3 Desarrolladores

| Fuente | Qué muestra |
|---|---|
| **GitHub Innovation Graph**, Honduras, 2.º trimestre de 2026 (personas que hacen *push* por lenguaje) | HTML 3,793 · CSS 3,054 · **JavaScript 3,030** · **TypeScript 1,473** · **Python 1,043** · **PHP 505** · **C# 493** · Java 405 · Kotlin 191 · Blade (Laravel) 166 · Dart 126 |
| **LinkedIn Empleos**, Honduras (19-11-2026) | Python 555 · JavaScript 501 · .NET 151 · PHP 46. **Ojo:** la mayoría son puestos remotos de empresas de *outsourcing* (BairesDev, FullStack) para clientes extranjeros. Las ofertas de empleadores locales son sobre todo de PHP (Grupo Farsiman) y .NET (Deloitte en San Pedro Sula) |
| **Computrabajo / Toptrabajos / OPS** | Ofertas locales de .NET (C#, ASP.NET MVC, SQL Server), de PHP/Laravel y de PHP para proyectos de salud pública. Muestra cualitativa: Computrabajo no dejó leer los totales |
| **Stack Overflow Developer Survey 2025** (global, sin desglose por país) | JS 66 % · Python 57.9 % · TS 43.6 % · C# 27.8 % · PHP 18.9 %; Next.js 20.8 %, ASP.NET Core 19.7 %, WordPress 13.6 %, Laravel 8.9 % |

**Lectura:** GitHub sobrerrepresenta a estudiantes y al código abierto y subrepresenta al software
empresarial privado, donde .NET pesa más. **Estimación:** en los sistemas de los negocios hondureños (POS,
ERP a medida), C# y PHP pesan más que en GitHub, y Python pesa menos.

### 2.4 Sistemas de facturación y POS

- **ERP con localización hondureña:** Dynamics 365 Business Central tiene una localización en AppSource (LL
  Business Solutions) con gestión de CAI. AlfaPeople documenta otra. Odoo incluye a Honduras en su lista de
  localizaciones, pero sin página propia (solo Guatemala la tiene en Centroamérica), y hay **30 partners de
  Odoo** en Honduras (2 Gold). Solo encontré un módulo de CAI de un tercero (tecnochefca), sin documentación
  pública.
- **POS en la nube de América Latina:** no encontré pruebas de que Loyverse o Alegra POS manejen CAI en
  Honduras. Alegra POS no incluye a Honduras en su lista de países (Capterra). **Hueco de mercado: por
  confirmar.**
- **Proveedores locales:** Softland Honduras (ERP y POS) y muchos sistemas a medida (tesis de UNITEC). Esto
  indica que existe una capa de *software houses* locales que serían clientes naturales de un SDK o de una API
  local.
- **Factura electrónica:** sigue sin estar en vigor. El régimen CAI es el aplicable (VATupdate, agosto de
  2026; EY). Coincide con la hoja de ruta del repositorio (Arts. 54 y 58, pendiente).

---

## 3. Fichas por conector

### Datos del repositorio que aplican a todas las fichas

- **OpenAPI:** versión 3.1.0, 17 rutas y 23 operaciones, 9 etiquetas. Usa seguridad `llave` (Bearer), 5
  `type: [...]` (tipos con null, propios de 3.1) y 5 `anyOf`. Tiene **0 `operationId`**.
- **Lo que no se genera desde OpenAPI y hay que escribir a mano en cada lenguaje:**
  - la verificación de la firma de los webhooks (`t=<unix>,v1=HMAC-SHA256(secreto, "<t>.<cuerpo>")`, con 5
    minutos de tolerancia);
  - la clave de idempotencia estable por venta;
  - la cabecera `X-Operador` con `encodeURIComponent`;
  - mostrar tal cual los errores 422.
- **Generadores:**
  - Kiota (Microsoft) genera C#, PHP, Python y otros. Arma la ruta del cliente desde el path, así que depende
    menos del `operationId`.
  - openapi-python-client soporta 3.0 y 3.1.
  - El generador de PHP de openapi-generator es estable, pero sus tablas solo listan OAS2 y OAS3, y no soporta
    `anyOf`.
  - NSwag no confirma soporte de 3.1 (discusión abierta desde 2021, con actividad en enero de 2026).
  - Los conectores personalizados de Power Platform solo aceptan **OpenAPI 2.0**.
- **Lo que significa «dependencia de P-02»:** «Sí» = no se puede ofrecer como servicio sin la respuesta.
  «Parcial» = el conector funciona contra la API en modo local, pero su uso habitual pone el sistema en la nube
  de un tercero. Es la misma pregunta del Art. 47 y no está resuelta: **por confirmar**.

### 3.1 Colecciones de Bruno y Postman

| | |
|---|---|
| **Usuarios potenciales** | Cualquier desarrollador que no use JS/TS, y contadores técnicos que quieran ver la API sin programar. Es la ruta más corta de «no sé nada» a «emití una factura con CAI ficticio» fuera de Node. **Estimación:** acelera la adopción más de lo que suma usuarios por sí misma |
| **Esfuerzo** | Bajo. Bruno: `bru import openapi --source openapi.json` genera la colección, agrupada por etiqueta y con `servers` como entorno. Se guarda en el repositorio como archivos de texto, sin cuenta. Postman importa OpenAPI 3.0, 3.1 y 3.2 y genera la colección desde Spec Hub. Falta añadir a mano: el entorno `demo` (URL local y llave de caja), un `Idempotency-Key` generado en un *pre-request script* y ejemplos con lo mínimo necesario para la primera factura |
| **Mantenimiento** | Bajo, si se regenera en CI desde `openapi.json`, como ya se hace con `@factura-hn/cliente` |
| **P-02** | No. Apunta a `http://127.0.0.1:8787` con el tenant `demo` |
| **Nota** | Publicar en el espacio público de Postman exige una cuenta: decide el responsable. La de Bruno puede vivir en el repositorio desde el primer día |

### 3.2 Plantilla de Next.js / Vercel

| | |
|---|---|
| **Usuarios potenciales** | El grupo más grande de desarrolladores en Honduras (JS 3,030 + TS 1,473 en GitHub). Agencias que hacen tiendas y portales a medida |
| **Esfuerzo** | Bajo. `examples/nextjs` ya trae server action, idempotencia, PDF con enlace firmado y webhooks. Para entrar a la galería de Vercel faltan: demo desplegada en Vercel, botón *Deploy* en el README, App Router (ya lo usa) y un diseño cuidado |
| **Mantenimiento** | Medio. Next.js cambia cada pocos meses (el ejemplo ya está en la 16) |
| **P-02** | **Parcial.** Una demo con CAI ficticio y el SDK en memoria no emite nada real y se puede publicar. En producción, una app en Vercel es un servidor operado por un tercero: es la pregunta del Art. 47, aunque el sistema sea del propio negocio. La plantilla debe decirlo de forma explícita y ofrecer el camino local (API en Docker en el establecimiento). Si la plantilla apunta a nuestra API alojada, queda bloqueada |
| **Nota** | Para el objetivo de «primera factura en minutos», conviene que la demo use el SDK en el navegador o en memoria, como el playground, y que no necesite Docker |

### 3.3 SDK de Python

| | |
|---|---|
| **Usuarios potenciales** | Python es el 3.er lenguaje en GitHub de Honduras (1,043) y el primero en ofertas de LinkedIn, aunque casi todas son de outsourcing. Lo usan Django/FastAPI, análisis de datos y **Odoo** (que es Python). **Estimación:** pocos POS hondureños están en Python, así que su valor está en Odoo y en los ERP a medida |
| **Esfuerzo** | Bajo-medio para un **cliente** generado (openapi-python-client o Kiota), más unas 100 líneas a mano: firma de webhooks, errores y operador. Una **librería nativa** (reglas fiscales en Python, sin API) es alta: reescribir unas 3,400 líneas del núcleo y su batería de pruebas, con riesgo de divergencia fiscal |
| **Mantenimiento** | Bajo (cliente regenerado en CI) o alto (port nativo: cada corrección fiscal en dos lenguajes) |
| **P-02** | No, contra la API local |
| **Nota** | La hoja de ruta dice «Paquetes hermanos: Python y .NET». Recomiendo empezar por el cliente y no por el port. El prompt del README ya pide a los agentes generar el cliente desde `openapi.json`, así que el cliente oficial sobre todo aporta confianza y pruebas |

### 3.4 SDK de PHP / paquete de Laravel

| | |
|---|---|
| **Usuarios potenciales** | PHP 505 y Blade 166 en GitHub de Honduras. En las ofertas **locales** aparece más que en las remotas (Grupo Farsiman, Laravel con Vue y MySQL, sector salud). Es la base técnica de un futuro plugin de WooCommerce |
| **Esfuerzo** | Medio-bajo. Cliente con Kiota (PHP). Con openapi-generator habría que convertir los `anyOf`, que no soporta. Paquete de Laravel: *service provider*, configuración (`FHN_API_URL`, `FHN_LLAVE`), *middleware* de firma de webhooks y un *job* de emisión con clave de idempotencia por pedido |
| **Mantenimiento** | Medio-bajo. Versiones de PHP (8.1 o más) y de Laravel cada año |
| **P-02** | No, contra la API local. **Parcial** si la app de Laravel está en un hosting compartido: el mismo matiz que Vercel |

### 3.5 .NET para POS de escritorio

| | |
|---|---|
| **Usuarios potenciales** | Las *software houses* locales que mantienen POS de escritorio en C#/VB.NET con SQL Server (farmacias, ferreterías, supermercados). C# 493 en GitHub y la mayor parte de las ofertas locales de backend. **Estimación:** es el grupo con más negocios por desarrollador, porque un proveedor de POS atiende a decenas de clientes |
| **Encaje normativo** | El mejor de la lista. El POS y su servidor están en el establecimiento (Art. 47; Art. 4 num. 41-42). Cada caja usa su propio punto de emisión y CAI (regla 4 del README) |
| **Esfuerzo** | **Cliente HTTP** contra la API local en la LAN: bajo-medio. Kiota (C#) o NSwag, este último tras convertir la especificación a 3.0, porque no confirma soporte de 3.1. Se añaden a mano la firma de webhooks y los errores. **Port nativo offline** (núcleo en C# + SQLite, sin servidor): alto, igual que en Python. Alternativa que no he evaluado: ejecutar el paquete JS del núcleo (unos 47 KB, sin dependencias) dentro de un motor JS de .NET, como Jint, con un `AlmacenFiscal` en C#. **Por evaluar** con una prueba de concepto |
| **Mantenimiento** | Bajo (cliente) o alto (port) |
| **P-02** | No |
| **Nota** | Para un POS que debe vender sin red, el modo local de la API exige un servidor en el local. Si el proveedor quiere una caja autónoma, hace falta el port o el motor JS. `factura-hn/pruebas` (contrato del almacén) y la matriz de pruebas del núcleo serían la base de unos vectores compartidos en JSON para validar cualquier port |

### 3.6 Nodo comunitario de n8n

| | |
|---|---|
| **Usuarios potenciales** | Agencias de automatización y negocios con algo de técnica que conectan pedidos (WhatsApp, formularios, tiendas) con la emisión. No encontré datos de uso de n8n en Honduras: **estimación** baja-media. Ya hay nodos de facturación para otros países de América Latina (SAT México, AFIP, SUNAT, NFe.io, Alegra no oficial): es un patrón probado |
| **Esfuerzo** | Bajo-medio. Es TypeScript, pero un nodo **verificado** no puede tener dependencias externas: no puede usar `@factura-hn/cliente` ni `openapi-fetch` y tiene que usar los *helpers* HTTP de n8n. Además, la verificación exige licencia MIT (la cumple), repositorio público, publicación con procedencia desde GitHub Actions (obligatoria desde el 1-5-2026) e **interfaz en inglés**, lo que choca con un proyecto en español. Sin verificar, solo se instala en n8n autoalojado |
| **Mantenimiento** | Medio-bajo |
| **P-02** | **Parcial.** n8n autoalojado en el local, contra la API en la LAN: no depende. n8n Cloud: solo admite nodos verificados y necesitaría llegar a la API desde Internet, así que en la práctica exige la API alojada o exponer la del local. El README dice que no se publique a Internet sin TLS |

### 3.7 Plugin de WooCommerce

| | |
|---|---|
| **Usuarios potenciales** | 643 tiendas WooCommerce con sede en Honduras (StoreLeads). **Estimación:** solo una parte factura con sistema propio |
| **Esfuerzo** | Alto. Dos arquitecturas posibles. (a) El plugin llama a la API de factura-hn: hay que resolver dónde corre la API y cómo la alcanza un WordPress alojado. (b) El núcleo se reescribe en PHP dentro de WordPress: es el port completo, con su riesgo fiscal. En las dos hacen falta compatibilidad con HPOS (activado por defecto en instalaciones nuevas desde WooCommerce 8.2), la factura en el correo y en «Mi cuenta», la anulación y la nota de crédito desde el pedido y la revisión del directorio de WordPress |
| **Mantenimiento** | Alto: versiones de WordPress, WooCommerce y PHP, y conflictos con otros plugins |
| **P-02** | **Sí, en la práctica.** WordPress casi siempre vive en un hosting de terceros. Con (a), la API tiene que estar alojada o expuesta a Internet. Con (b), el «sistema» está en el servidor del hosting. Las dos dependen de la misma pregunta del Art. 47 |
| **Nota** | Conviene construirlo sobre el cliente de PHP (3.4) cuando P-02 lo permita |

### 3.8 App de Shopify

| | |
|---|---|
| **Usuarios potenciales** | 987 tiendas Shopify con sede en Honduras, la plataforma más grande del país según StoreLeads. Tienen el mismo sesgo de tiendas inactivas o de dropshipping |
| **Esfuerzo** | Alto. Una app de Shopify es una aplicación web que aloja quien la desarrolla. Para muchos comercios hay que distribuirla en la App Store, con revisión y una cuota única de registro. La distribución personalizada sirve para un solo comercio, sin revisión. Las apps creadas desde el admin ya no se pueden crear |
| **Mantenimiento** | Alto: versiones trimestrales de la Admin API y cambios en las reglas de la App Store |
| **P-02** | **Sí.** La app y la emisión corren en servidores nuestros o de un tercero, para varios negocios. Es exactamente el caso de la consulta P-02 |

### 3.9 Odoo (otros)

| | |
|---|---|
| **Usuarios potenciales** | Empresas medianas atendidas por 30 partners de Odoo en Honduras. No hay una localización con CAI documentada públicamente: **hueco por confirmar** |
| **Esfuerzo** | Medio-alto. Un módulo de Odoo en Python que llame a la API local (con el cliente de 3.3) desde la factura de venta y el TPV: numeración desde factura-hn, impresión, anulación y notas. Odoo saca una versión mayor cada año |
| **Mantenimiento** | Medio-alto (una rama por versión de Odoo) |
| **P-02** | No, con Odoo instalado en el local y la API en la LAN. Parcial con Odoo.sh u Odoo Online. Además, Odoo Online no admite módulos propios en Python según mi conocimiento (**por confirmar**) |
| **Nota** | Mejor hacerlo con un partner local: el partner aporta los clientes y factura-hn aporta las reglas. Encaja con «integraciones a medida» de `docs/modelo-de-negocio.md` |

### 3.10 Make / Zapier

| | |
|---|---|
| **Usuarios potenciales** | No encontré datos de uso en Honduras. **Estimación:** bajos |
| **Esfuerzo** | Medio. Make construye apps personalizadas desde su interfaz, VS Code o un agente de IA. La documentación que leí no dice si se pueden generar desde OpenAPI. Zapier tiene su propia plataforma de desarrollo |
| **Mantenimiento** | Medio |
| **P-02** | **Sí.** Son servicios en la nube que llaman a la API desde Internet |

### 3.11 Google Sheets y Excel

| | |
|---|---|
| **Usuarios potenciales** | Contadores y dueños de negocios pequeños. Su uso principal es leer el libro de ventas y los reportes, no emitir |
| **Esfuerzo** | **Excel con Power Query** leyendo `GET /v1/libro-ventas?formato=csv` o la exportación del Art. 53 num. 5 desde la API en la LAN: muy bajo, basta una receta documentada. **Google Sheets con Apps Script:** bajo, pero `UrlFetchApp` sale desde los servidores de Google, así que no alcanza una API que solo escucha en la LAN. **Power Automate:** sus conectores personalizados solo aceptan OpenAPI 2.0 |
| **Mantenimiento** | Bajo |
| **P-02** | Excel en la LAN: no. Sheets y Power Automate: **sí**, porque exigen una API accesible desde Internet |
| **Nota** | Emitir desde una hoja de cálculo no es recomendable: no hay una clave de idempotencia natural y es fácil reenviar una fila. La API ya protege los CSV contra fórmulas (`= + - @`) |

### 3.12 App móvil (Android)

| | |
|---|---|
| **Usuarios potenciales** | Android tiene el 73 % de los móviles. Es atractiva para negocios pequeños formales sin computadora, pero el autoimpresor exige integración contable o de inventario y la Declaración Jurada (Art. 53), así que **estimación:** el público formal es menor de lo que parece |
| **Esfuerzo** | Alto. Es un producto, no un conector: React Native o Expo con el núcleo (no tiene dependencias y ya corre en el navegador), un `AlmacenFiscal` sobre SQLite del dispositivo validado con `ejecutarContratoAlmacen`, e impresión Bluetooth con `renderizarTexto` de 32 o 48 columnas. Cada dispositivo necesita su propio punto de emisión y CAI. El papel térmico exige la certificación del Art. 38 |
| **Mantenimiento** | Alto (tiendas de apps, impresoras) |
| **P-02** | No, si todo vive en el dispositivo del establecimiento. **Por confirmar** si un teléfono que sale del local cumple el Art. 47 |

---

## 4. Matriz de impacto y esfuerzo

Escala del 1 al 5. Impacto = usuarios que trae en Honduras, ponderado por cuánto acorta el camino hasta la
primera factura. Las puntuaciones son **estimaciones** basadas en las cifras de la sección 2.

| Conector | Impacto | Esfuerzo | Mantenimiento | P-02 | Cuadrante |
|---|:-:|:-:|:-:|:-:|---|
| Bruno + Postman | 3 | 1 | 1 | No | **Ganancia rápida** |
| Plantilla Next.js (demo) | 3 | 2 | 2 | Parcial | **Ganancia rápida** (con aviso) |
| Recetas de Excel (Power Query) | 2 | 1 | 1 | No | Ganancia rápida menor |
| Cliente .NET (POS de escritorio) | 4 | 2 | 2 | No | **Apuesta principal** |
| Cliente PHP + Laravel | 3 | 2 | 2 | No (parcial en hosting) | **Apuesta principal** |
| Cliente Python | 3 | 2 | 2 | No | Apuesta principal |
| Nodo n8n (autoalojado) | 2 | 2 | 2 | Parcial | Relleno |
| Módulo Odoo (con partner) | 3 | 4 | 4 | No (local) | Proyecto estratégico |
| Port nativo .NET o Python | 3 | 5 | 5 | No | Solo con demanda probada |
| App móvil | 3 | 5 | 4 | No (por confirmar) | Producto aparte |
| Plugin WooCommerce | 3 | 4 | 4 | **Sí** | Bloqueado |
| App Shopify | 3 | 5 | 4 | **Sí** | Bloqueado |
| Make / Zapier | 1 | 3 | 2 | **Sí** | Bloqueado y de poco valor |
| Google Sheets / Power Automate | 2 | 2 | 2 | **Sí** | Bloqueado |

```
Impacto
  5 |
  4 |        .NET
  3 | Bruno  Next.js PHP Py          Odoo    Woo*   Shopify* / port / móvil
  2 | Excel  n8n  Sheets*
  1 |                    Make*
    +------------------------------------------------- Esfuerzo
       1      2       3       4       5        (* = bloqueado por P-02)
```

---

## 5. Orden recomendado

**Fase 0. Habilitadores (días, antes de cualquier conector)**

1. Añadir un `operationId` estable a las 23 operaciones de `packages/api` (por ejemplo, `emitirDocumento`,
   `anularDocumento`) y regenerar `openapi.json`. Probar Kiota (C#, PHP, Python) y openapi-python-client contra
   la especificación. Si NSwag o Power Platform la necesitan, generar en CI una versión 3.0 o 2.0 derivada, sin
   editarla a mano.
2. Publicar la imagen de Docker de la API en un registro, para que la primera factura no exija
   `git clone` + `--build`. Es decisión del responsable: implica una cuenta y publicar.
3. Exportar vectores de prueba en JSON (entrada → totales, letras y errores) desde la matriz del núcleo. Así
   cualquier cliente o port futuro se valida con las mismas reglas.
4. Añadir a la consulta P-02, antes de enviarla (`docs/avance.md` dice que sigue pendiente), una subpregunta:
   *¿qué establecimiento declara un negocio cuyo propio sistema corre en un hosting o nube de un tercero
   (WordPress, Vercel, VPS)?* Esa respuesta desbloquea o cierra la mitad de esta lista. **Es una propuesta: no
   modifiqué el archivo.**

**Fase 1. Primera factura en minutos, sin depender del SAR**

5. Colección de Bruno en el repositorio y colección de Postman, generadas en CI, con el entorno `demo`.
6. Plantilla Next.js «primera factura» con CAI ficticio y botón *Deploy*, con el aviso del Art. 47 y el
   camino local para producción.
7. Receta de Excel con Power Query para el libro de ventas y la exportación.

**Fase 2. Clientes oficiales (mismo flujo de generación y pruebas contra la API en Docker en CI)**

8. **.NET:** es el mejor encaje normativo (POS en el local) y el canal con más negocios por desarrollador.
9. **PHP + Laravel:** demanda local visible y base para WooCommerce.
10. **Python:** base para Odoo y para los ERP a medida.

**Fase 3. Distribución a través de terceros**

11. Nodo de n8n para instalaciones autoalojadas, publicado con procedencia. Verificarlo solo si se acepta la
    interfaz en inglés.
12. Módulo de Odoo junto con uno de los 30 partners locales.
13. Port nativo offline (.NET primero) **solo** si los proveedores de POS lo piden, validado con los vectores
    del paso 3.

**Fase 4. Después de la respuesta a P-02**

14. Si P-02 permite sistemas en la nube: WooCommerce (sobre el cliente PHP) y Shopify (app pública), y luego
    Make/Zapier y Google Sheets.
15. Si no lo permite: WooCommerce y Shopify quedan limitados a negocios con servidor propio en el local, y
    conviene descartarlos.

La app móvil se evalúa aparte, como producto, cuando se confirme su encaje con el Art. 47.

---

## 6. Fuentes

### Repositorio

- `README.md`: reglas 1 a 4, hoja de ruta («Paquetes hermanos: Python y .NET») y Art. 38 (papel térmico).
- `docs/modelo-de-negocio.md`: la API alojada solo después de P-02; integraciones a medida como posible
  ingreso.
- `docs/consulta-sar.md`, P-02: Arts. 4 num. 41-42, 47 y 61; lectura provisional de instalar en el
  establecimiento.
- `docs/investigacion.md`: pasos ante el SAR (Arts. 45, 47, 53, 59 y 61); CT Art. 63 num. 3.
- `docs/api.md` y `docs/autoalojamiento.md`: modos local y alojado, firma de webhooks, CSV seguro y la regla
  de no publicar sin TLS.
- `packages/api/openapi.json`: análisis propio (OpenAPI 3.1.0, 23 operaciones, 0 `operationId`).
- `docs/decisiones.md`: DEC-033 a DEC-040.

### Mercado

- DataReportal, *Digital 2025: Honduras*: <https://datareportal.com/reports/digital-2025-honduras>
- StatCounter, sistemas operativos móviles en Honduras: <https://gs.statcounter.com/os-market-share/mobile/honduras>
- La Prensa, «Solo tres de cada 10 negocios tributan en Honduras» (31-08-2025): <https://www.laprensa.hn/honduras/negocios-honduras-formalizacion-impuestos-2025-BC27165316>
- StoreLeads, WordPress en Honduras: <https://storeleads.app/reports/technology/Wordpress/country/HN>
- StoreLeads, Shopify en Honduras: <https://storeleads.app/reports/shopify/HN/top-stores>
- StoreLeads, Shopify en Tegucigalpa: <https://storeleads.app/reports/shopify/HN/city/Tegucigalpa>
- StoreLeads, WooCommerce en Tegucigalpa: <https://storeleads.app/reports/woocommerce/HN/city/Tegucigalpa>
- StoreLeads, WooCommerce en Cortés: <https://storeleads.app/reports/woocommerce/HN/region/Cortes>
- StoreLeads, Mailchimp en Honduras: <https://storeleads.app/reports/technology/Mailchimp/country/HN>
- Statista (2021, tras muro de pago): <https://statista.com/statistics/1179593/leading-e-commerce-platforms-online-retailers-honduras>
- AfterShip (no se pudo leer; cifras descartadas): <https://www.aftership.com/ecommerce/statistics/regions/hn>

### Desarrolladores

- GitHub Innovation Graph, Honduras: <https://innovationgraph.github.com/economies/hn>
- GitHub Innovation Graph, datos por lenguaje: <https://raw.githubusercontent.com/github/innovationgraph/main/data/languages.csv>
- Stack Overflow Developer Survey 2025: <https://survey.stackoverflow.co/2025/technology/>
- LinkedIn Empleos, PHP: <https://hn.linkedin.com/jobs/php-empleos>
- LinkedIn Empleos, .NET: <https://hn.linkedin.com/jobs/%2Enet-empleos>
- LinkedIn Empleos, Python: <https://hn.linkedin.com/jobs/python-empleos>
- LinkedIn Empleos, JavaScript: <https://hn.linkedin.com/jobs/javascript-empleos>
- Computrabajo, oferta de .NET: <https://hn.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-work-from-home-net-trainee-developer-ref-0001e-en-san-pedro-sula-89F39365C2028A3861373E686DCF3405>
- Toptrabajos, OE System: <https://www.toptrabajos.com/hn/empleos/oficial-desarrollo-oe-system-distrito-central-puv7ri>
- Toptrabajos, Programador Semi Sr: <https://www.toptrabajos.com/hn/empleos/programador-semi-sr-marlon-alexander-pagoaga-distrito-central-zk8mga>
- OPS, términos de referencia para SESAL: <https://www.paho.org/sites/default/files/tdr_desarrollador_de_software_sesal_ugi_07.23_vfinal_4.pdf>

### ERP y POS

- Odoo, localizaciones fiscales: <https://www.odoo.com/documentation/18.0/es/applications/finance/fiscal_localizations.html>
- Odoo, partners en Honduras: <https://www.odoo.com/es/partners/country/94>
- Odoo Apps, `l10n_hn_city`: <https://apps.odoo.com/apps/modules/18.0/l10n_hn_city>
- Tecnochefca: <https://tecnochefca.odoo.com/website/info>
- AppSource, localización de Honduras para Business Central: <https://appsource.microsoft.com/en-us/product/dynamics-365-business-central/PUBID.llbusinesssolutionsllc1580159119255%7CAID.llb_loca_hn_bc%7CPAPPID.60d02194-6b3c-4f23-b428-1da3f2ee84a0>
- AlfaPeople, localización de Honduras: <https://alfapeople.com/latam/wp-content/uploads/sites/10/2025/05/LOCALIZACION-HONDURAS-ESP-2025-1.pdf>
- Softland Honduras: <https://softland.com/hn/marketplace/bsp/>
- Capterra, Alegra POS: <https://www.capterra.es/software/1024697/alegra-pos>
- VATupdate, *Honduras e-invoicing booklet* (agosto de 2026): <https://www.vatupdate.com/2026/08/11/honduras-e-invoicing-e-reporting-country-booklet/>
- EY, alerta tributaria: <https://www.ey.com/es_cr/tax/tax-alerts/honduras-el-servicio-de-administracion-de-rentas-inicia-una-encuesta>

### Herramientas

- n8n, guía de verificación de nodos: <https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/>
- n8n, instalación de nodos comunitarios: <https://docs.n8n.io/integrations/community-nodes/installation/>
- Nodos de n8n de facturación en América Latina: <https://www.pkgstats.com/pkg:n8n-nodes-sat-mexico>, <https://www.pkgstats.com/pkg:n8n-nodes-afip-argentina>, <https://www.pkgstats.com/pkg:n8n-nodes-sunat-peru>
- Bruno, de OpenAPI a colección: <https://docs.usebruno.com/converters/openapi-to-bruno>
- Postman, trabajar con OpenAPI: <https://learning.postman.com/docs/integrations/available-integrations/working-with-openAPI/>
- Kiota: <https://learn.microsoft.com/openapi/kiota/overview>
- openapi-python-client: <https://github.com/openapi-generators/openapi-python-client>
- openapi-generator, generador de PHP: <https://openapi-generator.tech/docs/generators/php/>
- NSwag, soporte de OpenAPI 3.1: <https://github.com/RicoSuter/NSwag/discussions/4599>
- Power Platform, preguntas frecuentes de conectores personalizados: <https://learn.microsoft.com/connectors/custom-connectors/faq>
- Google Apps Script, `UrlFetchApp`: <https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app>
- Make, apps personalizadas: <https://developers.make.com/custom-apps-documentation>
- Shopify, distribución de apps: <https://shopify.dev/docs/apps/launch/distribution>
- WooCommerce, HPOS: <https://developer.woocommerce.com/docs/features/high-performance-order-storage/>
- Vercel, enviar una plantilla: <https://vercel.com/templates/submit>
