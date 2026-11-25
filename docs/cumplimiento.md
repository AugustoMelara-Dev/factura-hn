# Matriz de cumplimiento

Cada fila es un requisito del Reglamento del Régimen de Facturación (Acuerdo 481-2017, texto consolidado) o de la
Ley del Impuesto Sobre Ventas: su artículo, la línea del texto primario de donde sale, cómo lo cumple factura-hn y
la prueba que lo verifica. Si algo no está en una fuente verificable, no es una regla de la librería. Donde el texto
no es literal, la celda dice qué lectura aplica factura-hn.

El sitio publica esta matriz en https://augustomelara-dev.github.io/factura-hn/referencia/cumplimiento/ y, al
construirlo, busca cada prueba citada en el código: si una regla cubierta pierde su prueba, la construcción falla.

## Fuentes y cómo se citan

| Clave | Documento | Origen |
|---|---|---|
| **C L.n** | Texto consolidado del Reglamento (Acuerdo 481-2017, reformado por 609-2017, 725-2018 y 817-2018), Dirección Nacional Jurídico, julio 2020. `n` = línea del archivo | `invoicehn/doc/fuentes/acuerdo_481_2017_consolidado.txt`, commit `8274c8a` |
| **ISV L.n** | Ley del Impuesto Sobre Ventas (Decreto-Ley 24), copia del TSC. `n` = línea de `pdftotext -layout ley_isv.pdf` | `invoicehn/doc/fuentes/ley_isv.pdf` |
| **817** | Acuerdo 817-2018, La Gaceta 34,811 | `invoicehn/doc/fuentes/acuerdo_817_2018_gaceta_34811.txt` |
| **CT L.n** | Código Tributario, Decreto 170-2016, compilación del CEDIJ del Poder Judicial («Código Tributario (2024)»). `n` = línea de `pdftotext -layout` | poderjudicial.gob.hn/Cedij/Cdigos/Codigo Tributario (2024).pdf, descargado el 2026-11-18. Es una compilación, no La Gaceta: confirmar con el texto oficial antes de citarlo ante el SAR |
| **invoicehn** | Gema Ruby de referencia (MIT), v0.2.x | github.com/JorgePadilla/invoicehn @ `8274c8a` |
| **skillsarhn** | Skills de facturación (MIT) | github.com/Javitonito-Javier/skillsarhn @ `9acd4c1` |
| **POS** | restaurant-pos-billing (C#/MySQL) | github.com/umanzorc/restaurant-pos-billing @ `3c8241f` |

Advertencias sobre las fuentes:

- En el texto consolidado, los números de nota al pie quedan pegados al número de artículo: «ARTÍCULO 103» es el
  Art. 10 con la nota 3, «ARTÍCULO 2512» es el Art. 25 con la nota 12.
- La copia de la Ley del ISV del TSC llega solo hasta el Decreto 171-98 y todavía muestra tasas de 12 % y 15 %
  (ISV L.178-200). **No sirve para citar las tasas vigentes.** Las de 15 % y 18 % vienen del Decreto 278-2013,
  Art. 16 (La Gaceta 33,316), que **no tenemos en texto primario** (el integrador decide qué productos van al 18 %). Sí sirve para los Arts. 3 y 9.
- skillsarhn usa la tabla de códigos **original** de 2017 (03 Ticket, 07 Nota de Crédito, 08 Nota de Débito),
  derogada por el Acuerdo 609-2017. No se toma de ahí ningún código.

## Estados y columnas

✅ cubierto y probado · 🟡 parcial · ❌ ausente · 📄 documental (obligación que se cumple con documentación o
trámite, sin cálculo que probar) · ➖ no aplica al SDK (obligación del contribuyente, de la API o de la operación).

La columna «Prueba» nombra el archivo de `packages/core/test/` (o `packages/pdf/test/`) y el título de la prueba
entre comillas; «contrato» es la batería `ejecutarContratoAlmacen`, que corre en memoria, SQLite y PostgreSQL.

## Reglamento (Acuerdo 481-2017, texto consolidado)

| # | Requisito | Fuente | factura-hn | Prueba |
|---|---|---|---|---|
| 4.7 | El CAI es «una serie alfanumérica generada electrónicamente». No se publica longitud ni formato | C L.235-237 | ✅ Letras, dígitos y guiones; el patrón 6-6-6-6-6-2 solo con `caiEstricto` | `factura.test.ts` «Art. 4 num. 7: CAI con otra forma …» y «Art. 4 num. 7: un carácter …» |
| 4.9 | CAEE: código único por documento electrónico, generado por algoritmo | C L.244-246 | ❌ Sin especificación pública | — |
| 4.31-32 | NC: ajustes, devoluciones, descuentos posteriores, anulación de operaciones; ND: ajustes. Ambas vinculadas a un Comprobante Fiscal | C L.377-385 | ✅ NC solo sobre Comprobante Fiscal; ND sobre «el Comprobante Fiscal o el documento» (Art. 28 num. 3). Original en el almacén: existe, no anulado, mismo CAI, fecha y RTN; la suma de las NC no supera su total y no cambia la tasa (`NOTA_SUPERA_ORIGINAL`, `NOTA_TASA_DISTINTA`; lectura de factura-hn del Art. 4 num. 32: la nota ajusta el comprobante correspondiente). Fuera del almacén: `AVISO_ORIGINAL_EXTERNO` | `notas-coherencia.test.ts`; `nota-credito-tope.test.ts`; contrato `factura-hn/pruebas` «notas de crédito: el acumulado…» |
| 4.43 | El Ticket se emite **exclusivamente** por máquina registradora | C L.448-450 | ✅ `TIPO_NO_EMITIBLE` para 09 | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 5 | Original y copia; las copias se resguardan por el plazo de prescripción | C L.476-481 | 🟡 Destino impreso; la custodia de las copias la hace la API | `pdf.test.ts` «Art. 38: la copia reimpresa …»; contrato `factura-hn/pruebas` «emite correlativos consecutivos y el documento guardado es idéntico al emitido» |
| 9 | La exención de L 50 al día **no aplica** a sistemas computarizados: un documento por venta | C L.559-566 | ✅ Sin consolidación diaria | `matriz.test.ts` «Art. 9 …» (L 0.01 y a título gratuito) |
| 10.1 | Emisor: RTN, nombre o razón social, **nombre comercial**, dirección de casa matriz **y del establecimiento**, **teléfono**, **correo** | C L.584-595 | ✅ Los siete datos obligatorios e impresos | `requisitos-documento.test.ts` «datos completos del emisor …»; `matriz.test.ts` «Art. 10 num. 1» |
| 10.2 | Denominación «Factura» | C L.598 | ✅ | `matriz.test.ts` «Art. 10 num. 2-6» |
| 10.3-5 | CAI, fecha límite y rango vigentes impresos | C L.600-605 | ✅ | `matriz.test.ts` «Art. 10 num. 2-6»; `factura.test.ts` «HTML con campos obligatorios y escapado» |
| 10.6 | Destino de los ejemplares | C L.607-610 | ✅ | `matriz.test.ts` «Art. 10 num. 2-6» |
| 10.7 | Número `NNN-NNN-NN-NNNNNNNN`; la serie inicia en 00000001 y **se reinicia** tras 99999999; «identificador del documento» = primeros tres grupos | C L.613-633 | 🟡 Serie por identificador ✅. El reinicio tras 99999999 que ordena el texto no se modela: un rango que lo cruce se rechaza (decisión de diseño de factura-hn) | `matriz.test.ts` «Art. 10 num. 7 …»; contrato `factura-hn/pruebas` «continúa la numeración …», «cada identificador … su propia serie» |
| 10.8 / 11.4 | Adquirente exonerado: Orden de Compra Exenta, Constancia de Registro de Exonerados, registro SAG / RUPNSA | C L.635-640, L.739-749 | ✅ OCE + constancia, o registro SAG/RUPNSA (el texto no es literal: es la lectura que aplica factura-hn) | `requisitos-documento.test.ts` «adquirente exonerado …» |
| 10.9 | Datos de la imprenta (solo preimpresos) | C L.642-648 | ➖ | — |
| 10.10 | «Descuentos y rebajas otorgados» en el **formato** (Acuerdo 725-2018) | C L.650 | ✅ | `matriz.test.ts` «Art. 10 num. 10 …» |
| 11.1 a-c | Crédito fiscal: nombre, RTN del cliente, fecha | C L.660-667 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» a-c |
| 11.1 d-f | Descripción, cantidad, valor unitario | C L.669-673 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» d-f |
| 11.1 g | Discriminar exentos, exonerados y **gravados con alícuota cero** | C L.675-676 | ✅ `GRAVADO0` | `requisitos-documento.test.ts` «gravado con alícuota cero …» |
| 11.1 h-i | Subtotales e impuestos por tarifa | C L.678-680 | ✅ ISV = tasa × base impresa | `matriz.test.ts` «Art. 11 num. 1 h-i / 2 e-f …» (texto y HTML); `art9-redondeo.test.ts` |
| 11.1 j / 2 g | Moneda «Lempira» o símbolo L | C L.682-683, L.717-718 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» j-l |
| 11.1 k | Total en números y letras | C L.685 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» j-l; `factura.test.ts` «montos en letras» |
| 11.1 l / 2 j | Discriminar descuentos | C L.687, L.724 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» j-l |
| 11.2 a | «CONSUMIDOR FINAL» o nombre e identificación | C L.702-704 | ✅ | `matriz.test.ts` «Art. 11 num. 2 a …» |
| 11.2 b-f, h-i | Consumidor final: descripción, cantidad, valor unitario, discriminación de exentos/exonerados/alícuota cero, impuestos por tarifa, total y fecha | C L.706-722 | ✅ (mismo render) | `matriz.test.ts` «Art. 11 num. 1 a-f, j-l …» y «Art. 11 num. 1 h-i / 2 e-f …» |
| 11 (párr.) | Moneda extranjera: tasa de cambio vigente a la fecha | C L.726-727 | ✅ Exige e imprime `tipoCambio` | `matriz.test.ts` «Art. 11 (párrafo) …» |
| 11 (párr.) | Consumidor final > L 10,000: nombre, tipo y número de identificación | C L.729-734 | ✅ Umbral configurable | `matriz.test.ts` «Art. 11 num. 2 a …» párrafo final; `factura.test.ts` «consumidor final sobre el umbral …» |
| 11.3 | Con ventas exentas y gravadas, el crédito fiscal reconoce solo las gravadas | C L.736-737 | ✅ `baseCreditoFiscal`, `AVISO_VENTA_MIXTA` | `requisitos-documento.test.ts` «base de crédito fiscal …»; `readme.test.ts` |
| 12 | Exportaciones de mercancías gravadas: factura con **tasa cero**. El segundo párrafo (regímenes de fomento, C L.757-761) queda fuera de alcance | C L.752-754 | ✅ `GRAVADO0` | `requisitos-documento.test.ts` «gravado con alícuota cero …» |
| 13 | Zonas libres: factura con tasa cero para transportistas, etc. | C L.764-817 | 🟡 La tasa cero sí (`GRAVADO0`); no se modelan reglas de zona libre | `requisitos-documento.test.ts` «gravado con alícuota cero …» (solo la tasa) |
| 14 | Momento de emisión (entrega, pago o devengo, lo primero) | C L.820-848 | ➖ Responsabilidad del integrador; documentado en AGENTS.md | — |
| 17 | Ticket: máquina registradora, numeración de 10 dígitos | C L.937-993 | ➖ El 09 se rechaza | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 25.2,7 / 27.2,7 | «Nota de Crédito» / «Nota de Débito»; destino | C L.1324, L.1357-1359, L.1408, L.1450-1452 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 25.2 / 27.2 y «25.1-7 / 27.1-7 …» (destino) |
| 25.5 / 27.5 | Códigos 06 y 07, serie propia | C L.1344-1345, L.1437-1438 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 25.5 / 27.5; `notas-coherencia.test.ts` «nota coherente: se emite sin avisos» (serie propia) |
| 26.1-2 / 28.1-2 | Nombre y RTN del adquirente (sin opción de CONSUMIDOR FINAL) | C L.1374-1375, L.1473-1475 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 26.1-2 (nombre y RTN; sin error duplicado) |
| 26.3 / 28.3 | CAI, número y fecha del documento que se modifica. NC → Comprobante Fiscal; ND → «Comprobante Fiscal **o el documento**» | C L.1376-1381, L.1477-1482 | ✅ Datos, tipo y fecha validados; coherencia contra el almacén | `matriz.test.ts` «Arts. 25-28 …» 26.3; `notas-coherencia.test.ts` |
| 26.4 / 28.4 | Motivo | C L.1382, L.1483 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 26.4 |
| 26.7 | Nombre, identidad y firma de quien recibe la NC | C L.1385-1386 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 26.7 |
| 26.9 / 28.8 | Moneda nacional | C L.1389-1390, L.1491-1492 | ✅ Las notas se emiten solo en HNL (`NOTA_MONEDA`) | `matriz.test.ts` «Arts. 25-28 …» 26.9; `factura.test.ts` «notas solo en lempiras» |
| 25.1, 3-4, 6 / 27.1, 3-4, 6 | Formato de las notas: datos del emisor, CAI, fecha límite y rango vigentes | C L.1300-1354, L.1395-1447 | ✅ (mismo render que la factura) | `matriz.test.ts` «Arts. 25-28 …» «25.1-7 / 27.1-7 …» |
| 26.5-6, 8, 10 / 28.5-7, 9 | Notas: importe en letras y números, impuestos por tarifa, fecha, descripción y unidades | C L.1383-1391, L.1485-1494 | ✅ | `matriz.test.ts` «Arts. 25-28 …» «26.5-6, 26.8, 26.10 / 28.5-7, 28.9 …» |
| 38 | Papel térmico: certificación del proveedor del papel, conservación ≥ 5 años y resúmenes de ventas. Copia idéntica al original | C L.1879-1911 | 📄 Documental (README, `OpcionesRender.formato`, README de `@factura-hn/pdf`). La copia idéntica al original ✅ | `pdf.test.ts` «Art. 38: la copia reimpresa …» (copia idéntica); la certificación del papel es trámite del contribuyente |
| 40 | Comunicar el uso temporal (cambio de dirección o de nombre comercial, ferias) | C L.1925-1940 | ➖ | — |
| **41** | Documentos con errores: leyenda **«ANULADA»**; resguardar original y copia en orden cronológico | C L.1943-1955 | ✅ `anular`, estado ANULADO, leyenda en HTML, texto y PDF; libro en cero | `art41-anulacion.test.ts`; contrato `factura-hn/pruebas` «anula conservando el número …»; `pdf.test.ts` «Art. 41» |
| **42** | Comunicar los documentos **no utilizados** dentro de los 10 días hábiles del mes siguiente (12 causales, entre ellas el vencimiento) | C L.1958-1990 | ✅ `documentosNoUtilizados` y `noUtilizadosDelAlmacen`, por autorización, con causal y fecha límite | `no-utilizados.test.ts` «Art. 42: …», incluida «Art. 42: números saltados de una autorización vencida» |
| **43** | Custodia ordenada y **cronológica** por el plazo del Código Tributario | C L.1992-1996 | 🟡 Orden cronológico ✅ (sin retrofechar ni adelantar; procedimiento ante reloj adelantado). El plazo de custodia lo cubre la API | `reloj.test.ts`; contrato `factura-hn/pruebas` «rechaza emitir si el reloj …», «rechaza un salto …», «procedimiento ante reloj adelantado …» |
| 45 | Inscripción al Régimen de Facturación | C L.2013-2036 | ➖ | — |
| 46 | Prevalorada y Recibo por Honorarios, **solo por imprenta** | C L.2039-2044 | ✅ `TIPO_NO_EMITIBLE` para 04 y 10 | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| **47** | Autoimpresor por sistema computarizado: registrar **cada sistema**, el **software**, el **establecimiento donde está el servidor** y los puntos de emisión. Excluye prevaloradas, honorarios y donación | C L.2047-2080 | ✅ `TIPO_NO_EMITIBLE` para 12; el registro del sistema es un trámite ante el SAR | `requisitos-documento.test.ts` «tipos que un sistema computarizado no puede emitir …» |
| 48 | Sistema en red: centralizado, regional o por sucursal (una o varias numeraciones) | C L.2083-2115 | 📄 Documental: `docs/persistencia.md` «Sistemas en red (Art. 48)» | — (configuración de puntos de emisión) |
| **53** | Sistemas «desarrollados **o adquiridos**»: (1) integrados al menos a un sistema contable o de inventarios; (2) seguridad y **controles de auditoría**; (3) persistencia y disponibilidad inmediata; (4) código 2D/3D opcional; (5) generación de **archivos de texto** para enviarlos al SAR. Declaración Jurada previa | C L.2161-2188 | 🟡 Num. 1 `LibroContable` ✅. Num. 2: bitácora y disparadores (documentos y autorizaciones inmutables) ✅; control de acceso en la API: llaves con roles, bitácora con actor y RLS por tenant ✅ (`packages/api/test/rls.test.ts`). Num. 3 almacenes persistentes ✅. Num. 5 `exportarTexto` ✅ | `exportacion-texto.test.ts`; contrato `factura-hn/pruebas` «la bitácora registra …»; `sqlite/test/contrato.test.ts` «Art. 53 num. 2 …»; `postgres/test/contrato.test.ts` «la base impide …»; `postgres/test/rls.test.ts` |
| 54 | Emisión electrónica: interactuar con el SAR para obtener el CAEE | C L.2192-2196 | ❌ | — |
| 55 | Contingencia: talonarios preimpresos de imprenta; no se permite vender sin documento | C L.2200-2209 | ➖ | — |
| 57-58 | Incorporación gradual a la emisión electrónica según el calendario que publique Finanzas; el SAR publicará la documentación técnica | C L.2219-2234 | ➖ | — |
| **59** | Autorización electrónica **por punto de emisión y por tipo de documento**, con rango. Una sola solicitud por punto hasta agotar, **dentro de los 2 meses previos a la fecha límite** | C L.2245-2266 | ✅ Aviso desde que se abre la ventana de dos meses de calendario | `no-utilizados.test.ts` «Art. 59: …» |
| 61 | Autoimpresor por sistema: autorización **por cada Sistema** y tipo de documento | C L.2279-2295 | ➖ | — |
| **62** | Vigencia máxima de **1 año**; vencida, el documento pierde validez | C L.2297-2303 | ✅ `AUTORIZACION_VENCIDA`; `AVISO_VIGENCIA_MAYOR_1_ANIO` con `fechaAutorizacion` | `reloj.test.ts` «el último día de la fecha límite …»; `matriz.test.ts` «Art. 62 …»; contrato `factura-hn/pruebas` «salta los números de una autorización vencida …» |
| 63 | El SAR puede limitar o cancelar autorizaciones por el comportamiento tributario | C L.2312-2345 | ➖ Lo decide el SAR; factura-hn no modela la baja anticipada de un CAI | — |
| 76-A | Desde el 1 de marzo de 2019, todos los documentos con todos los requisitos | C L.2585-2604; 817 | ➖ Fila de contexto (fecha de vigencia de todos los requisitos) | — |

## Ley del Impuesto Sobre Ventas

| # | Requisito | Fuente | factura-hn | Prueba |
|---|---|---|---|---|
| ISV 3 | Los descuentos efectivos que consten en la factura, «siempre que resulten normales según la costumbre comercial», **no forman parte de la base gravable** | ISV L.80-83 | ✅ | `matriz.test.ts` «Ley del ISV Art. 3 …» |
| ISV 6 | Tasas. **Vigentes: 15 % y 18 % (Decreto 278-2013 Art. 16, sin texto primario local).** La copia del TSC dice 12 %/15 % | ISV L.178-200 (desactualizado) | ✅ 15/18; qué va al 18 % lo decide el integrador | `factura.test.ts` «precios sin ISV, tasas mixtas y descuento» |
| **ISV 9** | Fracción < 0.005 → **debe** bajarse; ≥ 0.005 → **puede** subirse. Cobrar fuera de esta regla «se considerará como hurto» | ISV L.252-260 | ✅ Redondeo del Art. 9 sobre la base impresa; con precios con ISV incluido, el total puede quedar un centavo abajo, nunca arriba | `art9-redondeo.test.ts` |
| ISV 9 | ¿Por línea o por total? «sobre el precio del artículo vendido» se lee por ítem; el Art. 11 h-i pide subtotales por tarifa | ISV L.252-253; C L.678-680 | ✅ Por grupo de tasa | `matriz.test.ts` «Ley del ISV Art. 9 …» |

---
