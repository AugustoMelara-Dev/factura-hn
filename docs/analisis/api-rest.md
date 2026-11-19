# Análisis: diseño de la API REST (`@factura-hn/api`)

Fecha: 19-11-2026. Alcance: `packages/api/src` (app.ts, errores.ts, llaves.ts, esquemas.ts, webhooks.ts,
operador.ts), `packages/api/openapi.json` (OpenAPI 3.1, versión 0.2.0), `packages/cliente/src`, `docs/api.md`,
`docs/decisiones.md`, `docs/consulta-sar.md` y `docs/modelo-de-negocio.md`. Referentes: la API de Stripe y las
guías públicas de Google (AIP), Microsoft, Zalando y la RFC 9457 (sección 7).

Pruebas: `pnpm --filter @factura-hn/api test` pasa (5 pruebas en verde y 36 saltadas porque no hay Postgres).
Este análisis no cambia ningún archivo salvo este informe.

Objetivo con el que se evalúa: que un integrador emita **su primera factura en 5 minutos** de forma confiable.

---

## 1. Resumen

- **La base es sólida y en varios puntos supera a Stripe.** La emisión es una sola transacción, la
  `Idempotency-Key` es obligatoria y resuelve las carreras devolviendo la misma factura (Stripe devuelve un
  error en ese caso). Los webhooks salen de una bandeja de salida dentro de la transacción, firmados con HMAC y
  con defensa contra SSRF. Las llaves de caja quedan atadas a su punto de emisión. Un 422 trae **todos** los
  errores fiscales a la vez, con su artículo.
- **Lo primero que ve quien empieza es lo más flojo.** Los errores 400 de forma salen en inglés de Zod
  («Invalid input: expected string…») y todos con el mismo código, `SOLICITUD_INVALIDA`. No hay id de
  solicitud, ni URL de documentación por código, ni catálogo publicado de los cerca de 71 códigos del núcleo.
  Además, la especificación OpenAPI no trae `operationId`, así que los clientes generados en otros lenguajes
  reciben nombres de método feos.
- **Faltan piezas de escala que conviene poner antes de publicar la 0.2.0.** No hay paginación (`GET
  /v1/documentos` puede devolver hasta 366 días de documentos en una sola respuesta, y la bitácora solo muestra
  las últimas 1000 entradas). Los montos de salida son `number` JSON en lempiras. Las envolturas de respuesta no
  son uniformes. Nada está publicado en npm todavía (`docs/avance.md`): **es la ventana barata para los cambios
  incompatibles**.
- **Los webhooks se rinden en una hora, no en seis.** Los 8 intentos con espera de 30 s × 2ⁿ suman unos
  64 minutos, aunque `docs/api.md` habla de «… 6 h». Después la entrega queda `FALLIDA`, sin una ruta para
  listarla ni reenviarla. Los verificadores de firma solo leen **una** firma `v1`, así que el secreto no se
  puede rotar sin cortar el servicio. Stripe reintenta durante 3 días y firma con varios secretos mientras dura
  una rotación.
- **El sandbox ya existe a medias.** El tenant `demo` (DEC-034) trae un CAI ficticio `DEMO00-NO-VALIDO-…`, un
  emisor «NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)» y una llave de caja lista. Pero sus llaves se ven
  igual que las reales y **la marca «SIN VALOR FISCAL» no existe en el código**. Propuesta: llaves `fhn_test_…`
  y `fhn_live_…`, un campo `modo` en cada objeto, una marca impresa en el documento y CAI ficticio obligatorio
  en el modo prueba. Por P-02, ese sandbox va **solo en el modo local** hasta que el SAR responda.

---

## 2. Inventario de rutas actual

Fuente: `packages/api/src/app.ts` y `openapi.json`. Rol mínimo: «caja» significa que también puede «admin».
Envoltura: forma del 2xx en JSON.

| # | Método y ruta | Rol | Envoltura 2xx | Id. en la ruta | Idempotencia | Paginación y filtros | Notas |
|---|---|---|---|---|---|---|---|
| 1 | `GET /salud` | público | `{ok, version, modo}` | — | — | — | Hace `SELECT 1` |
| 2 | `POST /v1/emisores` | admin | objeto suelto `EmisorGuardado` (201) | — | no | — | 409 `EMISOR_EXISTE` con el `id` y qué hacer |
| 3 | `GET /v1/emisores` | caja | `{emisores: [0..1]}` | — | — | — | Lista de 0 o 1: en la práctica es un singleton |
| 4 | `GET /v1/emisores/{id}` | caja | objeto suelto | uuid | — | — | |
| 5 | `PATCH /v1/emisores/{id}` | admin | objeto suelto | uuid | no | — | RTN inmutable (DEC-028) |
| 6 | `POST /v1/autorizaciones` | admin | `{autorizacion}` (201) | — | no | — | Valida el núcleo |
| 7 | `GET /v1/autorizaciones` | caja | `{autorizaciones}` | — | — | sin límite | |
| 8 | `GET /v1/autorizaciones/{cai}/estado` | caja | `{autorizacion, vigente, …}` | CAI normalizado | — | — | Arts. 59 y 62 |
| 9 | `POST /v1/documentos` | caja | `{documento}` (201) | — | **obligatoria** | — | Emite 01, 06 y 07 |
| 10 | `GET /v1/documentos` | caja | `{documentos}` | — | — | `desde`, `hasta` (≤ 366 días), `identificador`; **sin límite** | |
| 11 | `GET /v1/documentos/{archivo}` | caja | `{documento}`, o PDF, HTML o TXT según la extensión | número fiscal (+ `.pdf`, `.html` o `.txt`) | — | `formato`, `ancho` | El parámetro se llama `archivo`; en la #12 se llama `numero` |
| 12 | `POST /v1/documentos/{numero}/anular` | admin | `{documento}` | número fiscal | no (repetir da 422 `YA_ANULADO`) | — | Art. 41 |
| 13 | `POST /v1/series/{identificador}/corregir-fecha` | admin | `{anulados}` | `NNN-NNN-TT` | no | — | Arts. 41 y 43 |
| 14 | `GET /v1/series/{identificador}/no-utilizados` | admin | `{rangos}` | `NNN-NNN-TT` | — | — | Art. 42 |
| 15 | `GET /v1/libro-ventas` | caja | `{filas, resumen}` o CSV | — | — | `desde`, `hasta`, `formato` | |
| 16 | `GET /v1/exportacion` | admin | archivo jsonl, csv o txt | — | — | `desde`, `hasta`, `formato` | Art. 53 num. 5 (formato propio, P-14) |
| 17 | `GET /v1/bitacora` | admin | `{fiscal, api}` | — | — | solo `limite` (≤ 1000, las **últimas**) | Lo anterior no se alcanza por la API |
| 18 | `POST /v1/llaves` | admin | objeto suelto + `llave` (201) | — | no | — | La llave se muestra una sola vez |
| 19 | `GET /v1/llaves` | admin | `{llaves}` | — | — | — | |
| 20 | `DELETE /v1/llaves/{prefijo}` | admin | objeto suelto | **prefijo** (la respuesta y la bitácora usan `id`) | sí, por naturaleza | — | 409 si es la última llave admin |
| 21 | `POST /v1/webhooks` | admin | objeto suelto + `secreto` (201) | — | no | — | |
| 22 | `GET /v1/webhooks` | admin | `{webhooks}` | — | — | — | |
| 23 | `DELETE /v1/webhooks/{id}` | admin | objeto suelto | uuid | sí | — | Desactiva; no hay forma de reactivar |
| — | `GET /openapi.json`, `GET /docs`, `GET /` | público | — | — | — | — | Fuera de la especificación |

