---
"@factura-hn/api": minor
---

La API puede correr con un rol LOGIN propio que no es dueño de las tablas: `FHN_MIGRAR_URL` (el dueño) solo migra y prepara el modo local al arrancar, y la migración crea el rol de `DATABASE_URL` si no existe (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`) y le concede `fhn_app`. El `docker-compose.yml` usa `fhn_api`. Con `FHN_MIGRAR_URL`, la API no arranca si `DATABASE_URL` usa el mismo usuario que el dueño, o un rol que sea, o del que sea miembro, superusuario, con BYPASSRLS, `pg_write_all_data`, `pg_read_all_data` o dueño de las tablas. Sin `FHN_MIGRAR_URL`, todo sigue como antes y el log lo avisa. El dueño de las tablas ya no necesita ser superusuario (Postgres administrado): la autenticación de llaves también funciona así.

**Al actualizar con un `docker-compose.override.yml` con contraseñas** (con `DATABASE_URL: postgres://postgres:…`): crea `fhn_api` con su contraseña (`CREATE ROLE fhn_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` y `\password fhn_api`) y define en el override las dos URL, `DATABASE_URL` con `fhn_api` y `FHN_MIGRAR_URL` con `postgres`, cada una con su contraseña; o, para seguir como antes, `FHN_MIGRAR_URL: ""`. Detalle en la sección «Actualizar» de `docs/autoalojamiento.md`.

El servidor ya no imprime la llave admin del tenant `local`: dice cómo crearla con la consola (`docker compose exec api node cli.cjs llave crear local --rol admin --nombre Administración`), que la imprime solo en la terminal del operador. Las llaves del demo siguen en el log, marcadas como de una demostración sin validez fiscal. La consola da un error claro si el tenant no existe.

Retención con `FHN_RETENCION_DIAS` (30 por defecto, mínimo 7), al arrancar y cada hora: la respuesta guardada de una clave de idempotencia vieja se reduce al número del documento, pero la clave no caduca y un reintento tardío devuelve el mismo documento (con su estado actual) sin emitir otro. Las entregas de webhooks `ENTREGADA` o `FALLIDA` viejas de `documento.*` se borran; las de `autorizacion.*` se quedan con el cuerpo vacío, para no repetir el aviso.

El id de entrega de los webhooks (`X-FacturaHN-Entrega` y `id` del cuerpo) es un UUID, ya no un número de una secuencia global. Cada tenant tiene a lo sumo 20 webhooks activos (409 `LIMITE_WEBHOOKS`). El resultado tardío de una entrega cuyo arrendamiento venció ya no devuelve a `PENDIENTE` una entrega que otra pasada entregó.

Sin `FHN_MODO`, la API avisa que corre en modo local. En modo local no arranca si la base tiene en uso tenants distintos de `local` y `demo`; el error dice cómo seguir (`FHN_MODO=alojado`, o el SQL para desactivar esos tenants).
