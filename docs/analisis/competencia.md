# Competencia y referentes: qué aprender para ser la ruta más fácil y confiable

Fecha de consulta: 2026-11-19. Solo se leyeron páginas públicas: no se crearon cuentas, no se enviaron
formularios y no se instaló nada. Los textos de los sitios están resumidos, no copiados. Los precios y las
funciones son los publicados en esa fecha; cuando un dato no se pudo verificar, se dice.

Objetivo de referencia: que alguien que no sabe nada emita su primera factura con factura-hn en 5 minutos, y
que confíe en el resultado. No se trata de tener más funciones.

---

## 1. Resumen

- **Los líderes se diferencian por el primer comprobante, no por la cobertura fiscal.** Afip SDK deja
  emitir en desarrollo con un CUIT de prueba y sin certificado. YoFacturo separa las llaves `yf_test_` de las
  `yf_live_` y devuelve un CAE sintético. Stripe tiene claves y sandboxes de prueba con datos que simulan cada
  caso. factura-hn ya tiene la pieza equivalente, un CAI ficticio (`DEMO00-NO-VALIDO-…`) en el playground y
  en el modo demo de la API, pero no la presenta como un «modo de prueba» de primer nivel del SDK.
- **Tenemos una ventaja que ningún referente argentino puede ofrecer.** En Honduras la emisión no pasa por
  un web service del SAR: el régimen vigente es el de CAI, rango y fecha límite, y la emisión electrónica con
  CAEE no tiene especificación técnica publicada (docs/investigacion.md §4; Reglamento Arts. 54 y 58). Por
  eso factura-hn puede emitir una factura de prueba sin cuenta, sin llave y sin red. Ese debe ser el mensaje
  principal.
- **Lo que hoy bloquea los «5 minutos» es el lanzamiento, no el código.** El paquete no está en npm, el
  sitio no está publicado y la insignia de npm del README apunta a un paquete que todavía no existe. Los
  pasos ya están preparados en docs/lanzamiento.md.
- **Conviene copiar lo que da confianza y desatasca.** Un catálogo de errores con un enlace por código
  (Stripe, YoFacturo, Afip SDK), una guía «de prueba a producción» con los trámites ante el SAR (como los
  tutoriales del portal de ARCA de Afip SDK), guías por framework, páginas en `.md` para agentes (Invopop,
  Stripe, Afip SDK) y un espacio de comunidad (el Discord de Afip SDK tiene unos 2.000 miembros).
- **No conviene copiar todavía la parte comercial.** La página de estado, los planes por consumo y el MCP
  remoto con OAuth solo tienen sentido con un servicio alojado, y ese servicio espera la respuesta del SAR a
  la consulta P-02 (docs/modelo-de-negocio.md). La Pyme y YoFacturo son sistemas de gestión con una API
  añadida. Invopop no cubre Honduras: su formato GOBL lista 35 regímenes y en Centroamérica solo está Costa
  Rica.

---

## 2. Referentes

### 2.1 Afip SDK (Argentina, ARCA)

**Qué es.** Es una plataforma comercial que funciona desde 2017 y conecta con los web services de ARCA. Su
sitio aclara que no tiene vínculo con los organismos oficiales. Dice tener más de 100.000 descargas y muestra
logos de clientes conocidos.

**Qué hace bien**

