# Autoalojamiento con Docker

La API de factura-hn y su base PostgreSQL corren en un equipo del negocio con Docker Compose. Así varias
cajas de la red local emiten contra el mismo correlativo, y el servidor queda en el establecimiento que el
negocio registra (el Art. 47 pide registrar «el establecimiento donde se encuentre el servidor»).

Necesitas Docker con Compose v2 y unos 300 MB de disco para las imágenes.

## Probar en 5 minutos

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git
cd factura-hn
docker compose up -d --build --wait     # otro puerto: FHN_PUERTO=8788 docker compose up -d --build --wait
```

El tenant `demo` usa un emisor y un CAI **ficticios** (`DEMO00-NO-VALIDO-…`): lo que emitas ahí no tiene
validez fiscal. Su llave de caja sale una vez en el log (`docker compose logs api`), en un bloque que dice
«CAI FICTICIO». Con ella, la primera factura sale en tres pasos (en PowerShell, ver la [guía de la API](api.md)):

```bash
LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)   # 1. otra llave de caja del demo
VENTA="venta-$(date +%s)"                                                     #    una clave nueva por venta
PDF=$(curl -sf -X POST http://127.0.0.1:8787/v1/documentos \
  -H "authorization: Bearer $LLAVE" -H "idempotency-key: $VENTA" -H "content-type: application/json" \
  --data-binary @packages/api/ejemplos/factura.json | sed -n 's/.*"pdf":"\([^"]*\)".*/\1/p')   # 2. emite
curl -f -H "authorization: Bearer $LLAVE" -o factura.pdf "http://127.0.0.1:8787$PDF"          # 3. el PDF
```

También puedes abrir <http://127.0.0.1:8787/docs>, pulsar **Authorize** y pegar la llave. `GET /v1/sesion` dice
con qué llave hablas y qué falta para emitir.

Para empezar de cero (borra **todos** los datos): `docker compose down -v`.

## La consola del operador

Las llaves y los tenants se crean con la consola `factura-hn-api`, que corre dentro del contenedor de la API:

```bash
docker compose exec api factura-hn-api ayuda          # lista los comandos
docker compose exec api factura-hn-api <comando> --help
```

Así aparece en esta guía, en la [guía de la API](api.md) y en los mensajes del servidor.

Sin Docker (la API arrancada con `node packages/api/dist/servidor.js`, ver «Sin Docker» en la
[guía de la API](api.md#sin-docker)), la misma consola es `node packages/api/dist/cli.js <comando>`, con las mismas
variables `DATABASE_URL` y `FHN_MIGRAR_URL`.

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
   FHN_API_PASSWORD=otra-contraseña-larga-y-aleatoria
   ```

   ```yaml
   # docker-compose.override.yml
   services:
     db:
       environment:
         POSTGRES_HOST_AUTH_METHOD: scram-sha-256
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
         FHN_API_PASSWORD: ${FHN_API_PASSWORD}
     api:
       environment:
         DATABASE_URL: postgres://fhn_api:${FHN_API_PASSWORD}@db:5432/factura_hn
         FHN_MIGRAR_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/factura_hn
   ```

   La API corre como `fhn_api`, un rol que no es dueño de las tablas; `postgres` solo migra al arrancar. Al
   crear la base, `scripts/db-init/10-rol-api.sh` crea `fhn_api` con la contraseña de `FHN_API_PASSWORD`.
   Arranca:

   ```bash
   docker compose up -d --build --wait
   ```

3. **Crea la llave admin** de tu negocio y guárdala en un gestor de contraseñas. No sale en el log del
   servidor: la consola la imprime solo en tu terminal.

   ```bash
   docker compose exec api factura-hn-api llave crear local --rol admin --nombre Administración
   ```
4. **Configura con la llave admin** (desde `/docs` o con `curl`):
   - el emisor: `POST /v1/emisores` (los siete datos del Art. 10 num. 1);
   - cada CAI de tu resolución: `POST /v1/autorizaciones`, uno por tipo de documento y punto de emisión;
   - una llave de **caja** por punto de emisión: `POST /v1/llaves` con `rol: "caja"`, `establecimiento` y
     `puntoEmision`. Cada caja usa solo su llave.