Cabeceras propias: `Idempotency-Key` (entrada), `Idempotency-Replayed` (salida), `X-Operador` (entrada),
`Retry-After` (solo en el 429 por ráfaga) y `X-FacturaHN-Evento`, `X-FacturaHN-Entrega` y `X-FacturaHN-Firma`
en los webhooks.

---

## 3. Hallazgos por tema

Severidad: **A** alta (frena el objetivo de 5 minutos o la confiabilidad), **M** media, **B** baja.

### 3.1 Rutas, verbos y nombres

| Hallazgo | Sev. | Comparación |
|---|---|---|
| Rutas en plural, kebab-case (`libro-ventas`, `no-utilizados`), JSON en camelCase y en español: **consistente**. Las acciones con efecto van como subrecurso con `POST` (`/anular`, `/corregir-fecha`). | ✓ | Es el mismo patrón de Stripe (`POST /v1/invoices/{id}/void`). Zalando pide snake_case (regla 118); cambiarlo ahora no compensa. |
| **Envolturas mezcladas.** `POST /v1/autorizaciones` devuelve `{autorizacion}`, pero `POST /v1/emisores`, `POST /v1/llaves` y `POST /v1/webhooks` devuelven el objeto suelto. `GET /v1/emisores/{id}` va suelto y `GET /v1/documentos/{n}` va envuelto. | M | Stripe devuelve siempre el objeto suelto, con `object: "invoice"`, y las listas como `{object: "list", data, has_more}`. Un integrador no debería tener que adivinar. |
| **Identificadores mezclados.** Las llaves se revocan por `prefijo`, pero la respuesta y la bitácora (DEC-031) las identifican por `id`. El documento se llama `{archivo}` en un lugar y `{numero}` en otro. | B | Stripe usa un id por recurso. Aquí el número fiscal y el CAI son buenas claves naturales; lo que falta es nombrarlas igual en todas partes. |
| **El emisor es un singleton con forma de colección** (lista de 0 o 1, más un uuid que hay que leer antes de hacer PATCH). Añade un paso al arranque. | M | Stripe expone el singleton como `GET /v1/account`. Aquí sería `GET` y `PUT /v1/emisor`. |
| `DELETE /v1/webhooks/{id}` desactiva y no hay `PATCH` para cambiar la URL, los eventos o reactivarlo. | B | Stripe tiene `update` en los endpoints de webhooks. |
| **OpenAPI sin `operationId`.** Los generadores de otros lenguajes (el camino que recomienda `AGENTS.md`) crean nombres a partir de la ruta. Además, el 422 aparece en todos los GET (por el `respuestasError` compartido), y el 413 y el 500 no están documentados. | A | Stripe publica su especificación con ids estables. El cliente TS usa rutas y no lo nota; Python, PHP o C# sí. |
| Cabeceras con `X-` (`X-Operador`, `X-FacturaHN-*`). | B | La RFC 6648 desaconseja el prefijo `X-`. Basta con mantenerlas y no crear más. |

### 3.2 Formato de errores

Hoy el cuerpo es `{ error: { codigo, mensaje }, errores?: [{ codigo, mensaje, campo }], advertencias? }`, con
`application/json`.

**Lo bueno.**
- Los códigos son estables y en UPPER_SNAKE (`IDEMPOTENCIA_CONFLICTO`, `CAJA_NO_AUTORIZADA`), como pide
  AIP-193.
- Muchos mensajes dicen qué hacer: «Registra primero el emisor (POST /v1/emisores)», «usa PATCH
  /v1/emisores/{id}», «Usa una clave nueva por venta».
- Los fiscales citan el artículo («… ya está ANULADO (Art. 41). No se puede anular dos veces ni reactivar»).
- El 422 devuelve **la lista completa** de errores fiscales con su `campo`. Stripe devuelve uno solo (`param`).

**Brechas.**

