# Avance

Archivo para retomar el trabajo en una sesión nueva. Se actualiza en cada commit importante.

## Estado

- **Rama:** `main` en GitHub; cada cambio entra por PR. La 0.3.0 está publicada en npm (25-11-2026) desde el
  flujo Release, con Trusted Publisher y procedencia firmada. El sitio está en
  <https://augustomelara-dev.github.io/factura-hn/>. Las versiones siguientes salen con changesets.
- **Fase actual:** plan «terminar factura-hn», en lotes 1 a 6 (24-11-2026).
  - **Lote 1 (seguridad y 0.2.0):** hecho y publicado.
  - **Lote 2 (Etapa 1, los primeros 5 minutos):** hecho (74a8eea, PR #9).
  - **Lote 3 (sitio Starlight):** hecho (d3cdfc4, PR #10).
  - **Lote 4 (API para integradores):** hecho (cc2bbd0, PR #11).
  - **Lote 5 (calidad medida):** hecho (39072d8, PR #12).
  - **Lote 6 (revisión final y 0.3.0):** hecho (9c05751, PR #13; a70ff54, PR #14). 0.3.0 publicada y sitio en
    línea (25-11-2026).
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

## Hecho (Lote 3)

Rama `lote3/integracion`, que une `lote3/sitio`, `lote3/contenido-a`, `-b`, `-c` y `-d`. Cada rama de contenido la
revisó un subagente que no la escribió (exactitud fiscal, enlaces y código).

- **Sitio en `web/`** (Astro Starlight, salida en `sitio/`, base `/factura-hn`): 58 páginas, portada propia, modo
  oscuro y claro con contraste AA probado, buscador Pagefind en español, playground embebido.
- **Páginas generadas al construir** desde el repositorio: referencia del SDK y de la API, rutas y esquemas desde
  `openapi.json`, catálogo de errores, normativa, decisiones, consulta al SAR, autoalojamiento y cambios. La matriz de
  cumplimiento sale de las pruebas: la construcción falla si una fila cubierta pierde su prueba.
- **Páginas escritas:** empezar, conceptos, los cuatro documentos, ocho guías, seis negocios, siete de producción
  («ir a producción ante el SAR»), IA y agentes, ayuda y glosario.
- **Para IA:** cada página en `.md`, `llms.txt` y `llms-full.txt`.
- **Comprobaciones:** `verificar.mjs` revisa enlaces internos y anclas, recursos para IA, buscador y portada.
  `readme.test.ts` compila cada bloque `ts` de las páginas versionadas y compara los prompts de `/ia/prompts/`.
- **Revisión en el navegador** de cada página en escritorio (1280 px) y móvil (375 px). Se corrigió el código partido
  letra por letra en las tablas en móvil, y los bloques sin índice (`/empezar/`, `/conceptos/`, `/guias/`, `/ayuda/`)
  ahora redirigen a su primera página.
- **Decisiones:** DEC-097 a DEC-103. [REVISAR]: DEC-101 (la guía de profesional se publica con aviso de peligro),
  DEC-102 (CAI pedido para otro sistema o talonarios, pregunta nueva P-15 de la consulta) y DEC-103 (instalación de
  la skill en `.claude/skills/`).

## Hecho (Lote 4)

Rama `lote4/integracion`, que une `lote4/contrato`, `lote4/webhooks`, `lote4/llaves`, `lote4/pendientes` y
`lote4/colecciones`. Cada rama la revisó un subagente que no la escribió, y su autor corrigió los hallazgos.

- **Contrato:** `operationId` en las 28 operaciones, fijados por una prueba; cada operación declara solo los estados
  que devuelve; `Solicitud-Id`, `FacturaHN-Version`, `FacturaHN-Modo`, `RateLimit-Policy`/`RateLimit` y
  `Retry-After` en `LIMITE_MENSUAL`; `JSON_INVALIDO`; linter Redocly en la CI con 0 errores.
- **Webhooks:** reintentos durante unos 3 días con fluctuación; listar, reenviar y probar entregas; verificadores con
  varias firmas `v1`; rotación del secreto con gracia (una segunda rotación conserva el secreto más viejo).
- **Llaves y sandbox:** `fhn_test_`/`fhn_live_` (las viejas siguen valiendo), modo del tenant, CAI ficticio solo en
  prueba y prohibido en producción también por disparador en la base; libro de ventas por caja.
- **Núcleo:** `TEXTO_CARACTER_NO_PERMITIDO` (NUL y otros controles, también en el motivo de anulación),
  `registrarAutorizacionConAvisos` y `advertencias` al registrar por la API. El bloqueo mutuo entre notas de puntos
  distintos no se reproduce; la prueba lo vigila.
- **Colecciones y clientes:** Bruno y Postman generados del OpenAPI (`pnpm colecciones`), cliente de Python con
  openapi-python-client que emite una factura de prueba. Un trabajo de la CI los corre contra la imagen Docker.
- **Esquema de la API v8** (rotación de secretos y modo del tenant).
- **Decisiones:** DEC-104 a DEC-134. [REVISAR]: DEC-121 (CAI ficticio según el modo del tenant).

## Hecho (Lote 6)

Rama `lote6/integracion`. Cinco revisiones independientes de `main` (fiscal, seguridad con una segunda pasada de
security-audit, paquetes, documentación y primeros 5 minutos) y cuatro ramas de correcciones (`lote6/api`,
`lote6/nucleo`, `lote6/paquetes-fix`, `lote6/docs`), cada una hecha por quien no la revisó.

- **Núcleo (fiscal):** un documento con notas vigentes no se anula (`DOCUMENTO_CON_NOTAS`, DEC-182 [REVISAR]); el
  tope de la nota de crédito se aplica por tasa y un original en USD pasa por la misma conversión que la nota
  (DEC-183 [REVISAR]); aviso `AVISO_NOTA_EXONERACION_DISTINTA`; exportación versión 2 (`tipoCambio`,
  `fechaAnulacion`); preguntas P-16 a P-20 en la consulta al SAR.
- **API y MCP (seguridad):** confirmación por elicitación en las herramientas destructivas del MCP; el modo local
  no atiende otros tenants; webhooks de tenants inactivos (esquema v9) y secretos ilegibles aislados; cupo de
  reportes por llave; `IDEMPOTENCY_KEY` cuando falta la cabecera; JSON con `charset=utf-8`; carga nocturna estable.
- **Paquetes y versión:** una sola versión (la de la API sale de su `package.json`, `scripts/fijar-versiones.mjs`
  después de `changeset version`); CHANGELOG por paquete; Node 20 como piso y en la matriz de la CI;
  `release.yml` en tres trabajos con changesets/action v2 y `persist-credentials: false`.
- **Documentación y sitio:** primera factura con la API que se detiene si falla un paso, cuatro caminos, ejemplo
  Next.js, README de los paquetes en la prueba de fragmentos, DEC enlazados en el sitio.
- **Mutación** tras los cambios: 98,98 % (cada módulo ≥ 97 %).
- **Decisiones:** DEC-169 a DEC-203. [REVISAR]: DEC-182 y DEC-183.

## Hecho (Lote 5)

Rama `lote5/integracion`, que une `lote5/owasp`, `lote5/propiedades`, `lote5/mutacion` y `lote5/resiliencia`. Cada
rama la revisó un subagente que no la escribió, y su autor corrigió los hallazgos. Resumen y números en
`docs/calidad.md`, con un informe por tema en `docs/calidad/`.

- **Propiedades, contrato y fuzzing:** 60 propiedades con fast-check (citan su artículo); cada respuesta de las
  pruebas de la API se valida contra `openapi.json` (Ajv); fuzz de la API desde la especificación, sin 500.
  Corrigió `MONTO_FUERA_DE_RANGO` (tope técnico por tasa y en lempiras), 415 con forma de error, 400 por
  caracteres de control en llaves y webhooks, fechas de período imposibles, CAI con NUL y cabeceras sin declarar.
- **Mutación:** Stryker sobre ocho módulos del núcleo, 67,94 % → 99,11 %, umbral de 85 % por módulo, de noche.
- **Carga y resiliencia:** `pnpm carga` (p95 37 ms a 30/s en local, sin huecos ni repetidos) y `pnpm resiliencia`
  (PostgreSQL reiniciado y caído, commit incierto, webhooks caídos). 503 `BASE_NO_DISPONIBLE` con `Retry-After`;
  el despacho de webhooks vacía lo acumulado; formateadores de fecha reusados.
- **OWASP API Top 10 (2023):** 55 pruebas en `packages/api/test/owasp/`, 10 de 10 riesgos; tope de 8 MiB por
  página de documentos, resolvedor inyectable en las entregas, punto final en nombres de host.
- **`nocturno.yml`:** propiedades y fuzz con 20 000 casos, carga y resiliencia largas, mutación. 07:00 UTC y a mano.
- **Decisiones:** DEC-135 a DEC-168. [REVISAR]: DEC-152 (ISV redondeado por tasa; remite a la consulta §P-10).

## Sigue

1. El entorno `npm` de GitHub no tiene reglas: la 0.3.0 se publicó sin pedir aprobación. Falta ponerle al
   responsable como revisor obligatorio y limitarlo a `main` (`docs/lanzamiento.md`, paso 5).
2. El responsable envía `docs/consulta-sar.md` (P-01 a P-20), con un contador o abogado tributario que indique el
   canal (Oficina Virtual, escrito en una oficina del SAR o apoderado), y con cada respuesta se cierra su [REVISAR].
3. Pendientes menores:
   - despacho de webhooks en paralelo dentro de cada pasada (DEC-204): hoy unos 100 avisos/s en el runner de
     GitHub;
   - documentos ya guardados con un NUL (anteriores al Lote 4) siguen rompiendo el listado sin líneas de su tenant;
   - etiquetas del OpenAPI con tilde (`Sesión`, `Auditoría`) dan módulos raros en el cliente de Python;
   - imagen Docker en GHCR, con permiso del responsable;
   - propuestas de rendimiento de la carga (menos consultas por emisión) y de OWASP (PDF fuera del hilo
     principal), en `docs/decisiones.md`.

## Cómo correr

```bash
pnpm install && pnpm test && pnpm test:ejemplos && pnpm typecheck
pnpm test:pg      # levanta el Postgres de factura-hn (con docker-compose.dev.yml) y corre lo que lo usa
pnpm sitio        # genera, construye y verifica el sitio en sitio/; pnpm sitio:ver lo sirve en :4321
pnpm colecciones  # regenera las colecciones de Bruno y Postman desde el OpenAPI
pnpm calidad:propiedades && pnpm calidad:owasp && pnpm carga ci && pnpm resiliencia  # ver docs/calidad.md
pnpm mutacion     # unos 15 min
```
