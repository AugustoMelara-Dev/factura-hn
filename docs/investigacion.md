# Investigación normativa y matriz de cumplimiento

> Fuente de verdad del proyecto. Cada validación del SDK debe poder rastrearse a una fila de este
> documento, y cada fila a una línea de un texto primario. Si algo no está en una fuente verificable,
> aparece como **pregunta abierta**, no como regla.
>
> Fecha de la investigación: 2026-11-18. Versión evaluada: factura-hn 0.1.0 (commit `6913513`).

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
  Art. 16 (La Gaceta 33,316), que **no tenemos en texto primario** (ver P-11). Sí sirve para los Arts. 3 y 9.
- skillsarhn usa la tabla de códigos **original** de 2017 (03 Ticket, 07 Nota de Crédito, 08 Nota de Débito),
  derogada por el Acuerdo 609-2017. No se toma de ahí ningún código.

---

## 1. Matriz de cumplimiento

Estado en factura-hn 0.2 (la columna «Brecha (0.1)» conserva el diagnóstico inicial): ✅ cubierto y probado · 🟡 parcial · ❌ ausente · 📄 documental (obligación que se cumple con
documentación o trámite, sin cálculo que probar) · ➖ no aplica al SDK
(obligación del contribuyente, de la API o de la operación).

La columna «Prueba» nombra el archivo de `packages/core/test/` (o `packages/pdf/test/`) y el título de la
prueba entre comillas; «contrato» es la batería `ejecutarContratoAlmacen`, que corre en memoria, SQLite y
Postgres.

### Reglamento (Acuerdo 481-2017, texto consolidado)

