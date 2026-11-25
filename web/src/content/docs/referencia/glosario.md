---
title: Glosario
description: Vocabulario fiscal y técnico de factura-hn, con el artículo que lo respalda, el nombre en el SDK y la página que lo explica.
---

Los artículos citados sin otra indicación son del Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus
reformas). Solo se incluyen términos con respaldo en el repositorio del proyecto. Los términos técnicos van
marcados como tales: no son reglas del SAR.

## A

### Acuerdo 481-2017

El Reglamento del Régimen de Facturación, Otros Documentos Fiscales y Registro Fiscal de Imprentas, reformado por
los Acuerdos 609-2017, 725-2018 y 817-2018. Es la norma que implementa factura-hn.
Ver [Normativa](/referencia/normativa/).

### Almacén fiscal

Término técnico. Donde factura-hn guarda las autorizaciones y los documentos, y desde donde toma el siguiente
número en la misma transacción que guarda el documento.
SDK: `AlmacenFiscal`, `AlmacenPostgres`, `AlmacenSQLite`, `AlmacenFiscalMemoria` (solo pruebas).
Ver [Almacén fiscal](/conceptos/almacen/).

### Anulación

Un documento con errores no se borra: lleva la leyenda «ANULADA» y se resguardan el original y la copia
(Art. 41). El número sigue consumido.
SDK: `anular`. Ver [Documentos inmutables](/conceptos/inmutables/).

### Autoimpresor por sistema computarizado

La modalidad en la que el propio negocio emite sus documentos desde un sistema. Se registran cada sistema, el
software, el establecimiento donde está el servidor y los puntos de emisión (Art. 47). Es la modalidad para la que
está hecho factura-hn.
Ver [Pasos ante la autoridad tributaria](/produccion/tramites/).

## C

### CAEE

Código único por documento electrónico, generado por algoritmo, que se obtiene interactuando con el SAR (Art. 4
num. 9 y Art. 54). No hay especificación técnica pública conocida: factura-hn no lo implementa.
Ver [Normativa](/referencia/normativa/).

### CAI

La autorización de impresión que otorga el SAR: «una serie alfanumérica generada electrónicamente» (Art. 4
num. 7). El Reglamento no publica su longitud ni su formato.
SDK: `AutorizacionCAI.cai`. Ver [Cómo funciona](/conceptos/como-funciona/).

### Comprobante Fiscal

Los documentos que respaldan una operación (Art. 6): Factura (01), Recibo por Honorarios (04), Ticket (09),
Factura Prevalorada (10), Boleta de Compra (11) y Constancia de Donación (12). Una Nota de Crédito solo se vincula a
uno de ellos (Art. 4 num. 32 y Art. 6; DEC-016).
SDK: `COMPROBANTES_FISCALES`. Ver [Documentos](/documentos/).

### Consumidor final

El adquirente sin RTN: el documento dice «CONSUMIDOR FINAL» o su nombre e identificación (Art. 11 num. 2 a). Una
venta de más de L 10,000 exige el nombre, el tipo y el número de identificación (Art. 11, párrafo final).
SDK: `CONSUMIDOR_FINAL`. Ver [Factura](/documentos/factura/).

### Constancia del Registro de Exonerados

