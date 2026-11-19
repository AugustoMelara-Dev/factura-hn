# Registro de decisiones

Cada entrada lleva su contexto, la opción elegida y la alternativa descartada. Las que cambian la
interpretación fiscal (convertir un error en aviso o al revés, una regla derivada nueva) llevan **[REVISAR]**
hasta que el responsable las apruebe; entonces pasan a **[APROBADA]** con la fecha.

Las decisiones D-01, D-02, D-03 y D-07 de la investigación están en `docs/investigacion.md`
(«Decisiones aprobadas»).

---

## Fase 1

### DEC-001 · Motivo obligatorio al anular · [APROBADA 2026-11-18]
- **Contexto:** el Art. 41 exige la leyenda ANULADA, no un motivo.
- **Elegida:** `anular` exige `motivo` (auditoría, Art. 53 num. 2).
- **Alternativa:** motivo opcional.

### DEC-002 · Umbral de salto de fecha: 7 días · [APROBADA 2026-11-18]
- **Contexto:** un reloj adelantado traba la serie (Art. 43). Ningún artículo fija un umbral.
- **Elegida:** `RELOJ_ADELANTADO_SOSPECHOSO` si la fecha está más de 7 días después de la última emisión de la
  serie; configurable (`saltoMaximoDias`) y confirmable (`confirmarSaltoDeFecha`, queda en la bitácora).
- **Alternativa:** 30 días (menos falsas alarmas, pero un reloj adelantado unas semanas pasaría sin aviso).

### DEC-003 · Referencia cronológica = último documento válido · [APROBADA 2026-11-18]
- **Contexto:** sin esto, un documento con fecha futura traba la serie para siempre.
- **Elegida:** `EstadoSerie.ultimaFecha` cuenta solo documentos EMITIDOS; anular con fecha errónea desbloquea.
- **Alternativa:** un comando que «reinicie» la fecha de la serie (deja el archivo fuera de orden sin anular).

### DEC-004 · Coherencia de notas (B-13) · [APROBADA 2026-11-18]
- **Contexto:** los Arts. 26 y 28 piden los datos del comprobante; no dicen literalmente «mismo RTN» ni «no
  anulado».
- **Elegida:** si el original está en el almacén, son **error**: original ANULADO, CAI, fecha o RTN distintos.
  Si no está (talonario de imprenta, otro sistema, emisiones anteriores a la migración), se emite con la
  referencia completa y solo `AVISO_ORIGINAL_EXTERNO`.
- **Alternativa:** todo como aviso.

### DEC-005 · Documento guardado como `json` en Postgres
- **Contexto:** `jsonb` reordena claves; la ida y vuelta del documento debe ser exacta.
- **Elegida:** `json` (texto conservado). Se puede convertir a `jsonb` en consultas.
- **Alternativa:** `jsonb` + comparación profunda.

### DEC-006 · Columna `tenant` desde el adaptador de Postgres
- **Contexto:** la Fase 2 necesita aislamiento por tenant con RLS.
- **Elegida:** todas las tablas `fhn_*` llevan `tenant`; cada transacción fija `factura_hn.tenant`.
- **Alternativa:** un esquema de Postgres por tenant (más aislamiento, migraciones N veces).

### DEC-007 · `construirDocumento` y `anularDocumento` internos
- **Contexto:** dos caminos para emitir confunden a integradores y agentes.
- **Elegida:** solo `emitir` y `anular` son públicos.
- **Alternativa:** exportarlos como «avanzados».

### DEC-008 · `ultimoEmitidoAntes` para migrar series existentes · [REVISAR]
- **Contexto:** DEC-004 acepta notas sobre «emisiones anteriores a la migración», pero sin saber qué se emitió
  fuera del sistema no se distingue un original externo de un número que nunca existió, y la serie
  reutilizaría números ya emitidos.
- **Elegida:** campo opcional `AutorizacionCAI.ultimoEmitidoAntes`. La serie continúa en el siguiente; los
  números ≤ ese valor que no están en el almacén son externos (aviso); los mayores no consumidos, error.
- **Alternativa:** un método `avanzarSerie` en el contrato del almacén (cambia los tres adaptadores).

