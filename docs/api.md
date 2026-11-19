# API REST de factura-hn (`@factura-hn/api`)

Hono + OpenAPI 3.1 + PostgreSQL. El mismo código sirve dos modos:

| Modo | Para quién | Tenants | Webhooks |
|---|---|---|---|
| `local` (por defecto) | Un negocio con su propio servidor y base en el establecimiento (Art. 47) | Uno: `local` | http o https, también hacia la red del negocio |
| `alojado` | Un operador que sirve a varios negocios | Varios, aislados con RLS | Solo https y nunca hacia direcciones internas |

> **Modo alojado:** su encaje con el Art. 47 («el establecimiento donde se encuentre el servidor») está
> pendiente de la consulta P-02 al SAR (`docs/consulta-sar.md`), que aún no se ha enviado. Mientras tanto, la recomendación es el modo local.

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

Si perdiste una llave: `docker compose exec api node cli.cjs llave crear local --rol admin --nombre "nueva"`.
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

### Quién hizo cada operación (DEC-031)

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
| `GET /v1/documentos?desde&hasta[&identificador]` | caja | |
| `GET /v1/documentos/{numero}[.pdf\|.html\|.txt]` | caja | `?formato=carta\|ticket` (PDF), `?ancho=` (TXT) |
| `POST /v1/documentos/{numero}/anular` | admin | Art. 41 |
| `POST /v1/series/{id}/corregir-fecha` | admin | Reloj adelantado (Arts. 41 y 43) |
| `GET /v1/series/{id}/no-utilizados` | admin | Art. 42 |
| `GET /v1/libro-ventas?desde&hasta&formato=json\|csv` | caja | |
| `GET /v1/exportacion?desde&hasta&formato=jsonl\|csv\|txt` | admin | Art. 53 num. 5 |
| `GET /v1/bitacora` | admin | Bitácora fiscal (núcleo) y de la API |
| `POST/GET /v1/llaves` · `DELETE /v1/llaves/{prefijo}` | admin | La llave completa se muestra solo al crearla |
| `POST/GET /v1/webhooks` · `DELETE /v1/webhooks/{id}` | admin | El secreto se muestra solo al crearlo |

Los períodos (`desde`, `hasta`) son de hasta 366 días.

Errores: `{ "error": { "codigo", "mensaje" }, "errores"?: [{ codigo, mensaje, campo }] }`.
400 forma inválida · 401 llave · 403 rol o caja · 404 · 409 conflicto · 413 cuerpo > 512 KB ·
**422 reglas fiscales** (lista completa de `errores`) · 429 límites (`Retry-After`).

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
y un despachador los entrega cada 5 s: hasta 8 intentos con espera creciente (30 s, 1 min, 2 min, … 6 h).
Cada entrega se reclama en una transacción corta y el HTTP corre fuera de ella, en paralelo por tenant: un
receptor lento no frena a los demás. Lo pendiente de un webhook desactivado no se entrega.

```ts
import { verificarFirmaWebhook } from '@factura-hn/api';
// Express: app.post('/hook', express.raw({ type: 'application/json' }), (req, res) => { … })
const cuerpo = req.body.toString('utf8'); // crudo, antes de JSON.parse
if (!verificarFirmaWebhook(cuerpo, req.header('x-facturahn-firma'), process.env.SECRETO_WEBHOOK)) return res.sendStatus(400);
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
- CSV (libro de ventas y exportación): el texto que empieza con `= + - @` lleva un apóstrofo delante para que
  una hoja de cálculo no lo ejecute como fórmula.
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
