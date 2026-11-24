# API REST de factura-hn (`@factura-hn/api`)

Hono + OpenAPI 3.1 + PostgreSQL. El mismo código sirve dos modos:

| Modo | Para quién | Tenants | Webhooks |
|---|---|---|---|
| `local` (por defecto) | Un negocio con su propio servidor y base en el establecimiento (Art. 47) | Uno: `local` | http o https, también hacia la red del negocio |
| `alojado` | Un operador que sirve a varios negocios | Varios, aislados con RLS | Solo https y nunca hacia direcciones internas |

> **Modo alojado:** su encaje con el Art. 47 («el establecimiento donde se encuentre el servidor») está
> pendiente de una consulta al SAR que aún no tiene respuesta. Mientras tanto, la recomendación es el modo local.

## Levantarla en tu máquina

```bash
docker compose up --build        # API en http://127.0.0.1:8787 (Postgres solo en la red interna de Compose)
docker compose logs api          # llaves: se muestran una sola vez, al primer arranque
```

Al primer arranque se crean dos tenants:

- `local`: el de tu negocio, vacío. Con su llave admin registra el emisor (`POST /v1/emisores`) y el CAI de tu
  resolución (`POST /v1/autorizaciones`), y crea las llaves de caja (`POST /v1/llaves`).
- `demo` (por `FHN_DEMO=1`): emisor «NEGOCIO DE DEMOSTRACIÓN» y **CAI ficticio** (`DEMO00-NO-VALIDO-…`), sin
  validez fiscal, con una llave de caja 000-001 lista para probar. Pon `FHN_DEMO: "0"` para no crearlo.

La llave de caja del demo y la admin de `local` salen **una sola vez** en el log del primer arranque
(`docker compose logs api`). Si las perdiste, crea otras (las anteriores siguen activas hasta que las revoques):

```sh
docker compose exec api node cli.cjs llave crear local --rol admin --nombre "nueva"
docker compose exec api node cli.cjs llave crear demo --rol caja --nombre "caja demo 2" --caja 000-001
```

Con `docker-compose.dev.yml` agrega `-f docker-compose.yml -f docker-compose.dev.yml` después de `docker compose`.
Para desarrollo, `docker-compose.dev.yml` publica Postgres en 127.0.0.1:54329 (sin contraseña: no lo uses en
el equipo de un negocio).

Clientes: en TypeScript, `@factura-hn/cliente` (tipos generados de esta especificación, con
`verificarFirmaWebhook`); para agentes de IA, el servidor MCP `@factura-hn/mcp` (vía esta API, con una llave de
caja si no debe anular). Ver `packages/cliente/README.md` y `packages/mcp/README.md`.

Documentación interactiva en `/docs` y especificación en `/openapi.json` (también en
`packages/api/openapi.json`, que se regenera con `pnpm --filter @factura-hn/api openapi`).

```bash
LLAVE=fhn_...   # la llave de caja del log
# El cuerpo va en un archivo UTF-8: escrito en la línea de comandos, una consola de Windows puede mandar la
# «é» en otra codificación, y la API lo rechaza (400 CUERPO_NO_UTF8).
cat > factura.json <<'JSON'
{"documento":{"preciosIncluyenISV":true,"lineas":[{"descripcion":"Café","cantidad":2,"precioUnitario":"57.50"}]}}
JSON
curl -X POST http://127.0.0.1:8787/v1/documentos \
  -H "authorization: Bearer $LLAVE" -H "idempotency-key: venta-0001" -H "content-type: application/json" \
  --data-binary @factura.json
curl -H "authorization: Bearer $LLAVE" http://127.0.0.1:8787/v1/documentos/000-001-01-00000001.pdf -o factura.pdf
```

### Variables de entorno

| Variable | Por defecto | |
|---|---|---|
| `DATABASE_URL` | (obligatoria) | Conexión de Postgres (≥ 13; sirve Supabase). Debe poder crear tablas y el rol de la aplicación |
| `FHN_MODO` | `local` | `local` o `alojado` |
| `FHN_ROL` | `fhn_app` | Rol sin BYPASSRLS con el que corre cada transacción |
| `FHN_CLAVE_CIFRADO` | — | 32 bytes en base64 para cifrar los secretos de webhooks (AES-256-GCM). Obligatoria en `alojado` |
| `PUERTO` / `FHN_HOST` | `8787` / `0.0.0.0` | |
| `FHN_DEMO` | — | `1`: datos de demostración en modo local |
| `FHN_MAX_DOCUMENTOS_REPORTE` | `50000` | Documentos como máximo en un libro de ventas o una exportación (ver «Reportes de período») |