| Aspecto | Lo que se ve |
|---|---|
| Onboarding | Primero pide un token de acceso de su app (requiere cuenta), después `npm install` y luego crear la instancia con CUIT y token. La introducción de la documentación ofrece unas 40 guías de integración: lenguajes, frameworks (Next.js, Hono, Bun, Express, Astro…), serverless (Vercel, Cloudflare Workers, Deno Deploy, Lambda), constructores con IA (Lovable, v0, Bolt, Replit) y no-code (n8n, Make, Zapier, Bubble). |
| Sandbox | En modo desarrollo se usa un CUIT de prueba sin certificado. El nuevo «Factura SDK» tiene un ambiente `dev` sin validez fiscal, con certificado simulado y CAE de prueba; según la página, el primer comprobante sale «en unos minutos». |
| Paso a producción | Hay una página con una checklist corta: certificado y llave de producción, `production: true` (o `environment: prod` en la API), CUIT y token. |
| SDKs | Node, PHP, Python, Ruby, Java, .NET, Go, Flutter, Visual FoxPro, VB6 y una API REST. |
| Recursos | Tutoriales paso a paso del portal de ARCA (certificados, punto de venta, delegación), «errores frecuentes» (10 entradas con causa y solución) y preguntas frecuentes. |
| Precios | Visibles y en dólares. Free (1 CUIT, 10 facturas al mes en Factura SDK), Pro a 25 USD, Growth a 80 USD, Startup a 250 USD y Enterprise a medida, con una calculadora. Según la tabla, el soporte por correo empieza en Growth. |
| Soporte y comunidad | Correo, Discord (2.023 miembros, con canales por lenguaje y uno de novedades) y GitHub. |
| Estado del servicio | Tiene página de estado (Better Stack). Monitorea su propia API **y** los web services de ARCA de producción y desarrollo. |
| Changelog | No aparece en el mapa de la documentación. Las novedades salen por Discord y por avisos del blog. |
| Agentes de IA | Una página de configuración: copias un prompt que apunta a un archivo `.md`, y además hay skills, un MCP (con OAuth o token de proyecto) y guías para 14 agentes. Publica `llms.txt` y una versión `.md` de cada página, y recomienda probar en el ambiente de prueba. |

**Qué copiaríamos**
- Un **identificador de prueba integrado** al estilo de su CUIT de prueba: un CAI de prueba que viene con el
  SDK y con el que se emite sin configurar nada.
- **Tutoriales de los trámites del SAR** con el mismo formato que sus tutoriales del portal de ARCA.
- Una **checklist de producción** de una sola pantalla.
- **Guías cortas por framework y por runtime**, buenas también para el SEO («facturación Honduras Next.js»).
- Una página de **errores frecuentes** con causa y solución.
- Una **página para agentes** con un único prompt que apunta a un `.md` publicado.
- El **aviso de que no es un producto oficial**, visible en la portada.

**Qué nos falta frente a ellos.** Estar publicados (npm y sitio), las guías por framework (tenemos 5
ejemplos), SDKs en otros lenguajes (Python y .NET están en la hoja de ruta), una comunidad activa y
contenido de blog o SEO. La página de estado no aplica mientras no haya un servicio alojado.

### 2.2 La Pyme (Argentina)

**Qué es.** Un sistema de gestión para pymes argentinas: stock, punto de venta, compras, tesorería y
contabilidad. Según su portada, cada venta emite una factura electrónica de ARCA. Su API pública sirve para
integrar los datos operativos (clientes, productos, ventas, inventario, reportes). La página de la API **no
menciona CAE ni ARCA**, así que no se pudo verificar si la API emite comprobantes.

**Qué hace bien**
- **SDK `lapyme`** (TypeScript, MIT, v0.3.1, solo ESM). La carpeta `.speakeasy` del repositorio sugiere que
  es generado. Trae errores tipados, reintentos configurables, `idempotencyKey` y una carpeta de ejemplos.
- **Inicio rápido**: primero `GET /health` (sin autenticación) y después una consulta mínima como prueba de
  humo de la llave, los permisos y el formato.
- **Convenciones claras.** Cada respuesta trae `request_id`. Los listados paginan con `has_more` y
  `next_cursor`. Los montos van en centavos. Los errores traen `type`, `code`, `message`, `retryable` y
  `details`.
- **Llaves con permisos por recurso**, que se muestran una sola vez.

**Puntos débiles observados.** No se encontró un sandbox. El README usa dos nombres distintos para la
variable de entorno de la llave. El repositorio tiene 2 estrellas y las releases están vacías. Los precios
no se pudieron verificar: la portada enlaza una página de precios sin cifras.

**Qué copiaríamos.** El campo **`retryable`** en los errores de la API, para que un POS sepa si reintentar
con la misma `Idempotency-Key`. Un **`request_id`** en cada respuesta, para soporte y bitácora. La
**prueba de humo** como primer paso de la guía de la API: `GET /salud` ya existe.

**Qué nos falta.** Nuestro formato de error de la API es `{ error: { codigo, mensaje }, errores?: [...] }`
(docs/api.md): no dice si conviene reintentar y no trae un identificador de solicitud. El README de La Pyme
también sirve de antiejemplo: hay que verificar que los nombres de las variables (`FHN_API_URL`,
`FHN_LLAVE`) coincidan en el README, AGENTS.md, llms.txt y los ejemplos. Ya existe una prueba para los
prompts; conviene extenderla.

### 2.3 TusFacturas (Argentina)

