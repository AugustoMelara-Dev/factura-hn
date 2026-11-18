# API REST de factura-hn (`@factura-hn/api`)

Hono + OpenAPI 3.1 + PostgreSQL. El mismo código sirve dos modos:

| Modo | Para quién | Tenants | Webhooks |
|---|---|---|---|
| `local` (por defecto) | Un negocio con su propio servidor y base en el establecimiento (Art. 47) | Uno: `local` | http o https, también hacia la red del negocio |
| `alojado` | Un operador que sirve a varios negocios | Varios, aislados con RLS | Solo https y nunca hacia direcciones internas |

> **Modo alojado:** su encaje con el Art. 47 («el establecimiento donde se encuentre el servidor») está
> pendiente de la consulta P-02 al SAR (`docs/consulta-sar.md`). Mientras tanto, la recomendación es el modo local.

## Levantarla en tu máquina

```bash
docker compose up --build        # API en http://127.0.0.1:8787 y Postgres en 127.0.0.1:54329
docker compose logs api          # llaves admin y caja: se muestran una sola vez, al primer arranque
```

`docker-compose.yml` arranca con `FHN_DEMO=1`: emisor de demostración y **CAI ficticio**
(`DEMO00-NO-VALIDO-…`), que no sirve para facturar. En un negocio real quita esa línea, registra el emisor
y el CAI de tu resolución con la llave admin.

Documentación interactiva en `/docs` y especificación en `/openapi.json` (también en
`packages/api/openapi.json`, que se regenera con `pnpm --filter @factura-hn/api openapi`).

```bash
LLAVE=fhn_...   # la llave de caja del log
curl -X POST http://127.0.0.1:8787/v1/documentos \
  -H "authorization: Bearer $LLAVE" -H "idempotency-key: venta-0001" -H "content-type: application/json" \
  -d '{"documento":{"preciosIncluyenISV":true,"lineas":[{"descripcion":"Café","cantidad":2,"precioUnitario":"57.50"}]}}'
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
listados y en la bitácora; la base guarda solo el SHA-256 de la llave completa.

| | `caja` | `admin` |
|---|:-:|:-:|
| Emitir, consultar documentos, PDF/HTML/TXT, libro de ventas, autorizaciones y su estado, emisor | ✅ | ✅ |
| Registrar emisor y CAI, anular, `confirmarSaltoDeFecha`, corregir fecha adelantada, no utilizados | | ✅ |
| Exportación (Art. 53 num. 5), bitácora, llaves, webhooks | | ✅ |

Una llave de caja puede atarse a un establecimiento y punto de emisión: emite solo ahí (otro punto da 403).
No se puede revocar la única llave admin activa (409).

## Recursos

| Método y ruta | Rol | |
|---|---|---|
| `GET /salud`, `GET /openapi.json`, `GET /docs` | — | |
| `POST /v1/emisores` · `GET/PATCH /v1/emisores/{id}` | admin · caja/admin | Un emisor por tenant; el RTN no cambia; los cambios afectan solo a documentos futuros |
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
guarda la clave: corregida, puede reintentarse con la misma.

## Webhooks

Eventos: `documento.emitido`, `documento.anulado`, `autorizacion.por_vencer` (alerta del Art. 59 o 90 % del
rango) y `autorizacion.agotada`, una vez por autorización. Se encolan en la misma transacción de la operación
y un despachador los entrega cada 5 s: hasta 8 intentos con espera creciente (30 s, 1 min, 2 min, … 6 h).

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
- Límite de solicitudes por llave (20/s, ráfaga 40, en memoria por réplica) y de documentos por mes por
  tenant (en la base).
- Errores internos sin detalles para el cliente.

**Producción:** Postgres con contraseña y TLS, `FHN_CLAVE_CIFRADO`, la API detrás de un proxy con HTTPS. El
`docker-compose.yml` del repositorio es para probar en tu máquina (Postgres sin contraseña en 127.0.0.1).
