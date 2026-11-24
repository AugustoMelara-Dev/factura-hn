# Autoalojamiento con Docker

La API de factura-hn y su base PostgreSQL corren en un equipo del negocio con Docker Compose. Así varias
cajas de la red local emiten contra el mismo correlativo, y los documentos quedan en el establecimiento
(los sistemas alojados por terceros están pendientes de una consulta al SAR).

Necesitas Docker con Compose v2 y unos 300 MB de disco para las imágenes.

## Probar en 2 minutos

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git
cd factura-hn
docker compose up -d --build --wait
docker compose logs api        # llaves: se muestran UNA sola vez
```

Abre <http://127.0.0.1:8787/docs>, pulsa **Authorize** y pega la **llave de caja demo**. El tenant `demo` usa
un emisor y un CAI **ficticios** (`DEMO00-NO-VALIDO-…`): lo que emitas ahí no tiene validez fiscal.

```bash
LLAVE=fhn_...   # la llave de caja demo del log
# El cuerpo va en un archivo UTF-8: escrito en la línea de comandos, una consola de Windows puede mandar la
# «é» en otra codificación, y la API lo rechaza (400 CUERPO_NO_UTF8).
cat > factura.json <<'JSON'
{"documento":{"preciosIncluyenISV":true,"lineas":[{"descripcion":"Café","cantidad":"2","precioUnitario":"57.50"}]}}
JSON
curl -X POST http://127.0.0.1:8787/v1/documentos \
  -H "authorization: Bearer $LLAVE" -H "idempotency-key: venta-0001" -H "content-type: application/json" \
  --data-binary @factura.json
curl -H "authorization: Bearer $LLAVE" -o factura.pdf \
  http://127.0.0.1:8787/v1/documentos/000-001-01-00000001.pdf
```

Para empezar de cero (borra **todos** los datos): `docker compose down -v`.

## Poner en marcha un negocio

1. **Sin demostración.** En `docker-compose.yml`, `FHN_DEMO: "0"`, o bórralo. El tenant `local` es el de tu
   negocio y arranca vacío.
2. **Contraseña de la base, antes del primer arranque.** El `docker-compose.yml` del repositorio usa `trust`
   porque la base no sale de la red interna de Compose. En un equipo compartido, define una contraseña en un
   archivo `.env` que **no** se versiona. Postgres la aplica solo al crear la base: si ya arrancaste, empieza
   con `docker compose down -v` (borra los datos) antes de emitir documentos reales.

   ```bash
   # .env (junto a docker-compose.yml; agrega .env a tu .gitignore)
   POSTGRES_PASSWORD=una-contraseña-larga-y-aleatoria
   ```

   ```yaml
   # docker-compose.override.yml
   services:
     db:
       environment:
         POSTGRES_HOST_AUTH_METHOD: scram-sha-256
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
     api:
       environment:
         DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/factura_hn
   ```

3. **Arranca y guarda la llave admin** del log en un gestor de contraseñas.
4. **Configura con la llave admin** (desde `/docs` o con `curl`):
   - el emisor: `POST /v1/emisores` (los siete datos del Art. 10 num. 1);
   - cada CAI de tu resolución: `POST /v1/autorizaciones`, uno por tipo de documento y punto de emisión;
   - una llave de **caja** por punto de emisión: `POST /v1/llaves` con `rol: "caja"`, `establecimiento` y
     `puntoEmision`. Cada caja usa solo su llave.
5. **Cajas en la red local.** La API escucha en `127.0.0.1`. Para que otras computadoras la alcancen, pon
   delante un proxy con TLS (Caddy, nginx) en la IP del equipo, o cambia el puerto publicado a la IP de la red
   local (`"192.168.1.10:8787:8787"`) solo si la red es de confianza. Nunca la publiques a Internet sin TLS.

## Respaldos

Los documentos fiscales no se borran ni se editan; el respaldo es lo que los protege de un disco dañado.

```bash
# Respaldo diario (cópialo fuera del equipo: disco externo o nube del negocio)
docker compose exec -T db pg_dump -U postgres -d factura_hn -Fc > respaldo-$(date +%F).dump

# Restaurar en una instalación nueva, antes de emitir nada
docker compose up -d --wait db
docker compose exec -T db pg_restore -U postgres -d factura_hn --clean --if-exists < respaldo-AAAA-MM-DD.dump
docker compose up -d --wait
```

Prueba la restauración al menos una vez. El plazo de conservación está pendiente de una consulta al SAR: mientras tanto, conserva todo.

## Actualizar

```bash
git pull
docker compose up -d --build --wait   # las migraciones corren solas al arrancar y no borran datos
```

Antes de actualizar, haz un respaldo. Lee el `CHANGELOG.md`: mientras la versión sea 0.x, una versión menor
puede traer cambios incompatibles.

## Llaves

| Necesito | Comando |
|---|---|
| Ver las llaves (sin el secreto) | `GET /v1/llaves` con la llave admin |
| Otra llave de caja | `POST /v1/llaves` |
| Revocar una llave | `DELETE /v1/llaves/{prefijo}` |
| Perdí la llave admin | `docker compose exec api node cli.cjs llave crear local --rol admin --nombre "nueva"` |
| Perdí la llave de caja del demo | `docker compose exec api node cli.cjs llave crear demo --rol caja --nombre "caja demo 2" --caja 000-001` |

La base guarda solo el hash de cada llave: una llave perdida no se recupera, se reemplaza.

## Variables de entorno

| Variable | Por defecto | |
|---|---|---|
| `DATABASE_URL` | (obligatoria) | Conexión de Postgres (13 o más reciente) |
| `FHN_MODO` | `local` | `local` (un negocio) o `alojado` (varios tenants) |
| `FHN_ROL` | `fhn_app` | Rol sin BYPASSRLS con el que corre cada transacción |
| `FHN_CLAVE_CIFRADO` | — | 32 bytes en base64 para cifrar los secretos de los webhooks. Obligatoria en `alojado` |
| `PUERTO` / `FHN_HOST` | `8787` / `0.0.0.0` | Dentro del contenedor |
| `FHN_DEMO` | — | `1`: crea el tenant de demostración con datos ficticios |

Referencia completa de la API: [guía de la API](api.md).
