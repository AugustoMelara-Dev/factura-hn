# Changelog

## 0.3.0 — 2026-11-25

El detalle de esta versión está en el CHANGELOG de cada paquete (viaja también dentro de cada paquete de npm).
Los seis comparten número de versión. Busca primero «Cambios incompatibles» en cada uno.

- [`factura-hn`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/core/CHANGELOG.md#030)
- [`@factura-hn/pdf`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/pdf/CHANGELOG.md#030)
- [`@factura-hn/postgres`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/postgres/CHANGELOG.md#030)
- [`@factura-hn/sqlite`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/sqlite/CHANGELOG.md#030)
- [`@factura-hn/cliente`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/cliente/CHANGELOG.md#030)
- [`@factura-hn/mcp`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/mcp/CHANGELOG.md#030)

La API REST (`@factura-hn/api`, no se publica en npm) sigue la misma versión: sus cambios van en el CHANGELOG
de `@factura-hn/cliente`.

### Cambios incompatibles (resumen)

- **Node 20** o más reciente en todos los paquetes.
- **Anulación:** un documento con notas vigentes no se anula (`DOCUMENTO_CON_NOTAS`), ni en el SDK, ni en la API,
  ni en el MCP. Primero se anulan las notas.
- **Notas de crédito:** el tope se aplica también a cada tasa (gravado e ISV), no solo al total
  (`NOTA_SUPERA_ORIGINAL`).
- **Exportación versión 2:** CSV y TXT con dos columnas más al final (`tipoCambio` y `fechaAnulacion`) y el
  encabezado TXT `#factura-hn|v2|N`.
- **Reportes sin documentos de prueba:** `exportarTexto` y `libroVentas` (y sus rutas en la API y el MCP) dejan
  fuera los documentos de prueba.
- **API:** `IDEMPOTENCY_KEY` cuando falta la cabecera; en modo local, 403 `TENANT_FUERA_DEL_MODO_LOCAL` para otros
  tenants.
- **MCP:** `anular_documento` y `registrar_cai` piden confirmación por elicitación sobre datos reales
  (`CONFIRMACION_NO_DISPONIBLE` sin ella, salvo `FHN_MCP_PERMITIR_DESTRUCTIVAS=1`).

## 0.2.0 — 2026-11-24

Se cubren los requisitos pendientes de la matriz de cumplimiento (`docs/cumplimiento.md`). Mientras la versión sea 0.x, los cambios incompatibles
van en versión menor (SemVer §4). La regla de versión mayor rige desde la 1.0.0.

### Cambios incompatibles

- **Un solo camino para emitir y anular.** Se eliminan `crearDocumento`, `AlmacenCorrelativos`,
  `AlmacenMemoria` y `RangoAgotadoError` (llevaban el correlativo por CAI y no guardaban el documento en la
  misma transacción). `construirDocumento` y `anularDocumento` dejan de exportarse. Usa
  `registrarAutorizacion`, `emitir` y `anular` sobre un `AlmacenFiscal`. La 0.1.0 no se publicó en npm.

- **Dinero sin punto flotante.** Cantidad, precio unitario, descuento, tipo de cambio y umbral aceptan
  `number | string` (se recomienda texto: `"19.99"`). Un `number` se lee por su texto decimal exacto. Si trae
  más decimales de los permitidos (cantidad y precio: 4; descuento: 2; tipo de cambio: 6), se rechaza en lugar
  de redondearse: `0.1 + 0.2` como precio da `LINEA_PRECIO`. Antes el precio se redondeaba a centavos en silencio.
  En texto, la coma solo separa miles en grupos de 3 (`"1,234.50"`): `"89,50"` da `ErrorMonto`. Antes se leía
  como 8950, un monto 100 veces mayor, sin ningún aviso.
- **ISV estatutario con precios con ISV incluido (Ley del ISV, Art. 9).** El ISV impreso es siempre la tasa × la base
  impresa con el redondeo del Art. 9 de la Ley del ISV. Antes se calculaba por diferencia y quedaba 1 centavo
  por encima de la regla en el 4.35 % (15 %) y el 6.78 % (18 %) de los montos. Cuando un precio no tiene base
  exacta, el total queda 1 centavo **por debajo** del precio (nunca por encima), con
  `totales.ajustePorRedondeo` y el aviso `AVISO_AJUSTE_CENTAVO`. El POS debe cobrar `totales.total`.
- **No se puede retrofechar.** La fecha de emisión la pone el reloj (`opciones.reloj`, por defecto
  `() => new Date()`) en America/Tegucigalpa. Una `fechaEmision` distinta de hoy en Honduras es el error
  `FECHA_EMISION_NO_ES_HOY` (Reglamento Arts. 14 y 43).
- **Documentos inmutables.** `emitir` y `anular` devuelven el documento congelado en
  profundidad (`Object.freeze`) y con `estado: 'EMITIDO'`. Si tu código modificaba el documento, copia antes.

- **Datos del emisor obligatorios (Art. 10 num. 1).** `nombreComercial`, `direccionEstablecimiento`,
  `telefono` y `correo` pasan a ser obligatorios en `Emisor` (errores `EMISOR_*`). Desaparece el aviso
  `AVISO_EMISOR_CONTACTO`.
- **Exoneración (Art. 11 num. 4).** Los tres campos de `Exoneracion` son opcionales: se exige OCE y
  constancia, o solo `registroSAG` (RUPNSA).
- `filaLibroVentas(doc)` ya no recibe `{ anulado }`: el estado sale del documento. El CSV del libro agrega la
  columna «Gravado 0%».
- **Notas de crédito.** Con el original en el almacén, `emitir` rechaza `NOTA_SUPERA_ORIGINAL` (la suma de las
  notas de crédito vigentes supera su total; el mensaje trae el saldo) y `NOTA_TASA_DISTINTA`. En la API, una NC
  sobre un original externo requiere llave admin (403 `SOLO_ADMIN` con llave de caja). `FiltroDocumentos` acepta
  `tipoDocumento` y `referencia` (opcionales para adaptadores propios: el núcleo vuelve a filtrar).
- **Libro de ventas en lempiras.** El ISV se declara en lempiras; cada documento se convierte con el tipo de cambio
  que imprime (Art. 11, párrafo final). El Reglamento no fija el formato del libro: es la lectura que aplica
  factura-hn. `filaLibroVentas` convierte los documentos en moneda extranjera con
  su tipo de cambio y agrega `moneda`, `tipoCambio` y `totalMonedaOriginal`. El CSV suma tres columnas al final.
  Antes `resumenVentas` sumaba dólares como lempiras.
- `TIPO_NO_EMITIBLE` (en lugar de `TIPO_NO_SOPORTADO`) para 04, 09, 10 y 12, también al registrar la
  autorización (Arts. 4 num. 43, 46 y 47).

- **CAI:** desaparece `CAI_FORMATO_ADVERTENCIA`. Por defecto el CAI solo debe tener letras, dígitos
  y guiones entre grupos (Art. 4 num. 7: «serie alfanumérica»); el patrón 6-6-6-6-6-2 se exige solo con
  `caiEstricto: true`, como error `CAI_FORMATO`.

### Agregado

- **Operador en la bitácora.** Apoya los controles de auditoría del Art. 53 num. 2; el operador es opcional y no
  lo exige el Reglamento.
  - `emitir`, `anular`, `corregirFechaAdelantada` y `registrarAutorizacion` aceptan `operador` (p. ej. el
    cajero). Queda en `EventoAuditoria.operador`.
  - Cada emisión deja un evento `DOCUMENTO_EMITIDO`.
  - `DocumentoEntrada.operador` lo imprime como «Atendido por».
  - En la API: campo `operador` o cabecera `X-Operador`, e `imprimirOperador`. El actor es ahora
    `llave:<id> (<rol>: <nombre>)`, con el id interno de la llave (`GET /v1/llaves` lo devuelve). Esquema de la
    API v3.
  - El cliente acepta `operador`; el MCP acepta `FHN_OPERADOR` y el parámetro `operador`.

- **`@factura-hn/api`** (privado, 0.2.0): API REST con Hono y OpenAPI 3.1 sobre Postgres. Modos local
  (Art. 47) y alojado multi-tenant con RLS; llaves con roles caja/admin; `Idempotency-Key`; límites por llave
  y por mes; webhooks firmados con HMAC y reintentos; PDF/HTML/TXT, libro de ventas, exportación y bitácora.
  Rechaza cuerpos que no son UTF-8 válido (`CUERPO_NO_UTF8`) y sigue en pie si Postgres se reinicia.
  Cada recurso va envuelto con su nombre y cada lista es `{ <plural>, hayMas, siguiente }`; documentos y
  bitácora se paginan con `limite` y `cursor`. Montos de salida en lempiras con 2 decimales.
  `docker compose up --build` levanta API + Postgres con datos de demostración. Ver `docs/api.md`.
- **`@factura-hn/cliente`** (0.2.0): cliente tipado de la API generado desde OpenAPI (`openapi-fetch`), con
  `emitir` (idempotente), `descargar` (PDF/HTML/TXT), `anular`, `documentos` (recorre las páginas) y
  `paginaDocumentos`, CAI, libro, exportación, `ErrorFacturaHN` y
  `verificarFirmaWebhook` con Web Crypto (Node 20+, edge, navegador).
- **`@factura-hn/mcp`** (0.2.0): servidor MCP con `emitir_factura`, `emitir_nota_credito`,
  `consultar_documento`, `anular_documento`, `estado_cai` y `libro_ventas`, vía la API o el SDK local sobre
  SQLite (claves de idempotencia en la base, dentro de la transacción).
- Ejemplos: POS fuera de línea (SQLite), Express 5, Next.js 16 (server action) y playground en el navegador.
- AGENTS.md, llms.txt y la skill: prompts de una línea para el SDK y para la API, comprobados por prueba.
- `textoSeguroCSV`: `libroVentasCSV` y `exportarTexto(…, { formato: 'csv' })` anteponen `'` al texto que
  empieza con `= + - @` (inyección de fórmulas en hojas de cálculo).
- Notas sobre facturas en moneda extranjera (Arts. 26 num. 9 y 28 num. 8, moneda nacional): se emiten en lempiras con el tipo de cambio del
  original, que se imprime como referencia (`referencia.moneda`, `referencia.tipoCambio`).
- CAI (Art. 4 num. 7, «serie alfanumérica»): se aceptan letras, dígitos y guiones; los espacios del borde se recortan sin error.
- Correcciones: `noUtilizadosDelAlmacen` reporta los números saltados de una
  autorización vencida aunque la serie siga en la siguiente; las autorizaciones registradas no se editan y
  al anular el contenido del documento no cambia (disparadores en SQLite y Postgres); `CLIENTE_NOMBRE` ya no
  sale duplicado en notas.
- `AutorizacionCAI.fechaAutorizacion` (opcional) y el aviso `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62); los avisos
  de la autorización quedan en el evento `AUTORIZACION_REGISTRADA` de la bitácora.
- Paquetes compilados con tipos separados para ESM (`.d.ts`) y CJS (`.d.cts`); `pnpm verificar:dist` carga
  cada paquete por `import` y por `require`.
- Matriz de cumplimiento con una prueba por fila (`docs/cumplimiento.md`, `test/matriz.test.ts`).
- **`@factura-hn/pdf`:** `renderizarPDF(doc, { formato: 'carta' | 'ticket' })` con pdf-lib, sin navegador;
  leyenda y marca de agua ANULADA; salida determinista.
- **Exportación a texto (Art. 53 num. 5):** `exportarTexto` en `jsonl` (sin pérdida, con
  `leerExportacionJSONL`), `csv` y `txt`; importes escritos desde centavos.
- **Integración contable (Art. 53 num. 1):** interfaz `LibroContable`, que corre dentro de la transacción de
  `emitir`, `anular` y `corregirFechaAdelantada`; si falla, se revierte y el número no se consume.
- **Documentos no utilizados (Art. 42):** `documentosNoUtilizados` y `noUtilizadosDelAlmacen` devuelven
  los rangos sin usar, la causal (numerales 1 a 12) y la fecha límite del aviso (décimo día hábil del mes
  siguiente; feriados opcionales).
- `estadoAutorizacion` avisa la renovación desde dos meses de calendario antes de la fecha límite (antes 30
  días), según el Art. 59.
- **Gravado 0 % (Arts. 11 y 12):** `isv: 'GRAVADO0'` y `totales.importeGravado0`, discriminado en
  render y libro.
- **Crédito fiscal (Art. 11 num. 3):** `totales.baseCreditoFiscal` y el aviso `AVISO_VENTA_MIXTA` cuando
  el comprador tiene RTN.
- **Coherencia de notas (Arts. 26 num. 3 y 28 num. 3):** la NC solo sobre Comprobantes Fiscales (Art. 6) y nunca con fecha anterior
  al original. Dentro de `emitir`, contra el almacén: el original debe existir, no estar ANULADO y coincidir en
  CAI, fecha y RTN (`REFERENCIA_*`). Si no está en el almacén (talonario, otro sistema, antes de la migración), `AVISO_ORIGINAL_EXTERNO`: no hay con qué comparar, así que es aviso y no error (decisión de diseño de factura-hn). `AutorizacionCAI.ultimoEmitidoAntes` para migrar una serie existente.

- `parsearDecimal`, `redondearDecimal`, `dividirRedondeando`, `centavosATexto`, `escaladoATexto`, `ErrorMonto`,
  `centavosEnLetras`, `calcularCentavos` (totales en `bigint`), `impuestoArt9`.
- **`AlmacenFiscal` y emisión atómica.** `emitir(entrada, { almacen, establecimiento,
  puntoEmision })` bloquea la serie del identificador `NNN-NNN-TT`, elige la autorización vigente que cubre el
  siguiente número (la numeración continúa de un CAI al siguiente; los números de un CAI vencido se saltan y
  nunca se emiten), valida, construye y guarda en una sola transacción. Si algo falla, el número no se consume.
  `registrarAutorizacion` rechaza rangos solapados y CAI repetidos; `anular(numero, …)` guarda la forma ANULADA;
  `FECHA_ANTERIOR_AL_ULTIMO` si el reloj quedó antes del último documento (Art. 43). Gancho `alEmitir` dentro
  de la transacción para el asiento contable (Art. 53). `AlmacenFiscalMemoria` incluido.
- **Reloj adelantado (Art. 43).** `emitir` rechaza con `RELOJ_ADELANTADO_SOSPECHOSO` una fecha más de
  `saltoMaximoDias` (7) después de la última emisión de la serie, salvo `confirmarSaltoDeFecha`.
  `corregirFechaAdelantada(almacen, { identificador, motivo })` anula los documentos con fecha futura y
  desbloquea la serie sin borrar ni editar. `EstadoSerie.ultimaFecha` pasa a contar solo documentos EMITIDOS.
- **Bitácora de auditoría.** `TransaccionFiscal.registrarEvento/eventos` y `eventosAuditoria(almacen)`:
  autorizaciones registradas, anulaciones, saltos de fecha confirmados y correcciones de reloj. En SQLite y
  Postgres, tabla `fhn_eventos` de solo inserción.
- **`factura-hn/pruebas`:** `ejecutarContratoAlmacen({ describe, it }, config)`, la batería de contrato que
  debe pasar cualquier adaptador, con 50 emisiones concurrentes desde 5 cajas.
- **Anulación (Art. 41):** `anular(numero, { almacen, motivo })` guarda un documento nuevo con
  `estado: 'ANULADO'` y `anulacion { motivo, fecha, hora }`; el número se conserva. El HTML y el texto imprimen
  la leyenda «ANULADA». `filaLibroVentas` toma el estado del documento. `estaAnulado`, `LEYENDA_ANULADA`,
  `congelar`.
- `opciones.reloj` y `hoyHonduras(opciones)`.
- `totales.ajustePorRedondeo`, `calcularDocumento(...).advertencias`, `sugerirPrecioSinAjuste` (precios de
  góndola que no requieren ajuste), `baseDesdePrecioConISV`.
- El precio unitario se imprime con hasta 4 decimales cuando los trae.
- Prueba estructural que prohíbe el punto flotante en la ruta del dinero.
- Paquetes listos para npm: `repository`, `homepage`, `bugs`, publicación pública y `LICENSE` dentro de cada
  paquete. La 0.2.0 se publica sin procedencia; las versiones que publique la CI la llevan firmada. `@factura-hn/pdf` se publica junto con los demás.
- Guía rápida del SDK (`docs/guia-sdk.md`, con sus ejemplos compilados en las pruebas) y guía de
  autoalojamiento con Docker (`docs/autoalojamiento.md`).
- Sitio de documentación en español para GitHub Pages (`pnpm sitio`): inicio, SDK, API con referencia generada
  desde OpenAPI, autoalojamiento, playground y matriz de cumplimiento.

### Seguridad y operación

Correcciones de la auditoría de seguridad del 24-11-2026 y de la validación de sus pistas.

- **Montos acotados.** La notación científica rechaza con `ErrorMonto` exponentes de más de ±30 o más de 40
  dígitos, antes de calcular nada: «1e10000000» bloqueaba el proceso varios segundos.
- **Render seguro.**
  - `renderizarHTML` escapa todo valor interpolado (moneda, fechas, RTN del emisor), aunque el documento venga de
    un archivo exportado.
  - `renderizarTexto` cambia por espacio el tabulador y el retorno de carro, y por «?» los demás caracteres de
    control (ESC, GS, NUL…), para que no lleguen a una impresora ESC/POS como comandos.
- **MCP.** `structuredContent` lleva un campo `aviso` (el texto libre lo escribieron terceros) y ningún texto
  lleva las etiquetas `<datos_documento>`.
- **Reportes de período acotados en memoria.**
  - Libro de ventas y exportación se leen por páginas y se transmiten, iguales byte por byte, con un tope de
    50 000 documentos (`FHN_MAX_DOCUMENTOS_REPORTE`; más allá, 422 `PERIODO_DEMASIADO_GRANDE`).
  - Cupos: 2 reportes en curso por tenant y un cuarto del pool por proceso (429 `LIMITE_SOLICITUDES`).
  - Plazos: 30 s por parte y 5 minutos por respuesta.
  - Núcleo: `documentosPorPaginas`, `contarDocumentos`, `correlativosDe`, `inicioExportacion`/`lineaExportacion`,
    `inicioLibroVentasCSV`/`lineaLibroVentasCSV`, `acumuladorResumenVentas` y el tipo `ResumenDocumento`.
  - `@factura-hn/postgres`: implementa esas lecturas, abre transacciones de solo lectura
    (`transaccion(fn, { soloLectura: true })`) y ya no tumba el proceso si el servidor corta una conexión prestada.
- **API (imagen Docker, no se publica en npm).**
  - **Rol LOGIN propio.** `FHN_MIGRAR_URL` (el dueño) solo migra; `DATABASE_URL` es un rol LOGIN que no es dueño
    de las tablas (`fhn_api` en Compose). La API no arranca si ese rol es, o puede volverse, superusuario,
    BYPASSRLS o dueño. El dueño ya no necesita ser superusuario (Postgres administrado). Para actualizar una
    instalación con contraseñas, ver «Actualizar» en `docs/autoalojamiento.md`.
  - **Llave admin.** El servidor ya no imprime la llave admin del negocio; dice cómo crearla con la consola.
  - **Retención** (`FHN_RETENCION_DIAS`, 30 por defecto). La clave de idempotencia no caduca: un reintento tardío
    devuelve el mismo documento.
  - **Webhooks.** Las entregas viejas se borran. El id de entrega es un UUID. Hay a lo sumo 20 webhooks activos
    por tenant (409 `LIMITE_WEBHOOKS`).
  - **Modo local.** Sin `FHN_MODO` hay aviso. En modo local la API no arranca con tenants de otros negocios.
  - **Caja y documentación.** Una llave de caja sin punto de emisión no emite (403 `CAJA_SIN_PUNTO`). `/docs` usa
    Swagger UI fija con SRI y CSP.
- **`@factura-hn/cliente`.** Tipos regenerados: 409 `LIMITE_WEBHOOKS` y `AvisoWebhook.id` como UUID.

### Cambiado

- **MCP local solo con SQLite en archivo.** `BackendLocal` recibe `{ db, emisor, … }` en lugar de
  `{ almacen, claves }`, y se elimina `clavesEnMemoria`. Una base en memoria se rechaza.
- **La bitácora de la API ya no usa el prefijo de la llave como actor**: si filtrabas por
  `llave:<prefijo>`, usa el id de `GET /v1/llaves`.

- `pnpm` workspaces: el SDK vive en `packages/core`.

## 0.1.0 — 2026-11-18

- Primera versión: Factura (01), Nota de Crédito (06), Nota de Débito (07), con la tabla de códigos vigente tras el Acuerdo 609-2017.
- Las notas exigen RTN del adquirente y moneda nacional; la Nota de Crédito imprime los campos de quien la recibe.
- La leyenda "La factura es beneficio de todos, exíjala" es opcional (el reglamento no la exige).
- Numeración de 16 dígitos, control de CAI/rango/fecha límite y estado de la autorización.
- Cálculo de ISV 15%, 18%, exento y exonerado, con precios con o sin ISV.
- Montos en letras, validación con códigos de error, render HTML (carta/ticket) y texto térmico.
- Libro de ventas CSV y resumen por tasa.
- Documentación para agentes de IA: AGENTS.md, llms.txt y skill de Claude.
