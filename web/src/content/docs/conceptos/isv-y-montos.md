---
title: ISV y montos
description: Tratamientos del ISV (15 %, 18 %, gravado 0 %, exento y exonerado), precios con ISV incluido, el redondeo del Art. 9 de la Ley del ISV y por qué los montos se calculan sin punto flotante.
sidebar:
  order: 3
---

Cada línea de un documento lleva un tratamiento del ISV. El SDK suma las líneas por tratamiento, calcula el
impuesto de cada grupo y discrimina los importes como pide el Reglamento: exonerado, exento, gravado 0 % y
gravado por tasa, con el ISV de cada tasa (Art. 11 num. 1 g-i).

Las citas son del Reglamento del Régimen de Facturación, salvo las que dicen «Ley del ISV». Ver
[Normativa](/referencia/normativa/).

## Tratamientos

| Valor de `isv` | Qué es | ISV |
|---|---|---|
| `'ISV15'` (por defecto) | Gravado a la tasa general | 15 % |
| `'ISV18'` | Gravado a la tasa del 18 % | 18 % |
| `'GRAVADO0'` | Gravado con alícuota cero: exportaciones (Art. 12) | 0, en su propia columna |
| `'EXENTO'` | Exento | Sin ISV |

**Exonerado** no es un valor de `isv`: depende del adquirente, no del producto. Con `exoneracion` en el
documento, todo lo gravado pasa a «importe exonerado», sin ISV. Ver [abajo](#exonerado).

`GRAVADO0` no es lo mismo que `EXENTO`: el Art. 11 num. 1 g pide discriminar los dos, y el documento los
imprime en columnas distintas.

El SDK no decide qué va al 18 %, qué es exento ni qué es gravado 0 %: lo indica tu sistema en cada línea,
guardado en el producto.

```js
import { calcularDocumento } from 'factura-hn';

const { totales } = calcularDocumento(
  [
    { descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' },
    { descripcion: 'Cerveza lata', cantidad: '6', precioUnitario: '32.00', isv: 'ISV18' },
    { descripcion: 'Frijoles (lb)', cantidad: '3', precioUnitario: '28.00', isv: 'EXENTO' },
  ],
  { preciosIncluyenISV: true },
);

totales.importeGravado15; // 155.65
totales.importeGravado18; // 162.71
totales.importeExento;    // 84
totales.isv15;            // 23.35
totales.isv18;            // 29.29
totales.total;            // 455
```

## El ISV se calcula por grupo de tasa

El ISV de cada tasa se calcula sobre la suma de sus líneas, no línea por línea. Así el ISV impreso siempre es
la tasa por la base impresa, y el total cuadra con la suma de importes más impuestos.

Así el impreso cuadra con los subtotales e impuestos por tarifa que pide el Art. 11 num. 1 h-i del Reglamento.

## Precios con ISV incluido

La mayoría de los POS guardan el precio de góndola, que ya trae el ISV. Indícalo con `preciosIncluyenISV: true`
en el documento (o en `crearFacturador`). El SDK separa la base y el impuesto:

```js
const { totales } = calcularDocumento(
  [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
  { preciosIncluyenISV: true },
);

totales.subtotal; // 200
totales.isv15;    // 30
totales.total;    // 230
```

Sin la opción (el valor por defecto es `false`), los precios se toman sin ISV y el impuesto se suma encima.

## El redondeo del Art. 9

El Art. 9 de la Ley del ISV fija el redondeo del impuesto: una fracción menor de medio centavo se baja y una de
medio centavo o más se puede subir. El SDK calcula siempre el ISV como la tasa por la base, redondeado así.

Con precios con ISV incluido, no todos los totales tienen una base exacta. Por ejemplo, ninguna base da un total
de L 0.27 al 15 %. En ese caso el SDK toma la mayor base cuyo total no supera el precio: el cliente paga
**un centavo menos, nunca más**. Es la regla de factura-hn para esos precios.

```js
import { calcularDocumento, sugerirPrecioSinAjuste } from 'factura-hn';

const { totales } = calcularDocumento(
  [{ descripcion: 'Dulce', cantidad: '1', precioUnitario: '0.27' }],
  { preciosIncluyenISV: true },
);
totales.total;             // 0.26
totales.ajustePorRedondeo; // 0.01

sugerirPrecioSinAjuste('0.27'); // { requiereAjuste: true, anterior: 0.26, siguiente: 0.28 }
```

Qué hacer en tu sistema:

- **Cobra `totales.total`**, no la suma de los precios. Llama a `calcularDocumento` (o `caja.cotizar`) antes de
  cobrar y muestra ese total en la caja.
- El documento emitido lleva el aviso
  [`AVISO_AJUSTE_CENTAVO`](/referencia/errores/#aviso_ajuste_centavo) cuando hubo ajuste.
- Para evitar el ajuste, usa `sugerirPrecioSinAjuste` al configurar los precios: propone el precio exacto más
  cercano hacia abajo y hacia arriba.

## Descuentos

`descuento` es un monto por línea, no un porcentaje. Reduce la base antes del ISV: según el Art. 3 de la Ley del
ISV, los descuentos efectivos que constan en la factura, siempre que sean normales según la costumbre
comercial, no forman parte de la base gravable.

```js
calcularDocumento([
  { descripcion: 'Clavos 2"', cantidad: '1', precioUnitario: '100.00', descuento: '10.00' },
]).totales;
// descuentos: 10, importeGravado15: 90, isv15: 13.5, total: 103.5
```

## Ventas mixtas y crédito fiscal

Con ventas exentas y gravadas en un mismo documento, el crédito fiscal se reconoce solo sobre las gravadas
(Art. 11 num. 3). `totales.baseCreditoFiscal` es el gravado al 15 % más el gravado al 18 %; no incluye el
gravado 0 %, que no genera ISV que acreditar.

Si el cliente tiene RTN y la venta mezcla partes exentas o exoneradas con partes gravadas, el documento lleva el
aviso [`AVISO_VENTA_MIXTA`](/referencia/errores/#aviso_venta_mixta).

## Exonerado

Los datos del adquirente exonerado son los del Art. 11 num. 4. factura-hn acepta la Orden de Compra Exenta **y**
la Constancia del Registro de Exonerados, **o** solo el registro SAG/RUPNSA del sector agroindustrial:

```js
exoneracion: { ordenCompraExenta: '…', constanciaRegistroExonerado: '…' }
// o bien
exoneracion: { registroSAG: '…' }
```

En factura-hn, la exoneración aplica al documento completo. Si la Orden de Compra Exenta no cubre todos los
artículos, emite dos facturas: una con `exoneracion` y los artículos cubiertos, y otra normal con el resto.

## Exportaciones

Una exportación de mercancías gravadas va con `isv: 'GRAVADO0'` (Art. 12), no con `EXENTO`.

El documento sigue al Art. 12 del Reglamento: tasa cero.

## Dinero exacto

El SDK no usa punto flotante en el dinero. Todo el cálculo va en enteros: centavos para los importes y
diezmilésimas para la cantidad y el precio unitario (hasta 4 decimales).

- **Pasa los montos como texto exacto**, `'89.50'`, sobre todo si vienen de la base de datos. También acepta
  números. Un precio o una cantidad con más de 4 decimales es un error
  ([`LINEA_PRECIO`](/referencia/errores/#linea_precio), [`LINEA_CANTIDAD`](/referencia/errores/#linea_cantidad)):
  no se redondea en silencio.
- **Los montos de salida** (`totales.total`, `isv15`…) son números en lempiras con dos decimales como máximo. `Math.round(monto * 100)` recupera los centavos exactos; si sumas montos de salida, pásalos antes
  a centavos. Para mostrarlos, `formatearMonto` y `formatearMoneda`; en letras, `totales.totalEnLetras` o
  `montoEnLetras`.

```js
0.1 + 0.2; // 0.30000000000000004 en JavaScript
calcularDocumento([{ descripcion: 'Bolsa', cantidad: '3', precioUnitario: '0.10' }]).totales.subtotal; // 0.3
```

Las funciones de cálculo y formato están en la [referencia del SDK](/referencia/sdk/).
