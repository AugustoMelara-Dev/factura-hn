# API REST de factura-hn (`@factura-hn/api`)

Hono + OpenAPI 3.1 + PostgreSQL. El mismo código sirve dos modos:

| Modo | Para quién | Tenants | Webhooks |
|---|---|---|---|
| `local` (por defecto) | Un negocio con su propio servidor y base en el establecimiento (Art. 47) | Uno: `local` | http o https, también hacia la red del negocio |
| `alojado` | Un operador que sirve a varios negocios | Varios, aislados con RLS | Solo https y nunca hacia direcciones internas |

## La primera factura (3 pasos)

Con Docker y Compose v2, desde un clon del repositorio. Emite en el tenant `demo`, con **CAI ficticio**: el
documento es de prueba y no tiene validez fiscal.

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git && cd factura-hn
docker compose up -d --build --wait     # API en http://127.0.0.1:8787 (otro puerto: FHN_PUERTO=8788 docker compose …)
```

1. **La llave de caja del demo.** Sale una vez en el log del primer arranque (`docker compose logs api`), en un
   bloque que dice «CAI FICTICIO». Para tenerla en una variable, crea otra:

   ```bash
   LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)
   ```

2. **Emite** con el cuerpo en un archivo UTF-8 (`packages/api/ejemplos/factura.json`) y una clave de
   idempotencia nueva para esta venta. La respuesta trae el documento y `enlaces` a su PDF, HTML y texto:

   ```bash
   VENTA="venta-$(date +%s)"
   PDF=$(curl -sf -X POST http://127.0.0.1:8787/v1/documentos \
     -H "authorization: Bearer $LLAVE" -H "idempotency-key: $VENTA" -H "content-type: application/json" \
     --data-binary @packages/api/ejemplos/factura.json | sed -n 's/.*"pdf":"\([^"]*\)".*/\1/p')
   ```

3. **Descarga el PDF** del enlace:

   ```bash
   curl -f -H "authorization: Bearer $LLAVE" -o factura.pdf "http://127.0.0.1:8787${PDF:?el paso 2 no emitió: revisa su salida}"
   ```

Reenviar la misma venta con la misma clave (`$VENTA`) devuelve la misma factura; repetir el paso 2 completo
genera otra clave y emite otra factura. El número sale de la respuesta: no lo escribas a mano.
Con `-f`, curl termina con error si la API responde un error, en vez de seguir con un enlace vacío; para leer el
cuerpo del error (con su `solucion`), repite el paso sin `-f`. Si el paso 2 no emitió, `$PDF` queda vacío y el
paso 3 se detiene con «el paso 2 no emitió» en vez de dejar un `factura.pdf` vacío.

En PowerShell (Windows PowerShell 5.1 o PowerShell 7), los mismos tres pasos:

```powershell
$LLAVE = docker compose exec -T api factura-hn-api demo llave --solo-llave
$VENTA = "venta-$([guid]::NewGuid())"
$r = Invoke-RestMethod -UseBasicParsing -Method Post http://127.0.0.1:8787/v1/documentos -ContentType 'application/json' `
  -Headers @{ authorization = "Bearer $LLAVE"; 'idempotency-key' = $VENTA } -InFile (Resolve-Path packages/api/ejemplos/factura.json)
if (-not $r.enlaces.pdf) { throw 'El paso 2 no emitió: revisa su salida.' }
Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8787$($r.enlaces.pdf)" -Headers @{ authorization = "Bearer $LLAVE" } -OutFile factura.pdf
```

Toda respuesta JSON de la API declara `Content-Type: application/json; charset=utf-8`: Windows PowerShell 5.1 la
lee entonces en UTF-8 y los acentos llegan bien («Café», no «CafÃ©»).

Escribe tu propio cuerpo siempre en un archivo UTF-8 y envíalo con `--data-binary @archivo.json` (o `-InFile`):
escrito en la línea de comandos, una consola de Windows puede mandar la «é» en otra codificación, y la API lo
rechaza (400 `CUERPO_NO_UTF8`). Si algo falla, el error trae `solucion` y `documentacion`, y
`GET /v1/sesion` dice qué falta para emitir.

## Levantarla en tu máquina

Al primer arranque se crean dos tenants:

- `local`: el de tu negocio, vacío. Con su llave admin registra el emisor (`POST /v1/emisores`) y el CAI de tu
  resolución (`POST /v1/autorizaciones`), y crea las llaves de caja (`POST /v1/llaves`).
- `demo` (por `FHN_DEMO=1`): emisor «NEGOCIO DE DEMOSTRACIÓN» y **CAI ficticio** (`DEMO00-NO-VALIDO-…`), sin
  validez fiscal, con una llave de caja 000-001 lista para probar. Pon `FHN_DEMO: "0"` para no crearlo.

La llave admin de `local` **no** sale en el log del servidor: la crea la consola del operador, que la imprime
solo en tu terminal (el servidor recuerda el comando en cada arranque mientras `local` no tenga llave admin).
Las llaves del demo, sin validez fiscal, sí salen **una sola vez** en el log del primer arranque, en un bloque
destacado; en los arranques siguientes el log recuerda cómo crear otra. Si perdiste una llave, crea otra (las
anteriores siguen activas hasta que las revoques):

```sh
docker compose exec api factura-hn-api llave crear local --rol admin --nombre Administración   # la del negocio
docker compose exec api factura-hn-api demo llave                                              # caja del demo
```

Con `docker-compose.dev.yml` agrega `-f docker-compose.yml -f docker-compose.dev.yml` después de `docker compose`.
Para desarrollo, `docker-compose.dev.yml` publica Postgres en 127.0.0.1:54329 (sin contraseña: no lo uses en
el equipo de un negocio).

### Sin Docker

Con Node 20 o más reciente y un PostgreSQL al que llegues (13 o más reciente), desde un clon del repositorio:

```sh
pnpm install && pnpm build
createdb factura_hn                                   # o la base que quieras, vacía
DATABASE_URL=postgres://postgres@127.0.0.1:5432/factura_hn FHN_MODO=local FHN_DEMO=1   FHN_HOST=127.0.0.1 PUERTO=8787 node packages/api/dist/servidor.js
```

Así la API corre como dueño de las tablas (lo avisa el log); para un negocio, define además `FHN_MIGRAR_URL` con el
dueño y deja en `DATABASE_URL` un rol LOGIN propio de la API (ver [autoalojamiento](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/autoalojamiento.md#poner-en-marcha-un-negocio)).
La consola del operador es `node packages/api/dist/cli.js <comando>` (p. ej. `node packages/api/dist/cli.js demo llave`),
con las mismas variables. Por defecto escucha en todas las interfaces (`FHN_HOST=0.0.0.0`, para un contenedor): en tu
equipo, `127.0.0.1`. El puerto es `PUERTO`; `FHN_PUERTO` es solo el que publica Docker Compose.

Clientes: en TypeScript, `@factura-hn/cliente` (tipos generados de esta especificación, con
`verificarFirmaWebhook`); para agentes de IA, el servidor MCP `@factura-hn/mcp` (vía esta API, con una llave de
caja si no debe anular). Ver `packages/cliente/README.md` y `packages/mcp/README.md`.

Documentación interactiva en `/docs` y especificación en `/openapi.json` (también en
`packages/api/openapi.json`, que se regenera con `pnpm --filter @factura-hn/api openapi`). Cada operación tiene un
`operationId` estable, en camelCase y en español (verbo + recurso: `emitirDocumento`, `listarDocumentos`,
`anularDocumento`…): los clientes generados en otros lenguajes toman de ahí el nombre de cada método.

### Colecciones de Bruno y Postman, y clientes en otros lenguajes

Para probar la API sin programar, el repositorio trae dos colecciones generadas de `packages/api/openapi.json`
(`pnpm colecciones`; no se editan a mano): `colecciones/bruno/` y `colecciones/postman/`. Las dos tienen una
carpeta por etiqueta, con una solicitud por operación, y antes la carpeta **Primera factura**: sesión, emitir y
descargar el PDF, con pruebas. Las dos traen el entorno `demo` (`baseUrl` = `http://127.0.0.1:8787` y `llave`,
que no se guarda en el repositorio) y un script previo que pone una `Idempotency-Key` nueva en cada solicitud:
cada envío de «Emitir» es otra venta y emite otra factura de prueba. En tu sistema la clave es estable por venta
(el id del pedido), no una nueva por intento.

