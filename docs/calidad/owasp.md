# OWASP API Security Top 10 (2023)

- **Fecha:** 25-11-2026.
- **Alcance:** `@factura-hn/api` (rutas, autenticación, roles, webhooks y arranque), en local, contra PostgreSQL 16.
  Sin servicios externos: los receptores de webhooks de las pruebas escuchan en `127.0.0.1`.
- **Pruebas:** `packages/api/test/owasp/`, un archivo por riesgo (`api1-…` a `api10-…`) y `comun.ts`, que tiene un
  tenant con un recurso de cada tipo y el **catálogo** de las 28 operaciones autenticadas. Las pruebas de BOLA,
  autenticación y roles recorren el catálogo entero. La de inventario (API9) falla si una operación de la
  especificación no está en el catálogo, así que una ruta nueva no se queda sin estas pruebas.
- **Resultado:** 10 de 10 riesgos cubiertos, **55 pruebas, 55 pasan, ninguna omitida**, en unos 60 s. Se encontraron y corrigieron
  cuatro fallas, ninguna crítica (ver «Hallazgos»).

## Cómo repetirlo

```sh
FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn_pruebas pnpm calidad:owasp
```

Imprime una tabla por riesgo (pasan, fallan, omitidas) y sale con error si alguno falla, tiene una prueba omitida o se queda sin pruebas. Ninguna prueba depende de la red ni
del equipo: la resolución de nombres de API7 usa un resolvedor de prueba.
Solo las pruebas: `pnpm --filter @factura-hn/api test:owasp`. En la CI corren dentro de `pnpm test:pg` (trabajo
«Postgres»), porque tardan menos de 2 minutos; no hace falta el flujo nocturno.

## Tabla