### Consola del operador

```bash
factura-hn-api migrar
factura-hn-api tenant crear ferreteria-norte --nombre "Ferretería Norte" --limite 5000   # imprime la llave admin
factura-hn-api llave crear ferreteria-norte --rol caja --nombre "Caja 2" --caja 000-002
factura-hn-api openapi openapi.json
```

No hay registro público de tenants: en el modo alojado los crea el operador.

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
| `POST /v1/emisores` · `GET /v1/emisores` · `GET/PATCH /v1/emisores/{id}` | admin · caja · caja/admin | Un emisor por tenant (el 409 trae su `id`); el RTN no cambia; los cambios afectan solo a documentos futuros |
| `POST /v1/autorizaciones` · `GET /v1/autorizaciones` | admin · caja | CAI, rango y fecha límite (validados por el núcleo) |
| `GET /v1/autorizaciones/{cai}/estado` | caja | Vigencia, restantes y alertas (Arts. 59 y 62) |
| `POST /v1/documentos` | caja | Factura, NC o ND. `Idempotency-Key` obligatoria |
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

`libro-ventas`, `exportacion` y `no-utilizados` responden con el período completo, con estos límites para que
un período grande no afecte al resto del servicio:

- **Tope de documentos.** Antes de leer nada se cuentan los documentos del período. Si pasan de
  `FHN_MAX_DOCUMENTOS_REPORTE` (50 000 por defecto; opción `maxDocumentosReporte` de `crearApp`), la respuesta
  es 422 `PERIODO_DEMASIADO_GRANDE` con `documentos` y `maximo`: divide el período (p. ej. por mes) y pide cada
  parte por separado.
- **Dos reportes a la vez por negocio.** Cada proceso atiende como mucho 2 de estos reportes en curso por
  tenant (opción `reportesSimultaneos`). El siguiente recibe 429 `LIMITE_SOLICITUDES` con `Retry-After`. El
  cupo se libera cuando la respuesta termina de enviarse o el cliente la corta. `HEAD` no se atiende en estas
  rutas (405).
- **La exportación se transmite.** `GET /v1/exportacion` envía el archivo por partes, a medida que lo lee de
  la base, sin `Content-Length`. El contenido es el mismo que antes. Si algo falla a mitad de camino, la
  conexión se corta con error en vez de terminar normalmente: un archivo cortado nunca parece completo. Si el
  cliente deja de leer durante 30 s, la respuesta se corta. El encabezado de `txt` (`#factura-hn|v1|N`)
  coincide siempre con las filas enviadas.

### Montos

En la entrada, texto decimal (`"57.50"`, recomendado) o número. En la salida, número JSON en lempiras con a lo
sumo 2 decimales. Se calcula en centavos enteros y se convierte con la representación decimal más corta, así que
`Math.round(monto * 100)` da los centavos exactos. Sumar montos en coma flotante sí puede acumular error: pásalos
antes a centavos.

Errores: `{ "error": { "codigo", "mensaje" }, "errores"?: [{ codigo, mensaje, campo }] }`.
400 forma inválida · 401 llave · 403 rol o caja · 404 · 409 conflicto · 413 cuerpo > 512 KB ·
**422 reglas fiscales** (lista completa de `errores`; también `PERIODO_DEMASIADO_GRANDE`) · 429 límites
(`DEMASIADAS_SOLICITUDES` por llave o `LIMITE_SOLICITUDES` de reportes en curso, con `Retry-After`).

## Emisión: una transacción

`POST /v1/documentos` hace, dentro de una sola transacción de Postgres: bloqueo de la serie
(`SELECT … FOR UPDATE`), elección de la autorización, validación, documento, registro de la
`Idempotency-Key` con la respuesta, conteo del uso del mes, avisos de webhooks y bitácora. Si algo falla,
`ROLLBACK`: el número no se consume.

**Idempotencia.** Reintentar con la misma clave y el mismo cuerpo devuelve el mismo documento con
`Idempotency-Replayed: true`. Con otro cuerpo: 422 `IDEMPOTENCIA_CONFLICTO`. Si dos reintentos llegan a la
vez, uno emite y el otro espera, se revierte y devuelve el mismo documento. Una solicitud rechazada (422) no
guarda la clave: corregida, puede reintentarse con la misma. La respuesta repetida es la de la emisión: si el
documento se anuló después, consulta `GET /v1/documentos/{numero}` para ver su estado actual.

