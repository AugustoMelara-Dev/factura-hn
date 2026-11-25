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
  se publica desde la máquina del responsable con 2FA (autenticación web de npm con llave de seguridad, sin
  códigos OTP), porque la publicación de confianza se configura en
  paquetes que ya existen: esa versión no lleva procedencia. Las acciones van fijadas por SHA. Los seis
  paquetes publicables van en un grupo `fixed` de changesets (misma versión); la API y los ejemplos no se
  publican.
- **Alternativa:** un token granular de npm en un secreto del entorno `npm` (era la opción anterior): sirve
  desde la primera versión, pero hay que rotarlo y puede filtrarse. También `changeset publish` (usa
  `pnpm publish`): se descartó porque la documentación de npm sobre la publicación de confianza solo cubre el
  CLI de npm.

### DEC-043 · Generador propio del sitio (reemplazada por DEC-097)
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

### DEC-050 · El libro de ventas va en lempiras · [REVISAR]
- **Contexto:** la revisión fiscal de la 0.2.0 encontró que `filaLibroVentas` y `resumenVentas` sumaban los
  importes de un documento en dólares como si fueran lempiras (L 100 + USD 100 a 24.70 daban ISV 30 en lugar de
  385.50). El ISV se declara y se paga en lempiras. El repositorio no tiene una norma que fije el formato del libro
  ni cómo convertir.
- **Elegida:** los importes de la fila van en lempiras. Un documento en moneda extranjera se convierte con el
  tipo de cambio que el propio documento imprime (Art. 11, párrafo final: tasa vigente a la fecha), campo por
  campo, redondeando a centavos con la regla del Art. 9 de la Ley del ISV. La fila agrega `moneda`, `tipoCambio`
  y `totalMonedaOriginal`, y el CSV, las columnas «Moneda», «Tipo de cambio» y «Total en moneda original». Por
  convertir cada campo por separado, la suma de las partes puede diferir del total en 1 centavo.
- **Alternativa:** convertir solo la base y recalcular el ISV en lempiras (otro redondeo), o un libro por
  moneda. Va en la consulta al SAR: P-17 (y P-14).

### DEC-051 · Una nota de crédito no supera su original ni cambia la tasa; en la API, original externo solo con admin · [REVISAR]
- **Contexto:** la revisión de la 0.2.0 emitió, sin aviso, una NC de L 1,150.00 sobre una factura de L 115.00 y una
  NC con ISV 15 % sobre una factura exonerada. Con la API, una llave de caja podía hacerlo, y también emitir una NC
  sobre un número inventado (`AVISO_ORIGINAL_EXTERNO`). El Art. 4 num. 32 (C L.381-385) dice que la NC respalda un
  ajuste, devolución o descuento sobre el «correspondiente» comprobante; ningún artículo fija un tope numérico, así
  que el tope es una derivación: no se puede devolver o descontar más de lo vendido, ni a otra tasa.
- **Elegida (2026-11-23, a pedido del responsable del proyecto):** con el original en el almacén, `emitir`
  rechaza con **error** (no consume número):
  - `NOTA_SUPERA_ORIGINAL` si la suma de las notas de crédito vigentes (no anuladas) sobre ese original, más la
    nueva, supera su total. Se compara en lempiras: un original en moneda extranjera se convierte con su tipo de
    cambio (DEC-018). El mensaje trae el total, lo ya acreditado y el saldo disponible. Las notas de débito no
    amplían el saldo. Una nota anulada libera su importe.
  - `NOTA_TASA_DISTINTA` si la nota lleva ISV a una tasa que el original no tenía, o ISV sobre un original
    exonerado.

  Para que dos cajas no emitan a la vez notas que juntas superen el original, la emisión bloquea también la serie
  del original. Con un original **externo** no hay con qué comparar: sigue el aviso `AVISO_ORIGINAL_EXTERNO`
  (DEC-004). Como **política de seguridad de la API** (no fiscal), esa nota requiere llave admin: con llave de caja,
  403 `SOLO_ADMIN` sin consumir número.
- **Antes (2026-11-19):** eran avisos y no sumaban las notas anteriores.
- **Alternativa:** dejar que las notas de débito amplíen el saldo, o permitir notas de crédito por encima del
  original con confirmación. Va en la consulta al SAR: P-16.

### DEC-052 · Correcciones de la auditoría de seguridad del 24-11-2026
- **Contexto:** una auditoría de seguridad (solo código y pruebas locales en sandbox) confirmó cuatro fallas.
  Ninguna cruza tenants ni ejecuta código, y ninguna cambia la interpretación fiscal.
- **Elegida:**
  - **Montos:** `descomponer` (núcleo) rechaza con `ErrorMonto` un exponente de más de ±30 o más de 40 dígitos,
    antes de calcular la potencia de 10. Con «1e10000000» (10 caracteres) una sola emisión bloqueaba el proceso
    de la API, compartido por todos los tenants, varios segundos.
  - **Llaves de caja:** la emisión falla cerrada (403 `CAJA_SIN_PUNTO`) si una llave de caja no tiene
    establecimiento y punto de emisión; antes usaba el punto que pidiera el cuerpo. La consola
    (`crearLlaveOperador`) valida `--caja 000-001`, y un disparador de INSERT en `api_llaves` (esquema API v4)
    rechaza llaves de caja sin punto aunque se inserten a mano. Es disparador y no CHECK porque un CHECK, aun
    `NOT VALID`, también se revisa en el UPDATE de `ultimo_uso` y dejaría con error 500 a una llave vieja.
  - **POS de ejemplo:** la revisión de anfitrión ya no se apaga sin `puerto`: usa el puerto del socket, y
    `PUERTO` vacío, `0` o no numérico no arranca.
  - **`/docs`:** Swagger UI 5.34.1 fija, con Subresource Integrity, CSP (solo esos archivos y el arranque por
    hash) y sin marcos. Se eligió una versión de casi cuatro semanas y no la última, publicada el día anterior.
- **Alternativa:** servir Swagger UI desde el propio origen con `swagger-ui-dist` como dependencia (descarta el
  CDN por completo), o quitar `/docs` en modo `alojado`. Queda como siguiente paso.

### DEC-053 · Validación de las nueve pistas pendientes de la auditoría
- **Contexto:** la auditoría del 24-11-2026 dejó nueve pistas «pendientes de validación» que no se pudieron
  comprobar sin Postgres. Cada una la validó un revisor independiente contra la base de pruebas.
- **Elegida:** dos se confirman y se corrigen:
  - **reportes sin cota de memoria** (media): DEC-059;
  - **webhooks sin tope por tenant** (baja): DEC-058.

  Siete no cruzan ninguna frontera de confianza y no son vulnerabilidades:
  - modo `local` por defecto;
  - TXT sin protección de fórmulas;
  - rutas del ejemplo Express sin autenticación propia;
  - escritura tardía de una entrega;
  - campos tipados sin escapar en el HTML;
  - controles en el texto ESC/POS;
  - `structuredContent` del MCP sin marcar.

  Aun así se aplica el endurecimiento barato que propuso cada revisor: DEC-057, DEC-058 y DEC-060, y la nota sobre
  TXT/JSONL en `docs/api.md`.
- **Alternativa:** corregir solo las confirmadas. Se descartó porque el endurecimiento costaba poco y cerraba
  diferencias entre lo documentado y lo implementado.

### DEC-054 · La API corre con un rol LOGIN que no es dueño de las tablas
- **Contexto:** el servidor se conectaba como dueño de las tablas (en Compose, el superusuario) y hacía
  `SET LOCAL ROLE fhn_app` en cada transacción. Cualquier SQL de esa sesión podía volver al dueño con `RESET ROLE`.
  Además, una instalación que se actualiza con un override de contraseñas podía quedar corriendo como
  superusuario sin aviso.
- **Elegida:**
  - **Dos conexiones.** `FHN_MIGRAR_URL` (el dueño) solo migra y prepara el modo local al arrancar, con un pool corto
    que se cierra antes de atender. `DATABASE_URL` es un rol LOGIN. Si no existe, la migración lo crea
    `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`, sin contraseña, y le concede `fhn_app`.
  - **Negativas a arrancar (con `FHN_MIGRAR_URL`).** La API no arranca si `DATABASE_URL` usa el mismo usuario que el
    dueño. Tampoco si su rol, o cualquier rol del que sea miembro (con NOINHERIT igual puede pasar a él con
    `SET ROLE`), es superusuario, tiene BYPASSRLS, es `pg_write_all_data` o `pg_read_all_data`, o es dueño de las
    tablas `fhn_*`/`api_*`.
  - **Modo anterior.** Sin `FHN_MIGRAR_URL` todo sigue como antes y el log lo avisa.
  - **Dueño sin superusuario.** El dueño no necesita ser superusuario (Supabase, RDS): las funciones
    `SECURITY DEFINER` no fijan parámetros propios en su definición, porque en PostgreSQL 15+ eso exige
    superusuario. Guardan y restauran `factura_hn.tenant`, y `fhn_api_autenticar` fija el tenant de la llave solo
    para leer `api_tenants`, que fuerza RLS al dueño. Con un dueño sin superusuario, antes toda llave daba 401.
  - **Esquema API v6.**
- **Alternativa:** exigir que el operador cree el rol a mano antes del primer arranque. Son más pasos para un
  negocio pequeño, y la instalación de Compose dejaría de funcionar sola.

### DEC-055 · Retención: la clave de idempotencia no caduca, caduca la copia de la respuesta
- **Contexto:** `api_idempotencia` y `api_entregas` crecían sin límite. Borrar claves viejas permitiría que un
  reintento tardío emitiera un segundo documento fiscal. Borrar entregas de `autorizacion.*` repetiría ese aviso,
  porque su deduplicación es la fila `(webhook_id, clave)`.
- **Elegida:** `fhn_api_mantenimiento(p_dias)` es `SECURITY DEFINER` y solo el rol de la aplicación la ejecuta.
  Pasados `greatest(p_dias, 7)` días:
  - **Idempotencia:** reduce la respuesta a `{numero}` y conserva la clave y la huella. Al repetir una clave
    compactada, el documento se lee del almacén fiscal, con su estado actual, y la huella se sigue comprobando: otro
    cuerpo da 422.
  - **Entregas:** borra las `ENTREGADA`/`FALLIDA` de `documento.*`. Las de `autorizacion.*` quedan como lápida, con
    el cuerpo vacío.

  El servidor la llama al arrancar y cada hora con `FHN_RETENCION_DIAS` (30 por defecto). Un índice parcial
  sobre lo que falta compactar evita recorrer las filas ya compactadas.
- **Alternativa:** borrar las claves con TTL (permite facturas duplicadas) o no forzar RLS al dueño en
  `api_idempotencia` (debilita el aislamiento).

### DEC-056 · La llave admin del negocio no pasa por el log del servidor
- **Contexto:** al primer arranque, la llave admin del tenant `local` quedaba en `docker compose logs`, donde la
  puede leer cualquiera con acceso a Docker o a los logs rotados.
- **Elegida:** el tenant `local` se crea sin llave. Mientras no tenga llave admin activa, el servidor imprime el
  comando `docker compose exec api node cli.cjs llave crear local --rol admin --nombre Administración`. La consola
  imprime la llave solo en la terminal del operador y da un error claro con un tenant inexistente. Las llaves del
  demo (CAI ficticio) se siguen imprimiendo, marcadas como sin validez fiscal.
- **Alternativa:** imprimir la llave y pedir que se rote el log. Depende de que el operador lo haga.

### DEC-057 · Modo local con tenants de otros negocios
- **Contexto:** sin `FHN_MODO` la API arranca en modo local, con webhooks hacia la red interna y sin bóveda de
  secretos, aun sobre una base con varios negocios.
- **Elegida:** sin `FHN_MODO`, aviso en el log. En modo local la API no arranca si hay en uso tenants distintos de
  `local` y `demo`; se ignoran los desactivados sin llaves activas. El error ofrece dos salidas: `FHN_MODO=alojado`,
  o el SQL para desactivar esos tenants y revocar sus llaves, sin borrar nada.
- **Alternativa:** cambiar el modo por defecto a `alojado`. Rompería la instalación local de un solo negocio, que es
  la recomendada.

### DEC-058 · Límite de webhooks activos, guarda del arrendamiento e id de entrega
- **Contexto:** sin límite, un tenant podía multiplicar las filas de entregas por emisión. Se midió: 50 webhooks
  escribieron 16 MB por una sola factura. Un resultado HTTP que llegaba después de vencer el arrendamiento podía
  devolver a `PENDIENTE` una entrega ya `ENTREGADA`. El id de entrega salía de una secuencia global, que revelaba
  el volumen de toda la instalación.
- **Elegida:**
  - A lo sumo 20 webhooks activos por tenant (409 `LIMITE_WEBHOOKS`). Se cuentan después de un
    `pg_advisory_xact_lock` por tenant, porque `FOR UPDATE` requiere permiso de UPDATE y no cubre el caso de cero
    filas.
  - El reclamo devuelve el `proximo` arrendado en microsegundos, y la escritura del resultado exige
    `estado = 'PENDIENTE'` y ese mismo valor.
  - `X-FacturaHN-Entrega` y el `id` del cuerpo son un UUID por entrega, el mismo en cada reintento.
- **Alternativa:** un candado de fila sobre `api_tenants` (requiere dar UPDATE al rol) o una columna de
  arrendamiento aparte.

### DEC-059 · Reportes de período completos pero acotados en memoria y en conexiones
- **Contexto:** DEC-047 dejó los reportes (`libro-ventas`, `exportacion`, `no-utilizados`) completos. Cada uno
  cargaba todos los documentos, con sus líneas, en un solo arreglo y armaba la respuesta entera como un texto. Una
  llave de caja con 10 solicitudes a la vez sobre 300 documentos grandes sumó 839 MB de heap. Con
  `--max-old-space-size=768` el proceso, compartido por todos los tenants, se cayó.
- **Elegida:** los reportes siguen completos, con estos límites.
  - **Lectura por páginas.** Keyset sobre `numero`, para conservar el orden y que la salida sea idéntica: 200
    documentos sin `lineas`, o 50 completos para `jsonl`. Se usan métodos opcionales del almacén
    (`paginaDocumentos`, `contarDocumentos`, `correlativos`). El núcleo recurre a `documentos` si faltan, sigue
    hasta una página vacía y falla si el adaptador no avanza.
  - **Transmisión.** El libro de ventas (JSON y CSV) y la exportación se transmiten fila por fila, iguales byte por
    byte, desde una transacción de solo lectura REPEATABLE READ con una sola conexión.
  - **Tope.** Antes del primer byte se cuenta y se aplica el tope, con la misma instantánea que el encabezado `txt`
    y las filas: `FHN_MAX_DOCUMENTOS_REPORTE`, 50 000 por defecto. Más allá, 422 `PERIODO_DEMASIADO_GRANDE`.
  - **Bitácora.** La bitácora de la exportación se escribe al cerrar esa transacción, antes de la última parte. Si
    no se puede registrar, la respuesta se corta. Una exportación cortada queda con `completo: false`.
  - **Cupos.** 2 reportes en curso por tenant y, en todo el proceso, un cuarto del pool: al menos 1, nunca más que
    el pool menos 1 (`FHN_REPORTES_SIMULTANEOS_PROCESO`). Más allá, 429 `LIMITE_SOLICITUDES` con `Retry-After`.
  - **Plazos.** La respuesta va en partes de 64 KB, cada una en 30 s, y entera en 5 minutos. Si vence un plazo, se
    corta la base o corta el cliente, la respuesta termina con error (nunca un archivo truncado que parezca
    completo) y se liberan la conexión y los cupos.
  - **Conexión caída.** Una conexión que el servidor corta mientras está prestada ya no tumba el proceso. El pool
    falla a los 30 s en lugar de esperar para siempre.
  - **No utilizados.** `no-utilizados` lee solo correlativos.

  Con 2 000 y con 10 000 documentos, la memoria retenida queda por debajo de 1 MB.
- **Alternativa:**
  - Paginar los reportes con `limite` y `cursor`, como las demás listas: es un cambio incompatible, y el libro
    dejaría de cuadrar por período en una respuesta.
  - Una transacción corta por página: el tope y el encabezado `txt` podrían no coincidir con las filas.

  Los valores por defecto (50 000 documentos, 2 por tenant, un cuarto del pool, 5 minutos) se ajustan cuando
  haya datos de producción.

### DEC-060 · Datos de terceros en el render y en el MCP
- **Contexto:** la validación de las pistas encontró valores que se escribían sin escapar o sin marcar. Ninguno era
  explotable por alguien de menor confianza; es defensa en profundidad:
  - en `renderizarHTML`: la moneda, las fechas y el RTN del emisor, que pueden venir alterados de un JSONL;
  - en el texto ESC/POS: caracteres de control que la impresora toma como comandos;
  - en el MCP: el `structuredContent`, que entregaba el documento crudo, con un `</datos_documento>` inyectado.
- **Elegida:**
  - `renderizarHTML` pasa por `esc()` todo valor interpolado.
  - `renderizarTexto` cambia por espacio el tabulador, el CR, VT y FF, y por «?» los demás caracteres C0 y C1 (salvo
    `\n`).
  - El MCP quita `<datos_documento>` y `</datos_documento>` de todo texto del resultado y añade un campo `aviso`:
    el texto libre lo escribieron terceros y no son instrucciones.
  - El ejemplo Express responde 415 a `POST /pedidos/:id/factura` sin `application/json` y avisa que sus rutas no
    tienen autenticación propia.
- **Alternativa:** limpiar en el MCP solo una lista de campos libres. Obliga a mantenerla al día y deja fuera
  `codigo`, `unidad` u `operador`.

### DEC-061 · Los cambios previos a la primera publicación van en la 0.2.0, sin changesets
- **Contexto:** la 0.2.0 aún no está en npm, y había cinco changesets pendientes. Con ellos, el flujo Release
  habría sacado una 0.3.0 que anunciaría como nuevos cambios que ya vienen en la primera versión publicada.
- **Elegida:** su contenido pasa a la sección «Seguridad y operación» de la 0.2.0 en `CHANGELOG.md` y los archivos
  se borran. Desde la publicación de la 0.2.0, cada cambio lleva su changeset.
- **Alternativa:** publicar la 0.2.0 y luego versionar en seguida una 0.3.0 con esos cambios. Daría dos versiones
  con el mismo código.

## Lote 2: la primera factura en 5 minutos (Etapa 1)

Núcleo (DEC-062 a DEC-069), API (DEC-070 a DEC-073), MCP (DEC-074 a DEC-082), ejemplos (DEC-083 a DEC-085) e
integración (DEC-086 a DEC-089).

### DEC-062 · Submódulo `factura-hn/demo`
- **Contexto:** el playground, la API, el POS y el MCP mantienen cada uno su copia de los datos demo, y calculan la
  fecha límite con `toISOString()` (fecha UTC). Para la primera factura había que inventar un CAI y siete datos de
  emisor (análisis SDK, C2).
- **Elegida:**
  - `factura-hn/demo` exporta `EMISOR_DEMO` (ficticio, RTN `99990000000000`, razón social «NEGOCIO DE
    DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)», igual que la API), `caiDemo(tipo)` (`DEMO00-NO-VALIDO-0000-0000-0000-TT`,
    el mismo prefijo de la API y el playground), `autorizacionDemo({ hoy?, tipoDocumento?, establecimiento?,
    puntoEmision?, rangoInicial?, rangoFinal? })`, `crearFacturadorDemo(opciones?)`, `LEYENDA_PRUEBA` y
    `esCAIDemo(cai)`: true si el CAI empieza con `DEMO00-NO-VALIDO-` (sin importar mayúsculas ni espacios en los
    extremos). Es el contrato con la API (`operador.ts`) y el MCP, que marcan la demo solo por el CAI. Vive en
    `modo.ts` (sin depender de la demo) y se exporta también desde el índice. `PREFIJO_CAI_DEMO`, el largo, solo
    construye el CAI.
  - Con un almacén persistente, si la demo de la caja venció, `crearFacturadorDemo` registra otra con el CAI
    `DEMO00-NO-VALIDO-0000-0000-AAAAMMDD-TT` y el rango a continuación. Es solo para pruebas.
  - `autorizacionDemo({ hoy })` con una fecha que no es `Date` válido ni `YYYY-MM-DD` lanza `ErrorValidacion`
    con `FECHA_DEMO` (antes, `RangeError`).
  - La fecha límite es hoy **en Honduras** más 180 días; el rango, del 1 al 1,000,000; la autorización lleva
    `prueba: true`.
  - `crearFacturadorDemo` registra CAI 01, 06 y 07 en 000-001 (configurable) sobre un almacén en memoria o el que
    se le pase, y no los repite si ya están.
  - El build usa `--splitting` también en CJS: `factura-hn/demo` y `factura-hn/pruebas` comparten con el índice la
    clase `ErrorValidacion` (antes, en CJS, cada entrada traía su propia copia y `instanceof` fallaba).
- **Alternativa:** exportar los datos demo desde el índice. Mezcla en el camino de producción algo que nunca debe
  usarse en producción; el submódulo deja el «demo» en el nombre del import.

### DEC-063 · Modo de prueba visible
- **Contexto:** los impresos de la demo salían como facturas reales, sin leyenda (plan v1, 1.2).
- **Elegida:**
  - Una autorización es de prueba si tiene `prueba: true` **o** un CAI ficticio (`esCAIDemo`); así los CAI
    `DEMO00-…` que la API y el MCP registran sin la marca también salen con leyenda. Todo documento emitido con
    ella lleva `modo: 'prueba'` (campo opcional e inmutable, se conserva al anular). `esDocumentoDePrueba` también
    reconoce un documento guardado sin `modo` pero con CAI ficticio.
  - `prueba` que no es booleano: `AUTORIZACION_PRUEBA_FORMATO`. `prueba: true` con un CAI que no es ficticio:
    `AUTORIZACION_PRUEBA_CAI_REAL`. Así un CAI con forma real nunca gasta correlativos «sin valor fiscal».
  - `renderizarHTML`, `renderizarTexto` y `@factura-hn/pdf` imprimen `DOCUMENTO DE PRUEBA — SIN VALOR FISCAL` al
    inicio y al final (HTML: recuadro rojo y «PRUEBA ·» en el título; texto: enmarcada con asteriscos; PDF: en
    negrita y con marca de agua PRUEBA). Un documento real da los mismos bytes que en la 0.2.0 (huellas en las
    pruebas de HTML, texto y PDF).
  - Un punto de emisión (establecimiento + punto, en todos los tipos) es entero de prueba o entero real:
    `AUTORIZACION_MODO_MEZCLADO` al registrar. Una nota cuyo original guardado es de otro modo:
    `REFERENCIA_MODO_MEZCLADO`. El saldo de `NOTA_SUPERA_ORIGINAL` no cuenta notas de otro modo. Para probar, otro
    almacén (otra base), no otro punto del almacén real.
  - La leyenda es marca del producto, no regla fiscal: ningún artículo la exige ni la regula.
- **Alternativa:** solo el campo `prueba`. Un CAI ficticio sin la marca saldría sin leyenda, y un CAI real con la
  marca gastaría números reales; por eso cuentan las dos cosas y se exige el CAI ficticio.

### DEC-064 · La exportación y el libro de ventas excluyen los documentos de prueba
- **Contexto:** con el modo de prueba, un archivo para el SAR o un libro de ventas podía sumar documentos sin
  valor fiscal (revisión independiente, punto 4).
- **Elegida:**
  - `exportarTexto` (CSV, TXT y JSONL) deja fuera los documentos de prueba (`esDocumentoDePrueba`). Las filas y
    las columnas no cambian (`VERSION_EXPORTACION` sigue en 1); el total del encabezado TXT cuenta solo los
    exportados. Como la función devuelve texto, el número de excluidos se obtiene con
    `separarDocumentosDePrueba(docs).excluidos` (documentado).
  - `libroVentas(docs)` (nueva) devuelve `{ filas, resumen, excluidos }` sin los de prueba.
  - `lineaExportacion` y `filaLibroVentas` son por documento y no filtran: su documentación pide filtrar antes.
    La API (exportación transmitida, libro) y el MCP (libro) las usaban así; filtran desde la integración (DEC-087).
- **Alternativa:** una columna `modo` en el CSV/TXT. Cambia el formato (nueva versión) y deja al lector la tarea
  de no sumarlos. También: que `filaLibroVentas` lance con un documento de prueba; rompería la API y el MCP en
  modo demo.

### DEC-065 · Errores que dicen qué hacer
- **Contexto:** los errores de configuración de los primeros minutos (`SIN_AUTORIZACION`, `RANGO`, falta de
  `almacen`) no decían qué hacer; sin `almacen` salía un `TypeError` (análisis SDK, C5-C6).
- **Elegida:**
  - `Problema` gana `solucion?` y `documentacion?` (URL `…/docs/errores.md#codigo`). El catálogo `SOLUCIONES` cubre
    todos los errores del núcleo; `ErrorValidacion` y `validarEntrada`/`validarAutorizacion` los completan. Los
    avisos (`AVISO_*`) no se completan, así el documento guardado (sus `advertencias`) no cambia.
  - El `message` de `ErrorValidacion` incluye «Solución: …» y «Más información: URL» por problema; se mantiene el
    prefijo «Documento inválido:» (I5 queda para otra vez).
  - `SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA` y `RANGO_AGOTADO` nombran la serie y el tipo, la fecha o el último
    número; `SIN_AUTORIZACION` trae la llamada exacta que falta. `RANGO` dice qué extremo falla.
  - `docs/errores.md` incluye `DEMASIADOS_INTENTOS` (API, 429) y los códigos de la revisión:
    `AUTORIZACION_PRUEBA_FORMATO`, `AUTORIZACION_PRUEBA_CAI_REAL`, `REFERENCIA_MODO_MEZCLADO` y `FECHA_DEMO`.
  - Código nuevo `ALMACEN_REQUERIDO` en `emitir`, `anular`, `registrarAutorizacion`, `buscarDocumento`,
    `eventosAuditoria`, `corregirFechaAdelantada` y `crearFacturador`.
  - Nuevas exportaciones: `validarEmisor`, `esErrorValidacion`, `SOLUCIONES`, `enlaceError`, `URL_ERRORES`,
    `conSolucion`.
  - `docs/errores.md` (público) con un `### CODIGO` por código del SDK, la API y el MCP; una prueba falla si un
    código de `packages/core/src`, `packages/api/src` o `packages/mcp/src` no tiene encabezado.
- **Alternativa:** un campo `fuente` con el artículo (propuesto en el análisis). Se deja para la referencia
  generada de la Etapa 2; el artículo sigue en el mensaje.

### DEC-066 · Fachada `crearFacturador` (no es un segundo camino)
- **Contexto:** DEC-007 deja solo `emitir` y `anular` como caminos públicos. Configurar almacén, emisor y caja en
  cada llamada alarga la primera factura y las notas de crédito (análisis SDK, C1).
- **Elegida:** `crearFacturador({ almacen, emisor, establecimiento?='000', puntoEmision?='001', reloj?,
  preciosIncluyenISV?, actor?, libroContable?, umbralIdentificacionConsumidorFinal?, caiEstricto?,
  saltoMaximoDias? })` con `registrarAutorizacion`, `cotizar`, `emitir`, `notaCredito`, `notaDebito`, `anular(numero,
  motivo, opciones?)`, `documento` y `documentos`. Cada método llama a `emitir`, `anular`, `registrarAutorizacion` o
  `buscarDocumento`: misma transacción, validaciones y bitácora. DEC-007 se respeta: no hay otra forma de construir
  un documento. Valida almacén y emisor al crearse. `notaCredito`/`notaDebito` copian del original guardado el
  cliente, la referencia, la moneda y `preciosIncluyenISV`; `emitir` lo vuelve a comparar (B-13). Devuelve
  `DocumentoFiscal`, como `emitir`.