| Hallazgo | Sev. | Comparación |
|---|---|---|
| **Los 400 de forma salen en inglés y con un código genérico.** `defaultHook` copia `issue.message` de Zod («Too small: expected array to have >=1 items») y pone `codigo: 'SOLICITUD_INVALIDA'` en cada detalle. Es el primer error que ve quien olvida la envoltura `documento` o manda `lineas: []`. Zod 4 trae el locale `es` (probado: `z.config(z.locales.es())` da «Entrada inválida: se esperaba texto, recibido indefinido»), y el código de Zod (`too_small`, `invalid_type`) puede ir a un código estable. | **A** | El `invalid_request_error` de Stripe trae `param` y un mensaje legible. AIP-193 pide mensajes accionables y un `reason` estable. |
| **No hay id de solicitud.** El 500 dice «Se registró para revisión», pero el integrador no tiene con qué citarlo. | A | Stripe tiene `Request-Id`; Microsoft pide `x-ms-request-id` en cada respuesta. |
| **No hay enlace a la documentación por código ni un catálogo publicado.** El núcleo emite unos 71 códigos distintos y no hay un `docs/errores.md`. | M | El `doc_url` de Stripe; el `type` URI de la RFC 9457; el `Help` de AIP-193; «documenta los códigos» de Microsoft. |
| `ErrorValidacion` sube como `error.codigo: 'VALIDACION'` y un `mensaje` que **concatena** todos los mensajes. Sirve para mostrar, pero `errores[0].codigo` es lo que el código debe mirar. Falta decirlo en la especificación. | B | — |
| El 401 no muestra la forma esperada. Un mensaje como «Usa `Authorization: Bearer fhn_…`» no filtra nada y ahorra la duda más común. | M | — |
| Ruta inexistente y recurso inexistente dan el mismo `NO_ENCONTRADO`. | B | Microsoft distingue los códigos de nivel superior. |
| `IDEMPOTENCY_KEY` es el único código en inglés. | B | — |
| No hay `application/problem+json`. | M | RFC 9457 y Zalando regla 176. Microsoft y Stripe usan su propio `error{code,message}`, que es lo que hace factura-hn. |

**Recomendación.** Mantener la forma actual: está bien y Stripe y Microsoft hacen lo mismo. Añadir
`error.documentacion` (URL del código), `solicitud` (id, también en la cabecera `Solicitud-Id` o `Request-Id`)
y mensajes de 400 en español con códigos derivados del de Zod (`CAMPO_REQUERIDO`, `CAMPO_TIPO`,
`CAMPO_DEMASIADO_CORTO`…). Si algún cliente lo pide, servir `application/problem+json` cuando llegue
`Accept: application/problem+json`: `type`, `title`, `status` y `detail`, más `codigo` y `errores` como
extensiones, que la RFC 9457 permite. Generar `docs/errores.md` desde el código del núcleo, con una prueba que
falle si aparece un código nuevo sin documentar.

### 3.3 Paginación

| Hallazgo | Sev. | Comparación |
|---|---|---|
| **No hay paginación en ninguna lista.** `GET /v1/documentos` acepta hasta 366 días: un negocio con 300 documentos al día son unos 110 000 documentos completos en una sola respuesta, que se arma en memoria en la API y en el cliente. | A | Stripe: `limit` (10 por defecto, máximo 100), `starting_after`, `ending_before` y `has_more`. AIP-158: `page_size` y `page_token` opacos. Microsoft: `value` y `nextLink`. Zalando reglas 159 y 160: cursor, no offset. |
| `GET /v1/bitacora` solo devuelve **las últimas** `limite` entradas (máximo 1000): lo anterior no se puede leer por la API. Es la bitácora de auditoría del Art. 53 num. 2. | A | — |
| AIP-158: **añadir paginación después es un cambio incompatible**, porque los clientes asumen la lista completa. | — | Por eso conviene hacerlo antes de publicar la 0.2.0. |

**Propuesta.** Parámetros `limite` (100 por defecto, máximo 500) y `cursor` (opaco). Respuesta con la misma
clave de hoy más `siguiente` (cursor, o ausente al final) y `hayMas`. Orden estable: en documentos,
(`fechaEmision`, `numero`); en la bitácora, el `id`. El cliente TS añade `for await (const d of
fhn.todosLosDocumentos(desde, hasta))`, como el auto-paging de Stripe. El libro de ventas y la exportación siguen
como archivo completo del período, porque son reportes y no listas.

### 3.4 Filtros

Hoy `GET /v1/documentos` filtra por `desde`, `hasta` (fechas locales, inclusivas) e `identificador`.

| Falta | Para qué |
|---|---|
| `tipoDocumento`, `estado` (`EMITIDO` o `ANULADO`) | Conciliar y ver anulaciones |
| `cliente.rtn` (o `clienteRtn`) | Notas de crédito, estados de cuenta |
| `referencia` (número del original) | «¿Qué notas tiene esta factura?» |
| `actualizadoDesde` | **Sincronizar.** Un documento antiguo puede pasar a ANULADO hoy, y quien sincroniza por `fechaEmision` no lo ve. Hoy solo el webhook `documento.anulado` lo avisa. |

Recomendación: filtros de igualdad simples, como Stripe. No hace falta el lenguaje de filtros de AIP-160.

### 3.5 Versionado

| Hallazgo | Sev. | Comparación |
|---|---|---|
| Prefijo `/v1` más `VERSION_API = '0.2.0'` en `/salud` y en `info.version`. No hay una política escrita de qué cambios son compatibles. | M | Stripe: versiones con fecha, cabecera `Stripe-Version`, versión fija por cuenta y por endpoint de webhook, y cambios incompatibles solo dos veces al año. AIP-180 define lo compatible. Zalando prefiere no versionar (regla 113) y, si hace falta, por media type (reglas 114 y 115). Microsoft usa `api-version=AAAA-MM-DD`. |
| **En el modo local, cada negocio corre su propia versión del servidor.** El cliente npm puede ser más nuevo o más viejo que el servidor, y no hay negociación: el cliente no mira `/salud`. | M | Stripe no tiene este problema porque solo hay un servidor. |
| El sobre de los webhooks (`{id, evento, creado, datos}`) no dice de qué versión es. | B | Stripe fija `api_version` por endpoint. |

