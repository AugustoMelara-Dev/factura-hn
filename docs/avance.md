# Avance

Archivo para retomar el trabajo en una sesión nueva. Se actualiza en cada commit importante.

## Estado

- **Rama:** `fase-2-api` (la Fase 1 está fusionada en `main`, sin push).
- **Fase actual:** 2, API (lote 2).
- **Reglas de trabajo:** lotes por fase; decisiones en `docs/decisiones.md` ([REVISAR] si cambian la
  interpretación fiscal); Docker solo para `docker-compose.yml` de factura-hn; pedir permiso para npm, push,
  despliegues, cuentas, instalaciones globales, contenedores ajenos y licencia.

## Hecho (Fase 1)

| Paso | Commit |
|---|---|
| 1 Monorepo | d5411dc |
| 2 B-17 dinero exacto | 0969d7d |
| 3 B-03 redondeo Art. 9 | 3dbffdd |
| 4 B-08 reloj | f3ba012 |
| 5 B-06 anulación | c5eb224 |
| 6 B-04/B-18 AlmacenFiscal + SQLite + Postgres | baf9ac2, bc442ff, 434831a |
| Un solo camino (emitir/anular) | 62aa196 |
| Reloj adelantado + bitácora | 0f2b354 |
| 7 B-01, B-02, B-05, B-12, B-13, B-15 | 2ffb156 |
| Ajustes B-13 (AVISO_ORIGINAL_EXTERNO, ultimoEmitidoAntes) y README | bcd5d2d |
| 8 B-07 no utilizados, B-11 aviso a 60 días | d96c97c |
| 9 B-10 exportación a texto, LibroContable | 4331d56 |
| 10 B-09 CAI, B-14, B-16 | 696d1a4 |
| 11 @factura-hn/pdf | d0608e4 |
| 12 build ESM+CJS, matriz con prueba por fila, 0.2.0 | 70bfd5b |
| Postgres: RLS real y migraciones por versión | 9646887 |
| Correcciones de la revisión independiente de la matriz | 511aafd |

## Sigue

1. Fase 2 (API): Hono + OpenAPI + Postgres con RLS, modos alojado y local, llaves con roles, idempotencia,
   límites, webhooks firmados, exportación y libro, pruebas de punta a punta. Especificación original de
   endpoints: `docs/api.md`.
2. Fase 3: cliente tipado, MCP, ejemplos (Next.js, Express, POS offline), playground, prompts de una línea.
3. Al cerrar cada fase: resumen con conteo de pruebas y decisiones [REVISAR] de `docs/decisiones.md`.

## Cómo correr

```bash
pnpm install && pnpm test && pnpm typecheck
docker compose up -d --wait db   # solo el contenedor de factura-hn
FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn pnpm --filter @factura-hn/postgres test
```