- **Alternativa:** la forma de `@factura-hn/cliente` (`{ documento, repetida }` con `idempotencyKey`). Sin
  idempotencia en el núcleo (C3, fuera de esta rama), `repetida` siempre sería false; se puede añadir con C3.
  También: `preciosIncluyenISV` obligatorio en la configuración (análisis); quedó opcional con false por defecto,
  igual que `emitir`, para no romper la firma pedida. [REVISAR si se prefiere obligatorio antes de la 1.0]

### DEC-067 · CLI `factura-hn` (demo e init)
- **Contexto:** la meta de los 5 minutos pide `npm install factura-hn` → un comando → emitir, sin escribir código.
- **Elegida:** bin `factura-hn` (`dist/cli.js`, solo ESM, sin dependencias), en español: `demo` (emite en memoria,
  imprime el ticket y escribe `factura-demo.html`), `init`/`iniciar` (crea `emitir.mjs` y `emisor.json`), `ayuda`,
  `version`; comando desconocido: código 1. `init` no escribe nada si alguno de los dos archivos existe, salvo con
  `--forzar`. `emisor.json` trae datos ficticios **válidos** (RTN 9999…, correo `.example`) y una clave
  `_instrucciones`; `emitir.mjs` ignora las claves con `_` y usa `autorizacionDemo()`, así todo sale con la leyenda.
  `demo` y `emitir.mjs` no sobrescriben: si `factura-demo.html` o `factura.html` existe, escriben
  `…-2.html`, `…-3.html` y lo dicen. Una opción desconocida (`--force`, erratas) da error y código 1; para
  `--force` sugiere `--forzar`.
- **Alternativa:** plantilla vacía, como decidió la rama MCP. No cumpliría «`node emitir.mjs` emite sin errores».
  Como `emitir.mjs` usa un CAI de prueba, un RTN ficticio nunca sale en un documento real sin que alguien cambie el
  código. La integración las deja distintas, con su motivo (DEC-086).

### DEC-068 · Equivalente en lempiras en documentos en USD · [REVISAR]
- **Contexto:** el Art. 11 (párrafo final, C L.726-727) exige la tasa de cambio vigente a la fecha cuando la moneda
  es extranjera, y el Art. 11 num. 1 j habla de «Lempira o símbolo L». Ningún texto del repo exige imprimir el
  equivalente en lempiras.
- **Elegida:** al emitir un documento no HNL se guarda `equivalenteLempiras` (`{ isv15?, isv18?, total }`, campo
  opcional e inmutable): importe en centavos × tipo de cambio (6 decimales), redondeado al centavo, mitad lejos de
  cero (Art. 9 de la Ley del ISV); `isv15` e `isv18` solo si son mayores que 0. El HTML, el texto y el PDF lo
  imprimen bajo el tipo de cambio **solo si el documento lo tiene**. Un documento en USD guardado antes se
  reimprime con los mismos bytes que en main (Art. 38; huellas en la prueba). Los importes siguen en su moneda; un
  documento en lempiras no cambia.
- **Alternativa:** convertir todo el documento a lempiras. Cambiaría importes y totales ya emitidos y la
  interpretación de qué moneda manda. Confirmar con el SAR si el equivalente es exigible y con qué redondeo (P-18).

### DEC-069 · Tasa del 18 %: sin fuente primaria en el repo · [REVISAR]
- **Contexto:** `TASAS_ISV.ISV18` (`packages/core/src/calculo.ts`) cita el Decreto 278-2013, Art. 16 (La Gaceta
  33,316). `docs/investigacion.md` (fila ISV 6, B-14, P-11) dice que ese texto **no** está entre las fuentes
  primarias y que la copia de la Ley del ISV del TSC aún muestra 12 %/15 %. `docs/normativa.md` lista los bienes al
  18 % sin cita.
- **Elegida:** no se cambia la tasa ni se agrega artículo. Falta conseguir el texto oficial del Decreto 278-2013
  Art. 16 (y sus reformas) y la lista vigente de bienes y servicios al 18 % (P-11); entonces citarlo en
  `TASAS_ISV`, `normativa.md` y la matriz.
- **Alternativa:** citar el Art. 16 como fuente confirmada. Sería una cita sin texto verificado.

### DEC-070 · Límite de solicitudes: la llave cuenta solo su secreto; los intentos fallidos, aparte
- **Contexto:** revisión de la 0.2.0 (MEDIO). El límite por llave se tomaba del prefijo antes de comprobar el
  secreto. El prefijo es público (listados, bitácora): quien lo conocía dejaba esa llave en 429. Y quien probaba
  prefijos aleatorios consultaba Postgres en cada intento sin llegar nunca a 429. Lo reproducen las pruebas de
  `packages/api/test/limitador.test.ts` (fallaban con el código anterior).
- **Elegida:**
  - La cubeta de la llave (20/s, ráfaga 40) se gasta solo después de validar el secreto.
  - El proceso recuerda el hash de las llaves que ya validó (máx. 10 000, en memoria). Una llave así no pasa por
    el límite de intentos (la base se sigue consultando: una revocada da 401 y sale de la memoria). Un secreto
    equivocado con ese prefijo se rechaza sin consultar la base (el hash de un prefijo no cambia) y **no** la
    saca de la memoria.
  - Llaves no validadas: un semáforo de 4 consultas a la vez en el proceso, con una cola de a lo sumo 256
    (`maxEnCola`) y 5 s de espera máxima (`esperaMaxMs`). Más allá, 429 `DEMASIADOS_INTENTOS` con `Retry-After`.
    Una sola consulta por prefijo a la vez: las solicitudes simultáneas con la misma llave esperan ese resultado
    sin reservar (así, 3 cajas nuevas × 15 ventas en paralelo desde una dirección hacen 3 consultas y ningún 429).
  - Cubeta por dirección (2/s, ráfaga 20), que solo frena **con el semáforo saturado** (hay que hacer cola):
    entonces la dirección necesita `fichas - consultasEnCurso >= 1` para esperar en cola; si no, 429
    `DEMASIADOS_INTENTOS` sin consultar. Con lugares libres, la consulta corre aunque la dirección no tenga
    fichas: todas las cajas de una instalación con Docker llegan desde la IP de la puerta de enlace y no deben
    quedar en 429 por los fallos de otra. Un prefijo inexistente gasta una ficha; la reserva se suelta en un
    `finally`; una llave válida no gasta nada. Así, 100 llaves falsas en paralelo desde una dirección hacen 20
    consultas (4 corren, 16 esperan en cola, 80 reciben 429).
  - Un prefijo que ya se sabe registrado no gasta fichas de la dirección, pero con el semáforo saturado la
    dirección no puede tener más de `rafaga` consultas en curso (tercera revisión): sin ese tope, quien conoce
    muchos prefijos (un admin que crea llaves y las «quema» con un secreto equivocado) llenaba los lugares y la
    cola, y las llaves nuevas de otros tenants recibían 429.
  - Un prefijo registrado sin llave activa (revocada o tenant inactivo) se recuerda 15 s (`memoriaInactivaMs`):
    mientras tanto se responde 401 o 429 (cubeta del prefijo) sin consultar la base. Un tenant reactivado vuelve
    a entrar al pasar ese tiempo.
  - Con más de 10 000 cubetas en memoria se descartan primero las llenas (no guardan nada que no se recupere al
    recrearlas); solo si no hay llenas, la más antigua. Crear muchas claves nuevas no borra la cubeta vacía de
    quien ataca.
  - En modo alojado sin `FHN_PROXIES_DE_CONFIANZA`, el arranque avisa en el log: detrás de un proxy, todas las
    solicitudes contarían como una sola dirección.
  - Fallos de un prefijo que existe (secreto equivocado, llave revocada, tenant inactivo) se cobran a una cubeta
    por prefijo (mismas tasas), no a la dirección: una caja que reintenta con su llave revocada se frena sola y
    no deja en 429 a las demás cajas detrás de la misma dirección (en la instalación local, todas llegan con la
    IP de la puerta de enlace de Docker). Para distinguir «revocada» de «no existe» se agrega
    `fhn_api_prefijo_registrado(prefijo)` (esquema de la API v7, `SECURITY DEFINER`, solo para el rol de la
    aplicación), que se consulta solo cuando no hay llave activa. El 401 es idéntico en todos los casos.
  - Sin cubeta global: el semáforo acota la carga sobre Postgres (la cubeta global dejaba el proceso entero en
    429 a cualquiera con muchas direcciones). Segunda revisión: la cola sin tope crecía sin límite en memoria;
    ahora tiene tope y espera máxima.
  - La dirección es la del socket. `X-Forwarded-For` se usa solo con `FHN_PROXIES_DE_CONFIANZA`: la lista de
    direcciones de los proxies (la cabecera se cree solo si el socket es uno de ellos) o un número N (la N-ésima
    desde la derecha; solo si a la API se llega únicamente por el proxy, documentado). Direcciones normalizadas:
    grupos IPv6 expandidos, IPv6 agrupada por /64, IPv4 mapeada en IPv6 como IPv4.
- **Alternativa:** (1) reservar antes de consultar y devolver al autenticar, sin agrupar por prefijo: deja en 429
  a muchas cajas nuevas que arrancan a la vez. (2) Mirar la cubeta antes y cobrar después (la primera versión):
  intentos concurrentes se saltaban el límite. (3) Cubeta global de intentos: un atacante sin llave dejaba el
  proceso en 429.
- **Límite conocido:** la existencia de un prefijo se nota en a quién se cobra el fallo (al prefijo o a la
  dirección), no en la respuesta. Un prefijo son 48 bits aleatorios y cada intento con uno inexistente gasta
  fichas de la dirección: no sirve para enumerar. Un atacante que conoce el prefijo de una llave que el proceso
  aún no validó (p. ej. tras reiniciar) puede hacer que esa llave reciba 429 en sus fallos, pero no en sus
  aciertos: con la cubeta del prefijo agotada la base se sigue consultando (una a la vez por prefijo, dentro del
  semáforo) y el secreto correcto entra.
- **Límite conocido (segunda revisión):** con el semáforo libre, una dirección que prueba prefijos inexistentes
  uno tras otro consulta la base en cada intento (a lo sumo 4 consultas a la vez en el proceso). Se acepta: la
  alternativa deja en 429 a las cajas que comparten la dirección. Además, el tiempo de respuesta distingue «llave
  activa ya validada» (en memoria, sin consulta) de «revocada» (una consulta, o la memoria de 15 s). Solo lo
  aprovecha quien ya tiene un prefijo; no revela secretos ni prefijos nuevos, y el cuerpo del 401 sigue siendo
  idéntico. Se acepta.

### DEC-071 · Errores con `solucion` y `documentacion`
- **Contexto:** plan v1 §2 punto 1.5 y `docs/analisis/api-rest.md` §3.2: los errores no decían qué hacer ni
  enlazaban una guía; los 400 salían en inglés.
- **Elegida:**
  - Una tabla de soluciones en la API (`soluciones({ consola, modo, hayDemo })` en `errores.ts`) para los
    códigos frecuentes. El error principal gana `solucion` y `documentacion`
    (`…/docs/errores.md#<codigo en minúsculas>`).
  - En 422 (`VALIDACION`) el principal toma la solución y el enlace del primer problema que tenga solución; cada
    elemento de `errores` gana `documentacion` siempre y `solucion` si se conoce. Si el núcleo ya trae `solucion`
    en un problema, no se pisa.
  - Los 400 de forma se traducen en el `defaultHook` de la API con `z.locales.es().localeError`, sin
    `z.config` global (la API también se usa como biblioteca: no cambia los mensajes de Zod de quien la importa).
    Como Zod ya no trae la entrada en el problema, se toma de lo validado por su ruta (para «recibido texto»), y
    solo se traduce el mensaje que coincide con el de Zod por omisión: los mensajes propios del esquema se
    respetan. El primer campo va en `error.campo` y en el mensaje.
  - Las respuestas sin autenticar las lee cualquiera: en modo alojado, `NO_AUTENTICADO` dice «pide una al
    operador de la API» sin comandos ni tenants; en modo local nombra la consola de este despliegue
    (`FHN_CONSOLA`) y `demo llave` solo si existe el demo. `DEMASIADOS_INTENTOS` dice que el límite pudo ser de
    la dirección o de la llave.
- **Alternativa:** dejar las soluciones al catálogo del núcleo. No cubre los códigos propios de la API (llave,
  rol, límites, cuerpo) y la API los necesita ya.

### DEC-072 · `GET /v1/sesion`
- **Contexto:** «¿quién soy?» y «¿qué falta para emitir?» (análisis 3.7 y 3.12).
- **Elegida:** cualquier rol. Devuelve tenant, modo, `demo`, la llave sin secreto, el emisor (registrado, RTN,
  razón social), los puntos (de la caja; o, para admin, los que tienen autorizaciones) con, por tipo, `listo`,
  `siguienteNumero`, autorizaciones vigentes y `problema`; el uso del mes (`documentosDelMes`, de todo el tenant:
  solo para admin, `null` para caja, que no ve la actividad de las demás cajas) y el límite; `puedeEmitir` y
  `pendientes`. La elección usa `elegirAutorizacion` del núcleo, la misma de la emisión. `puedeEmitir` mira solo
  la factura (01): sin CAI de NC o ND se puede empezar a vender. Una llave admin puede emitir si algún punto está
  listo. Corre en una transacción del tenant (RLS).
- **Alternativa:** `GET /v1/account` al estilo Stripe sin diagnóstico. No resuelve la duda de quien empieza.

### DEC-073 · Llaves del demo visibles y recuperables; una sola forma de invocar la consola
- **Contexto:** `primeros-5-minutos.md`, hallazgo 6: la llave útil del demo estaba perdida en el log y no había
  cómo recuperarla. La consola aparecía como `node cli.cjs` dentro de Docker y `factura-hn-api` fuera.
- **Elegida:**
  - Al crear el demo, el servidor imprime un bloque destacado con la leyenda `DOCUMENTO DE PRUEBA — SIN VALOR
    FISCAL` y el comando para otra llave. En los arranques siguientes, una línea recuerda ese comando.
  - Comando nuevo `demo llave [--rol caja|admin] [--solo-llave]`. Con `--solo-llave`, la llave va sola a la
    salida estándar (para `LLAVE=$(…)`) y el aviso, a la de errores. Solo crea llaves si el tenant `demo` es el
    de demostración (tiene el emisor ficticio o un CAI `DEMO00-NO-VALIDO-…`); `crearTenant` reserva los nombres
    `local` y `demo`. El aviso de una llave admin no la ata a 000-001.
  - La imagen de Docker instala `/usr/local/bin/factura-hn-api` y define `FHN_CONSOLA="docker compose exec api
    factura-hn-api"`. Una sola forma por contexto: `docker compose exec api factura-hn-api …` con Compose y, fuera,
    `node packages/api/dist/cli.js …` desde la raíz del repositorio compilado (el paquete es privado:
    `factura-hn-api` no queda en el PATH). `node cli.cjs` sigue funcionando en la imagen.
  - El paso 2 usa un cuerpo de ejemplo versionado (`packages/api/ejemplos/factura.json`) y extrae `enlaces.pdf` con
    `sed`, sin `jq`. curl con `-sf`/`-f` para que un error corte el paso; en PowerShell, `-UseBasicParsing` e
    `-InFile (Resolve-Path …)`, que funcionan en Windows PowerShell 5.1 y en PowerShell 7.
- **Alternativa:** dejar la llave en el log y documentar `grep`. Se pierde con el log y no sirve en un script.

### DEC-074 · La base de prueba del MCP va aparte de la real
- **Contexto:** `init --demo` registra un CAI ficticio. Si comparte base con el negocio, la serie 000-001-01 queda
  con documentos de prueba y números consumidos, y un CAI real después se solaparía o empezaría en otro número. Los
  documentos de prueba terminarían en el libro de ventas.
- **Elegida:**
  - `init --demo` usa `factura-demo.db` y `emisor-demo.json`; `init` usa `factura.db` y `emisor.json`. Pueden
    convivir en la misma carpeta.
  - Una base es de prueba si tiene algún CAI ficticio (en autorizaciones o documentos), en cualquier serie.
    `registrar-cai` y la herramienta `registrar_cai` rechazan el CAI ficticio (`CAI_DEMO`) y no registran ningún
    CAI real en una base de prueba (`BASE_DEMO`).
  - `init --demo` no toca una base con algún CAI real: ni registra el CAI ficticio (valida los tres tipos antes de
    registrar el primero) ni la borra con `--forzar`.
  - `--forzar` reescribe el archivo del emisor (del real, guarda antes `emisor.json.bak`) y, con `--demo`, recrea la
    base de prueba. Nunca borra la base real: guarda documentos fiscales (Art. 41).
  - El CAI ficticio se reconoce por el prefijo `DEMO00-NO-VALIDO-`, que el núcleo usa también; desde la
    integración, `esCAIDemo` es el del núcleo (DEC-086).
- **Alternativa:** un solo `factura.db` para todo, con `--forzar` para limpiarlo antes de pasar a real. Obliga a
  borrar una base que, por error, ya puede tener documentos reales.

### DEC-075 · La plantilla de emisor.json va vacía
- **Contexto:** `init` sin `--demo` crea `emisor.json`. Con datos de ejemplo válidos, el servidor arrancaría y
  emitiría con un RTN ficticio en cuanto el usuario registre su CAI real.
- **Elegida:** los siete campos van vacíos, más una clave `_instrucciones`. El servidor no arranca hasta llenarlos y
  dice qué falta en cada uno. Las claves que empiezan con `_` no se leen.
- **Alternativa:** valores de ejemplo como `"Razón social de tu negocio"`. Pasan la validación y se imprimirían en
  documentos reales.

### DEC-076 · Validación de emisor.json: un error por campo, con el tipo y las claves mal escritas
- **Contexto:** el servidor ya validaba con `validarEntrada` y mostraba los mensajes del núcleo, sin decir qué
  escribir. Un RTN escrito como número (pierde ceros a la izquierda) o una clave con otra mayúscula
  (`RazonSocial`) aparecían como «falta».
- **Elegida:** las mismas reglas del núcleo (Art. 10 num. 1), una línea por campo con qué escribir, más dos
  revisiones de forma: un valor que no es texto pide comillas, y una clave que solo difiere en mayúsculas o tildes
  de un campo conocido dice el nombre correcto. Las demás claves desconocidas se ignoran, para no romper si el
  emisor gana campos opcionales.
- **Alternativa:** rechazar toda clave desconocida. Es más estricto, pero obliga a cambiar el MCP con cada campo
  nuevo del núcleo.

### DEC-077 · Reintentos: `Backend.emitir` devuelve `{ documento, repetido }`
- **Contexto:** un reintento con la misma `idempotencyKey` devolvía el documento con el texto «Emitida», igual que
  una emisión nueva (primeros-5-minutos, hallazgo 15). El asistente podía decir que emitió dos facturas.
- **Elegida:** `Backend.emitir` devuelve `{ documento, repetido }`. En modo SQLite, `repetido` es true si la clave
  ya estaba en `mcp_claves` (también cuando otro intento simultáneo ganó la carrera); en modo API, si la respuesta
  trae `Idempotency-Replayed: true`. El texto empieza con «Ya estaba emitida… NO se emitió otro documento» y
  `structuredContent.repetido` lo dice. Es un cambio incompatible para quien implementa o llama `Backend`
  (0.x, con su changeset).
- **Alternativa:** marcar el documento devuelto con una propiedad extra. Mezcla un dato de transporte con un
  documento fiscal inmutable.

### DEC-078 · `cliente` en las notas de crédito del MCP
- **Contexto:** verificado contra `main`: una NC sobre una factura **con** RTN sí se emitía, porque la herramienta
  copia el adquirente del original. Lo que no se podía era una NC sobre una factura a CONSUMIDOR FINAL: el núcleo
  exige nombre y RTN del adquirente en las notas (Arts. 26 y 28, `NOTA_CLIENTE_RTN`) y la herramienta no tenía
  cómo recibirlos.
- **Elegida:** `emitir_nota_credito` acepta `cliente` opcional. Se parte del adquirente del original y lo que
  indique la herramienta lo completa o reemplaza. El núcleo sigue comprobando que el RTN sea el del original
  cuando este lo tiene (`REFERENCIA_RTN_NO_COINCIDE`). No se añade ninguna regla fiscal.
- **Alternativa:** usar solo el `cliente` de la herramienta, sin el original. Obliga al asistente a repetir nombre
  y RTN aunque ya estén en el documento.

### DEC-079 · Nota de crédito con `cliente` sobre una factura a CONSUMIDOR FINAL · [REVISAR]
- **Contexto:** con `cliente` en `emitir_nota_credito`, una nota sobre una factura emitida a CONSUMIDOR FINAL (sin
  RTN) acepta el nombre y el RTN que indique el asistente. El núcleo exige nombre y RTN del adquirente en toda nota
  (`NOTA_CLIENTE_RTN`, `CLIENTE_NOMBRE`; Arts. 26 y 28, fila «Notas: nombre y RTN del adquirente» de
  `docs/normativa.md`) y solo compara el RTN con el del original cuando el original lo tiene
  (`REFERENCIA_RTN_NO_COINCIDE`); si no, da `AVISO_ORIGINAL_SIN_RTN`. Así, la nota puede dar crédito fiscal a un
  adquirente que el original no identificaba.
- **Elegida:** se deja como lo resuelve el núcleo: el MCP no añade reglas. La descripción pide usar los datos que dé
  el usuario. Queda [REVISAR]: si una nota sobre un original sin RTN debe aceptarse, y con qué RTN, es una
  interpretación de los Arts. 26 y 28 que debe decidir el responsable (y, en su caso, aplicarse en el núcleo).
- **Alternativa:** que el MCP rechace `cliente.rtn` cuando el original no tiene RTN. Sería una regla fiscal nueva
  fuera del núcleo, y dejaría sin camino la devolución de una venta a consumidor final.
- **Consulta al SAR:** P-19.

### DEC-080 · Errores del MCP con `solucion` y `guia`
- **Contexto:** el error `[SIN_AUTORIZACION] … (Arts. 59-61)` decía qué faltaba, pero no cómo resolverlo desde el
  MCP (primeros-5-minutos, hallazgo 3).
- **Elegida:** cada error del resultado lleva `solucion` (texto para el asistente) y `guia`
  (`…/docs/errores.md#<codigo en minúsculas>`), en el texto y en `structuredContent`. Las soluciones propias
  están en `packages/mcp/src/soluciones.ts` para los códigos que el MCP suele ver; los demás reciben un texto
  general que remite a la guía. `estado_cai`, `libro_ventas` y `consultar_documento` devuelven sus errores como
  resultado (`isError`) en vez de un error de protocolo. Un `fetch` sin conexión en modo API es `API_INACCESIBLE`.
- **Alternativa:** que la API o el núcleo traigan la solución en cada `Problema`. Es mejor a largo plazo, pero es
  de la rama `nucleo`; al integrar, `soluciones.ts` puede leer de ahí.

### DEC-081 · `registrar_cai`: anotaciones y lo que exige al asistente
- **Contexto:** el MCP no podía registrar un CAI (primeros-5-minutos, hallazgo 3). Un asistente que «completa»
  un CAI o un rango inventado deja la numeración fiscal mal desde el primer documento.
- **Elegida:** anotaciones `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false` (repetirla da
  `AUTORIZACION_DUPLICADA`) y `openWorldHint: false`. No borra nada, pero es irreversible (no hay forma de quitar un
  CAI) y fija la numeración fiscal: así los clientes piden confirmación. Acepta `ultimoEmitidoAntes`, y la
  descripción pide preguntar al usuario si ya emitió con ese CAI (talonario u otro sistema), para no repetir números. La descripción exige
  que cada dato venga de la resolución que dio el usuario, que no invente ni suponga ninguno y que confirme con él
  antes de registrar. En modo API usa `POST /v1/autorizaciones` (solo llave admin). Si la autorización es de otro
  punto de emisión que el del servidor, el resultado lo avisa.
- **Alternativa:** `destructiveHint: false`, porque no destruye datos. Los clientes la aprobarían sin preguntar, y
  un error de digitación quedaría fijo.

### DEC-082 · Bloque `mcpServers` según la plataforma
- **Contexto:** en Windows, `npx` es `npx.cmd` y varios clientes MCP no lo lanzan sin shell. La ruta de
  `claude_desktop_config.json` cambia según la instalación (la de Microsoft Store es otra).
- **Elegida:** `init` imprime `"command": "cmd", "args": ["/c", "npx", "-y", "@factura-hn/mcp"]` en Windows y
  `"command": "npx", "args": ["-y", "@factura-hn/mcp"]` en macOS y Linux. Las rutas son absolutas y propias del
  equipo, así que el bloque ya es de una plataforma. Dónde pegarlo se indica por el menú (Claude Desktop: Settings >
  Developer > Edit Config), no por la ruta del archivo.
- **Alternativa:** un solo bloque con `npx`. Falla en Claude Desktop para Windows.

### DEC-083 · Enlaces de los .md publicados: absolutos, y verificados en el tarball
- **Contexto:** en npmjs.com y dentro de `node_modules` no existe el resto del repositorio. `../core` en los README
  de pdf, postgres y sqlite quedaba roto, y el README de `factura-hn` (copia del README raíz) enlaza a
  `packages/…`, `examples/…`, `CONTRIBUTING.md` y `SECURITY.md`, que no viajan en el paquete.
- **Elegida:**
  - Los enlaces a otro paquete van a `https://www.npmjs.com/package/…`; los enlaces al repositorio, a
    `https://github.com/AugustoMelara-Dev/factura-hn/blob/main/…`.
  - `verificar-dist.mjs` revisa cada `.md` de cada tarball: los enlaces Markdown (`[texto](destino)`, también
    imágenes) y `href`/`src` de HTML, fuera de bloques y fragmentos de código. Falla si uno relativo sale del
    paquete o apunta a algo que no está en él.
  - Excepción temporal: el `README.md` de `factura-hn` solo avisaba (`ENLACES_PENDIENTES`), porque se reescribía
    en la integración. Desde la integración la lista está vacía (DEC-089).
- **Alternativa:** revisar también las rutas citadas entre comillas invertidas (`docs/api.md`). Daría falsos
  positivos: AGENTS.md cita rutas relativas al paquete `factura-hn` y el mismo archivo viaja en
  `@factura-hn/cliente`. Se deja para una revisión a mano.

### DEC-084 · Los ejemplos se compilan solos y corren dos veces
- **Contexto:** desde un clon nuevo, `pnpm install` no compila los paquetes, y los ejemplos importan `dist/`:
  Express, Next.js y el POS fallaban al primer arranque si no se compilaba antes a mano. El README de
  Next.js pedía ese paso aparte; los de Express y el POS no lo decían.
- **Elegida:**
  - El `start` (o `dev`) de cada ejemplo compila primero lo que usa del monorepo: el cliente para Express y
    Next.js; el núcleo y `@factura-hn/sqlite` para el POS. Así el README queda en tres comandos o menos.
  - El arranque del POS pasa a `src/arranque.ts` (`prepararCaja`) para probar la segunda corrida: con la misma
    base no vuelve a registrar el CAI ficticio y la numeración sigue.
  - La prueba de Express (con Postgres) reinicia la tienda contra la misma API: el pedido ya facturado devuelve
    su factura, y uno nuevo toma el número que da la API.
- **Alternativa:** un `prestart`. Depende de que pnpm tenga activos los scripts `pre*` (`enable-pre-post-scripts`).

