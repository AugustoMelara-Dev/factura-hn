# @factura-hn/cliente

## 0.3.0

### Minor Changes

- 74a8eea: API REST y cliente: la primera factura en 3 pasos.
  
  - `GET /v1/sesion` (cliente: `fhn.sesion()`): con qué llave hablas (tenant, rol, caja, modo, si es el demo),
    autorizaciones vigentes por punto y tipo, y si ya puedes emitir; si no, `pendientes` con `solucion` y
    `documentacion`.
  - `POST /v1/documentos` y su repetición idempotente traen `enlaces: { pdf, html, txt }`.
  - Los errores frecuentes traen `error.solucion` y `error.documentacion` (enlace a `docs/errores.md`); cada
    elemento de `errores` trae su `documentacion`. `ErrorFacturaHN` expone `solucion`, `documentacion` y `campo`.
  - Los 400 de forma salen en español, con el primer campo en `error.campo`.
  - Límite de solicitudes: el de cada llave cuenta solo solicitudes con su secreto correcto (conocer un prefijo ya
    no deja una llave en 429). Las llaves que el proceso aún no validó tienen un límite por dirección que cuenta
    también las consultas en curso (429 `DEMASIADOS_INTENTOS`, sin consultar la base); los fallos de una llave que
    existe (p. ej. revocada) se cobran a esa llave y no a la dirección, y a lo sumo 4 consultas de llaves nuevas
    van a la base a la vez (las demás esperan en cola). Las IPv6 se agrupan por /64. `X-Forwarded-For` solo se
    usa con `FHN_PROXIES_DE_CONFIANZA`, que también acepta la lista de direcciones de los proxies.
  - Consola del operador en español: `ayuda`, `--help` por comando, errores con código 1 y el nuevo `demo llave`
    (solo en el tenant de demostración). En Docker: `docker compose exec api factura-hn-api …` (`node cli.cjs`
    sigue funcionando); fuera, desde la raíz del repositorio compilado: `node packages/api/dist/cli.js …`. Los
    nombres de tenant `local` y `demo` quedan reservados. Las llaves del demo salen en un bloque destacado con la
    advertencia de CAI ficticio.
  - En modo alojado, la solución de un 401 no nombra comandos ni tenants del operador.
  - `GET /v1/sesion`: `documentosDelMes` (de todo el tenant) solo con una llave admin; `null` con una de caja.
  - `docker-compose.yml`: el puerto publicado se cambia con `FHN_PUERTO`.
- API REST: el mismo modo de prueba que el SDK, y los documentos de prueba fuera de los reportes fiscales.
  
  - La API usa `factura-hn/demo`: el mismo emisor ficticio, el mismo CAI ficticio (`DEMO00-NO-VALIDO-…`,
    compatible con los ya emitidos) y la misma leyenda. Las autorizaciones demo que registra llevan `prueba: true`.
  - La exportación (`/v1/exportacion`, CSV, TXT y JSONL) y el libro de ventas (`/v1/libro-ventas`, JSON y CSV)
    dejan fuera los documentos de prueba. El tope de documentos, el total del encabezado TXT y la bitácora cuentan
    solo los reales. La cabecera `Documentos-Prueba-Excluidos` dice cuántos quedaron fuera; el libro JSON trae
    además `excluidos` y, si hay, un `aviso`. En un tenant de prueba, todo de prueba, los archivos salen vacíos.
  - `POST /v1/autorizaciones` acepta `prueba`. Qué CAI acepta cada tenant lo dice el cambio de los tenants de
    prueba y de producción (`AUTORIZACION_REAL_EN_DEMO` y `CAI_DE_PRUEBA`).
    `GET /v1/series/{id}/no-utilizados` no lista las autorizaciones de prueba y lo dice en `aviso`.
  - Límite de intentos más estricto con la memoria y más justo con las cajas que comparten dirección: cola de
    validación acotada (256, 5 s), 429 por dirección solo con la cola en uso, memoria de 15 s para prefijos sin llave
    activa. El servidor no arranca si la base tiene un esquema de la API anterior al del código, y avisa en modo
    alojado sin `FHN_PROXIES_DE_CONFIANZA`.
  - OpenAPI: el esquema `Problema` declara `solucion` y `documentacion`; `DocumentoFiscal` declara `modo` y
    `equivalenteLempiras`; `Autorizacion` declara `prueba`. En `@factura-hn/cliente`, `Problema` trae esos campos,
    `ProblemaConGuia` queda como alias y `libroVentas` devuelve `excluidos` y `aviso`.
  
  **Cambios incompatibles:**
  
  - `EstadoAutorizacion` (respuesta de `GET /v1/autorizaciones`) trae el campo obligatorio `retirada`: `true` en una
    autorización de prueba de un punto que ya tiene una real. Un objeto `EstadoAutorizacion` armado a mano (por
    ejemplo, en un doble de pruebas) debe incluirlo.
  - La exportación y el libro de ventas dejan fuera los documentos de prueba (ver arriba): quien los sumaba verá
    totales menores.