| # | Requisito | Fuente | factura-hn 0.2 | Prueba | invoicehn | Brecha (0.1) → acción |
|---|---|---|---|---|---|---|
| 4.7 | El CAI es «una serie alfanumérica generada electrónicamente». No se publica longitud ni formato | C L.235-237 | ✅ Letras, dígitos y guiones; el patrón 6-6-6-6-6-2 solo con `caiEstricto` | `factura.test.ts` «B-09 …» (2) | Lo guarda e imprime tal cual; no valida formato | **B-09.** El patrón no tiene fuente. Se quita la advertencia por defecto; queda solo como opción `caiEstricto` |
| 4.9 | CAEE: código único por documento electrónico, generado por algoritmo | C L.244-246 | ❌ Sin especificación pública | — | ❌ | Sin especificación pública (sección 4). No se implementa |
| 4.31-32 | NC: ajustes, devoluciones, descuentos posteriores, anulación de operaciones; ND: ajustes. Ambas vinculadas a un Comprobante Fiscal | C L.377-385 | ✅ NC solo sobre Comprobante Fiscal; ND sobre «el Comprobante Fiscal o el documento» (Art. 28.3 b, DEC-016). Original en el almacén: existe, no anulado, mismo CAI, fecha y RTN. Fuera del almacén: `AVISO_ORIGINAL_EXTERNO` (DEC-004) | `b13-notas.test.ts` | ✅ Comprueba contra el store: original existente, no ANULADO, mismo RTN; tipo de referencia de NC ∈ Art. 6 | **B-13** |
| 4.43 | El Ticket se emite **exclusivamente** por máquina registradora | C L.448-450 | ✅ `TIPO_NO_EMITIBLE` para 09 | `paso7-requisitos.test.ts` «B-15 …» | No lo emite | **B-15.** Un sistema computarizado no puede emitir Tickets. Se quita de la hoja de ruta |
| 5 | Original y copia; las copias se resguardan por el plazo de prescripción | C L.476-481 | 🟡 Destino impreso; la custodia de copias es de la API (Fase 2) | `pdf.test.ts` «Art. 38: la copia reimpresa …»; contrato `factura-hn/pruebas` «emite correlativos consecutivos y el documento guardado es idéntico al emitido» | 🟡 | Se cubre con la custodia de la API (Fase 2). El plazo es la pregunta P-06 |
| 9 | La exención de L 50 al día **no aplica** a sistemas computarizados: un documento por venta | C L.559-566 | ✅ Sin consolidación diaria | `matriz.test.ts` «Art. 9 …» (L 0.01 y a título gratuito) | ✅ (decisión documentada) | Se documenta y se prueba que no hay una API de consolidación |
| 10.1 | Emisor: RTN, nombre o razón social, **nombre comercial**, dirección de casa matriz **y del establecimiento**, **teléfono**, **correo** | C L.584-595 | ✅ Los siete datos obligatorios e impresos | `paso7-requisitos.test.ts` «B-05 …»; `matriz.test.ts` «Art. 10 num. 1» | ✅ Los siete datos son obligatorios | **B-05.** Pasan a ser errores. El establecimiento puede ser igual a la casa matriz (se acepta un valor explícito) |
| 10.2 | Denominación «Factura» | C L.598 | ✅ | `matriz.test.ts` «Art. 10 num. 2-6» | ✅ | — |
| 10.3-5 | CAI, fecha límite y rango vigentes impresos | C L.600-605 | ✅ | `matriz.test.ts` «Art. 10 num. 2-6»; `factura.test.ts` «HTML con campos obligatorios y escapado» | ✅ | — |
| 10.6 | Destino de los ejemplares | C L.607-610 | ✅ | `matriz.test.ts` «Art. 10 num. 2-6» | ✅ | — |
| 10.7 | Número `NNN-NNN-NN-NNNNNNNN`; la serie inicia en 00000001 y **se reinicia** tras 99999999; «identificador del documento» = primeros tres grupos | C L.613-633 | 🟡 Serie por identificador ✅. El reinicio tras 99999999 que ordena el texto no se modela: un rango que lo cruce se rechaza (D-07) | `matriz.test.ts` «Art. 10 num. 7 …»; contrato `factura-hn/pruebas` «continúa la numeración … (B-04)», «cada identificador … su propia serie» | ✅ Contador por identificador. El reinicio tampoco | **B-04** (contador por identificador). Reinicio: decisión D-07 |
| 10.8 / 11.4 | Adquirente exonerado: Orden de Compra Exenta, Constancia de Registro de Exonerados, registro SAG / RUPNSA | C L.635-640, L.739-749 | ✅ OCE + constancia, o registro SAG/RUPNSA (DEC-021) | `paso7-requisitos.test.ts` «B-12 …» | 🟡 Similar | **B-12.** Ambiguo: la lectura literal admite el registro agroindustrial como alternativa. Pregunta P-08; mientras tanto se acepta OCE + constancia **o** registro SAG/RUPNSA, con la lectura documentada |
| 10.9 | Datos de la imprenta (solo preimpresos) | C L.642-648 | ➖ | — | ➖ | No aplica al autoimpresor |
| 10.10 | «Descuentos y rebajas otorgados» en el **formato** (Acuerdo 725-2018) | C L.650 | ✅ | `matriz.test.ts` «Art. 10 num. 10 …» | ✅ | Agregar una prueba explícita de «se imprime con 0.00» |
| 11.1 a-c | Crédito fiscal: nombre, RTN del cliente, fecha | C L.660-667 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» a-c | ✅ | — |
| 11.1 d-f | Descripción, cantidad, valor unitario | C L.669-673 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» d-f | ✅ | — |
| 11.1 g | Discriminar exentos, exonerados y **gravados con alícuota cero** | C L.675-676 | ✅ `GRAVADO0` | `paso7-requisitos.test.ts` «B-01 …» | ✅ `GRAVADO_0` | **B-01** |
| 11.1 h-i | Subtotales e impuestos por tarifa | C L.678-680 | ✅ ISV = tasa × base impresa | `matriz.test.ts` «Art. 11 num. 1 h-i / 2 e-f …» (texto y HTML); `art9-redondeo.test.ts` | ✅ | Ver B-03: el ISV impreso debe ser la tasa × la base impresa |
| 11.1 j / 2 g | Moneda «Lempira» o símbolo L | C L.682-683, L.717-718 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» j-l | ✅ | — |
| 11.1 k | Total en números y letras | C L.685 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» j-l; `factura.test.ts` «montos en letras» | ✅ | — |
| 11.1 l / 2 j | Discriminar descuentos | C L.687, L.724 | ✅ | `matriz.test.ts` «Art. 11 num. 1 …» j-l | ✅ | — |
| 11.2 a | «CONSUMIDOR FINAL» o nombre e identificación | C L.702-704 | ✅ | `matriz.test.ts` «Art. 11 num. 2 a …» | ✅ | — |
| 11.2 b-f, h-i | Consumidor final: descripción, cantidad, valor unitario, discriminación de exentos/exonerados/alícuota cero, impuestos por tarifa, total y fecha | C L.706-722 | ✅ (mismo render) | `matriz.test.ts` «Art. 11 num. 1 a-f, j-l …» y «Art. 11 num. 1 h-i / 2 e-f …» | — | Agregada en la revisión independiente |
| 11 (párr.) | Moneda extranjera: tasa de cambio vigente a la fecha | C L.726-727 | ✅ Exige e imprime `tipoCambio` | `matriz.test.ts` «Art. 11 (párrafo) …» | ✅ con fecha de la tasa | Opcional: guardar la fecha de la tasa |
| 11 (párr.) | Consumidor final > L 10,000: nombre, tipo y número de identificación | C L.729-734 | ✅ Umbral configurable | `matriz.test.ts` «Art. 11 num. 2 a …» párrafo final; `factura.test.ts` «consumidor final sobre el umbral …» | ✅ | — |
| 11.3 | Con ventas exentas y gravadas, el crédito fiscal reconoce solo las gravadas | C L.736-737 | ✅ `baseCreditoFiscal`, `AVISO_VENTA_MIXTA` | `paso7-requisitos.test.ts` «B-02 …»; `readme.test.ts` | ✅ `credito_fiscal_base` y aviso de venta mixta | **B-02** |
| 12 | Exportaciones de mercancías gravadas: factura con **tasa cero**. El segundo párrafo (regímenes de fomento, C L.757-761) queda fuera de alcance | C L.752-754 | ✅ `GRAVADO0` | `paso7-requisitos.test.ts` «B-01 …» | ✅ `GRAVADO_0` | **B-01.** Conflicto con la Ley del ISV (ISV L.165, L.189: «quedan exentos … los bienes y servicios que se exporten»). Lectura elegida: el documento sigue al Reglamento (columna «gravado 0 %»). Pregunta P-09 |
| 13 | Zonas libres: factura con tasa cero para transportistas, etc. | C L.764-817 | 🟡 La tasa cero sí (`GRAVADO0`); no se modelan reglas de zona libre | `paso7-requisitos.test.ts` «B-01 …» (solo la tasa) | 🟡 | Lo cubre `GRAVADO0`; no se modelan reglas de zona libre |
| 14 | Momento de emisión (entrega, pago o devengo, lo primero) | C L.820-848 | ➖ Responsabilidad del integrador; documentado en AGENTS.md | — | ➖ | Responsabilidad del integrador. Se documenta en AGENTS.md |
| 17 | Ticket: máquina registradora, numeración de 10 dígitos | C L.937-993 | ➖ El 09 se rechaza | `paso7-requisitos.test.ts` «B-15 …» | ➖ | Ver 4.43. Nota: L.988 conserva «El Ticket tendrá como código 03», un resto del texto original que contradice el 09 de L.967. Sin efecto para nosotros |
| 25.2,7 / 27.2,7 | «Nota de Crédito» / «Nota de Débito»; destino | C L.1324, L.1357-1359, L.1408, L.1450-1452 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 25.2 / 27.2 y «25.1-7 / 27.1-7 …» (destino) | ✅ | — |
| 25.5 / 27.5 | Códigos 06 y 07, serie propia | C L.1344-1345, L.1437-1438 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 25.5 / 27.5; `b13-notas.test.ts` «nota coherente: se emite sin avisos» (serie propia) | ✅ | — |
| 26.1-2 / 28.1-2 | Nombre y RTN del adquirente (sin opción de CONSUMIDOR FINAL) | C L.1374-1375, L.1473-1475 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 26.1-2 (nombre y RTN; sin error duplicado) | ✅ | — |
| 26.3 / 28.3 | CAI, número y fecha del documento que se modifica. NC → Comprobante Fiscal; ND → «Comprobante Fiscal **o el documento**» | C L.1376-1381, L.1477-1482 | ✅ Datos, tipo y fecha validados; coherencia contra el almacén | `matriz.test.ts` «Arts. 25-28 …» 26.3; `b13-notas.test.ts` | ✅ | **B-13** |
| 26.4 / 28.4 | Motivo | C L.1382, L.1483 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 26.4 | ✅ | — |
| 26.7 | Nombre, identidad y firma de quien recibe la NC | C L.1385-1386 | ✅ | `matriz.test.ts` «Arts. 25-28 …» 26.7 | ✅ | — |
| 26.9 / 28.8 | Moneda nacional | C L.1389-1390, L.1491-1492 | ✅ Las notas se emiten solo en HNL (`NOTA_MONEDA`, DEC-018) | `matriz.test.ts` «Arts. 25-28 …» 26.9; `factura.test.ts` «notas solo en lempiras» | ✅ | — |
| 25.1, 3-4, 6 / 27.1, 3-4, 6 | Formato de las notas: datos del emisor, CAI, fecha límite y rango vigentes | C L.1300-1354, L.1395-1447 | ✅ (mismo render que la factura) | `matriz.test.ts` «Arts. 25-28 …» «25.1-7 / 27.1-7 …» | — | Agregada en la revisión independiente |
| 26.5-6, 8, 10 / 28.5-7, 9 | Notas: importe en letras y números, impuestos por tarifa, fecha, descripción y unidades | C L.1383-1391, L.1485-1494 | ✅ | `matriz.test.ts` «Arts. 25-28 …» «26.5-6, 26.8, 26.10 / 28.5-7, 28.9 …» | — | Agregada en la revisión independiente |
| 38 | Papel térmico: certificación del proveedor del papel, conservación ≥ 5 años y resúmenes de ventas. Copia idéntica al original | C L.1879-1911 | 📄 Documental (README, `OpcionesRender.formato`, README de `@factura-hn/pdf`). La copia idéntica al original ✅ | `pdf.test.ts` «Art. 38: la copia reimpresa …» (copia idéntica); la certificación del papel es trámite del contribuyente | ❌ | **B-16.** Aviso en la documentación y en el render de ticket. Pregunta P-07 sobre los «resúmenes de ventas» |
| 40 | Comunicar el uso temporal (cambio de dirección o de nombre comercial, ferias) | C L.1925-1940 | ➖ | — | ➖ | Se documenta como paso ante el SAR |
| **41** | Documentos con errores: leyenda **«ANULADA»**; resguardar original y copia en orden cronológico | C L.1943-1955 | ✅ `anular`, estado ANULADO, leyenda en HTML, texto y PDF; libro en cero | `art41-anulacion.test.ts`; contrato `factura-hn/pruebas` «anula conservando el número …»; `pdf.test.ts` «Art. 41» | ✅ `annul` devuelve una nueva forma inmutable con la leyenda, y el correlativo se conserva | **B-06:** `anularDocumento` |
| **42** | Comunicar los documentos **no utilizados** dentro de los 10 días hábiles del mes siguiente (12 causales, entre ellas el vencimiento) | C L.1958-1990 | ✅ `documentosNoUtilizados` y `noUtilizadosDelAlmacen`, por autorización, con causal y fecha límite | `paso8-no-utilizados.test.ts` «B-07 …», incluida «revisión independiente: números saltados de una autorización vencida» | 🟡 `health` lista las autorizaciones vencidas que dejaron números sin usar | **B-07** |
| **43** | Custodia ordenada y **cronológica** por el plazo del Código Tributario | C L.1992-1996 | 🟡 Orden cronológico ✅ (sin retrofechar ni adelantar; procedimiento ante reloj adelantado). El plazo de custodia es de la API (Fase 2) | `reloj.test.ts`; contrato `factura-hn/pruebas` «rechaza emitir si el reloj …», «rechaza un salto …», «procedimiento ante reloj adelantado …» | ✅ La CLI no permite retrofechar | **B-08** |
| 45 | Inscripción al Régimen de Facturación | C L.2013-2036 | ➖ | — | ➖ | Sección 3a |
| 46 | Prevalorada y Recibo por Honorarios, **solo por imprenta** | C L.2039-2044 | ✅ `TIPO_NO_EMITIBLE` para 04 y 10 | `paso7-requisitos.test.ts` «B-15 …» | ➖ | **B-15.** El 04 no se puede emitir desde un sistema. Se quita de la hoja de ruta |
| **47** | Autoimpresor por sistema computarizado: registrar **cada sistema**, el **software**, el **establecimiento donde está el servidor** y los puntos de emisión. Excluye prevaloradas, honorarios y donación | C L.2047-2080 | ✅ `TIPO_NO_EMITIBLE` para 12; el registro del sistema es trámite (sección 3) | `paso7-requisitos.test.ts` «B-15 …» | ➖ | Sección 3. Implicaciones importantes para la API alojada (P-01, P-02) |
| 48 | Sistema en red: centralizado, regional o por sucursal (una o varias numeraciones) | C L.2083-2115 | 📄 Documental: `docs/persistencia.md` «Sistemas en red (Art. 48)» | — (configuración de puntos de emisión) | ➖ | Documentar en persistencia.md cómo se mapea a puntos de emisión |
| **53** | Sistemas «desarrollados **o adquiridos**»: (1) integrados al menos a un sistema contable o de inventarios; (2) seguridad y **controles de auditoría**; (3) persistencia y disponibilidad inmediata; (4) código 2D/3D opcional; (5) generación de **archivos de texto** para enviarlos al SAR. Declaración Jurada previa | C L.2161-2188 | 🟡 Num. 1 `LibroContable` ✅. Num. 2: bitácora y disparadores (documentos y autorizaciones inmutables) ✅; control de acceso en la API: llaves con roles, bitácora con actor y RLS por tenant ✅ (`packages/api/test/rls.test.ts`). Num. 3 almacenes persistentes ✅. Num. 5 `exportarTexto` ✅ | `paso9-exportacion.test.ts`; contrato `factura-hn/pruebas` «la bitácora registra …»; `sqlite/test/contrato.test.ts` «Art. 53 num. 2 …»; `postgres/test/contrato.test.ts` «la base impide …»; `postgres/test/rls.test.ts` | 🟡 `Ledger` (num. 1), export CSV y JSON (num. 5) | **B-10** (exportación de texto y gancho contable en el SDK). Num. 2-3 se resuelven en la API (Fase 2) |
| 54 | Emisión electrónica: interactuar con el SAR para obtener el CAEE | C L.2192-2196 | ❌ | — | ❌ | Sección 4 |
| 55 | Contingencia: talonarios preimpresos de imprenta; no se permite vender sin documento | C L.2200-2209 | ➖ | — | ➖ | Documentar. **No** justifica retrofechar |
| 57-58 | Incorporación gradual a la emisión electrónica según el calendario que publique Finanzas; el SAR publicará la documentación técnica | C L.2219-2234 | ➖ | — | ➖ | Sección 4 |
| **59** | Autorización electrónica **por punto de emisión y por tipo de documento**, con rango. Una sola solicitud por punto hasta agotar, **dentro de los 2 meses previos a la fecha límite** | C L.2245-2266 | ✅ Aviso desde que se abre la ventana de dos meses de calendario | `paso8-no-utilizados.test.ts` «B-11 …» | ✅ | **B-11.** Aviso por defecto a 60 días, citando el Art. 59 |
| 61 | Autoimpresor por sistema: autorización **por cada Sistema** y tipo de documento | C L.2279-2295 | ➖ | — | ➖ | P-02: ¿qué es «un Sistema» cuando es una API multi-tenant? |
| **62** | Vigencia máxima de **1 año**; vencida, el documento pierde validez | C L.2297-2303 | ✅ `AUTORIZACION_VENCIDA`; `AVISO_VIGENCIA_MAYOR_1_ANIO` con `fechaAutorizacion` | `reloj.test.ts` «el último día de la fecha límite …»; `matriz.test.ts` «Art. 62 …»; contrato `factura-hn/pruebas` «salta los números de una autorización vencida …» | ✅ | Agregar la advertencia `AVISO_VIGENCIA_MAYOR_1_ANIO` si la autorización trae `fechaAutorizacion` |
| 63 | El SAR puede limitar o cancelar autorizaciones por el comportamiento tributario | C L.2312-2345 | ➖ Baja de un CAI: API (Fase 2) | — | ➖ | La API debe permitir dar de baja un CAI antes de su fecha límite (estado `cancelada`) |
| 76-A | Desde el 1 de marzo de 2019, todos los documentos con todos los requisitos | C L.2585-2604; 817 | ➖ Fila de contexto (fecha de vigencia de todos los requisitos) | — | ✅ | — |