Ver [Orden de Compra Exenta](#orden-de-compra-exenta-oce).

### Contingencia

Lo que el negocio usa cuando el sistema no está disponible: talonarios preimpresos de una imprenta certificada.
Vender sin documento se sanciona (Art. 55).
Ver [Contingencia](/produccion/tramites/#contingencia-si-el-sistema-no-está-disponible).

### Contrato de adhesión

El contrato que el negocio suscribe con el SAR como parte de su inscripción (Art. 45 num. 3). De él sale el
correo que se imprime en el documento (Art. 10 num. 1 f).
Ver [Pasos ante la autoridad tributaria](/produccion/tramites/).

### Crédito fiscal (base de)

En una venta con partes exentas y gravadas, el crédito fiscal se reconoce solo sobre lo gravado (Art. 11 num. 3).
factura-hn no incluye lo gravado al 0 % en esa base (DEC-020).
SDK: `totales.baseCreditoFiscal`, aviso `AVISO_VENTA_MIXTA`. Ver [ISV y montos](/conceptos/isv-y-montos/).

## D

### Declaración Jurada del sistema

La declaración que presenta el negocio de que su sistema cumple el Art. 53: integración contable o de
inventario, seguridad y auditoría, persistencia y exportación a archivos de texto. La firma el negocio, aunque el
software sea de un tercero.
Ver [Ficha técnica Art. 53](/produccion/ficha-art-53/).

### Documentos no utilizados

Los números de una autorización que no se usaron, por vencimiento, cierre, baja de un punto u otras causales. Se
comunican al SAR dentro de los 10 días hábiles del mes siguiente (Art. 42).
SDK: `documentosNoUtilizados`, `noUtilizadosDelAlmacen`. Ver [Operación mensual](/produccion/operacion-mensual/).

### DNI

Ver [RTN](#rtn).

## E

### Establecimiento

El local del negocio, con su código de tres dígitos: el primer grupo del número del documento (Art. 10 num. 7). La
casa matriz es `000`.
SDK: `establecimiento`. Ver [Cómo funciona](/conceptos/como-funciona/).

### Exento

Una venta que no causa ISV. El documento la discrimina aparte de lo gravado (Art. 11 num. 1 g). Qué productos son
exentos lo decide el negocio con su contador: el proyecto no tiene esa lista.
SDK: `isv: 'EXENTO'`, `totales.importeExento`. Ver [ISV y montos](/conceptos/isv-y-montos/).

### Exonerado

Un adquirente con derecho a no pagar el ISV, que lo acredita con la Orden de Compra Exenta y la Constancia del
Registro de Exonerados, o con el registro SAG/RUPNSA (Art. 11 num. 4). La exoneración aplica al documento completo
(DEC-019).
SDK: `exoneracion`, `totales.importeExonerado`. Ver [Exonerado](/conceptos/isv-y-montos/#exonerado).

## F

### Facturación electrónica

En el Reglamento, la modalidad en la que los sistemas del contribuyente «interactúan con los sistemas de la
Administración Tributaria» para crear, transmitir, autorizar, emitir y resguardar los documentos (Art. 4 num. 22).
factura-hn implementa el régimen vigente de CAI y rango, no esta interacción.
Ver [Preguntas frecuentes](/ayuda/preguntas-frecuentes/#es-factura-electrónica).

### Fecha límite de emisión

El último día en que se puede emitir con una autorización (Art. 10 num. 3-5). La vigencia máxima es de un año;
vencida, el documento pierde validez (Art. 62).
SDK: `fechaLimiteEmision`, error `AUTORIZACION_VENCIDA`. Ver [CAI y rangos](/produccion/cai-y-rangos/).

## G

### Gravado 0 %

La tasa cero de las exportaciones de mercancías gravadas (Art. 12). No es lo mismo que exento: el documento lo
discrimina aparte (Art. 11 num. 1 g).
SDK: `isv: 'GRAVADO0'`, `totales.importeGravado0`. Ver [Factura](/documentos/factura/).

:::caution[Por confirmar con fuente]
La Ley del ISV dice que las exportaciones quedan «exentas». El proyecto sigue al Reglamento (Art. 12) a la espera de
la pregunta P-09 de la [consulta al SAR](/produccion/consulta-sar/).
:::

## I

### Idempotencia

Término técnico. Repetir una emisión con la misma clave devuelve el documento ya emitido en lugar de emitir otro.
Evita duplicados cuando una respuesta se pierde y el sistema reintenta.
API: cabecera `Idempotency-Key`. MCP: `idempotencyKey`. Ver [Referencia de la API](/referencia/api/).

### Identificador del documento

Los tres primeros grupos del número: establecimiento, punto de emisión y tipo de documento, por ejemplo
`000-001-01` (Art. 10 num. 7). Cada identificador tiene su propia serie.
Ver [Cómo funciona](/conceptos/como-funciona/).

### ISV

El Impuesto Sobre Ventas. factura-hn maneja las tasas del 15 % y del 18 %, además de exento, exonerado y gravado
0 % (Ley del ISV, Art. 6).
SDK: `isv: 'ISV15' | 'ISV18'`, `totales.isv15`, `totales.isv18`. Ver [ISV y montos](/conceptos/isv-y-montos/).

:::caution[Por confirmar con fuente]
Las tasas vigentes vienen del Decreto 278-2013, Art. 16, que el proyecto no tiene en texto primario. Falta también
la lista oficial de bienes y servicios al 18 % (P-11; DEC-069, en revisión).
:::

## L

### Llave de caja y llave admin

Término técnico de la API. La llave de caja emite y consulta en su punto de emisión. La llave admin registra el
emisor, los CAI, las llaves y los webhooks, y anula.
Ver [Referencia de la API](/referencia/api/).

## M

### Modo de prueba

Término técnico, no una regla fiscal (DEC-063). Lo que se emite con un CAI ficticio (`DEMO00-NO-VALIDO-…`) lleva
`modo: 'prueba'`, la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y queda fuera del libro de ventas y de la
exportación (DEC-064).
SDK: `factura-hn/demo`, `esDocumentoDePrueba`. Ver [Tu primera factura](/empezar/primera-factura/).

### Momento de emisión

El documento se emite con lo primero entre la entrega del bien y el pago o el otorgamiento del crédito; en
servicios, al pago o al crédito (Art. 14).
Ver [Factura](/documentos/factura/).

## N

### Nota de Crédito

Documento que ajusta un Comprobante Fiscal por ajustes, devoluciones, descuentos posteriores o anulación de
operaciones (Art. 4 num. 32). Código 06, con su propia autorización y serie (Art. 25 num. 5).
SDK: `tipoDocumento: '06'`. Ver [Nota de Crédito](/documentos/nota-credito/).

### Nota de Débito

Documento que registra ajustes sobre un Comprobante Fiscal o sobre otro documento (Art. 4 num. 31 y Art. 28
num. 3 b; DEC-016). Código 07, con su propia autorización y serie (Art. 27 num. 5).
SDK: `tipoDocumento: '07'`. Ver [Nota de Débito](/documentos/nota-debito/).

### Número del documento

El número de 16 dígitos `NNN-NNN-NN-NNNNNNNN`: establecimiento, punto de emisión, tipo de documento y correlativo
(Art. 10 num. 7). Por ejemplo, `000-001-01-00000001`.
SDK: `formatearNumero`, `parsearNumero`, `esNumeroValido`. Ver [Cómo funciona](/conceptos/como-funciona/).

## O

### Orden de Compra Exenta (OCE)

Uno de los documentos con que un adquirente exonerado acredita la exoneración, junto con la Constancia del
Registro de Exonerados. El sector agroindustrial puede presentar en su lugar el registro SAG/RUPNSA (Art. 11
num. 4; DEC-021).
SDK: `exoneracion.ordenCompraExenta`, `exoneracion.constanciaRegistroExonerado`, `exoneracion.registroSAG`.
Ver [Exonerado](/conceptos/isv-y-montos/#exonerado).

:::caution[Por confirmar con fuente]
Si el registro SAG/RUPNSA basta sin OCE ni constancia es la pregunta P-08 de la
[consulta al SAR](/produccion/consulta-sar/).
:::

## P

### Punto de emisión

La caja o el dispositivo que emite, con su código de tres dígitos: el segundo grupo del número (Art. 10 num. 7).
Cada punto de emisión tiene su autorización por tipo de documento (Art. 59).
SDK: `puntoEmision`. Ver [Varias cajas](/guias/varias-cajas/).

## R

### Rango autorizado

Los números que el SAR autoriza con un CAI, del inicial al final (Arts. 10 num. 3-5 y 59). Cuando se agota, se
solicita una nueva autorización; la numeración continúa.
SDK: `rangoInicial`, `rangoFinal`, error `RANGO_AGOTADO`. Ver [CAI y rangos](/produccion/cai-y-rangos/).

### Redondeo del Art. 9 de la Ley del ISV

Una fracción menor a medio centavo debe bajarse; desde medio centavo, puede subirse (Ley del ISV, Art. 9). Con
precios con ISV incluido, el total puede quedar un centavo abajo.
SDK: `totales.ajustePorRedondeo`, `sugerirPrecioSinAjuste`, aviso `AVISO_AJUSTE_CENTAVO`.
Ver [ISV y montos](/conceptos/isv-y-montos/).

### Régimen de Facturación

El registro del SAR en el que el negocio indica sus modalidades, documentos, establecimientos y puntos de emisión
(Art. 45).
Ver [Pasos ante la autoridad tributaria](/produccion/tramites/).

### Registro Fiscal de Imprentas

El registro de las imprentas que imprimen formularios preimpresos (Arts. 66-70). Es el único registro de
proveedores que regula el Reglamento; no aplica a un software.
Ver [Preguntas frecuentes](/ayuda/preguntas-frecuentes/#el-proveedor-del-software-tiene-que-estar-registrado-o-certificado).

### RTN

El Registro Tributario Nacional. factura-hn valida el RTN con 14 dígitos y el DNI con 13. El Reglamento no fija
esas longitudes: son una decisión del proyecto (DEC-024).
SDK: `esRTNValido`, `esDNIValido`, `formatearRTN`, `formatearDNI`.

## S

### Sistema independiente y sistema en red

El Reglamento define las dos clases de sistema en el Art. 4 num. 41-42: el independiente está «instalado en el
domicilio fiscal o establecimiento». Un sistema en red puede ser centralizado, regional o por sucursal, con una o
varias numeraciones (Art. 48).
Ver [Varias cajas](/guias/varias-cajas/).

## T

### Tenant

Término técnico de la API: un negocio dentro de un servidor, con su emisor, sus llaves y sus documentos, aislado
de los demás.
Ver [Autoalojamiento](/guias/autoalojar/).

### Ticket

Documento que se emite exclusivamente a consumidores finales por máquinas registradoras (Art. 4 num. 43 y Art. 17).
Un sistema computarizado no lo emite: a un consumidor final le emite Factura.
SDK: error `TIPO_NO_EMITIBLE`. Ver [Documentos no emitibles](/documentos/no-emitibles/).

### Tipo de documento

El código de dos dígitos del tercer grupo del número. La tabla vigente es la del Acuerdo 609-2017: 01 Factura, 04
Recibo por Honorarios, 05 Comprobante de Retención, 06 Nota de Crédito, 07 Nota de Débito, 08 Guía de Remisión,
09 Ticket, 10 Factura Prevalorada, 11 Boleta de Compra y 12 Constancia de Donación. factura-hn emite 01, 06 y 07.
SDK: `tipoDocumento`. Ver [Documentos](/documentos/).