### DEC-009 · Fecha del acontecimiento por vencimiento = fecha límite de emisión · [APROBADA 2026-11-18]
- **Contexto:** Art. 42 num. 1 cuenta el plazo desde el «vencimiento del plazo de vigencia». Puede leerse como
  la fecha límite o el día siguiente; si la fecha límite es el último día del mes, el aviso cambia de mes.
- **Elegida:** la fecha límite (lectura conservadora: el aviso nunca queda tarde).
- **Alternativa:** el día siguiente a la fecha límite.

### DEC-010 · Sin calendario de feriados en el SDK · [REVISAR]
- **Contexto:** el plazo del Art. 42 es en días hábiles; los feriados de Honduras cambian por decreto
  (feriados morazánicos que se trasladan).
- **Elegida:** solo se descuentan sábados y domingos; el integrador pasa `feriados`. Sin ellos la fecha puede
  quedar después de la real, lo que está documentado en la opción.
- **Alternativa:** una lista fija en el código (se desactualiza sin aviso).

### DEC-011 · Formatos de exportación propios (jsonl, csv, txt) · [REVISAR]
- **Contexto:** el Art. 53 num. 5 exige generar archivos de texto, pero en las fuentes revisadas no hay un
  formato oficial (P-14).
- **Elegida:** tres formatos abiertos y versionados (`VERSION_EXPORTACION`); los anulados conservan sus
  importes y su estado, porque el archivo refleja lo emitido.
- **Alternativa:** exportar los anulados en cero como el libro de ventas (perdería lo emitido).

### DEC-012 · El libro contable corre dentro de la transacción fiscal · [REVISAR]
- **Contexto:** Art. 53 num. 1 pide integrar la facturación con la contabilidad o el inventario.
- **Elegida:** `LibroContable` síncrono con la transacción: si falla, no hay documento. Para sistemas externos
  se recomienda una cola (outbox) en la misma base.
- **Alternativa:** notificar después del commit (más rápido, pero los libros pueden descuadrarse).

### DEC-013 · CAI: letras, dígitos y guiones; espacios del borde se recortan · [APROBADA 2026-11-18]
- **Contexto:** B-09 quita el patrón hexadecimal por defecto (sin fuente). El Art. 4 num. 7 dice «serie
  alfanumérica»; los CAI reales llevan guiones.
- **Elegida:** se aceptan letras, dígitos y guiones. Los espacios del inicio y del final se recortan
  (normalización, sin error); solo es error `CAI_FORMATO` un carácter distinto en medio. El patrón
  6-6-6-6-6-2 queda en `caiEstricto`.
- **Alternativa:** aceptar cualquier texto no vacío.

### DEC-014 · El PDF reutiliza `renderizarTexto`
- **Contexto:** el PDF debe tener exactamente los datos fiscales del documento, y el impreso HTML y el
  texto ya están probados.
- **Elegida:** el PDF dibuja las líneas de `renderizarTexto` en Courier (carta a 90 columnas, ticket a 42),
  con negrita para tipo, número y ANULADA. Un solo lugar decide qué se imprime.
- **Alternativa:** un diseño propio de carta con tablas (más vistoso, pero una tercera copia de las reglas
  de impresión).

### DEC-015 · RLS con rol propio y FORCE; migraciones una vez por versión
- **Contexto:** las políticas RLS no aplican al dueño de las tablas ni a superusuarios; una API que se
  conecte así no estaría aislada. Además, reaplicar DDL en cada arranque bloquea tablas y causó un deadlock
  con emisiones concurrentes.
- **Elegida:** `migrar({ rls: { rol } })` crea un rol NOLOGIN sin BYPASSRLS, activa RLS **forzada** con una
  política por `tenant = current_setting('factura_hn.tenant')` (sin tenant no se ve nada) y le da permisos
  sin DELETE. `AlmacenPostgres({ rol })` hace `SET LOCAL ROLE` en cada transacción. El DDL se registra en
  `fhn_migraciones` y solo corre una vez por versión.