**Recomendación.** No adoptar versiones por fecha: son excesivas para un servidor que el propio negocio
actualiza. Sí conviene:
1. Escribir la política de compatibilidad en `docs/api.md`, siguiendo AIP-180. Agregar campos, rutas, códigos
   de error o eventos es compatible. Agregar valores a un enum de respuesta también, **pero hay que avisarlo**.
   Quitar o renombrar campos, o cambiar tipos, requiere `/v2`.
2. Enviar la cabecera `FacturaHN-Version: 0.2.0` en cada respuesta y hacer que el cliente avise si el servidor
   es de otra versión mayor.
3. Marcar lo que vaya a retirarse con las cabeceras `Deprecation` (RFC 9745) y `Sunset` (RFC 8594).
4. Poner `version` en el sobre de los webhooks.

### 3.6 Idempotencia (`Idempotency-Key`)

| Aspecto | factura-hn | Stripe (API v1) | Borrador IETF (-08) |
|---|---|---|---|
| Dónde aplica | Solo `POST /v1/documentos`, y ahí es **obligatoria** (400 sin ella) | Todos los POST, opcional | 400 si es obligatoria y falta |
| Largo | 1 a 255 caracteres visibles | Hasta 255 | — |
| Misma clave, otro cuerpo | 422 `IDEMPOTENCIA_CONFLICTO` | `idempotency_error` (400) | 422 |
| Dos solicitudes simultáneas | Una emite y la otra se revierte y **devuelve la misma factura** | No guarda el resultado; hay que reintentar | 409 |
| Qué se guarda | Solo las emisiones exitosas (DEC-029) | Todo resultado una vez que empezó la ejecución, incluidos los 500 | — |
| Huella | JSON con claves ordenadas; el operador cuenta solo si se imprime | Compara los parámetros | — |
| Caducidad | **Nunca** (pendiente conocido en `docs/api.md`) | Se pueden purgar a las 24 h | — |
| Cabecera de repetición | `Idempotency-Replayed: true` | `Idempotent-Replayed: true` | — |

**Lo bueno.** La clave se guarda en la misma transacción que el documento, el número no se consume al
fallar y el manejo de la carrera es mejor que el de Stripe. **Brechas:**
- Sin caducidad, la tabla crece sin fin.
- `anular` no acepta clave: si la respuesta se pierde, el reintento da 422 `YA_ANULADO` y el integrador debe
  consultar el documento para saber si fue él.
- Crear llaves o webhooks dos veces por un reintento deja duplicados.

**Recomendación.**
- Retención documentada **larga**: un POS que se reconecta días después no debe emitir dos veces, así que
  30 días en lugar de las 24 h de Stripe. Lo decide el responsable.
- Aceptar `Idempotency-Key` opcional en todos los POST.
- Hacer que `anular` con la misma clave repita la respuesta.
- Documentar que la repetición devuelve el documento **como se emitió**. Eso ya está en `docs/api.md`.

### 3.7 Autenticación, llaves y prefijos

`Authorization: Bearer fhn_<12 hex>_<43 base64url>`. Se guarda el SHA-256 y se compara en tiempo constante
(DEC-026). Hay roles `caja` y `admin`, y la llave de caja queda atada a un establecimiento y punto de emisión.

| Hallazgo | Sev. | Comparación |
|---|---|---|
| Prefijo fijo `fhn_`: sirve para detectar llaves filtradas (patrones de secret scanning). | ✓ | `sk_`, `rk_` y `pk_` de Stripe. |
| Las llaves de caja son el equivalente a las *restricted keys* de Stripe y la atadura a la caja es más fina. | ✓ | Stripe recomienda RAK sobre la llave secreta. |
| **La llave no dice si es de prueba o real.** La del tenant `demo` se ve igual que la del negocio. | **A** | `sk_test_` y `sk_live_`: cada modo tiene sus llaves y los objetos de uno no se ven en el otro. |
| No hay rotación con gracia ni caducidad (`expiraEn`). | M | Stripe deja las dos llaves activas hasta 7 días al rotar. |
| No hay «¿quién soy?»: para saber el tenant, el rol, la caja o el modo de una llave hay que probar rutas. | M | `GET /v1/account` de Stripe. |
| **El límite por llave va antes de autenticar y por prefijo** (app.ts, l. 163-165). Frena a quien prueba secretos, pero quien conozca el prefijo de una caja puede dejarla en 429. El prefijo es público: sale en listados, en la bitácora (`llave.creada`) y en logs que truncan la llave. | M | — |
| Mensaje del 401 (ver 3.2). | M | — |

### 3.8 Límites de tasa y sus cabeceras

Token bucket en memoria por llave: 20/s y ráfaga de 40, por réplica (DEC-030). El límite mensual de documentos
está en la base. Solo el 429 de ráfaga trae `Retry-After`.

| Hallazgo | Sev. | Comparación |
|---|---|---|
| No hay cabeceras de cuota restante. | B | Stripe tampoco las publica: devuelve 429 con `Stripe-Rate-Limited-Reason`. El borrador IETF (-11) define `RateLimit-Policy` y `RateLimit`. Zalando regla 153 pide 429 con cabeceras. |
| **`LIMITE_MENSUAL` es un 429 sin `Retry-After`.** Los reintentos automáticos genéricos tratan el 429 como pasajero y van a reintentar sin fin algo que no se resuelve hasta el mes siguiente. | M | Stripe separa los 429 de tasa de otras causas (`lock_timeout`). |
| Ataque al bucket por prefijo (3.7). | M | — |

**Recomendación.**
- Enviar `RateLimit-Policy: "llave";q=40;w=1` y `RateLimit: "llave";r=<n>;t=<s>`. Es aditivo.
- Añadir `FacturaHN-Limite: rafaga|mensual`.
- Dar al 429 mensual un `Retry-After` hasta el primer día del mes siguiente en hora de Honduras. La otra opción
  es pasarlo a 403 con `LIMITE_MENSUAL`, que es incompatible.