## Webhooks

Eventos: `documento.emitido`, `documento.anulado`, `autorizacion.por_vencer` (alerta del Art. 59 o 90 % del
rango) y `autorizacion.agotada`, una vez por autorización. Se encolan en la misma transacción de la operación
y un despachador los entrega cada 5 s: hasta 12 intentos con espera creciente (30 s, 1 min, 2 min, … 4 h 16 min,
6 h), unas 14 h y media entre el primero y el último. Después la entrega queda `FALLIDA`. Cada entrega se reclama
en una transacción corta y el HTTP corre fuera de ella, en paralelo por tenant. Una entrega tiene un tiempo
máximo total (10 s), así que un receptor lento solo retrasa los avisos de su propio tenant. Lo pendiente de un
webhook desactivado no se entrega.

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

- **Aislamiento entre tenants:** cada transacción corre como `fhn_app` (NOLOGIN, NOBYPASSRLS) con
  `factura_hn.tenant` fijado. Todas las tablas `fhn_*` y `api_*` tienen la política `fhn_por_tenant`. Las
  pruebas (`packages/api/test/rls.test.ts`) intentan leer y escribir en las 12 tablas como otro tenant.
- `api_llaves` y `api_entregas` no fuerzan RLS al dueño: dos funciones `SECURITY DEFINER` acotadas
  (`fhn_api_autenticar(prefijo)`, `fhn_api_tenants_con_pendientes()`) las leen sin tenant. El rol de la
  aplicación sigue sujeto a la política.
- El rol no tiene DELETE en ninguna tabla. La bitácora de la API es de solo inserción (disparador). Las
  llaves solo admiten cambiar `revocada`.
- SQL siempre parametrizado; rutas y consultas validadas por formato (Zod) antes de llegar a la base.
- HTML de los documentos con `Content-Security-Policy: default-src 'none'` y texto escapado.
- Límite de solicitudes por llave (20/s, ráfaga 40, en memoria por réplica), aplicado **antes** de consultar
  la base, y de documentos por mes por tenant (en la base). El último uso de una llave se registra solo con el
  secreto correcto.
- Webhooks en modo alojado: solo https, sin direcciones internas (IPv4 e IPv6, incluidas NAT64, 6to4 y las
  IPv4 incrustadas), y la conexión va a la misma IP que se validó (sin DNS rebinding) y sin redirecciones.
- `FHN_MODO` acepta solo `local` o `alojado`: un valor mal escrito no arranca.
- Una llave de caja siempre emite en su punto de emisión. Si una llave de caja vieja no tiene punto de emisión
  completo, emitir con ella da 403 `CAJA_SIN_PUNTO`; la consola exige `--caja 000-001` con `--rol caja`.
- `/docs` carga una versión fija de Swagger UI con Subresource Integrity, bajo una CSP que solo permite esos
  archivos y no deja enmarcar la página.
- CSV (libro de ventas y exportación): el texto que empieza con `= + - @` lleva un apóstrofo delante para que
  una hoja de cálculo no lo ejecute como fórmula.
- Montos: la notación científica admite exponentes de hasta ±30 y 40 dígitos; más allá es `ErrorMonto` (422), sin
  calcular nada.
- El cuerpo debe ser UTF-8 válido (400 `CUERPO_NO_UTF8`): un byte en otra codificación no se convierte en «?»
  dentro de un documento inmutable. Tamaño máximo: 512 KB (413 `CUERPO_DEMASIADO_GRANDE`).
- Si Postgres se reinicia o cierra una conexión inactiva, la API lo registra en una línea y abre otra conexión
  en la siguiente consulta. El `docker-compose.yml` reinicia los dos servicios (`restart: unless-stopped`).
- Errores internos sin detalles para el cliente.

**Pendientes conocidos:** las claves de idempotencia no caducan; el `docker-compose.yml` conecta la API como
superusuario de Postgres (en producción usa un rol LOGIN que no sea dueño de las tablas); las llaves del
primer arranque quedan en `docker compose logs` (cópialas y rota el log); el id de entrega viene de una
secuencia global.

**Producción:** Postgres con contraseña y TLS, `FHN_CLAVE_CIFRADO`, la API detrás de un proxy con HTTPS. El
`docker-compose.yml` del repositorio es para probar en tu máquina (Postgres sin contraseña en 127.0.0.1).