- cc2bbd0: API REST: el contrato de la especificación OpenAPI.
  
  - Cada operación tiene un `operationId` estable en español (`emitirDocumento`, `listarDocumentos`,
    `anularDocumento`…). Los clientes generados en otros lenguajes toman de ahí sus nombres. Los tipos de
    `@factura-hn/cliente` se regeneraron; el cliente se comporta igual.
  - Cada operación declara solo los estados que puede devolver: el 422 ya no aparece en los `GET` (salvo
    `libro-ventas` y `exportacion`), y se documentan el 413 (cuerpo de más de 512 KB) y el 500.
  - Todas las respuestas traen `Solicitud-Id` (el del cliente si manda uno válido; si no, uno generado) y
    `FacturaHN-Version`. Los errores traen el mismo id en `error.solicitud`, y el log de un 500 también.
  - Las respuestas autenticadas traen `RateLimit-Policy` y `RateLimit` (borrador IETF). El 429 `LIMITE_MENSUAL`
    trae `Retry-After` hasta el primer día del mes siguiente (00:00 en Honduras).
  - Un cuerpo que no es JSON es 400 `JSON_INVALIDO` con la forma de error de la API (antes, texto plano).
  - La especificación pasa el linter de Redocly en la CI (`pnpm lint:openapi`).
  
  **Cambios incompatibles:**
  
  - Tipos de `@factura-hn/cliente`: las respuestas de error de los `GET` (salvo `/v1/libro-ventas` y
    `/v1/exportacion`) ya no incluyen el 422. Quien usa `fhn.api.GET(...)` y compara `response.status === 422` o
    lee el cuerpo de un 422 en esas rutas tiene ahora un error de tipos: la API nunca lo devolvía ahí. Los métodos
    del cliente (`fhn.documento`, `fhn.documentos`…) no cambian.
- cc2bbd0: Tenants de prueba y de producción en la API, con llaves `fhn_test_` y `fhn_live_`.
  
  - API: cada tenant tiene un modo, `prueba` o `produccion`. Las llaves nuevas llevan su marca (`fhn_test_…` o
    `fhn_live_…`); las `fhn_<prefijo>_…` de antes siguen valiendo en su tenant. Una llave `fhn_test_` no entra a un
    tenant de producción, ni una `fhn_live_` a uno de prueba (401). Al migrar, los tenants que ya existían quedan en
    producción y el `demo` de demostración, en prueba.
  - API: `GET /v1/sesion` trae `modoTenant` y cada respuesta autenticada lleva la cabecera `FacturaHN-Modo`.
    `@factura-hn/cliente` tipa `modoTenant`.
  - API: un tenant de prueba solo registra CAI ficticios (`AUTORIZACION_REAL_EN_DEMO`) y uno de producción no
    acepta ninguno, ni con `"prueba": true` (`CAI_DE_PRUEBA`; ya no se devuelve `AUTORIZACION_DEMO_SIN_PRUEBA`).
  - API: `GET /v1/libro-ventas` con una llave de caja devuelve solo el libro de su punto de emisión.
  - Consola: `tenant crear --modo produccion|prueba`; `llave crear` y `demo llave` crean la llave con la marca del
    modo de su tenant.