- **Alternativa:** filtrar solo en la aplicación (`WHERE tenant = $1`): un olvido expone datos de otro negocio.

### Reglas derivadas que señaló la revisión interna (2026-11-18)

### DEC-016 · La Nota de Débito puede referir cualquier documento · [APROBADA 2026-11-18]
- **Contexto:** el Art. 4 num. 31 (C L.377-379) dice que la ND está «vinculada a un Comprobante Fiscal»; el
  Art. 28 num. 3 b (C L.1479) dice «Comprobante Fiscal **o el documento**».
- **Elegida:** la NC solo sobre Comprobantes Fiscales (Art. 6); la ND sobre cualquier tipo (p. ej. otra ND o
  una NC).
- **Alternativa:** restringir también la ND a Comprobantes Fiscales.

### DEC-017 · La nota no puede tener fecha anterior al original, también la ND · [APROBADA 2026-11-18]
- **Contexto:** el Art. 4 num. 32 (C L.384) habla de ajustes «con posterioridad» solo para la NC.
- **Elegida:** `REFERENCIA_FECHA_POSTERIOR` para 06 y 07: un documento no se modifica antes de existir.
- **Alternativa:** aplicarla solo a la NC.

### DEC-018 · Las notas se emiten solo en lempiras · [APROBADA 2026-11-18]
- **Contexto:** los Arts. 26 num. 9 y 28 num. 8 (C L.1389-1390, L.1491-1492) piden «Denominación literal de la
  Moneda Nacional Lempira o símbolo (L)».
- **Elegida:** error `NOTA_MONEDA` si la nota no está en HNL. Si la factura original está en moneda
  extranjera, las líneas de la nota se escriben en esa moneda y se convierten a lempiras con el **tipo de
  cambio de la factura original** (precio a 4 decimales, descuento a 2, redondeo del Art. 9 de la Ley del ISV).
  La nota imprime la moneda y el tipo de cambio del original como referencia. Con el original en el almacén,
  ambos se toman de él y un valor distinto es error (`REFERENCIA_MONEDA_NO_COINCIDE`,
  `REFERENCIA_TIPO_CAMBIO_NO_COINCIDE`); con un original externo hay que indicarlos
  (`REFERENCIA_TIPO_CAMBIO`). Lectura: la nota modifica una operación ya valorada; usar el tipo de cambio del
  día cambiaría el valor de lo que se devuelve o ajusta.
- **Alternativa:** tipo de cambio del día de la nota.

### DEC-019 · Exoneración de todo el documento · [APROBADA 2026-11-18]
- **Contexto:** con `exoneracion`, todo lo gravado pasa a importe exonerado. El Reglamento no regula una
  exoneración parcial por línea.
- **Elegida:** exoneración del documento completo. Si la OCE no cubre todos los artículos, se emiten dos
  facturas: una exonerada con los artículos cubiertos y otra normal con el resto (README y AGENTS.md).
- **Alternativa:** marcar la exoneración por línea.

### DEC-020 · La base de crédito fiscal no incluye lo gravado al 0 % · [APROBADA 2026-11-18]
- **Contexto:** Art. 11 num. 3 (C L.736-737): «solo se reconocerá el crédito fiscal sobre las ventas gravadas».
  Una venta con alícuota cero no genera ISV que acreditar.
- **Elegida:** `baseCreditoFiscal` = gravado 15 % + gravado 18 %.
- **Alternativa:** incluir el gravado 0 % (no cambia el ISV acreditable, sí la base reportada).

### DEC-021 · Exonerado: OCE + constancia, o registro SAG/RUPNSA · [APROBADA 2026-11-18]
- **Contexto:** Art. 11 num. 4 (C L.739-749) con «… o …»; pregunta P-08. Aprobado con el plan de la Fase 1 (B-12).
- **Elegida:** con `registroSAG` no se exige lo demás; sin él, OCE **y** constancia.
- **Alternativa:** exigir siempre OCE y constancia.

### DEC-022 · La fecha de emisión es la de hoy en Honduras · [APROBADA 2026-11-18]
- **Contexto:** los Arts. 14 y 43 no prohíben literalmente otra fecha; aprobado con el plan (B-08).
- **Elegida:** `FECHA_EMISION_NO_ES_HOY` si se envía una fecha distinta de la del reloj.
- **Alternativa:** permitir retrofechar con advertencia.