### DEC-085 · Prueba de humo con los tarballs, fuera del repositorio
- **Contexto:** `verificar-dist` revisa el tarball, pero lo carga desde el monorepo. Nadie probaba lo que hace un
  usuario: instalar desde npm en un proyecto vacío y copiar el ejemplo del README.
- **Elegida:**
  - `scripts/humo.mjs` (`pnpm humo`) empaqueta con `pnpm pack` y crea un proyecto vacío en el directorio temporal
    del sistema. Instala ahí los tarballs con `npm install --offline` (con red solo si falta algo en la caché, y lo
    avisa).
  - Corre, como `factura.mjs`, el bloque del README publicado que contiene «// En cada venta» (el mismo que usa
    `readme.test.ts`). Comprueba que emite.
  - Los caminos `demo` (`npx factura-hn demo/init`), `api` y `mcp` quedaron con su función, inactivos hasta la
    integración (DEC-089).
- **Alternativa:** usar `npm pack` o un registro local (verdaccio). `npm pack` no
  reemplaza `workspace:`, y verdaccio sería una dependencia nueva.

### DEC-086 · Un solo módulo demo en la API, el MCP y los ejemplos
- **Contexto:** la API (`operador.ts`), el MCP (`demo.ts`), el playground y el POS tenían cada uno su CAI ficticio,
  su emisor y, la API y el MCP, su copia de `LEYENDA_PRUEBA` y de `esCAIDemo`. Sus autorizaciones demo no llevaban
  `prueba: true` (salían de prueba solo por el CAI, DEC-063).
- **Elegida:**
  - Todos importan de `factura-hn/demo` (`autorizacionDemo`, `EMISOR_DEMO`, `LEYENDA_PRUEBA`, `esCAIDemo`): sin
    copias. Las autorizaciones demo nuevas de la API y del MCP salen con `prueba: true` y con la fecha límite en
    hora de Honduras.
  - El formato del CAI no cambia: `DEMO00-NO-VALIDO-0000-0000-0000-TT` en los cuatro, igual que los ya
    registrados. `CAI_DEMO` de la API sigue exportado (`…-00`) por compatibilidad.
  - El rango se conserva donde había uno distinto del del núcleo: 1–5000 en la API, el MCP y el POS; 1–50 en el
    playground. Así un demo creado antes y uno nuevo se ven iguales.
  - El emisor demo de la API y del MCP pasa a ser el del núcleo (cambian el nombre comercial, la dirección y el
    teléfono; el RTN y la razón social son los mismos, y `esDemoFicticio` sigue reconociendo los tenants demo ya
    creados).
  - El MCP marca de prueba con `esDocumentoDePrueba` (por `modo` o por el CAI), no solo por el CAI.
  - Las plantillas de `init` siguen distintas (DEC-067 y DEC-075): `npx factura-hn init` es una demo que emite con
    `autorizacionDemo()`, así que su emisor ficticio nunca llega a un documento real; `npx @factura-hn/mcp init`
    prepara la base real, y por eso su `emisor.json` va vacío.
- **Alternativa:** dejar las copias y comprobar con una prueba que coinciden. Sigue habiendo cuatro lugares que
  cambiar, y la marca `prueba: true` habría que añadirla en cada uno.

### DEC-087 · La API y el MCP dejan fuera los documentos de prueba de la exportación y del libro
- **Contexto:** la exportación transmitida (`/v1/exportacion`, CSV, TXT y JSONL), el libro de ventas de la API
  (JSON y CSV) y el `libro_ventas` del MCP usaban `lineaExportacion` y `filaLibroVentas`, que no filtran (DEC-064).
  Un documento de prueba entraba en el archivo para el SAR y en el libro. El tenant `demo` de la API es entero de
  prueba.
- **Elegida:**
  - La API cuenta, en la misma instantánea REPEATABLE READ del reporte, los documentos del período y los de prueba
    (una consulta SQL con la misma condición que `esDocumentoDePrueba`: `modo = 'prueba'` o CAI `DEMO00-NO-VALIDO-…`),
    y al transmitir salta los de prueba con `esDocumentoDePrueba`. El tope (`PERIODO_DEMASIADO_GRANDE`), el total
    del encabezado TXT y `documentos` en la bitácora cuentan solo los reales; la bitácora añade `pruebaExcluidos`.
  - Cada respuesta lleva la cabecera `Documentos-Prueba-Excluidos` (también con 0). El libro JSON añade
    `excluidos` y, si hay alguno, `aviso` con la leyenda: `JSON.stringify({ filas, resumen, excluidos })` de
    `libroVentas(docs)`, más el aviso. El CSV del libro no cambia de formato.
  - **Tenant demo:** se trata igual que cualquier otro. Su exportación sale vacía (TXT con total 0, CSV solo con
    el encabezado, JSONL vacío), su libro sin filas, y la cabecera y el `aviso` dicen cuántos documentos de prueba
    quedaron fuera. No hay una excepción para ver el formato con datos de prueba: para eso está `exportarTexto` del
    SDK sobre documentos reales de ejemplo.
  - El MCP usa `libroVentas(docs)` del núcleo en modo SQLite; en modo API recibe `excluidos` de la API. El texto
    de `libro_ventas` dice cuántos documentos de prueba no entraron.
  - `@factura-hn/cliente` tipa `excluidos` y `aviso` en `libroVentas`.
- **Alternativa:** un filtro `excluirPrueba` en `FiltroDocumentos`, aplicado por los adaptadores. Cambia el
  contrato del almacén para todos, y un adaptador que no lo implemente contaría de más. También: un 422 para el
  tenant demo («no tiene documentos con valor fiscal»); rompería a quien prueba el flujo completo con el demo.
- **Costo:** las páginas del período se siguen leyendo enteras; los de prueba se descartan en el proceso. En un
  tenant real son pocos (un punto de emisión no mezcla modos); en el demo, si no hay reales, no se lee ninguna
  página.

### DEC-088 · `Problema` en OpenAPI declara la guía
- **Contexto:** el núcleo añadió `solucion` y `documentacion` a `Problema` (DEC-065), y la API los envía (DEC-071),
  pero el esquema `Problema` de OpenAPI no los declaraba: solo `ProblemaConGuia`, un esquema aparte. Las
  advertencias y las alertas usaban `Problema`, así que un cliente generado no veía los campos.
- **Elegida:** `Problema` declara `solucion` y `documentacion` (opcionales). `ProblemaConGuia` deja de ser un
  esquema: en el código de la API es el mismo objeto y en `@factura-hn/cliente` queda como alias de tipo.
  `problema` en `GET /v1/sesion` se declara como `Problema | null` (antes el `nullable` de un esquema con nombre
  generaba un tipo imposible).
- **Alternativa:** dejar los dos esquemas. Dos nombres para lo mismo, y los avisos seguirían sin la guía.

### DEC-089 · README de tres caminos y humo de los cuatro en la CI
- **Contexto:** la meta de la Etapa 1 (plan v1 §2) es la primera factura en 3 pasos tras instalar, por el SDK, la
  API, el MCP y Next.js, con pruebas de humo en la CI. El README raíz (también el de `factura-hn` en npm) empezaba
  con un CAI que había que inventar y enlazaba con rutas relativas (DEC-083). Los caminos `demo`, `api` y `mcp` de
  `humo.mjs` estaban inactivos (DEC-085).
- **Elegida:**
  - El README abre con tres caminos de 3 pasos (SDK, API y MCP), todos en modo de prueba, y una sección de
    Next.js: el almacén y el facturador en un módulo del servidor, el CAI una sola vez. Dice que el impreso lleva
    «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y cómo pasar a producción. Todo enlace al repositorio es una URL
    absoluta y `ENLACES_PENDIENTES` queda vacía. Se conserva el bloque «// En cada venta» que usan `readme.test.ts`
    y `humo.mjs`.
  - En `docs/api.md` y `docs/autoalojamiento.md` la clave de idempotencia se genera en cada venta
    (`venta-$(date +%s)`; en PowerShell, un GUID) y el número sale de la respuesta.
  - `humo.mjs`: `demo` corre `npx factura-hn demo` e `init` + `node emitir.mjs` y exige la leyenda en el HTML;
    `mcp` corre `init --demo` y, con el bloque `mcpServers` tal como lo imprime, el cliente MCP del SDK emite una
    factura que vuelve con `prueba: true`; `api` arranca `packages/api/dist` contra una base nueva en el Postgres
    de `FHN_PG_URL` (se borra al terminar), crea la llave con la consola y hace los 3 pasos hasta un PDF que empieza
    con `%PDF`. La API no se publica en npm: corre desde `dist`, como en la imagen de Docker.
  - En la CI: `sdk demo mcp` en el job `verificar` (Node 22 y 24) y `api` en el job `postgres`.
  - `verificar-dist` carga `factura-hn/demo` (ESM y CJS), arranca los `bin` (`factura-hn --version`,
    `factura-hn-mcp ayuda`) y exige las exportaciones que nombra la documentación.
- **Alternativa:** para la API, el contenedor de Docker en el humo. Ya lo prueba el job `docker` (`/salud`), y
  repetirlo alarga la CI sin probar nada nuevo de los pasos.

## Lote 2: segunda revisión

Correcciones de la segunda revisión del Lote 2 (DEC-090 a DEC-096) y un pendiente para el Lote 4. El límite de
intentos de la API se corrigió en DEC-070.

### DEC-090 · La API no arranca con un esquema anterior al del código
- **Contexto:** con una base en el esquema v6 (sin `fhn_api_prefijo_registrado`) y el código en v7, cada llave no
  validada terminaba en 500. Pasa si la base la migra otro proceso (montaje propio con `crearApp`) o con otro rol.
- **Elegida:** `exigirEsquemaApi(pool, rol)` comprueba con la conexión de la API que existe la función que añadió
  la versión actual y que el rol de la aplicación puede ejecutarla. `arrancar` la llama después de migrar y, si
  falla, no arranca: el mensaje dice cómo migrar (`FHN_MIGRAR_URL` o la consola `migrar`). Se exporta para quien
  monta la app por su cuenta.
- **Alternativa:** leer `fhn_migraciones`. El rol de la API no tiene permiso sobre esa tabla, y la comprobación debe
  correr con la conexión que atiende las solicitudes.

### DEC-091 · Un punto de emisión pasa de prueba a real, nunca al revés
- **Contexto:** una base de la 0.2.0 tiene CAI de demostración `DEMO00-…` sin `prueba: true` (entonces no existía)
  junto a CAI reales en el mismo punto. Con la regla de DEC-063 («entero de prueba o entero real»), un CAI demo
  impedía registrar el CAI real siguiente: una regresión grave para quien actualiza. Y quien probó con la demo
  en su almacén no podía pasar a producción en él.
- **Elegida** (comportamiento del producto; no cambia la interpretación fiscal):
  - Registrar un CAI real en un punto que solo tiene autorizaciones de prueba se acepta, aunque estén vigentes y
    con números libres.
  - Desde que el punto tiene una autorización real, sus autorizaciones de prueba quedan retiradas para siempre:
    la emisión (`autorizacionesActivas` antes de `elegirAutorizacion`) no las vuelve a elegir, en ningún tipo de
    ese punto, y `GET /v1/sesion` tampoco las cuenta. Los documentos de prueba ya emitidos no cambian: llevan la
    leyenda y quedan fuera de los reportes.
  - Lo contrario sigue rechazado: una autorización de prueba en un punto que tiene o tuvo una real da
    `AUTORIZACION_MODO_MEZCLADO`.
  - Las autorizaciones de prueba no cuentan para duplicados ni solapes con la real, pero un número no se repite
    en una serie: si el rango real empieza en un número que ya usaron documentos de prueba de su serie, da
    `RANGO_USADO_EN_PRUEBA` (Arts. 10 num. 3-5 y 59) y la solución es registrarlo en un almacén nuevo.
  - `no-utilizados` sigue omitiéndolas (DEC-094) y `REFERENCIA_MODO_MEZCLADO` sigue impidiendo una nota real sobre
    un documento de prueba. En el tenant `demo` de la API sigue `AUTORIZACION_REAL_EN_DEMO` y en la base demo del
    MCP, `BASE_DEMO`.
- **Alternativa:** (1) comparar solo con autorizaciones en uso (vigentes y no agotadas), la primera versión de
  esta corrección: una demo vigente bloqueaba el CAI real hasta vencer, y las autorizaciones no se borran. (2)
  Continuar la numeración real después de los números de prueba: dejaría sin usar los primeros números del rango
  real, que habría que reportar al SAR.
- **Estado:** `GET /v1/autorizaciones/{cai}/estado`, `estado_cai` del MCP y `estadoAutorizacion` (con
  `puntoConReal`) muestran la demo retirada como `retirada: true`, no vigente y sin números restantes.
- **Límite conocido:** quien emitió documentos de prueba en una caja y tiene un CAI real que empieza en 1 debe
  registrarlo en una base nueva: los números de prueba de esa serie no se repiten.

### DEC-092 · Registrar una autorización bloquea todas las series del punto
- **Contexto:** `registrarAutorizacion` bloqueaba solo la serie del tipo nuevo. Dos registros simultáneos en el
  mismo punto, uno de prueba del tipo 01 y uno real del tipo 06, se validaban a la vez y entraban los dos.
- **Elegida:** bloquea las series de todos los tipos del punto antes de leer sus autorizaciones, en orden fijo:
  primero las notas (06, 07) y después los demás tipos (01, 04, 05, 08). La prueba de Postgres fallaba antes del
  cambio.
- **Orden de bloqueo:** el único otro camino que bloquea dos series es la nota de crédito: su serie 06 y luego la
  del original. Con la 01 antes que la 06, una nota y un registro simultáneos se esperaban el uno al otro y
  Postgres cortaba uno con 40P01 (la API respondía 500). Con las notas primero, ningún camino toma una 06 o 07
  después de una 01. Anular, corregir fechas y los no utilizados bloquean una sola serie. Una prueba de Postgres
  fuerza el cruce y fallaba con el orden anterior.
- **Alternativa:** un candado consultivo por punto. Haría falta en cada almacén (Postgres, SQLite, memoria); el
  bloqueo de series ya existe en el contrato del almacén.

### DEC-093 · CAI ficticio en `POST /v1/autorizaciones`
- **Contexto:** un CAI `DEMO00-…` registrado por error en un tenant real convertía su punto en «de prueba» sin
  decirlo. Y en el tenant `demo` se podía registrar un CAI real, que emitiría sin leyenda en la demostración.
- **Elegida:** en el tenant de demostración (`esDemoFicticio`) se rechaza todo CAI que no sea ficticio
  (`AUTORIZACION_REAL_EN_DEMO`). En los demás, un CAI ficticio necesita `"prueba": true` explícito
  (`AUTORIZACION_DEMO_SIN_PRUEBA`). El esquema OpenAPI declara `prueba`. Códigos y soluciones en `docs/errores.md`.
- **Alternativa:** prohibir los CAI ficticios fuera del tenant `demo`. Impide probar en un tenant propio, que la
  guía recomienda antes de producción.

### DEC-094 · No utilizados sin las autorizaciones de prueba
- **Contexto:** `documentosNoUtilizados` y `GET /v1/series/{id}/no-utilizados` listaban los rangos de un CAI
  ficticio vencido como «por reportar al SAR» (Art. 42). Un CAI ficticio no es una autorización del SAR.
- **Elegida:** el núcleo omite las autorizaciones de prueba (`prueba: true` o CAI ficticio): no hay nada que
  reportar. La API devuelve los rangos reales y, si la serie tiene autorizaciones de prueba, un `aviso` que lo
  dice.
- **Alternativa:** devolverlas marcadas con `prueba: true`. Quien sumara los rangos para el aviso al SAR tendría
  que filtrarlas; sin ellas, la lista es exactamente lo que hay que reportar.

### DEC-095 · `crearFacturadorDemo` sin correlativos libres
- **Contexto:** la renovación de la demo calcula el rango siguiente con tope en 99 999 999. Si el anterior ya
  llegaba al tope, el rango salía invertido y el error era `RANGO`, que no explica nada.
- **Elegida:** error `DEMO_SIN_NUMEROS` antes de registrar, con la solución (otro almacén u otro punto).
- **Alternativa:** reiniciar la numeración de la demo. Repetiría números en el mismo almacén.

### DEC-096 · Prueba de 5 minutos: Next.js sin base, versión fija del MCP
- **Contexto:** en la prueba de 5 minutos, Node, la API y el MCP pasaron; Next.js necesitó un cuarto paso (base de
  datos, emisor oculto en un comentario, CAI real). El mensaje de `init` pedía instalar como primer paso, la API
  no decía desde dónde correr ni qué hacer si el paso 2 fallaba, y el bloque del MCP arrancaba siempre la última
  versión publicada.
- **Elegida:**
  - Next.js empieza en modo de prueba: `lib/facturador.ts` exporta `crearFacturadorDemo()` (una promesa, con
    `await`) y `app/factura/route.ts` devuelve el HTML; se abre `/factura`. Postgres, el emisor (visible) y el CAI
    real pasan a «Pasar a producción». `readme.test.ts` resuelve `@/lib/facturador` al bloque de ese archivo.
  - SDK: qué se ve tras cada comando, la cuenta de `preciosIncluyenISV` (subtotal 200, total 230), la nota ESM
    junto al bloque y cuándo usar `demo` o `init`. `init` deja la instalación como nota final.
  - API: `git clone` y `cd` antes de Compose, la variable `API` para cambiar de puerto (`FHN_PUERTO`), el aviso de
    stderr de `demo llave` y un paso 2 que muestra el número emitido o el error.
  - MCP: el bloque fija `@factura-hn/mcp@<versión>` y avisa que `npx` necesita red la primera vez. El README dice
    cómo ver el impreso (`consultar_documento` en texto; sin PDF ni HTML) y la variante de Windows.
- **Alternativa:** un ejemplo de Next.js con el SDK en `examples/`. El de `examples/nextjs` usa la API y lo prueba
  la CI; uno nuevo duplicaría el mantenimiento por dos archivos que ya compilan en `readme.test.ts`.

### DEC-097 · Sitio con Astro Starlight en `web/`; reemplaza a DEC-043
- **Contexto:** DEC-049 aprobó Starlight para la Etapa 2 y anunció que reemplazaría a DEC-043 (generador propio
  `scripts/sitio.mjs` con `marked`) al implementarse. El generador propio no tenía buscador, modo oscuro ni menú
  lateral, y la matriz de cumplimiento se publicaba copiada de `docs/investigacion.md` sin comprobar sus pruebas.
- **Elegida:**
  - **Paquete privado `@factura-hn/sitio` en `web/`**, con versiones exactas: `astro` 7.4.13, `@astrojs/starlight`
    0.43.1, `@astrojs/markdown-remark` 7.3.10 (el procesador `unified()`, para usar un plugin de rehype propio),
    `@fontsource/ibm-plex-sans` y `@fontsource/ibm-plex-mono` 5.3.0, `github-slugger` 2.0.0 (los mismos ids de
    encabezado que Astro, para los índices generados) y `pagefind` 1.6.0 (la versión que ya usa Starlight). Son
    dependencias de desarrollo de un paquete privado: no tocan el «sin dependencias» del SDK ni `pnpm test`.
  - Interfaz y buscador en español (`defaultLocale: 'root'`, `lang: 'es'`); Pagefind indexa en español porque lee
    el `lang` del HTML. Modo oscuro, claro o automático, el de Starlight.
  - `site` y `base` por variable (`FHN_SITIO_URL`, `FHN_SITIO_BASE`; por defecto
    `https://augustomelara-dev.github.io` y `/factura-hn`). En Pages, `pages.yml` los toma de `configure-pages`, así
    que un dominio propio no exige tocar el código. Un plugin de rehype (`web/src/plugins/rehype-base.mjs`) añade la
    base a los enlaces absolutos internos del contenido (`/conceptos/cai/`), también en el HTML escrito a mano.
  - **Salida en `sitio/`** de la raíz, la carpeta que ya sube `pages.yml`; `.gitignore` no cambia.
  - **Páginas generadas al construir, sin versionarlas** (`web/scripts/generar.mjs`): `docs/guia-sdk.md`,
    `docs/api.md`, `docs/errores.md`, `docs/normativa.md`, `docs/decisiones.md`, `docs/consulta-sar.md`,
    `docs/autoalojamiento.md` y `CHANGELOG.md`. El H1 pasa al frontmatter y los enlaces relativos entre documentos
    se reescriben a su URL del sitio o al archivo en GitHub (la lógica de `resolverEnlace()` del generador viejo).
    Los archivos generados están en `web/.gitignore`; si alguien escribe a mano uno de ellos, la generación falla.
  - **Referencia de la API** desde `openapi.json`, con el código propio portado a Markdown en español:
    autenticación, errores, idempotencia y paginación primero; después las rutas por etiqueta y los esquemas. Queda
    en `/referencia/openapi/` (la guía de `docs/api.md` sigue en `/referencia/api/`), y Pagefind la indexa.
  - **Recursos para IA:** cada página tiene su `.md` (`/referencia/sdk/` → `/referencia/sdk.md`), y el sitio publica
    `llms.txt` (el de la raíz, que prueba `readme.test.ts`, con los enlaces llevados al sitio y la lista de páginas)
    y `llms-full.txt`.
  - **Verificación sobre el HTML final** (`web/scripts/verificar.mjs`), heredera de la del generador viejo:
    enlaces internos con la base y sus anclas, archivos citados en GitHub, `.md` sin reescribir, una versión `.md`
    por página, la portada contra los comandos del README y el buscador con la API de Pagefind sobre el índice
    generado («CAI», «nota de crédito», «rango»).
  - Se retiran `scripts/sitio.mjs`, `sitio-fuente/` y `marked`.
- **Alternativa:** seguir con el generador propio y añadir a mano Pagefind, un selector de tema y un menú lateral.
  Menos dependencias, pero mantener una interfaz propia en español y accesible es más trabajo que fijar versiones
  de Starlight y leer su changelog. Riesgo aceptado: Starlight es 0.x y rompe en versiones menores; las versiones
  van fijas.

### DEC-098 · Matriz de cumplimiento generada desde las pruebas, y la CI falla si una regla pierde la suya
- **Contexto:** la Fase 1 dejó en `docs/investigacion.md` §1 una columna «Prueba» por fila, pero era texto libre:
  nada comprobaba que el archivo o el título citado existieran. Al generarla aparecieron dos citas que ya no
  coincidían con su prueba (fila 10.7: «continúa la numeración … (B-04)»; fila 42: «revisión independiente: …»,
  cuya prueba se llama «B-07 · revisión interna: …»). Se corrigieron en `investigacion.md`; las pruebas no
  cambiaron.
- **Elegida:** la fuente sigue siendo la tabla de `investigacion.md` (una sola fuente, editable a mano). Formato de la
  columna «Prueba», ya usado en todas las filas: el archivo entre comillas invertidas (`matriz.test.ts`, o con
  carpeta: `sqlite/test/contrato.test.ts`), o `contrato \`factura-hn/pruebas\`` para la batería
  `ejecutarContratoAlmacen`; detrás, cero o más títulos entre comillas latinas, donde «…» vale por cualquier texto.
  `web/scripts/lib/matriz.mjs` busca cada título en una línea de `it(`, `test(` o `describe(` (o en una tabla de
  casos) y genera `/referencia/cumplimiento/`: artículo y fuente → requisito → estado (badge con texto, sin
  emojis) → prueba, con enlace a su línea en GitHub. `pnpm sitio` (y por tanto la CI) falla si una fila
  ✅ o 🟡 no cita prueba, si cita un archivo que no existe o sin pruebas, o un título que no aparece. Las filas
  ❌, 📄 y ➖ pueden no tener prueba. Lo prueba `web/scripts/matriz.test.mjs`.
- **Alternativa:** etiquetar cada prueba con su fila (p. ej. `it('[Art. 10.7] …')`) y generar la tabla desde el
  código. Daría una sola fuente en las pruebas, pero obliga a renombrar decenas de pruebas y pierde las columnas de
  texto (requisito, cómo se cumple) que hoy se redactan en la matriz.

### DEC-099 · Dirección visual: IBM Plex local y paleta con contraste AA comprobado
- **Contexto:** `docs/analisis/sitio-web.md` §5 y `docs/plan-v1.md` §4 fijan una referencia técnica sobria, IBM Plex
  sin Google Fonts y las paletas clara (`#FAFAF9`, `#1A1A18`, acento `#0B5D8F`) y oscura (`#111110`, `#ECEBE7`,
  acento `#7CC0EC`).
- **Elegida:**
  - IBM Plex Sans (400, 400 cursiva, 500, 600) y Mono (400, 500, 600) con Fontsource, solo `latin` y `latin-ext`,
    servidas desde el propio sitio con `font-display: swap`.
  - Las paletas se asignan a las variables de Starlight en `web/src/styles/tema.css`. El cuerpo usa el color de
    texto de la paleta (no el gris de Starlight). En oscuro, el botón primario lleva texto oscuro: blanco sobre
    `#7CC0EC` da 1,98.
  - `web/scripts/contraste.test.mjs` lee `tema.css` y calcula el contraste (luminancia relativa de WCAG 2.x) de
    cada par que se usa; falla por debajo de 4,5 (texto) o 3 (bordes de componentes, WCAG 1.4.11). Resultado:
    - Oscuro: cuerpo 15,84; texto suave 7,24 (6,61 sobre superficie); enlaces 9,54 (8,71 sobre superficie, 6,96
      sobre código en línea); botón primario 9,54; página actual del menú 9,54; avisos: título 7,00 a 9,96, texto
      12,50 a 13,35; badges de estado y de método 7,00 a 9,02; borde de campos 3,55.
    - Claro: cuerpo 16,69; texto suave 6,71 (6,21 sobre superficie); enlaces 6,75 (6,25 sobre superficie y código
      en línea); botón primario 6,75; avisos: título 5,58 a 7,98, texto 14,76 a 15,44; badges 5,58 a 8,77; borde
      de campos 3,63; borde del aviso naranja 3,93.
    - El resaltado de código usa `github-dark` y `github-light` de Expressive Code, con su ajuste de contraste mínimo
      por defecto (5,5 sobre el fondo del tema) y el fondo cambiado a la superficie del sitio. Medido sobre el HTML
      construido, el token de menor contraste da 6,49 en oscuro (sobre `#1B1B19`) y 4,88 en claro (sobre
      `#F2F1EE`). Esta medida no está en la prueba automática: se repite a mano si cambian los temas de código.
  - Portada con plantilla splash y un Hero propio (`Portada.astro`) para que los botones lleven la base. El estado
    del proyecto se lee del repositorio al construir: versión de `packages/core/package.json`, la línea «Estado:»
    de `docs/consulta-sar.md` y el número de DEC [REVISAR]. Si cambia el formato de esas fuentes, la construcción
    falla en vez de publicar un dato viejo.
- **Alternativa:** Geist y Geist Mono (OFL), la alternativa de `sitio-web.md`; o los colores por defecto de Starlight
  (su gris de texto en claro, `hsl(224 10% 23%)`, también pasa AA, pero se aleja de la paleta acordada).

### DEC-100 · Contenido del sitio: rutas, convenciones y comprobación del código
- **Contexto:** cuatro ramas escribieron en paralelo las páginas de `web/src/content/docs/` (Empezar y Conceptos;
  Documentos y Guías; Producción y Negocios; IA, Ayuda y glosario), cada una revisada por un agente que no la
  escribió, contra `docs/normativa.md`, la matriz de `docs/investigacion.md`, las DEC y el código.