### Ley del Impuesto Sobre Ventas

| # | Requisito | Fuente | factura-hn 0.2 | Prueba | invoicehn | Brecha (0.1) → acción |
|---|---|---|---|---|---|---|
| ISV 3 | Los descuentos efectivos que consten en la factura, «siempre que resulten normales según la costumbre comercial», **no forman parte de la base gravable** | ISV L.80-83 | ✅ | `matriz.test.ts` «Ley del ISV Art. 3 …» | ✅ | Prueba explícita citando el Art. 3 |
| ISV 6 | Tasas. **Vigentes: 15 % y 18 % (Decreto 278-2013 Art. 16, sin texto primario local).** La copia del TSC dice 12 %/15 % | ISV L.178-200 (desactualizado) | ✅ 15/18; qué va al 18 % lo decide el integrador | `factura.test.ts` «precios sin ISV, tasas mixtas y descuento» | ✅ 15/18 | **B-14.** Conseguir el Decreto 278-2013 (P-11). No codificar listas de productos al 18 % |
| **ISV 9** | Fracción < 0.005 → **debe** bajarse; ≥ 0.005 → **puede** subirse. Cobrar fuera de esta regla «se considerará como hurto» | ISV L.252-260 | ✅ Redondeo del Art. 9 sobre la base impresa (D-01) | `art9-redondeo.test.ts` | ✅ (no admite precios con ISV incluido) | **B-03** (alto impacto) |
| ISV 9 | ¿Por línea o por total? «sobre el precio del artículo vendido» se lee por ítem; el Art. 11 h-i pide subtotales por tarifa | ISV L.252-253; C L.678-680 | ✅ Por grupo de tasa | `matriz.test.ts` «Ley del ISV Art. 9 …» | Por grupo de tasa (documentado) | Se mantiene la lectura. Pregunta P-10 |

