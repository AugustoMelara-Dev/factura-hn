---
title: Factura (01)
description: Requisitos de la Factura según el Reglamento de Facturación, los campos que exige factura-hn, un ejemplo que funciona y los errores más comunes.
sidebar:
  order: 1
---

La Factura es el comprobante fiscal que respalda una venta de bienes o servicios. Su contenido lo fijan los
Arts. 10 y 11 del Reglamento del Régimen de Facturación (Acuerdo 481-2017, texto consolidado). Su código de tipo
es `01`.

`emitir` emite una factura cuando `tipoDocumento` es `'01'` u omites el campo.

## Requisitos

### Del documento

| Requisito | Artículo | Qué hace factura-hn |
|---|---|---|
| Datos del emisor: RTN, razón social, nombre comercial, dirección de casa matriz y del establecimiento, teléfono y correo | Art. 10 num. 1 | Los siete son obligatorios y se imprimen |
| Denominación «Factura» | Art. 10 num. 2 | `nombreDocumento` |
| CAI, fecha límite de emisión y rango autorizado | Art. 10 num. 3-5 | Los toma de la autorización vigente y los imprime |
| Destino de los ejemplares | Art. 10 num. 6 | «Original: Cliente / Copia: Emisor» (`DESTINO_EJEMPLARES`) |
| Número `NNN-NNN-NN-NNNNNNNN` | Art. 10 num. 7 | Lo asigna el almacén, sin huecos ni repetidos |
| Datos del adquirente exonerado | Art. 10 num. 8 y Art. 11 num. 4 | `exoneracion` |
| Descuentos y rebajas otorgados en el formato | Art. 10 num. 10 (Acuerdo 725-2018) | Se imprimen, también en `0.00` |

### De la venta

| Requisito | Artículo | Qué hace factura-hn |
|---|---|---|
| Para crédito fiscal: nombre y RTN del cliente, y fecha | Art. 11 num. 1 a-c | `cliente: { nombre, rtn }`; la fecha la pone el reloj |
| Descripción, cantidad y valor unitario | Art. 11 num. 1 d-f | `lineas` |
| Importes exentos, exonerados y gravados con alícuota cero, por separado | Art. 11 num. 1 g | `isv` de cada línea |
| Subtotales e impuesto por tarifa | Art. 11 num. 1 h-i | `totales.isv15`, `totales.isv18` |
| Moneda (Lempira o L) | Art. 11 num. 1 j | `moneda`, por defecto `HNL` |
| Total en números y en letras | Art. 11 num. 1 k | `totales.total`, `totales.totalEnLetras` |
| Descuentos por separado | Art. 11 num. 1 l | `descuento` de cada línea |
| Sin cliente identificado: «CONSUMIDOR FINAL» | Art. 11 num. 2 a | Se imprime si omites `cliente` |
| Consumidor final por más de L 10,000: nombre, tipo y número de identificación | Art. 11, párrafo final | Error si faltan |
| Moneda extranjera: tasa de cambio vigente a la fecha | Art. 11, párrafo final | `tipoCambio` obligatorio |
| Venta mixta: el crédito fiscal reconoce solo lo gravado | Art. 11 num. 3 | `totales.baseCreditoFiscal` y `AVISO_VENTA_MIXTA` |
| Exportación de mercancías gravadas: factura con tasa cero | Art. 12 | `isv: 'GRAVADO0'` |

### De la operación

- **Un documento por venta.** La exención de L 50 al día no aplica a los sistemas computarizados (Art. 9 del
  Reglamento). El SDK no consolida ventas.
- **Momento de emisión.** Se emite con lo primero que ocurra entre la entrega del bien y el pago o el
  otorgamiento del crédito; en servicios, al pago o al crédito (Art. 14). El SDK no puede saber cuándo ocurre:
  decidirlo es tarea de tu sistema.
- **La fecha es la de hoy.** La pone el reloj en hora de Honduras y no se puede retrofechar ni adelantar, por el
  momento de emisión (Art. 14) y el archivo cronológico (Art. 43).
- **Descuentos.** Los descuentos que constan en la factura no forman parte de la base gravable (Ley del ISV,
  Art. 3).
- **Redondeo del ISV.** Con precios con ISV incluido, el total puede quedar un centavo por debajo de la suma de
  precios (Ley del ISV, Art. 9). Cobra siempre `totales.total`.

## Campos obligatorios

| Campo de `DocumentoEntrada` | Obligatorio | Artículo |
|---|---|---|
| `emisor` (los siete datos) | Siempre | Art. 10 num. 1 |
| `lineas` (al menos una, con `descripcion`, `cantidad` y `precioUnitario`) | Siempre | Art. 11 num. 1 d-f |
| `cliente.nombre` y `cliente.rtn` | Si el cliente usará la factura para crédito fiscal, costo o gasto | Art. 11 num. 1 a-b |
| `cliente.nombre` y `cliente.identificacion` (o `rtn`) | Venta a consumidor final por más de L 10,000 | Art. 11, párrafo final |
| `tipoCambio` | Si `moneda` no es `HNL` | Art. 11, párrafo final |
| `exoneracion` (`ordenCompraExenta` y `constanciaRegistroExonerado`, o `registroSAG`) | Si el cliente es exonerado | Art. 11 num. 4 |