- **Elegida:**
  - **Rutas:** las cortas del encargo (`/conceptos/inmutables/`, `/conceptos/almacen/`, `/documentos/factura/`,
    `/documentos/nota-credito/`, `/empezar/primera-factura/`…), no las del mapa de `documentacion.md` §4. La
    contingencia (Art. 55) es una sección de `/produccion/tramites/`; los tipos 05, 08 y 11 van en
    `/documentos/no-emitibles/`; no hay páginas de «clientes especiales» ni «almacén propio» (los enlaces van a
    `/conceptos/isv-y-montos/#exonerado` y a la referencia del SDK).
  - **Fuentes en la página:** cada afirmación fiscal cita su artículo; lo que el repositorio no respalda va en un
    aviso «Por confirmar con fuente» con su pregunta P-xx y enlace a la consulta al SAR; las DEC [REVISAR] se
    presentan como interpretación pendiente. Los identificadores F-xx de `documentacion.md` no se publican.
  - **Anclas:** los errores se enlazan como `/referencia/errores/#codigo` en minúsculas (lo mismo que
    `enlaceError` del núcleo); la consulta al SAR, sin ancla, con la P-xx nombrada en el texto.
  - **Código:** los bloques `ts` de las páginas versionadas compilan en `readme.test.ts` (con
    `<!-- declaraciones: -->` para las variables del integrador), igual que el README; los de `js` de Empezar y
    Conceptos se comprobaron corriéndolos. `ia/prompts.md` entra en `DOCS_AGENTES`: sus prompts deben ser
    idénticos a los del README y sus nombres deben existir.
  - **Datos de ejemplo:** emisores «<Tipo> Demostración», CAI `DEMO00-…` en las guías de negocio y el
    `A1B2C3-…` permitido por CONTRIBUTING en el registro del CAI real.
  - Las revisiones confirmaron que la Nota de Débito es el Art. 4 num. 31 y la de Crédito el num. 32 (DEC-016,
    DEC-051); se corrigió `documentacion.md`, que los tenía invertidos.
- **Alternativa:** generar todo desde los Markdown de `docs/`. Mantiene una sola fuente, pero esos documentos son
  referencias largas, no guías por tarea, rol o negocio.

### DEC-101 · La guía de profesional independiente se publica con un aviso de peligro · [REVISAR]
- **Contexto:** `documentacion.md` §7 dice que la guía de profesional no se publique hasta confirmar si un
  profesional puede usar la Factura (01) en lugar del Recibo por Honorarios (04), que solo se emite por imprenta
  (Art. 46). El encargo del sitio la pide.
- **Elegida:** se publica con el aviso fijo de las guías de negocio y, además, un `:::danger` al inicio: casi todo
  está por confirmar y no se configura para honorarios sin la confirmación del contador. El responsable decide si
  sale en la primera publicación del sitio; quitarla es borrar `web/src/content/docs/negocios/profesional.md`.
- **Alternativa:** no escribirla hasta tener la respuesta. Deja sin guía a un caso frecuente.

### DEC-102 · CAI solicitado para otro sistema o para talonarios · [REVISAR]
- **Contexto:** la pregunta frecuente «¿Puedo usar mi CAI?». El Art. 61 otorga la autorización por cada sistema y
  tipo de documento; el repositorio no dice si un CAI solicitado para otro sistema o para talonarios de imprenta
  sigue sirviendo al cambiar a factura-hn. `registrarAutorizacion` lo acepta, con `ultimoEmitidoAntes` (DEC-008).
- **Elegida:** las páginas lo marcan «Por confirmar con fuente» y piden confirmarlo con el contador antes de
  registrarlo. Se agrega como P-15 a `docs/consulta-sar.md` y a `docs/investigacion.md` §4.
- **Alternativa:** no mencionarlo, lo que deja abierta la lectura «cualquier CAI sirve» sin fuente.

### DEC-103 · Instalación de la skill en Claude Code · [REVISAR]
- **Contexto:** el repositorio decía dónde está la skill (`skills/facturacion-sar-hn/SKILL.md`, dentro del paquete
  `factura-hn`), pero no cómo instalarla.
- **Elegida:** `/ia/skill/` documenta la copia de `node_modules/factura-hn/skills/facturacion-sar-hn` a
  `.claude/skills/` (proyecto) o `~/.claude/skills/` (personal), con los comandos de bash y PowerShell; para otros
  clientes remite a su documentación. No es una regla fiscal: falta que el responsable lo pruebe una vez.
- **Alternativa:** solo enlazar el archivo.

### Resuelto en el Lote 4
- El libro de ventas con llave de caja: DEC-122.
- `AVISO_VIGENCIA_MAYOR_1_ANIO` al registrar: DEC-124 y la integración.

## Lote 4: API para integradores (Etapa 3)

<!-- El contrato de la API (rama lote4/contrato) -->

### DEC-104 · `operationId`: verbo + recurso, en español, fijados por una prueba
- **Contexto:** `api-rest.md` §3.1 y §6 (P0), plan-v1 3.1. La especificación no tenía ningún `operationId`, así
  que los generadores de otros lenguajes inventaban los nombres a partir de la ruta.
- **Elegida:** las 24 operaciones llevan un id en camelCase, con verbo + recurso: `obtenerSalud`, `crearEmisor`,
  `listarEmisores`, `obtenerEmisor`, `actualizarEmisor`, `registrarAutorizacion`, `listarAutorizaciones`,
  `obtenerEstadoAutorizacion`, `obtenerSesion`, `emitirDocumento`, `listarDocumentos`, `obtenerDocumento`,
  `anularDocumento`, `corregirFechaSerie`, `listarNoUtilizados`, `obtenerLibroVentas`, `exportarPeriodo`,
  `listarBitacora`, `crearLlave`, `listarLlaves`, `revocarLlave`, `crearWebhook`, `listarWebhooks`,
  `desactivarWebhook`. El verbo es el de la acción real (`revocar` y `desactivar`, no `eliminar`: no se borra
  nada; `registrar` para el CAI, que lo otorga el SAR).
- `packages/api/test/contrato.test.ts` falla si una operación no tiene id, si se repite, si no es camelCase o si
  no empieza por un verbo de la lista (`VERBOS`). Una segunda prueba fija los 24 ids actuales: cambiarlos rompe
  los clientes generados.
- **Para el integrador:** las ramas `webhooks` y `llaves` que agreguen rutas deben ponerles `operationId`
  (`listarEntregasWebhook`, `reenviarEntregaWebhook`…); si usan otro verbo, se agrega a `VERBOS`.

### DEC-105 · Cada operación declara solo los estados de error que su código devuelve
- **Contexto:** `api-rest.md` §3.1: todas las rutas compartían `respuestasError` (400, 401, 403, 422, 429), así
  que el 422 aparecía en los `GET`, y el 413 y el 500 no estaban.
- **Elegida:** un catálogo (`CATALOGO_ERRORES`: 400, 401, 403, 413, 422, 429, 500) y `respuestasDe(...)`, que
  elige por ruta. Criterios, comprobados leyendo cada manejador:
  - 401, 429 y 500 en toda operación de `/v1` (autenticación, límite de la llave, `onError`). `/salud` solo 500.
  - 400 solo si la operación tiene parámetros, consulta o cuerpo que validar.
  - 403 solo donde hay `exigirAdmin` o las comprobaciones de caja de la emisión.
  - 413 en toda operación que no es `GET`. El `bodyLimit` cubre todo `/v1/*` y cualquier método: un `DELETE` o un
    `POST` sin cuerpo esperado (`revocarLlave`, `desactivarWebhook`, y en la rama `webhooks` `probarWebhook` o
    `reenviarEntregaWebhook`) también da 413 si le mandan más de 512 KB. Solo un `GET` no lo da: no tiene cuerpo.
    La prueba exige «413 si y solo si el método no es GET».
  - 422 en las que validan reglas fiscales (emisor, autorizaciones, emitir, anular, corregir fecha, URL del
    webhook) y en los reportes con tope de documentos (`libro-ventas`, `exportacion`: `PERIODO_DEMASIADO_GRANDE`).
    Ningún otro `GET`.
- `respuestasError` sigue existiendo (= 400, 401, 403, 413, 422, 429, 500, para operaciones con cuerpo y reglas
  fiscales) para que las ramas paralelas que lo usan sigan compilando. La prueba de contrato fallará si una de
  ellas declara 422 en un `GET`, le falta 401, 429 o 500, o le falta 413 sin ser `GET`: el integrador ajusta esas
  rutas con `respuestasDe`.

