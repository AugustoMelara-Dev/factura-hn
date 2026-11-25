# Avance

Archivo para retomar el trabajo en una sesión nueva. Se actualiza en cada commit importante.

## Estado

- **Rama:** `main` en GitHub; cada lote entra por PR. La 0.2.0 está publicada en npm (24-11-2026, desde la
  máquina del responsable); la siguiente sale con changesets como 0.3.0.
- **Fase actual:** plan «terminar factura-hn», en lotes 1 a 6 (24-11-2026).
  - **Lote 1 (seguridad y 0.2.0):** hecho y publicado. Falta que el responsable confirme Trusted Publisher en los
    seis paquetes.
  - **Lote 2 (Etapa 1, los primeros 5 minutos):** en el PR `lote2/integracion`.
  - **Después:** Lote 3 (sitio Starlight), Lote 4 (API para integradores), Lote 5 (calidad
    medida) y Lote 6 (cierre).
- **Reglas de trabajo:**
  - **Lotes grandes:** se para solo en los ALTO.
  - **Subagentes** (opus, esfuerzo medio) para el trabajo paralelo. Cada revisión la hace quien no escribió el
    código.
  - **PR y fusión:** el agente abre los PR y los fusiona en `main` con la CI en verde (squash, autor noreply, sin
    atribución).
  - **Decisiones** en `docs/decisiones.md`, con [REVISAR] si cambian la interpretación fiscal.
  - **Docker** solo con los contenedores de factura-hn.
  - **Lo que no hace el agente:** npm, `PUBLICAR_NPM`/`PUBLICAR_SITIO`, despliegues, cuentas, licencia.
- **Ramas de trabajo:** en `C:/Users/melar/factura-hn-wt/` (worktrees). Los briefs de los subagentes están en
  `../.briefs/`, fuera del repositorio.

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
| Correcciones de la revisión interna de la matriz | 511aafd |
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
| Correcciones de la revisión interna de la Fase 3 (DEC-039) | 148960a |
| Operador en la bitácora (DEC-031 aprobada con cambios); MCP solo SQLite en archivo y `server-only` (DEC-040) | d9d446c |
| Datos de ejemplo ficticios y `auditar:datos` | 3884adb |

## Hecho (Fase 4, preparación del lanzamiento)

- Paquetes listos para npm (LICENSE, `verificar:dist`; procedencia desde las versiones que publique la CI).
- CI (Node 22 y 24, Postgres como servicio, imagen Docker).
- Release con changesets y Pages, apagados por variable (DEC-041 a DEC-044).
- Archivos de comunidad y plantillas.
- Sitio (`pnpm sitio`).
- Modelo de negocio y pasos de lanzamiento.
- Repositorio público `AugustoMelara-Dev/factura-hn`, con `main` protegida y el CI en verde en GitHub.
- Publicación en npm con OIDC, sin tokens (`scripts/publicar.mjs`, DEC-042).

## Hecho (plan v1, Etapa 0)

- Coma decimal: `"89,50"` da `ErrorMonto` (antes, 8950). La coma solo separa miles en grupos de 3.
- API: 400 `CUERPO_NO_UTF8`; el pool de Postgres sobrevive a un reinicio; `restart: unless-stopped`.
- Paquete: de `docs/` solo los documentos de `DOCS_PUBLICOS`; `verificar-dist` falla si se cuela otro.
- El ejemplo del README calcula la fecha límite del CAI y la CI lo ejecuta tal cual con el reloj real.
- Marca sin «SAR» en el nombre y el titular; «Proyecto independiente, no afiliado al SAR» (DEC-045).
- Afirmaciones exactas: la consulta al SAR no se ha enviado y trae las 14 preguntas; la 0.2.0 sale sin
  procedencia; «revisión interna», no independiente.
- API: recursos envueltos, listas `{ <plural>, hayMas, siguiente }`, documentos y bitácora paginados (DEC-047);
  precisión de los montos documentada (DEC-048).
- Decisiones del plan: DEC-045 a DEC-049.

## Hecho (auditoría de seguridad, 24-11-2026)