**Qué es.** Una aplicación de facturación con API JSON sobre ARCA. Dice tener 11 años en el mercado y
contadores que la asesoran sobre los cambios normativos.

**Qué hace bien**
- **Los precios más transparentes del grupo.** Todos están en pesos con IVA. Hay un plan **API DEV gratuito**
  (1.500 solicitudes en 30 días) que, según su tabla, no integra con ARCA ni genera CAE: funciona como
  sandbox. Los planes de producción con API empiezan en 38.128,20 ARS al mes.
- **Documentación orientada a las dudas reales**: «¿Cómo empiezo?», «¿Cómo paso a producción?», «¿Cómo puedo
  debugear?», «Errores comunes de ARCA», «Estado de los servicios y mantenimientos programados» y un
  **Changelog**, todo indexado en un `llms.txt`.
- **Ejemplos** en cURL, PHP, Python, Node.js y Ruby, un SDK oficial en PHP e integración con Zapier.
- **Webhooks** para la facturación asíncrona.
- **Soporte humano visible**: correo técnico, chat, centro de ayuda y teléfono.

**Puntos débiles observados.** Las tres credenciales (`apikey`, `apitoken`, `usertoken`) van en el cuerpo
de cada pedido, lo que se aleja de la práctica habitual de mandarlas en una cabecera. El portal no muestra
códigos de error de la propia API.

**Qué copiaríamos.** Los títulos de las páginas escritos como preguntas («¿Cómo paso a producción?»,
«¿Cómo depuro un error?»). Un changelog dentro del sitio de documentación. La separación clara entre
«probar gratis» y «producción».

**Qué nos falta.** Una página «¿Cómo depuro?» que explique dónde mirar: la bitácora, los `advertencias` y
el `422` con su lista de `errores`. También el changelog publicado en el sitio, porque hoy solo está en
CHANGELOG.md.

### 2.4 YoFacturo (Argentina; también Paraguay con SIFEN)

**Qué es.** Un sistema de facturación y gestión (stock, punto de venta, nómina) con una API REST incluida en
el plan Premium. Ofrece una prueba de 30 días sin tarjeta, un MCP y una página de estado.

**Qué hace bien**

| Aspecto | Lo que se ve |
|---|---|
| Llaves de prueba | Prefijos `yf_test_` y `yf_live_`. Las llaves de prueba trabajan sobre una base separada, nunca emiten ante ARCA, devuelven un CAE sintético y marcan las respuestas con `livemode: false`. Es el patrón de Stripe aplicado a la facturación. |
| Referencia | OpenAPI 3.1 con 119 rutas y una colección de Postman. |
| Errores | Un `code` estable para usar en un `switch`. Los errores de validación traen `errors[]` con `field`, `message`, `code` y `value`. Una guía explica cada estado HTTP y cómo resolverlo. |
| Idempotencia | Cabecera `Idempotency-Key`: devuelve 409 si la primera solicitud sigue en curso y 422 si se reusa la clave con otro cuerpo. |
| Límites | Ventanas documentadas, cabeceras `X-RateLimit-*` y `Retry-After`. |
| MCP | Remoto (Streamable HTTP) con OAuth 2.1, PKCE y registro dinámico de clientes. Se instala con una línea en Claude Code. Expone 76 herramientas, y las de escritura piden confirmar con el usuario. **La emisión ante ARCA no es una herramienta directa**: el MCP manda al usuario a la pantalla de la app. |
| Estado | Tiene página de estado. |
| Soporte | WhatsApp con respuesta «en el día», correo y un equipo de implementación. |

**Puntos débiles observados.** La documentación se contradice en algunos detalles: la variable de Postman
aparece como `token` en un lugar y como `apiKey` en otro, y la referencia no da la URL base mientras que la
introducción sí. Hay precios «desde 20.000 ARS al mes» y los complementos tienen precio, pero no se pudo
verificar el precio de cada plan porque la página de precios devolvió 404.

**Qué copiaríamos**
- La **marca explícita de prueba en cada respuesta**, el equivalente a `livemode: false`.
- La **guía de errores por estado HTTP** con la acción sugerida.
- El MCP que se instala en **una línea** (`claude mcp add …`) cuando el paquete esté en npm.