### DEC-023 · Correo del emisor con formato válido · [APROBADA 2026-11-18]
- **Contexto:** Art. 10 num. 1 f (C L.594-595) exige el correo, sin fijar formato.
- **Elegida:** error `EMISOR_CORREO` si no tiene forma de correo (`algo@dominio.tld`).
- **Alternativa:** solo exigir que no esté vacío.

### DEC-024 · RTN de 14 dígitos y DNI de 13 · [APROBADA 2026-11-18]
- **Contexto:** el Reglamento no fija longitudes; son las del RTN y la tarjeta de identidad en uso.
- **Elegida:** validar esas longitudes (`CLIENTE_RTN`, `EMISOR_RTN`, DNI).
- **Alternativa:** aceptar cualquier secuencia de dígitos.

### DEC-025 · Aviso de renovación: dos meses de calendario · [REVISAR]
- **Contexto:** Art. 59 (C L.2263-2265): «dentro de los dos (2) meses previos». 60 días avisaba 1 a 3 días tarde.
- **Elegida:** avisar desde la misma fecha dos meses antes (último día del mes si no existe); `diasAviso` la
  reemplaza.
- **Alternativa:** 60 días fijos.

## Fase 2: API

### DEC-026 · Llaves de API con SHA-256, no con un hash lento
- **Contexto:** la llave tiene 256 bits aleatorios; un hash lento (bcrypt, scrypt) protege contraseñas de baja
  entropía y cuesta en cada solicitud.
- **Elegida:** `fhn_<prefijo>_<secreto>`; se guarda SHA-256 de la llave completa, se busca por prefijo y se
  compara en tiempo constante.
- **Alternativa:** scrypt por solicitud con caché.

### DEC-027 · SQL con `pg`, sin ORM
- **Contexto:** el adaptador `@factura-hn/postgres` ya usa SQL parametrizado, RLS y disparadores.
- **Elegida:** `pg` + SQL en la API también; un solo modelo de transacción (`AlmacenPostgres.transaccion`).
- **Alternativa:** Drizzle para las tablas `api_*`.

### DEC-028 · Un emisor por tenant; el RTN no cambia
- **Contexto:** la numeración y las autorizaciones son del obligado tributario (RTN).
- **Elegida:** tenant = un RTN. `PATCH` cambia datos de contacto o direcciones (solo para documentos futuros);
  cambiar el RTN es 422.
- **Alternativa:** varios emisores por tenant con series separadas.

### DEC-029 · `Idempotency-Key` obligatoria; solo se guardan las emisiones exitosas
- **Contexto:** un POS que reintenta por un corte de red no debe emitir dos facturas.
- **Elegida:** sin la cabecera, 400. La clave es por tenant y se guarda en la misma transacción que el
  documento. Una solicitud rechazada no guarda la clave.
- **Alternativa:** cabecera opcional; guardar también las respuestas de error.

### DEC-030 · Límites: por solicitud en memoria, mensual en la base
- **Contexto:** el límite por segundo protege el servicio; el mensual es comercial y debe ser exacto.
- **Elegida:** token bucket por llave en memoria (por réplica). Conteo mensual con
  `INSERT … ON CONFLICT DO UPDATE` en la transacción de emisión: exacto, a costa de serializar el commit de las
  emisiones del mismo tenant.
- **Alternativa:** Redis para el límite por segundo; contador mensual aproximado.

### DEC-031 · Bitácora: actor = llave (id, rol, nombre) + operador opcional · [APROBADA 2026-11-18]
- **Contexto:** Art. 53 num. 2 pide «controles de auditoría». La API sabe qué llave hizo cada operación, no qué
  persona. El responsable aprobó la propuesta con cambios.
