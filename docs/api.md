# API REST de factura-hn (`@factura-hn/api`)

Hono + OpenAPI 3.1 + PostgreSQL. El mismo código sirve dos modos:

| Modo | Para quién | Tenants | Webhooks |
|---|---|---|---|
| `local` (por defecto) | Un negocio con su propio servidor y base en el establecimiento (Art. 47) | Uno: `local` | http o https, también hacia la red del negocio |
| `alojado` | Un operador que sirve a varios negocios | Varios, aislados con RLS | Solo https y nunca hacia direcciones internas |

> **Modo alojado:** su encaje con el Art. 47 («el establecimiento donde se encuentre el servidor») está
> pendiente de una consulta al SAR que aún no tiene respuesta. Mientras tanto, la recomendación es el modo local.

## La primera factura (3 pasos)

Desde la raíz del repositorio, con Docker y Compose v2. Emite en el tenant `demo`, con **CAI ficticio**: el
documento es de prueba y no tiene validez fiscal.

```bash
docker compose up -d --build --wait     # API en http://127.0.0.1:8787 (otro puerto: FHN_PUERTO=8788 docker compose …)
```

1. **La llave de caja del demo.** Sale una vez en el log del primer arranque (`docker compose logs api`), en un
   bloque que dice «CAI FICTICIO». Para tenerla en una variable, crea otra:

   ```bash
   LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)
   ```

2. **Emite** con el cuerpo en un archivo UTF-8 (`packages/api/ejemplos/factura.json`). La respuesta trae el
   documento y `enlaces` a su PDF, HTML y texto:

   ```bash
   PDF=$(curl -s -X POST http://127.0.0.1:8787/v1/documentos \
     -H "authorization: Bearer $LLAVE" -H "idempotency-key: venta-0001" -H "content-type: application/json" \
     --data-binary @packages/api/ejemplos/factura.json | sed -n 's/.*"pdf":"\([^"]*\)".*/\1/p')
   ```

3. **Descarga el PDF** del enlace:

   ```bash
   curl -H "authorization: Bearer $LLAVE" -o factura.pdf "http://127.0.0.1:8787$PDF"
   ```

Repetir el paso 2 con la misma `idempotency-key` devuelve la misma factura; para otra venta, usa otra clave.

En PowerShell (Windows), los mismos tres pasos:

```powershell
$LLAVE = docker compose exec -T api factura-hn-api demo llave --solo-llave
$r = Invoke-RestMethod -Method Post http://127.0.0.1:8787/v1/documentos -ContentType 'application/json' `
  -Headers @{ authorization = "Bearer $LLAVE"; 'idempotency-key' = 'venta-0001' } -InFile packages/api/ejemplos/factura.json
