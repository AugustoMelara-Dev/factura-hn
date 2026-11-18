# Changelog

## 0.2.0 — sin publicar

Se cierran las brechas de `docs/investigacion.md`. Mientras la versión sea 0.x, los cambios incompatibles
van en versión menor (SemVer §4). La regla de versión mayor rige desde la 1.0.0.

### Cambios incompatibles

- **Un solo camino para emitir y anular.** Se eliminan `crearDocumento`, `AlmacenCorrelativos`,
  `AlmacenMemoria` y `RangoAgotadoError` (llevaban el correlativo por CAI y no guardaban el documento en la
  misma transacción). `construirDocumento` y `anularDocumento` dejan de exportarse. Usa
  `registrarAutorizacion`, `emitir` y `anular` sobre un `AlmacenFiscal`. La 0.1.0 no se publicó en npm.

- **Dinero sin punto flotante (B-17).** Cantidad, precio unitario, descuento, tipo de cambio y umbral aceptan
  `number | string` (se recomienda texto: `"19.99"`). Un `number` se lee por su texto decimal exacto. Si trae
  más decimales de los permitidos (cantidad y precio: 4; descuento: 2; tipo de cambio: 6), se rechaza en lugar
  de redondearse: `0.1 + 0.2` como precio da `LINEA_PRECIO`. Antes el precio se redondeaba a centavos en silencio.
- **ISV estatutario con precios con ISV incluido (B-03, D-01).** El ISV impreso es siempre la tasa × la base
  impresa con el redondeo del Art. 9 de la Ley del ISV. Antes se calculaba por diferencia y quedaba 1 centavo
  por encima de la regla en el 4.35 % (15 %) y el 6.78 % (18 %) de los montos. Cuando un precio no tiene base
  exacta, el total queda 1 centavo **por debajo** del precio (nunca por encima), con
  `totales.ajustePorRedondeo` y el aviso `AVISO_AJUSTE_CENTAVO`. El POS debe cobrar `totales.total`.
- **No se puede retrofechar (B-08).** La fecha de emisión la pone el reloj (`opciones.reloj`, por defecto
  `() => new Date()`) en America/Tegucigalpa. Una `fechaEmision` distinta de hoy en Honduras es el error
  `FECHA_EMISION_NO_ES_HOY` (Reglamento Arts. 14 y 43).
- **Documentos inmutables.** `emitir` y `anular` devuelven el documento congelado en
  profundidad (`Object.freeze`) y con `estado: 'EMITIDO'`. Si tu código modificaba el documento, copia antes.

- **Datos del emisor obligatorios (B-05, Art. 10 num. 1).** `nombreComercial`, `direccionEstablecimiento`,
  `telefono` y `correo` pasan a ser obligatorios en `Emisor` (errores `EMISOR_*`). Desaparece el aviso
  `AVISO_EMISOR_CONTACTO`.
- **Exoneración (B-12, Art. 11 num. 4).** Los tres campos de `Exoneracion` son opcionales: se exige OCE y
  constancia, o solo `registroSAG` (RUPNSA).
- `filaLibroVentas(doc)` ya no recibe `{ anulado }`: el estado sale del documento. El CSV del libro agrega la
  columna «Gravado 0%».
- `TIPO_NO_EMITIBLE` (en lugar de `TIPO_NO_SOPORTADO`) para 04, 09, 10 y 12, también al registrar la
  autorización (B-15, Arts. 4 num. 43, 46 y 47).

### Agregado

- **Gravado 0 % (B-01, Arts. 11 y 12):** `isv: 'GRAVADO0'` y `totales.importeGravado0`, discriminado en
  render y libro.
- **Crédito fiscal (B-02, Art. 11 num. 3):** `totales.baseCreditoFiscal` y el aviso `AVISO_VENTA_MIXTA` cuando
  el comprador tiene RTN.
- **Coherencia de notas (B-13):** la NC solo sobre Comprobantes Fiscales (Art. 6) y nunca con fecha anterior
  al original. Dentro de `emitir`, contra el almacén: el original debe existir, no estar ANULADO y coincidir en
  CAI, fecha y RTN (`REFERENCIA_*`). Si pertenece a otra autorización, `AVISO_REFERENCIA_NO_VERIFICADA`.

- `parsearDecimal`, `redondearDecimal`, `dividirRedondeando`, `centavosATexto`, `escaladoATexto`, `ErrorMonto`,
  `centavosEnLetras`, `calcularCentavos` (totales en `bigint`), `impuestoArt9`.
- **`AlmacenFiscal` y emisión atómica (B-04, B-18).** `emitir(entrada, { almacen, establecimiento,
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
- **Anulación (B-06, Art. 41):** `anular(numero, { almacen, motivo })` guarda un documento nuevo con
  `estado: 'ANULADO'` y `anulacion { motivo, fecha, hora }`; el número se conserva. El HTML y el texto imprimen
  la leyenda «ANULADA». `filaLibroVentas` toma el estado del documento. `estaAnulado`, `LEYENDA_ANULADA`,
  `congelar`.
- `opciones.reloj` y `hoyHonduras(opciones)`.
- `totales.ajustePorRedondeo`, `calcularDocumento(...).advertencias`, `sugerirPrecioSinAjuste` (precios de
  góndola que no requieren ajuste), `baseDesdePrecioConISV`.
- El precio unitario se imprime con hasta 4 decimales cuando los trae.
- Prueba estructural que prohíbe el punto flotante en la ruta del dinero.

### Cambiado

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