### DEC-106 · `Solicitud-Id` en todas las respuestas y en `error.solicitud`
- **Contexto:** `api-rest.md` §3.2 (P0): el 500 decía «se registró para revisión» sin nada que citar.
- **Elegida:**
  - Primer middleware de la app: si el cliente manda `Solicitud-Id` con la forma
    `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, se respeta; si no, `randomUUID()`. La forma corta evita inyectar
    saltos de línea o texto arbitrario en el log y en las cabeceras.
  - La cabecera va en **todas** las respuestas (también `/docs`, `/openapi.json` y 404 de ruta).
  - En el cuerpo, `error.solicitud` (dentro de `error`, junto a `documentacion`, como el `request_log_url` de
    Stripe), en todos los errores JSON: forma (400), `ErrorApi`, `ErrorValidacion`, 404 de ruta y 500. Se envía
    siempre, pero en el esquema `Error` es **opcional** (la descripción dice que está presente desde la 0.2.0): un
    cliente generado, p. ej. en Python, fallaría con `KeyError` ante el error de un proxy o de un servidor anterior.
  - El log no confía en el id del cliente, que no tiene por qué ser único: cada solicitud tiene además un id del
    servidor. El 500 se registra como `Error interno (solicitud <uuid>)` o, si el cliente mandó el suyo,
    `Error interno (solicitud <uuid> (cliente <id>))`. El cuerpo y la cabecera repiten el del cliente, para que él
    correlacione.
  - Solo se lee `Solicitud-Id`, no `Request-Id` ni `X-Request-Id`: un nombre por concepto y sin prefijo `X-`
    (RFC 6648).
- **Alternativa descartada:** declarar `Solicitud-Id` como parámetro de entrada en cada operación del OpenAPI.
  Cambiaría la firma de las 24 operaciones en los clientes generados (TS incluido) para algo opcional; queda
  documentado en la descripción de la cabecera de respuesta y en `docs/api.md`. **Propuesta**, si un integrador
  lo pide: un parámetro `components.parameters.SolicitudId` referenciado en cada operación.

### DEC-107 · `FacturaHN-Version` en todas las respuestas
- Cabecera con `VERSION_API` (la de `/salud` e `info.version`). Es el primer paso de §3.5; el aviso de versión en
  el cliente y `Deprecation`/`Sunset` no entran en este lote (el cliente no debía cambiar de comportamiento).

### DEC-108 · Cabeceras `RateLimit-Policy` y `RateLimit` de la cubeta de cada llave
- **Contexto:** `api-rest.md` §3.8 (P2), borrador IETF draft-ietf-httpapi-ratelimit-headers.
- **Elegida:** `RateLimit-Policy: "llave";q=<rafaga>;w=<ceil(rafaga / porSegundo)>` y
  `RateLimit: "llave";r=<fichas enteras que quedan>;t=<segundos hasta llenar la cubeta>`. Con los valores por
  defecto (20/s, ráfaga 40): `q=40;w=2`.
- **Por qué `w=2` y no `w=1`** como proponía el análisis: `q=40;w=1` diría 40 por segundo sostenidas, y la cubeta
  da 20 por segundo con ráfaga de 40. Como cuota por ventana, lo exacto es «40 que se recuperan enteras en 2 s».
- Solo con el secreto correcto: en las respuestas autenticadas y en el 429 `DEMASIADAS_SOLICITUDES`. No en un
  413 (el límite del cuerpo corre antes de la autenticación) ni en un 401 (tampoco el de una llave ya validada y luego revocada: el 401 debe ser idéntico al de un prefijo
  inexistente) ni en el 429 `DEMASIADOS_INTENTOS`, que es otra cubeta (por dirección o prefijo) y no se publica.
- Se agrega `LimitadorSolicitudes.estado(clave)` (lee sin gastar) y `porSegundo`/`rafaga` pasan a ser públicos
  de solo lectura.
- `FacturaHN-Limite: rafaga|mensual`, que sugería el análisis, no se agregó: el `error.codigo` del 429 ya lo dice.

### DEC-109 · `Retry-After` en `LIMITE_MENSUAL`
- El 429 `LIMITE_MENSUAL` trae `Retry-After` con los segundos hasta el día 1 del mes siguiente al de la emisión,
  a las 00:00 de Honduras, calculado como las 06:00 UTC (Honduras está en UTC-6 todo el año, sin horario de
  verano desde 2006; `segundosHastaElMesSiguiente`, con prueba). Mínimo 1 s. Sigue siendo 429 (pasarlo a 403 es
  incompatible, §5).

### DEC-110 · Un cuerpo que no es JSON es 400 `JSON_INVALIDO` con la forma de error de la API
- **Contexto:** el validador de Hono lanza `HTTPException(400)` con texto plano («Malformed JSON…»), aunque el
  OpenAPI dice que el 400 es `application/json` con el esquema `Error`.
- **Elegida:** `onError` convierte ese 400 en `{ error: { codigo: 'JSON_INVALIDO', mensaje, solicitud } }`. Mismo
  estado; el cuerpo pasa de texto a JSON, que es lo que ya prometía la especificación. Nuevo código en
  `docs/errores.md`. Solo se convierte el caso del JSON mal formado (el mensaje exacto del validador de Hono,
  `MENSAJE_JSON_MAL_FORMADO`); cualquier otro `HTTPException`, también de 400, sigue con su respuesta.

### DEC-111 · Las cabeceras comunes se agregan a la especificación en un solo lugar
- `/openapi.json` ya no usa `app.doc31`: sirve `app.getOpenAPI31Document(...)` pasado por `conCabecerasComunes`
  (`packages/api/src/contrato.ts`), que agrega `components.headers` (`Solicitud-Id`, `FacturaHN-Version`,
  `RateLimit-Policy`, `RateLimit`, `Retry-After`) y los referencia en cada respuesta: las dos primeras en todas,
  `RateLimit*` en las de `/v1` salvo 401 y 413 (se responden antes de validar la llave; en el 429 son opcionales,
  porque el de `DEMASIADOS_INTENTOS` no las trae), `Retry-After` en los 429. Una prueba exige que ningún 401 las
  declare. Así una ruta nueva las hereda sin tocarla. Una prueba
  comprueba que estén en todas las respuestas.
- `info.license` (MIT) y `security: []` explícito en `/salud`, que pedían las reglas del linter y son ciertos.

### DEC-112 · Linter de OpenAPI: Redocly CLI
- **Elegida:** `@redocly/cli` 2.82.0 (fijada) como dependencia de desarrollo de la raíz. Viene empaquetada, sin
  dependencias transitivas (el lockfile agrega un solo paquete), frente a Spectral, que trae decenas.
  `pnpm lint:openapi` = `redocly lint packages/api/openapi.json`; paso «Linter de OpenAPI» en `ci.yml`, después de
  comprobar que `openapi.json` está al día.
- `redocly.yaml`: reglas `recommended`, `telemetry: off` (no se envía nada desde la CI ni desde los equipos), y
  `operation-operationId`, `-unique` y `-url-safe` como error. Desactivada `no-empty-servers`: la API no tiene URL
  fija (cada negocio la levanta en su máquina o servidor) y un `servers` fijo haría que «Try it out» de `/docs`
  llame a otra máquina.
- `.redocly.lint-ignore.yaml`: una excepción, `operation-4xx-response` en `GET /salud`, que es público y solo
  responde 200 o 500. Resultado: 0 errores y 0 avisos.

### DEC-113 · `@hono/swagger-ui` fuera de las dependencias
- No se importaba en ningún lado: `/docs` sirve una Swagger UI fija desde el CDN con SRI (DEC-052). Quitada de
  `packages/api/package.json` y del lockfile. `docs/avance.md` (línea que dice que «quedó sin usarse») queda para
  el integrador: esta rama no toca `avance.md`.

<!-- Webhooks (rama lote4/webhooks) -->

### DEC-114 · Reintentos de webhooks durante unos 3 días, con fluctuación
- **Contexto:** `api-rest.md` §3.9 y §6 (P0). El análisis citaba 8 intentos (unos 64 min); el código de `main` ya
  tenía 12 (unas 14 h y media) y `docs/api.md` lo decía bien. Aun así, un receptor caído un fin de semana perdía
  avisos fiscales. Stripe reintenta hasta 3 días.
- **Elegida:** `MAX_INTENTOS = 22`. Espera base después del intento n: `min(30 s × 2ⁿ⁻¹, 6 h)` (se conserva el tope
  de 6 h), multiplicada por un factor al azar entre 0,8 y 1,2 (±20 %). Suma de las 21 esperas: 74,5 h de media
  (de 59,6 a 89,4 h en los extremos imposibles de que todas caigan en el mismo borde). Al agotarse, `FALLIDA`.
- **Por qué ±20 % y no «full jitter» (0 a 100 %):** el calendario sigue siendo predecible y documentable («unos
  3 días»), y aun así reparte en el tiempo los reintentos de muchas entregas que fallaron juntas.
- **Inyectable:** `despacharWebhooks({ reintentos: { maxIntentos, espera } })`. Las pruebas usan 3 intentos y
  espera 0. `esperaReintento(n, azar)` recibe el azar; `esperaBase(n)` da la base.
- **Compatibilidad:** compatible según `api-rest.md` §5 (pueden llegar avisos más tarde; el receptor ya debe
  deduplicar). Las entregas que ya estaban PENDIENTE al actualizar siguen hasta 22 intentos; las que ya quedaron
  FALLIDA con 12 se pueden reenviar.

### DEC-115 · Verificadores con varias firmas `v1`
- **Contexto:** `api-rest.md` §3.9 y §5: el verificador armaba un `Map` de la cabecera y con dos `v1` se quedaba
  con el último. Había que corregirlo **antes** de la rotación.
- **Elegida:** la cabecera se recorre entera: se juntan todos los `v1` bien formados (64 hex), se ignoran las
  entradas de otros esquemas y los `v1` mal formados, y basta con que uno verifique. Más de un `t` es ambiguo y se
  rechaza; sin ningún `v1` bien formado, también. Se comparan todos (sin cortar en el primer acierto). Igual en
  `@factura-hn/api` (`leerFirma` + `verificarFirmaWebhook`, Node) y en `@factura-hn/cliente` (Web Crypto). Los
  ejemplos Express y Next.js ya usaban el del cliente: sus pruebas suman casos con dos firmas, una válida y otra no.
- **Cambio menor:** el verificador de la API ahora rechaza un secreto vacío, como ya hacía el del cliente.
- **Tope de 8 `v1`** por cabecera en los dos verificadores (la API manda a lo sumo dos). El del cliente calcula un
  solo HMAC y compara cada `v1` en tiempo constante (antes, un HMAC completo por cada `v1`).

### DEC-116 · Rutas de entregas, reenvío y evento de prueba
- **Contexto:** `api-rest.md` §3.9 y §6 (P1): `api_entregas` guardaba estado e intentos, pero ninguna ruta lo
  exponía.
- **Elegida** (todas admin, RLS por tenant, `operationId` en español):
  - `GET /v1/webhooks/{id}/entregas` (`listarEntregasWebhook`): de la más reciente a la más antigua, paginada como
    DEC-047. El cursor es `[creada en µs, uuid de la entrega]`: no expone el bigserial interno (esquema v5). Filtro
    opcional `estado`. **No** devuelve el cuerpo del aviso (puede ser un documento entero por fila; para el
    contenido está `GET /v1/documentos/{numero}`). Índice nuevo `(webhook_id, creada DESC, entrega DESC)`.
  - `POST /v1/webhooks/{id}/entregas/{entrega}/reenviar` (`reenviarEntregaWebhook`), 202: el reenvío **no** hace
    el HTTP dentro de la solicitud; devuelve la entrega a la bandeja de salida (`PENDIENTE`, `proximo = now()`) y
    el despachador la entrega en segundos, con la misma protección SSRF y el mismo tiempo máximo. Una FALLIDA o
    ENTREGADA reinicia `intentos` a 0 (otros 3 días); una PENDIENTE solo se adelanta y conserva sus intentos (si
    estaba en vuelo, el resultado de ese vuelo se descarta por el arrendamiento y puede llegar dos veces, con el
    mismo id). El último código y error se conservan hasta el próximo intento.
  - `POST /v1/webhooks/{id}/probar` (`probarWebhook`), 202: encola `webhook.prueba` solo para ese webhook, sin
    suscripción. `webhook.prueba` **no** se agrega a `EVENTOS_WEBHOOK` (no se puede suscribir). Su clave es
    `webhook.prueba:<uuid>`; la retención la borra como a `documento.*`.
  - Pruebas acotadas (revisión independiente): `webhook.prueba` se intenta a lo sumo `MAX_INTENTOS_PRUEBA = 3`
    veces (inyectable con `reintentos.maxIntentosPrueba`) y cada webhook tiene a lo sumo
    `MAX_PRUEBAS_PENDIENTES = 5` pruebas PENDIENTE; más allá, 409 `LIMITE_PRUEBAS`, también al reenviar una prueba
    terminada. El conteo corre con la fila del webhook bloqueada, así que dos pruebas simultáneas no lo pasan.
  - Candados: las rutas que escriben bloquean el webhook y la entrega con `FOR NO KEY UPDATE` (no estorba a las
    llaves foráneas de `api_entregas`); la lista no bloquea nada.
  - Cursores: se validan antes de la base (microsegundos de 0 a 9999-12-31, UUID estricto en minúsculas). Un cursor
    fuera de rango daba 500; ahora 400 `CURSOR_INVALIDO`. Lo mismo para el cursor de `GET /v1/bitacora` (19 dígitos
    que desbordaban bigint).
  - Errores nuevos: 409 `WEBHOOK_INACTIVO` (reenviar, probar o rotar un webhook desactivado; listar sí se puede)
    y 409 `ENTREGA_VENCIDA` (reenviar una lápida de `autorizacion.*` con el cuerpo vacío, ENTREGADA o FALLIDA; una
    de `documento.*` o `webhook.prueba` tan vieja ya se borró y da 404). 404 `NO_ENCONTRADO` para
    webhook o entrega de otro tenant o inexistente.
  - Bitácora de la API: `webhook.entrega_reenviada`, `webhook.prueba`, `webhook.secreto_rotado` (sin secretos).

### DEC-117 · Rotación del secreto de webhooks con gracia
- **Contexto:** `api-rest.md` §3.9 y §6 (P2), después de los verificadores.
- **Elegida:** `POST /v1/webhooks/{id}/rotar-secreto` (`rotarSecretoWebhook`), cuerpo opcional
  `{ graciaHoras }` de 0 a 168 (24 por defecto). Responde `{ webhook, secreto }`; el secreto nuevo se muestra solo
  esa vez. Esquema v8: `api_webhooks.secreto_anterior` (cifrado igual que `secreto`: se mueve tal cual, sin
  descifrar) y `anterior_hasta`. El rol de la aplicación recibe `UPDATE (secreto, secreto_anterior,
  anterior_hasta)`. Durante la gracia, el despachador firma con los dos. Con `graciaHoras: 0` no hay gracia.
  Rotar otra vez durante una gracia (un reintento, un doble clic) **conserva el secreto más viejo** (el que el
  receptor puede seguir usando), descarta el intermedio y deja la gracia hasta la más tardía de las dos
  (`greatest`); con `graciaHoras: 0` la gracia termina en el acto. Revisión independiente: la versión anterior
  copiaba siempre el secreto actual, y una rotación repetida dejaba sin firma válida al receptor con el primero. `Webhook.graciaHasta` (campo
  nuevo, aditivo) dice hasta cuándo. El mantenimiento de cada hora borra el secreto anterior vencido (dentro del
  bucle por tenant de `fhn_api_mantenimiento`, porque `api_webhooks` fuerza RLS también al dueño).
- **Orden de las firmas: primero el `v1` del secreto anterior y después el del nuevo.** Un receptor con el
  verificador viejo (el que se queda con el último `v1`) que cambia su secreto al nuevo durante la gracia sigue
  verificando. Con el orden contrario, ese receptor fallaría desde que cambia el secreto hasta que termina la
  gracia, que es justo lo que la gracia debe evitar. El que no cambia el secreto ni el verificador falla al rotar
  en los dos órdenes: por eso la guía pide actualizar el verificador primero (§5: la rotación es incompatible con
  el verificador viejo).
- **Marca de la v8:** `exigirEsquemaApi` además exige que el rol de la API pueda actualizar
  `api_webhooks.anterior_hasta` (se busca en `pg_attribute` antes de preguntar el privilegio, que fallaría si la
  columna no existe). El integrador debe renumerar si otra rama sube también la v8.

#### Propuestas que quedaron fuera (webhooks)
- `evento_id` estable entre webhooks, `version` y `modo` en el sobre, `PATCH /v1/webhooks/{id}` y el evento del
  plazo del Art. 42 (P3 de `api-rest.md` §6): no son parte de este encargo.
- Métodos del cliente TS para las rutas nuevas (`fhn.entregasWebhook()`, etc.): el cliente no tenía métodos para
  webhooks; los tipos generados ya las incluyen.
- Ver el cuerpo de una entrega por la API (`GET …/entregas/{entrega}`): no hizo falta para reenviar.

<!-- Llaves y sandbox local (rama lote4/llaves) -->

### DEC-118 · Llaves `fhn_live_` y `fhn_test_`; la fuente de verdad es el modo del tenant
- **Contexto:** `api-rest.md` §4.3 y plan v1 3.3: las llaves de prueba y de producción no se distinguían
  (`fhn_<prefijo>_…` en los dos casos).
- **Elegida:**
  - Las llaves nuevas son `fhn_live_<12 hex>_<43>` (tenant de producción) o `fhn_test_<12 hex>_<43>` (tenant de
    prueba). `leerLlave` devuelve prefijo y modo; `prefijoDe` acepta las tres formas. El prefijo de 12 hex sigue
    siendo la clave en la base y en `DELETE /v1/llaves/{prefijo}`.
  - `api_tenants.modo` (`prueba` | `produccion`, esquema v8) es la fuente de verdad. `fhn_api_autenticar` lo
    devuelve. Una llave con marca que no coincide con el modo de su tenant recibe el mismo 401 `NO_AUTENTICADO`
    que una llave inexistente, y se cobra igual que un secreto equivocado (límite de fallos por prefijo, 429
    `DEMASIADOS_INTENTOS` al agotarse) y saca la llave de la memoria de llaves validadas. Como el SHA-256 cubre la
    llave completa, marca incluida, cambiar `live` por `test` da otra llave: el caso solo ocurre si el operador
    cambia el modo del tenant en la base.
  - Las llaves sin marca (`fhn_<prefijo>_…`) siguen valiendo en su tenant **sea cual sea su modo**. `api-rest.md`
    §4.3 decía que «cuentan como live»; aplicado al pie de la letra, las llaves que ya tiene el `demo` (que pasa a
    prueba) dejarían de entrar, y eso rompe la compatibilidad (§5: «Llaves `fhn_live_` y `fhn_test_` aceptando las
    viejas»).
  - El modo de un tenant no cambia por la API (el rol `fhn_api` solo tiene SELECT en `api_tenants`) ni por la
    consola. Se fija al crearlo: `tenant crear --modo produccion|prueba` (por defecto `produccion`); el `local`
    nace en producción y el `demo`, en prueba.
  - `POST /v1/llaves`, `llave crear` y `demo llave` crean la llave con la marca del modo de su tenant.
  - `exigirEsquemaApi` también exige la columna `api_tenants.modo`: una base en v7 no arranca con este código.
- **Alternativas:** (1) guardar el modo en cada llave (`api_llaves.modo`): duplica el dato y permite que se
  contradigan. (2) Un dígito de control (CRC) al final, que §4.3 deja como opcional: no se hizo, porque una llave
  mal copiada ya recibe 401 y el límite de intentos cubre el abuso.

### DEC-119 · Modo de los tenants y de las llaves que ya existen
- **Contexto:** el encargo pide decidir y documentar qué modo tienen los tenants y las llaves anteriores.
- **Elegida:**
  - Al migrar a v8 (una sola vez, al crear la columna) todos los tenants quedan en `produccion`, salvo el tenant
    `demo` **de demostración** (el del emisor RTN `99990000000000` o con algún CAI `DEMO00-NO-VALIDO-…`, el mismo
    criterio que `esDemoFicticio`) que además **no tiene ninguna autorización ni ningún documento con un CAI
    real**: ese queda en `prueba`. La 0.2.0 no impedía registrar un CAI real en `demo`, ni crear en modo alojado un
    tenant real con ese nombre: un `demo` así queda en `produccion`, la migración lo avisa (`RAISE NOTICE`) y
    `demo llave` se niega a crearle llaves (serían `fhn_live_` con el aviso de CAI ficticio).
  - `sesion.demo` exige además `modoTenant = 'prueba'`.
  - Las llaves viejas no cambian: siguen sin marca y valen en su tenant (DEC anterior).
  - Las autorizaciones ficticias que un tenant de producción ya tenía registradas (con `prueba: true`, que
    DEC-093 permitía) no se tocan: siguen emitiendo con la leyenda de prueba y fuera de los reportes. Solo se
    rechazan las nuevas. Retirarlas sería borrar o modificar autorizaciones, que son inmutables.
- **Alternativa:** poner en prueba todo tenant cuyas autorizaciones sean todas ficticias. Adivina la intención
  del operador y puede cambiar el comportamiento de un tenant real que solo estaba probando antes de su CAI.

### DEC-120 · `modoTenant` en la sesión y cabecera `FacturaHN-Modo`
- **Contexto:** §4.3 pide el modo «visible en todo» y §4.4 habla de «`GET /v1/sesion` confirma `modo:
  produccion`». Pero `sesion.modo` ya existe y es el modo del **servidor** (`local` | `alojado`, DEC-072).
- **Elegida:**
  - Campo nuevo `sesion.modoTenant` (`prueba` | `produccion`). `modo` y `demo` no cambian de significado (cambiarlo
    es incompatible, §5).
  - Cabecera `FacturaHN-Modo: prueba|produccion` en toda respuesta de `/v1/*` después de autenticar, también en
    los errores (403, 422…) y en las respuestas transmitidas. Las respuestas sin autenticar (401, 429 de intentos,
    `/salud`) no la llevan: no se sabe el tenant.
- **Alternativa:** renombrar `modo` a `modoServidor` y usar `modo` para el tenant. Solo en `/v2`.

### DEC-121 · CAI ficticio según el modo del tenant · [REVISAR]
- **Contexto:** DEC-063 dice que una autorización es de prueba si tiene `prueba: true` o un CAI ficticio, y DEC-093
  permitía en la API registrar un CAI ficticio en un tenant real con `"prueba": true`. El encargo (§4.3 punto 1)
  pide que el sandbox solo registre CAI ficticios y que en producción queden prohibidos.
- **Elegida** (salvaguarda del producto, no regla fiscal: ningún artículo del Acuerdo 481-2017 regula CAI
  ficticios ni tenants de prueba):
  - Tenant de **prueba**: `POST /v1/autorizaciones` rechaza todo CAI que no sea ficticio (`esCAIDemo`) con 422
    `AUTORIZACION_REAL_EN_DEMO`. Se conserva ese código (ya era el del tenant `demo`) en vez de crear otro: un
    cliente que ya lo maneja sigue funcionando. No hace falta `"prueba": true`: todo el tenant es de prueba y el
    núcleo ya marca de prueba un CAI ficticio.
  - Tenant de **producción**: rechaza todo CAI ficticio, con o sin `"prueba": true`, con 422 `CAI_DE_PRUEBA`
    (nombre de §4.3). `AUTORIZACION_DEMO_SIN_PRUEBA` ya no lo devuelve la API: `docs/errores.md` lo dice y remite
    a `CAI_DE_PRUEBA`.
  - **Qué cambia de DEC-093:** ya no se puede probar con un CAI ficticio dentro de un tenant de producción; para
    probar está el tenant de prueba (`demo` en modo local, o `tenant crear --modo prueba` en alojado). `api-rest.md`
    §5 lo clasifica como «prácticamente compatible»: rompe solo a quien registraba CAI ficticios en un tenant real.
  - **También en la base:** un disparador `BEFORE INSERT` en `fhn_autorizaciones`, creado por la migración de la
    API (v8), aplica la misma regla a cualquier camino, incluido el SDK con un `AlmacenPostgres` sobre un tenant de
    la API. Lee el modo con `fhn_api_modo_tenant` (`SECURITY DEFINER`, mismo patrón que `fhn_api_autenticar`) y no
    hace nada si el tenant no tiene fila en `api_tenants` (uso del SDK solo). El error es `check_violation` con el
    código al inicio del mensaje. La API valida antes, así que por la API sigue siendo un 422 con su guía. Solo
    actúa al insertar: las autorizaciones que ya estaban no se tocan.
  - **Qué no cambia:** el núcleo (`registrarAutorizacion`, `esAutorizacionDePrueba`, DEC-063, DEC-091), el SDK con
    su propia base y el MCP en modo SQLite siguen igual. Las pruebas que simulan un tenant real con un punto de
    prueba (datos anteriores) pasan el tenant a prueba solo mientras registran.
- **Por qué [REVISAR]:** cambia la interpretación de DEC-063/DEC-093 sobre dónde puede vivir un CAI ficticio en la
  API. El responsable debe confirmar que un tenant de producción no debe aceptar autorizaciones de prueba.
- **Alternativa:** mantener DEC-093 (ficticio con `"prueba": true` en producción). Deja la puerta abierta a un
  punto de emisión real convertido en «de prueba» por error, que es lo que el modo del tenant viene a cerrar.

### DEC-122 · El libro de ventas con llave de caja (resuelve el pendiente del Lote 4)
- **Contexto:** `GET /v1/libro-ventas` aceptaba una llave de caja y devolvía el libro de todo el tenant (pendiente
  «El libro de ventas con llave de caja» en `docs/decisiones.md`).
- **Elegida:**
  - Una llave de caja recibe el libro **solo de su punto de emisión** (establecimiento y punto), con todos sus
    tipos de documento. Igual criterio que `GET /v1/sesion` y DEC-072, donde una caja no ve la actividad de las
    demás (`documentosDelMes` es `null` para caja).
  - Mismas filas, en el mismo orden, que el libro del tenant filtrado a ese punto: el almacén pagina por número, y
    el número empieza por el punto, así que se recorren en orden las series del punto que tienen documentos en el
    período. El conteo (tope `PERIODO_DEMASIADO_GRANDE`, `excluidos`, `Documentos-Prueba-Excluidos`) es solo del
    punto, en la misma instantánea.
  - El CSV de una caja se llama `libro-ventas_<establecimiento>-<punto>_<desde>_<hasta>.csv`; el de una admin no
    cambia.
  - Una caja sin punto de emisión (anterior a DEC-035) recibe 403 `CAJA_SIN_PUNTO` (falla cerrado, como al emitir).
  - Una llave admin sigue recibiendo el libro de todo el tenant. La exportación (Art. 53 num. 5) sigue siendo solo
    de admin.
- **Alternativas:** (1) solo admin (403 `SOLO_ADMIN` para la caja): rompe a quien hoy lo pide con caja (§5). (2)
  Un filtro `puntoEmision` en `FiltroDocumentos` del núcleo: cambia el contrato del almacén para todos los
  adaptadores, como ya se descartó en DEC-087.
  - Una nota de crédito de la caja A sobre una factura de la caja B va en el libro de A (su número es de A), no en el
    de B. Tiene prueba.
- **Límite conocido:** no es un límite de confidencialidad. `GET /v1/documentos` y `GET /v1/documentos/{numero}`
  con llave de caja siguen mostrando documentos de todo el tenant, como en la 0.2.0; `docs/api.md` lo dice. Acotarlos
  al punto sería otra decisión (y quizá incompatible para un POS que consulta ventas de otra caja); queda como
  propuesta. La descripción de `libro_ventas` del MCP y su README dicen que con llave de caja es solo su punto.

#### Propuestas que quedaron fuera (llaves)
- `modo` en el sobre de los webhooks y secretos por modo (§4.3 puntos 4 y 7): `webhooks.ts` lo cambia en paralelo
  la rama `lote4/webhooks`; el documento ya lleva `modo: "prueba"` en `datos`.
- Límites más bajos para los tenants de prueba (§4.3 punto 6) y el reloj simulado (punto 8, P3).
- Nombre y encabezado «PRUEBA» en los reportes de un tenant de prueba (§4.3 punto 5): hoy salen vacíos con
  `excluidos` y el aviso (DEC-087), que ya los distingue del archivo del Art. 53 num. 5.
- En modo alojado, el enlace `<tenant>` ↔ `<tenant>-prueba` (`tenant_produccion`): sin el modo alojado como
  servicio (P-02) no hace falta.
- Detección de filtraciones (una `fhn_live_` es urgente y una `fhn_test_` no): la marca ya lo permite; registrar
  el patrón en un escáner de secretos queda para cuando haya publicación.

<!-- Pendientes del núcleo y de Postgres (rama lote4/pendientes) -->

### DEC-123 · Caracteres no permitidos en los textos de entrada (`TEXTO_CARACTER_NO_PERMITIDO`)
- **Contexto:** un NUL en un texto de la venta se guardaba en `fhn_documentos.datos` (columna `json`, que lo
  acepta) y después fallaba todo lo que convierte a `jsonb`: el listado sin líneas (`datos::jsonb - 'lineas'`,
  500 en `GET /v1/documentos`) y el disparador `fhn_solo_anular` (la anulación). Una mitad suelta de un par
  sustituto UTF-16 (`\ud800`, que `JSON.parse` acepta) falla igual: lo comprobé contra Postgres (`22P05` y `22P02`).
- **Elegida:** `validarEntrada` (y por tanto `emitir`, antes de guardar, sin consumir número) rechaza con
  `TEXTO_CARACTER_NO_PERMITIDO` todo texto de la entrada que lleve:
  - un carácter de control Unicode (categoría Cc: C0, DEL y C1), **salvo** tabulador, salto de línea y retorno de
    carro, que tienen sentido en descripciones, direcciones y observaciones y que hoy se aceptan;
  - la mitad suelta de un par sustituto (los emojis completos sí pasan).
  Recorre todos los textos de la entrada (emisor, cliente, líneas, referencia, exoneración, motivo, observaciones
  y cualquier campo extra) **y los nombres de los campos**, a cualquier profundidad (recorrido iterativo, con un
  `WeakSet` contra ciclos), con un problema por campo y `campo` con la ruta (`lineas[0].descripcion`; un nombre
  de campo malo se escribe `cliente.k<U+0000>`, para no devolver el carácter). `operador` se omite porque ya lo
  valida `OPERADOR` (más estricto: sin saltos de línea). Se exporta `problemasDeTexto(valor)` para que la API lo
  use en otros cuerpos.
  `anularDocumento` (y por tanto `anular` y `corregirFechaAdelantada`) revisa igual el motivo antes de guardar:
  antes, un NUL en el motivo daba 22P05 en el disparador de anulación (500 en la API).
  No es regla fiscal: es integridad de datos (Postgres) y defensa de la impresora (DEC-060). Lleva `solucion` y su
  entrada en `docs/errores.md`.
- **Emisor configurado:** la revisión incluye `emisor`, que no viene de la venta sino de la configuración
  (`crearFacturador({ emisor })` o `api_emisores`). Un tenant con un carácter de control guardado en su emisor
  recibe 422 en toda emisión con `campo: 'emisor.…'`. Esos problemas traen una `solucion` propia: corregir la
  configuración (en la API, `PATCH /v1/emisores/{id}`). El integrador agrega la validación en `POST`/`PATCH
  /v1/emisores` con `problemasDeTexto`. Está dicho en el changeset.
- **Compatibilidad:** se rechaza una entrada que antes se aceptaba. Solo cambia para textos con caracteres
  invisibles que de todos modos rompían Postgres o la impresión. Changeset `minor` (0.x).
- **Límite conocido:** los documentos ya guardados con un NUL no se tocan (son inmutables); si existen, el listado
  sin líneas de ese tenant sigue fallando. No hay migración para eso.
- **Alternativa:** limpiar los caracteres en silencio. Cambiaría lo que el cliente envió en un documento fiscal
  sin decirlo.

### DEC-124 · `registrarAutorizacionConAvisos` (pendiente `AVISO_VIGENCIA_MAYOR_1_ANIO`)
- **Contexto:** `registrarAutorizacion` aceptaba sin aviso una autorización con la fecha límite a más de un año de
  `fechaAutorizacion` (Art. 62). Los códigos ya quedaban en el detalle del evento `AUTORIZACION_REGISTRADA`, pero
  quien registraba no recibía el aviso. Devolverlo en `registrarAutorizacion` cambiaría su firma
  (`Promise<AutorizacionCAI>`), que usan la API, el MCP, la fachada y los ejemplos.
- **Elegida:** función nueva `registrarAutorizacionConAvisos(almacen, autorizacion, opciones?)` →
  `{ autorizacion, advertencias }`, con los `AVISO_*` de `validarAutorizacion` (el mismo mensaje con la cita al
  Art. 62). `registrarAutorizacion` delega en ella y devuelve solo la autorización, sin propiedades nuevas. La
  bitácora sigue guardando los códigos. Tipos exportados: `OpcionesRegistroAutorizacion`, `RegistroAutorizacion`.
- **Para el integrador (API):** en `POST /v1/autorizaciones` (`packages/api/src/app.ts`, hoy línea ~655), cambiar
  `registrarAutorizacion(...)` por `registrarAutorizacionConAvisos(...)` y responder
  `{ autorizacion, advertencias }` (campo nuevo, compatible según `api-rest.md` §5), con `advertencias` en el
  esquema de la respuesta 201. El MCP (`registrar-cai`) ya imprime el aviso con `validarAutorizacion`.
- **No se tocó:** la fachada `crearFacturador().registrarAutorizacion`; agregarle un método cambiaría la
  interfaz `Facturador`. Queda como propuesta.
- **Alternativa:** una opción `alAdvertir(advertencias)` en `registrarAutorizacion`. Un callback para un dato de
  retorno es más difícil de usar y de probar.

### DEC-125 · Dos notas de crédito sobre documentos de puntos distintos: no se reproduce el bloqueo mutuo
- **Contexto:** se sospechaba que dos notas de crédito simultáneas, la de 000-001 sobre una factura de 000-002 y la
  de 000-002 sobre una de 000-001, podían esperarse en ciclo (40P01 → 500).
- **Resultado:** no se reproduce. Cada nota bloquea su serie 06 y después la serie del original, que por
  `REFERENCIA_TIPO` (Art. 4 num. 32) es un comprobante fiscal, nunca una nota: 000-001-06 → 000-002-01 y
  000-002-06 → 000-001-01. Con DEC-092 todos los caminos ya siguen un orden global: series de notas (06, 07) antes
  que las demás, y dentro de cada grupo en orden del identificador (el registro toma las de un punto en
  06, 07, 01, 04…; la emisión, la anulación y los no utilizados, una sola). Además, el `INSERT` de
  `api_idempotencia` y `api_uso` en `alEmitir` va después de todas las series.
- **Prueba:** `packages/postgres/test/contrato.test.ts`, «dos notas de crédito cruzadas entre puntos de emisión»:
  fuerza el cruce (cada transacción se detiene tras su primer bloqueo hasta que la otra tenga el suyo) tres veces y
  las dos notas terminan. Una prueba de control con el mismo arnés toma 000-002-01 y luego 000-001-06 (el orden
  inverso) contra la nota de 000-001 y sí obtiene 40P01: el arnés detectaría el ciclo. La prueba registra las
  series que bloquea cada nota y exige `['000-001-06','000-002-01']` y `['000-002-06','000-001-01']`, y que las
  notas no traigan `AVISO_ORIGINAL_EXTERNO`: si el original dejara de bloquearse, falla. Los ayudantes del cruce
  (`senal`, `pausa`, `conPausa`) pasan al nivel del archivo para compartirlos con la prueba de DEC-092.
- **Código:** sin cambio de orden; solo un comentario en `problemasDeNotaCredito` que explica el invariante.
- **Alternativa:** un candado consultivo por tenant para las notas. Serializaría todas las notas de un tenant sin
  necesidad.

<!-- Colecciones y cliente de Python (rama lote4/colecciones) -->

### DEC-126 · Las colecciones salen de un generador propio, no de `bru import` ni de openapi-to-postmanv2
- **Contexto:** plan-v1 3.4 pide colecciones de Bruno y Postman generadas del OpenAPI y reproducibles (la CI las
  regenera y falla si hay diferencias). `ecosistema.md` §3.1 sugería `bru import openapi` y el encargo, por ejemplo,
  `openapi-to-postmanv2`.
- **Decisión:** `colecciones/generar.mjs` (`pnpm colecciones`) lee `packages/api/openapi.json` y escribe las dos
  colecciones desde un mismo modelo: una carpeta por etiqueta, un archivo `<operationId>.bru` por operación, la
  carpeta «Primera factura» (sesión, emitir, PDF, con pruebas), el entorno `demo` y el script de la
  `Idempotency-Key`. Sin fechas ni ids aleatorios; el orden es el del OpenAPI. Los cuerpos de ejemplo están en
  `colecciones/ejemplos.mjs` (datos ficticios); el de emitir es `packages/api/ejemplos/factura.json`. Una operación
  nueva sin ejemplo sale con un esqueleto de sus campos obligatorios, así la generación nunca se rompe.
- **Por qué:** probé `bru import openapi` (CLI 4.3.0). Es reproducible, pero nombra cada archivo con el `summary`
  (tildes, dos puntos, comillas invertidas y paréntesis en el nombre del archivo), llena cada cuerpo con todos los
  campos opcionales y valores que la API rechaza (`"descuento": "115.00"`, `"rtn": ""`) y agrega un ejemplo por
  cada código de error (unas 20 000 líneas). openapi-to-postmanv2 pone UUID aleatorios en cada elemento, que habría
  que reescribir. Con un modelo común, Bruno y Postman tienen exactamente las mismas solicitudes y pruebas.
- **Alternativa:** `bru import` + posproceso. Más código frágil sobre un formato de salida que cambia entre
  versiones de la CLI.
- **Dependencias:** solo `@usebruno/cli` 4.3.0 (fijada), para `bru run`. openapi-to-postmanv2 no se agregó. La
  colección de Postman se comprobó convirtiéndola con `postmanToBruno` de `@usebruno/converters` (31 solicitudes,
  0 problemas), pero no se ejecutó en Postman ni con newman (ver «Fuera»).

### DEC-127 · El generador borra solo lo suyo
- **Decisión:** `generar.mjs` ya no vacía `bruno/` ni `postman/`. Reescribe y borra solo los archivos que genera:
  en `bruno/`, los `.bru` fuera de `environments/` (también el de una operación que ya no existe), `bruno.json` y
  `environments/demo.bru`; en `postman/`, sus dos archivos. Luego borra las carpetas vacías. Se conservan otros
  entornos, `bruno/.env` y otros archivos de `postman/`. Una solicitud propia guardada dentro de `bruno/` se
  borra (lo dice `colecciones/README.md`).

### DEC-128 · Formato `.bru` y no OpenCollection (YAML)
- **Decisión:** la colección de Bruno usa el formato `.bru`, aunque `bru import` ya propone OpenCollection por
  defecto. Lo abren las versiones de Bruno 1.x, 2.x y las actuales, y la CLI 4.3 lo corre.
- **Alternativa:** OpenCollection YAML, si Bruno deja de leer `.bru`. Cambia solo el escritor de `generar.mjs`.

### DEC-129 · Paquete privado `@factura-hn/colecciones` en el espacio de trabajo
- **Decisión:** `colecciones/` es un paquete privado del espacio de trabajo (`pnpm-workspace.yaml`) con
  `@usebruno/cli` como dependencia de desarrollo, y no la raíz: sus ~470 dependencias quedan fuera de los demás
  paquetes. Como el paquete es miembro del espacio de trabajo, un `pnpm install` sin filtro también las instalaría:
  por eso los trabajos `verificar` y `postgres` de `ci.yml`, `pages.yml` y `release.yml` instalan con
  `--filter '!@factura-hn/colecciones'`. En un clon limpio, ese filtro instala la raíz (Redocly, changesets, tsx,
  vitest), todos los demás paquetes, `web` y los ejemplos, y ningún `@usebruno`. Solo el trabajo `colecciones`
  instala `--filter @factura-hn/colecciones`. La imagen de Docker no cambia (instala `--filter @factura-hn/api...`).
- **Script de instalación bloqueado:** pnpm bloqueó el `postinstall` de `protobufjs@7.6.6` (lo trae la CLI de
  Bruno). Lo leí: solo avisa por stderr si un `package.json` ajeno declara protobufjs con otro esquema de versión.
  Quedó denegado de forma explícita (`allowBuilds: protobufjs: false`, con un comentario).

### DEC-130 · Una `Idempotency-Key` nueva por solicitud en las colecciones
- **Decisión:** el script previo de las dos colecciones pone `idempotencyKey` = un UUID v4 nuevo en cada solicitud
  (`require("uuid")`, que existe en el sandbox seguro de Bruno y en el de Postman), y la solicitud de emitir lo
  manda en `Idempotency-Key`. Cada envío de «Emitir» es otra venta y emite otra factura de prueba.
- **Por qué:** así lo pide el encargo, y en una colección de prueba enviar dos veces debe dar dos facturas. La regla
  de integración (clave estable por venta, nunca una nueva por intento) se repite en el comentario del script, en
  la documentación de la solicitud y en `docs/api.md`.

### DEC-131 · El entorno `demo` no trae llave; Bruno la lee de `FHN_LLAVE`
- **Decisión:** `baseUrl` = `http://127.0.0.1:8787`. En Bruno, `llave: {{process.env.FHN_LLAVE}}`: la toma de la
  variable de entorno o de `colecciones/bruno/.env` (ignorado por git y por Docker); así la llave no pasa por la
  línea de órdenes (`--env-var llave=…` la dejaba en el historial y en la salida de pnpm). En Postman, que no lee
  variables del sistema, `llave` es una variable secreta vacía donde se pega. En la CI sale de
  `factura-hn-api demo llave --solo-llave`, se enmascara y va a `FHN_LLAVE` por `$GITHUB_ENV`.
- Probado: con `FHN_LLAVE` exportada y con un `.env`, 7/7; la llave no aparece en la salida.

### DEC-132 · Cliente de Python en `clientes/python/`, sin versionar el código generado
- **Decisión:** `clientes/python/generar.py` corre openapi-python-client 0.30.0 (paquete `factura_hn_api`,
  `config.yml`, `--fail-on-warning`) y escribe en `clientes/python/generado/` (ignorado por git). La prueba
  `test_primera_factura.py` (pytest) emite contra la API de `FHN_API_URL` con la llave de `FHN_LLAVE` y comprueba:
  tenant de prueba y `puedeEmitir`; número `000-001-01-NNNNNNNN` con el `correlativo` igual a sus 8 dígitos; la
  misma clave devuelve el mismo número con `Idempotency-Replayed: true` (y la primera emisión sin ella); otra clave
  toma el correlativo siguiente; total = 115.00 y su desglose, gravado al 15 % = 100.00 e ISV 15 % = 15.00 (ISV 18 %
  = 0), en centavos enteros como pide la especificación; `modo` = `prueba`; la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» en el `.txt`;
  el PDF empieza con `%PDF`; y el documento se lee de nuevo por su número.
- `requirements.in` lista las directas; `requirements.txt` sale de él con
  `uv pip compile --universal --python-version 3.12 --generate-hashes` (uv 0.13.7, solo en el entorno virtual local):
  todas las dependencias fijadas con sus hashes y marcadores para Linux, macOS y Windows. La CI instala con
  `pip install --require-hashes`. Comprobado: instala con `--require-hashes` en Windows, y `pip download
  --require-hashes --platform manylinux… --python-version 3.12` baja y verifica las 29 ruedas de Linux.
  `.gitignore` le hace una excepción a `*.txt`. En local, el entorno virtual es `.venv-python/`, ignorado
  también en `.dockerignore`, igual que `clientes/python/generado/` y `.pytest_cache`.
- **Supuesto:** la prueba del correlativo siguiente supone que nadie más emite con esa caja del demo mientras corre
  (en la CI corre sola, después de Bruno).
- **Nota:** el generador actual depende de `httpx2` (no de `httpx`) y agrupa los módulos por etiqueta: las de tilde
  quedan `api/sesi_ó_n` y `api/auditor_í_a`. Funcionan, pero son feos.
- **Propuesta (no hecha):** etiquetas sin tilde en el OpenAPI (`Sesion`, `Auditoria`) o un `x-` con nombre ASCII.
  Cambiar las etiquetas cambia la documentación interactiva y el sitio, y no es de esta rama.

### DEC-133 · Trabajo `colecciones` en la CI
- **Decisión:** un trabajo nuevo en `ci.yml`: instala solo `@factura-hn/colecciones`, regenera las colecciones y
  falla con `git diff --exit-code` o con archivos nuevos sin versionar; levanta la imagen con
  `docker compose up -d --build --wait`; crea la llave del demo (enmascarada, en `FHN_LLAVE`); corre
  `bru run primera-factura --env demo`; instala
  Python 3.12 (`actions/setup-python` v7.1.0 fijada por SHA), genera el cliente y corre pytest. Muestra el log de la
  API si algo falla y baja Compose al final.
- **Por qué separado de «Imagen de la API»:** ese trabajo no instala Node ni Python y es una prueba de humo rápida.

### DEC-134 · Integración del Lote 4
- **Contexto:** las ramas `webhooks` y `llaves` subieron cada una el esquema de la API a la v8; `pendientes` dejó a
  la API el registro con avisos.
- **Elegida:**
  - Una sola v8 con las dos partes (rotación del secreto de webhooks y modo del tenant). `exigirEsquemaApi` pide las
    dos columnas. Ninguna v8 se publicó, así que no hay bases a medio migrar fuera del desarrollo.
  - `POST /v1/autorizaciones` usa `registrarAutorizacionConAvisos` y responde `{ autorizacion, advertencias }`
    (campo nuevo, compatible).
  - `FacturaHN-Modo` queda declarada en el OpenAPI junto con las demás cabeceras comunes.
  - El cursor de `GET /v1/documentos` exige una fecha del calendario (antes, `2024-99-99` daba 500).
- **Alternativa:** v8 y v9 por separado, con el mismo resultado y una migración más.

## Lote 5: calidad medida (Etapa 4)

Los informes con los números están en `docs/calidad.md`.

<!-- OWASP API Security Top 10 (rama lote5/owasp) -->

### DEC-135 · Revisión OWASP API Security Top 10 (2023) con pruebas que recorren el catálogo de operaciones
- **Contexto:** Lote 5, medir la calidad. El encargo pide recorrer los diez riesgos contra `@factura-hn/api` con
  pruebas que intenten explotarlos, y dejar el resultado en `docs/calidad/owasp.md`.
- **Elegida:**
  - Un archivo por riesgo en `packages/api/test/owasp/` (`api1-bola` … `api10-terceros`). `comun.ts` tiene un
    tenant con un recurso de cada tipo y el **catálogo** de las 28 operaciones autenticadas, cada una con una
    solicitud de ejemplo, si es solo de admin y su plantilla de ruta.
  - Las pruebas de BOLA, autenticación y roles recorren el catálogo entero. La de inventario exige que el catálogo
    y la especificación tengan las mismas operaciones y que el servidor no atienda rutas fuera de la
    especificación (salvo `/openapi.json`, `/docs` y `/`). Una ruta nueva sin entrada en el catálogo rompe la CI.
  - Cada ataque comprueba también que no hubo efecto: `huella(t)` lee el tenant antes y después (estado del
    documento, emisor, llaves, webhooks, entregas, CAI y el secreto guardado del webhook).
  - No se duplicaron las pruebas que ya existían (reportes acotados, topes de webhooks, receptor lento, RLS en la
    base, límite mensual). El informe las cita.
  - Medición: `pnpm calidad:owasp` (`scripts/owasp.mjs`) corre las pruebas con el informe JSON de Vitest y
    resume por riesgo. Falla si un riesgo tiene una prueba fallida u omitida, o ninguna que pase. Ninguna prueba
    depende de la red ni del equipo: `despacharWebhooks` acepta `resolver` (solo para pruebas) y `lookupSeguro` se
    exporta como `crearLookupSeguro(resolver)`, así que la revisión de direcciones al conectar se prueba con un
    resolvedor fijo (revisión independiente: la primera versión dependía del nombre del equipo y podía omitirse).
    `pnpm --filter @factura-hn/api test:owasp` corre solo las pruebas.
  - CI: corren dentro de `pnpm test:pg` (unos 60 s), en el trabajo «Postgres». No se agregó paso nocturno.
- **Alternativa:** una herramienta externa (ZAP, Schemathesis) contra la API levantada. Sin ella no hay que
  instalar nada global ni levantar contenedores. Además, las pruebas usan lo que una herramienta genérica no sabe:
  roles, tenants, cajas, correlativos y la regla de que nada cambie.

### DEC-136 · Tope de bytes por página en `GET /v1/documentos`
- **Contexto:** hallazgo API4. `limite` llega a 500 y un documento puede pesar unos 480 KB (500 líneas en un cuerpo
  de 512 KB). Una página cargaba hasta unos 240 MB en el proceso compartido. Medido con 20 documentos de ese
  tamaño: 10 MB y 218 ms por respuesta. Es lo mismo que DEC-059 corrigió en los reportes.
- **Elegida:** `MAX_BYTES_PAGINA = 8 MiB` (configurable con `ConfigApi.maxBytesPagina`). En la base, sobre las
  `limite + 1` filas de la página, una suma acumulada de `octet_length(datos::text)` deja las filas que **empiezan**
  antes del tope. Siempre sale al menos una, y las demás no salen de Postgres. Si hubo corte (`count(*) OVER ()`
  mayor que las filas que quedan), `hayMas` es `true` y el cursor es el del último documento devuelto.
- **Compatibilidad:** una página puede traer menos de `limite` con `hayMas: true`. `docs/api.md` ya decía «si
  `hayMas`, pide la siguiente», y `@factura-hn/cliente` lo hace; la especificación no lo decía, así que
  `listarDocumentos` lleva ahora una `description` con el corte y con «sigue mientras `hayMas`». Solo un cliente que se
  detenga al recibir menos de `limite` vería menos documentos, y solo con documentos muy grandes: 8 MiB son unos
  4 000 documentos típicos de 2 KB, más que el `limite` máximo. `docs/api.md` lo dice y hay changeset.
  `crearApp` rechaza un `maxBytesPagina` que no sea un entero positivo (con 0, cada listado daba 500).
- **Alternativa:** bajar el máximo de `limite`, que es incompatible (§5) y no acota bien porque el tamaño varía
  mucho entre documentos. Otra opción era transmitir la lista como los reportes, que es más código para un caso
  que el tope ya resuelve.

### DEC-137 · La bitácora de `webhook.creado` guarda los eventos sin repetir
- **Contexto:** hallazgo API4 (bajo). La bitácora guardaba `eventos` tal como venía en el cuerpo: hasta 512 KB
  por alta, que después salían en `GET /v1/bitacora` (hasta 500 por página).
- **Elegida:** se guarda la lista de la fila del webhook, que ya se guardaba sin repetidos. No cambia la forma de
  la solicitud: se siguen aceptando repetidos. Rechazarlos con `.max()` en el esquema sería un cambio que no hace
  falta.

### DEC-138 · `problemaDeURL` quita el punto final del nombre
- **Contexto:** hallazgo API7 (bajo). En modo alojado, `https://localhost./`, `https://x.internal./` y
  `https://x.local./` pasaban la validación del registro. Al conectar, `lookupSeguro` los frenaba porque resuelven
  a direcciones internas. No era explotable, pero la validación decía «válido».
- **Elegida:** se quitan los puntos finales del nombre antes de comparar con `localhost`, `.localhost`,
  `.internal` y `.local`, y un nombre que queda vacío (`https://./`) es «URL inválida». `docs/api.md` lo menciona.

### DEC-139 · `GET /v1/libro-ventas` declara el 403
- **Contexto:** la prueba de API5 compara las operaciones que la especificación marca con 403 con las que el
  código puede negar. `obtenerLibroVentas` devuelve 403 `CAJA_SIN_PUNTO` (DEC-122) sin declararlo, en contra de
  DEC-105.
- **Elegida:** se agrega 403 a sus respuestas y se regeneran `openapi.json` y `packages/cliente/src/esquema.ts`.
  La prueba fija el conjunto: las 18 de admin más `emitirDocumento` y `obtenerLibroVentas`.

#### Propuestas que quedaron fuera (OWASP)
- **Representación impresa en el hilo principal (API4).** El PDF de un documento de 500 líneas tarda unos 440 ms
  de CPU, y el HTML unos 60 ms. Con 20 solicitudes por segundo por llave, una caja puede ocupar el proceso de
  todos los tenants. Propuestas:
  - renderizar en un `worker_threads` con un cupo por tenant, como `ReportesEnCurso`;
  - o guardar la representación en caché por número y estado: el documento es inmutable (Art. 38) y solo cambia
    al anularse (Art. 41).

  No se hizo en este lote porque toca `@factura-hn/pdf` o agrega estado al servidor.
- **Límite por tenant, no solo por llave (API4).** Una admin puede crear llaves sin tope, y cada una trae su
  cubeta de 20/s. Propuestas:
  - una cubeta por tenant además de la de cada llave;
  - o un tope de llaves activas por tenant (409 `LIMITE_LLAVES`, como DEC-058).

  Cualquiera de las dos pone un número que debe fijar el responsable del servicio alojado.
- **Lectura de documentos con llave de caja (API1).** Es el límite conocido de DEC-122. La prueba
  «límite conocido (DEC-122)» fija el comportamiento actual, para que un cambio se note.
- **`GET /v1/autorizaciones` y `GET /v1/llaves` sin paginar.** Devuelven todo con `hayMas: false`. Hoy son pocas
  filas por tenant. Paginarlas con `limite`/`cursor` es aditivo.
- **Puertos en webhooks alojados.** En modo alojado se acepta cualquier puerto de una dirección pública. No es
  SSRF hacia la red interna. Limitar a 443 (o a una lista) rompería a quien hoy recibe en otro puerto.

<!-- Propiedades, contrato OpenAPI y fuzzing (rama lote5/propiedades) -->

### DEC-140 · Propiedades del núcleo con fast-check: qué se prueba y cómo se cita
- **Contexto:** Lote 5, medir la calidad. El encargo pide propiedades de dinero y cálculo, numeración, validación
  y montos en letras, cada una con su artículo cuando es fiscal y sin inventar reglas.
- **Elegida:**
  - `packages/core/test/propiedades/*.prop.test.ts` (dinero, cálculo, numeración, validación, letras, fuzz). El
    nombre de cada `describe`/`it` fiscal cita su artículo (Ley del ISV Arts. 3 y 9; Reglamento,
    Acuerdo 481-2017, Arts. 10, 11, 12, 14, 43 y 62).
  - Donde el código hace algo que el reglamento no dice (el tope de montos, los billones, el aviso del Art. 62
    exactamente en el día 366), la propiedad prueba solo lo que la norma sí dice (p. ej. ningún aviso hasta 365 días
    y siempre a partir de 367) y lo demás queda como hallazgo en este archivo.
  - `config.ts`: `FHN_PROP_CORRIDAS` (200 en el CI, 20 000 de noche), `FHN_PROP_SEMILLA` para reproducir, e
    `FHN_PROP_INFORME` para contar casos. Las propiedades con emisión en memoria usan una fracción (`corridas(0.1)`).
  - fast-check 4.11.0 fijado como dependencia de desarrollo del núcleo y de la API.
- **Descartada:** propiedades «oráculo» que reimplementan `calcularDocumento`: probarían el código contra sí
  mismo. Se usan invariantes (suma de las partes, permutación, fusión de documentos) y oráculos independientes
  pequeños (redondeo del Art. 9 en `bigint`, un lector de letras→número).

### DEC-141 · Tope técnico de montos: `MONTO_MAXIMO_CENTAVOS` y el problema `MONTO_FUERA_DE_RANGO`
- **Hallazgo:** con cantidades enormes (`cantidad: '99999999999999999999'`), `calcularDocumento` llegaba hasta
  `centavosEnLetras`, que lanzaba un `RangeError` sin código; en la API era un 500. Además, un total de más de 15
  cifras ya no es exacto al centavo en `number` (los totales del documento son `number`).
- **Elegida:** `MONTO_MAXIMO_CENTAVOS = 10^15 − 1` (L 9,999,999,999,999.99), en dos sitios:
  - `validarLineas` (campo `lineas`) suma el importe neto por grupo de tasa y le agrega a cada grupo su ISV con
    `impuestoArt9` (exento y alícuota cero, sin ISV). Es el total exacto con precios sin ISV y sin exoneración; con
    ISV incluido o exoneración el total real es menor o igual, así que ahí el tope puede rechazar un documento que
    cabría. `calcularDocumento` lanza `ErrorCalculo` y la API responde 422 sin consumir número.
  - `validarEntrada` (campo `tipoCambio`): en moneda extranjera, el total en lempiras al tipo de cambio (el de
    `equivalenteLempiras`) tampoco puede pasar del tope.
- **Revisión independiente:** la primera versión suponía 18 % en todas las líneas (rechazaba documentos exentos o
  al 15 % que cabían) e ignoraba el tipo de cambio (un documento en USD de ~USD 9.7 billones se emitía y su
  equivalente en lempiras perdía centavos). Las dos cosas se corrigieron; la propiedad del tope recorre ahora los
  dos lados del límite (L 8 a 12 billones, de 1 a 3 líneas con tasas mezcladas) y compara con un oráculo por grupo.
- **No es fiscal:** el reglamento no pone techo a una factura. Es el límite en que el total sigue exacto; está
  en el comentario de la constante («tope técnico, no fiscal») y en `docs/errores.md`.

### DEC-142 · Montos en letras: billones en escala larga
- **Hallazgo:** 10^12 salía «UN MILLÓN MILLONES». Desde DEC-141 (tope) los montos llegan hasta 10^13 − 1, así que el
  caso es alcanzable.
- **Elegida:** escala larga del español (RAE): 10^12 = «UN BILLÓN», 2.5 × 10^12 = «DOS BILLONES QUINIENTOS MIL
  MILLONES». Por debajo de 10^12 nada cambia, y lleva «DE LEMPIRAS» igual que «MILLÓN»/«MILLONES». Una propiedad
  lee las letras de vuelta a número con un lector independiente.

### DEC-143 · `ErrorExportacion` en `leerExportacionJSONL`
- **Hallazgo:** una línea que no es JSON lanzaba el `SyntaxError` de `JSON.parse` sin número de línea, y una línea
  que es JSON pero no un objeto (`5`, `null`, `[]`) se devolvía como si fuera un documento.
- **Elegida:** `ErrorExportacion extends SyntaxError` con `linea` (1-based, contando las vacías). Rechaza también
  las líneas que no son un objeto. Al heredar de `SyntaxError`, quien atrapaba `SyntaxError` sigue igual.

### DEC-144 · 415 `TIPO_DE_CONTENIDO` con la forma de error de la API
- **Hallazgo (fuzz y contrato):** sin `Content-Type: application/json`, el validador de `@hono/zod-openapi`
  respondía 415 en texto plano, sin `solicitud` ni `solucion`, y ninguna operación lo declaraba.
- **Elegida:** `onError` convierte el `HTTPException` 415 al sobre de error (`TIPO_DE_CONTENIDO`, con su solución y
  enlace a la guía), y `conErrorDeTipoDeContenido` declara el 415 en cada operación con cuerpo.
- **Descartada:** responder 400 `SOLICITUD_INVALIDA`. 415 es el estado correcto (RFC 9110 §15.5.16) y ya era el que
  se enviaba; cambiarlo rompería a quien lo maneje. Lo nuevo es solo la forma del cuerpo y la declaración.

### DEC-145 · La especificación se alinea con lo que la API ya enviaba
- **Hallazgo (contrato):** cuatro respuestas de las pruebas existentes no estaban en `openapi.json`: la cabecera
  `Idempotency-Replayed` del 201 de `emitirDocumento`, los tipos `text/csv` y `text/plain` de `exportarPeriodo`,
  el 403 de `obtenerLibroVentas` (también lo encontró la rama owasp, DEC-139: al integrar queda uno) y
  `FacturaHN-Modo` en los 429 `LIMITE_MENSUAL` y `DEMASIADOS_REPORTES`.
- **Elegida:** en los cuatro casos se cambió la especificación, no el código: el comportamiento era el documentado
  en `docs/api.md` (o el deseable: el modo del tenant ya se conoce cuando se decide ese 429). La descripción de
  `FacturaHN-Modo` dice en qué 429 no viene (los que se deciden antes de validar la llave).

### DEC-146 · Fechas de período que no existen: 400, no 500
- **Hallazgo (fuzz):** `desde=2026-02-30` pasaba el patrón `AAAA-MM-DD` y Postgres fallaba al convertirla: 500.
- **Elegida:** `FechaDelCalendario` (el patrón más `esFechaValida` del núcleo) en `desde` y `hasta` de todos los
  períodos: 400 `SOLICITUD_INVALIDA`. La especificación no cambia (el refinamiento no se expresa en JSON Schema).

### DEC-147 · Un CAI con NUL en la ruta es 404
- **Hallazgo (fuzz):** `GET /v1/autorizaciones/%00/estado` llegaba a Postgres, que rechaza `\0` en un texto: 500.
- **Elegida:** `obtenerEstadoAutorizacion` responde 404 `NO_ENCONTRADO` si el CAI trae `\u0000`: ningún CAI lo
  tiene. Las demás rutas con parámetro de texto ya validaban su forma antes de consultar (el fuzz las recorrió).

### DEC-148 · Caracteres de control en los textos que van directo a la base: 400, no 500
- **Hallazgo (revisión independiente):** `POST /v1/llaves` con `nombre: "a\u0000b"` y `POST /v1/webhooks` con un
  NUL en la URL respondían 500: Postgres no guarda U+0000 en `text` (SQLSTATE 22021). El fuzz no lo había visto:
  generaba NUL solo como valor entero de un campo, y rara vez en esas rutas.
- **Elegida, en dos capas:**
  - Esquemas: `LlaveNueva.nombre` (patrón, visible en `openapi.json`) y `WebhookNuevo.url` (refinamiento, para no
    perder `format: uri` en la especificación) rechazan los caracteres de control con la misma regla del núcleo
    (`TEXTO_CARACTER_NO_PERMITIDO`: se permiten tabulador y saltos de línea). Es 400 `SOLICITUD_INVALIDA` con su
    campo. Los textos del documento, el emisor, el motivo y el operador ya los revisaba el núcleo (422); la sonda lo
    confirmó ruta por ruta.
  - Red de seguridad en `onError`: un error de Postgres con SQLSTATE `22021` o `22P05` es 400
    `SOLICITUD_INVALIDA`, no 500. Su prueba monta una ruta `/prueba-*` que manda un NUL a la base de verdad.
- **Fuzz:** el modo sano y el hostil meten a veces un carácter de control (casi siempre U+0000) dentro de un texto
  al azar del cuerpo, sin cambiar su forma (`conCaracterDeControl`). El modo hostil ya usaba la llave admin (2 de
  cada 7 casos). Con 3 000 casos llegan 22 `POST /v1/llaves` y 18 `POST /v1/webhooks` a ese 400.

### DEC-149 · Validador del contrato OpenAPI en las pruebas de la API
- **Elegida:** un `setupFile` de vitest (`test/setup-contrato.ts`) envuelve `app.fetch` de toda app que crea
  `crearApp`, así que **todas** las pruebas de la API pasan por el validador sin tocarlas. Ajv 2020 (dialecto de
  OpenAPI 3.1) con `ajv-formats`. Se valida: operación existente, estado declarado, tipo de contenido, cuerpo JSON
  contra su esquema, las cabeceras propias declaradas para ese estado (y su tipo) y que `Solicitud-Id` y
  `FacturaHN-Version` vengan siempre. Una violación lanza en la misma prueba.
- **Excepciones, todas explícitas en `openapi-validador.ts`:** `/openapi.json`, `/docs` y `/` (fuera de la
  especificación a propósito, como en DEC-135 de owasp); las rutas `/prueba-*` que montan algunas pruebas; y en
  rutas que no existen, el 404 `NO_ENCONTRADO` o los errores de los middleware previos a la ruta (400
  `CUERPO_NO_UTF8`, 401, 413, 429), con el esquema `Error`.
- **No se lee el cuerpo** de las respuestas que no son JSON (CSV, JSONL, PDF): son flujos, y leerlos en el
  validador cambiaba lo que miden las pruebas de reportes acotados. Se valida su tipo de contenido. Si la
  respuesta no declara contenido, el cuerpo se lee siempre y debe llegar vacío.
- **Cabeceras obligatorias:** `Solicitud-Id`, `FacturaHN-Version` y `Retry-After` (solo en los 429) se marcan
  `required: true` en `openapi.json`; el validador exige toda cabecera declarada `required` (también
  `Documentos-Prueba-Excluidos`) y que todo 429 traiga `Retry-After`.
- **Descartada:** Schemathesis contra la API local: es Python (dependencia global) y no ve las respuestas de las
  pruebas que ya existen, que son las que recorren los casos raros.

### DEC-150 · Fuzzing de la API desde la especificación
- **Elegida:** `test/fuzz.test.ts` genera las solicitudes desde `openapi.json` (`fuzz-esquema.ts` traduce JSON
  Schema a fast-check). Dos modos mezclados: **sano** (llave válida, cabeceras correctas, cuerpos que cumplen el
  esquema con valores verosímiles; un tercio son emisiones) para llegar a la lógica, y **hostil** (llaves, cabeceras,
  rutas, cursores y cuerpos al azar o mutados, UTF-8 inválido). Afirma que ningún estado es 500 y, con ≥ 300 casos,
  que se vieron las 28 operaciones, más de 15 % de 2xx y un 201 y un 422 de emisión (si el fuzz solo recibiera 400,
  no probaría nada).
- **Cantidades y semilla:** 300 casos en el CI (unos 5 s) con la semilla fija 20261125, para que los umbrales de
  cobertura (que dependen de la suerte) no fallen al azar; 20 000 en `nocturno.yml` con `FHN_PROP_SEMILLA` igual al
  número de corrida, distinta cada noche y reproducible. Las propiedades del núcleo no tienen umbrales: siguen con
  semilla al azar en el CI salvo que se fije `FHN_PROP_SEMILLA`.
- El tenant del fuzz tiene límites de solicitudes altos y una llave «de sacrificio» para que el fuzz no revoque
  las suyas; tras un PATCH del emisor exitoso, se restaura.

### DEC-151 · Dominio de las propiedades de fecha: 2007–2099
- **Contexto:** Honduras tuvo horario de verano en 2006 (UTC−5 de mayo a agosto). `fechaHonduras` usa la zona
  `America/Tegucigalpa` de ICU, que lo sabe.
- **Elegida:** la propiedad «la fecha en Honduras es UTC−6» se limita a 2007–2099; 2006 queda fuera porque la
  propiedad sería falsa, no el código. Las fechas fiscales del producto son de 2014 en adelante.

### DEC-152 · ISV por grupo de tasa: la propiedad prueba la lectura ya documentada [REVISAR]
- **Contexto:** la propiedad de «fusión» (calcular dos documentos juntos o por separado) muestra que el ISV puede
  diferir en ±1 centavo por tasa, porque el núcleo redondea el ISV una vez por grupo de tasa (los subtotales por
  tarifa del Reglamento, Acuerdo 481-2017, Art. 11 num. 1 g-i), no por línea. El Art. 9 de la Ley del ISV habla del redondeo
  «sobre el precio del artículo vendido», lo que también puede leerse por artículo.
- **Elegida:** la propiedad fija esa cota (±1 centavo por tasa) y el ISV impreso = tasa × base impresa redondeado
  por el Art. 9. No agrega una regla ni abre una consulta nueva: la pregunta ya está en `docs/consulta-sar.md`
  §P-10 («por línea o por tasa»). [REVISAR] cuando el SAR responda; si cambia a por línea, estas propiedades lo
  detectan.

### DEC-153 · Observación: `validarEntrada` no lanza con valores sin tipo
- **Contexto:** el fuzz del núcleo pasa a `validarEntrada` y `construirDocumento` objetos con la forma de los tipos
  y valores arbitrarios (lo que manda un integrador en JavaScript sin tipos).
- **Resultado:** `validarEntrada` nunca lanza (devuelve problemas) y `construirDocumento` solo lanza
  `ErrorValidacion`. No se cambió nada; queda como propiedad para que no retroceda.

<!-- Pruebas de mutación (rama lote5/mutacion) -->

### DEC-154 · Pruebas de mutación del núcleo con Stryker: alcance y pruebas que corren
- **Contexto:** el Lote 5 pide un puntaje de mutación ≥ 85 % en cálculo, dinero, numeración y validación.
- **Elegida:** `@stryker-mutator/core` y `@stryker-mutator/vitest-runner` 10.1.1 como dependencias de desarrollo de
  `factura-hn` (`packages/core`), con `coverageAnalysis: 'perTest'`. Se mutan ocho módulos:
  `calculo.ts`, `dinero.ts`, `numeracion.ts`, `documento.ts`, `autorizacion.ts`, `identificacion.ts` (los del
  encargo) y además `letras.ts` (el total en letras del Art. 11 sale del cálculo) y `modo.ts` (decide si un
  documento es de prueba; lo usan `autorizacion.ts` y `documento.ts`).
- **Fuera del alcance:** `emision.ts`, `almacen.ts`, `anulacion.ts`, `no-utilizados.ts`, `reportes.ts`,
  `render.ts`, `exportacion.ts`: dependen del almacén o son salida. Quedan para una medición posterior.
- **Pruebas que corre Stryker:** `vitest.mutacion.config.ts` (la configuración normal más exclusiones). Quedan fuera
  `readme.test.ts` (compila fragmentos de la documentación con tsc, unos 40 s), `lote2-cli.test.ts` (lanza el CLI
  desde `dist/`), `sin-flotante.test.ts` y `lote2-errores.test.ts` (leen el texto de `src/` o de `docs/` del
  repositorio; en la copia aislada de Stryker esas rutas no existen y el código está instrumentado). Ninguna de
  ellas prueba el comportamiento de los módulos mutados.
- **Zona horaria:** `stryker.config.mjs` fija `TZ=UTC`, igual que el CI, para que una prueba de fecha mate los
  mismos mutantes en cualquier equipo.

### DEC-155 · Umbral: 85 % global (`thresholds.break`) y 85 % por módulo
- **Contexto:** `thresholds.break` de Stryker solo mira el puntaje global; un módulo pequeño puede bajar sin que el
  global lo note.
- **Elegida:** `thresholds: { high: 90, low: 85, break: 85 }` y, después, `scripts/umbral-mutacion.mjs`, que lee
  el informe JSON y falla si **algún** módulo baja de 85 %. `pnpm mutacion` corre las dos cosas.
- **Puntaje:** (muertos + tiempo agotado) / (muertos + tiempo agotado + sobrevivientes + sin cobertura), como
  Stryker. Los mutantes excluidos con comentario no cuentan.

### DEC-156 · La medición corre de noche, no en el CI
- **Contexto:** el encargo permite el CI si tarda menos de ~5 min.
- **Medido:** la línea base tardó 66 min (8 procesos, Windows). Con las pruebas nuevas, 10 a 16 min con 8 a 12
  procesos en un equipo de 20 núcleos. El runner de GitHub tiene 4 vCPU (3 procesos): se espera de 30 a 50 min.
  La mayor parte se va en las pruebas que barren de 0.01 a 1,000.00 (`art9-redondeo.test.ts`, unos 13 s), que
  cubren casi todo `dinero.ts` y `calculo.ts`.
- **Elegida:** solo en `.github/workflows/nocturno.yml` (sección «lote5/mutacion», cron 08:00 UTC y
  `workflow_dispatch`, `timeout-minutes: 120`), con el informe HTML y JSON como artefacto. No va en el CI: no cabe
  en 5 minutos. Las pruebas nuevas (`test/mutacion-*.test.ts`) sí corren en el CI con `pnpm test` (menos de 1 s).
- **Informe como artefacto:** `actions/upload-artifact` v7.0.2 fijada por SHA
  (`cf430e030ddbb5b0abf93d22962f4752f3646cd9`, comprobado con `gh api repos/actions/upload-artifact/git/ref/tags/v7.0.2`;
  la etiqueta apunta directo al commit). La v4 corre en Node 20, ya obsoleto en los runners.
- **Alternativa descartada:** sacar `art9-redondeo.test.ts` de la medición para entrar en el CI. Esas pruebas son
  las que mejor vigilan el Art. 9; quitarlas para ganar tiempo debilita justo lo que se mide.

### DEC-157 · Mutantes equivalentes: se excluyen solo si la línea no tiene otros; si no, se dejan vivos
- **Contexto:** un mutante equivalente no cambia el comportamiento y ninguna prueba lo puede matar. Stryker solo
  permite excluir por línea y por tipo de mutación (`// Stryker disable next-line <Mutador>`); una exclusión por
  línea esconde también los mutantes matables de ese tipo en la misma línea. Un primer intento lo hizo así y
  escondía mutantes matables (p. ej. `!==` → `===` en `dividirRedondeando`).
- **Elegida:**
  - Se **excluyen** con comentario solo los equivalentes que son los únicos de su tipo en la línea (10): las
    entradas sin usar de las tablas de `letras.ts` (índice 0 de unidades y centenas, decenas 0 a 2), las anclas de
    `apocopar` (VEINTIUNO y UNO solo pueden quedar al final), la lista inicial de `problemasDeTexto` y la de
    `leerLinea` en `calcularCentavos`, y `exento + exonerado` en la venta mixta (con exoneración no hay base gravada).
  - Los demás equivalentes **se dejan vivos** con un comentario en el código que dice por qué (17): las
    comparaciones con 0 en `dividirRedondeando` y `escala` 0 en `parsearDecimal`/`redondearDecimal`, las cotas y
    condiciones de `baseDesdePrecioConISV` y `sugerirPrecioSinAjuste`, `catch` de `ErrorMonto` (parsearDecimal solo
    lanza ErrorMonto; ver la decisión siguiente), las anclas del patrón de `esFechaValida` (con algo de más, el texto
    ya no es igual a `toISOString().slice(0, 10)`), y `ok = false` del descuento en `leerLinea`. El patrón de
    `esFechaValida` en sí **no** es equivalente: sin él, «+010000-01» y «-000001-01» (años extendidos) pasan la
    comparación con `toISOString`; hay prueba.
- **Código muerto quitado en lugar de excluido** (mismo comportamiento, con pruebas): `leerTipoCambio` ya no
  compara con undefined, null y '' (parsearDecimal lanza ErrorMonto y da null igual); `notaEnLempiras` no usa
  `?? '01'`; `hoyHonduras` delega en el valor por omisión de `fechaHonduras`; `calcularEquivalenteLempiras`
  mira solo `tipoCambio`; `formatearMonto` no separa el signo (la expresión de miles no pone coma tras «-»);
  `centavosEnLetras` no trata el 0 aparte; `menorQueMil` no recibe 0; `descomponer` no usa `?? '0'` ni
  `|| '0'` donde no pueden aplicar; los nombres de campo que solo iban en mensajes descartados.

### DEC-158 · Montos en letras desde un billón (10^12)
- **Encontrado** por las pruebas de mutación de `letras.ts`: `enteroALetras(10^12)` daba «UN MILLÓN MILLONES» y
  `999 999 999 999 999` repetía «MILLONES». El tope (10^15) ya estaba; la escala de billones no.
- **Corregido:** escala larga del español: «UN BILLÓN», «DOS BILLONES», «VEINTIÚN BILLONES», y «DE» tras
  BILLÓN/BILLONES al final («UN BILLÓN DE LEMPIRAS»). Por debajo de 10^12 nada cambia. Pruebas en
  `test/mutacion-letras.test.ts` y changeset `patch` (`.changeset/lote5-mutacion-letras.md`).
- **No es regla fiscal:** el Art. 11 pide el total en letras; cómo se nombra el número es gramática. Montos así no
  aparecen en una factura real, pero el SDK aceptaba el número y escribía mal las letras.

### DEC-159 · Las pruebas nuevas fijan mensajes y campos exactos
- **Contexto:** la mayoría de los sobrevivientes eran textos: el mensaje, el `campo` o el nombre del campo en un
  error. Son parte de lo que ve el integrador (y la API los devuelve tal cual).
- **Elegida:** las pruebas comparan `codigo`, `mensaje` y `campo` completos (`toEqual`), sin instantáneas
  (`toMatchInlineSnapshot`), para que el texto esperado se lea en la prueba. Cambiar un mensaje obliga a cambiar
  su prueba; es intencional.

### DEC-160 · Un monto que no se puede convertir a texto es ErrorMonto, no TypeError
- **Encontrado** en la revisión de la rama: `descomponer` armaba el mensaje con `String(valor)`, que lanza TypeError
  con `Object.create(null)` o con un objeto cuyo `toString` lanza.
  `validarLineas([{ descripcion: 'a', cantidad: Object.create(null), precioUnitario: '1' }])` lanzaba en lugar de
  devolver el problema, y la API podía responder 500 con un cuerpo así.
- **Corregido** en `dinero.ts`: el mensaje se arma con `textoDe(valor)`, que no lanza (si `String` falla, escribe
  «objeto»). Ahora `parsearDecimal` solo lanza ErrorMonto y el comentario de los `catch` de `calculo.ts` y
  `documento.ts` es cierto. Prueba en `mutacion-calculo.test.ts`: da `LINEA_CANTIDAD` con
  «Línea 1: Monto inválido: objeto». No es regla fiscal.

<!-- Carga y resiliencia (rama lote5/resiliencia) -->

### DEC-161 · 503 `BASE_NO_DISPONIBLE` cuando PostgreSQL se reinicia o se cae (antes, 500 `ERROR_INTERNO`)
- **Hallazgo:** con la base detenida en medio de una emisión, la API respondía 500 `ERROR_INTERNO` («Error
  interno. Se registró para revisión.») y dejaba en el log la traza completa de cada solicitud. El cliente no
  podía distinguir «reintenta en un momento» de «hay un error en el servidor». Lo encontró
  `test/resiliencia/reinicio-pg.test.ts`.
- **Elegida:** `app.onError` reconoce los errores de base no disponible (`esBaseNoDisponible` en `errores.ts`:
  SQLSTATE 57P01, 57P02, 57P03, 53300 y los códigos de conexión de la clase 08 uno por uno (08000, 08001, 08003,
  08004, 08006: `/^(0800[0-46]|57P0[123]|53300)$/`); ECONNREFUSED, ECONNRESET y parecidos; «Connection terminated»,
  el tiempo agotado del pool) y responde 503 `BASE_NO_DISPONIBLE` con `Retry-After: 2`, `solucion` y
  `documentacion`. El log lleva una línea con el id de la solicitud, sin traza.
- **Corregido tras la revisión:** la primera versión aceptaba toda la clase 08 y con ella 08P01
  (`protocol_violation`), que PostgreSQL también devuelve por un error del código (p. ej. `SELECT $1::int + $2::int`
  con un solo parámetro). Eso habría sido un 503 reintentado para siempre en lugar de un 500 con su traza. Ahora
  la lista es explícita y 08P01 está entre los casos que la prueba exige que no se confundan.
- **Lo que garantiza:** la transacción se revirtió o su resultado es incierto (la base pudo confirmar el COMMIT
  justo antes de caerse). La solución lo dice: reintentar con la misma `Idempotency-Key`, que devuelve el mismo
  documento o lo emite una sola vez. Las pruebas lo comprueban con reinicios `fast` y caídas `immediate`, y el
  caso incierto con `test/resiliencia/commit-incierto.test.ts`: un proxy TCP entre la API y PostgreSQL deja pasar
  el COMMIT de la emisión, descarta la confirmación y corta; la API responde 503, el documento quedó y el
  reintento con la misma clave lo devuelve (`Idempotency-Replayed: true`) sin emitir otro.
- **OpenAPI:** toda operación que declaraba 500 declara también 503 (`respuestasDe` lo agrega solo). `/salud`
  también lo declara aunque no consulta la base: más simple que una excepción, y un estado declarado de más no
  rompe a nadie.
- **Compatibilidad:** compatible según `api-rest.md` §5 (un estado 5xx nuevo con un código nuevo; quien trataba
  todo 5xx como reintentable sigue igual). El cliente lo entrega como `ErrorFacturaHN` con `estado: 503`.

### DEC-162 · El despacho de webhooks vacía lo acumulado en una pasada
- **Hallazgo:** cada pasada del despacho (cada 5 s) reclamaba un solo lote de 20 entregas por tenant: a lo sumo
  4 avisos por segundo por tenant. En la carga (más de 100 documentos por segundo en un tenant) la cola crecía sin
  fin, y tras un corte del receptor lo acumulado tardaba en salir mucho más que su calendario (1000 avisos, más de
  4 minutos).
- **Elegida:** `despacharTenant` sigue reclamando lotes mientras el anterior vino lleno; pasados 30 s
  (`PRESUPUESTO_PASADA_MS`, inyectable como `presupuestoMs`) no reclama lotes nuevos. El presupuesto se revisa
  entre lotes: el lote en curso termina, así que con un receptor colgado una pasada puede durar más (un lote de 20
  con el tiempo máximo de 10 s por entrega lleva la pasada a unos 80 s). No es un problema: el tenant queda en
  `enCurso` mientras tanto y la emisión no espera al despacho. Lo ya intentado en la pasada no se vuelve a
  reclamar en ella (con espera 0, como en las pruebas, se reintentaría en bucle). El servidor ya omite al tenant
  en curso en las pasadas siguientes (`enCurso`), así que nada se entrega dos veces por esto.
- **Medido:** 70 avisos acumulados salen en una pasada (prueba); en la carga, todos los avisos están entregados
  en el mismo segundo en que termina la emisión.

### DEC-163 · `fechaHonduras` y `horaHonduras` reusan su `Intl.DateTimeFormat`
- **Hallazgo:** el perfil de CPU de la API bajo carga mostró `fechaHonduras` como la función propia más cara
  (cerca del 8 % del CPU): creaba un `Intl.DateTimeFormat` en cada llamada, y la emisión la llama varias veces.
- **Elegida:** el formateador se crea una vez, la primera vez que se usa. El resultado no cambia (mismas opciones,
  misma zona America/Tegucigalpa). El rendimiento en saturación subió de unos 107 a unos 124 documentos por segundo
  en el equipo de la medición.

### DEC-164 · El cliente no reintenta solo
- **Contexto:** el encargo pedía probar los reintentos de `@factura-hn/cliente` «si reintenta». No reintenta: lanza
  el error de `fetch` (corte de red) o `ErrorFacturaHN` (respuesta de error), y el integrador reintenta `emitir`
  con la misma `idempotencyKey`, como dicen su JSDoc y `docs/api.md`.
- **Elegida:** no agregar reintentos automáticos en este lote. Las pruebas fijan lo que ve el integrador en cada
  corte y que su reintento da un solo documento (respuesta perdida después de emitir, API inalcanzable, PostgreSQL
  reiniciado).
- **Propuesta para después:** una opción `reintentos` en `crearCliente` (desactivada por defecto, solo para
  `emitir` y los `GET`), con espera creciente que respete `Retry-After` en 429 y 503. Es compatible (opcional).

### DEC-165 · Cómo se reinicia PostgreSQL en las pruebas: un clúster desechable, también en el CI
- **Elegida:** `scripts/pg-temporal.mjs` crea un clúster con `initdb` y `pg_ctl` locales en `.pg-temporal/`
  (ignorada por git), en 127.0.0.1:55440, con `trust`, sin socket Unix y con `fsync=off` (solo pruebas). `pnpm
  resiliencia` lo crea, corre las pruebas con `FHN_PG_REINICIABLE=1` y lo borra al terminar, también si fallan.
  Sin esa variable, las pruebas que reinician se omiten: nunca se reinicia la base de `pnpm test:pg` ni el
  contenedor compartido.
- **Por qué no `docker restart` en el CI:** los runners `ubuntu-latest` traen PostgreSQL instalado
  (`/usr/lib/postgresql/<versión>/bin`), así que la misma prueba corre igual en Windows, en Linux y en el CI, sin
  un contenedor aparte. `FHN_PG_BIN` indica otra carpeta. Si un runner dejara de traerlo, el paso falla con un
  mensaje que lo dice.
- **Modos:** `pg_ctl stop -m fast` (cierra las sesiones con 57P01, como un reinicio ordenado) y `-m immediate`
  (como una caída: al arrancar, la base se recupera del WAL).

### DEC-166 · Medición de carga en dos fases, con umbrales holgados
- **Elegida:** `pnpm carga [ci|local|nocturno]` (perfiles en `packages/api/carga/perfiles.json`). La latencia se
  mide a tasa fija con un generador de lazo abierto (25 o 30 solicitudes por segundo, por debajo de la saturación);
  el rendimiento, con autocannon saturando la API. Con la API saturada la latencia solo mide la cola (ley de Little:
  conexiones / rendimiento), así que exigir un p99 ahí solo diría cuántas conexiones se usaron. El `overallRate` de
  autocannon no sirve para la fase fija: manda las solicitudes de cada segundo de golpe.
- **La API de la medición** (`carga/servidor.ts`) es la de producción con el límite por llave levantado (se mide
  la emisión, no el limitador) y en su propio proceso.
- **Umbrales:** p50 ≤ 100 ms, p95 ≤ 300 ms, p99 ≤ 600 ms a tasa fija; ≥ 40 documentos por segundo en saturación
  (≥ 30 en el perfil `ci`); 0 respuestas que no sean 201 en las dos fases y 0 errores de red a tasa fija; en
  saturación se toleran tiempos agotados y errores de red mientras la integridad se cumpla (una solicitud puede
  esperar más de 10 s en la cola de un runner cargado; la emisión que pudo pasar se cuenta contra la base); 0 duplicados, 0 huecos, una clave por documento y un número por clave; todos los avisos entregados.
  Unas 5 veces lo medido, porque los runners del CI son más lentos y variables que el equipo de la medición, y
  porque la base compartida de Docker en Windows rinde la mitad que una nativa. Todos los números medidos salen de
  un equipo Windows de 20 núcleos; el runner de GitHub tiene 4 vCPU que reparten la API, autocannon, PostgreSQL y
  el receptor. **Pendiente:** calibrar los umbrales del perfil `ci` con las primeras corridas en GitHub.
- **Pruebas sensibles a la carga del runner** (tras la revisión): la de receptor colgado exige que el pool nunca
  se agote (conexiones prestadas < `max`, no ≤ 1: dos pasadas pueden coincidir si la consulta tarda más de 100 ms)
  y compara medianas, no el p95 de 40 muestras.

### DEC-167 · Propuestas que no se hicieron (rendimiento, sin bugs)
- **Menos idas y vueltas por emisión:** una emisión hace 30 consultas en 4 transacciones (llave, idempotencia,
  emisor y la emisión). Juntar las tres primeras en una ahorraría 8 consultas. Toca `app.ts`, que otras ramas
  cambian a la vez: queda para un lote propio.
- **Entregas de webhooks más baratas:** cada entrega abre una conexión TCP nueva (la respuesta se destruye sin
  leerla, a propósito) y el resultado de un lote se escribe con un `UPDATE` por entrega. Con webhook, el rendimiento
  en saturación baja de unos 190 a unos 125 documentos por segundo. Un `UPDATE … FROM unnest(...)` por lote ayudaría.

### DEC-168 · Integración del Lote 5
- **Contexto:** cuatro ramas (`owasp`, `propiedades`, `mutacion`, `resiliencia`), cada una revisada por un agente
  que no la escribió y corregida antes de unirla.
- **Elegida:**
  - Un solo `nocturno.yml` con un trabajo por tema (propiedades, carga y resiliencia, mutación), a las 07:00 UTC
    (01:00 en Honduras) y a mano con `workflow_dispatch`.
  - «UN BILLÓN» lo corrigieron dos ramas por su cuenta (DEC-142 y DEC-158); queda la versión de
    `mutacion`, con el mismo resultado.
  - El 403 de `libro-ventas` (DEC-139) y las cabeceras de la especificación quedan una sola vez. `Retry-After` es
    obligatoria en los 429 y en el 503 `BASE_NO_DISPONIBLE`; `FacturaHN-Modo` sale también en los 429.
  - El validador del contrato acepta en `/v1` a secas lo mismo que en `/v1/*` antes de la ruta (401 sin llave):
    la prueba de inventario de OWASP lo pide.
  - `docs/calidad.md` reúne los cuatro informes y lo enlaza el README.
- **Alternativa:** unir las ramas sin revisión y corregir después; se descartó porque cada revisión encontró al
  menos un error real (500 con NUL, 503 que escondía errores de código, mutantes mal declarados equivalentes).

## Lote 6: revisión final y 0.3.0

Cinco revisiones independientes de `main` (fiscal, seguridad, paquetes, documentación y primeros 5
minutos) y cuatro ramas de correcciones, cada una de quien no hizo la revisión.

<!-- API y MCP (rama lote6/api) -->

### DEC-169 · JSON siempre con `charset=utf-8`
- **Contexto:** hallazgo 1. Windows PowerShell 5.1 (soportado en `docs/api.md`) decodifica como Latin-1 un
  `application/json` sin charset: «Café» llega como «CafÃ©».
- **Elegida:** el middleware `*` que ya pone `nosniff` y `no-store` reescribe, después de la ruta, todo
  `Content-Type: application/json` exacto a `application/json; charset=utf-8` (`TIPO_JSON`). Cubre errores, el 404,
  `/salud`, `/openapi.json` y el libro de ventas transmitido. Va en ese middleware y no en uno nuevo para no cambiar la
  lista de middlewares que vigila API9. El validador del contrato (`test/openapi-validador.ts`) rechaza ahora un JSON
  sin charset, así que toda respuesta que pasa por las pruebas lo comprueba.
- **Alternativa:** poner el tipo en cada `c.json`: se olvida en la ruta siguiente.

### DEC-170 · Confirmación por elicitación en `anular_documento` y `registrar_cai`
- **Contexto:** hallazgo 2. En modo API con llave admin, texto escrito por un cajero dentro de un documento podía
  llevar al modelo a anular o registrar un CAI.
- **Elegida:**
  - Antes de llamar al backend, el servidor pide `elicitation/create` (formulario con una casilla `confirmar`) con
    los datos exactos: número y motivo, o CAI, tipo, establecimiento, punto, rango, fechas y `ultimoEmitidoAntes`.
    Cada dato va en una línea, sin caracteres de control (un salto de línea en el motivo no agrega renglones falsos).
    Solo sigue con `accept` **y** la casilla marcada; `decline`, `cancel`, sin marcar o un error/tiempo agotado dan
    `CONFIRMACION_RECHAZADA` (con «No reintentes por tu cuenta»).
  - Anular consulta antes el documento: si no existe, `NO_ENCONTRADO` sin preguntar ni llamar a `anular`.
  - Cliente sin elicitación (`capabilities.elicitation.form` ausente): `CONFIRMACION_NO_DISPONIBLE` con su
    solución, salvo `FHN_MCP_PERMITIR_DESTRUCTIVAS=1` (opción `permitirDestructivas` de `crearServidorMCP`).
  - **Demo:** sin elicitación, anular un documento de prueba (`esDocumentoDePrueba`) y registrar un CAI ficticio
    (`esCAIDemo`) siguen sin la variable: no tienen valor fiscal y el «emite y anula una de prueba» del demo funciona
    en cualquier cliente. Con elicitación, el demo también pregunta (la ventana muestra «DOCUMENTO DE PRUEBA»): así
    el usuario ve en el demo lo mismo que verá con datos reales. Un CAI real nunca se registra sin confirmación ni
    variable, aunque la base sea de demo.
- **Alternativa:** confiar en la confirmación del cliente (`destructiveHint`): depende de cómo lo configure el
  usuario y el texto de un documento puede pedir que la apruebe.
- **Pendiente:** si los clientes populares no ofrecen elicitación, quien use datos reales necesitará la variable.

### DEC-171 · Errores de argumentos del MCP en español
- **Contexto:** hallazgo 3. Si el esquema Zod fallaba, el SDK respondía en inglés y sin `solucion`.
- **Elegida:** `crearServidorMCP` reemplaza `validateToolInput` **de su instancia** de `McpServer` (método privado
  del SDK 1.32.2, fijado exacto en `package.json`): valida con el mismo esquema (que la lista de herramientas sigue
  mostrando) y, si falla, devuelve un marcador que la herramienta convierte en `SOLICITUD_INVALIDA` con el formato
  de la casa (mensaje en español con la traducción de Zod que ya usa la API, «Qué hacer», «Guía»). Hay soluciones
  por campo (`idempotencyKey`, `numero`, `numeroOriginal`) en `soluciones.ts`. Si el SDK cambia el nombre del
  método, `crearServidorMCP` lanza al crear el servidor y las pruebas lo detectan.
- **Alternativa:** esquemas que acepten todo y validar en cada herramienta: la lista de herramientas perdería el
  esquema que el modelo necesita. Reemplazar el manejador de `tools/call` del `Server`: más superficie privada.

### DEC-172 · Node 22.13 en los caminos con SQLite del MCP
- **Contexto:** hallazgo 4. En Node < 22.13 `require('node:sqlite')` fallaba con el mensaje de Node.
- **Elegida:** `src/requisitos.ts`: al inicio de `cli.ts`, si el camino usa SQLite (servidor sin `FHN_API_URL`,
  `init`/`iniciar`, `registrar-cai` sin `--api-url` ni `FHN_API_URL`) y Node es anterior a 22.13, «Necesitas Node
  22.13 o más reciente (tienes X)…» y código 1. `ayuda` y el modo API no se frenan.

### DEC-173 · El modo local no crea ni atiende tenants de otros negocios
- **Contexto:** hallazgo 5. `tenant crear` no miraba `FHN_MODO`; un tenant creado así tenía webhooks del modo local
  (sin filtro de red interna) hasta el siguiente arranque, que se negaba.
- **Elegida:**
  - `tenant crear` con `FHN_MODO` `local` o sin definir se niega, antes de conectarse, para todo nombre que no sea
    reservado (los reservados, `local` y `demo`, siguen con su error de `crearTenant`). El mensaje,
    `errorTenantEnModoLocal`, sigue a `errorTenantsAjenos`: el modo local es de un solo negocio, arranca con
    `FHN_MODO=alojado` (y `FHN_CLAVE_CIFRADO`), y para el negocio propio `llave crear local --rol admin`.
  - Red de seguridad: `ConfigApi.soloTenantsLocales`. Con `modo: 'local'`, una llave de un tenant que no es `local`
    ni `demo` recibe 403 `TENANT_FUERA_DEL_MODO_LOCAL` (después de validar el secreto, sin cabeceras de modo).
    `arrancar` (servidor de `factura-hn-api` e imagen de Docker) lo activa; por defecto es `false` en `crearApp`,
    porque quien monta la app con sus propios tenants en modo local (las pruebas, unas 45 apps; el servidor de carga)
    no debe romperse. Toda operación de `/v1` declara ahora 403 en la especificación (compatible: solo agrega un
    estado); API5 se ajustó a eso.
- **Alternativa:** activarlo siempre en modo local: obligaba a cambiar la configuración de todas las pruebas y de
  quien embebe la app.

### DEC-174 · Un secreto de webhook ilegible falla solo su entrega
- **Contexto:** hallazgo 6. `o.cofre.leer(...)` fuera del `try`: un `gcm:` que no se descifra tumbaba el lote; las
  entregas que ya habían salido se repetían a los 5 minutos y la mala nunca llegaba a FALLIDA.
- **Elegida:** el secreto se descifra dentro de `entregar`; si falla, la entrega queda FALLIDA **en el acto**
  (`definitiva`, sin agotar los 22 intentos: reintentar con la misma clave da lo mismo) con
  `ERROR_SECRETO_ILEGIBLE` en `ultimo_error`. Además cada entrega del lote se atiende en su propio `try`: cualquier
  error inesperado la marca a ella («Error interno al entregar: …») y no al resto.

### DEC-175 · Webhooks de un tenant inactivo (esquema v9)
- **Contexto:** hallazgo 7. `fhn_api_tenants_con_pendientes()` ignoraba `api_tenants.activo`.
- **Elegida:** v9 del esquema de la API. La función pasa a plpgsql y, como `fhn_api_autenticar`, fija cada tenant
  solo para leer su fila de `api_tenants` (que fuerza RLS al dueño) y devuelve el valor anterior. Las entregas de un
  tenant inactivo se quedan PENDIENTE (no se borran ni fallan) y salen si se reactiva. Marca de la v9: el comentario
  de la función (`MARCA_PENDIENTES_V9`); `exigirEsquemaApi` la exige, porque el cuerpo nuevo no se nota en los
  privilegios.

### DEC-176 · Cupo de reportes por llave y cupo del proceso
- **Contexto:** hallazgo 8. Una llave de caja que leía despacio `libro-ventas` podía ocupar los dos cupos del tenant
  y dejar en 429 la exportación del admin. Con el pool por omisión de `pg` (10), el cupo del proceso (2) era igual al
  de un tenant.
- **Elegida:** `REPORTES_POR_LLAVE = 1` (`ConfigApi.reportesPorLlave`); la llave se toma primero y un 429 de la llave
  no toca los cupos del tenant ni del proceso. El cupo del proceso por omisión pasa de `floor(pool/4)` a
  `ceil(pool/4)`: con 10 son 3 (> 2 del tenant); con 20 (`FHN_POOL` por defecto) siguen siendo 5.
- **Alternativa:** bajar el cupo del tenant a 1 con pools chicos: el admin quedaba igual de bloqueado.

### DEC-177 · `IDEMPOTENCY_KEY` cuando falta la cabecera
- **Contexto:** hallazgos 9 y 14. Con `z.string()` en el esquema, sin la cabecera Zod respondía 400
  `SOLICITUD_INVALIDA` y no el `IDEMPOTENCY_KEY` documentado.
- **Elegida:** la cabecera es `z.string().optional()` en Zod para que el código responda `IDEMPOTENCY_KEY`, pero con
  `param: { required: true }` la especificación (y los tipos del cliente) la siguen declarando obligatoria: nada
  cambia para los clientes generados. La solución dice «Envía la cabecera `Idempotency-Key` con un valor único por
  venta (p. ej. el id del pedido…) y, si reintentas esa misma venta, reutiliza el mismo valor».
- **Sin `<…>` en las soluciones:** probado con la imagen de Docker, Windows PowerShell 5.1 borra de
  `ErrorDetails.Message` lo que parece una etiqueta: `Idempotency-Key: <un valor único por venta>` llegaba como
  `Idempotency-Key: ` y `Bearer fhn_live_<prefijo>_<secreto>` (en `NO_AUTENTICADO`, que ya existía) perdía la forma
  de la llave. Las dos soluciones se reescribieron sin `<…>` y las pruebas lo exigen. La descripción del esquema de
  seguridad en `/openapi.json` conserva `fhn_live_<prefijo>_<secreto>`: no es un mensaje de error.

### DEC-178 · La guía del 422 fuera de la emisión
- **Contexto:** hallazgo 17. `corregir-fecha` sin nada que corregir respondía con la solución genérica de
  `VALIDACION`, que dice «reintenta con la misma Idempotency-Key»; esa ruta no lleva la cabecera.
- **Elegida:** solo `POST /v1/documentos` usa esa solución; los demás 422 usan «Revisa `errores`… Corrige y
  reintenta.». El código y la forma no cambian.

### DEC-179 · Mensajes propios para los enteros con rango
- **Contexto:** hallazgo 18. «Demasiado grande: se esperaba que número fuera <=168».
- **Elegida:** `Entero(min, max?, { texto })` en `esquemas.ts`: «Debe ser un número entero de 0 a 168» (o «mayor o
  igual que N») para tipo, decimal y rango; un campo que falta conserva el mensaje de obligatorio. Se usa en
  `graciaHoras`, `limite`, `ancho`, `rangoInicial`, `rangoFinal` y `ultimoEmitidoAntes`. La especificación no cambia.

### DEC-180 · `trust` en el `docker-compose.yml`
- **Contexto:** hallazgo 10. `POSTGRES_HOST_AUTH_METHOD: trust` y `FHN_MIGRAR_URL` en el entorno de la API.
- **Elegida:** se mantiene `trust` y se documenta por qué (comentario del compose y «Producción» en `docs/api.md`):
  la base no publica puertos y solo la alcanzan los contenedores del proyecto; quien llega a ellos ya puede correr
  `docker compose exec` en el equipo, con o sin contraseña. Así «La primera factura» funciona sin crear nada. Con
  `trust`, sacar `FHN_MIGRAR_URL` del proceso no le quita el acceso como dueño, así que se queda; lo que protege es
  que la API atiende como `fhn_api` y cierra la conexión del dueño al terminar de migrar. Para equipos compartidos,
  el camino con contraseñas (`docker-compose.override.yml` + `.env`) ya está en `docs/autoalojamiento.md`.
  `.dockerignore` excluye `**/.env*` (salvo `.env.example`) y `docker-compose.override.yml`.
- **Alternativa:** contraseña por defecto en el compose: no protege más (está en el repositorio). Contraseña desde un
  `.env` obligatorio: rompe el `up --wait` sin pasos previos. Un servicio aparte para migrar: el arranque también
  prepara el modo local e imprime las llaves del demo con el dueño; era un cambio grande para nada con `trust`.
- **Propuesta:** si algún día el compose pasa a contraseñas por defecto, generar la del dueño en el primer arranque
  (un volumen con un archivo de secreto) y mover la migración a un servicio de una sola vez.

### DEC-181 · Carga nocturna: validar las llaves antes y cerrar sin cortar
- **Contexto:** hallazgo 13. El perfil nocturno (16 cajas × 2 llaves) mandaba 32 llaves nunca validadas a la vez
  desde una IP; pasada la ráfaga, 429 `DEMASIADOS_INTENTOS` (es la protección contra fuerza bruta). Después la API
  cerraba el pool con solicitudes en vuelo: «Cannot use a pool after calling end on the pool».
- **Elegida:**
  - `carga/emitir.ts` valida cada llave una vez con `GET /v1/sesion`, de a 4 (las `consultasSimultaneas`), antes del
    calentamiento. Medido: `pnpm carga nocturno duracionS=15 rafagas=20` cumple los umbrales.
  - `carga/servidor.ts` cierra en orden: deja de aceptar, cierra las conexiones ociosas, espera las solicitudes en
    curso y la pasada de webhooks, y solo entonces `pool.end()` (tope de 30 s, luego corta las conexiones).
  - **Producción: se mantiene el comportamiento** y se documenta en «Límites de solicitudes» de `docs/api.md`. Tras
    reiniciar, más de unas 20 cajas detrás de una NAT con la cola llena reciben un 429 corto con `Retry-After` y
    entran al reintentar; desde ahí no pasan por el límite. Relajarlo para prefijos registrados exigiría consultar la
    base antes de decidir, que es justo lo que el límite evita (API2 / API4). `pnpm calidad:owasp` no cambia.

<!-- Núcleo: notas, anulación y exportación (rama lote6/nucleo) -->

### DEC-182 · Un documento con notas vigentes no se anula (`DOCUMENTO_CON_NOTAS`) · [REVISAR]
- **Contexto:** la revisión final emitió una factura de L 100 + ISV 15, una nota de crédito total y luego anuló la
  factura: `anular` lo aceptó y `libroVentas` dio `total: -115` (la nota quedó viva sobre un original anulado). La
  regla inversa ya existe: no se emite una nota sobre un original anulado (`REFERENCIA_ANULADA`, DEC-004).
- **Elegida:** `anular` (y `corregirFechaAdelantada`, que pasa por el mismo camino) rechaza con **error**
  `DOCUMENTO_CON_NOTAS` un documento que no es nota (06/07) si tiene notas 06 o 07 no anuladas que lo refieren. El
  mensaje las enumera; la `solucion` dice que se anulen primero las notas. `YA_ANULADO` y `ANULACION_MOTIVO` se
  reportan antes. Base: Reglamento Art. 41 (anulación) y Art. 4 num. 32 (la nota respalda un ajuste sobre el
  «correspondiente» comprobante). **Regla derivada:** ningún artículo la dice palabra por palabra. Va en la consulta
  al SAR como **P-20**.
- **Concurrencia:** la búsqueda usa `tx.documentos({ desde, referencia })` dentro de la transacción de `anular`, con
  la serie del original bloqueada. Para que una nota simultánea no se cuele, `emitir` bloquea ahora la serie del
  original **antes de leerlo** al emitir una 06/07 (antes solo la 06, y después de leerlo). Orden de bloqueo: la
  serie de la nota y luego la del original, que nunca es una nota (`REFERENCIA_TIPO`): sin ciclos. Si el original
  no está en el almacén no se bloquea nada (no se crea una serie vacía para un original externo). La batería
  `ejecutarContratoAlmacen` tiene una prueba nueva (anulación con 06 y 07 vigentes, y anulación y nota a la vez:
  pasa una sola) que corre en memoria, SQLite y PostgreSQL. Los dos adaptadores ya filtraban por `referencia` con
  índice; el núcleo vuelve a filtrar.
- **Efecto en `corregirFechaAdelantada`:** si un documento adelantado tiene notas vigentes, la corrección falla con
  `DOCUMENTO_CON_NOTAS` y no anula nada (es una sola transacción): hay que anular antes las notas.
- **Alternativa:** anular en cascada las notas con el original (cambia documentos que el usuario no pidió anular), o
  permitirlo con un aviso (deja el libro en negativo).

### DEC-183 · DEC-051 ampliada: tope por tasa, original en USD por el camino de la nota y aviso de exoneración · [REVISAR]
Amplía DEC-051 (sigue [REVISAR]; va en la consulta al SAR como **P-16**).
- **Tope por tasa.** Una NC de L 180 al 15 % sobre un original de L 100 exento + L 100 al 15 % pasaba (L 207 ≤
  L 215) y acreditaba L 27 de ISV sobre L 15 cobrados. Ahora, además del total, la suma de las NC vigentes (del
  mismo modo), más la nueva, no puede superar a cada tasa (15 % y 18 %) el importe gravado **ni** el ISV del
  original. Mismo código `NOTA_SUPERA_ORIGINAL` (la solución no cambia), con un mensaje por tasa: lo del original
  y el saldo de gravado e ISV. Se informa un solo `NOTA_SUPERA_ORIGINAL`: el del total si se pasa el total; si no, el
  de la primera tasa que se pasa. Si ya hay `NOTA_TASA_DISTINTA` no se agrega el de la tasa (sería el mismo
  problema dos veces). Exento, gravado 0 % y exonerado no tienen tope propio: solo el total (ver el aviso abajo).
- **Redondeo:** el tope del ISV es estricto. Notas parciales cuyo ISV redondea hacia arriba pueden sumar un centavo
  más que el ISV del original (p. ej. original 0.06 al 18 %, ISV 0.01; dos notas de 0.03, ISV 0.01 cada una); la
  segunda se rechaza y su mensaje da el saldo (ISV L 0.00). El tope del total ya se comportaba así.
- **Original en USD.** El saldo se calculaba como total del original × tipo de cambio, pero la nota convierte cada
  precio a lempiras y recalcula: con tc 24.5 y 7 × USD 0.07 (USD 0.56 = L 13.72), la nota idéntica da L 13.81 y la
  devolución total se rechazaba. Ahora los totales del original en lempiras salen de pasar **sus propias líneas** por
  `notaEnLempiras` + `calcularCentavos`, con sus `preciosIncluyenISV` y su exoneración: una nota idéntica da
  exactamente los totales del original. En lempiras se usan los totales guardados (es lo mismo).
- **Aviso de exoneración.** Una NC sin `exoneracion` con líneas EXENTO sobre un original exonerado pasaba sin aviso, y
  el libro daba `importeExento -100` frente a `importeExonerado +100`. Ahora es el aviso (no error)
  `AVISO_NOTA_EXONERACION_DISTINTA`, con `solucion` propia en el problema (copiar la `exoneracion` del original, o
  quitarla de la nota), cuando el original es exonerado y la nota no, o al revés. Se decide por `exoneracion` del
  original y de la entrada. Base: Art. 4 num. 32 y Art. 11 num. 4; aviso del proyecto.
- **Alternativa:** tope solo del total (antes); o tope también por exento, gravado 0 % y exonerado (rechazaría el
  caso del aviso, que el encargo pide como aviso).

### DEC-184 · Preguntas al SAR que faltaban (P-16 a P-20)
- **Contexto:** DEC-050 y DEC-051 decían «va en la consulta al SAR» y no había pregunta; tampoco para DEC-068 ni
  DEC-079. La carta decía «las 14 consultas» con 15.
- **Elegida:** `docs/consulta-sar.md` agrega P-16 (tope de la NC y su tasa, incluye exoneración, USD y notas de
  débito), P-17 (libro de ventas en lempiras, DEC-050), P-18 (equivalente en lempiras, DEC-068), P-19 (nota con un
  RTN que el original no tiene, DEC-079) y P-20 (anulación con notas vigentes). La carta dice «las 20 consultas».
  `docs/normativa.md` y `docs/errores.md` citan la P-xx donde decían «en revisión» o «pendiente de confirmar».
- **Pendiente para el orquestador:** `docs/decisiones.md` (que esta rama no toca) puede enlazar DEC-050 → P-17,
  DEC-051 → P-16, DEC-068 → P-18 y DEC-079 → P-19.

### DEC-185 · Exportación versión 2: `tipoCambio` y `fechaAnulacion` al final
- **Contexto:** el CSV y el TXT de `exportarTexto` no llevaban el tipo de cambio ni la fecha de anulación.
- **Elegida:** dos columnas nuevas **al final** (`tipoCambio`, vacío en lempiras, como lo guarda el documento;
  `fechaAnulacion`, `YYYY-MM-DD` o vacío) y `VERSION_EXPORTACION = 2` (encabezado TXT `#factura-hn|v2|N`). Las 21
  columnas de la versión 1 no cambian de nombre ni de orden, así que un lector por nombre de columna, o que toma las
  21 primeras, sigue funcionando. `leerExportacionJSONL` no cambia (el JSONL lleva el documento completo). En el
  repositorio no hay lectores de CSV/TXT. Documentado en `docs/guia-sdk.md` §7 y en el JSDoc de `exportacion.ts`.