| Riesgo | Cómo aplica | Prueba | Resultado |
| --- | --- | --- | --- |
| **API1** Autorización a nivel de objeto | Ids en la ruta: número, emisor, webhook, entrega, prefijo de llave, CAI, serie. Tenant solo de la llave, con RLS. Cajas atadas a su punto de emisión. | `api1-bola.test.ts`: la admin de B usa los ids de A en las 13 operaciones que los reciben y en todas las listas; la misma `Idempotency-Key` en dos tenants; una caja contra otro punto de emisión. | Pasa: 404 `NO_ENCONTRADO` en cada operación, listas sin nada de A, A sin cambios. Límite conocido (DEC-122): una caja lee los documentos de las otras cajas de su tenant; la prueba lo fija. |
| **API2** Autenticación | Llave Bearer con SHA-256 y comparación en tiempo constante, llaves revocadas, tenants inactivos, marca `live`/`test` (DEC-118), límite de intentos. | `api2-autenticacion.test.ts`: las 28 operaciones sin llave; la llave en la consulta, una cookie, Basic u otra cabecera; un 401 que distinga un caso de otro; fuerza bruta sobre un prefijo; 30 prefijos inventados desde un socket que cambia `X-Forwarded-For`, con 0 y con 1 proxy de confianza; la llave en claro en la base. | Pasa: 401 sin cabeceras de la llave; el 401 es idéntico en los 5 casos; 429 `DEMASIADOS_INTENTOS` tras la ráfaga sin dejar fuera al dueño; sin proxies, `X-Forwarded-For` se ignora y la dirección del socket se frena (con 1 proxy, ninguna); solo el hash en la base. |
| **API3** Autorización a nivel de propiedad | Campos que decide el servidor (número, CAI, totales, estado, `modo`, emisor, tenant, secreto) y secretos en la salida. | `api3-propiedades.test.ts`: cuerpos con esos campos de más en emitir, llaves, webhooks, rotación y emisor; buscar secretos (llaves, hashes, `whsec_`, `plano:`) en 10 lecturas con llave admin y de caja. | Pasa: Zod descarta lo que no declara. `modo: "prueba"` no saca una venta del libro y un CAI real con `prueba: true` es 422. Ninguna lectura trae secretos. |
| **API4** Consumo de recursos | Un proceso para todos los tenants. | `api4-consumo.test.ts`: cuerpo por partes de 2 MB sin `Content-Length`; 13 topes de forma (líneas, textos, montos, claves, página, cursor, período); JSON de 150 000 niveles; límite por llave; páginas de documentos grandes y `maxBytesPagina` inválido; lista de eventos repetida. | **Dos fallas, corregidas:** la página de documentos no tenía tope de bytes y la bitácora guardaba la lista de eventos sin quitar repetidos. El resto pasa: 413, 400 o 422, nunca 500. |
| **API5** Autorización a nivel de función | Rol `caja` (emite y consulta) y `admin` (el resto), más opciones de admin dentro de operaciones de caja. | `api5-funciones.test.ts`: una caja en las 18 operaciones de admin; las 10 de caja con caja; la especificación contra el código; subir de rol; el salto de fecha y la nota de crédito sobre un original externo con caja. | Pasa: 403 `SOLO_ADMIN` sin cambios en el tenant. **Una falla de contrato, corregida:** `GET /v1/libro-ventas` devolvía 403 `CAJA_SIN_PUNTO` y no lo declaraba. |
| **API6** Flujos sensibles | Correlativos fiscales, documentos de prueba fuera de los reportes y exportación del período (Arts. 41, 53 y 59). | `api6-flujos.test.ts`: 20 reintentos simultáneos con una clave; la misma clave con otro cuerpo; CAI ficticio en producción y real en prueba; punto sin CAI; anular dos veces; rastro de la exportación. | Pasa: un solo documento; 422 `IDEMPOTENCIA_CONFLICTO`, `CAI_DE_PRUEBA` y `AUTORIZACION_REAL_EN_DEMO`; ningún número se pierde ni se reabre; la exportación queda en la bitácora con la llave y el total. |
| **API7** SSRF | URL de webhook elegida por el cliente. En modo alojado solo https y públicas: se valida al registrar, antes de cada entrega y al conectar. | `api7-ssrf.test.ts`: 26 formas de un destino interno (con uno o dos puntos finales, numéricas, metadatos de nubes, IPv4 en IPv6, otros esquemas); `lookupSeguro` con un resolvedor de prueba (`127.0.0.1`, `::1`, pública más interna, vacío, error); una URL interna guardada en modo local y entregada en alojado; un nombre que el resolvedor lleva a un receptor local; una redirección. | **Una falla, corregida:** `https://localhost./` y `https://x.internal./` pasaban el registro (la conexión ya los frenaba). El resto pasa: 422 `WEBHOOK_URL`, ninguna conexión al receptor interno y redirecciones sin seguir. |
| **API8** Configuración | Cabeceras de seguridad, sin CORS, errores sin detalles, CSP y arranque que falla cerrado. | `api8-configuracion.test.ts`: 16 respuestas de todo tipo; una solicitud previa de CORS desde otro origen; un 500 con una contraseña en el mensaje; `Solicitud-Id`, `X-HTTP-Method-Override` y `X-Operador` manipulados; variables de entorno mal escritas. | Pasa: `nosniff`, `no-store` y `no-referrer` en todas las respuestas; sin `Access-Control-*`, `Server` ni `X-Powered-By`; el 500 solo da su id; `arrancar` no arranca. |
| **API9** Inventario | Una versión (`/v1`), especificación servida y versionada, clientes generados de ella. | `api9-inventario.test.ts`: rutas del servidor contra la especificación; especificación versionada contra la servida; catálogo de pruebas contra la especificación; middleware (`ALL`) contra una lista conocida; seguridad de cada operación; versiones y prefijos alternativos. | Pasa: el servidor atiende exactamente lo publicado más `/openapi.json`, `/docs` y `/`, sin otro `app.all()`; solo `/salud` es pública; `/v0`, `/v2`, `/api/v1`, `/metrics` y similares dan 404. |
| **API10** Consumo de APIs de terceros | Respuestas de los receptores de webhooks y Swagger UI del CDN en `/docs`. | `api10-terceros.test.ts`: un receptor con un cuerpo sin fin, uno malicioso (cuerpo y cabeceras), una conexión cortada, un código raro; los recursos externos de `/docs`. | Pasa: solo se guarda el código (`HTTP 500`, `Error de red`), nunca el cuerpo ni las cabeceras; la entrega no lee el cuerpo. `/docs` tiene versión exacta, SRI y CSP sin comodines. |