**Qué nos falta.** Llaves de API con prefijo de prueba o de producción (hoy son `fhn_<prefijo>_<secreto>`
y el tenant demo se distingue por sus datos) y un campo que diga en cada documento si es de prueba. La
prudencia de YoFacturo, que no emite desde el MCP, refuerza lo que ya hacemos: `anular_documento` está
marcada como destructiva y se recomienda no aprobarla automáticamente. Conviene mantener la emisión por MCP
con `idempotencyKey` y documentar que el cliente debe pedir confirmación.

### 2.5 Invopop (Europa, varios países)

**Qué es.** Una plataforma para emitir y recibir documentos fiscales en varios países a partir de un formato
abierto, **GOBL**. Una integración sirve para todos sus países; Invopop convierte el documento al formato
local y lo envía a la autoridad.

**Qué hace bien**
- **Precios visibles.** El plan Dev cuesta 0 € (200 «Pops», 1 usuario y soporte de la comunidad), el Pro
  500 € al mes y el Enterprise es a medida, con paquetes de Pops y complementos de precio público.
- **El mejor soporte para agentes del grupo.** Publica `llms.txt` y una versión `.md` de cada página, un
  `AGENTS.md` condensado y una skill que se instala con `npx skills add`. Tiene un **MCP de documentación**
  alojado y un **MCP local de GOBL** para construir, validar y corregir documentos. Ofrece prompts listos
  por tarea y una lista de **errores comunes de los agentes**, como calcular los totales a mano o reutilizar
  identificadores.
- **Un formato abierto** como base de confianza.
- **Changelog** público. La entrada más reciente que se vio es de junio de 2024; no se pudo verificar si
  hay entradas posteriores. No se encontró una página de estado.

**Puntos débiles observados.** El inicio rápido es largo: unos 21 subpasos en la consola entre el registro,
el flujo de trabajo, la carga y el proceso. El registro elige «Sandbox» por defecto, pero la página no
explica en qué se diferencia de producción.

**Honduras.** El índice de GOBL lista 35 regímenes. En América Latina aparecen Argentina, Brasil,
Colombia, Costa Rica, México y Perú. **Honduras no está.**

**Qué copiaríamos**
- La **lista de errores comunes de los agentes** dentro de AGENTS.md y del sitio. Ya tenemos «Principios no
  negociables»; falta la forma «error típico → qué hacer».
- Las **versiones `.md` de las páginas del sitio**: el generador ya parte de Markdown, así que basta con
  publicar las fuentes junto al HTML.
- Una **herramienta de validación sin emitir** en el MCP (`validar_entrada`), análoga a su validador de GOBL.
- **Prompts por tarea** (configurar, emitir, diagnosticar un 422) además de los dos prompts generales.

**Qué nos falta.** Un MCP o búsqueda de documentación alojada, aunque esto depende de publicar el sitio.
Un régimen de Honduras en GOBL sería una posible colaboración futura; queda por confirmar si interesa al
responsable.

### 2.6 Stripe (estándar de experiencia de desarrollador)

**Qué hace bien**
- **Claves de prueba y sandboxes aislados.** Hay datos de prueba que **disparan escenarios concretos**:
  tarjetas que fallan por fondos insuficientes, por CVC incorrecto o por fraude, y reembolsos asíncronos. Las
  pruebas no mueven dinero.
- **Catálogo de errores.** Cada `code` tiene descripción y acción, y el error de la API trae `doc_url`, que
  enlaza directo a su entrada. El error `livemode_mismatch` impide mezclar los modos.
- **Versiones fechadas.** Sale una versión mensual sin cambios incompatibles y dos versiones mayores al año.
  Hay changelog y guías de actualización, y cada SDK fija la versión de la API con la que se publicó.
- **Agentes.** Publica `.md` de cada página, un MCP, skills, un comando `stripe agent setup` y un índice de
  skills legible por máquina.
- **Página de estado** pública. No se pudo leer su contenido porque carga con JavaScript.

**Qué copiaríamos**
- **Escenarios de prueba** con nombre, equivalentes a sus tarjetas de prueba: datos de ejemplo que provocan
  cada error fiscal (CAI vencido, rango agotado, venta a consumidor final sobre el umbral de identificación,
  nota de crédito sin RTN, tipo no emitible). Hoy el playground trae una entrada inválida; conviene un juego
  completo exportado desde `factura-hn/pruebas`.
- Un enlace **`ayuda` o `docUrl`** en cada error, que lleve a su entrada del catálogo.
- **Guías de migración** por versión, mientras los cambios incompatibles sigan entrando en versiones
  menores 0.x (CHANGELOG.md).