5. **Cajas en la red local.** La API escucha en `127.0.0.1`. Para que otras computadoras la alcancen, pon
   delante un proxy con TLS (Caddy, nginx) en la IP del equipo, o cambia el puerto publicado a la IP de la red
   local (`"192.168.1.10:8787:8787"`) solo si la red es de confianza. Nunca la publiques a Internet sin TLS. Con
   el proxy, define `FHN_PROXIES_DE_CONFIANZA` en el servicio `api` con la dirección del proxy tal como la ve
   la API (p. ej. `"172.18.0.5"`): así el límite de intentos distingue cada caja y una solicitud que no pase por
   el proxy no puede elegir su cubeta. También acepta el número de proxies (`"1"`), pero **solo si a la API se
   llega únicamente por el proxy**: deja el puerto publicado en `127.0.0.1` (ver «Límites de solicitudes» en la
   [guía de la API](api.md)).

## Respaldos

Los documentos fiscales no se borran ni se editan; el respaldo es lo que los protege de un disco dañado.

```bash
# Respaldo diario (cópialo fuera del equipo: disco externo o nube del negocio)
docker compose exec -T db pg_dump -U postgres -d factura_hn -Fc > respaldo-$(date +%F).dump
```

Para restaurar en una instalación nueva, antes de emitir nada: arráncala completa una vez (crea los roles que el
respaldo necesita), detén la API, restaura y vuelve a arrancar. Si usas contraseñas, pon antes tu `.env` y tu
`docker-compose.override.yml`. Cambia `respaldo-AAAA-MM-DD.dump` por el nombre de tu respaldo:

```bash
docker compose up -d --build --wait
docker compose stop api
docker compose exec -T db pg_restore -U postgres -d factura_hn --clean --if-exists --single-transaction --exit-on-error < respaldo-AAAA-MM-DD.dump
docker compose up -d --wait
```

Prueba la restauración al menos una vez. El Reglamento remite el plazo de conservación al de prescripción del Código Tributario (Arts. 5 y 43) y no lo fija: mientras tanto, conserva todo.

## Actualizar

```bash
git pull
docker compose up -d --build --wait   # las migraciones corren solas al arrancar y no borran datos
```

**Si tienes un `docker-compose.override.yml` con contraseñas** (de una versión anterior de esta guía, con
`DATABASE_URL: postgres://postgres:…`): desde esta versión el `docker-compose.yml` separa el dueño de las tablas
(`FHN_MIGRAR_URL`) del rol con el que corre la API (`DATABASE_URL`, `fhn_api`). Antes de actualizar, elige una:

- **Recomendado:** agrega `FHN_API_PASSWORD` a tu `.env` y pon en tu override esa variable en el servicio `db` y
  **las dos** URL de la API, cada una con su contraseña (como en el ejemplo de «Poner en marcha un negocio»):

  ```yaml
  services:
    db:
      environment:
        FHN_API_PASSWORD: ${FHN_API_PASSWORD}
    api:
      environment:
        DATABASE_URL: postgres://fhn_api:${FHN_API_PASSWORD}@db:5432/factura_hn
        FHN_MIGRAR_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/factura_hn
  ```

  Después crea `fhn_api` con esa contraseña (la base ya existe, así que el script se corre a mano) y actualiza:

  ```bash
  docker compose up -d --wait db
  docker compose exec -T db sh -c 'sh /docker-entrypoint-initdb.d/10-rol-api.sh'
  docker compose up -d --build --wait
  ```

- **Seguir como antes:** en tu override, deja `DATABASE_URL` con `postgres` y anula la nueva variable con
  `FHN_MIGRAR_URL: ""`. La API corre como dueño de las tablas y lo avisa en el log.

Si no cambias nada, o solo cambias `FHN_MIGRAR_URL` y dejas `DATABASE_URL` con `postgres`, la API no arranca
y el log dice qué cambiar (tu override hereda `FHN_MIGRAR_URL` del `docker-compose.yml`, y las dos URL quedan con
el mismo usuario): no corre como superusuario creyendo que no lo es.