Controles que ya tenían su prueba y no se duplicaron: reportes acotados (DEC-059, `reportes-limites.test.ts`),
tope de 20 webhooks y de 5 pruebas pendientes (`webhooks.test.ts`), receptor lento (`webhooks.test.ts`), RLS en la
base con el rol de la aplicación (`rls.test.ts`), límite mensual (`api.test.ts`) y textos con caracteres de
control (DEC-123).

## Hallazgos y correcciones

1. **API4, media. `GET /v1/documentos` sin tope de bytes por página.** `limite` llega a 500 y cada documento puede
   pesar unos 480 KB (500 líneas, el máximo que cabe en un cuerpo de 512 KB). Una sola página podía cargar unos
   240 MB en el proceso que atiende a todos los tenants. Medido con 20 documentos de ese tamaño: 10 MB en una
   respuesta, 218 ms. Con 500 serían 250 MB por solicitud, y una llave de caja puede pedir varias a la vez. Es el
   mismo problema que DEC-059 corrigió en los reportes.
   **Corrección:** la página se corta en la base antes del documento que empieza pasado `MAX_BYTES_PAGINA` (8 MiB,
   configurable con `ConfigApi.maxBytesPagina`). Siempre trae al menos un documento, y los que no entran no salen
   de Postgres. Con corte, `hayMas` es `true` aunque la página traiga menos de `limite`. El cursor no cambia, así
   que se recorre igual. Prueba: «GET /v1/documentos corta la página por bytes…».
2. **API4, baja. Lista de eventos repetida en la bitácora.** `POST /v1/webhooks` guardaba en `api_bitacora`
   la lista de eventos tal como llegaba: hasta 512 KB por alta. La fila del webhook ya la guardaba sin repetidos.
   **Corrección:** la bitácora guarda la lista de la fila. Prueba: «crear un webhook con la misma suscripción
   repetida miles de veces…».
3. **API7, baja. Nombres internos con punto final.** En modo alojado, `problemaDeURL` comparaba el nombre sin
   quitar el punto final del FQDN. `https://localhost./`, `https://x.internal./` y `https://x.local./` pasaban el
   registro. No era explotable, porque `lookupSeguro` resuelve el nombre al conectar y rechaza la dirección
   interna, pero la validación del registro no decía la verdad.
   **Corrección:** se quita el punto final antes de comparar, y un nombre vacío es una URL inválida. Prueba: «cada
   forma de escribir un destino interno se rechaza al validar».
4. **API5/API9, baja (contrato). 403 no declarado.** `GET /v1/libro-ventas` responde 403 `CAJA_SIN_PUNTO` a una
   llave de caja sin punto (DEC-122), pero la especificación no declaraba el 403. **Corrección:** se declara. Se
   regeneraron `openapi.json` y los tipos del cliente. Prueba: «la especificación declara 403 exactamente en las
   operaciones que lo pueden dar».

## Lo que queda como propuesta

Están también en `docs/decisiones.md` (Lote 5, propuestas de OWASP):

- **Representación impresa costosa (API4).** El PDF de un documento de 500 líneas tarda unos 440 ms de CPU en
  el hilo principal. Una caja con 20 solicitudes por segundo puede ocupar el proceso. Propuesta: renderizar en un
  worker o guardar el PDF en caché, que no cambia porque el documento es inmutable (Art. 38).
- **Límite por tenant (API4).** El límite de solicitudes es por llave y una admin puede crear llaves sin tope.
  Propuesta: una cubeta por tenant además de la de cada llave, o un tope de llaves activas como el de los webhooks
  (DEC-058).
- **Lectura de documentos con llave de caja (API1).** Es el límite conocido de DEC-122: una caja lee los documentos
  de las otras cajas de su tenant. Acotarlo al punto puede ser incompatible.
- **Listas sin paginar.** `GET /v1/autorizaciones` y `GET /v1/llaves` devuelven todo (`hayMas: false`). Hoy son
  pocas filas por tenant, y paginarlas es aditivo.