- cc2bbd0: Webhooks robustos en la API REST y el cliente.
  
  - `verificarFirmaWebhook` acepta varias firmas `v1` en `X-FacturaHN-Firma`: la entrega es válida si alguna
    verifica con tu secreto, y las entradas desconocidas (`v0=`, `v2=`…) se ignoran. Actualiza el receptor antes de
    rotar el secreto.
  - Reintentos durante unos 3 días (antes, unas 14 h y media): hasta 22 intentos, con espera creciente hasta 6 h y
    una fluctuación de ±20 %. Al agotarse, la entrega queda `FALLIDA` y se puede reenviar.
  - Rutas nuevas, solo con llave admin: `GET /v1/webhooks/{id}/entregas` (paginada), `POST
    /v1/webhooks/{id}/entregas/{entrega}/reenviar`, `POST /v1/webhooks/{id}/probar` (evento `webhook.prueba`) y
    `POST /v1/webhooks/{id}/rotar-secreto` (secreto nuevo con gracia de 24 h por defecto: durante la gracia, cada
    entrega lleva dos `v1`). Los webhooks traen `graciaHasta`. Una prueba se intenta a lo sumo 3 veces y cada webhook tiene a lo sumo 5
    pendientes. Errores nuevos: 409 `WEBHOOK_INACTIVO`, 409 `ENTREGA_VENCIDA` y 409 `LIMITE_PRUEBAS`.
  - `AvisoWebhook.evento` incluye `webhook.prueba`.
  - Esquema de la API v8: migra antes de arrancar esta versión.

### Patch Changes

- 74a8eea: Documentación publicada: los README de `@factura-hn/pdf`, `@factura-hn/postgres`, `@factura-hn/sqlite` y
  `@factura-hn/cliente` enlazan con URL absolutas (los enlaces relativos no existen en npm ni en `node_modules`).
  El ejemplo del cliente crea una clave de idempotencia por venta en lugar de fijarla. La skill
  `facturacion-sar-hn` manda leer, en el camino de la API, el `AGENTS.md` y `docs/api.md` que trae
  `@factura-hn/cliente`, nombra `GRAVADO0` y `renderizarPDF`, y pide tomar el número de la respuesta.
  `verificar-dist` falla si un `.md` publicado enlaza a algo que no viaja en su paquete, y `pnpm humo` instala los
  tarballs en un proyecto vacío y corre el ejemplo mínimo del README.
- 39072d8: Revisión OWASP API Security Top 10 (2023) de la API REST.
  
  - Los tipos del cliente declaran el 403 `CAJA_SIN_PUNTO` de `GET /v1/libro-ventas` (una llave de caja sin punto de
    emisión), que la API ya devolvía.
  - `GET /v1/documentos` corta cada página en unos 8 MiB de documentos: puede traer menos de `limite` con
    `hayMas: true`. `fhn.documentos` ya sigue el cursor mientras `hayMas`; si recorres las páginas a mano, haz lo mismo.
  - En modo alojado, una URL de webhook con nombre interno y punto final (`https://localhost./`) se rechaza al
    registrarla (antes se frenaba recién al conectar).
- 39072d8: API REST: el contrato OpenAPI se valida en cada respuesta de las pruebas, y el fuzzing de la API.
  
  - Un cuerpo sin `Content-Type: application/json` es 415 `TIPO_DE_CONTENIDO` con la forma de error de la API (antes,
    texto plano y sin declarar). Cada operación con cuerpo declara el 415.
  - `/openapi.json` declara lo que la API ya enviaba: `Idempotency-Replayed` en el 201 de `emitirDocumento`, los tres
    tipos de archivo de `exportarPeriodo` (`application/x-ndjson`, `text/csv`, `text/plain`), el 403 de
    `obtenerLibroVentas` y `FacturaHN-Modo` en los 429 de `/v1`. Los tipos de `@factura-hn/cliente` se regeneraron.
  - Una fecha de período que no existe (`2026-02-30`) es 400 `SOLICITUD_INVALIDA` (antes, 500), y un CAI con un
    carácter NUL en la ruta es 404 (antes, 500).
  - Un carácter de control (p. ej. U+0000) en el nombre de una llave o en la URL de un webhook es 400
    `SOLICITUD_INVALIDA` (antes, 500). `Solicitud-Id`, `FacturaHN-Version` y el `Retry-After` de los 429 se declaran
    obligatorias en `/openapi.json`.
  - Un total por encima del tope técnico, también el total en lempiras de un documento en dólares, es 422 `MONTO_FUERA_DE_RANGO` y no consume número (antes, 500).