Antes de actualizar, haz un respaldo. Lee el `CHANGELOG.md`: mientras la versión sea 0.x, una versión menor
puede traer cambios incompatibles.

## Llaves

| Necesito | Comando |
|---|---|
| Ver las llaves (sin el secreto) | `GET /v1/llaves` con la llave admin |
| Otra llave de caja | `POST /v1/llaves` |
| Revocar una llave | `DELETE /v1/llaves/{prefijo}` |
| La primera llave admin del negocio | `docker compose exec api factura-hn-api llave crear local --rol admin --nombre Administración` |
| Perdí la llave admin | `docker compose exec api factura-hn-api llave crear local --rol admin --nombre "nueva"` |
| Perdí la llave de caja del demo | `docker compose exec api factura-hn-api demo llave` |

La base guarda solo el hash de cada llave: una llave perdida no se recupera, se reemplaza.

## Variables de entorno

| Variable | Por defecto | |
|---|---|---|
| `DATABASE_URL` | (obligatoria) | Conexión con la que corre la API (Postgres 13 o más reciente). En Compose, el rol `fhn_api`, que no es dueño de las tablas |
| `FHN_MIGRAR_URL` | — | Conexión del dueño de las tablas, para migrar al arrancar y para la consola. Sin ella, la API corre como dueño de las tablas y lo avisa en el log |
| `FHN_MIGRAR_AL_ARRANCAR` | `1` | `0`: la API no migra al arrancar ni necesita al dueño de las tablas; exige el esquema al día y que `DATABASE_URL` no sea dueño, superusuario ni `BYPASSRLS`. La migración corre aparte (`factura-hn-api migrar`). No sirve en modo local |
| `FHN_MODO` | `local` | `local` (un negocio) o `alojado` (varios tenants). Sin definir, la API avisa en el log que corre en modo local. En modo local no arranca si la base tiene tenants distintos de `local` y `demo` |
| `FHN_RETENCION_DIAS` | `30` | Días que se guarda la respuesta completa de una clave de idempotencia y una entrega de webhook terminada (mínimo 7). La clave en sí no caduca |
| `FHN_ROL` | `fhn_app` | Rol sin BYPASSRLS con el que corre cada transacción |
| `FHN_CLAVE_CIFRADO` | — | 32 bytes en base64 para cifrar los secretos de los webhooks. Obligatoria en `alojado` |
| `PUERTO` / `FHN_HOST` | `8787` / `0.0.0.0` | Puerto e interfaz del proceso (dentro del contenedor). Sin Docker, `FHN_HOST=127.0.0.1` en tu equipo: ver «Sin Docker» en la [guía de la API](api.md#sin-docker) |
| `FHN_DEMO` | — | `1`: crea el tenant de demostración con datos ficticios |
| `FHN_PUERTO` | `8787` | Puerto publicado en 127.0.0.1 por `docker-compose.yml` (variable de Compose, no de la API) |
| `FHN_PROXIES_DE_CONFIANZA` | `0` | Con un proxy (Caddy, nginx) delante de la API, la dirección del proxy (o varias, o rangos CIDR como `10.0.0.0/8`, separadas por comas): el límite de intentos usa la dirección de cada caja y no la del proxy. Un número de proxies (`1`) también sirve, pero solo si a la API se llega únicamente por el proxy (puerto publicado en `127.0.0.1`): si no, quien llegue directo elige su cubeta. Sin proxy, déjala en `0`: `X-Forwarded-For` lo escribe el cliente |
| `FHN_IP_CLIENTE_CABECERA` | — | Cabecera con la dirección del cliente que pone tu proxy de confianza, p. ej. `CF-Connecting-IP` detrás de Cloudflare. Tiene prioridad sobre `X-Forwarded-For`. Defínela solo si a la API se llega únicamente por ese proxy: cualquiera puede mandar la cabecera |

Las demás variables están en la [guía de la API](api.md#variables-de-entorno).

Referencia completa de la API: [guía de la API](api.md).