- **Elegida:**
  - `actor = "llave:<id> (<rol>: <nombre>)"` en la bitácora fiscal (`fhn_eventos`) y en la de la API
    (`api_bitacora`). `<id>` es un id interno (uuid) de la llave, no su prefijo; el nombre y el rol son los
    del momento de la operación.
  - Cada solicitud puede indicar el `operador` (p. ej. el cajero): campo `operador` del cuerpo (emitir, anular,
    corregir fecha) o cabecera `X-Operador`, codificada con `encodeURIComponent` si lleva tildes. Si llegan
    ambos y no coinciden, 400 `OPERADOR_CONFLICTO`. Se valida (1 a 80 caracteres, sin caracteres de control:
    `OPERADOR`).
  - El operador se guarda en la bitácora. Se imprime en el documento («Atendido por») solo si se pide
    (`imprimirOperador` en la API, `DocumentoEntrada.operador` en el SDK). No lo exige el Reglamento.
  - Cada emisión deja además un evento `DOCUMENTO_EMITIDO` en la bitácora fiscal, con actor y operador.
  - El operador solo forma parte de la huella de idempotencia si se imprime: el reintento de otro cajero con
    la misma clave devuelve la misma factura.
  - Cliente (`operador` en `crearCliente`, `anular(…, { operador })`), MCP (`FHN_OPERADOR` y parámetro
    `operador` de las herramientas) y ejemplos (Next.js, Express, POS, playground) lo exponen.
- **Alternativa:** exigir el operador en cada solicitud. Se descartó: una integración servidor a servidor (una
  tienda en línea) no tiene cajero.

### DEC-032 · Avisos de autorización al emitir
- **Contexto:** `autorizacion.por_vencer` y `autorizacion.agotada` necesitan un disparador.
- **Elegida:** se evalúan con `estadoAutorizacion` en cada emisión y se avisan una vez por autorización. Una
  autorización sin emisiones no avisa; `GET /v1/autorizaciones/{cai}/estado` da el estado a demanda.
- **Alternativa:** revisión diaria programada.

### DEC-033 · Destinos de webhooks
- **Contexto:** en el modo alojado una URL arbitraria permite alcanzar la red interna del servidor (SSRF).
- **Elegida:** alojado: solo https, sin IP privadas, de enlace local ni nombres internos, y el nombre se
  resuelve otra vez al entregar; sin redirecciones. Local: http y red del negocio permitidos.
- **Alternativa:** lista blanca de dominios por tenant.

### DEC-034 · Modo local con tenant `local` y la demostración en un tenant aparte
- **Contexto:** Art. 47 y la recomendación de P-02: instalación en el establecimiento. La revisión mostró que
  poner la demostración en el mismo tenant dejaba inservible la instalación para el RTN y los CAI reales.
- **Elegida:** el mismo código con `FHN_MODO=local`; al primer arranque crea el tenant `local` (vacío) y su
  llave admin. `FHN_DEMO=1` crea además el tenant `demo` con un CAI ficticio (`DEMO00-NO-VALIDO-…`) y un
  emisor «NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)».
- **Alternativa:** una imagen distinta para cada modo.

### DEC-035 · Revisión de seguridad de la Fase 2: cambios de diseño
- **Contexto:** revisión interna (sin hallazgos críticos ni altos; siete medios).
- **Elegida:**
  - Autenticación: la función de búsqueda ya no escribe. El último uso se marca solo con el secreto correcto, a
    lo sumo una vez por minuto. El límite por llave se aplica antes de consultar la base.
  - Webhooks: la entrega se reclama en una transacción corta y el HTTP corre fuera, en paralelo por tenant. La
    conexión usa la IP validada y los rangos bloqueados cubren IPv6 completo.
  - Las llaves de caja siempre van atadas a un punto de emisión.
  - Postgres no publica su puerto en el `docker-compose.yml` (sí en `docker-compose.dev.yml`).
  - `FHN_MODO` falla cerrado.
  - Los CSV protegen el texto contra fórmulas (`textoSeguroCSV` en el núcleo). JSONL y TXT no cambian.
- **Alternativa:** dejarlo documentado como riesgo.