---

## 2. Brechas a cerrar (por impacto)

Impacto: **A** = riesgo de documento inválido o de cobro ilegal · **M** = requisito incumplido u operación
insegura · **B** = mejora o documentación.

| ID | Imp. | Brecha | Acción en la Fase 1 | Prueba que la demuestra |
|---|---|---|---|---|
| **B-03** | A | **Redondeo estatutario con precios con ISV incluido.** Hoy `isv = total − round(total/1.15)`. En barrido de 1 ct a L 1,000.00: con 15 %, el ISV impreso queda **1 ct por encima** de `round(base × 15 %)` en el 4.35 % de los montos y 1 ct por debajo en el 8.70 %. Con 18 %: 6.78 % arriba y 8.47 % abajo. Además, el 13.0 % (15 %) y el 15.3 % (18 %) de los totales **no tienen ninguna base** que cumpla `base + round(base × tasa) = total` | Calcular siempre `isv = redondeoArt9(base × tasa)` sobre la base impresa. Con precios con ISV, buscar la base exacta y, si no existe, aplicar la decisión **D-01** | Barrido exhaustivo: para cada total, `isv == round_half_up(base × tasa)` |
| **B-04** | A | **Varias autorizaciones por identificador.** El correlativo se lleva por CAI. Cuando el SAR otorga un rango nuevo que continúa la numeración (p. ej. 5001-10000), `AlmacenMemoria` y el SQL de `persistencia.md` empiezan cada CAI en su `rangoInicial` y no comprueban la continuidad ni los solapamientos | Contador por **identificador** (`NNN-NNN-TT`). El almacén elige la autorización vigente que **cubre** el siguiente número. Se rechazan rangos que se solapan dentro de un mismo identificador | Contrato de adaptadores: agota A(1-3), sigue con B(4-6); solapamiento rechazado; autorización vencida saltada |
| **B-06** | A | **Anulación (Art. 41).** No hay `anularDocumento`, ni estado, ni leyenda ANULADA en el render | `anularDocumento(doc, { motivo, fecha })` devuelve un documento nuevo e inmutable con `estado: 'ANULADO'`, motivo y fecha, sin tocar el número. El render imprime «ANULADA». El libro toma el estado del propio documento. Anular dos veces es error | Pruebas Art. 41: leyenda en HTML y texto, número intacto, el original no cambia, motivo obligatorio |
| **B-08** | A | **Retrofechar.** `fechaEmision` acepta cualquier fecha, pasada o futura | La fecha la pone el **reloj** (`reloj?: () => Date`, America/Tegucigalpa). Una `fechaEmision` distinta de hoy es el error `FECHA_EMISION_NO_ES_HOY`. El almacén de documentos rechaza fechas anteriores a la del último documento del mismo identificador (Art. 43, orden cronológico) | Reloj fijo a las 23:30 UTC-6 (05:30 UTC del día siguiente): la fecha es la de Honduras. Fecha de ayer: error |
| **B-17** | A | **Dinero con punto flotante.** Entradas `number`, `cantidad × centavos` en flotante y `toFixed` en el CSV | Aritmética con `bigint`/enteros escalados: cantidades a 4 decimales, precios a centavos; las entradas aceptan `string` decimal (recomendado) o `number` validado (≤ 2 decimales en precio, ≤ 4 en cantidad, sin notación exponencial). Salida en centavos enteros más los campos actuales para compatibilidad | Prueba estructural (como `test_no_float`): sin `parseFloat`, `toFixed` ni `Math.round` en el camino del dinero, salvo en helpers permitidos. Casos 0.1 + 0.2 y 1.005 |
| **B-01** | M | **Exportación y gravado 0 %** (Art. 11.1 g, Art. 12) | Tratamiento `GRAVADO0` y columna «Importe gravado 0 %» en totales, render y libro | Factura de exportación: ISV 0, columna separada de exento y exonerado |
| **B-02** | M | **Base de crédito fiscal** (Art. 11.3) | `totales.baseCreditoFiscal = gravado15 + gravado18` y aviso `AVISO_VENTA_MIXTA` | Venta mixta exenta y gravada |
| **B-05** | M | **Datos completos del emisor** (Art. 10.1) | Nombre comercial (o explícitamente igual a la razón social), dirección del establecimiento, teléfono y correo pasan a ser obligatorios | Una prueba por cada campo que falta |
| **B-07** | M | **Documentos no utilizados** (Art. 42) | `documentosNoUtilizados(autorizaciones, ultimoPorIdentificador, { hoy, feriados? })` → rangos sin usar, causal y fecha límite de aviso (10 días hábiles del mes siguiente; sin feriados salvo que se pasen) | Autorización vencida con 40 números libres → rango y fecha límite correctos |
| **B-13** | M | **Coherencia de las notas.** El original debe existir, no estar ANULADO y tener el mismo RTN. NC solo sobre un Comprobante Fiscal; fecha de la nota ≥ fecha del original | Validación pura para el tipo y la fecha. Las comprobaciones contra el almacén (`AlmacenDocumentos.buscar`) en el flujo `emitir` | Una prueba por regla |
| **B-10** | M | **Art. 53**: exportación a texto y gancho contable | `exportarTexto(docs, { formato: 'csv' \| 'txt' })` con importes en texto exacto, y la interfaz `LibroContable` opcional en el flujo de emisión | Ida y vuelta JSON; CSV con dos decimales sin `toFixed` |
| **B-18** | M | **Atomicidad de la emisión.** `crearDocumento` reserva el número y devuelve el documento, pero guardarlo queda en manos del integrador. Si el guardado falla, el número se pierde sin dejar rastro | Nuevo `emitir(entrada, { almacen: AlmacenFiscal })`, donde `AlmacenFiscal.transaccion(fn)` reserva, construye y guarda todo o nada. Si algo falla después de reservar dentro de una transacción que no se puede revertir (p. ej. la impresión), el adaptador **guarda el documento ANULADO**. Contrato de pruebas compartido para memoria, SQLite y Postgres, con concurrencia | Contrato: un fallo dentro de la transacción no consume número; 50 emisiones concurrentes desde 5 «cajas» → 1..50 sin huecos ni repetidos |
| **B-09** | B | **Formato del CAI.** El patrón hex no tiene fuente (C L.235-237) | Por defecto solo se exige que no esté vacío y que sea alfanumérico con guiones. El patrón 6-6-6-6-6-2 queda en `caiEstricto: true`. Se elimina la advertencia por defecto | CAI con otra forma: sin error ni advertencia; con `caiEstricto`, error |
| **B-11** | B | Aviso de renovación | `diasAviso` por defecto en 60 (Art. 59: «dentro de los dos meses previos») | Aviso a 59 días |
| **B-12** | B | Exonerado agroindustrial (Art. 11.4 «… **o** …») | Válido con OCE + constancia **o** con registro SAG/RUPNSA, con la lectura documentada | Ambos caminos |
| **B-14** | B | Tasa del 18 %: no hay texto primario local y la redacción es ambigua | Sin listas de productos. Comentario con la fuente y P-11 | — |
| **B-15** | B | Hoja de ruta con documentos que un sistema no puede emitir (09 Ticket, 04 Honorarios) | Corregir el README. Los tipos emitibles por sistema son 01, 05, 06, 07, 08 y 11 | Prueba de que `validarEntrada` rechaza 04, 09, 10 y 12 citando los Arts. 4.43, 46 y 47 |
| **B-16** | B | Papel térmico (Art. 38) | Aviso en la documentación del render de ticket | — |