`fechaEmision` no hace falta: la pone el reloj. Con `crearFacturador`, el emisor se da una sola vez.

El umbral de L 10,000 se cambia con `umbralIdentificacionConsumidorFinal`. El SDK no infiere qué tasa lleva cada
producto: `isv` es `'ISV15'` por defecto, y `'ISV18'`, `'GRAVADO0'` o `'EXENTO'` los decide el negocio.

## Ejemplo

Una venta a un cliente con RTN, con un producto gravado y otro exento. Corre tal cual: usa el facturador de
prueba, con el emisor «Pulpería Demostración» y un CAI ficticio.

```ts
import { renderizarHTML } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo(); // en producción: crearFacturador({ almacen, emisor, … })

const factura = await caja.emitir({
  cliente: { nombre: 'Ferretería Ejemplo S. de R.L.', rtn: '99990000000002' },
  preciosIncluyenISV: true,
  condicionPago: 'CONTADO',
  lineas: [
    { descripcion: 'Clavos 2" (lb)', cantidad: '3', precioUnitario: '40.25' },
    { descripcion: 'Frijoles (lb)', cantidad: '2', precioUnitario: '28.00', isv: 'EXENTO' },
  ],
});

factura.numero;                     // '000-001-01-00000001'
factura.totales.total;              // 176.75: cobra este monto
factura.totales.baseCreditoFiscal;  // 105: solo lo gravado cuenta para el crédito fiscal
factura.advertencias[0]?.codigo;    // 'AVISO_VENTA_MIXTA'
const html = renderizarHTML(factura); // lleva la leyenda de documento de prueba
```

Sin `cliente`, el documento sale a nombre de «CONSUMIDOR FINAL». Con la API REST, el mismo contenido va en
`POST /v1/documentos`, dentro de `{ "documento": … }` y con una `Idempotency-Key` por venta; el emisor lo pone
el servidor. Ver la [referencia de la API](/referencia/api/).

:::note
El emisor y el CAI de este ejemplo son ficticios. Todo lo que emite `crearFacturadorDemo` lleva `modo: 'prueba'`
y la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Para facturar de verdad hace falta el CAI de tu
resolución.
:::

## Casos especiales

- **Cliente exonerado.** Lleva la Orden de Compra Exenta y la Constancia del Registro de Exonerados, o el número
  del registro SAG/RUPNSA del sector agroindustrial (Art. 11 num. 4). La exoneración cubre el documento
  completo: si la orden no cubre todos los artículos, emite dos facturas, una exonerada y otra normal.
- **Moneda extranjera.** `moneda: 'USD'` exige `tipoCambio`. El impreso muestra el tipo de cambio y el
  equivalente en lempiras del ISV y del total.
- **Exportación.** `isv: 'GRAVADO0'` deja la línea en la columna «gravado 0 %», distinta de lo exento.

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`SIN_AUTORIZACION`](/referencia/errores/#sin_autorizacion) | No hay CAI de tipo `01` para ese establecimiento y punto de emisión |
| [`AUTORIZACION_VENCIDA`](/referencia/errores/#autorizacion_vencida) | Pasó la fecha límite del último CAI (Art. 62) |
| [`RANGO_AGOTADO`](/referencia/errores/#rango_agotado) | Se usaron todos los números autorizados (Art. 59) |
| [`EMISOR_NOMBRE_COMERCIAL`](/referencia/errores/#emisor_nombre_comercial) | Falta el nombre comercial; si no hay otro, repite la razón social |
| [`EMISOR_CORREO`](/referencia/errores/#emisor_correo) | Falta el correo o no tiene forma `nombre@dominio` |
| [`CLIENTE_RTN`](/referencia/errores/#cliente_rtn) | El RTN no tiene 14 dígitos |
| [`CONSUMIDOR_FINAL_IDENTIFICACION`](/referencia/errores/#consumidor_final_identificacion) | Venta a consumidor final por más de L 10,000 sin nombre ni identificación |
| [`LINEA_PRECIO`](/referencia/errores/#linea_precio) | Precio con coma decimal, símbolo de moneda o error de punto flotante |
| [`LINEA_ISV`](/referencia/errores/#linea_isv) | Tratamiento de ISV que no existe |
| [`TIPO_CAMBIO`](/referencia/errores/#tipo_cambio) | Moneda extranjera sin tipo de cambio |
| [`EXONERACION_ORDEN`](/referencia/errores/#exoneracion_orden) | Cliente exonerado sin el número de la Orden de Compra Exenta |
| [`FECHA_EMISION_NO_ES_HOY`](/referencia/errores/#fecha_emision_no_es_hoy) | Se envió una fecha distinta de la de hoy: omite `fechaEmision` |

Avisos que no bloquean, pero conviene mostrar en caja:
[`AVISO_AJUSTE_CENTAVO`](/referencia/errores/#aviso_ajuste_centavo) y
[`AVISO_VENTA_MIXTA`](/referencia/errores/#aviso_venta_mixta).

Un error no consume número: la emisión se revierte entera.

## Fuentes

- Reglamento, Arts. 9-14: matriz de [cumplimiento](/referencia/cumplimiento/), filas de los Arts. 9 a 13.
- Ley del ISV, Arts. 3 y 9: misma matriz, sección «Ley del Impuesto Sobre Ventas».