---

## 3. Tabla comparativa

Leyenda: ✔ sí · ◐ parcial · ✘ no · ? no verificado · n/a no aplica.

| | Afip SDK | La Pyme | TusFacturas | YoFacturo | Invopop | Stripe | **factura-hn (hoy)** |
|---|---|---|---|---|---|---|---|
| Primer documento sin crear cuenta | ✘ (token) | ✘ | ✘ | ✘ | ✘ | ✘ | **✔ técnicamente** (SDK local y playground), ✘ en la práctica: no está en npm |
| Entorno de prueba sin validez fiscal | ✔ CUIT de prueba / `dev` | ? | ✔ API DEV | ✔ `yf_test_` | ✔ sandbox | ✔ | ◐ CAI ficticio en el playground y en el tenant demo de la API; no hay modo de prueba en el SDK |
| Llaves de prueba diferenciadas | ◐ (flag `production`) | ? | ◐ (plan) | ✔ prefijo | ◐ (workspace) | ✔ | ✘ |
| Checklist de paso a producción | ✔ | ✘ | ✔ | ◐ | ? | ✔ | ◐ (en docs/investigacion.md §3a, no como guía) |
| SDKs | 10 lenguajes + API | TS | PHP + ejemplos | OpenAPI | ? | muchos | TS + cliente TS + OpenAPI |
| Guías por framework | ✔ (~40) | ✘ | ◐ | ✘ | ◐ | ✔ | ◐ (5 ejemplos) |
| Precios visibles | ✔ | ✘ | ✔ | ◐ | ✔ | ✔ | n/a (gratis y MIT; decirlo en la portada) |
| Soporte humano visible | ✔ | ? | ✔ | ✔ | ✔ | ✔ | ◐ (issues y plantillas de GitHub) |
| Comunidad | ✔ Discord | ✘ | ? | ◐ redes | ? | ✔ | ✘ (Discussions previsto) |
| Página de estado | ✔ (incluye ARCA) | ? | ✔ (ARCA) | ✔ | ? | ✔ | n/a (sin servicio alojado) |
| Changelog público | ◐ | ◐ | ✔ | ✘ | ✔ | ✔ | ◐ (CHANGELOG.md, no está en el sitio) |
| Catálogo de errores con acción | ◐ (10) | ◐ | ◐ | ✔ | ◐ | ✔ con `doc_url` | ◐ (tabla rápida en AGENTS.md) |
| Recursos para agentes | ✔ llms.txt, .md, skills, MCP | ✘ | ✔ llms.txt | ✔ MCP | ✔ el más completo | ✔ | ✔ llms.txt, AGENTS.md, skill, MCP local; falta publicarlos |
| Código abierto | ◐ (librerías) | ✔ SDK | ◐ | ✘ | ◐ GOBL | ◐ SDKs | **✔ todo (MIT)** |
| Reglas citadas por artículo y con prueba | ✘ | ✘ | ✘ | ✘ | ✘ | n/a | **✔ matriz de cumplimiento** |

---

## 4. Qué copiaríamos

1. **Un modo de prueba de primera clase**, como el CUIT de prueba de Afip SDK, las llaves `yf_test_` de
   YoFacturo y el sandbox de Stripe. El SDK traería una autorización y un emisor ficticios, y todo documento
   emitido con ellos llevaría una marca explícita de «sin validez fiscal» en los datos y en la impresión. El
   texto de la leyenda lo decide el responsable; no es una regla fiscal.
2. **Escenarios de prueba con nombre** (Stripe): fixtures que provocan cada error y cada aviso.
3. **Un enlace de ayuda en cada error** (Stripe `doc_url`) y un catálogo de errores con causa y acción
   (Afip SDK, YoFacturo).
4. **Una guía «De prueba a producción»** (Afip SDK y TusFacturas) que reúna los pasos ante el SAR de
   docs/investigacion.md §3a con sus artículos (Arts. 45, 47, 53, 59, 61) y lo técnico: cambiar el CAI
   ficticio por el de la resolución, usar un almacén persistente, la certificación del papel térmico (Art. 38)
   y los talonarios de contingencia (Art. 55). El procedimiento exacto en la Oficina Virtual queda **por
   confirmar** (P-03).