### Avance de la Fase 1

| Brecha | Estado | Pruebas |
|---|---|---|
| B-17 dinero exacto | cerrada | `packages/core/test/sin-flotante.test.ts` |
| B-03 redondeo Art. 9 (D-01) | cerrada | `packages/core/test/art9-redondeo.test.ts` |
| B-08 reloj, sin retrofechar | cerrada | `packages/core/test/reloj.test.ts` |
| B-06 anulación Art. 41 | cerrada | `packages/core/test/art41-anulacion.test.ts` |
| B-04 varias autorizaciones por identificador | cerrada | batería `factura-hn/pruebas` en memoria, SQLite y Postgres |
| B-18 emisión atómica | cerrada | misma batería (fallo dentro de la transacción, 50 emisiones concurrentes) |
| B-01 gravado 0 % / exportaciones | cerrada | `packages/core/test/paso7-requisitos.test.ts` («B-01 …») |
| B-02 base de crédito fiscal | cerrada | `paso7-requisitos.test.ts` («B-02 …») |
| B-05 datos completos del emisor | cerrada | `paso7-requisitos.test.ts` («B-05 …», una prueba por campo) |
| B-12 exonerado OCE + constancia o SAG/RUPNSA | cerrada | `paso7-requisitos.test.ts` («B-12 …») |
| B-13 coherencia de notas | cerrada | `packages/core/test/b13-notas.test.ts` |
| B-15 tipos no emitibles por sistema | cerrada | `paso7-requisitos.test.ts` («B-15 …») |
| B-07 documentos no utilizados | cerrada | `packages/core/test/paso8-no-utilizados.test.ts` («B-07 …») |
| B-11 aviso de renovación a 60 días | cerrada | `paso8-no-utilizados.test.ts` («B-11 …») |
| B-10 exportación a texto y gancho contable | cerrada | `packages/core/test/paso9-exportacion.test.ts` |
| B-09 CAI sin patrón por defecto | cerrada | `packages/core/test/factura.test.ts` («B-09 …») |
| B-14 tasa del 18 % | cerrada (documental) | comentario en `TASAS_ISV`; P-11 sigue abierta |
| B-16 papel térmico (Art. 38) | cerrada (documental) | `OpcionesRender.formato`, README |
| Reloj adelantado (revisión del 2026-11-18) | cerrada | contrato: «rechaza un salto de fecha sospechoso…», «procedimiento ante reloj adelantado…» |
| Bitácora de auditoría | cerrada | contrato: «la bitácora registra autorizaciones y anulaciones…»; disparadores en SQLite y Postgres |

### Reloj del dispositivo y orden cronológico (Art. 43)

**Qué dice la norma.** Reglamento Art. 43 (C L.1992-1996), «Custodia de la documentación»: «Los Obligados
Tributarios tienen la obligación de mantener en archivo los Documentos Fiscales de forma ordenada,
cronológica y por el plazo establecido en el Código Tributario y Leyes Especiales». El Art. 41 (C L.1943-1955)
pide lo mismo para los anulados: resguardo «de forma cronológica y ordenada». El Art. 14 fija el momento de
emisión: la fecha de la entrega o del pago, es decir, la fecha real de la operación.

**Cómo lo aplica el SDK.** El correlativo ordena el archivo. Para que ese orden también sea cronológico, la
fecha de un documento válido no puede ser anterior a la del último documento válido de su serie
(`FECHA_ANTERIOR_AL_ULTIMO`). La norma no dice «bloquear la emisión»; es nuestra forma de que el archivo
cumpla el Art. 43 sin depender de que alguien lo ordene después.