Invoke-WebRequest "http://127.0.0.1:8787$($r.enlaces.pdf)" -Headers @{ authorization = "Bearer $LLAVE" } -OutFile factura.pdf
```

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

Clientes: en TypeScript, `@factura-hn/cliente` (tipos generados de esta especificación, con
`verificarFirmaWebhook`); para agentes de IA, el servidor MCP `@factura-hn/mcp` (vía esta API, con una llave de
caja si no debe anular). Ver `packages/cliente/README.md` y `packages/mcp/README.md`.

Documentación interactiva en `/docs` y especificación en `/openapi.json` (también en
`packages/api/openapi.json`, que se regenera con `pnpm --filter @factura-hn/api openapi`).

### Variables de entorno

| Variable | Por defecto | |
|---|---|---|
| `DATABASE_URL` | (obligatoria) | Conexión con la que corre la API (Postgres ≥ 13; sirve Supabase). Con `FHN_MIGRAR_URL`, un rol LOGIN que no es dueño de las tablas: si no existe, la migración lo crea (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`, sin contraseña) y le concede el rol de la aplicación |
| `FHN_MIGRAR_URL` | — | Conexión del dueño de las tablas: migra y prepara el modo local al arrancar, y la usa la consola. Sin ella, la API usa `DATABASE_URL` para todo, corre como dueño de las tablas y lo avisa en el log |
| `FHN_MODO` | `local` | `local` o `alojado`. Sin definir, la API avisa en el log que corre en modo local |
| `FHN_RETENCION_DIAS` | `30` | Días que se guarda la respuesta completa de una clave de idempotencia y una entrega de webhook terminada (mínimo efectivo: 7) |
| `FHN_ROL` | `fhn_app` | Rol sin BYPASSRLS con el que corre cada transacción |
| `FHN_CLAVE_CIFRADO` | — | 32 bytes en base64 para cifrar los secretos de webhooks (AES-256-GCM). Obligatoria en `alojado` |
| `PUERTO` / `FHN_HOST` | `8787` / `0.0.0.0` | Dentro del contenedor. El puerto publicado por Compose es `FHN_PUERTO` (8787 por defecto) |
| `FHN_DEMO` | — | `1`: datos de demostración en modo local |
| `FHN_PROXIES_DE_CONFIANZA` | `0` | Proxies delante de la API, para el límite de intentos (ver «Límites de solicitudes») |
| `FHN_CONSOLA` | `factura-hn-api` | Cómo se muestra la consola en los mensajes. La imagen de Docker la define como `docker compose exec api factura-hn-api` |
| `FHN_MAX_DOCUMENTOS_REPORTE` | `50000` | Documentos como máximo en un libro de ventas o una exportación (ver «Reportes de período») |
| `FHN_REPORTES_SIMULTANEOS_PROCESO` | un cuarto del pool (`FHN_POOL`, 20 por defecto) | Reportes de período en curso a la vez en el proceso, de todos los tenants |

### Consola del operador

La consola se llama `factura-hn-api`. Cómo se invoca depende de dónde corre la API:

| Dónde | Cómo |
|---|---|
| Docker Compose (`docker-compose.yml`) | `docker compose exec api factura-hn-api <comando>` |
| Tu propio servidor, con el repositorio compilado (`pnpm build`) | `factura-hn-api <comando>`, que es `node packages/api/dist/cli.js <comando>` |

En esta guía y en los mensajes del servidor aparece la forma de Docker Compose. Los comandos:

```bash
docker compose exec api factura-hn-api ayuda                     # lista los comandos; también --help
docker compose exec api factura-hn-api migrar
docker compose exec api factura-hn-api tenant crear ferreteria-norte --nombre "Ferretería Norte" --limite 5000   # imprime la llave admin
docker compose exec api factura-hn-api llave crear ferreteria-norte --rol caja --nombre "Caja 2" --caja 000-002
docker compose exec api factura-hn-api demo llave                # otra llave de caja del demo (--rol admin, --solo-llave)
docker compose exec api factura-hn-api openapi openapi.json
```

`ayuda <comando>` (o `<comando> --help`) muestra el uso de cada uno. Un error de uso sale en español, con el uso
correcto, y termina con código 1. La consola se conecta como dueño de las tablas: `FHN_MIGRAR_URL` si está
definida, si no `DATABASE_URL`. Las llaves que crea se imprimen una sola vez, solo en la terminal de quien la
usa. En la imagen de Docker, `node cli.cjs <comando>` sigue funcionando.

No hay registro público de tenants: en el modo alojado los crea el operador.

### Modo local y modo alojado

Sin `FHN_MODO`, la API arranca en modo local y lo avisa en el log: en ese modo los webhooks pueden llegar a la
red interna y los secretos de firma no se cifran sin `FHN_CLAVE_CIFRADO`. Un servicio con varios negocios debe
usar `FHN_MODO=alojado`. En modo local la API **no arranca** si la base tiene tenants distintos de `local` y
`demo` en uso (se ignoran los desactivados sin llaves activas). El error dice cómo seguir: arrancar con
`FHN_MODO=alojado`, o desactivar esos tenants y revocar sus llaves, con el SQL para hacerlo.

## Autenticación y roles

