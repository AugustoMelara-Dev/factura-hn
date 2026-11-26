# Qué cubre la librería y de dónde sale cada regla

Para emitir desde un sistema, el negocio se inscribe en el Régimen de Facturación como autoimpresor y obtiene su
CAI y su rango del SAR. factura-hn aplica las reglas de formato, numeración y cálculo. Cada requisito, con su
artículo y la prueba que lo verifica, está en la [matriz de cumplimiento](cumplimiento.md).

## Base normativa

- **Acuerdo 481-2017**, Reglamento del Régimen de Facturación, Otros Documentos Fiscales y Registro Fiscal
  de Imprentas, con sus reformas (Acuerdos 609-2017, 725-2018 y 817-2018).
- **Ley del Impuesto Sobre Ventas**: tasa general de 15 %; 18 % para bebidas alcohólicas, cigarrillos y boletos
  aéreos en clase ejecutiva o primera (Decreto 278-2013, Art. 16). Cada producto lleva su tasa.
- Régimen vigente: **CAI y rango autorizado**, en la modalidad de autoimpresor por sistema computarizado.

## Mapa de requisitos

| Requisito (Acuerdo 481-2017) | Dónde |
|---|---|
| Número de 16 dígitos `NNN-NNN-NN-NNNNNNNN` (establecimiento, punto de emisión, tipo, correlativo) | `formatearNumero`, `parsearNumero` |
| Códigos de tipo de documento vigentes (01, 04–12; Acuerdo 609-2017: 06 Nota de Crédito, 07 Nota de Débito) | `TIPOS_DOCUMENTO` |
| CAI, rango autorizado y fecha límite de emisión impresos | `DocumentoFiscal.cai/rangoAutorizado/fechaLimiteEmision`, render |
| No emitir después de la fecha límite ni fuera del rango | `emitir` (`AUTORIZACION_VENCIDA`, `RANGO_AGOTADO`, `CORRELATIVO_FUERA_DE_RANGO`) |
| Autorización por punto de emisión y tipo de documento, vigencia máxima de 1 año | `AutorizacionCAI`, `estadoAutorizacion` |
| Datos del emisor: RTN, razón social, nombre comercial, direcciones, teléfono y correo (Art. 10 num. 1) | `Emisor`, `EMISOR_*`, render |
| Destino de ejemplares (original cliente, copia emisor) | `DESTINO_EJEMPLARES` |
| Adquirente exonerado (Art. 11 num. 4): factura-hn acepta OCE y constancia de registro, o registro SAG/RUPNSA | `Exoneracion`, `EXONERACION_*` |
| RTN del cliente cuando la compra es para crédito fiscal, costo o gasto | `Cliente.rtn` |
| «CONSUMIDOR FINAL» cuando no se identifica al cliente | `CONSUMIDOR_FINAL` |
| Identificación en ventas a consumidor final de más de L 10,000 | `CONSUMIDOR_FINAL_IDENTIFICACION` (umbral configurable) |
| Descripción, cantidad y valor unitario | `LineaEntrada` |
| Descuentos y rebajas otorgados | `Totales.descuentos` |
| Importes exonerado, exento, gravado 0 % y gravado por tasa; ISV por tasa (Art. 11 num. 1 g-i) | `calcularDocumento` |
| Exportaciones con tasa cero (Art. 12) | `isv: 'GRAVADO0'`, `totales.importeGravado0` |
| Crédito fiscal: en ventas mixtas solo cuentan las gravadas (Art. 11 num. 3) | `totales.baseCreditoFiscal`, `AVISO_VENTA_MIXTA` |
| Notas 06 y 07 coherentes con el documento que modifican (Arts. 4 num. 32, 26, 28 y 41) | `REFERENCIA_*` en `emitir` |
| Nota de crédito: factura-hn no deja que la suma de las notas supere el original ni cambie su tasa | `NOTA_SUPERA_ORIGINAL` (con el saldo), `NOTA_TASA_DISTINTA`, `AVISO_NOTA_EXONERACION_DISTINTA` |
| factura-hn no anula un documento con notas vigentes: primero se anulan las notas | `DOCUMENTO_CON_NOTAS` en `anular` |
| Tipos que un sistema no emite: 04, 09, 10 y 12 (Arts. 4 num. 43, 46 y 47) | `TIPO_NO_EMITIBLE` |
| Importe total en número y letras, y moneda | `Totales.totalEnLetras`, `montoEnLetras` |
| Tipo de cambio si la moneda es extranjera | `tipoCambio` (`TIPO_CAMBIO`) |
| Notas: CAI, número y fecha del documento que modifican, y motivo | `ReferenciaDocumento`, `motivo` |
| Notas: nombre y RTN del adquirente; moneda nacional (Arts. 26 y 28) | `NOTA_CLIENTE_RTN`, `NOTA_MONEDA` |
| Nota de Crédito: nombre, identidad y firma de quien la recibe (Art. 26 num. 7) | render (campos en blanco) |

## Cómo calcula

- factura-hn calcula el ISV **por grupo de tasa**: el total siempre cuadra con la suma de importes más ISV.
- Con precios con ISV incluido, el total puede quedar un centavo abajo por el redondeo del Art. 9 de la Ley del
  ISV (`totales.ajustePorRedondeo`). Para evitarlo, `sugerirPrecioSinAjuste`.
- Moneda extranjera: el libro de ventas convierte a lempiras con el tipo de cambio de cada documento, y el
  impreso agrega el equivalente en lempiras del ISV y del total.
- Una nota sobre una factura a CONSUMIDOR FINAL acepta el RTN que indiques y lleva el aviso
  `AVISO_ORIGINAL_SIN_RTN`.
- La leyenda «La factura es beneficio de todos, exíjala» es opcional (`leyenda`).

## Fuera de alcance

- **No se emiten por sistema computarizado** y el SDK los rechaza con `TIPO_NO_EMITIBLE`: recibo por honorarios
  (04), ticket (09, solo máquina registradora), factura prevalorada (10) y constancia de donación (12).
- **No incluidos:** comprobante de retención (05), guía de remisión (08) y boleta de compra (11). La numeración
  los reconoce.
- Envío de archivos al SAR y declaración SAR-222. Como apoyo: `libroVentasCSV`, `resumenVentas` y `exportarTexto`.
- Consulta en línea de RTN o CAI.

## Créditos

La tabla de códigos vigente y los textos consolidados del Reglamento se apoyan en la investigación de
[invoicehn](https://github.com/JorgePadilla/invoicehn) (MIT, Jorge Padilla).