Antes de usarlas, levanta la API (`docker compose up -d --build --wait`) y crea una llave de caja del demo con
`docker compose exec -T api factura-hn-api demo llave --solo-llave`.

- **Bruno** ([usebruno.com](https://www.usebruno.com/), sin cuenta): el entorno `demo` lee la llave de la
  variable de entorno `FHN_LLAVE`. En la app, crea `colecciones/bruno/.env` con la línea `FHN_LLAVE=fhn_test_…`
  (git lo ignora), abre la carpeta `colecciones/bruno` como colección y elige el entorno `demo`. Desde la
  terminal, con la CLI que trae el repositorio como dependencia de desarrollo (la llave no pasa por la línea de
  órdenes ni sale en la salida):

  ```bash
  pnpm install
  export FHN_LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)
  pnpm --filter @factura-hn/colecciones bruno                                    # corre «Primera factura»
  ```

  Con la API en otro puerto, agrega `--env-var baseUrl=http://127.0.0.1:8788`.
- **Postman**: importa `colecciones/postman/factura-hn.postman_collection.json` y el entorno
  `colecciones/postman/demo.postman_environment.json`, elige `demo` y pega la llave en `llave`. La colección no
  está en el espacio público de Postman.

**Python.** `clientes/python/` genera un cliente con
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client) y lo prueba emitiendo una
factura de prueba (correlativo, idempotencia, total, desglose del ISV y leyenda «DOCUMENTO DE PRUEBA — SIN VALOR
FISCAL»). El código generado no se versiona: se genera en `clientes/python/generado/`. Con un entorno virtual
dentro del repositorio y `FHN_LLAVE` exportada, en Linux y macOS:

```bash
python -m venv .venv-python
.venv-python/bin/pip install --require-hashes -r clientes/python/requirements.txt
.venv-python/bin/python clientes/python/generar.py
FHN_API_URL=http://127.0.0.1:8787 .venv-python/bin/python -m pytest clientes/python
```

En Windows (Git Bash), el entorno virtual pone los programas en `Scripts` en lugar de `bin`:

```bash
python -m venv .venv-python
.venv-python/Scripts/pip install --require-hashes -r clientes/python/requirements.txt
.venv-python/Scripts/python clientes/python/generar.py
FHN_API_URL=http://127.0.0.1:8787 .venv-python/Scripts/python -m pytest clientes/python
```

En tu proyecto, `from factura_hn_api import AuthenticatedClient` y
`from factura_hn_api.api.documentos import emitir_documento`: cada método se llama como el `operationId` de su
operación, en snake_case. Los módulos se agrupan por etiqueta (`documentos`, `webhooks`…); los de etiquetas con
tilde quedan como `sesi_ó_n` y `auditor_í_a`.

**Otros lenguajes.** Genera el cliente desde `/openapi.json` (OpenAPI 3.1) con el generador de tu lenguaje, por
ejemplo [Kiota](https://learn.microsoft.com/openapi/kiota/) (C#, PHP, Go, Java, Python…) o
openapi-generator si soporta los `anyOf` y los tipos con `null` de 3.1. Lo que ningún generador hace por ti y
hay que escribir a mano: una `Idempotency-Key` estable por venta, mostrar tal cual los errores 422
(`errores[].mensaje`), la cabecera `X-Operador` codificada con `encodeURIComponent` si lleva tildes, y la
verificación de la firma de los webhooks (ver «Webhooks»).

### Variables de entorno

| Variable | Por defecto | |
|---|---|---|
| `DATABASE_URL` | (obligatoria) | Conexión con la que corre la API (Postgres ≥ 13). Con `FHN_MIGRAR_URL`, un rol LOGIN que no es dueño de las tablas: si no existe, la migración lo crea (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`, sin contraseña) y le concede el rol de la aplicación |
| `FHN_MIGRAR_URL` | — | Conexión del dueño de las tablas: migra y prepara el modo local al arrancar, y la usa la consola. Sin ella, la API usa `DATABASE_URL` para todo, corre como dueño de las tablas y lo avisa en el log |
| `FHN_MIGRAR_AL_ARRANCAR` | `1` | `0`: la API no migra al arrancar ni necesita al dueño de las tablas; exige el esquema al día y que `DATABASE_URL` no sea dueño, superusuario ni `BYPASSRLS`. La migración corre aparte (`factura-hn-api migrar`). No sirve en modo local |
| `FHN_MODO` | `local` | `local` (un negocio) o `alojado` (varios). Sin definir, la API avisa en el log que corre en modo local |
| `FHN_RETENCION_DIAS` | `30` | Días que se guarda la respuesta completa de una clave de idempotencia y una entrega de webhook terminada (mínimo efectivo: 7) |
| `FHN_ROL` | `fhn_app` | Rol sin BYPASSRLS con el que corre cada transacción |
| `FHN_CLAVE_CIFRADO` | — | 32 bytes en base64 para cifrar los secretos de webhooks (AES-256-GCM). Obligatoria en `alojado` |
| `PUERTO` / `FHN_HOST` | `8787` / `0.0.0.0` | Puerto e interfaz donde escucha el proceso. `::` escucha en IPv6 e IPv4. Con Docker Compose, el puerto publicado en el equipo es `FHN_PUERTO` (8787 por defecto) |
| `FHN_DEMO` | — | `1`: datos de demostración en modo local |
| `FHN_PROXIES_DE_CONFIANZA` | `0` | Proxies delante de la API, para el límite de intentos: la lista de sus direcciones o rangos CIDR (`fdaa:0:1a2b::/48`), o su número (ver «Límites de solicitudes»; el número, solo si a la API se llega únicamente por el proxy) |
| `FHN_CONSOLA` | `node packages/api/dist/cli.js` | Cómo se muestra la consola en los mensajes. La imagen de Docker la define como `docker compose exec api factura-hn-api` |
| `FHN_MAX_DOCUMENTOS_REPORTE` | `50000` | Documentos como máximo en un libro de ventas o una exportación (ver «Reportes de período») |
| `FHN_POOL` | `20` | Conexiones del pool de la API a Postgres (`DATABASE_URL`) |
| `FHN_REPORTES_SIMULTANEOS_PROCESO` | un cuarto del pool, redondeado hacia arriba (`FHN_POOL`, 20 por defecto: 5) | Reportes de período en curso a la vez en el proceso, de todos los tenants |

### Consola del operador

Cómo se invoca la consola del operador depende de dónde corre la API:

| Dónde | Cómo |
|---|---|
| Docker Compose (`docker-compose.yml`) | `docker compose exec api factura-hn-api <comando>` |
| Tu propio servidor, con el repositorio compilado (`pnpm build`), desde su raíz | `node packages/api/dist/cli.js <comando>` |

El paquete `@factura-hn/api` es privado: fuera de Docker, `factura-hn-api` no queda en el PATH. En esta guía
aparece la forma de Docker Compose; los mensajes del servidor usan la de su despliegue (`FHN_CONSOLA`). Los comandos:

```bash
docker compose exec api factura-hn-api ayuda                     # lista los comandos; también --help
docker compose exec api factura-hn-api migrar
docker compose exec api factura-hn-api llave crear local --rol caja --nombre "Caja 2" --caja 000-002
docker compose exec api factura-hn-api llave crear local --rol caja --caja 000-001 --mcp   # token y URL del MCP por HTTP (ChatGPT)
docker compose exec api factura-hn-api demo llave                # otra llave de caja del demo (--rol admin, --solo-llave)
docker compose exec -T api factura-hn-api openapi > openapi.json # la especificación, en tu equipo
```

Solo en modo alojado (`FHN_MODO=alojado`, varios tenants), con un `docker-compose.yml` propio:

```bash
docker compose exec api factura-hn-api tenant crear ferreteria-norte --nombre "Ferretería Norte" --limite 5000   # imprime la llave admin (fhn_live_…)
docker compose exec api factura-hn-api tenant crear ferreteria-norte-prueba --modo prueba   # sandbox: llaves fhn_test_…, solo CAI ficticios
docker compose exec api factura-hn-api llave crear ferreteria-norte --rol caja --nombre "Caja 2" --caja 000-002
```

`ayuda <comando>` (o `<comando> --help`) muestra el uso de cada uno. Un error de uso sale en español, con el uso
correcto, y termina con código 1. La consola se conecta como dueño de las tablas: `FHN_MIGRAR_URL` si está
definida, si no `DATABASE_URL`. Las llaves que crea se imprimen una sola vez, solo en la terminal de quien la
usa. En la imagen de Docker, `node cli.cjs <comando>` sigue funcionando.

No hay registro público de tenants: en el modo alojado los crea el operador. `tenant crear` solo funciona con
`FHN_MODO=alojado`: en modo local (o sin `FHN_MODO`, como en el `docker-compose.yml`) se niega, porque el modo
local es de un solo negocio (para el tuyo, `llave crear local --rol admin`). Los nombres `local` y `demo` están
reservados (los usa el servidor en modo local), y `demo llave` solo crea llaves en el tenant de demostración
(el del emisor y el CAI ficticios). `tenant crear --modo prueba|produccion` (por defecto `produccion`) fija el
modo del tenant, que no cambia después (ver «Tenants de prueba y de producción»). `llave crear` y `demo llave`
crean la llave con la marca del modo de su tenant. `llave crear … --mcp` (solo con `--rol caja --caja <establecimiento-punto>`)
guarda la misma llave, pero imprime un token `fhnmcp_…` y la URL `https://<tu-servidor>/mcp/<token>` para conectar
el MCP por HTTP (`@factura-hn/mcp http`) desde un cliente que solo acepta una URL, como ChatGPT. Trata esa URL
como una contraseña: quien la tenga emite en esa caja (no anula ni administra). Se revoca con
`DELETE /v1/llaves/{prefijo}`.

### Modo local y modo alojado

Sin `FHN_MODO`, la API arranca en modo local y lo avisa en el log: en ese modo los webhooks pueden llegar a la
red interna y los secretos de firma no se cifran sin `FHN_CLAVE_CIFRADO`. Un servicio con varios negocios debe
usar `FHN_MODO=alojado`. En modo local la API **no arranca** si la base tiene tenants distintos de `local` y
`demo` en uso (se ignoran los desactivados sin llaves activas). El error dice cómo seguir: arrancar con
`FHN_MODO=alojado`, o desactivar esos tenants y revocar sus llaves, con el SQL para hacerlo. Ya en marcha, la
API en modo local responde 403 `TENANT_FUERA_DEL_MODO_LOCAL` a una llave de otro tenant (p. ej. uno creado por
fuera de la consola), en cualquier operación de `/v1`.

## Autenticación y roles

`Authorization: Bearer fhn_live_<prefijo>_<secreto>` en un tenant de producción, o `fhn_test_<prefijo>_<secreto>`
en uno de prueba. Las llaves creadas antes de esta marca (`fhn_<prefijo>_<secreto>`) siguen valiendo en su
tenant, sea del modo que sea. El prefijo (12 hexadecimales) identifica la llave en listados y para revocarla
(`DELETE /v1/llaves/{prefijo}`); la base guarda solo el SHA-256 de la llave completa, marca incluida.

### Tenants de prueba y de producción

Cada tenant tiene un modo, `prueba` o `produccion`, que decide el operador al crearlo y que no cambia:

| | `prueba` (sandbox) | `produccion` |
|---|---|---|
| Llaves nuevas | `fhn_test_…` | `fhn_live_…` |
| Autorizaciones | Solo CAI ficticios (`DEMO00-NO-VALIDO-…`); un CAI real da 422 `AUTORIZACION_REAL_EN_DEMO` | Ningún CAI ficticio: 422 `CAI_DE_PRUEBA`, aun con `"prueba": true` |
| Documentos | Todos de prueba: leyenda `DOCUMENTO DE PRUEBA — SIN VALOR FISCAL`, fuera del libro y de la exportación | Con validez fiscal |

- **La fuente de verdad es el modo del tenant.** Una llave `fhn_test_` solo entra a un tenant de prueba y una
  `fhn_live_`, solo a uno de producción; si no, 401 `NO_AUTENTICADO`, como una llave que no existe. La marca no
  se puede cambiar a mano: forma parte de la llave y de su hash.
- **También fuera de la API.** La regla de las autorizaciones la impone la base (un disparador de
  `fhn_autorizaciones` que crea la migración de la API): quien registre un CAI con el SDK sobre la base de la API
  recibe el mismo rechazo, como error de la base con el código en el mensaje. Un tenant que no existe en
  `api_tenants` (uso del SDK solo) no cambia.
- **Dónde se ve.** `GET /v1/sesion` trae `modoTenant`, y cada respuesta autenticada (también los errores
  después de autenticar) lleva la cabecera `FacturaHN-Modo: prueba` o `FacturaHN-Modo: produccion` (también los 429 que llegan
  después de validar la llave, como `LIMITE_MENSUAL`; nunca el 401, el 413 ni los 429 `DEMASIADOS_INTENTOS` y
  `DEMASIADAS_SOLICITUDES`, que se deciden antes). No
  confundir con `modo` de la sesión y de `/salud`, que es el del servidor (`local` o `alojado`).
- **Los que ya existían.** Al migrar, todos los tenants quedan en `produccion`, salvo el tenant `demo` de
  demostración (el del emisor o los CAI ficticios), que queda en `prueba`. Si ese `demo` tiene alguna
  autorización o algún documento con un CAI real, queda en `produccion` (la migración lo avisa) y `demo llave` ya
  no le crea llaves. Las llaves viejas siguen entrando.
  Las autorizaciones ficticias que un tenant de producción ya tenía registradas no se tocan: siguen emitiendo
  con la leyenda de prueba.
- **En modo local** los tenants son `local` (producción) y `demo` (prueba, con `FHN_DEMO=1`). Para pasar a
  producción no se copia nada: se crea la llave admin de `local` (`llave crear local --rol admin`, una
  `fhn_live_`), se registran el emisor y el CAI reales y el integrador cambia solo su llave.

### Quién hizo cada operación

En la bitácora (`GET /v1/bitacora`, fiscal y de la API), el `actor` es `llave:<id> (<rol>: <nombre>)`, con el
id interno de la llave (`GET /v1/llaves`). Si varias personas usan la misma llave, indica el `operador` en
cada solicitud:

- en el cuerpo: `"operador": "María López"` (emitir, anular y corregir fecha), o
- en la cabecera `X-Operador: Mar%C3%ADa%20L%C3%B3pez` (con `encodeURIComponent`: las cabeceras no admiten
  tildes). Sirve para cualquier ruta que escribe, incluido el registro de CAI.

Si llegan ambos y no coinciden: 400 `OPERADOR_CONFLICTO`. Con `"imprimirOperador": true` al emitir, el
documento lleva «Atendido por: …». El operador no cambia la huella de idempotencia salvo que se imprima.

| | `caja` | `admin` |
|---|:-:|:-:|
| Emitir, consultar documentos, PDF/HTML/TXT, autorizaciones y su estado, emisor | ✅ | ✅ |
| Libro de ventas | Solo de su punto de emisión | Todo el tenant |
| Registrar emisor y CAI, anular, `confirmarSaltoDeFecha`, corregir fecha adelantada, no utilizados | | ✅ |
| Nota de crédito sobre un documento que no está en el sistema | | ✅ |
| Exportación (Art. 53 num. 5), bitácora, llaves, webhooks | | ✅ |

Una llave de caja siempre está atada a un establecimiento y punto de emisión: emite solo ahí (otro punto da
403). Una llave admin puede emitir en cualquier punto. No se puede revocar la única llave admin activa (409).
El esquema `Bearer` no distingue mayúsculas.

## Recursos

| Método y ruta | Rol | |
|---|---|---|
| `GET /salud`, `GET /openapi.json`, `GET /docs` | — | |
| `GET /v1/sesion` | caja | Con qué llave hablas y qué falta para emitir (ver «Sesión») |
| `POST /v1/emisores` · `GET /v1/emisores` · `GET/PATCH /v1/emisores/{id}` | admin · caja · caja/admin | Un emisor por tenant (el 409 trae su `id`); el RTN no cambia; los cambios afectan solo a documentos futuros |
| `POST /v1/autorizaciones` · `GET /v1/autorizaciones` | admin · caja | CAI, rango y fecha límite (validados por el núcleo). El registro responde `{ autorizacion, advertencias }`: avisos que no lo impiden, como `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62) |
| `GET /v1/autorizaciones/{cai}/estado` | caja | Vigencia, restantes y alertas (Arts. 59 y 62) |
| `POST /v1/documentos` | caja | Factura, NC o ND. `Idempotency-Key` obligatoria. Responde `{ documento, enlaces: { pdf, html, txt } }` |
| `GET /v1/documentos?desde&hasta[&identificador][&limite&cursor]` | caja | Paginada, por fecha de emisión y número |
| `GET /v1/documentos/{numero}[.pdf\|.html\|.txt]` | caja | `?formato=carta\|ticket` (PDF), `?ancho=` (TXT) |
| `POST /v1/documentos/{numero}/anular` | admin | Art. 41 |
| `POST /v1/series/{id}/corregir-fecha` | admin | Reloj adelantado (Arts. 41 y 43) |
| `GET /v1/series/{id}/no-utilizados` | admin | Art. 42. Sin las autorizaciones de prueba (no se reportan); `aviso` lo dice |
| `GET /v1/libro-ventas?desde&hasta&formato=json\|csv` | caja | Con llave de caja, solo su punto de emisión (ver «Reportes de período») |
| `GET /v1/exportacion?desde&hasta&formato=jsonl\|csv\|txt` | admin | Art. 53 num. 5 |
| `GET /v1/bitacora?origen=fiscal\|api[&limite&cursor]` | admin | Paginada, del evento más reciente al más antiguo. `fiscal` (por defecto): la del núcleo; `api`: llaves, emisor y webhooks |
| `POST/GET /v1/llaves` · `DELETE /v1/llaves/{prefijo}` | admin | La llave completa se muestra solo al crearla |
| `POST/GET /v1/webhooks` · `DELETE /v1/webhooks/{id}` | admin | El secreto se muestra solo al crearlo |
| `GET /v1/webhooks/{id}/entregas[?estado&limite&cursor]` | admin | Paginada, de la más reciente a la más antigua |
| `POST /v1/webhooks/{id}/entregas/{entrega}/reenviar` | admin | 202. Vuelve a poner la entrega en la cola |
| `POST /v1/webhooks/{id}/probar` | admin | 202. Encola un evento `webhook.prueba` |
| `POST /v1/webhooks/{id}/rotar-secreto` | admin | Secreto nuevo con gracia (`graciaHoras`, 24 por defecto); se muestra solo esta vez |

Los períodos (`desde`, `hasta`) son de hasta 366 días, y las dos fechas deben existir en el calendario: `2026-02-30`
o `2026-13-01` son 400 `SOLICITUD_INVALIDA`.

### Forma de las respuestas

- Cada recurso va envuelto con su nombre: `{ "documento": … }`, `{ "emisor": … }`, `{ "autorizacion": … }`,
  `{ "autorizacion": …, "estado": … }`, `{ "llave": … }`, `{ "webhook": … }`, `{ "entrega": … }`. Al crear una
  llave o un webhook, o al rotar el secreto de un webhook, la respuesta trae además `secreto` (la llave completa
  `fhn_live_…` o `fhn_test_…`, o el secreto de firma `whsec_…`), que solo se muestra esa vez.
- Cada lista es `{ "<plural>": [...], "hayMas": bool, "siguiente": "cursor" | null }`. Si `hayMas`, pide la
  página siguiente con `?cursor=<siguiente>` y los mismos filtros. `limite` va de 1 a 500 (100 por defecto).
  El cursor es opaco: no lo armes ni lo modifiques (400 `CURSOR_INVALIDO`). `@factura-hn/cliente` recorre las
  páginas solo (`fhn.documentos`) o una por una (`fhn.paginaDocumentos`).
- Una página de `GET /v1/documentos` trae además a lo sumo unos 8 MiB de documentos: se corta antes del documento
  que empieza pasado ese tope (siempre trae al menos uno). Puede traer menos de `limite` con `hayMas: true`; sigue
  pidiendo mientras `hayMas` sea `true`, no hasta recibir menos de `limite`.
- Los reportes (`libro-ventas`, `exportacion`, `no-utilizados`) y `corregir-fecha` responden completos.

### Cabeceras de cada respuesta

| Cabecera | En | Qué es |
|---|---|---|
| `Solicitud-Id` | todas | Id de la solicitud. Si mandas una cabecera `Solicitud-Id` válida (1 a 128 letras, dígitos, `.`, `_`, `:` o `-`, empezando por letra o dígito), la API usa la tuya; si no, genera un UUID. Va también en `error.solicitud` y en el log del servidor de un 500, que además lleva siempre un id generado por el servidor |
| `FacturaHN-Version` | todas | Versión de la API que respondió (la de `/salud`) |
| `RateLimit-Policy`, `RateLimit` | `/v1`, después de validar la llave (nunca en 401, 413 ni 429 `DEMASIADOS_INTENTOS`) | Límite de la llave (ver «Límites de solicitudes») |
| `Retry-After` | los 429 y los 503 | Segundos que conviene esperar antes de reintentar |
| `Idempotency-Replayed` | el 201 de `POST /v1/documentos` | `true` cuando la respuesta es la repetición de una emisión anterior con la misma `Idempotency-Key` (ver «Emisión: una transacción») |

`GET /v1/exportacion` responde `application/x-ndjson` (`jsonl`), `text/csv` (`csv`) o `text/plain` (`txt`),
según `formato`; la especificación declara los tres.

### Reportes de período

`libro-ventas` y `exportacion` responden con el período completo, y `no-utilizados` con la serie completa, con
estos límites para que un reporte grande no afecte al resto del servicio:

- **Tope de documentos** (libro y exportación). Antes de enviar nada se cuentan los documentos del período. Si pasan de
  `FHN_MAX_DOCUMENTOS_REPORTE` (50 000 por defecto; opción `maxDocumentosReporte` de `crearApp`), la respuesta
  es 422 `PERIODO_DEMASIADO_GRANDE` con `documentos` y `maximo`: divide el período (p. ej. por mes) y pide cada
  parte por separado.
- **Reportes en curso limitados.** Cada reporte en curso ocupa una conexión del pool (`FHN_POOL`) mientras se
  lee de la base y, si se transmite, mientras el cliente recibe la respuesta. Cada proceso atiende como mucho
  1 de estos reportes a la vez por llave (opción `reportesPorLlave`), 2 por tenant (opción `reportesSimultaneos`)
  y, sumando todos los tenants, un cuarto del pool redondeado hacia arriba, al menos 1
  (`FHN_REPORTES_SIMULTANEOS_PROCESO`, opción `reportesSimultaneosProceso`; con el pool por omisión de `pg`, 10,
  son 3, más que los 2 de un tenant). Así una caja que lee despacio el libro de ventas ocupa un solo cupo de su
  tenant y la exportación del admin sigue entrando. Ese
  límite no puede pasar del tamaño del pool menos 1: la API no arranca si se configura más. Así los reportes
  nunca ocupan todas las conexiones y el resto de la API sigue respondiendo (con un pool de 1, las demás
  solicitudes esperan a que termine el reporte en curso). Más allá, 429 `LIMITE_SOLICITUDES`
  con `Retry-After`. El cupo se libera cuando la respuesta termina de enviarse, el cliente la corta o vence un
  plazo. `HEAD` no se atiende en estas rutas (405).
- **El libro y la exportación se transmiten.** `GET /v1/libro-ventas` (JSON y CSV) y `GET /v1/exportacion`
  envían la respuesta por partes de unos 64 KB, a medida que la leen de la base, sin `Content-Length`. El
  contenido es el mismo, byte por byte. Si algo falla a mitad de camino, la conexión se corta con error en vez
  de terminar normalmente: una respuesta cortada nunca parece completa. Cada parte debe llegar al cliente en
  30 s (un cliente lento que avanza no se corta) y la respuesta entera en 5 minutos (opción
  `duracionMaxReporteMs`); si no, se corta con error. Para períodos que tardan más, divídelos. El conteo, el
  tope y el encabezado de `txt` (`#factura-hn|v2|N`) salen de la misma lectura que las filas enviadas.
- **Libro de ventas con llave de caja.** Una llave de caja recibe el libro solo de su punto de emisión: todas sus
  series (facturas, notas), en el mismo orden y con las mismas filas que el libro del tenant filtrado a ese
  punto. El resumen, el tope, `excluidos` y la cabecera `Documentos-Prueba-Excluidos` cuentan solo ese punto, y el
  CSV se llama `libro-ventas_<establecimiento>-<punto>_<desde>_<hasta>.csv`. Una llave de caja sin punto de
  emisión (de antes de atar cada caja a su punto) recibe 403 `CAJA_SIN_PUNTO`. Con llave admin, el libro es de
  todo el tenant. La exportación para el SAR sigue siendo solo de admin. **No es un límite de
  confidencialidad:** una llave de caja sigue leyendo los documentos de todo el tenant con `GET /v1/documentos`
  y `GET /v1/documentos/{numero}`. El libro por punto sirve para el cierre de cada caja, no para ocultarle las
  ventas de las demás.
- **Bitácora de la exportación.** Cada exportación queda en la bitácora de la API (`accion: exportacion`) con
  el período, el formato y los documentos contados. Se registra antes de enviar la última parte: si no se puede
  registrar, la respuesta se corta con error. Una exportación cortada (cliente, plazo o error) queda con
  `completo: false`.

### Montos

En la entrada, texto decimal (`"57.50"`, recomendado) o número. En la salida, número JSON en lempiras con a lo
sumo 2 decimales. Se calcula en centavos enteros y se convierte con la representación decimal más corta, así que
`Math.round(monto * 100)` da los centavos exactos. Sumar montos en coma flotante sí puede acumular error: pásalos
antes a centavos.

### Errores

```json
{
  "error": {
    "codigo": "VALIDACION",
    "mensaje": "No hay autorización (CAI) registrada para este punto de emisión y tipo de documento (Factura, serie 000-009-01) (Arts. 59-61).",
    "solucion": "Registra con una llave admin el CAI de este punto de emisión y tipo de documento: `POST /v1/autorizaciones` con el CAI, el rango y la fecha límite de la resolución del SAR. `GET /v1/sesion` dice qué falta para emitir.",
    "documentacion": "https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#sin_autorizacion",
    "solicitud": "744161c4-1b32-4172-ab06-958492845d20"
  },
  "errores": [{ "codigo": "SIN_AUTORIZACION", "mensaje": "No hay autorización (CAI) registrada …", "solucion": "…", "documentacion": "…#sin_autorizacion" }],
  "advertencias": []
}
```

- `error.codigo` es estable; `error.mensaje` es para mostrar.
- `error.solicitud` es el id de la solicitud, el mismo de la cabecera `Solicitud-Id`. Guárdalo con el error: con
  él se encuentra la línea del log del servidor. Un 500 se registra con un id que genera el servidor, que es el
  que va en la respuesta si no mandaste el tuyo: «solicitud <uuid>». Si mandaste tu `Solicitud-Id`, la respuesta
  repite el tuyo y el log lleva los dos: «solicitud <uuid> (cliente <tu id>)», porque el del cliente no tiene por
  qué ser único. La API lo envía siempre desde la 0.3.0; en el esquema es opcional, para leer sin fallar el error
  de un proxy o de un servidor anterior.
- `solucion` dice qué hacer, y `documentacion` enlaza el código en la guía de errores (`docs/errores.md`). Los
  traen los errores frecuentes: llave (`NO_AUTENTICADO`), rol (`SOLO_ADMIN`), caja (`CAJA_SIN_PUNTO`,
  `CAJA_NO_AUTORIZADA`, `PUNTO_EMISION_REQUERIDO`), límites (`DEMASIADOS_INTENTOS`, `DEMASIADAS_SOLICITUDES`,
  `LIMITE_SOLICITUDES`, `LIMITE_MENSUAL`), cuerpo (`CUERPO_NO_UTF8`, `CUERPO_DEMASIADO_GRANDE`), forma
  (`SOLICITUD_INVALIDA`), tipo de contenido (`TIPO_DE_CONTENIDO`), idempotencia (`IDEMPOTENCY_KEY`, `IDEMPOTENCIA_CONFLICTO`), `SIN_EMISOR` y las
  autorizaciones (`SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`, `AUTORIZACION_REAL_EN_DEMO`, `CAI_DE_PRUEBA`).
- **400 de forma** (`SOLICITUD_INVALIDA`): mensajes en español; `error.campo` es el primer campo con problema
  (p. ej. `documento.lineas`) y `errores` trae todos. Un cuerpo que no es JSON es 400 `JSON_INVALIDO`.
  El nombre de una llave y la URL de un webhook no admiten caracteres de control (salvo tabulador y saltos de
  línea): 400 `SOLICITUD_INVALIDA`. En los textos del documento y del emisor es 422 `TEXTO_CARACTER_NO_PERMITIDO`.
- **415** (`TIPO_DE_CONTENIDO`): la operación espera un cuerpo JSON y la solicitud no trae
  `Content-Type: application/json`. Viene con la forma de error de la API (antes, texto plano), y cada operación
  con cuerpo lo declara en `/openapi.json`.
- **422 reglas fiscales** (`VALIDACION`): `errores` trae la lista completa, cada uno con su código, campo y
  enlace; el código que importa es `errores[].codigo`. El error principal toma la solución del primero que la
  tenga. También es 422 `PERIODO_DEMASIADO_GRANDE`, y `MONTO_FUERA_DE_RANGO` cuando el total del documento pasaría
  de L 9,999,999,999,999.99 (un tope técnico, no fiscal: ver `docs/errores.md`); no consume número.
- **Sin `Idempotency-Key`** al emitir (o vacía, o con más de 255 caracteres): 400 `IDEMPOTENCY_KEY`, con su
  `solucion` (envía `Idempotency-Key` con un valor único por venta y reutilízalo si reintentas esa venta), no
  `SOLICITUD_INVALIDA`. En la especificación la cabecera sigue siendo obligatoria.
- Los demás: 401 llave · 403 rol, caja o `TENANT_FUERA_DEL_MODO_LOCAL` · 404 · 409 conflicto · 413 cuerpo > 512 KB · 429 límites, todos con
  `Retry-After` (`DEMASIADOS_INTENTOS`, `DEMASIADAS_SOLICITUDES`, `LIMITE_SOLICITUDES` y `LIMITE_MENSUAL`, que
  espera hasta el primer día del mes siguiente a las 00:00 de Honduras) · 500 `ERROR_INTERNO` · 503
  `BASE_NO_DISPONIBLE`, con `Retry-After`: PostgreSQL se reinicia o no responde. La API se recupera sola cuando
  la base vuelve; reintenta (al emitir, con la misma `Idempotency-Key`: si el documento alcanzó a emitirse
  recibes el mismo, y si no, se emite una sola vez).
- Cada operación de `/openapi.json` declara solo los estados que su código puede devolver: todas las de `/v1`,
  401, 403 (al menos `TENANT_FUERA_DEL_MODO_LOCAL`), 429, 500 y 503; las que tienen cuerpo, 415; `libro-ventas`, 403 (llave de caja sin punto de emisión); las que no son `GET`, 413 (el límite de 512 KB mira el cuerpo de cualquier método, aunque la
  operación no espere cuerpo); el 422 solo las que validan reglas fiscales o el tope de un
  reporte (ningún `GET` salvo `libro-ventas` y `exportacion`).

### Sesión

`GET /v1/sesion` responde, para cualquier rol, con qué llave hablas y si ya puedes emitir:

- `tenant`, `modoTenant` (`prueba` o `produccion`, ver «Tenants de prueba y de producción»), `modo` (del
  servidor: `local` o `alojado`) y `demo` (true en el tenant de demostración, con CAI ficticio);
- `llave`: id, prefijo, nombre, rol y, si es de caja, su establecimiento y punto de emisión (nunca el secreto);
- `emisor`: si está registrado, con su RTN y razón social;
- `puntos`: el punto de la llave de caja, o todos los que tienen autorizaciones si la llave es admin. Por cada
  tipo (`01`, `06`, `07`): si está `listo`, el `siguienteNumero`, las autorizaciones vigentes (rango, fecha
  límite, días y números restantes, alertas) y, si no está listo, el `problema`;
- `documentosDelMes` (de todo el tenant; solo con una llave admin, `null` con una de caja) y `limiteMensual`;
- `puedeEmitir`: si esta llave ya puede emitir una factura (tipo 01) y, si no, `pendientes`: lo que falta
  (`SIN_EMISOR`, `CAJA_SIN_PUNTO`, `SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`,
  `LIMITE_MENSUAL`), cada uno con `solucion` y `documentacion`.

Solo lee datos del tenant de la llave (RLS).

### Límites de solicitudes

- **Por llave:** 20 solicitudes por segundo, ráfaga de 40 (opción `limiteSolicitudes`). Solo cuentan las
  solicitudes con el secreto correcto: conocer el prefijo de una llave (sale en listados y en la bitácora) no
  basta para dejarla en 429. Más allá, 429 `DEMASIADAS_SOLICITUDES`. Cada respuesta autenticada lo dice con las
  cabeceras del borrador IETF de RateLimit (draft-ietf-httpapi-ratelimit-headers):
  `RateLimit-Policy: "llave";q=40;w=2` (la ráfaga, `q`, se recupera entera en `w` segundos) y
  `RateLimit: "llave";r=39;t=1` (`r` solicitudes que quedan y `t` segundos hasta recuperar la ráfaga completa).
  Van también en el 429 de la llave, pero no en los 429 `DEMASIADOS_INTENTOS` (otra cubeta, por dirección).
- **Documentos del mes:** el límite mensual del tenant (`tenant crear … --limite`) es 429 `LIMITE_MENSUAL` con
  `Retry-After` hasta el primer día del mes siguiente a las 00:00 de Honduras. El documento no se emite y el
  número no se consume.
- **Intentos con llaves que este proceso aún no validó:** 2 fichas por segundo y ráfaga de 20 por dirección
  (opción `limiteIntentos`). Cada llave inexistente gasta una ficha, y sin fichas libres la respuesta es 429
  `DEMASIADOS_INTENTOS` **sin consultar la base**, lleguen seguidas o muchas a la vez (con cola, cada consulta en
  curso reserva además una ficha). Una llave que resulta válida no gasta su ficha, y las solicitudes simultáneas
  con la misma llave hacen una sola consulta. Una llave que ya autenticó en este proceso no pasa por este límite, aunque su dirección lo agote, y un secreto equivocado con
  su prefijo no la saca de memoria.
- **Fallos de una llave que existe** (secreto equivocado, llave revocada o tenant inactivo): se cobran a esa
  llave, con las mismas tasas, y no a la dirección. Así, una caja que sigue usando su llave revocada se frena
  solo a sí misma y no deja en 429 a las demás cajas de su red. La respuesta es el mismo 401 que la de una llave
  inexistente.
- **Consultas a la vez:** a lo sumo 4 consultas de llaves no validadas en todo el proceso
  (`limiteIntentos.consultasSimultaneas`); las demás esperan su turno en cola. Esto acota la carga sobre
  Postgres sin dar 429 a nadie.
- **Después de reiniciar la API** el proceso no recuerda ninguna llave validada. Si más de unas 20 cajas detrás de
  la misma dirección (una NAT, la puerta de enlace de Docker) llegan a la vez con la cola de consultas llena, o si
  esa dirección gastó sus fichas con llaves inexistentes, las que pasan de la ráfaga reciben 429 `DEMASIADOS_INTENTOS` con un `Retry-After` de pocos segundos, aunque sus llaves sean válidas:
  la API todavía no sabe si lo son (eso es lo que protege contra la fuerza bruta). Al reintentar después de
  `Retry-After` entran, y desde ahí ya no pasan por este límite. Un cliente que reintenta después de `Retry-After`
  no tiene que hacer nada más; uno que arranca muchas cajas a la vez puede validar cada llave
  con `GET /v1/sesion` de a pocas.
- **Dirección del cliente:** la del socket. `X-Forwarded-For` se ignora, porque lo escribe el cliente. Las
  direcciones IPv6 se agrupan por /64 y la IPv4 mapeada en IPv6 cuenta como IPv4. Detrás de proxies de
  confianza (Caddy, nginx), `FHN_PROXIES_DE_CONFIANZA` (opción `proxiesDeConfianza`) acepta dos formas:
  - **La lista de direcciones de los proxies** (p. ej. `172.18.0.5` o `10.0.0.9,10.0.0.10`): la cabecera solo
    se cree si la solicitud llega desde uno de ellos, y la dirección del cliente es la primera desde la derecha
    que no es un proxy. Una solicitud directa no elige su cubeta. Es la forma recomendada.
  - **Un número N:** se toma la N-ésima dirección de `X-Forwarded-For` desde la derecha, venga de donde venga
    la solicitud. **Actívalo solo si a la API se llega únicamente a través del proxy** (publicada en
    `127.0.0.1` o en una red interna sin otra entrada): quien llegue directo escribe la cabecera que quiera y
    elige su cubeta de intentos.

  Sin ninguna de las dos, todas las cajas detrás del proxy comparten una cubeta de intentos.
- Los límites son en memoria y por réplica.

## Emisión: una transacción

`POST /v1/documentos` hace, dentro de una sola transacción de Postgres: bloqueo de la serie
(`SELECT … FOR UPDATE`), elección de la autorización, validación, documento, registro de la
`Idempotency-Key` con la respuesta, conteo del uso del mes, avisos de webhooks y bitácora. Si algo falla,
`ROLLBACK`: el número no se consume.

La respuesta (201) es `{ documento, enlaces }`. `enlaces.pdf`, `enlaces.html` y `enlaces.txt` son las rutas de
la representación impresa (`/v1/documentos/{numero}.pdf|.html|.txt`), relativas al servidor y con la misma
llave. La repetición idempotente también los trae.

**Idempotencia.** Reintentar con la misma clave y el mismo cuerpo devuelve el mismo documento con
`Idempotency-Replayed: true`. Con otro cuerpo: 422 `IDEMPOTENCIA_CONFLICTO`. Si dos reintentos llegan a la
vez, uno emite y el otro espera, se revierte y devuelve el mismo documento. Una solicitud rechazada (422) no
guarda la clave: corregida, puede reintentarse con la misma. La respuesta repetida es la de la emisión: si el
documento se anuló después, consulta `GET /v1/documentos/{numero}` para ver su estado actual.

Una clave de idempotencia **no caduca**: nunca vuelve a servir para emitir otro documento, por tarde que llegue
el reintento. Lo que caduca es la copia guardada de la respuesta: pasados `FHN_RETENCION_DIAS` días (30 por
defecto, nunca menos de 7), se reduce al número del documento. La clave y la huella de la solicitud se quedan:
un reintento con el mismo cuerpo devuelve `{ documento }` leído del almacén fiscal, con su estado actual y
`Idempotency-Replayed: true`, y con otro cuerpo sigue siendo 422. El servidor hace este mantenimiento al
arrancar y cada hora.

## Webhooks

Eventos: `documento.emitido`, `documento.anulado`, `autorizacion.por_vencer` (alerta del Art. 59 o 90 % del
rango) y `autorizacion.agotada`, una vez por autorización. Se encolan en la misma transacción de la operación
y un despachador los entrega cada 5 s; si un tenant tiene más de un lote vencido (por ejemplo, lo que se
acumuló mientras su receptor estaba caído), la misma pasada sigue con el lote siguiente hasta vaciarlo (no
reclama lotes nuevos pasados 30 s; el lote en curso termina). Una entrega sin respuesta 2xx se reintenta durante unos 3 días: hasta 22
intentos, con espera creciente (30 s, 1 min, 2 min, 4 min, … 2 h 8 min, 4 h 16 min y después 6 h entre cada uno)
y una fluctuación de ±20 % en cada espera, para que los avisos que fallaron juntos no vuelvan todos a la vez.
Entre el primer intento y el último pasan unas 74 h y media de media (con la fluctuación, entre unas 60 y 89 h
en el peor caso). Después la entrega queda `FALLIDA` y se puede reenviar a mano (abajo). Cada entrega se reclama
en una transacción corta y el HTTP corre fuera de ella, en paralelo por tenant. Una entrega tiene un tiempo
máximo total (10 s), así que un receptor lento solo retrasa los avisos de su propio tenant. Lo pendiente de un
webhook desactivado no se entrega. Lo pendiente de un tenant desactivado se queda `PENDIENTE` sin entregarse y
sale si el tenant se reactiva. Si el secreto guardado de un webhook no se puede descifrar (`FHN_CLAVE_CIFRADO`
falta o no es la que lo cifró), esa entrega queda `FALLIDA` en el acto con el motivo en `ultimoError`, sin
frenar ni repetir las demás del lote: arranca con la clave original o rota el secreto con `graciaHoras: 0` y
reenvíala. Cada tenant tiene a lo sumo 20 webhooks activos: con 20 activos, crear otro
es 409 `LIMITE_WEBHOOKS` (desactiva uno antes). Pasados `FHN_RETENCION_DIAS` días, las entregas `ENTREGADA` o
`FALLIDA` de `documento.*` y `webhook.prueba` se borran, y las de `autorizacion.*` se quedan con el cuerpo vacío
para que el mismo aviso no se repita; las pendientes no se tocan.

El `id` de cada entrega es un UUID: va en la cabecera `X-FacturaHN-Entrega` y en el campo `id` del cuerpo, y
es el mismo en cada reintento y en un reenvío manual. No se garantiza el orden de llegada.

### Entregas, reenvío y evento de prueba

Todas con la llave admin, y solo sobre los webhooks del propio tenant (RLS):

- `GET /v1/webhooks/{id}/entregas` lista las entregas, de la más reciente a la más antigua, paginadas como las
  demás listas (`limite`, `cursor`), con `?estado=PENDIENTE|ENTREGADA|FALLIDA` opcional. Cada una trae `id`,
  `evento`, `estado`, `intentos`, `proximoIntento` (si está pendiente), `ultimoCodigo` y `ultimoError` (`HTTP 503`,
  `Tiempo agotado`, `Error de red`…). El cuerpo del aviso no se devuelve.
- `POST /v1/webhooks/{id}/entregas/{entrega}/reenviar` responde 202 `{ entrega }`. Una entrega `FALLIDA` o
  `ENTREGADA` vuelve a `PENDIENTE` con el calendario completo (otros 3 días) y sale en segundos, con el mismo `id`.
  Una `PENDIENTE` se adelanta a ahora y conserva sus intentos (si justo se estaba enviando, puede llegar dos
  veces: el receptor ya descarta repetidos por `id`). 409 `WEBHOOK_INACTIVO` si el webhook está desactivado. 409
  `ENTREGA_VENCIDA` si es una entrega de `autorizacion.*` (`ENTREGADA` o `FALLIDA`) cuyo cuerpo ya se vació por
  retención; una de `documento.*` o `webhook.prueba` tan vieja ya se borró y da 404 `NO_ENCONTRADO`.
- `POST /v1/webhooks/{id}/probar` responde 202 `{ entrega }` y encola un aviso `webhook.prueba` solo para ese
  webhook, aunque no esté suscrito a él: `{ id, evento: "webhook.prueba", creado, datos: { webhookId, mensaje } }`,
  firmado. Una prueba se intenta a lo sumo 3 veces (no los 3 días de los demás avisos). Sirve para probar el
  receptor sin emitir un documento. Cada webhook tiene a lo sumo 5 pruebas pendientes: más allá, 409
  `LIMITE_PRUEBAS` (también al reenviar una prueba terminada). 409 `WEBHOOK_INACTIVO` si está desactivado.

### Rotación del secreto

`POST /v1/webhooks/{id}/rotar-secreto` (cuerpo opcional `{ "graciaHoras": 24 }`, de 0 a 168) responde
`{ webhook, secreto }` con el secreto nuevo, que solo se muestra esta vez. Durante la gracia, cada entrega lleva
**dos** firmas `v1`: primero la del secreto anterior y después la del nuevo. `webhook.graciaHasta` dice hasta
cuándo; al terminar, solo la del nuevo, y el servidor borra el secreto anterior en su mantenimiento de cada hora.
Con `graciaHoras: 0`, el secreto anterior deja de valer en el acto. Rotar otra vez durante una gracia (un
reintento, un doble clic) **conserva el secreto más viejo**, el que el receptor puede seguir usando: valen ese y el
nuevo, el intermedio se descarta y la gracia dura hasta la más tardía de las dos. 409 `WEBHOOK_INACTIVO` si el
webhook está desactivado.

Pasos: actualiza el receptor a un verificador que acepte varios `v1` (`@factura-hn/cliente` desde esta versión),
rota, cambia el secreto del receptor antes de que termine la gracia y comprueba con `probar`.

```ts
import { verificarFirmaWebhook } from '@factura-hn/cliente'; // npm install @factura-hn/cliente
// Express: app.post('/hook', express.raw({ type: 'application/json' }), async (req, res) => { … })
const cuerpo = req.body.toString('utf8'); // crudo, antes de JSON.parse
// verificarFirmaWebhook devuelve una promesa: sin `await` el `if` nunca rechaza.
if (!(await verificarFirmaWebhook(cuerpo, req.header('x-facturahn-firma'), process.env.FHN_SECRETO_WEBHOOK!))) return res.sendStatus(400);
const evento = JSON.parse(cuerpo); // { id, evento, creado, datos }
// Usa X-FacturaHN-Entrega (= evento.id) para descartar duplicados.
```

Firma: `X-FacturaHN-Firma: t=<unix>,v1=hex(HMAC-SHA256(secreto, "<t>.<cuerpo>"))`, con 5 minutos de tolerancia.
Puede llevar más de un `v1` (durante la gracia de una rotación): la entrega es válida si **alguno** verifica con
tu secreto. Ignora las entradas que no conozcas (`v0=`, `v2=`…). `verificarFirmaWebhook` ya lo hace. Si escribes
tu propio verificador, no armes un mapa de la cabecera: con dos `v1`, un mapa se queda solo con uno.

## Seguridad

- **Rol de conexión:** con `FHN_MIGRAR_URL`, la API se conecta con un rol LOGIN que no es dueño de las
  tablas, ni superusuario, ni salta RLS, y con NOINHERIT: por sí solo no tiene ningún permiso sobre las tablas.
  Aunque un SQL de la sesión hiciera `RESET ROLE`, no lee ni cambia nada. El `docker-compose.yml` usa así
  `fhn_api`, y `postgres` solo para migrar. Con `FHN_MIGRAR_URL` definida, la API **no arranca** si
  `DATABASE_URL` usa el mismo usuario que el dueño, o si su rol es superusuario, tiene BYPASSRLS, es
  `pg_write_all_data` o `pg_read_all_data`, o es el dueño de las tablas, **o es miembro de un rol así** (aun con
  NOINHERIT, podría pasar a él con `SET ROLE`). El dueño de las tablas no necesita ser superusuario (sirve un Postgres
  administrado con un rol CREATEROLE).
- **Aislamiento entre tenants:** cada transacción corre como `fhn_app` (NOLOGIN, NOBYPASSRLS) con
  `factura_hn.tenant` fijado. Todas las tablas `fhn_*` y `api_*` tienen la política `fhn_por_tenant`. Las
  pruebas (`packages/api/test/rls.test.ts`) intentan leer y escribir en las 12 tablas como otro tenant.
- `api_llaves` y `api_entregas` no fuerzan RLS al dueño. Seis funciones `SECURITY DEFINER` acotadas trabajan
  sin el tenant de la sesión (`select proname from pg_proc where prosecdef` las lista):
  - `fhn_api_autenticar(prefijo)` busca una llave y lee su tenant; fija ese tenant solo para esa lectura y
    devuelve el anterior al salir.
  - `fhn_api_prefijo_registrado(prefijo)` dice solo si un prefijo existe (aunque su llave esté revocada), para
    cobrar el intento fallido a esa llave y no a la dirección; la respuesta HTTP es el mismo 401.
  - `fhn_api_marcar_uso(prefijo, hash)` anota el último uso de una llave, solo si el hash coincide y no está
    revocada; la API la llama después de comprobar el secreto.
  - `fhn_api_modo_tenant(tenant)` lee el modo (`prueba` o `produccion`) de un tenant para el disparador que decide
    qué CAI acepta; fija ese tenant solo para esa lectura y devuelve el anterior.
  - `fhn_api_tenants_con_pendientes()` lista los tenants activos con avisos por entregar; fija cada tenant solo
    para leer si está activo y devuelve el anterior al salir.
  - `fhn_api_mantenimiento(dias)` compacta las respuestas idempotentes viejas, tenant por tenant, y borra (o deja
    como lápida) las entregas terminadas; devuelve el tenant anterior al salir.

  Solo el rol de la aplicación las ejecuta, y sigue sujeto a la política.
- El rol no tiene DELETE en ninguna tabla. La bitácora de la API es de solo inserción (disparador). Las
  llaves solo admiten cambiar `revocada`.
- SQL siempre parametrizado; rutas y consultas validadas por formato (Zod) antes de llegar a la base.
- HTML de los documentos con `Content-Security-Policy: default-src 'none'` y texto escapado.
- Límite de solicitudes por llave, que cuenta solo el secreto correcto, y de intentos con llaves no validadas por dirección
  (y de fallos por llave), aplicado **antes** de consultar la base (ver «Límites de solicitudes»); límite de documentos por mes
  por tenant, en la base. El último uso de una llave se registra solo con el secreto correcto.
- Webhooks en modo alojado: solo https, sin direcciones internas (IPv4 e IPv6, incluidas NAT64, 6to4 y las
  IPv4 incrustadas; también los nombres con punto final, como `localhost.`), y la conexión va a la misma IP que se
  validó (sin DNS rebinding) y sin redirecciones. De la respuesta del receptor solo se guarda el código de estado.
- Con un `FHN_MODO` mal escrito, la API no arranca. Sin definir, avisa en el log; en
  modo local, una base con tenants de otros negocios no arranca.
- Una llave de caja siempre emite en su punto de emisión. Si una llave de caja vieja no tiene punto de emisión
  completo, emitir con ella da 403 `CAJA_SIN_PUNTO`; la consola exige `--caja 000-001` con `--rol caja`.
- `/docs` carga una versión fija de Swagger UI con Subresource Integrity, bajo una CSP que solo permite esos
  archivos y no deja enmarcar la página.
- CSV (libro de ventas y exportación): el texto que empieza con `= + - @` lleva un apóstrofo delante para que
  una hoja de cálculo no lo ejecute como fórmula. TXT y JSONL son archivos de traslado y **no** se neutralizan
  contra fórmulas: no los abras con el asistente de importación de una hoja de cálculo.
- Montos: la notación científica admite exponentes de hasta ±30 y 40 dígitos; más allá es `ErrorMonto` (422), sin
  calcular nada.
- El cuerpo debe ser UTF-8 válido (400 `CUERPO_NO_UTF8`): un byte en otra codificación no se convierte en «?»
  dentro de un documento inmutable. Tamaño máximo: 512 KB (413 `CUERPO_DEMASIADO_GRANDE`).
- Si Postgres se reinicia o cierra una conexión inactiva, la API lo registra en una línea y abre otra conexión
  en la siguiente consulta. El `docker-compose.yml` reinicia los dos servicios (`restart: unless-stopped`).
- Errores internos sin detalles para el cliente.

**Retención y llaves:** las claves de idempotencia no caducan (su respuesta se compacta pasada la retención);
las entregas terminadas se borran pasada la retención; el id de entrega es un UUID; la llave admin del negocio
no pasa por el log del servidor.

**Producción:** Postgres con contraseña y TLS, `DATABASE_URL` con un rol LOGIN propio de la API (con su propia
contraseña) y `FHN_MIGRAR_URL` con el dueño, `FHN_CLAVE_CIFRADO`, la API detrás de un proxy con HTTPS. El
`docker-compose.yml` del repositorio es para probar en tu máquina y usa `trust` (sin contraseña): la base no
publica ningún puerto y solo la alcanzan los contenedores del proyecto, y quien llega a ellos ya puede correr
`docker compose exec` en ese equipo. Por eso `docker compose up -d --build --wait` funciona sin crear nada antes.
En un equipo compartido o un servidor, pon contraseñas con un `docker-compose.override.yml` y un `.env` que no se
versiona (`docs/autoalojamiento.md`, «Contraseña de la base»); la imagen nunca incluye `.env*` ni ese override
(`.dockerignore`).