- Que los intentos fallidos consuman un bucket aparte (prefijo + IP) y solo los autenticados el de la llave.

### 3.9 Webhooks

**Existen y están bien diseñados.**
- Eventos: `documento.emitido`, `documento.anulado`, `autorizacion.por_vencer` (Art. 59) y
  `autorizacion.agotada`.
- Bandeja de salida en la misma transacción.
- Firma `t=…,v1=HMAC-SHA256("<t>.<cuerpo>")` con 5 minutos de tolerancia: el mismo esquema que `Stripe-Signature`.
- En el modo alojado, solo https, sin IP internas, sin rebinding y sin redirecciones.
- `whsec_` como prefijo del secreto, cifrado AES-GCM en reposo.
- Verificador para Node y para el borde (Web Crypto).

| Hallazgo | Sev. | Comparación |
|---|---|---|
| **Ventana de reintentos de unos 64 minutos.** `MAX_INTENTOS = 8` y `esperaReintento` = 30 s × 2ⁿ⁻¹, así que las esperas suman 30+60+120+240+480+960+1920 s. El tope de 6 h nunca se alcanza, aunque `docs/api.md` dice «… 6 h». Un ERP caído durante una hora pierde avisos fiscales sin enterarse. | **A** | Stripe: hasta 3 días en vivo, con reenvío manual por 15 a 30 días. |
| **No hay forma de ver ni reenviar las entregas.** `api_entregas` guarda estado, intentos y último error, pero ninguna ruta lo expone. | A | Pestaña *Event deliveries* y `stripe events resend`. |
| **No se puede rotar el secreto, y los verificadores no lo permitirían.** `verificarFirmaWebhook` (API y cliente) arma un `Map` de la cabecera: con dos `v1` se queda con la última. Corregirlo **ahora** en el cliente evita romper a los receptores cuando se agregue la rotación. | A | Stripe firma con cada secreto activo durante 7 días y pide aceptar «al menos un `v1` válido» e ignorar entradas desconocidas. |
| No hay evento de prueba (`POST /v1/webhooks/{id}/probar`). | M | `stripe trigger`. |
| El `id` del aviso es el **id de la entrega** (uno por webhook), no del evento. Con dos webhooks, el mismo hecho llega con ids distintos. | B | Stripe usa un `evt_…` único por evento. |
| Sin `modo` ni `version` en el sobre, y sin aclarar que no se garantiza el orden. | B | `livemode`, `api_version`; Stripe documenta que no garantiza el orden. |
| No hay un evento para el plazo de aviso de no utilizados (Art. 42). `fechaLimiteAviso` ya se calcula en `noUtilizadosDelAlmacen`. | B | Idea de producto: no crea una regla fiscal nueva, avisa de una que ya está en el código. |