**El problema.** Si una caja con el reloj adelantado (por ejemplo, a 2027-03-01) emite un documento, ese
documento lleva una fecha que no es la de la operación (Art. 14) y la regla anterior traba la serie hasta
que llegue esa fecha.

**La solución, en dos partes.**

1. *Prevención.* `emitir` rechaza con `RELOJ_ADELANTADO_SOSPECHOSO` cuando la fecha del dispositivo está más
   de `saltoMaximoDias` (7 por defecto) después de la última emisión de la serie. El operador corrige el reloj
   o, si la fecha es correcta (el negocio estuvo cerrado), confirma con `confirmarSaltoDeFecha`; la
   confirmación queda en la bitácora (`SALTO_DE_FECHA_CONFIRMADO`). Una fecha posterior a la fecha límite del
   CAI ya no se puede emitir (`AUTORIZACION_VENCIDA`, Art. 62), y el salto se evalúa antes, así que el mensaje
   apunta al reloj. El umbral de 7 días es una decisión operativa, no una regla fiscal: no hay artículo que
   lo fije.
2. *Corrección.* Si ya se emitió con fecha futura (un salto menor que el umbral, o confirmado por error),
   `corregirFechaAdelantada(almacen, { identificador, motivo })` anula en una transacción todos los
   documentos EMITIDOS de la serie con fecha posterior a hoy y registra en la bitácora un
   `DOCUMENTO_ANULADO` por cada uno y un `FECHA_ADELANTADA_CORREGIDA` con el resumen. Desde ahí, la
   referencia cronológica es el último documento **válido** (`EstadoSerie.ultimaFecha` excluye los
   anulados) y se emite con la fecha real.

**Por qué respeta los Arts. 41 y 43.**

- Nada se borra ni se edita. Los documentos con fecha errónea conservan número, contenido y fecha original;
  solo pasan a ANULADO con la leyenda del Art. 41, que es el tratamiento que el Reglamento da a una «emisión
  con errores». La fecha es un dato del documento, así que una fecha falsa es un error de emisión.
- El archivo sigue ordenado por número, sin huecos: los anulados ocupan su lugar.
- Los documentos válidos quedan en orden cronológico: ninguno tiene una fecha anterior a la de un válido
  previo. Los anulados se resguardan en su lugar, con la fecha y el motivo de la anulación, como pide el Art. 41.
- La bitácora (solo inserción, protegida con disparadores) deja la traza de quién corrigió, cuándo y qué
  números se anularon, para la Administración Tributaria (Art. 43: «a disposición … cuando ésta lo requiera»).
- Si la venta fue real, se emite un documento nuevo con la fecha correcta. El original del anulado se
  recupera del cliente cuando es posible (Art. 41: resguardo de original y copia).

**Lo que no cubre.** Un reloj **atrasado** en la primera emisión de una serie (por ejemplo, una batería CMOS
que vuelve a 2000) no tiene referencia previa; la autorización no trae fecha de inicio que sirva de piso.
Queda como pregunta abierta P-13.

### Decisiones aprobadas (2026-11-18)

- **D-01 (B-03)**: `isv = redondeoArt9(base × tasa)` siempre. Con precio con ISV incluido, si no existe una
  base exacta, se toma la mayor base cuyo total no supere el precio: el cliente paga **1 centavo menos, nunca
  más**. El documento trae `AVISO_AJUSTE_CENTAVO` y `calcularDocumento` devuelve `ajustePorRedondeo` **antes**
  de emitir, para que el POS cobre exactamente lo que se imprimirá. `sugerirPrecioSinAjuste` propone precios
  de góndola que no requieren ajuste. Una prueba recorre de 0.01 a 1,000.00 y verifica que el total nunca
  supera el precio ingresado.
- **D-02**: los cambios incompatibles van en **0.2.0** con nota en el CHANGELOG. La regla de versión mayor
  rige desde la 1.0.0, que sale cuando la API sea estable.
- **D-03 (B-09)**: sin advertencia de formato del CAI por defecto. El patrón 6-6-6-6-6-2 queda solo como
  opción `caiEstricto`, documentado como **no normativo**.
- **D-07**: no se modela el reinicio tras 99999999. Se rechaza un rango que lo cruce.

---

## 3. Pasos ante el SAR

### a) Lo que debe hacer cada negocio antes de emitir con un sistema

| # | Paso | Fuente |
|---|---|---|
| 1 | Tener actualizados sus datos en el RTN y estar al día con sus obligaciones formales y materiales | Art. 45.1-2, C L.2018-2022; Art. 63, C L.2312-2340 |
| 2 | Suscribir el **contrato de adhesión** (de ahí sale el correo que se imprime, Art. 10.1 f) | Art. 45.3, C L.2023; C L.594-595 |
| 3 | Inscribirse en el **Régimen de Facturación** e indicar las modalidades, los documentos, los establecimientos y los puntos de emisión | Art. 45.4-5, C L.2024-2031 |
| 4 | Inscribirse como **autoimpresor**. Por sistema computarizado: registrar cada sistema, el software, el establecimiento donde está el servidor y los puntos de emisión | Art. 47, C L.2047-2080 |
| 5 | Presentar la **Declaración Jurada** de que el sistema cumple el Art. 53 (integración contable o de inventario, seguridad y auditoría, persistencia, exportación a texto) | Art. 53, C L.2184-2188 |
| 6 | Solicitar electrónicamente la **autorización de impresión y vigencia** (CAI + rango + fecha límite) **por punto de emisión y por tipo de documento**, y por cada sistema | Arts. 59 y 61, C L.2245-2260, L.2290-2295 |
| 7 | Renovar: una sola solicitud por punto hasta agotar, **dentro de los 2 meses previos** a la fecha límite. Vigencia máxima de 1 año | Art. 59, C L.2263-2266; Art. 62, C L.2300-2303 |
| 8 | Si se rechaza: presentarse dentro de 10 días hábiles o pedir verificación | Art. 64, C L.2347-2355 |
| 9 | Comunicar los **documentos no utilizados** dentro de los 10 días hábiles del mes siguiente (vencimiento, cambio de datos, cierre, baja de un punto, fallas técnicas, etc.) | Art. 42, C L.1958-1990 |
| 10 | Comunicar el **uso temporal** en ferias o cuando cambian la dirección o el nombre comercial | Art. 40, C L.1925-1940 |
| 11 | Tener **talonarios preimpresos** de imprenta certificada para contingencias. Vender sin documento se sanciona | Art. 55, C L.2200-2209 |
| 12 | Papel térmico: certificación del proveedor del papel y resúmenes de ventas | Art. 38, C L.1879-1889 |
| 13 | Custodiar en orden cronológico durante el plazo del Código Tributario, incluidos los anulados | Arts. 41 y 43, C L.1952-1955, L.1992-1996 |