- 39072d8: Resiliencia de la API REST, medida con carga y con PostgreSQL reiniciándose en medio de la emisión.
  
  - Con la base reiniciándose, caída o sin conexiones libres, la API responde 503 `BASE_NO_DISPONIBLE` con
    `Retry-After` (antes, 500 `ERROR_INTERNO`). Reintenta con la misma `Idempotency-Key`: si el documento alcanzó a
    emitirse recibes el mismo, y si no, se emite una sola vez. El cliente lo entrega como `ErrorFacturaHN` con
    `estado: 503`; los tipos generados incluyen el 503 en cada operación.
  - Los avisos de webhook acumulados (por ejemplo, mientras el receptor estaba caído) salen en una sola pasada del
    despacho, al ritmo del receptor; antes salían de a 20 cada 5 s por negocio.
  - `fechaHonduras` y `horaHonduras` reusan su formateador: la emisión gasta menos CPU.
- Revisión final de la API y del servidor MCP.
  
  - **MCP:** `anular_documento` y `registrar_cai` piden la confirmación del usuario por elicitación MCP, con el número y
    el motivo, o los datos del CAI, exactos. Si el usuario no confirma, responden `CONFIRMACION_RECHAZADA` y no hacen
    nada. Con un cliente que no ofrece elicitación se niegan (`CONFIRMACION_NO_DISPONIBLE`), salvo con
    `FHN_MCP_PERMITIR_DESTRUCTIVAS=1` o sobre datos de prueba (documento de prueba, CAI ficticio).
  - **MCP:** un argumento con forma inválida (p. ej. sin `idempotencyKey`) responde `SOLICITUD_INVALIDA` en español,
    con el campo, qué hacer y la guía, en vez del texto de Zod en inglés.
  - **MCP:** con Node anterior a 22.13, `init`, `registrar-cai` y el modo SQLite se niegan con «Necesitas Node 22.13 o
    más reciente (tienes …)». Los avisos de `consultar_documento` (formato resumen) van dentro de `<datos_documento>`.
  - **Cliente:** los tipos declaran el 403 en todas las operaciones de `/v1` (`TENANT_FUERA_DEL_MODO_LOCAL`: el servidor
    en modo local no atiende llaves de otro tenant).
  - **API:** toda respuesta JSON lleva `charset=utf-8` (Windows PowerShell 5.1 lee bien los acentos); sin
    `Idempotency-Key`, el error es `IDEMPOTENCY_KEY` con su solución; cupo de reportes por llave; un secreto de webhook
    que no se descifra falla solo su entrega; los webhooks de un tenant inactivo esperan (esquema v9); `tenant crear`
    se niega en modo local.
- Lo que viaja en cada paquete de npm:
  
  - Cada paquete trae su `CHANGELOG.md` y exporta `./package.json` (`require('factura-hn/package.json')`).
  - `factura-hn/demo` y `factura-hn/pruebas` tienen tipos también con `moduleResolution: node10` (`typesVersions`);
    antes, TypeScript daba TS2307 al importarlos.
  - El ejecutable `npx factura-hn` usa el núcleo del mismo paquete en lugar de llevar otra copia (de 108 KB a 8 KB).
  - `@factura-hn/mcp` acepta cualquier versión de parche de `factura-hn`, `@factura-hn/sqlite` y `@factura-hn/cliente`
    dentro de su versión menor (`^`), en lugar de una exacta: npm no instala dos copias del núcleo si ya tienes otra
    0.x.y. Sus tipos usan los de Node (`@types/node`, dependencia par opcional).

## 0.2.0 y anteriores

La historia hasta la 0.2.0 está en el [CHANGELOG del repositorio](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CHANGELOG.md).