5. **Guías por framework y runtime** (Afip SDK).
6. **Una página para agentes** con un único prompt que apunta a un `.md` publicado (Afip SDK), versiones
   `.md` de todas las páginas (Invopop, Stripe) y una lista de errores comunes de los agentes (Invopop).
7. **Títulos de la documentación en forma de pregunta** (TusFacturas) y una página «¿Cómo depuro?».
8. **`retryable` y `request_id` en los errores de la API** (La Pyme).
9. **El aviso de producto no oficial** en la portada (Afip SDK).
10. **Changelog en el sitio** con guía de migración (Stripe, TusFacturas).

## 5. Qué nos falta

- **Estar publicados**: npm, sitio, `llms.txt` y páginas `.md` en una URL pública. Hoy la insignia de npm
  del README apunta a un paquete inexistente.
- **Un camino de 5 minutos medido.** No hay una página «Tu primera factura» con un solo comando que deje un
  PDF o HTML en disco, ni una medición con cronómetro hecha por alguien externo.
- **Un modo de prueba en el SDK** y una marca de prueba en los documentos y en las llaves de la API.
- **Un catálogo de errores completo** con un enlace estable por código. La tabla de AGENTS.md cubre unos 17
  grupos y no se publica como página.
- **Comunidad y prueba social**: no hay un canal de conversación, testimonios ni contadores que respalden
  la configuración. La matriz de cumplimiento es nuestro mejor argumento de confianza y hoy no está a la vista
  en la portada.
- **Lenguajes además de TypeScript.** El OpenAPI permite generar clientes, pero no hay una guía «genera tu
  cliente en Python o C#».
- **Coherencia de marca.** El README y la portada del sitio usan «Facturación SAR Honduras» como titular,
  y la regla del responsable es no usar «SAR» en la marca. El uso descriptivo puede ser aceptable, pero es
  una decisión del responsable (ver R-12).

---

## 6. Recomendaciones priorizadas

Impacto: qué tanto acerca al objetivo de «5 minutos y confiable». Esfuerzo: B (bajo, horas), M (medio,
días), A (alto, semanas).

| # | Recomendación | Impacto | Esfuerzo | Inspirada en | Nota |
|---|---|---|---|---|---|
| R-01 | **Publicar la 0.2.0 en npm y el sitio** (docs/lanzamiento.md, pasos 4 a 6) | Muy alto | B | todos | Lo ejecuta el responsable. Sin esto no se cumple ninguna otra recomendación. |
| R-02 | **Página «Tu primera factura en 5 minutos»**: un solo bloque copiable (instalar, emitir con datos de prueba, abrir el HTML o PDF), medido con cronómetro por alguien que no conoce el proyecto | Muy alto | B | Afip SDK, Stripe | Puede reutilizar `pnpm example`. Valorar un `npx factura-hn demo` (M). |
| R-03 | **Modo de prueba en el SDK**: autorización y emisor ficticios exportados y una marca «de prueba» en el documento y la impresión. En la API, la misma marca en las respuestas del tenant demo | Muy alto | M | Afip SDK, YoFacturo, Stripe | Cambia la forma pública del documento: registrar la decisión en docs/decisiones.md. El texto de la leyenda lo decide el responsable. |
| R-04 | **Guía «De prueba a producción»** con checklist y artículos | Alto | B | Afip SDK, TusFacturas | Sale de docs/investigacion.md §3a; el procedimiento en la Oficina Virtual queda por confirmar (P-03). |
| R-05 | **Catálogo de errores publicado**, con un ancla por código y un campo `ayuda` (URL) en cada error del SDK y la API | Alto | M | Stripe, YoFacturo | El campo es aditivo; el catálogo puede generarse desde los códigos del núcleo. |
| R-06 | **Portada orientada a la confianza**: «gratis y MIT, ninguna función fiscal detrás de un pago», la matriz de cumplimiento a un clic y el aviso de que no es un producto oficial | Alto | B | Afip SDK, TusFacturas | El texto del modelo de negocio ya existe. |
| R-07 | **Página para agentes** y versiones `.md` de cada página del sitio; lista de «errores comunes de agentes» en AGENTS.md | Alto | B | Afip SDK, Invopop, Stripe | El generador ya trabaja con Markdown. |
| R-08 | **Escenarios de prueba con nombre** en `factura-hn/pruebas` y en el playground | Medio | M | Stripe | El umbral de consumidor final sale de docs/normativa.md; su artículo queda por confirmar. |
| R-09 | **Guías por framework** (Next.js, Express, Hono, Bun, Deno, Cloudflare Workers) a partir de los ejemplos existentes | Medio | M | Afip SDK | Ayuda también al SEO. |
| R-10 | **Comunidad**: activar GitHub Discussions (ya previsto), con una categoría de novedades y otra de preguntas de contadores | Medio | B | Afip SDK | El responsable decide si además abre Discord o WhatsApp. |
| R-11 | **API: `retryable` y `requestId`** en los errores; llaves de prueba reconocibles (por ejemplo, un prefijo distinto para el tenant demo) | Medio | M | La Pyme, YoFacturo | Revisarlo con la decisión DEC-026 sobre las llaves. |
| R-12 | **Marca**: quitar «SAR» del titular y usar «conforme al Reglamento de Facturación (Acuerdo 481-2017)» | Medio | B | regla del responsable | Lo decide el responsable. |
| R-13 | **Changelog en el sitio** con guía de migración por versión 0.x | Medio | B | Stripe, TusFacturas | |
| R-14 | **MCP**: instalación en una línea tras publicar y una herramienta `validar_entrada` que no emite | Medio | B–M | YoFacturo, Invopop | Mantener la confirmación al anular. |
| R-15 | **Guía «genera tu cliente»** desde OpenAPI para Python y C#, antes de mantener paquetes hermanos | Medio | M | Afip SDK, YoFacturo | Los paquetes nativos siguen en la hoja de ruta (A). |
| R-16 | **Página de estado, planes y soporte de pago** | Bajo hoy | M | Afip SDK, YoFacturo | Solo si hay servicio alojado, después de la respuesta a P-02 (docs/modelo-de-negocio.md). |
| R-17 | **GOBL**: evaluar un régimen de Honduras o un adaptador | Bajo | A | Invopop | Por confirmar si interesa; no antes de la 1.0. |

