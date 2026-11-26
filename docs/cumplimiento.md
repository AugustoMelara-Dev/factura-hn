# Matriz de cumplimiento

Cada fila es un requisito del Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas) o de la
Ley del Impuesto Sobre Ventas: su artículo, cómo lo cumple factura-hn y la prueba que lo verifica.

La columna «#» es el artículo y su numeral («10.7» es el Art. 10, numeral 7). La columna «Prueba» nombra el
archivo de `packages/core/test/` (o del paquete que se indica) y el título de la prueba entre comillas;
«contrato» es la batería `ejecutarContratoAlmacen` de `factura-hn/pruebas`, que corre en memoria, SQLite y
PostgreSQL. El sitio publica esta matriz en https://augustomelara-dev.github.io/factura-hn/referencia/cumplimiento/.

## Reglamento del Régimen de Facturación

| # | Requisito | factura-hn | Prueba |
|---|---|---|---|
| 4.7 | El CAI es una serie alfanumérica generada electrónicamente | ✅ Letras, dígitos y guiones; el patrón 6-6-6-6-6-2 con `caiEstricto` | `factura.test.ts` «Art. 4 num. 7: CAI con otra forma …» y «Art. 4 num. 7: un carácter …» |
| 4.31-32 | Nota de Crédito y de Débito vinculadas a un Comprobante Fiscal | ✅ El original en el almacén debe existir, no estar anulado y tener el mismo CAI, fecha y RTN. La suma de las notas de crédito no supera su total ni cambia la tasa (`NOTA_SUPERA_ORIGINAL`, `NOTA_TASA_DISTINTA`). Un original de otro sistema da `AVISO_ORIGINAL_EXTERNO` | `notas-coherencia.test.ts`; `nota-credito-tope.test.ts`; contrato `factura-hn/pruebas` «notas de crédito: el acumulado…» |
| 4.43 | El Ticket se emite solo por máquina registradora | ✅ El tipo 09 da `TIPO_NO_EMITIBLE` | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 5 | Original y copia | ✅ Destino impreso; la copia reimpresa es idéntica al original | `pdf.test.ts` «Art. 38: la copia reimpresa …»; contrato `factura-hn/pruebas` «emite correlativos consecutivos y el documento guardado es idéntico al emitido» |
| 9 | Sistemas computarizados: un documento por venta, sin el mínimo de L 50 al día | ✅ Sin consolidación diaria | `matriz.test.ts` «Art. 9 …» |
| 10.1 | Emisor: RTN, razón social, nombre comercial, direcciones de casa matriz y del establecimiento, teléfono y correo | ✅ Los siete datos obligatorios e impresos | `requisitos-documento.test.ts` «datos completos del emisor …»; `matriz.test.ts` «Art. 10 num. 1» |
| 10.2 | Denominación «Factura» | ✅ | `matriz.test.ts` «Art. 10 num. 2-6» |
| 10.3-5 | CAI, fecha límite y rango autorizado impresos | ✅ | `matriz.test.ts` «Art. 10 num. 2-6»; `factura.test.ts` «HTML con campos obligatorios y escapado» |
| 10.6 | Destino de los ejemplares | ✅ | `matriz.test.ts` «Art. 10 num. 2-6» |
| 10.7 | Número `NNN-NNN-NN-NNNNNNNN`; la serie inicia en 00000001 por identificador | ✅ Una serie por identificador; un rango que cruce 99999999 se rechaza | `matriz.test.ts` «Art. 10 num. 7 …»; contrato `factura-hn/pruebas` «continúa la numeración …», «cada identificador … su propia serie» |
| 10.8 / 11.4 | Adquirente exonerado: Orden de Compra Exenta y Constancia de Registro de Exonerados, o registro SAG/RUPNSA | ✅ `exoneracion` con OCE y constancia, o `registroSAG` | `requisitos-documento.test.ts` «adquirente exonerado …» |
| 10.10 | Descuentos y rebajas otorgados | ✅ | `matriz.test.ts` «Art. 10 num. 10 …» |
| 11.1 a-c | Crédito fiscal: nombre, RTN del cliente y fecha | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» |
| 11.1 d-f | Descripción, cantidad y valor unitario | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» |
| 11.1 g | Discriminar exentos, exonerados y gravados con alícuota cero | ✅ `GRAVADO0` | `requisitos-documento.test.ts` «gravado con alícuota cero …» |
| 11.1 h-i | Subtotales e impuestos por tarifa | ✅ ISV = tasa × base impresa | `matriz.test.ts` «Art. 11 num. 1 h-i / 2 e-f …»; `art9-redondeo.test.ts` |
| 11.1 j / 2 g | Moneda «Lempira» o símbolo L | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» |
| 11.1 k | Total en números y letras | ✅ | `matriz.test.ts` «Art. 11 num. 1 …»; `factura.test.ts` «montos en letras» |
| 11.1 l / 2 j | Discriminar descuentos | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» |
| 11.2 a | «CONSUMIDOR FINAL» o nombre e identificación | ✅ | `matriz.test.ts` «Art. 11 num. 2 a …» |
| 11.2 b-f, h-i | Consumidor final: descripción, cantidad, valor unitario, exentos, exonerados, alícuota cero, impuestos por tarifa, total y fecha | ✅ Mismo render que el crédito fiscal | `matriz.test.ts` «Art. 11 num. 1 a-f, j-l …» y «Art. 11 num. 1 h-i / 2 e-f …» |
| 11 (párr.) | Moneda extranjera: tasa de cambio a la fecha | ✅ Exige e imprime `tipoCambio` | `matriz.test.ts` «Art. 11 (párrafo) …» |
| 11 (párr.) | Consumidor final de más de L 10,000: nombre, tipo y número de identificación | ✅ Umbral configurable | `matriz.test.ts` «Art. 11 num. 2 a …»; `factura.test.ts` «consumidor final sobre el umbral …» |
| 11.3 | Con ventas exentas y gravadas, el crédito fiscal reconoce solo las gravadas | ✅ `baseCreditoFiscal` y `AVISO_VENTA_MIXTA` | `requisitos-documento.test.ts` «base de crédito fiscal …» |
| 12 | Exportaciones: factura con tasa cero | ✅ `GRAVADO0` | `requisitos-documento.test.ts` «gravado con alícuota cero …» |
| 13 | Zonas libres: factura con tasa cero | ✅ `GRAVADO0` | `requisitos-documento.test.ts` «gravado con alícuota cero …» |
| 17 | Ticket: solo máquina registradora | ✅ El tipo 09 se rechaza | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 25.2,7 / 27.2,7 | «Nota de Crédito» / «Nota de Débito» y destino | ✅ | `matriz.test.ts` «Arts. 25-28 …» |
| 25.5 / 27.5 | Códigos 06 y 07, con serie propia | ✅ | `matriz.test.ts` «Arts. 25-28 …»; `notas-coherencia.test.ts` «nota coherente: se emite sin avisos» |
| 26.1-2 / 28.1-2 | Nombre y RTN del adquirente | ✅ | `matriz.test.ts` «Arts. 25-28 …» |
| 26.3 / 28.3 | CAI, número y fecha del documento que se modifica | ✅ Datos, tipo y fecha validados contra el almacén | `matriz.test.ts` «Arts. 25-28 …»; `notas-coherencia.test.ts` |
| 26.4 / 28.4 | Motivo | ✅ | `matriz.test.ts` «Arts. 25-28 …» |
| 26.7 | Nombre, identidad y firma de quien recibe la Nota de Crédito | ✅ | `matriz.test.ts` «Arts. 25-28 …» |
| 26.9 / 28.8 | Moneda nacional | ✅ Las notas se emiten en HNL (`NOTA_MONEDA`) | `matriz.test.ts` «Arts. 25-28 …»; `factura.test.ts` «notas solo en lempiras» |
| 25.1, 3-4, 6 / 27.1, 3-4, 6 | Notas: datos del emisor, CAI, fecha límite y rango | ✅ Mismo render que la factura | `matriz.test.ts` «Arts. 25-28 …» |
| 26.5-6, 8, 10 / 28.5-7, 9 | Notas: importe en letras y números, impuestos por tarifa, fecha, descripción y unidades | ✅ | `matriz.test.ts` «Arts. 25-28 …» |
| 38 | Papel térmico: la copia es idéntica al original | ✅ | `pdf.test.ts` «Art. 38: la copia reimpresa …» |
| 41 | Documentos con errores: leyenda «ANULADA» y se conservan | ✅ `anular`: estado ANULADO, leyenda en HTML, texto y PDF; montos en cero en el libro | `art41-anulacion.test.ts`; contrato `factura-hn/pruebas` «anula conservando el número …»; `pdf.test.ts` «Art. 41» |
| 42 | Documentos no utilizados: comunicarlos dentro de los 10 días hábiles del mes siguiente | ✅ `documentosNoUtilizados` y `noUtilizadosDelAlmacen`, con causal y fecha límite | `no-utilizados.test.ts` «Art. 42: …» |
| 43 | Custodia ordenada y cronológica | ✅ Sin retrofechar ni adelantar; procedimiento ante reloj adelantado | `reloj.test.ts`; contrato `factura-hn/pruebas` «rechaza emitir si el reloj …», «rechaza un salto …», «procedimiento ante reloj adelantado …» |
| 46 | Prevalorada y Recibo por Honorarios, solo por imprenta | ✅ Los tipos 04 y 10 dan `TIPO_NO_EMITIBLE` | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 47 | El autoimpresor por sistema no emite constancias de donación | ✅ El tipo 12 da `TIPO_NO_EMITIBLE` | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 53.1 | Integración con un sistema contable o de inventarios | ✅ `libroContable` y `alEmitir`, en la misma transacción | `exportacion-texto.test.ts` «Art. 53 num. 1: …» |
| 53.2 | Seguridad y controles de auditoría | ✅ Bitácora; documentos y autorizaciones inmutables en la base; en la API, llaves con roles y RLS por tenant | contrato `factura-hn/pruebas` «la bitácora registra …»; `sqlite/test/contrato.test.ts` «Art. 53 num. 2 …»; `postgres/test/contrato.test.ts` «la base impide …»; `postgres/test/rls.test.ts` |
| 53.3 | Persistencia y disponibilidad inmediata | ✅ Almacenes SQLite y PostgreSQL | `sqlite/test/contrato.test.ts`; `postgres/test/contrato.test.ts` |
| 53.5 | Archivos de texto | ✅ `exportarTexto` en JSONL, CSV y TXT | `exportacion-texto.test.ts` «Art. 53 num. 5: …» |
| 59 | Autorización por punto de emisión y tipo de documento; se pide dentro de los 2 meses previos a la fecha límite | ✅ Aviso desde que se abre la ventana de dos meses | `no-utilizados.test.ts` «Art. 59: …» |
| 62 | Vigencia máxima de 1 año; vencida, el documento pierde validez | ✅ `AUTORIZACION_VENCIDA`; `AVISO_VIGENCIA_MAYOR_1_ANIO` con `fechaAutorizacion` | `reloj.test.ts` «el último día de la fecha límite …»; `matriz.test.ts` «Art. 62 …»; contrato `factura-hn/pruebas` «salta los números de una autorización vencida …» |

## Ley del Impuesto Sobre Ventas

| # | Requisito | factura-hn | Prueba |
|---|---|---|---|
| ISV 3 | Los descuentos que constan en la factura no forman parte de la base gravable | ✅ | `matriz.test.ts` «Ley del ISV Art. 3 …» |
| ISV 6 | Tasas de 15 % y 18 % (Decreto 278-2013, Art. 16) | ✅ `ISV15` e `ISV18`, por producto | `factura.test.ts` «precios sin ISV, tasas mixtas y descuento» |
| ISV 9 | Redondeo: una fracción menor de 0.005 se baja; desde 0.005 puede subirse | ✅ Sobre la base impresa; con precios con ISV incluido, el total puede quedar un centavo abajo, nunca arriba | `art9-redondeo.test.ts` |
| ISV 9 | Redondeo por grupo de tasa, con subtotales por tarifa (Reglamento Art. 11 num. 1 h-i) | ✅ | `matriz.test.ts` «Ley del ISV Art. 9 …» |