### DEC-036 · Cliente: tipos generados y verificación de webhooks con Web Crypto
- **Contexto:** Fase 3, cliente tipado. Los receptores de webhooks suelen correr en edge (Next.js, Workers).
- **Elegida:** `openapi-typescript` sobre `packages/api/openapi.json` (una prueba falla si los tipos quedan
  viejos) y `openapi-fetch` como única dependencia. `verificarFirmaWebhook` del cliente es asíncrona (Web
  Crypto, comparación en tiempo constante con `subtle.verify`); la de `@factura-hn/api` sigue síncrona. Una
  prueba cruzada verifica con el cliente lo que firma la API. El cliente pide Node 20+.
- **Alternativa:** que el cliente dependa de `@factura-hn/api` (trae pg y Hono) o duplicar con `node:crypto`.

### DEC-037 · Servidor MCP: herramientas acotadas
- **Contexto:** Fase 3. Un agente que factura debe poder hacer lo de la caja, no administrar.
- **Elegida:** seis herramientas; `anular_documento` lleva `destructiveHint`. No hay herramientas para
  registrar CAI, emisores, llaves ni webhooks. La nota de crédito toma la referencia (CAI, número, fecha) y el
  cliente del documento original. Vía la API, el rol de la llave manda (con una de caja, anular da 403).
  Con el SDK local, las claves de idempotencia van en `mcp_claves`, en la transacción de la emisión.
- **Alternativa:** exponer toda la API como herramientas.

### DEC-038 · Ejemplos: idempotencia de punta a punta
- **Contexto:** los ejemplos se copian tal cual a proyectos reales.
- **Elegida:** todos emiten con una clave estable por venta: id del pedido (Express), clave por formulario
  (Next.js), clave del navegador guardada hasta tener respuesta (POS). El POS guarda la clave y su cola de
  sincronización en la transacción de emisión (`alEmitir`/`alAnular`). Las llaves de API viven solo en el
  servidor y los ejemplos usan llaves de caja.
- **Alternativa:** ejemplos mínimos sin idempotencia.

### DEC-039 · Revisión de la Fase 3: cambios
- **Contexto:** revisión interna (1 crítico, 3 altos, 5 medios, 6 bajos).
- **Elegida:**
  - El ejecutable del MCP carga `node:sqlite` solo en el modo SQLite; una prueba arranca el `dist`.
  - La clave de idempotencia es obligatoria en las herramientas de emisión del MCP.
  - En el MCP local y en el POS, la clave guarda la huella del contenido: la misma clave con otra venta es un
    conflicto, como en la API.
  - El texto de los documentos llega al agente delimitado y marcado como datos.
  - El POS rechaza otros `Host`, otros `Origin` y POST que no sean JSON (CSRF y DNS rebinding).
  - Next.js conserva la clave sin usar tras un error y firma los enlaces al PDF. Express sirve el PDF por pedido.
  - El prompt de la API apunta a lo que existe: `AGENTS.md` dentro de `@factura-hn/cliente` y las reglas en
    la descripción de `/openapi.json`.
  - Las pruebas de Postgres usan la base `factura_hn_pruebas`.
- **Alternativa:** dejar los ejemplos sin estas defensas y advertirlo en sus README.

### DEC-040 · MCP local solo con SQLite en archivo; `server-only` en Next.js
- **Contexto:** dos bajos pendientes de la revisión de la Fase 3.
- **Elegida:**
  - `BackendLocal` recibe la base SQLite y arma él mismo el almacén y las claves de idempotencia. Rechaza una
    base en memoria, y el ejecutable rechaza `FHN_SQLITE=:memory:`. Se elimina `clavesEnMemoria`: una caja
    que pierde sus documentos al reiniciar pierde números consumidos (Art. 41) y la clave de un reintento.
  - En Next.js, los módulos con la llave o los secretos importan `server-only` (0.0.1). Una prueba lo verifica
    y comprueba que ningún componente `'use client'` importe valores de `lib/`.
- **Alternativa:** dejar el modo en memoria con una advertencia.