Fusionado en `main` (746c60b, PR #6). Corrige los cuatro hallazgos confirmados (DEC-052):
- exponente de montos acotado;
- llave de caja sin punto de emisión (API, consola y disparador; esquema API v4);
- revisión de anfitrión del POS sin `puerto`;
- `/docs` con Swagger UI fija, SRI y CSP.

## Hecho (Lote 1)

Rama `lote1/integracion`, que une `lote1/nucleo`, `lote1/reportes` y `lote1/api`. Cada rama la revisaron
subagentes que no la escribieron, en dos rondas.

- **Validación de las nueve pistas** (DEC-053):
  - confirmadas: reportes sin cota de memoria (media) y webhooks sin tope (baja);
  - descartadas: las otras siete, con su endurecimiento aplicado.
- **Reportes acotados** (DEC-059): páginas, transmisión, tope de 50 000 documentos, cupos por tenant y por proceso,
  plazos. Una conexión caída ya no tumba el proceso.
- **API:**
  - rol LOGIN `fhn_api` que no es dueño (DEC-054). También corrige el 401 con un dueño sin superusuario;
  - retención de idempotencia y entregas (DEC-055);
  - llave admin fuera del log (DEC-056);
  - modo local con tenants ajenos (DEC-057);
  - 20 webhooks por tenant, guarda del arrendamiento e id de entrega UUID (DEC-058);
  - esquema API v6.
- **Núcleo, MCP y ejemplo Express** (DEC-060): HTML escapado, texto ESC/POS sin controles, `structuredContent` del
  MCP marcado y 415 en Express.
- **Compose probado de punta a punta** con el rol `fhn_api`:
  - la llave admin se crea por la consola;
  - el demo emite;
  - la repetición da `Idempotency-Replayed`.

## Hecho (Lote 2)

Rama `lote2/integracion`, que une `lote2/nucleo`, `lote2/api`, `lote2/mcp` y `lote2/ejemplos`. Cada rama la revisó
un subagente que no la escribió; la rama integrada pasó dos revisiones más (seguridad e integridad fiscal).

- **Núcleo:** `factura-hn/demo`, modo de prueba con la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» (un punto de
  emisión es de prueba o real; de demo a real se permite y la demo queda retirada), errores con `solucion` y enlace
  a `docs/errores.md`, `crearFacturador`, `npx factura-hn demo`/`init`, equivalente en lempiras guardado al emitir
  en USD. La exportación, el libro y los no utilizados dejan fuera los documentos de prueba.
- **API:** limitador de intentos nuevo (esquema API v7), 400 en español, `enlaces` al emitir, `GET /v1/sesion`,
  `factura-hn-api demo llave`, consola unificada, CAI ficticio solo en el tenant demo.
- **MCP:** `init --demo`, `registrar-cai` (comando y herramienta), validación de `emisor.json`, `repetido`, `cliente`
  en notas de crédito, base de prueba aparte, versión fija en el bloque `mcpServers`.
- **Ejemplos y paquetes:** ejemplos repetibles, enlaces absolutos verificados dentro de cada tarball, README de
  tres caminos de 3 pasos, pruebas de humo de los tarballs (SDK, demo, MCP y API) en la CI.
- **Primeros 5 minutos**, con agentes sin contexto y los tarballs: Node, API, MCP y Next.js emiten en ≤ 3 pasos
  tras instalar, sin errores y en menos de 5 minutos (Next.js lo cumplió en la segunda vuelta, tras añadir su
  camino de prueba sin base de datos).
- **Decisiones:** DEC-062 a DEC-096. [REVISAR]: DEC-066 (`preciosIncluyenISV` en la fachada), DEC-068
  (equivalente en USD), DEC-069 (tasa del 18 %), DEC-079 (NC con `cliente` sobre CONSUMIDOR FINAL).

## Sigue

1. Fusionar el PR del Lote 2 con la CI en verde.
2. El responsable confirma Trusted Publisher en los seis paquetes.
3. Lote 3 (Etapa 2): sitio en Astro Starlight.
4. Pendiente menor: `datos::jsonb - 'lineas'` falla con un escape NUL dentro de un documento. Por la API no se llega
   (emitir con NUL ya da 500); conviene rechazar los controles al emitir.
5. Lotes 4 a 6. Pendientes anotados: `GET /v1/libro-ventas` con llave de caja (Lote 4). Al final, el responsable activa `PUBLICAR_NPM` y `PUBLICAR_SITIO` y envía `docs/consulta-sar.md`.

## Cómo correr

```bash
pnpm install && pnpm test && pnpm test:ejemplos && pnpm typecheck
pnpm test:pg      # levanta el Postgres de factura-hn (con docker-compose.dev.yml) y corre lo que lo usa
```