- **Fuera de esta rama:** `packages/api/test/reportes-acotados.test.ts` (líneas 207 y 275) espera
  `#factura-hn|v1|3`; `docs/api.md:357` y `web/src/content/docs/guias/reportes.md:91` mencionan la v1. Hay que
  cambiarlos a v2 donde se integre.

### DEC-186 · Menores del núcleo
- `estadoAutorizacion`: con `ultimo < rangoInicial` (serie que viene de un CAI anterior) el siguiente es
  `max(rangoInicial, ultimo + 1)`: no da más restantes que el rango ni un porcentaje usado negativo.
- `validarAutorizacion` con `caiEstricto`: no exige la forma 6-6-6-6-6-2 a un CAI ficticio (`esCAIDemo`), para que
  `crearFacturadorDemo({ caiEstricto: true })` funcione. Sigue siendo de prueba; un CAI real mal formado sigue
  siendo `CAI_FORMATO`.
- HTML: «G0 = gravado 0%» en la leyenda solo con líneas `GRAVADO0`, como el ticket. Un documento sin esas líneas se
  imprime con los mismos bytes; uno con ellas, guardado antes, se reimprime con la leyenda nueva.
- `npx factura-hn init`: `emitir.mjs` dice (en un comentario y en la salida) que cada corrida empieza en 00000001
  porque el almacén es en memoria; un `emisor.json` que no es JSON da un mensaje en español que lo nombra y dice
  cómo arreglarlo (comillas, comas, llaves, o `init --forzar`), con código 1.