### DEC-041 · Nombres del repositorio y de npm
- **Contexto:** los manifiestos, los badges y el sitio necesitan la URL del repositorio antes de que exista.
- **Elegida (cambiada por el responsable el 19-11-2026):** repositorio en la cuenta personal,
  `AugustoMelara-Dev/factura-hn`, con el sitio en `augustomelara-dev.github.io/factura-hn`. Los paquetes siguen en
  la organización `factura-hn` de npm. El 18-11-2026 los seis nombres de paquete estaban libres en npm
  (consulta de solo lectura). `docs/lanzamiento.md` trae el comando para cambiar la URL en todo el repositorio.
  La publicación de confianza de npm (DEC-042) exige que `repository.url` coincida exactamente con el
  repositorio: los seis paquetes llevan `git+https://github.com/AugustoMelara-Dev/factura-hn.git`, definido en
  `scripts/paquetes.mjs` y comprobado por `verificar-dist` y `publicar.mjs`.
- **Alternativa:** una organización `factura-hn` en GitHub (se descartó: no hace falta para empezar y puede
  transferirse después; GitHub redirige las URLs antiguas).

### DEC-042 · Publicación y sitio apagados hasta que el responsable los active; npm sin tokens
- **Contexto:** el CI no debe publicar en npm ni desplegar sin una decisión explícita, y un token de npm
  guardado en GitHub es una credencial de larga vida que puede filtrarse.
- **Elegida (cambiada por el responsable el 19-11-2026: publicación de confianza en lugar de `NPM_TOKEN`):**
  los flujos Release y Pages solo corren si las variables del repositorio `PUBLICAR_NPM` y `PUBLICAR_SITIO`
  valen `true`. Release publica con la publicación de confianza de npm (trusted publishing, OIDC): permiso
  `id-token: write`, npm >= 11.5.1 y ningún token ni secreto de npm; la procedencia se firma sola. Usa el
  entorno `npm`, con revisor obligatorio, y en npmjs.com cada paquete acepta solo `release.yml` de este
  repositorio con ese entorno. `scripts/publicar.mjs` empaqueta con `pnpm pack` (cambia `workspace:` por
  versiones) y sube con `npm publish`, que es quien hace el intercambio OIDC; salta lo ya publicado. La 0.2.0
  se publica desde la máquina del responsable con 2FA, porque la publicación de confianza se configura en
  paquetes que ya existen: esa versión no lleva procedencia. Las acciones van fijadas por SHA. Los seis
  paquetes publicables van en un grupo `fixed` de changesets (misma versión); la API y los ejemplos no se
  publican.
- **Alternativa:** un token granular de npm en un secreto del entorno `npm` (era la opción anterior): sirve
  desde la primera versión, pero hay que rotarlo y puede filtrarse. También `changeset publish` (usa
  `pnpm publish`): se descartó porque la documentación de npm sobre la publicación de confianza solo cubre el
  CLI de npm.

### DEC-043 · Generador propio del sitio (lo reemplazará DEC-049)
- **Contexto:** el sitio debe salir de los mismos Markdown del repositorio, sin una segunda copia.
- **Elegida:** `scripts/sitio.mjs` con `marked` (dependencia de desarrollo). Reescribe los enlaces a páginas
  del sitio o a GitHub, genera la referencia de la API desde `openapi.json`, incrusta el playground y falla si
  hay enlaces internos, anclas o archivos del repositorio que no existen. El CI lo construye en cada cambio.
- **Alternativa:** VitePress o Docusaurus: más funciones, pero decenas de dependencias y una segunda estructura
  de documentación.

### DEC-044 · Datos de ejemplo ficticios y verificados
- **Contexto:** el repositorio será público; los ejemplos no pueden parecer datos de contribuyentes reales.
- **Elegida:** RTN con prefijo `9999` (no existe el departamento 99), CAI `A1B2C3-…` o `DEMO00-NO-VALIDO-…`,
  correos `@ejemplo.example` (RFC 2606), teléfonos `0000-000x` y «Ciudad Ejemplo». `pnpm auditar:datos` lo
  verifica en el CI y busca también rutas de máquina. Las convenciones están en `CONTRIBUTING.md`.
- **Alternativa:** confiar en la revisión manual.

## Plan v1 (aprobado por el responsable el 19-11-2026)

Decisiones de producto, sin efecto en la interpretación fiscal. Ver `docs/plan-v1.md`.