`Authorization: Bearer fhn_<prefijo>_<secreto>`. El prefijo (12 hexadecimales) identifica la llave en
listados y para revocarla; la base guarda solo el SHA-256 de la llave completa.

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
| Emitir, consultar documentos, PDF/HTML/TXT, libro de ventas, autorizaciones y su estado, emisor | ✅ | ✅ |
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
| `POST /v1/autorizaciones` · `GET /v1/autorizaciones` | admin · caja | CAI, rango y fecha límite (validados por el núcleo) |
| `GET /v1/autorizaciones/{cai}/estado` | caja | Vigencia, restantes y alertas (Arts. 59 y 62) |
| `POST /v1/documentos` | caja | Factura, NC o ND. `Idempotency-Key` obligatoria. Responde `{ documento, enlaces: { pdf, html, txt } }` |
| `GET /v1/documentos?desde&hasta[&identificador][&limite&cursor]` | caja | Paginada, por fecha de emisión y número |
| `GET /v1/documentos/{numero}[.pdf\|.html\|.txt]` | caja | `?formato=carta\|ticket` (PDF), `?ancho=` (TXT) |
| `POST /v1/documentos/{numero}/anular` | admin | Art. 41 |
| `POST /v1/series/{id}/corregir-fecha` | admin | Reloj adelantado (Arts. 41 y 43) |
| `GET /v1/series/{id}/no-utilizados` | admin | Art. 42 |
| `GET /v1/libro-ventas?desde&hasta&formato=json\|csv` | caja | |
| `GET /v1/exportacion?desde&hasta&formato=jsonl\|csv\|txt` | admin | Art. 53 num. 5 |
| `GET /v1/bitacora?origen=fiscal\|api[&limite&cursor]` | admin | Paginada, del evento más reciente al más antiguo. `fiscal` (por defecto): la del núcleo; `api`: llaves, emisor y webhooks |
| `POST/GET /v1/llaves` · `DELETE /v1/llaves/{prefijo}` | admin | La llave completa se muestra solo al crearla |
| `POST/GET /v1/webhooks` · `DELETE /v1/webhooks/{id}` | admin | El secreto se muestra solo al crearlo |

Los períodos (`desde`, `hasta`) son de hasta 366 días.

### Forma de las respuestas

- Cada recurso va envuelto con su nombre: `{ "documento": … }`, `{ "emisor": … }`, `{ "autorizacion": … }`,
  `{ "autorizacion": …, "estado": … }`, `{ "llave": … }`, `{ "webhook": … }`. Al crear una llave o un webhook,
  la respuesta trae además `secreto` (la llave completa `fhn_…` o el secreto de firma `whsec_…`), que solo se
  muestra esa vez.
- Cada lista es `{ "<plural>": [...], "hayMas": bool, "siguiente": "cursor" | null }`. Si `hayMas`, pide la
  página siguiente con `?cursor=<siguiente>` y los mismos filtros. `limite` va de 1 a 500 (100 por defecto).
  El cursor es opaco: no lo armes ni lo modifiques (400 `CURSOR_INVALIDO`). `@factura-hn/cliente` recorre las
  páginas solo (`fhn.documentos`) o una por una (`fhn.paginaDocumentos`).
- Los reportes (`libro-ventas`, `exportacion`, `no-utilizados`) y `corregir-fecha` responden completos.

### Reportes de período

`libro-ventas` y `exportacion` responden con el período completo, y `no-utilizados` con la serie completa, con
estos límites para que un reporte grande no afecte al resto del servicio:

- **Tope de documentos** (libro y exportación). Antes de enviar nada se cuentan los documentos del período. Si pasan de
  `FHN_MAX_DOCUMENTOS_REPORTE` (50 000 por defecto; opción `maxDocumentosReporte` de `crearApp`), la respuesta
  es 422 `PERIODO_DEMASIADO_GRANDE` con `documentos` y `maximo`: divide el período (p. ej. por mes) y pide cada
  parte por separado.