Como referencia de formato, Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`) es
compatible en espíritu. No hace falta migrar.

### 3.10 Expansión de objetos

No existe, y **casi no hace falta**. El documento es una foto inmutable que ya lleva emisor, cliente, CAI, rango,
fecha límite y totales (Art. 38: la copia es idéntica al original). Stripe necesita `expand[]` porque sus
objetos se refieren por id. Aquí lo único referenciado es `referencia` (el original de una NC o ND) y el estado
de la autorización tras emitir.

**Recomendación:** no implementar `expand`. A lo sumo, `?incluir=estadoAutorizacion` en la emisión, para que el
POS muestre «quedan N números» sin otra llamada, y documentar que `referencia.numero` se consulta con `GET
/v1/documentos/{numero}`.

### 3.11 Fechas y montos

**Fechas.** Hay dos convenciones, ambas correctas, pero sin documentar:
- Las fiscales van como fecha local `AAAA-MM-DD` en America/Tegucigalpa (`fechaEmision`,
  `fechaLimiteEmision`, `desde` y `hasta`; DEC-022). Es lo que exige el impreso y es mejor que el Unix
  timestamp de Stripe para este dominio.
- Los instantes técnicos van en ISO-8601 UTC con `Z` (`creada`, `revocada` y `ultimoUso` de las llaves;
  `creado` de los webhooks; `instante` de la bitácora).

Recomendación: decirlo en la especificación (`format: date` frente a `format: date-time`) y, si se agrega un
instante de emisión, usar RFC 3339 (Microsoft, y Zalando regla 169).

**Montos.**
- Entrada: texto decimal (recomendado) o `number`. El núcleo lo pasa a `bigint` y rechaza los decimales de más:
  sin punto flotante (B-17).
- **Salida: `number` JSON en lempiras** (`totales.total`, `isv15`, `precioUnitario`, `importe`,
  `tipoCambio`…), porque `deCentavos` convierte a `number` «para mantener la API».
- El cálculo está bien. El riesgo está en el integrador: Python, PHP o JS leen ese número como `float` y suman en
  binario.
- `docs/investigacion.md` (B-17) ya proponía «salida en centavos enteros más los campos actuales» y adoptaba
  «montos serializados como texto»; en la API no se hizo.

| Opción | Compatible | Comentario |
|---|---|---|
| Montos de salida como texto (`"115.00"`; `"57.5000"` en cantidad y precio) | **No** | Lo más coherente con la entrada y con `AGENTS.md` («Montos como texto exacto»). Es el momento: nada publicado. |
| Añadir un objeto paralelo (`totalesTexto` o `montos`) | Sí | Duplica datos; siempre se puede quitar en `/v2`. |
| Centavos enteros (como Stripe, `amount: 1000`) | Sí, si es aditivo | No sirve para cantidad y precio unitario (4 decimales). |

Stripe usa enteros en la unidad menor. Zalando define `amount` decimal más `currency` (regla 173). Las dos
evitan el `float` del lado del cliente.

### 3.12 El camino a la primera factura (5 minutos)

- **Hoy, con la demostración:** `docker compose up --build` y, con la llave de caja que aparece en el log, **una
  sola** solicitud (`POST /v1/documentos`) da una factura con CAI ficticio y su PDF. Es comparable a la llave
  de prueba de Stripe.
- **Lo que frena:**
  1. Hace falta Docker y la imagen se **construye** desde el repositorio: no hay imagen publicada
     (`docs/lanzamiento.md`, opcional GHCR).
  2. Las llaves solo aparecen en `docker compose logs`.
  3. El primer error suele ser un 400 en inglés (3.2).
  4. Nada distingue la llave demo de la real (3.7).
- **Con datos reales** son 3 a 4 llamadas: emisor, autorización, (llave de caja) y emisión. Una ruta
  `GET /v1/sesion` que diga **qué falta para emitir** («falta el emisor», «no hay CAI vigente para 000-001
  tipo 01») sería el mejor atajo.

---

## 4. Propuesta de sandbox

### 4.1 Restricciones de partida

- **P-02 (consulta-sar.md §1):** «No ofrecemos el servicio en la nube hasta recibir esta respuesta». Y
  `modelo-de-negocio.md`: el modo alojado es «capacidad técnica, no servicio», y «nadie puede registrarse: los
  tenants los crea el operador».
- Por eso el sandbox se diseña **primero para el modo local** (Art. 47, servidor en el establecimiento), que
  es lo que hoy existe y se recomienda.
- **Sandbox alojado público: por confirmar.** Aunque no emita documentos con valor fiscal, sería operar el modo
  alojado como servicio con registro abierto, que es justo lo que P-02 deja en suspenso. No se hace sin la
  respuesta del SAR y sin una decisión del responsable.
- El playground del navegador (`examples/playground`, SDK en memoria con CAI ficticios) sigue siendo el «probar
  sin instalar nada».

### 4.2 Qué existe hoy y qué falta

| Elemento | Hoy | Falta |
|---|---|---|
| Tenant de prueba aislado | `demo` con `FHN_DEMO=1` (DEC-034); RLS lo aísla de `local` | Marcarlo como `modo = prueba` en `api_tenants` |
| CAI ficticio | `DEMO00-NO-VALIDO-0000-0000-0000-0{1,6,7}`, 000-001, rango 1-5000, 180 días (`operador.ts`) | Hacerlo **obligatorio** en el modo prueba y **prohibido** en producción |
| Emisor ficticio | RTN `9999…`, razón social «NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)» | — |
| Correlativos separados | Sí: `fhn_series` es por tenant | — |
| Marca «SIN VALOR FISCAL» | **No existe en el código.** Lo que hay: la leyenda ANULADA (Art. 41) al inicio y al final del TXT y del HTML y como marca de agua diagonal en el PDF, y la opción `leyenda` (pie libre, no reglamentaria) | Una marca de prueba que reutilice el mecanismo de ANULADA |
| Llaves distinguibles | No (`fhn_<prefijo>_…` en ambos) | `fhn_test_…` y `fhn_live_…` |

### 4.3 Diseño

**Llaves.**
- Las nuevas tienen la forma `fhn_live_<12 hex>_<43>` o `fhn_test_<12 hex>_<43>`.
- Las de hoy (`fhn_<12 hex>_<43>`) siguen valiendo y cuentan como `live`.
- La fuente de verdad es `api_tenants.modo`. Si una llave dice `test` y su tenant es de producción, o al revés,
  la respuesta es 401: así no se puede fabricar una.
- `prefijoDe` acepta los tres formatos; el prefijo de 12 hex sigue siendo la clave en la base y en `DELETE
  /v1/llaves/{prefijo}`.
- Para la detección de filtraciones, una llave `live` es urgente y una `test` no. Opcional: un dígito de control
  al final (CRC) para rechazar errores de copia sin consultar la base.

**Aislamiento.**
- Un tenant por modo. En el modo local: `local` (producción) y `demo` (prueba).
- Si algún día existe el modo alojado: `<tenant>` y `<tenant>-prueba`, enlazados por una columna
  `tenant_produccion`.
- RLS ya separa todo: series, documentos, idempotencia, uso, webhooks y bitácora. Nada se comparte ni se migra de
  un modo al otro.
- Una llave nunca ve el otro modo, igual que en Stripe.

**Qué hace distinto el modo prueba.**
1. **CAI.**
   - El sandbox registra solo los CAI ficticios (como `crearDemo`).
   - `POST /v1/autorizaciones` en prueba rechaza todo CAI que no empiece por `DEMO00-NO-VALIDO`.
   - En producción rechaza los que sí empiezan así (código `CAI_DE_PRUEBA`).
   - Es una salvaguarda de producto, no una regla fiscal: va en `docs/decisiones.md` como decisión nueva.
   - Motivo: un CAI real en el sandbox produciría documentos con apariencia válida fuera de la serie real.
2. **Correlativos.** Propios y con **las mismas reglas** (sin huecos, orden cronológico del Art. 43, fecha de
   hoy por DEC-022), para que la prueba sea fiel.
3. **Marca impresa.**
   - El documento lleva `modo: "prueba"` en su JSON, dentro de la foto inmutable: así la copia sigue idéntica al
     original (Art. 38).
   - El render agrega una leyenda al inicio y al final del TXT y del HTML y una marca de agua diagonal en el
     PDF, con el mismo código que ANULADA.
   - Texto propuesto: «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». **La redacción está por confirmar**: ningún
     artículo del repositorio la exige.
   - No debe usar `leyenda`, que es libre y configurable.
4. **`modo` visible en todo.** En el documento, en el sobre de los webhooks, en la cabecera `FacturaHN-Modo:
   prueba` de cada respuesta y en `GET /v1/sesion` (como `livemode` en Stripe).
5. **Reportes.** El libro de ventas y la exportación funcionan, pero el nombre del archivo y su encabezado dicen
   PRUEBA. Así nunca se confunden con el archivo del Art. 53 num. 5.
6. **Límites.** Una tasa menor y un tope mensual bajo. Stripe hace lo mismo: 25/s en sandbox frente a 100/s en
   vivo.
7. **Webhooks.** Secretos propios del modo, URLs http y de la LAN permitidas (como el modo local de hoy) y la
   ruta `POST /v1/webhooks/{id}/probar`.
8. **Opcional (P3): reloj simulado.** Una cabecera aceptada **solo** con llaves `test`, para ensayar vencimiento
   (Art. 59), CAI vencido, salto de fecha (Art. 43) y plazos del Art. 42. Es como los *test clocks* de Stripe.
   El riesgo es que se cuele en producción: el servidor debe ignorarla si el modo no es prueba, y debe haber una
   prueba que lo verifique.

### 4.4 Paso a producción (modo local, posible hoy)

1. El negocio se inscribe como autoimpresor y obtiene su CAI y rango (aviso de `docs/normativa.md`; Art. 47).
2. Con la llave `fhn_live_` admin: `POST /v1/emisores` con los datos reales y `POST /v1/autorizaciones` con la
   resolución.
3. `POST /v1/llaves` crea una llave `fhn_live_` de caja por punto de emisión.
4. El integrador cambia **solo** `FHN_LLAVE`. La URL y el código no cambian: la llave decide el modo, igual que
   en Stripe.
5. Recrear los webhooks en producción, que tienen su propio secreto.
6. `GET /v1/sesion` confirma `modo: produccion` y `listoParaEmitir: true`. La primera emisión real se verifica
   con `GET /v1/autorizaciones/{cai}/estado`.
7. En el servidor del negocio, `FHN_DEMO=0` (`docs/autoalojamiento.md`) o conservar `demo` para capacitar,
   porque está aislado.

No se copia nada de prueba a producción: ni documentos, ni correlativos, ni claves de idempotencia.

### 4.5 Si P-02 se responde

| Respuesta (modelo-de-negocio.md) | Sandbox |
|---|---|
| Permite el alojamiento | Llaves `fhn_test_` por autoservicio al registrarse; las `fhn_live_` solo tras verificar el RTN y el CAI, como hoy los crea el operador |
| Solo con servidor en el establecimiento | Sandbox local (este diseño). Un sandbox público sin valor fiscal queda **por confirmar** con asesoría legal |
| No responde | Solo el sandbox local y el playground |

---

## 5. Cambios compatibles e incompatibles

Para el cliente `@factura-hn/cliente` y los integradores HTTP. «Compatible» quiere decir que un cliente escrito
para la 0.2.0 sigue funcionando.

| Cambio | Compatible | Nota |
|---|---|---|
| `operationId` en todas las rutas | Sí | Los clientes TS no cambian; los generados en otros lenguajes cambian de nombre **una vez** |
| Mensajes de 400 en español | Sí | Los textos no son contrato; los códigos sí |
| Códigos de 400 por tipo (en lugar de `SOLICITUD_INVALIDA` en el detalle) | Sí, a medias | Mantener `error.codigo = SOLICITUD_INVALIDA` y afinar solo `errores[].codigo` |
| `Request-Id` o `Solicitud-Id`, `error.documentacion`, `FacturaHN-Version`, `RateLimit*` | Sí | Aditivos |
| `application/problem+json` con `Accept` | Sí | Opt-in |
| Paginación opt-in (solo con `limite`) | Sí | Sin `limite` responde como hoy |
| Paginación por defecto | **No** | AIP-158; hacerla antes de la 0.2.0 o en `/v2` |
| Filtros nuevos | Sí | |
| `GET /v1/sesion`, `GET/POST` de entregas de webhooks, `probar`, `PATCH /v1/webhooks/{id}` | Sí | |
| Verificador que acepte varios `v1` e ignore entradas desconocidas | Sí | Hacerlo **antes** de introducir la rotación |
| Rotación del secreto (firmar con varios `v1`) | **No** para receptores con el verificador viejo | De ahí el orden |
| Más intentos de webhooks (unos 3 días) | Sí | Pueden llegar avisos más tarde: el receptor ya debe deduplicar |
| `id` de evento estable entre endpoints | Sí si es un campo nuevo (`evento_id`) | Cambiar el significado de `id` no lo es |
| Llaves `fhn_live_` y `fhn_test_` aceptando las viejas | Sí | |
| Dejar de aceptar `fhn_<prefijo>_…` | **No** | Solo en `/v2` o con `Sunset` |
| `modo` en documento, sobre y sesión | Sí | El campo nuevo de `DocumentoFiscal` es aditivo (`looseObject`) |
| Marca SIN VALOR FISCAL en el impreso de prueba | Sí | Solo afecta al tenant de prueba |
| Rechazar CAI `DEMO00-…` en producción | Prácticamente sí | Rompe solo a quien registró un CAI ficticio en un tenant real |
| Montos de salida como texto | **No** | Decidirlo antes de la 0.2.0 |
| Objeto paralelo de montos en texto o en centavos | Sí | |
| Envolturas uniformes (todo envuelto o todo suelto) | **No** | Antes de la 0.2.0 o en `/v2` |
| `GET/PUT /v1/emisor` singleton | Sí si se mantiene `/v1/emisores` | |
| Renombrar `{archivo}` a `{numero}` | Sí en HTTP; cambia el tipo generado en TS | |
| `Retry-After` en `LIMITE_MENSUAL` | Sí | |
| Pasar `LIMITE_MENSUAL` a 403 | **No** | |
| Caducidad de las claves de idempotencia | Sí si la retención es ≥ a la que se documenta | |
| `Idempotency-Key` opcional en los demás POST | Sí | |

---

## 6. Recomendaciones priorizadas

Impacto: en el objetivo de 5 minutos y en la confiabilidad. Esfuerzo: **S** menos de 1 día, **M** de 1 a
3 días, **L** más de 3 días. Las marcadas con ⏱ conviene hacerlas **antes de publicar la 0.2.0** porque son
incompatibles o dejan de serlo después.

| Prioridad | Recomendación | Impacto | Esfuerzo | Sección |
|---|---|---|---|---|
| P0 | Mensajes de 400 en español (`z.config(z.locales.es())`) y códigos por tipo de problema en `errores[]` | Alto | S | 3.2 |
| P0 | `operationId` en todas las rutas; quitar el 422 de los GET y documentar 413 y 500 | Alto | S | 3.1 |
| P0 | Id de solicitud en la cabecera y en el cuerpo de error | Alto | S | 3.2 |
| P0 ⏱ | Verificadores de webhook (API y cliente) que acepten varios `v1` | Alto | S | 3.9 |
| P0 | Reintentos de webhooks por unos 3 días y corregir «… 6 h» en `docs/api.md` | Alto | S | 3.9 |
| P0 | `GET /v1/sesion`: tenant, rol, caja, modo y **qué falta para emitir** | Alto | S | 3.12 |
| P1 ⏱ | Paginación por cursor en `/v1/documentos` y `/v1/bitacora` (y en las demás listas) | Alto | M | 3.3 |
| P1 ⏱ | Decidir los montos de salida: texto (incompatible) o un objeto paralelo | Alto | M | 3.11 |
| P1 | Llaves `fhn_test_` y `fhn_live_`, `api_tenants.modo` y `modo` en las respuestas (sandbox local) | Alto | M | 4 |
| P1 | CAI ficticio obligatorio en prueba y prohibido en producción (decisión nueva en `decisiones.md`) | Alto | S | 4.3 |
| P1 | Marca «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» (redacción por confirmar) con el mecanismo de ANULADA | Alto | M | 4.3 |
| P1 | Rutas de entregas de webhooks: listar, reenviar y probar | Medio | M | 3.9 |
| P1 | `docs/errores.md` generado desde el núcleo y `error.documentacion` | Medio | M | 3.2 |
| P1 | Bucket aparte para los intentos fallidos de autenticación | Medio | S | 3.7, 3.8 |
| P2 ⏱ | Envolturas de respuesta uniformes; emisor como singleton | Medio | M | 3.1 |
| P2 | Filtros: `tipoDocumento`, `estado`, `clienteRtn`, `referencia`, `actualizadoDesde` | Medio | M | 3.4 |
| P2 | Política de versiones (AIP-180), `FacturaHN-Version`, aviso de versión en el cliente, `Deprecation` y `Sunset` | Medio | S | 3.5 |
| P2 | Caducidad documentada de las claves de idempotencia (≥ 30 días, a decidir) e `Idempotency-Key` opcional en los demás POST, incluido anular | Medio | M | 3.6 |
| P2 | Cabeceras `RateLimit-Policy` y `RateLimit`; `Retry-After` en `LIMITE_MENSUAL` | Bajo | S | 3.8 |
| P2 | Rotación de llaves con gracia y `expiraEn`; rotación del secreto de webhooks (después del P0 de verificadores) | Medio | M | 3.7, 3.9 |
| P2 | Imagen Docker publicada (GHCR), **con permiso del responsable** | Alto para los 5 minutos | S | 3.12 |
| P3 | `PATCH /v1/webhooks/{id}`, `evento_id` estable, `version` en el sobre, evento del plazo del Art. 42 | Bajo | M | 3.9 |
| P3 | `application/problem+json` opt-in | Bajo | S | 3.2 |
| P3 | Reloj simulado solo con llaves de prueba | Bajo | M | 4.3 |
| — | **No** implementar `expand` | — | — | 3.10 |
| — | Sandbox alojado público: **solo** tras la respuesta a P-02 y una decisión del responsable | — | — | 4.5 |

---

## 7. Fuentes

Repositorio: `packages/api/src/app.ts`, `errores.ts`, `llaves.ts`, `esquemas.ts`, `webhooks.ts`,
`operador.ts`; `packages/api/openapi.json`; `packages/cliente/src/index.ts` y `webhooks.ts`;
`packages/core/src/dinero.ts`, `tipos.ts`, `anulacion.ts`, `render.ts`; `packages/pdf/src/index.ts`;
`docs/api.md`, `docs/decisiones.md` (DEC-022, 026, 028 a 035), `docs/consulta-sar.md` (P-02),
`docs/modelo-de-negocio.md`, `docs/investigacion.md` (B-17), `docs/normativa.md`, `docs/avance.md`,
`docs/autoalojamiento.md`, `AGENTS.md`.

Externas (consultadas el 19-11-2026):
- Stripe, peticiones idempotentes: https://docs.stripe.com/api/idempotent_requests
- Stripe, errores: https://docs.stripe.com/api/errors
- Stripe, paginación: https://docs.stripe.com/api/pagination
- Stripe, versionado: https://docs.stripe.com/api/versioning
- Stripe, límites de tasa: https://docs.stripe.com/rate-limits
- Stripe, llaves y sandbox frente a modo vivo: https://docs.stripe.com/keys
- Stripe, expansión: https://docs.stripe.com/api/expanding_objects
- Stripe, webhooks (firma, reintentos, rotación): https://docs.stripe.com/webhooks
- RFC 9457, Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 9745, cabecera Deprecation: https://www.rfc-editor.org/rfc/rfc9745.html
- RFC 8594, cabecera Sunset: https://www.rfc-editor.org/rfc/rfc8594.html
- RFC 6648, desuso del prefijo «X-»: https://www.rfc-editor.org/rfc/rfc6648.html
- IETF, borrador de Idempotency-Key (-08): https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- IETF, borrador de RateLimit (-11): https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- Google AIP-193, errores: https://google.aip.dev/193
- Google AIP-158, paginación: https://google.aip.dev/158
- Google AIP-180, compatibilidad: https://google.aip.dev/180
- Google AIP-160, filtros: https://google.aip.dev/160
- Microsoft REST API Guidelines (Azure): https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md
- Zalando RESTful API Guidelines (reglas 113-116, 118, 153, 159, 160, 169, 173, 176, 230): https://opensource.zalando.com/restful-api-guidelines/
- Standard Webhooks: https://www.standardwebhooks.com/
