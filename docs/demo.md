# Demostración pública y MCP remoto

Esta guía es para quien opera una demostración pública de factura-hn: una API con `FHN_MODO=demo` y, aparte, el
MCP remoto (`factura-hn-mcp http`). Cualquiera crea ahí su propio entorno de prueba, sin cuenta, y lo usa desde
curl, el SDK o su asistente de IA. Para conectar un asistente a un entorno ya creado, ver la guía del sitio
[MCP remoto](https://augustomelara-dev.github.io/factura-hn/ia/mcp-remoto/).

Nada de esto sirve para facturar de verdad: cada entorno tiene emisor y CAI ficticios, y todo lo que emite lleva
la leyenda **DOCUMENTO DE PRUEBA — SIN VALOR FISCAL**.

## Qué recibe cada visitante

`POST /v1/demo/entornos`, sin llave y sin cuerpo, crea un entorno y responde 201 con:

- `llave`: una llave `fhn_test_…` admin del entorno (se muestra una sola vez; la base guarda solo su hash);
- `api.url`: la URL de la API a la que llamar con esa llave (`FHN_DEMO_URL_API`, o la de la solicitud);
- `mcp.url`: la URL personal del MCP remoto, `https://…/mcp/fhnmcp_test_…` (si `FHN_DEMO_URL_MCP` está definida);
- `entorno`: id, creación, vencimiento, límites, emisor ficticio y punto de emisión `000-001`;
- `ejemplos`: los mismos pasos listos para copiar con curl, con el SDK (`@factura-hn/cliente`) y en un asistente.

Cada entorno es un tenant de prueba propio, aislado de los demás por las políticas de fila de Postgres (igual que
los negocios del modo alojado). Trae CAI ficticios `DEMO00-NO-VALIDO-…` para factura (01), nota de crédito (06) y
nota de débito (07). Un CAI real no se puede registrar en él: un tenant de prueba solo acepta CAI ficticios
(`AUTORIZACION_PRUEBA_CAI_REAL`).

A las 24 horas (`FHN_DEMO_HORAS`) la llave deja de servir (401 `ENTORNO_VENCIDO`) y, en el minuto siguiente, el
entorno se borra con todos sus datos: documentos, series, autorizaciones, llaves, bitácora y uso.

## Probar el modo demo en tu equipo

Sin Docker ni cuentas, desde un clon del repositorio (Node 22.13 o más reciente) y con un PostgreSQL al que llegues.
Cada proceso tiene su variable de puerto: la API, `PUERTO` (8787); el MCP remoto, `FHN_MCP_PUERTO` o `PORT`
(8788). `FHN_PUERTO` es otra cosa: el puerto que publica Docker Compose. Las dos escuchan por defecto en todas las
interfaces (`FHN_HOST` y `FHN_MCP_HOST` valen `0.0.0.0`, para un contenedor): en tu equipo, `127.0.0.1`.

```bash
pnpm install && pnpm build
createdb factura_hn_demo      # una base vacía, solo para esto (con Docker: docker compose exec db createdb -U postgres factura_hn_demo)

# 1. La API en modo demo (en una terminal)
DATABASE_URL=postgres://postgres@127.0.0.1:5432/factura_hn_demo FHN_MODO=demo FHN_PROXIES_DE_CONFIANZA=0   FHN_DEMO_URL_MCP=http://127.0.0.1:8788/mcp FHN_HOST=127.0.0.1 PUERTO=8787 node packages/api/dist/servidor.js

# 2. El MCP remoto (en otra)
FHN_API_URL=http://127.0.0.1:8787 FHN_MCP_HOST=127.0.0.1 node packages/mcp/dist/cli.js http

# 3. Un entorno de prueba: guarda la llave y mcp.url de la respuesta
curl -s -X POST http://127.0.0.1:8787/v1/demo/entornos

# 4. Las herramientas, por el MCP, con el MCP Inspector en modo línea de comandos
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8788/mcp/fhnmcp_test_… --transport http --method tools/list
```

Lo que avisa el log de la API es lo esperado aquí: sin `FHN_MIGRAR_URL` corre como dueño de las tablas, y sin
`FHN_DEMO_SECRETO` genera una clave al arrancar. `FHN_PROXIES_DE_CONFIANZA=0` le dice que los clientes llegan
directo (sin eso no arranca, ver «Arranque seguro»). Con `FHN_DEMO_URL_API` sin definir, los ejemplos usan la URL
de la solicitud.

Para llamar una herramienta directamente (`--method tools/call --tool-name emitir_factura --tool-arg …`), sin un
asistente de por medio, `emitir_factura`, `emitir_nota_credito` y `anular_documento` piden `idempotencyKey`: una
clave de 8 caracteres o más, la misma si repites la llamada por la misma venta (así no se emite dos veces). Un
asistente la genera solo.

La consola, sin Docker: `node packages/api/dist/cli.js demo estado` (y `demo limpiar`, `demo pausar`,
`demo reanudar`), con la misma `DATABASE_URL`. En esta guía aparece como `factura-hn-api`, que es como se llama
dentro de la imagen de Docker y en el paquete.

## Qué no hay en la demostración

- **Webhooks:** la demostración no hace ninguna solicitud saliente. `/v1/webhooks` responde 403
  `DEMO_NO_DISPONIBLE` y el despachador de webhooks no corre.
- **Cambiar el emisor** (`POST` y `PATCH /v1/emisores`) ni **crear llaves** (`POST /v1/llaves`). Revocar una sí:
  `DELETE /v1/llaves/{prefijo}` con el prefijo de `mcp.url` apaga la URL del MCP sin tocar la llave del visitante.
- **Tenants que no sean entornos de prueba:** una llave de otro tenant recibe 403 `DEMO_SOLO_PRUEBA`.

## Arranque seguro

Con `FHN_MODO=demo` la API **no arranca** si:

- la base tiene filas de cualquier tenant que no sea un entorno de la demostración (en cualquier tabla: documentos,
  autorizaciones, series, bitácoras, emisores, llaves…, aunque no tenga llaves), un tenant de producción, o algún CAI
  real en autorizaciones o documentos. La revisión falla cerrada: la base de la demostración debe ser solo suya,
  nunca la de un negocio. La hace el dueño de las tablas en una transacción que se revierte al final;
- `FHN_DEMO=1` está definida (es la demostración del modo local, otra cosa);
- no se dijo cómo saber la dirección de cada visitante: hay que definir `FHN_PROXIES_DE_CONFIANZA` o
  `FHN_IP_CLIENTE_CABECERA` con un valor (vacías cuentan como no definidas; ver más abajo);
- alguna variable `FHN_DEMO_*` tiene un valor fuera de su rango.

## Variables de la API (`FHN_MODO=demo`)

Además de las de [autoalojamiento](autoalojamiento.md#variables-de-entorno). Los valores por defecto son estrictos a
propósito: con un proveedor que cobra el tráfico por GB y no tiene tope de gasto, conviene empezar bajo y subir.

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `FHN_DEMO_HORAS` | `24` | Horas que dura un entorno (1 a 72) |
| `FHN_DEMO_ENTORNOS_POR_IP` | `3` | Entornos que una dirección (IPv6: su /64) crea en 24 horas |
| `FHN_DEMO_MAX_ENTORNOS` | `200` | Entornos vigentes a la vez en todo el servicio |
| `FHN_DEMO_CREACIONES_POR_MINUTO` | `10` | Entornos nuevos por minuto en todo el servicio |
| `FHN_DEMO_DOCUMENTOS` | `50` | Documentos que emite un entorno (429 `DEMO_LIMITE_DOCUMENTOS`) |
| `FHN_DEMO_SOLICITUDES_POR_MINUTO` | `30` | Solicitudes por minuto de un entorno (su llave y su MCP juntos) |
| `FHN_DEMO_SOLICITUDES_POR_ENTORNO` | `1500` | Solicitudes en toda la vida de un entorno (429 `DEMO_LIMITE_SOLICITUDES`) |
| `FHN_DEMO_SOLICITUDES_POR_MINUTO_GLOBAL` | `300` | Solicitudes por minuto de todos los entornos juntos |
| `FHN_DEMO_MAX_CUERPO` | `32768` | Bytes de un cuerpo de solicitud (413 `CUERPO_DEMASIADO_GRANDE`) |
| `FHN_DEMO_MAX_BYTES_PAGINA` | `262144` | Bytes de documentos en una página de `GET /v1/documentos` |
| `FHN_DEMO_PAUSADO` | — | `1`: arranca en pausa (ver «Interruptor global») |
| `FHN_DEMO_URL_API` | la de la solicitud | URL pública de la API, para los ejemplos. HTTPS salvo `localhost` |
| `FHN_DEMO_URL_MCP` | — | URL pública del MCP remoto sin el token, p. ej. `https://mcp.ejemplo.example/mcp`. Sin ella, la respuesta no trae `mcp` ni se crea su llave |
| `FHN_DEMO_ORIGENES` | `https://augustomelara-dev.github.io` | Orígenes del navegador que pueden llamar a `POST /v1/demo/entornos` (CORS), separados por comas. Sin `*` ni rutas |
| `FHN_DEMO_SECRETO` | aleatorio | Clave (32 caracteres o más) de la huella de la dirección que se guarda para el cupo por dirección. Sin ella, se genera una al arrancar (con aviso) y el cupo por dirección se reinicia en cada arranque |
| `FHN_IP_CLIENTE_CABECERA` | — | Cabecera con la dirección del cliente que pone el proxy de confianza, p. ej. `Fly-Client-IP`. Nunca se cree por defecto |

La base no guarda la dirección de nadie: solo una huella (HMAC-SHA256 con `FHN_DEMO_SECRETO`) para contar los
entornos por dirección, y se borra con el entorno.

### Respuestas a los límites

Todos los límites responden con el mismo cuerpo de error de la API, `{ "error": { "codigo", "mensaje" } }`, y los
429 y 503 traen `Retry-After` (segundos). Ver los códigos en [errores](errores.md#api-rest-demostración-pública).

### CORS

Solo `POST /v1/demo/entornos` (y su `OPTIONS`) tiene CORS, y solo para los orígenes de `FHN_DEMO_ORIGENES`:
`Access-Control-Allow-Origin` con ese origen (nunca `*`), sin `Access-Control-Allow-Credentials`, y
`Access-Control-Expose-Headers: Retry-After, RateLimit, RateLimit-Policy`. También en los 429 y 503, para que la
página sepa cuánto esperar. La página debe llamar con `fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit' })`.
El resto de la API no tiene CORS: la llave no debe vivir en una página.

Un `POST` sin cuerpo es una solicitud «simple» que el navegador manda sin preguntar, así que CORS solo no basta: una
página de otro sitio podría crear entornos con la dirección de cada visitante suyo y gastar su cupo. Por eso una
solicitud con `Origin` que no está en `FHN_DEMO_ORIGENES` recibe 403 `ORIGEN_NO_PERMITIDO`. Sin `Origin` (curl,
el SDK, un servidor) se atiende.

## Limpieza a las 24 horas

La API borra los entornos vencidos al arrancar y luego cada minuto. El mismo paso está en la consola, para una tarea
programada aparte (por ejemplo, una máquina programada del proveedor):

```bash
factura-hn-api demo limpiar     # borra ya los entornos vencidos
factura-hn-api demo estado      # vigentes, vencidos por borrar y si está en pausa
```

El borrado lo hace una función de la base con permisos de su dueño (`fhn_api_purgar_demo`), en transacciones de
50 entornos. Nunca usa una hora posterior al reloj de la base: quien la llame no puede vencer antes un entorno
vigente. La retención general (`FHN_RETENCION_DIAS`, mínimo 7 días) no cambia. Los documentos de un negocio siguen
siendo imborrables: la base solo deja borrar, y solo dentro de esa función, filas de un tenant de prueba cuyo CAI es
ficticio (`DEMO00-NO-VALIDO-…`). Si un entorno tuviera un CAI real (no puede: la base lo rechaza al registrarlo),
no se borra, queda un aviso (`WARNING`) en el log de Postgres y los demás se borran igual.

## Interruptor global

```bash
factura-hn-api demo pausar --motivo "abuso desde varias direcciones"
factura-hn-api demo reanudar
```

En pausa no se crean entornos y los que hay reciben 503 `DEMO_PAUSADO` (con `Retry-After: 600`), también por el MCP
remoto. La API lo nota en a lo sumo 5 segundos, sin reiniciar. `FHN_DEMO_PAUSADO=1` hace que arranque en pausa, y
entonces `demo reanudar` no la quita: hay que quitar la variable.

## Una sola réplica

Los límites por minuto, por dirección y por sesión viven en la memoria de cada proceso. Con una sola réplica de la
API y una del MCP remoto son exactos. Los límites de cada entorno se revisan antes que el global: un entorno que se
pasa de los suyos recibe 429 sin gastar el cupo de todos. Igual con los entornos nuevos: el cupo global por minuto
solo se gasta cuando un entorno se crea, no cuando la base lo niega porque la dirección ya usó el suyo. Con dos o más, cada una cuenta por su lado y los límites se multiplican por
el número de réplicas. Los cupos que más importan (entornos por dirección, entornos vigentes y documentos por
entorno) sí están en la base y valen para todas.

## MCP remoto

`factura-hn-mcp http` sirve el mismo servidor MCP que por stdio (las mismas herramientas, los mismos errores en
español y la misma confirmación antes de anular o registrar un CAI) por el transporte Streamable HTTP. Corre como
**su propio proceso** y llama a la API por HTTP con la llave de cada conexión: no tiene credenciales de la base ni
de nadie, y la API sigue siendo el único lugar donde se aplican el aislamiento, los límites y las reglas fiscales.

Rutas:

- `POST|GET|DELETE /mcp/<token>`: la URL personal que da `POST /v1/demo/entornos`. Es la que se pega en Claude o
  ChatGPT.
- `POST|GET|DELETE /mcp` con `Authorization: Bearer <llave fhn_… o token fhnmcp_…>`: para clientes que mandan
  cabeceras (MCP Inspector, un agente propio). `FHN_MCP_SOLO_URL=1` la quita.
- `GET /salud`: `{ ok, version }`, sin datos de nadie ni cifras de uso.

Cada solicitud lleva un solo mensaje JSON-RPC: un arreglo de mensajes recibe 400 (la versión 2025-06-18 del protocolo
ya no los admite, y multiplicaría una solicitud sin pasar por los límites).

El token (`fhnmcp_test_<prefijo>_<secreto>`) no es la llave del visitante: el MCP deriva de él otra llave
(`fhn_test_<prefijo>_…`, con HMAC-SHA256) y la API guarda solo el hash de esa llave. Así, la URL se puede revocar
sola (`DELETE /v1/llaves/{prefijo}`) y la base no puede reconstruir el token.

Cada sesión MCP queda atada a la llave con que se abrió: un `Mcp-Session-Id` de otra URL o de otra llave recibe
404, igual que una sesión inexistente, y el cliente abre otra. Al abrir una sesión, el MCP comprueba la llave con
`GET /v1/sesion`: un token que la API no acepta recibe 401 de inmediato. Una dirección que manda muchos tokens
rechazados (`FHN_MCP_RECHAZOS_POR_MINUTO_IP`) recibe 429 sin que el MCP le pregunte a la API.

Las sesiones tienen cupo por llave, por tenant (un entorno, con su llave y la del MCP) y por dirección del cliente:
al abrir una más, se cierra la más vieja de esa misma llave, tenant o dirección, nunca la de otro visitante. Así un
visitante no llena el cupo global.

En cada solicitud a la API, el MCP manda la dirección del cliente en `X-Forwarded-For`. La API la cree solo si tiene
la dirección privada del MCP en `FHN_PROXIES_DE_CONFIANZA` (como dirección o como rango CIDR, ver Fly.io más abajo): así los
intentos con llaves no válidas cuentan por visitante, y una ráfaga de tokens falsos de uno no deja sin sesión a los
demás. Sin eso, todo lo que llega del MCP cuenta como una sola dirección.

### Variables del MCP remoto

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `FHN_API_URL` | — | URL de la API (obligatoria). Mejor por la red privada del proveedor que por internet |
| `FHN_MCP_PUERTO` / `PORT` | `8788` | Puerto |
| `FHN_MCP_HOST` | `0.0.0.0` | Interfaz |
| `FHN_ESTABLECIMIENTO`, `FHN_PUNTO` | `000`, `001` | Dónde emite cada sesión (el punto de los entornos de prueba) |
| `FHN_MCP_ORIGENES` | `https://claude.ai,https://claude.com,https://chatgpt.com,https://chat.openai.com` | Si la solicitud trae `Origin`, solo estos (403 si no). Protege contra DNS rebinding |
| `FHN_MCP_MAX_SESIONES` | `100` | Sesiones abiertas a la vez (503 con `Retry-After` más allá) |
| `FHN_MCP_SESIONES_POR_LLAVE` | `3` | Sesiones a la vez por llave; abrir otra cierra la más vieja |
| `FHN_MCP_SESIONES_POR_TENANT` | `3` | Sesiones a la vez por tenant (todas sus llaves); abrir otra cierra la más vieja de ese tenant |
| `FHN_MCP_SESIONES_POR_IP` | `6` | Sesiones a la vez por dirección del cliente; abrir otra cierra la más vieja de esa dirección |
| `FHN_MCP_RECHAZOS_POR_MINUTO_IP` | `10` | Llaves o tokens que la API rechazó, por minuto por dirección; más allá, 429 |
| `FHN_MCP_MAX_BYTES_EVENTOS_SESION` | `1048576` | Bytes de eventos guardados para reconexión, por sesión |
| `FHN_MCP_MAX_BYTES_EVENTOS` | `67108864` | Bytes de eventos guardados para reconexión, en todo el proceso |
| `FHN_MCP_SESION_INACTIVA_MIN` | `15` | Minutos sin solicitudes tras los que una sesión se cierra |
| `FHN_MCP_SOLICITUDES_POR_MINUTO_IP` | `60` | Solicitudes por minuto por dirección (429 con `Retry-After`) |
| `FHN_MCP_SOLICITUDES_POR_MINUTO` | `60` | Solicitudes por minuto por llave (la API tiene además las suyas) |
| `FHN_MCP_MAX_CUERPO` | `65536` | Bytes de un cuerpo (413) |
| `FHN_MCP_MAX_RESULTADO` | `65536` | Caracteres del resultado de una herramienta; más largo, se recorta con un aviso |
| `FHN_MCP_SOLO_URL` | — | `1`: solo la URL personal, sin `Authorization: Bearer` |
| `FHN_PROXIES_DE_CONFIANZA`, `FHN_IP_CLIENTE_CABECERA` | `0`, — | Igual que en la API |

Los flujos SSE llevan un latido cada 15 segundos, por debajo del corte por inactividad de los proxies. Un cliente
que pierde la conexión vuelve a pedir el flujo con `Last-Event-ID` y recibe lo que se perdió (los últimos 200
eventos de su sesión, hasta 1 MiB, en memoria; 64 MiB entre todas). Si la sesión ya no existe (reinicio,
inactividad), recibe 404 y abre otra. Las cabeceras de una solicitud deben llegar en 20 segundos y el cuerpo, en 30:
un cliente lento no retiene la conexión (las respuestas largas, como los flujos SSE, no tienen ese corte).

**Memoria.** Con los valores por defecto (100 sesiones, 64 MiB de eventos), el MCP remoto cabe en una máquina de
512 MB. Si subes `FHN_MCP_MAX_SESIONES` o los topes de eventos, sube la memoria en proporción.

### Por qué URL con token y no OAuth

Un conector personalizado de Claude se agrega con una URL y, opcionalmente, OAuth; ChatGPT acepta «sin
autenticación» u OAuth. Con OAuth, el visitante tendría que pasar por una pantalla de autorización de factura-hn en
cada cliente, y la demostración tendría que operar un servidor de autorización (registro de clientes, códigos,
renovación de tokens). Para un entorno de prueba que dura 24 horas y no tiene datos reales, una URL personal con un
secreto de 256 bits es más simple y funciona igual en web y en el móvil. Riesgos y cómo se acotan:

- la URL es la credencial: quien la tenga usa ese entorno de prueba hasta que vence. No tiene datos reales ni sirve
  para otro entorno; se revoca con `DELETE /v1/llaves/{prefijo}`;
- puede quedar en logs de proxies: el MCP no la escribe en su log, y conviene que el proveedor no registre rutas
  completas;
- un negocio real no debe usar este modo: para producción, el MCP local por stdio o `Authorization: Bearer` con una
  llave de caja.

## En Fly.io con Supabase

La lista de pasos para desplegarla (aplicaciones, secretos, orden, comprobación, vigilancia y costo) está en
[despliegue-demo.md](despliegue-demo.md), con `fly.api.toml`, `fly.mcp.toml` y `Dockerfile.mcp` en la raíz del
repositorio. Lo esencial:

- **Dos aplicaciones de una sola máquina cada una**, siempre encendidas, en la misma región que la base: la API
  (`FHN_MODO=demo`) y el MCP remoto (`factura-hn-mcp http`). El MCP llama a la API por la red privada
  (`FHN_API_URL=http://<app-api>.internal:8787`), que es solo IPv6: la API escucha en `::` (`FHN_HOST`). No por
  Flycast: ahí la solicitud pasa por el proxy de Fly, que pondría su propio `Fly-Client-IP` con la dirección del MCP.
- **Dirección del cliente.** El proxy de Fly pone la dirección del cliente en `Fly-Client-IP`. En el MCP:
  `FHN_IP_CLIENTE_CABECERA=Fly-Client-IP` y `FHN_PROXIES_DE_CONFIANZA=0`. En la API:
  `FHN_IP_CLIENTE_CABECERA=Fly-Client-IP` y `FHN_PROXIES_DE_CONFIANZA=<red privada de la organización>/48` (por
  ejemplo `fdaa:0:1a2b::/48`, los tres primeros grupos de `fly ips private`). Un rango y no la dirección de la
  máquina del MCP, porque esa cambia cuando la máquina se recrea. Así las solicitudes públicas cuentan por
  `Fly-Client-IP` y las del MCP, por el `X-Forwarded-For` que pone el MCP. Ojo: dentro de la red privada,
  cualquier máquina de la organización puede poner esas cabeceras; usa una organización sin otras aplicaciones.
- **Base, sin credenciales de dueño en el servidor.** La API en Fly solo tiene `DATABASE_URL` con su rol
  (`fhn_api`) y arranca con `FHN_MIGRAR_AL_ARRANCAR=0`: no migra, exige que el esquema esté al día y que su rol no
  sea dueño de las tablas, superusuario ni `BYPASSRLS`. La migración (`factura-hn-api migrar`, con `FHN_MODO=demo`
  y `FHN_MIGRAR_URL` con el usuario `postgres` de Supabase) corre fuera de Fly, antes de cada despliegue: desde el
  equipo de quien la administra o desde un entorno protegido de GitHub. Con `FHN_MODO=demo`, `migrar` también se
  niega si la base tiene datos que no son de la demostración. El usuario `postgres` de Supabase puede crear roles
  pero no es superusuario ni salta las políticas de fila: alcanza (las pruebas cubren un dueño así: migración,
  revisión de la base, entornos y limpieza). La API usa la conexión directa (IPv6) o el pooler en modo sesión; el
  modo transacción también funciona porque todo lo que la API fija en la conexión (`SET LOCAL ROLE`,
  `set_config(…, true)`) vale solo para su transacción. Node no conoce la autoridad del certificado de Supabase:
  `sslmode=verify-full&sslrootcert=…` con el certificado del proyecto, nunca `no-verify`. El MCP remoto no tiene
  `DATABASE_URL`.
- **API de datos de Supabase.** Supabase publica por HTTP (PostgREST) los esquemas que se le indiquen, con los roles
  `anon`, `authenticated` y `service_role`, y la llave `anon` es pública por diseño. Desactiva la API de datos, o
  quita de «Exposed schemas» el esquema de factura-hn (`public`, si no le diste otro). Además, cada migración les
  quita a esos roles todo permiso sobre las tablas, secuencias y funciones de factura-hn, aunque los privilegios por
  defecto de Supabase se los den; las tablas sin políticas de fila (el interruptor global, las migraciones) quedarían
  si no modificables desde internet.
- **Gasto.** El tráfico saliente se cobra por GB y no hay tope de gasto: deja los límites por defecto, revisa
  `demo estado` y ten a mano `demo pausar` (o `FHN_DEMO_PAUSADO=1`, que no necesita al dueño de la base).
- **Limpieza.** La API ya limpia al arrancar y cada minuto: no hace falta una tarea programada aparte (por qué, en
  [despliegue-demo.md](despliegue-demo.md#limpieza-a-las-24-horas-el-reinicio-automático-de-los-datos)).
- **El sitio.** La página «Pruébalo ahora» llama a `POST /v1/demo/entornos` desde el navegador. Toma la URL de la API
  de `PUBLIC_FHN_DEMO_API`, una variable de la construcción del sitio que el flujo de Pages llena con la variable del
  repositorio `FHN_DEMO_API` (Settings > Secrets and variables > Actions > Variables). Sin ella, la página explica
  cómo probar en tu equipo. Al cambiarla, vuelve a publicar el sitio. El origen del sitio debe estar en
  `FHN_DEMO_ORIGENES`.

## Seguridad: lo que conviene saber

- La base de la demostración es solo para la demostración (el arranque lo exige). Nunca la apuntes a la base de un
  negocio.
- Todo lo de cada visitante vive en su tenant, con las mismas políticas de fila que el modo alojado; las pruebas
  cubren que dos visitantes no ven datos, llaves, tokens ni sesiones del otro.
- Sin webhooks no hay solicitudes salientes hacia direcciones que elija un visitante.
- Las respuestas grandes están acotadas: cuerpo de entrada, bytes por página de documentos y caracteres por
  resultado del MCP.
- `FHN_DEMO_SECRETO` y la llave de cada visitante no se escriben en el log.
