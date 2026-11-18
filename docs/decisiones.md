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

### DEC-008 · `ultimoEmitidoAntes` para migrar series existentes
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

### DEC-010 · Sin calendario de feriados en el SDK
- **Contexto:** el plazo del Art. 42 es en días hábiles; los feriados de Honduras cambian por decreto
  (feriados morazánicos que se trasladan).
- **Elegida:** solo se descuentan sábados y domingos; el integrador pasa `feriados`. Sin ellos la fecha puede
  quedar después de la real, lo que está documentado en la opción.
- **Alternativa:** una lista fija en el código (se desactualiza sin aviso).

### DEC-011 · Formatos de exportación propios (jsonl, csv, txt)
- **Contexto:** el Art. 53 num. 5 exige generar archivos de texto, pero en las fuentes revisadas no hay un
  formato oficial (P-14).
- **Elegida:** tres formatos abiertos y versionados (`VERSION_EXPORTACION`); los anulados conservan sus
  importes y su estado, porque el archivo refleja lo emitido.
- **Alternativa:** exportar los anulados en cero como el libro de ventas (perdería lo emitido).

### DEC-012 · El libro contable corre dentro de la transacción fiscal
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

### Reglas derivadas que señaló la revisión independiente (2026-11-18)

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

### DEC-025 · Aviso de renovación: dos meses de calendario
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

### DEC-031 · Bitácora: la llave identifica al actor · [REVISAR]
- **Contexto:** Art. 53 num. 2 pide «controles de auditoría». La API sabe qué llave hizo cada operación, no qué
  persona.
- **Elegida:** `actor = llave:<prefijo>` en la bitácora fiscal y en la de la API. Se recomienda una llave por
  caja o por persona (el nombre de la llave queda en `GET /v1/llaves`).
- **Alternativa:** exigir un campo `usuario` en cada solicitud.

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
- **Contexto:** revisión independiente (sin hallazgos críticos ni altos; siete medios).
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