- `docs/errores.md`: cada `### CODIGO` tiene «Solución» o «Qué hacer» (prueba nueva en `lote2-errores.test.ts`);
  `AUTORIZACION_DEMO_SIN_PRUEBA` queda como nota para los enlaces viejos; entradas del MCP `API_INACCESIBLE`,
  `BASE_DEMO` y `CAI_DEMO` (la prueba de códigos del MCP ahora también reconoce `errorDe('…')`).

<!-- Paquetes, versión y CI (rama lote6/paquetes) -->

### DEC-187 · Una sola versión: VERSION_API sale de packages/api/package.json y `pnpm run version` la sube
- **Contexto:** `VERSION_API` estaba escrita a mano (`'0.2.0'`) y `@factura-hn/api` está en el `ignore` de
  changesets: la API, `openapi.json` y el sitio se quedaban en 0.2.0 después de cada versión.
- **Decisión:** `app.ts` importa `version` de `../package.json` (tsup la incrusta; solo ese campo llega al bundle,
  también al de Docker). El script `version` de la raíz corre `changeset version` y luego
  `scripts/fijar-versiones.mjs` (antes `fijar-version-mcp.mjs`), que comprueba que los seis publicables comparten
  versión y la copia a `packages/api/package.json`, a `info.version` de `packages/api/openapi.json`, a los bloques
  `@factura-hn/mcp@X.Y.Z` del README, de `packages/mcp/README.md` y de `web/src/content/docs/ia/mcp.md`.
  `verificar-dist` falla si la API o `openapi.json` no tienen la versión de los paquetes. La prueba de
  `packages/mcp/test/comandos.test.ts` que compara los README con `package.json` cubre también la página del sitio.