Lo que **no** sabemos del procedimiento (formularios exactos, medio en la Oficina Virtual, tiempos): ver P-03.

### b) Lo que debe hacer Augusto / VitoCode como proveedor del software y de la API

Lo que dicen las fuentes:

- **No encontré en el Reglamento ningún registro ni certificación de proveedores de software.** El único
  registro de proveedores que regula es el **Registro Fiscal de Imprentas** (Arts. 66-70, C L.2383-2545), que
  aplica a quien imprime formatos preimpresos, no a un software. La búsqueda en sar.gob.hn tampoco encontró
  un trámite de ese tipo (búsqueda del 2026-11-18; la página de preguntas frecuentes no lo menciona).
  Esto **no prueba que no exista**: es la pregunta P-01.
- **«Desarrollados o adquiridos»** (C L.2164): el contribuyente puede usar un software de terceros, pero la
  **Declaración Jurada la firma él** (C L.2184-2188) y responde por ella. En la práctica, el proveedor tiene
  que darle a cada cliente lo necesario para declarar con verdad: cómo cumple cada numeral del Art. 53,
  la versión del software y la ubicación del servidor. Propuesta: un documento «Ficha técnica Art. 53» por versión.
- **Ubicación del servidor**: el Art. 47 exige registrar «el establecimiento donde se encuentre el servidor»
  (C L.2075), y el Art. 4.41 define el sistema independiente como «instalado en el domicilio fiscal o
  establecimiento» (C L.436-439). **Una API alojada en la nube de un tercero no encaja literalmente** en
  ninguna de las dos definiciones. Es el punto legal más delicado del modelo SaaS: P-02.
- **Custodia de datos fiscales de terceros**: el Reglamento obliga a custodiar al **obligado tributario**
  (Arts. 41 y 43). No le asigna obligaciones al proveedor. Si VitoCode guarda los documentos, lo hace por
  contrato con el cliente, y el cliente sigue respondiendo ante el SAR. Hace falta: contrato de servicio con
  cláusula de custodia y portabilidad (exportación completa en cualquier momento y al terminar el servicio),
  respaldos y plan de continuidad (Art. 53.3, «disponibilidad inmediata»). Ver P-05 sobre datos personales.
- **Plazo de conservación (resuelto con reserva)**: el Reglamento remite al «plazo de prescripción
  establecido en el Código Tributario» (C L.480-481, L.1954-1955, L.1994). El Código Tributario dice:
  - Art. 58 num. 4 (CT L.1434-1438): llevar en el domicilio tributario los libros y registros tributarios,
    «debiendo conservarlos por un período de **cinco (5) años** para los obligados tributarios inscritos en
    el Registro Tributario Nacional y por un período de **siete (7) años** para los demás casos».
  - Art. 63 num. 3 (CT L.1538-1549): conservar «documentos y antecedentes de los hechos generadores,
    **archivos electrónicos**, programas … en forma ordenada y mantenerlos **en su domicilio fiscal a
    disposición inmediata**» de la Administración, por 5 años (inscritos en el RTN) o 7 (los demás).
  - Art. 144 num. 2 (CT L.3849-3862): la prescripción es de 5 años para los inscritos en el RTN y de 7 en
    los demás casos. Art. 145 num. 1 (CT L.3871-3876): **se cuenta desde el día hábil siguiente a la
    presentación de la declaración**, no desde la fecha del documento. La prescripción se puede interrumpir
    (Art. 148).

  Política adoptada: conservar **como mínimo 5 años contados desde el vencimiento de la declaración del
  período del documento**. Un documento de diciembre se declara en enero, así que en la práctica se conserva
  hasta el 31 de enero del sexto año. Nunca se borra automáticamente: el borrado solo lo puede pedir el cliente
  después de ese plazo, porque una fiscalización abierta interrumpe la prescripción. Se toman 7 años si el
  emisor no está inscrito en el RTN (no aplica a quien factura, pero el dato queda).
- **«En su domicilio fiscal a disposición inmediata»** (CT Art. 63 num. 3) es otro argumento a favor de la
  instalación local de la API mientras el SAR responde P-02: con la versión alojada, el negocio tiene que
  poder consultar y exportar todo en cualquier momento, y eso se documenta como «acceso inmediato».

### Modos de despliegue de la API (respuesta provisional a P-02)

La API se diseña para dos modos con el mismo código:

1. **Local (single-tenant)**: `docker compose up` en una computadora o servidor **del negocio**, en su
   establecimiento. Es la lectura que encaja literalmente con el Art. 47 («el establecimiento donde se
   encuentre el servidor», C L.2075), con el Art. 4.41-42 (C L.436-445) y con el CT Art. 63 num. 3 (registros en
   el domicilio fiscal). **Es el modo recomendado hasta que el SAR responda P-02.**
2. **Alojada (multi-tenant)**: el mismo servicio con aislamiento por tenant (RLS). Se ofrece documentando
   que su encaje con el Art. 47 es una pregunta abierta, y el negocio decide con su contador.

### Preguntas abiertas para el SAR o un contador

Redactadas como consulta formal en `docs/consulta-sar.md`.

| ID | Pregunta | Por qué importa |
|---|---|---|
| P-01 | ¿Existe un registro, homologación o certificación de **proveedores o desarrolladores de sistemas de facturación**? ¿Tiene que registrarse el software, su versión o su proveedor? | Define si VitoCode debe hacer algún trámite propio |
| P-02 | Un **sistema en la nube operado por un tercero** (fuera del establecimiento y del «domicilio fiscal» del CT Art. 63.3) (multi-tenant): ¿qué «establecimiento donde se encuentre el servidor» se declara (Art. 47)? ¿Es «sistema en red» (Art. 4.42)? ¿Una sola API cuenta como «un Sistema» por cliente para el Art. 61? | Viabilidad legal de la API alojada |
| P-03 | Procedimiento actual de inscripción como autoimpresor y de la Declaración Jurada del Art. 53: formulario, medio y anexos técnicos | Guía para los clientes |
| P-04 | Formato de los **archivos de texto** del Art. 53.5 y de la comunicación de no utilizados del Art. 42: ¿hay una estructura publicada? | Hoy exportamos CSV y JSON propios |
| P-05 | Datos personales del adquirente (DNI, nombre) guardados por un tercero: ¿qué normativa de protección de datos aplica en Honduras? | Contrato y política de privacidad |
| P-06 | ~~Plazo de conservación~~ Resuelto con CT Arts. 58.4, 63.3, 144 y 145 (5 años desde la declaración, inscritos en el RTN). Queda abierto: confirmar con La Gaceta o con el texto consolidado de SEFIN que no hubo reformas posteriores a la compilación de 2024 | Política de retención |
| P-07 | Papel térmico: ¿la certificación del Art. 38 la gestiona el negocio? ¿qué son los «resúmenes de ventas» y en qué formato se entregan? | Ticket de 80 mm |
| P-08 | Exonerados agroindustriales (Art. 11.4): ¿basta el registro RUPNSA/SAG sin OCE ni constancia? | B-12 |
| P-09 | Exportaciones: ¿se imprime «gravado 0 %» (Reglamento Art. 12) o «exento» (Ley del ISV Art. 6)? | B-01 |
| P-10 | ISV por línea o por grupo de tasa con el Art. 9 de la Ley del ISV. Totales con precio con ISV que no tienen base exacta (D-01) | B-03 |
| P-11 | Texto oficial del Decreto 278-2013 Art. 16 y la lista vigente de bienes al 18 % (¿primera clase en boletos aéreos?) | B-14 |
| P-12 | ¿Hay calendario o especificación técnica de la emisión electrónica (Arts. 57-58)? | Sección 4 |
| P-14 | ¿Publicó el SAR un formato de archivo de texto (layout) para el traslado del Art. 53 num. 5 por autoimpresores? Si existe, se agrega como un formato más de `exportarTexto` | B-10 |
| P-13 | ¿Hay un piso de fecha válido para la primera emisión de una serie (p. ej. la fecha de la resolución que otorga el CAI)? Si la resolución trae fecha de emisión, el SDK podría rechazar fechas anteriores | Sección 2, «Reloj del dispositivo y orden cronológico» |