### DEC-045 · Marca sin «SAR» en el nombre y el titular · [APROBADA 2026-11-19]
- **Contexto:** factura-hn no es un producto oficial. «SAR» en el nombre o el titular puede leerse como
  afiliación; en las descripciones y las palabras clave, en cambio, es lo que la gente busca.
- **Elegida:** el nombre y el titular no llevan «SAR» («Facturación para Honduras»). Las descripciones, las
  `keywords`, el nombre de la skill (`facturacion-sar-hn`) y los prompts lo conservan. El README, el sitio y los
  `package.json` dicen: «Proyecto independiente, no afiliado al SAR».
- **Alternativa:** quitar «SAR» de todas partes (se pierde en las búsquedas).

### DEC-046 · Leyenda de los documentos de prueba · [APROBADA 2026-11-19]
- **Contexto:** los impresos hechos con el CAI de demostración parecen facturas reales (prueba de los primeros 5
  minutos, `docs/analisis/primeros-5-minutos.md`).
- **Elegida:** todo impreso de un documento de prueba lleva la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».
  Es una decisión de producto, no una regla del Reglamento: ningún artículo la exige ni la regula. Se implementa
  en la Etapa 1 del plan.
- **Alternativa:** sin leyenda (un documento de prueba puede confundirse con uno válido).

### DEC-047 · API: respuestas uniformes y paginación por defecto · [APROBADA 2026-11-19]
- **Contexto:** la API mezclaba objetos sueltos (`POST /v1/emisores`, `/v1/llaves`, `/v1/webhooks`) con
  objetos envueltos (`{documento}`, `{autorizacion}`), y ninguna lista estaba paginada: `GET /v1/documentos`
  podía devolver 366 días en una sola respuesta. Añadir paginación después es un cambio incompatible (AIP-158).
- **Elegida:** todo recurso va envuelto con su nombre (`{emisor}`, `{documento}`, `{llave, secreto}`…), lo que
  deja lugar a metadatos como `advertencias`. Toda lista es `{<plural>, hayMas, siguiente}`. `GET /v1/documentos`
  y `GET /v1/bitacora` se paginan con `limite` (100 por defecto, máximo 500) y `cursor` opaco; el resto de las
  listas son acotadas y responden siempre `hayMas: false`. Los reportes (`libro-ventas`, `exportacion`,
  `no-utilizados`) siguen completos por período. El cliente recorre las páginas por sí solo.
- **Alternativa:** objetos sueltos como Stripe (sin lugar para metadatos), o paginación opcional (los clientes
  asumirían la lista completa).

### DEC-048 · Montos de salida como número en lempiras · [APROBADA 2026-11-19]
- **Contexto:** se evaluó devolver los montos como texto o con un objeto paralelo en centavos.
- **Elegida:** los montos de salida son números JSON en lempiras con a lo sumo 2 decimales. Se calculan con
  aritmética entera en centavos y se convierten con la representación decimal más corta, así que
  `Math.round(monto * 100)` recupera los centavos exactos. Sumar montos en coma flotante sí puede acumular error:
  quien los sume debe pasarlos antes a centavos. Las entradas siguen aceptando texto decimal. Está documentado
  en `docs/api.md` y en el OpenAPI.
- **Alternativa:** montos como texto, u objeto en centavos (cambian el JSON ya guardado y duplican datos).

### DEC-049 · Sitio con Astro Starlight · [APROBADA 2026-11-19]
- **Contexto:** el sitio necesita buscador en español, modo oscuro, una página por guía y referencia generada
  (`docs/analisis/sitio-web.md`).
- **Elegida:** Astro Starlight, en un paquete privado del workspace, desplegado en GitHub Pages. Reemplaza a
  DEC-043 cuando se implemente (Etapa 2). Conserva lo del generador propio: los mismos Markdown como fuente, la
  reescritura de enlaces, el playground y la verificación de enlaces y anclas.
- **Alternativa:** VitePress (interfaz y buscador sin español), Fumadocs (pierde sus ventajas en Pages) o
  seguir con el generador propio (sin buscador).