- **Por qué no quitar la API del `ignore`:** changesets la subiría como dependiente (parche, 0.2.1) o habría que
  meterla en el grupo `fixed`, que es de paquetes de npm. La API es privada; basta con copiar la versión.

### DEC-188 · CHANGELOG por paquete en npm y sección enlazada en el de la raíz
- **Decisión:** los seis paquetes publican `CHANGELOG.md` (en `files`; `verificar-dist` lo exige). Cada uno ya
  existe en el repositorio con el título y una sección final «0.2.0 y anteriores» que enlaza (URL absoluta) al
  `CHANGELOG.md` de la raíz; `changeset version` escribe cada versión nueva arriba de esa sección. El `CHANGELOG.md`
  de la raíz conserva la historia hasta la 0.2.0 y, desde la 0.3.0, `fijar-versiones.mjs` le agrega una sección
  `## X.Y.Z — fecha` (hoy en Honduras, o `--fecha`) con un enlace al CHANGELOG de cada paquete; si ya existe, no la
  toca.
- **Por qué enlazar y no copiar:** los seis changelogs repiten las entradas compartidas y las «Updated
  dependencies»; copiarlos daría seis veces el mismo texto.
- **Comprobado:** `pnpm run version` en la rama da 0.3.0 en los seis, la API y `openapi.json`, la sección de la
  raíz y los changelogs por paquete; `verificar-dist` pasó con ese estado. Después se descartó (`git checkout .`).

### DEC-189 · «Cambios incompatibles» en negrita dentro del changeset, no como título
- **Contexto:** changesets pone cada changeset como un elemento de lista bajo `### Minor Changes`; un
  `## Cambios incompatibles` dentro quedaba como título de nivel 2 adentro de una lista de nivel 3.
- **Decisión:** `**Cambios incompatibles:**` y `**Nota de migración desde la 0.2.0:**` en negrita. Lo explica
  `.changeset/README.md`, junto con la regla de que cada changeset describe el cambio neto desde la última versión
  publicada.

### DEC-190 · Changesets corregidos
- `lote2-integracion` se separa en `lote2-integracion-nucleo` (factura-hn), `lote2-integracion-api` (cliente; la
  API no se publica y sus cambios van con el cliente, como en los demás) y `lote2-integracion-mcp`. Ya no nombra
  `AUTORIZACION_DEMO_SIN_PRUEBA` ni el 422 fuera de `demo`: remite a `lote4-llaves-modos` para qué CAI acepta cada
  tenant.
- Se borra `lote5-mutacion-letras` (es el primer punto de `lote5-propiedades-nucleo`).
- `lote4-pendientes-nucleo`: la revisión del emisor pasa a «Cambios incompatibles».
- `lote4-contrato-api` sube a `minor` y declara como incompatible que los tipos de los `GET` ya no traen el 422.
  `lote2-integracion-api` declara `EstadoAutorizacion.retirada` obligatorio (nuevo desde la 0.2.0).
- `mcp-init-demo-registrar-cai`: `Backend.libroVentas` debe devolver `excluidos`.
- `nucleo-cinco-minutos` decía que un punto «no mezcla CAI de prueba y reales»; ahora dice lo que hace el código:
  pasa de prueba a real, nunca al revés.
- Nuevos: `lote6-exportaciones-nucleo` (ver abajo), `lote6-node-20` y `lote6-paquetes`.

### DEC-191 · Exportaciones nuevas del núcleo: todas públicas, `autorizacionesActivas` marcada de bajo nivel
- **Decisión:** el changeset nombra `esDocumentoDePrueba` y `esAutorizacionDePrueba` (las usan el README, `llms.txt`
  y el sitio, y `verificar-dist` las promete), `SOLUCIONES`, `conSolucion`, `enlaceError` y `URL_ERRORES` (las
  importa `@factura-hn/mcp`, que se publica: no pueden ser internas) y `autorizacionesActivas`, que solo usa la API
  privada: el changeset dice que es de bajo nivel y puede cambiar en 0.x.
- **Propuesta (fuera de esta rama, `packages/core/src`):** marcar `autorizacionesActivas` con `@internal` o
  sacarla del índice hacia un submódulo interno. `enlaceError` y `SOLUCIONES` no aparecen en la documentación
  pública: si se quieren públicas, `docs/guia-sdk.md` debería nombrarlas.

### DEC-192 · Node 20 como piso y en la CI
- **Decisión:** `engines.node` `>=20` en factura-hn, sqlite, postgres, pdf y la raíz (cliente ya pedía `>=20` y
  mcp `>=22.13`). Changeset `lote6-node-20` en «Cambios incompatibles». README y sitio dicen Node 20 (también
  `docs/guia-sdk.md`, que viaja en el paquete). `verificar-dist` falla si un publicable pide menos de Node 20.
- **CI:** la matriz del trabajo «Tipos, pruebas, build, dist y documentación» es `[20, 22, 24]`. En Node 20 corren
  la instalación, la auditoría, el build, los tipos, `pnpm test` sin `@factura-hn/sqlite` ni `@factura-hn/mcp` (sus
  pruebas cargan `node:sqlite`) y el humo `sdk demo`. Quedan solo en 22 y 24: los ejemplos (POS con
  `node:sqlite`), `verificar-dist` (carga el MCP), el humo del MCP, OpenAPI/Redocly, Next.js y el playground, y el
  sitio (Astro pide Node 22). `docs/lanzamiento.md` agrega el check «(Node 20)» a la protección de `main`.
- **Sin comprobar aquí:** no hay Node 20 en este equipo y no se instaló. Revisé a mano que `packages/{core,sqlite,
  postgres,pdf,cliente}/src` no usan APIs posteriores a Node 20. La primera corrida de la CI lo confirma.
- **Pendiente:** `@factura-hn/sqlite` con `better-sqlite3` en Node 20 no tiene prueba (no es dependencia de
  desarrollo). Una prueba con `better-sqlite3` en Node 20 pediría agregarla.

### DEC-193 · release.yml en tres trabajos; changesets/action v2 con sus entradas nuevas
- **Hallazgo:** changesets/action v2.1.2 renombró `version`, `publish`, `title` y `commit` (a `version-script`,
  `publish-script`, `pr-title`, `commit-message`) y falla si recibe las viejas: el flujo de antes no habría
  abierto el PR. Además ya no lee «New tag:» de la salida: espera eventos `git-tag` en el archivo
  `CHANGESETS_OUTPUT`; sin ellos no crea etiquetas ni releases.
- **Decisión:** `publicar.mjs` escribe esos eventos y gana `--pendientes` (dice si alguna versión falta en npm y lo
  deja en `$GITHUB_OUTPUT`). `release.yml` tiene tres trabajos, todos solo en `main` con `PUBLICAR_NPM`:
  `verificar` (solo lectura: instala, compila, prueba, guarda `packages/*/dist` y calcula los pendientes),
  `version` (contents y pull-requests de escritura; changesets/action sin publish-script) y `publicar` (entorno
  `npm`, `id-token` y `contents: write`; corre solo sin changesets y con algo pendiente; no instala dependencias:
  baja los `dist/` y empaqueta con `pnpm pack`, comprobado sin `node_modules`). Checkout sin credenciales en los
  tres: changesets/action v2 sube el commit y las etiquetas con la API de GitHub.
- **Procedencia:** `NPM_CONFIG_PROVENANCE: 'true'` en el paso que publica, no en `publishConfig`.
- **npm:** en lugar de `npm install -g npm@11.6.2`, el trabajo `publicar` fija Node `24.22.3`, cuyo npm (11.19.1,
  según nodejs.org/dist/index.json) viene en la misma descarga y supera el mínimo 11.5.1. El `npm install -g`
  de antes de hecho bajaba npm (Node 24 ya trae 11.19).
- **Aprobación:** antes, `environment: npm` estaba en el único trabajo: cada push a `main` esperaba la aprobación,
  también los que solo actualizaban el PR. Ahora solo el trabajo `publicar`.
- **PR de versión sin CI:** GitHub no dispara flujos por eventos del `GITHUB_TOKEN`. `docs/lanzamiento.md` dice
  cómo correr el CI sobre `changeset-release/main` (`gh workflow run ci.yml --ref …`).
- **Sin comprobar:** el flujo no corrió (no hay push). La sintaxis YAML se validó; actionlint no está instalado.

### DEC-194 · Dependencias de @factura-hn/mcp
- **`workspace:^` en lugar de `workspace:*`:** con el grupo `fixed` los seis salen siempre juntos, pero `*` publica
  una versión exacta (`0.3.0`): quien tenga `factura-hn@0.3.1` y el MCP 0.3.0 instalaría dos núcleos. `^0.3.0`
  acepta los parches de la misma menor (en 0.x, `^` no cruza de menor), que changesets sube juntos.
- **`devDependencies` con `@factura-hn/api` (privada) en cliente y mcp:** el manifiesto publicado lleva
  `"@factura-hn/api": "0.3.0"`. npm y pnpm no instalan las `devDependencies` de un paquete instalado, y el scope
  `@factura-hn` es de la organización (nadie más publica ahí): no afecta a quien instala. Se deja.
- **`@types/node`:** el `.d.ts` del MCP usa `NodeJS.ProcessEnv` y `NodeJS.Platform`. Se declara
  `@types/node >=22` como dependencia par opcional. Lo limpio es que `packages/mcp/src/comandos.ts` use tipos
  propios (`Record<string, string | undefined>` y `string`): queda propuesto para quien tiene `packages/mcp/src`.

### DEC-195 · `dist/cli.js` del núcleo importa `./index.js` y `./demo.js`
- **Decisión:** `packages/core/tsup.cli.config.ts` compila `src/cli.ts` con un plugin de esbuild que reescribe sus
  imports relativos a `./demo.js` (los de `./demo`) y `./index.js` (los demás), externos. Sin tocar `src`. De
  108 KB a 8 KB; `npx factura-hn --help`, `demo` e `init` probados desde el tarball. Si `cli.ts` importa algo que
  el índice no exporta, la verificación de dist y el humo fallan al arrancar.

### DEC-196 · `typesVersions` y `./package.json`
- `factura-hn` declara `typesVersions` para `demo` y `pruebas`: con `moduleResolution: node10` daban TS2307
  (reproducido y corregido en un consumidor de prueba; node16 y bundler siguen bien).
- Los seis exportan `./package.json`.

<!-- Documentación y sitio (rama lote6/docs) -->

### DEC-197 · Los tramos protegidos de la reescritura de enlaces se restauran en bucle
- **Contexto:** `fueraDeCodigo` (`web/scripts/lib/enlaces-md.mjs`) cambia los comentarios HTML y el código en
  línea por marcas `\u0000N\u0000` y las restauraba en una sola pasada. Cuando un código en línea abarcaba un
  comentario ya marcado, la marca interna quedaba en el sitio: 18 NUL en `llms-full.txt` y
  `referencia/decisiones.md`, y la marca `\uFFFD1\uFFFD` (U+FFFD, carácter de reemplazo) en la página de decisiones (los comentarios `<!-- … (rama loteN/…) -->` de
  `docs/decisiones.md`).
- **Elegida:** restaurar hasta que no quede ninguna marca (cada pasada solo puede sacar marcas de índice menor,
  así que el bucle termina). Prueba en `web/scripts/enlaces.test.mjs`, que falla sin el arreglo.
- **Verificación:** `web/scripts/verificar.mjs` falla si un `.md`, `.html` o `llms*.txt` generado contiene U+0000
  o U+FFFD.

### DEC-198 · Primera factura con la API: el paso 3 se detiene si el paso 2 no emitió
- **Contexto:** sin `PDF`, `curl -o factura.pdf "$API$PDF"` pide la raíz de la API y deja un `factura.pdf` vacío
  sin error.
- **Elegida:** `"$API${PDF:?el paso 2 no emitió: revisa su salida}"` en README, portada y
  `empezar/primera-factura.md`; la portada copia además el `if … Emitida/No se emitió` del paso 2 del README.
  `verificar.mjs` ya exige que cada comando de la portada esté en el README.

### DEC-199 · Cuatro caminos, y la venta del ejemplo de la API se dice tal cual
- **Elegida:** README y portada dicen «Los cuatro» (SDK, API, MCP, Next.js); la portada gana la pestaña Next.js
  con los pasos resumidos y el enlace al código en `/empezar/primera-factura/#nextjs`. «conforme al Acuerdo»
  pasa a «según el Acuerdo» en la portada (descripción y lema) y en la descripción del sitio
  (`astro.config.mjs`).
- **Venta de la API:** `packages/api/ejemplos/factura.json` vende 2 × L 57.50 (total L 115.00), no 2 × L 115.00.
  No es de esta rama: los textos dicen la verdad del JSON. Propuesta: cambiar el JSON a `"115.00"` para que los
  cuatro caminos emitan la misma venta, y entonces quitar la nota.

### DEC-200 · Ejemplo Next.js: la llave sale de `demo llave --solo-llave`
- **Elegida:** README del ejemplo con `docker compose up -d --build --wait` y
  `FHN_LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)` (y la variante de PowerShell).
  Los errores de `lib/fhn.ts` y `lib/enlaces.ts` dicen el comando que crea cada variable. Prueba nueva en
  `examples/nextjs/test/nextjs.test.ts`.

### DEC-201 · Los README de `sqlite`, `postgres`, `pdf` y `cliente` entran en la prueba de fragmentos
- **Elegida:** `packages/core/test/readme.test.ts` compila también los bloques ```ts de esos README. Las variables
  del integrador (`entrada`, `cai`, `documento`) van en el comentario `<!-- declaraciones: … -->` (invisible en
  npm) y un comentario en el código dice qué son. El README de SQLite usa `node:sqlite` en el código y deja
  `better-sqlite3` en el comentario: no hay tipos de `better-sqlite3` en el repositorio.

### DEC-202 · Los DEC citados en la prosa del sitio enlazan su ancla
- **Elegida:** `[DEC-0NN](/referencia/decisiones/#dec-0nn--título…)`, con el id que genera el sitio (incluye el
  título y el estado). Si cambia el título de una decisión, el ancla cambia y `pnpm sitio` falla: es lo buscado.

### DEC-203 · Integración del Lote 6 y versión 0.3.0
- **Contexto:** las cuatro ramas de correcciones tocan archivos distintos; `nucleo` cambió dos comportamientos que
  pruebas de otros paquetes daban por hechos.
- **Elegida:**
  - Las pruebas del MCP anulan primero la nota de crédito y comprueban que el original con nota vigente da
    `DOCUMENTO_CON_NOTAS`. Las de reportes de la API esperan el encabezado `#factura-hn|v2|N`.
  - `docs/errores.md` une las entradas de `nucleo` y de `api` (una sola `IDEMPOTENCY_KEY`, la sección del MCP con
    todos sus códigos).
  - DEC-050, DEC-051, DEC-068 y DEC-079 citan sus preguntas P-16 a P-19; DEC-140 y DEC-152 citan el Reglamento
    (Acuerdo 481-2017), no otro acuerdo.
  - La versión 0.3.0 sale de `pnpm run version` (changesets y `scripts/fijar-versiones.mjs`).
  - `scripts/auditar-datos.mjs` no toma por RTN un importe con decimales (`8695652173913.00` en las pruebas del
    tope técnico): el patrón de 13 o 14 dígitos excluye los que siguen con `.` y un dígito.
  - Tras la revisión independiente de la rama integrada:
    - `docs/errores.md` y `docs/normativa.md` viajan en el paquete `factura-hn`. Citan la consulta al SAR por la URL
      del sitio, sin número de pregunta ni de decisión.
    - `packages/api/CHANGELOG.md` existe y `fijar-versiones.mjs` le agrega cada versión, porque changesets/action
      lee el CHANGELOG de todo paquete cuya versión cambió.
    - Los CHANGELOG de `cliente` y `mcp` y el de la raíz (que el sitio muestra en «Cambios») resumen los cambios
      incompatibles de la API y del MCP. Se quitaron los hashes de commits de la rama, que no existirán en `main`
      tras el squash.
    - La batería `ejecutarContratoAlmacen` prueba el tope por tasa con notas previas guardadas (SQLite y
      PostgreSQL).
    - Las pruebas de webhooks programan el reintento 1 s en el pasado: el reloj de Node y el de PostgreSQL pueden
      diferir unos milisegundos.
- **Alternativa:** dejar las pruebas viejas con la regla nueva desactivada en el MCP; se descartó porque el MCP usa
  el mismo núcleo y debe comportarse igual.