**Orden sugerido.** Primero R-01, R-02 y R-06, que son el lanzamiento y la primera impresión. Después
R-03, R-04 y R-07, el camino de prueba a producción. Luego R-05 y R-08, que dan confianza al depurar.
El resto, según la demanda.

---

## 7. Fuentes

Afip SDK
- https://afipsdk.com
- https://afipsdk.com/pricing
- https://afipsdk.com/docs/agent-setup/
- https://afipsdk.com/docs/facturasdk/
- https://docs.afipsdk.com
- https://docs.afipsdk.com/sitemap.md
- https://docs.afipsdk.com/integracion/node.js.md
- https://docs.afipsdk.com/siguientes-pasos/ir-a-produccion.md
- https://docs.afipsdk.com/recursos/errores-frecuentes.md
- https://status.afipsdk.com
- https://community.afipsdk.com

La Pyme
- https://lapyme.com.ar
- https://docs.lapyme.com.ar/api-reference
- https://docs.lapyme.com.ar/api-reference/sdk/typescript
- https://github.com/LaPyme/lapyme-ts
- https://www.pkgstats.com/pkg:lapyme (la página de npm devolvió 403)

TusFacturas
- https://www.tusfacturas.app/api-factura-electronica-afip-en.html
- https://www.tusfacturas.app/precios.html
- https://developers.tusfacturas.app/
- https://developers.tusfacturas.app/llms.txt

YoFacturo
- https://yo-facturo.com/
- https://yo-facturo.com/dev/
- https://yo-facturo.com/dev/referencia/
- https://yo-facturo.com/dev/errors/
- https://yo-facturo.com/dev/mcp/

Invopop
- https://www.invopop.com/pricing
- https://www.invopop.com/changelog
- https://docs.invopop.com
- https://docs.invopop.com/get-started/quickstart.md
- https://docs.invopop.com/llms.md
- https://docs.gobl.org/llms.txt

Stripe
- https://docs.stripe.com/testing
- https://docs.stripe.com/error-codes
- https://docs.stripe.com/api/versioning
- https://docs.stripe.com/building-with-llms
- https://docs.stripe.com/payments/quickstart
- https://status.stripe.com

Repositorio (afirmaciones sobre factura-hn y sobre la normativa hondureña)
- README.md, AGENTS.md, llms.txt, CHANGELOG.md
- docs/investigacion.md (§3a pasos ante el SAR, §4 CAEE), docs/normativa.md, docs/api.md,
  docs/modelo-de-negocio.md, docs/lanzamiento.md, docs/avance.md, docs/consulta-sar.md