- **Reportes en curso limitados.** Cada reporte en curso ocupa una conexión del pool (`FHN_POOL`) mientras se
  lee de la base y, si se transmite, mientras el cliente recibe la respuesta. Cada proceso atiende como mucho
  2 de estos reportes a la vez por tenant (opción `reportesSimultaneos`) y, sumando todos los tenants, un
  cuarto del pool, al menos 1 (`FHN_REPORTES_SIMULTANEOS_PROCESO`, opción `reportesSimultaneosProceso`). Ese
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
  tope y el encabezado de `txt` (`#factura-hn|v1|N`) salen de la misma lectura que las filas enviadas.
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
    "mensaje": "No hay autorización (CAI) registrada para este punto de emisión y tipo de documento (Arts. 59-61).",
    "solucion": "Registra con una llave admin el CAI de este punto de emisión y tipo de documento: POST /v1/autorizaciones …",
    "documentacion": "https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#sin_autorizacion"
  },
  "errores": [{ "codigo": "SIN_AUTORIZACION", "mensaje": "…", "solucion": "…", "documentacion": "…#sin_autorizacion" }]
}
```

- `error.codigo` es estable; `error.mensaje` es para mostrar.
- `solucion` dice qué hacer, y `documentacion` enlaza el código en la guía de errores (`docs/errores.md`). Los
  traen los errores frecuentes: llave (`NO_AUTENTICADO`), rol (`SOLO_ADMIN`), caja (`CAJA_SIN_PUNTO`,
  `CAJA_NO_AUTORIZADA`, `PUNTO_EMISION_REQUERIDO`), límites (`DEMASIADOS_INTENTOS`, `DEMASIADAS_SOLICITUDES`,
  `LIMITE_SOLICITUDES`, `LIMITE_MENSUAL`), cuerpo (`CUERPO_NO_UTF8`, `CUERPO_DEMASIADO_GRANDE`), forma
  (`SOLICITUD_INVALIDA`), idempotencia (`IDEMPOTENCY_KEY`, `IDEMPOTENCIA_CONFLICTO`), `SIN_EMISOR` y las
  autorizaciones (`SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`).
- **400 de forma** (`SOLICITUD_INVALIDA`): mensajes en español; `error.campo` es el primer campo con problema
  (p. ej. `documento.lineas`) y `errores` trae todos.
- **422 reglas fiscales** (`VALIDACION`): `errores` trae la lista completa, cada uno con su código, campo y
  enlace; el código que importa es `errores[].codigo`. El error principal toma la solución del primero que la
  tenga. También es 422 `PERIODO_DEMASIADO_GRANDE`.
- Los demás: 401 llave · 403 rol o caja · 404 · 409 conflicto · 413 cuerpo > 512 KB · 429 límites
  (`DEMASIADOS_INTENTOS`, `DEMASIADAS_SOLICITUDES` y `LIMITE_SOLICITUDES` con `Retry-After`; `LIMITE_MENSUAL`).

### Sesión

`GET /v1/sesion` responde, para cualquier rol, con qué llave hablas y si ya puedes emitir:

- `tenant`, `modo` (`local` o `alojado`) y `demo` (true en el tenant de demostración, con CAI ficticio);
- `llave`: id, prefijo, nombre, rol y, si es de caja, su establecimiento y punto de emisión (nunca el secreto);
- `emisor`: si está registrado, con su RTN y razón social;
- `puntos`: el punto de la llave de caja, o todos los que tienen autorizaciones si la llave es admin. Por cada
  tipo (`01`, `06`, `07`): si está `listo`, el `siguienteNumero`, las autorizaciones vigentes (rango, fecha
  límite, días y números restantes, alertas) y, si no está listo, el `problema`;
- `documentosDelMes` y `limiteMensual`;
- `puedeEmitir`: si esta llave ya puede emitir una factura (tipo 01) y, si no, `pendientes`: lo que falta
  (`SIN_EMISOR`, `CAJA_SIN_PUNTO`, `SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`,
  `LIMITE_MENSUAL`), cada uno con `solucion` y `documentacion`.

Solo lee datos del tenant de la llave (RLS).

### Límites de solicitudes

- **Por llave:** 20 solicitudes por segundo, ráfaga de 40 (opción `limiteSolicitudes`). Solo cuentan las
  solicitudes con el secreto correcto: conocer el prefijo de una llave (sale en listados y en la bitácora) no
  basta para dejarla en 429. Más allá, 429 `DEMASIADAS_SOLICITUDES`.
- **Intentos fallidos** (llave inexistente, secreto equivocado o revocada): 2 por segundo y ráfaga de 20 por
  dirección, y 50 por segundo y ráfaga de 200 en total (opción `limiteIntentos`). Agotados, una llave que este
  proceso aún no validó recibe 429 `DEMASIADOS_INTENTOS` **sin consultar la base**. Una llave que ya autenticó
  en este proceso sigue entrando, aunque su dirección agote los intentos.
- **Dirección del cliente:** la del socket. `X-Forwarded-For` se ignora, porque lo escribe el cliente. Detrás de
  proxies de confianza (Caddy, nginx), define `FHN_PROXIES_DE_CONFIANZA` (opción `proxiesDeConfianza`) con su
  número: se toma la dirección que anotó el más externo, la N-ésima de `X-Forwarded-For` desde la derecha. Sin
  eso, todas las cajas detrás del proxy comparten una cubeta de intentos. Las direcciones IPv6 se agrupan por
  /64.
- Los límites son en memoria y por réplica. Con varias cajas detrás de la misma dirección (NAT), los
  intentos fallidos de una pueden demorar el primer acceso de otra llave tras reiniciar el servidor.

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
y un despachador los entrega cada 5 s: hasta 12 intentos con espera creciente (30 s, 1 min, 2 min, … 4 h 16 min,
6 h), unas 14 h y media entre el primero y el último. Después la entrega queda `FALLIDA`. Cada entrega se reclama
en una transacción corta y el HTTP corre fuera de ella, en paralelo por tenant. Una entrega tiene un tiempo
máximo total (10 s), así que un receptor lento solo retrasa los avisos de su propio tenant. Lo pendiente de un
webhook desactivado no se entrega. Cada tenant tiene a lo sumo 20 webhooks activos: con 20 activos, crear otro
es 409 `LIMITE_WEBHOOKS` (desactiva uno antes). Pasados `FHN_RETENCION_DIAS` días, las entregas `ENTREGADA` o
`FALLIDA` de `documento.*` se borran, y las de `autorizacion.*` se quedan con el cuerpo vacío para que el mismo
aviso no se repita; las pendientes no se tocan.

El `id` de cada entrega es un UUID: va en la cabecera `X-FacturaHN-Entrega` y en el campo `id` del cuerpo, y
es el mismo en cada reintento.

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
- `api_llaves` y `api_entregas` no fuerzan RLS al dueño. Tres funciones `SECURITY DEFINER` acotadas trabajan
  sin el tenant de la sesión:
  - `fhn_api_autenticar(prefijo)` busca una llave y lee su tenant; fija ese tenant solo para esa lectura y
    devuelve el anterior al salir.
  - `fhn_api_tenants_con_pendientes()` solo lee `api_entregas` y lista los tenants con avisos por entregar; no
    fija ningún tenant.
  - `fhn_api_mantenimiento(dias)` compacta las respuestas idempotentes viejas, tenant por tenant, y borra (o deja
    como lápida) las entregas terminadas; devuelve el tenant anterior al salir.

  Solo el rol de la aplicación las ejecuta, y sigue sujeto a la política.
- El rol no tiene DELETE en ninguna tabla. La bitácora de la API es de solo inserción (disparador). Las
  llaves solo admiten cambiar `revocada`.
- SQL siempre parametrizado; rutas y consultas validadas por formato (Zod) antes de llegar a la base.
- HTML de los documentos con `Content-Security-Policy: default-src 'none'` y texto escapado.
- Límite de solicitudes por llave, que cuenta solo el secreto correcto, y de intentos fallidos por dirección y
  en total, aplicado **antes** de consultar la base (ver «Límites de solicitudes»); límite de documentos por mes
  por tenant, en la base. El último uso de una llave se registra solo con el secreto correcto.
- Webhooks en modo alojado: solo https, sin direcciones internas (IPv4 e IPv6, incluidas NAT64, 6to4 y las
  IPv4 incrustadas), y la conexión va a la misma IP que se validó (sin DNS rebinding) y sin redirecciones.
- `FHN_MODO` acepta solo `local` o `alojado`: un valor mal escrito no arranca. Sin definir, avisa en el log; en
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
`docker-compose.yml` del repositorio es para probar en tu máquina (Postgres sin contraseña en 127.0.0.1).
