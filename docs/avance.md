# Avance

Archivo para retomar el trabajo en una sesión nueva. Se actualiza en cada commit importante.

## Estado

- **Rama:** `fase-1-sdk-0.2` (se fusiona a `main` al cerrar la Fase 1; sin push).
- **Fase actual:** 1, lote 1 (cerrar la Fase 1).
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

## Sigue

1. Ajuste B-13 (AVISO_ORIGINAL_EXTERNO) y README sin avisos en el ejemplo principal.
2. Paso 8: B-07 documentos no utilizados (Art. 42), B-11 aviso de renovación a 60 días.
3. Paso 9: B-10 exportación en texto (Art. 53) y gancho contable.
4. Paso 10: B-09 CAI sin aviso por defecto, B-14, B-16.
5. Paso 11: `@factura-hn/pdf` (pdf-lib).
6. Paso 12: build ESM+CJS, README, matriz con prueba por fila, versión 0.2.0.
7. Revisión independiente con subagente; correcciones; merge a `main`.
8. Fase 2 (API) y Fase 3 (cliente, MCP, ejemplos, playground).

## Cómo correr

```bash
pnpm install && pnpm test && pnpm typecheck
docker compose up -d --wait db   # solo el contenedor de factura-hn
FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn pnpm --filter @factura-hn/postgres test
```
