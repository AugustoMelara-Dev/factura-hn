# Resiliencia: PostgreSQL que se reinicia, cortes de red y webhooks caídos

Medido el 25 de noviembre de 2026 en Windows 11 (20 núcleos, Node 24.22), con PostgreSQL 18.1 nativo como base
desechable: los números de este informe salen de ese equipo. El CI corre las mismas pruebas y comprobaciones en
Linux, en un runner de GitHub de 4 vCPU; lo que allí se exige no depende de la velocidad (sin huecos, sin
repetidos, un documento por clave, solo 503 claros), salvo la comparación de la emisión con y sin receptor
colgado, que usa la mediana y un margen amplio.

```bash
pnpm resiliencia            # versión corta (CI): unos 30 s
pnpm resiliencia --larga    # versión nocturna: 5 reinicios y 5 caídas, más avisos y rondas de fallas
```

`pnpm resiliencia` crea un PostgreSQL desechable con los binarios locales (`scripts/pg-temporal.mjs`: `initdb` y
`pg_ctl`, en `.pg-temporal/`, puerto 55440), corre las pruebas que lo detienen y lo arrancan, y lo borra al
terminar. Nunca reinicia la base de `pnpm test:pg` ni el contenedor de Docker Compose. Si los binarios no están en
la ruta habitual, indícala con `FHN_PG_BIN`. Las pruebas de webhooks caídos no reinician la base: su versión corta
corre en `pnpm test:pg`.

## Escenarios y resultado

| Escenario | Prueba | Resultado |
|---|---|---|
| Emisión bloqueada **dentro** de su transacción (esperando el candado de la serie) cuando PostgreSQL se detiene | `packages/api/test/resiliencia/reinicio-pg.test.ts` | 503 `BASE_NO_DISPONIBLE` con `Retry-After` y la solución; con la base abajo, otra emisión también recibe el 503 (no se cuelga). Al volver la base, el reintento con la misma clave emite **una vez**, con el número siguiente; repetirlo da el mismo documento |
| Tráfico en 4 cajas (8 trabajadores) mientras PostgreSQL se **reinicia** (`pg_ctl stop -m fast`, 2 s abajo) | ídem | 266 documentos, 142 respuestas 503 durante la caída y ninguna de otro tipo; 0 duplicados, 0 huecos, una clave por documento; la API siguió emitiendo después sin reiniciarla |
| Lo mismo con PostgreSQL **caído** (`-m immediate`, recuperación del WAL al arrancar) | ídem | 274 documentos, 137 respuestas 503; 0 duplicados, 0 huecos, una clave por documento |
| **Commit incierto**: la conexión entre la API y PostgreSQL se corta justo después de que PostgreSQL confirmó la emisión, antes de que la API reciba la confirmación (un proxy TCP descarta la respuesta al `COMMIT`) | `packages/api/test/resiliencia/commit-incierto.test.ts` (en `pnpm test:pg`) | 503 `BASE_NO_DISPONIBLE`: la API no sabe si emitió. El documento quedó; el reintento con la misma clave devuelve el **mismo** documento (`Idempotency-Replayed: true`) y la venta siguiente toma el número siguiente |
| La **respuesta se pierde** después de que la API emitió (corte de red a la vuelta, dos veces) | `packages/cliente/test/resiliencia.test.ts` | El cliente lanza el error de red; el reintento con la misma `idempotencyKey` devuelve el mismo documento (`repetida: true`). La venta siguiente toma el número siguiente: el corte no consumió números |
| La API **no se alcanza** (corte de red a la ida) | ídem | El cliente lanza el error de `fetch` (no un `ErrorFacturaHN`) y no reintenta solo: lo hace el integrador, con la misma clave |
| PostgreSQL se reinicia con el **cliente** emitiendo | ídem | `ErrorFacturaHN` con `estado: 503`, `codigo: 'BASE_NO_DISPONIBLE'`, `solucion` y `documentacion`; el reintento emite una vez |
| Receptor de webhooks **caído** (puerto cerrado), que **corta** la conexión, que **no responde** (tiempo agotado) y que responde **500**, una fase tras otra | `packages/api/test/resiliencia/webhooks-caidos.test.ts` | Cada intento deja la entrega `PENDIENTE` con su error (`Error de red`, `Tiempo agotado`, `HTTP 500`) y el próximo intento según el calendario de producción (30 s, 1 min, 2 min, 4 min… ±20 %); antes de su momento no se reintenta. Al volver el receptor, los 30 avisos (120 en la versión larga) se entregan; el receptor vio todos los ids, y los repetidos llegan con el mismo `X-FacturaHN-Entrega` |
| Receptor **colgado** mientras se emite, con un pool de 4 conexiones | ídem | El despacho no retiene conexiones (el HTTP corre fuera de la transacción: nunca se agota el pool) y la emisión no se frena: p95 de 92 ms sin webhook y de 88 ms con el receptor colgado (base compartida de Docker). Se exige la mediana (con colgado < 2 × sin webhook + 25 ms) |
| Avisos **acumulados** durante el corte | ídem | 70 avisos (500 en la versión larga) salen en una sola pasada del despacho; antes salían de a 20 cada 5 s |

## Lo que se corrigió

- **500 en lugar de un error claro.** Con la base caída, la API respondía 500 `ERROR_INTERNO` y dejaba una traza
  por solicitud. Ahora responde 503 `BASE_NO_DISPONIBLE` con `Retry-After` y una solución que dice que reintentar
  con la misma `Idempotency-Key` no emite dos veces (ver [errores](../errores.md#base_no_disponible)).
- **Webhooks que no alcanzaban a la emisión.** El despacho entregaba a lo sumo 20 avisos por tenant cada 5 s
  (4 por segundo); ahora sigue con el lote siguiente mientras haya vencidos; pasados 30 s no reclama lotes nuevos (el lote en curso termina).

La numeración no necesitó cambios: en ningún escenario se perdió ni se repitió un número.

## En el CI y de noche

- **CI** (`ci.yml`, trabajo «Postgres»): `pnpm resiliencia` (reinicio, caída y cliente, unos 30 s) y, dentro de
  `pnpm test:pg`, los webhooks caídos en su versión corta y el commit incierto.
- **Nocturno** (`nocturno.yml`): `pnpm resiliencia --larga`: 5 reinicios y 5 caídas de 4 s con tráfico, 120
  avisos con tres rondas de cada falla, 500 avisos acumulados.

Una corrida de la versión larga en local (Windows, PostgreSQL 18 nativo) tardó 2 min 46 s: reinicio `fast`, 770
documentos y 1143 respuestas 503 en 5 caídas; caída `immediate`, 784 documentos y 1157 respuestas 503 en 5 caídas;
0 huecos y 0 repetidos; 500 avisos acumulados vaciados en una pasada de 1,6 s; p95 de emisión de 21,6 ms sin
webhook y 21,0 ms con el receptor colgado. Si una prueba de la API deja la base detenida, `scripts/resiliencia.mjs`
la arranca (y muestra el final de su registro) antes de las del cliente.