---

## 4. Factura electrónica en Honduras (CAEE): estado al 2026-11-18

| | Estado | Fuente |
|---|---|---|
| Régimen de **CAI + rango + fecha límite** con autoimpresor por sistema computarizado | **Vigente.** Es lo que implementa factura-hn | Arts. 51, 53, 59-62 |
| Definición de facturación electrónica: los sistemas del contribuyente «interactúan con los sistemas de la Administración Tributaria para crear, transmitir, autorizar, emitir y resguardar» | **En el Reglamento**, como medio del autoimpresor | Art. 4.22, C L.324-327 |
| **CAEE**: código único por documento, generado por algoritmo, que se obtiene interactuando con el SAR | **Definido en el Reglamento, sin especificación técnica pública** que hayamos encontrado | Art. 4.9, C L.244-246; Art. 54, C L.2192-2196 |
| Incorporación obligatoria según el calendario de Finanzas | **Prevista.** No encontramos un calendario publicado en fuentes primarias | Art. 57, C L.2219-2225 |
| Documentación técnica (esquemas, protocolo, firma) | **El Reglamento la prevé. No encontramos una publicación oficial** | Art. 58, C L.2229-2234 |
| API pública del SAR para emitir, validar o transmitir | **No existe que sepamos.** Existe un *validador de documentos fiscales* en la Oficina Virtual (uso web, citado por skillsarhn); no hay una API documentada | skillsarhn, «Fuentes base» |

Fuentes secundarias consultadas (no normativas): un resumen de VAT Update (agosto de 2026) clasifica el
régimen de CAI como vigente y la factura estructurada como «anunciada o en diseño, ni legislada ni
operativa»; otros sitios comerciales afirman que hay XML obligatorio desde 2014, lo que contradice el
texto del Reglamento. **No implementamos nada de CAEE.** Cuando el SAR publique la documentación del Art. 58,
irá en un paquete aparte (`@factura-hn/caee`) sin tocar el core.

---

## 5. Lecciones de las referencias

**invoicehn** (se adoptan):
- La terna (establecimiento, punto, tipo) como clave del contador, con varias autorizaciones por identificador.
- Emisión todo o nada (asignar, guardar y asentar bajo un mismo candado o transacción) y anulación que devuelve una forma nueva.
- El reloj inyectable y la prohibición de retrofechar. Ninguna llamada a «hoy» fuera del reloj.
- Pruebas de contrato reutilizables para los adaptadores.
- La prueba estructural que prohíbe el flotante en el camino del dinero.
- Montos serializados como texto.

**Diferencias deliberadas con invoicehn:**
- Soportamos precios con ISV incluido (es lo normal en un POS hondureño), con la regla D-01.
- `invoicehn` permite pasar `issue_date` desde la biblioteca; nosotros lo rechazamos salvo que sea hoy.

**skillsarhn**: el modelo de estados del correlativo (`reservado`, `emitido`, `anulado`,
`notificado_no_utilizado`, `vencido`) y la lista «No inventar: endpoints, XML/JSON oficial, firma, protocolo,
estados SAR». Su tabla de códigos **no** se usa.

**restaurant-pos-billing** (qué no hacer):
- Numeración con `SELECT MAX(IdFactura)` y `AUTO_INCREMENT` (`Factura2.cs:614`): hay carrera entre cajas,
  quedan huecos y no se lleva por identificador.
- Montos en `double` en todas las tablas (`postienda.sql`, tabla `facturas`).
- SQL armado concatenando texto, incluido el motivo de anulación (`Anular_Factura.cs:164`).
- Un botón **«reactivar» factura anulada** (`Anular_Factura.cs:250-286`), contrario al Art. 41, y borrado
  físico de facturas ordinarias (`Anular_Factura.cs:514-515`).
- Sí vale la pena copiar: guardar **la foto del CAI, el rango y las fechas en cada factura**, y el flujo de caja
  (apertura y cierre con arqueo, dos formas de pago, mesas). Va al ejemplo de POS de la Fase 3.

---

## 6. Plan de trabajo

**Fase 1 (SDK 0.2)**, en commits pequeños y en este orden:
1. Monorepo con pnpm (`packages/core` = factura-hn, `packages/api`, `packages/mcp`, `examples/`), sin cambiar comportamiento.
2. B-17 dinero sin flotante, más la prueba estructural.
3. B-03 redondeo del Art. 9 (con D-01).
4. B-08 reloj y no retrofechar.
5. B-06 `anularDocumento` y leyenda ANULADA.
6. B-04 + B-18: `AlmacenFiscal` (correlativos por identificador, varias autorizaciones, documentos, transacción), contrato de pruebas y adaptadores de memoria, SQLite (`better-sqlite3`, opcional) y PostgreSQL (`pg`, opcional, con prueba de concurrencia en Postgres de Docker).
7. B-01, B-02, B-05, B-12, B-13.
8. B-07 documentos no utilizados y B-11.
9. B-10 exportación de texto.
10. B-09, B-14, B-15, B-16 y documentación.
11. Subpaquete de PDF con `pdf-lib` (`@factura-hn/pdf`).
12. Build ESM+CJS, README y la matriz con una prueba por fila.

Los adaptadores y el PDF van en subpaquetes (`@factura-hn/postgres`, `@factura-hn/sqlite`, `@factura-hn/pdf`)
para que `factura-hn` siga sin dependencias.

**Fases 2-4**: como en el pedido original. La API depende de las respuestas a P-01 y P-02 para el modelo
legal, pero no para construirla.
