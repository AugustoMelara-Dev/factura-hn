# Carga: latencia, rendimiento, numeración e idempotencia al emitir

Medido el 25 de noviembre de 2026 en un equipo de desarrollo con Windows 11 (20 núcleos, Node 24.22): todos los
números de este informe salen de ese equipo. El CI corre las mismas comprobaciones con los umbrales del perfil `ci`,
en un runner de GitHub de 4 vCPU que reparte el CPU entre la API, autocannon, PostgreSQL y el receptor; esos
umbrales se calibran con las primeras corridas en GitHub. La API corre en su propio proceso
(`packages/api/carga/servidor.ts`: la de producción con el límite por llave levantado, porque se mide la emisión
y no el limitador) y el generador en otro.

```bash
FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn_pruebas pnpm carga local   # o ci, nocturno
pnpm carga local cajas=16 conexiones=64 webhook=0                                    # ajustes del perfil
FHN_CARGA_PERFILAR=1 pnpm carga ci   # además, un perfil de CPU de la API en packages/api/carga/resultados/
```

Cada medición crea un tenant nuevo con varias cajas (una autorización por caja), dos llaves por caja y un webhook
hacia un receptor local, y tiene dos fases:
1. **A tasa fija** (25 o 30 emisiones por segundo, en lazo abierto, por debajo de la saturación): la latencia de
   una emisión sin cola. Ahí se exigen p50, p95 y p99.
2. **Saturación** (todas las conexiones emiten sin pausa, con autocannon): el rendimiento máximo. La latencia en
   saturación solo mide la cola (conexiones ÷ rendimiento): se informa, no se exige.

En las dos fases, un 5 % de las solicitudes reusa una clave de un grupo chico por caja (la misma
`Idempotency-Key` llega a la vez por varias conexiones), y en la de saturación hay además ráfagas de 8 solicitudes
simultáneas con la misma clave. Al final se revisa contra la base: sin correlativos repetidos ni faltantes en
ninguna serie (de 1 al último), `fhn_series` al día, una clave por documento, cada clave con un solo número en
todas sus respuestas y el mismo que guarda la base, y todos los avisos de webhook entregados.

## Resultados

Perfil `local`: 8 cajas, 16 llaves, 30 s a 30/s y 30 s con 32 conexiones.

| | Base compartida (PostgreSQL 16 en Docker, WSL2) | PostgreSQL 18 nativo |
|---|---|---|
| p50 / p95 / p99 a 30/s | **73 / 104 / 127 ms** | 19 / 37 / 56 ms |
| Rendimiento en saturación | **61 documentos/s** | 133 documentos/s |
| p50 / p95 / p99 en saturación (32 conexiones) | 498 / 895 / 1107 ms | 211 / 440 / 589 ms |
| Documentos emitidos | 2810 | 4964 |
| Respuestas | 3119 × 201, ninguna otra | 5368 × 201, ninguna otra |
| Repeticiones con la misma clave | 421 | 515 |
| Claves con más de un número | 0 | 0 |
| Correlativos repetidos / series con huecos | 0 / 0 | 0 / 0 |
| Avisos de webhook | 2810 de 2810, 3 s después de la carga | 4964 de 4964, 4 s después |

Perfil `ci` (4 cajas, 25/s y 16 conexiones, 20 s cada fase) en PostgreSQL nativo: p50 19 ms, p95 56 ms, p99
107 ms a 25/s; unos 100 a 130 documentos/s en saturación; 0 duplicados, 0 huecos, 0 claves con más de un número.
Repetido tras la revisión en un clúster propio: p50 20 / p95 37 / p99 56 ms a 25/s, 158 documentos/s, 3707
documentos, 0 errores. Contra la base compartida de Docker con otras pruebas corriendo a la vez (77 % de CPU) dio
p95 305 ms y p99 610 ms a 25/s: por encima de los umbrales, con la integridad intacta. Es la señal de que en un
runner de 4 vCPU los umbrales de latencia del perfil `ci` pueden quedar justos y hay que calibrarlos allí.

**Dónde se va el tiempo.** Una emisión hace 30 consultas en 4 transacciones (llave, idempotencia, emisor y la
emisión con su aviso, bitácora y uso). En la base de Docker sobre WSL2 cada ida y vuelta cuesta más: de ahí los
73 ms frente a 19 ms. En saturación con la base nativa manda el CPU de la API (un solo proceso de Node). Sin
webhook, el rendimiento nativo sube a unos 190 documentos/s: cada entrega abre una conexión y escribe su resultado.
Con 16 series en lugar de 4 el rendimiento no cambia: el candado por serie no es el cuello de botella.

## Umbrales

Fijados en `packages/api/carga/perfiles.json`. Una medición que no los cumple termina con código 1.

| Medida | Umbral | Por qué |
|---|---|---|
| p50 / p95 / p99 a tasa fija | ≤ 100 / 300 / 600 ms | Unas 5 veces lo medido en la base nativa y holgado para la de Docker: los runners del CI son más lentos y variables |
| Rendimiento en saturación | ≥ 40 documentos/s (`local`, `nocturno`); ≥ 30 (`ci`) | Dos tercios de la base de Docker; muy por encima de lo que emite un negocio (decenas de cajas, una venta cada pocos segundos). En el CI, más bajo: el runner tiene 4 vCPU compartidas |
| Respuestas que no son 201 y errores de red a tasa fija | 0 | Sin cola y con el límite por llave levantado: cualquier error es un problema |
| Respuestas que no son 201 en saturación | 0 | Ídem |
| Tiempos agotados y errores de red en saturación | tolerados, si la integridad se cumple | Con la API saturada, una solicitud puede esperar más que el tiempo máximo de autocannon (10 s) en un runner lento; lo que importa es que la emisión que pudo pasar no deje huecos, repetidos ni claves con dos números |
| Correlativos repetidos, huecos, `fhn_series` desalineada | 0 | Regla del proyecto: correlativos atómicos y sin huecos |
| Documentos sin clave, claves sin documento, claves con más de un número | 0 | Idempotencia bajo carga |
| Avisos de webhook | todos entregados (hasta 2 min después) | Nada se pierde |

## Lo que encontró

- **El despacho de webhooks no alcanzaba a la emisión.** Entregaba a lo sumo 20 avisos por tenant cada 5 s (4 por
  segundo); con más de 100 documentos por segundo la cola crecía sin fin. Ahora sigue con el lote siguiente
  mientras haya vencidos (sin reclamar lotes nuevos pasados 30 s): los avisos quedan entregados segundos después de la carga.
- **`fechaHonduras` creaba un `Intl.DateTimeFormat` en cada llamada**, cerca del 8 % del CPU de la API en la
  emisión. Ahora lo reusa: de unos 107 a unos 124 documentos/s en saturación (base nativa, con webhook).

## En el CI y de noche

- **CI** (`ci.yml`, trabajo «Postgres»): `pnpm carga ci`, unos 60 s contra el servicio de PostgreSQL del trabajo.
- **Nocturno** (`nocturno.yml`): `pnpm carga nocturno`: 16 cajas, 5 min a 30/s y 5 min con 64 conexiones.

En GitHub Actions el resultado se resume en la página de la ejecución; en local queda en
`packages/api/carga/resultados/<perfil>-<fecha>.json` (ignorada por git).
