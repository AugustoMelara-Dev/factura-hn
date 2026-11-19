# Avance

Archivo para retomar el trabajo en una sesión nueva. Se actualiza en cada commit importante.

## Estado

- **Rama:** `main` (fases 1 a 4 fusionadas localmente; nada publicado ni empujado).
- **Fase actual:** 4, lanzamiento: preparado, esperando al responsable (`docs/lanzamiento.md`).
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
| Ajustes aprobados: DEC-013, DEC-018, DEC-019; consulta al SAR | c70529e |

## Hecho (Fase 2)

| Paso | Commit |
|---|---|
| API: esquema `api_*` con RLS, llaves, emisión idempotente, webhooks, Docker, pruebas de punta a punta | 3899538 |
| Correcciones de la revisión de seguridad (DEC-035) | 009ea03 |

## Hecho (Fase 3)

| Paso | Commit |
|---|---|
| `@factura-hn/cliente` y `@factura-hn/mcp` | 711d11d, 008eefc |
| POS fuera de línea (SQLite) | d651333 |
| `verificarFirmaWebhook` en el cliente; ejemplo Express 5 | aa043f1 |
| Ejemplo Next.js 16 | 5f01838 |
| Playground en el navegador | 512fb88 |
| Prompts SDK/API en README, AGENTS.md, llms.txt y skill, con prueba | f92d204 |
| Claves de idempotencia del MCP en SQLite; DEC-036 a DEC-038 | 2587741 |
| Pruebas de Postgres en su propia base | 97e2272 |
| Correcciones de la revisión independiente de la Fase 3 (DEC-039) | 148960a |
| Operador en la bitácora (DEC-031 aprobada con cambios); MCP solo SQLite en archivo y `server-only` (DEC-040) | d9d446c |
| Datos de ejemplo ficticios y `auditar:datos` | 3884adb |

## Hecho (Fase 4, preparación del lanzamiento)

- Paquetes listos para npm (procedencia, LICENSE, `verificar:dist`).
- CI (Node 22 y 24, Postgres como servicio, imagen Docker).
- Release con changesets y Pages, apagados por variable (DEC-041 a DEC-044).
- Archivos de comunidad y plantillas.
- Sitio (`pnpm sitio`).
- Modelo de negocio y pasos de lanzamiento.
- Repositorio público `AugustoMelara-Dev/factura-hn`, con `main` protegida y el CI en verde en GitHub.
- Publicación en npm con OIDC, sin tokens (`scripts/publicar.mjs`, DEC-042).

## Sigue

0. Plan v1 (`docs/plan-v1.md`, con los informes de `docs/analisis/`): pendiente de aprobación del responsable.
1. El responsable publica la 0.2.0 desde su máquina, configura la publicación de confianza de los seis
   paquetes y activa `PUBLICAR_NPM` y `PUBLICAR_SITIO` (`docs/lanzamiento.md`, pasos 4 a 6). Nada de eso lo hace
   el agente sin permiso.
2. Enviar `docs/consulta-sar.md` y archivar las respuestas.

## Cómo correr

```bash
pnpm install && pnpm test && pnpm test:ejemplos && pnpm typecheck
pnpm test:pg      # levanta el Postgres de factura-hn (con docker-compose.dev.yml) y corre lo que lo usa
```
