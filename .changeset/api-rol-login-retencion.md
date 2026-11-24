---
"@factura-hn/api": minor
---

La API puede correr con un rol LOGIN propio que no es dueño de las tablas: `FHN_MIGRAR_URL` (el dueño) solo migra y prepara el modo local al arrancar, y la migración crea el rol de `DATABASE_URL` si no existe (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`) y le concede `fhn_app`. El `docker-compose.yml` usa `fhn_api`. Sin `FHN_MIGRAR_URL`, todo sigue como antes y el log lo avisa.

El servidor ya no imprime la llave admin del tenant `local`: dice cómo crearla con la consola (`docker compose exec api node cli.cjs llave crear local --rol admin --nombre Administración`), que la imprime solo en la terminal del operador. Las llaves del demo siguen en el log, marcadas como de una demostración sin validez fiscal.

Retención con `FHN_RETENCION_DIAS` (30 por defecto, mínimo 7), al arrancar y cada hora: la respuesta guardada de una clave de idempotencia vieja se reduce al número del documento, pero la clave no caduca y un reintento tardío devuelve el mismo documento (con su estado actual) sin emitir otro; las entregas de webhooks `ENTREGADA` o `FALLIDA` viejas se borran.

El id de entrega de los webhooks (`X-FacturaHN-Entrega` y `id` del cuerpo) es un UUID, ya no un número de una secuencia global. Cada tenant tiene a lo sumo 20 webhooks activos (409 `LIMITE_WEBHOOKS`). El resultado tardío de una entrega cuyo arrendamiento venció ya no devuelve a `PENDIENTE` una entrega que otra pasada entregó.

Sin `FHN_MODO`, la API avisa que corre en modo local; en modo local no arranca si la base tiene tenants distintos de `local` y `demo`.
