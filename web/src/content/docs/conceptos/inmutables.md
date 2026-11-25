---
title: Documentos inmutables
description: Un documento emitido no se borra ni se edita. Cómo se corrige — anulación con la leyenda ANULADA (Art. 41) o nota de crédito o de débito — y cómo se reimprime.
sidebar:
  order: 4
---

Un documento emitido no cambia. Su número no se borra ni se reutiliza, y su contenido no se edita. Si algo
estuvo mal, se corrige con otro acto que queda en el archivo: una **anulación** o una **nota**.

Los almacenes de Postgres y SQLite lo hacen cumplir con disparadores en la base: no se pueden borrar documentos
ni autorizaciones, un documento emitido solo puede pasar a ANULADO y la serie nunca retrocede, aunque alguien
edite la base a mano. Ver [Almacén fiscal](/conceptos/almacen/).

## Qué camino usar

| Caso | Qué hacer |
|---|---|
| El documento tuvo un error: cantidad, cliente, precio | Anularlo (Art. 41) y emitir uno nuevo |
| La venta fue correcta y después hubo una devolución o un descuento | Nota de Crédito (`06`) sobre el documento |
| Hay que hacer un ajuste a una operación ya facturada | Nota de Débito (`07`) |
| Algo falló **después** de emitir: la impresión, el cobro | Anular. El número ya existe; no se borra |

Las citas son del Reglamento del Régimen de Facturación. Ver [Normativa](/referencia/normativa/).

## Anular (Art. 41)

El Art. 41 trata los documentos emitidos con errores: llevan la leyenda **«ANULADA»** y se resguardan el
original y la copia, en orden cronológico.

```js
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo();
const factura = await caja.emitir({
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '20', precioUnitario: '89.50' }],
});

const anulada = await caja.anular(factura.numero, 'Error en la cantidad');
anulada.estado;    // "ANULADO"
anulada.anulacion; // { motivo: 'Error en la cantidad', fecha: '…', hora: '…' }
```

Sin la fachada, la misma operación es `anular(numero, { almacen, motivo })`.

Qué pasa al anular:

- el documento se guarda con `estado: 'ANULADO'` y conserva su número, su contenido y su fecha;
- el HTML, el texto y el PDF imprimen la leyenda ANULADA;
- el número sigue consumido: la siguiente venta toma el siguiente número;
- en el libro de ventas, el anulado sale con su número y los montos en cero;
- queda en la bitácora un `DOCUMENTO_ANULADO`, con `actor` y `operador` si los pasas.

El motivo es obligatorio. No lo exige el Art. 41, que solo pide la leyenda: lo pide el SDK para la bitácora de
auditoría (Art. 53 num. 2; DEC-001). Anular dos veces da
[`YA_ANULADO`](/referencia/errores/#ya_anulado), y un número que no existe,
[`DOCUMENTO_NO_ENCONTRADO`](/referencia/errores/#documento_no_encontrado).

## Corregir con una nota

La Nota de Crédito sirve para ajustes, devoluciones, descuentos posteriores y anulación de operaciones; la Nota
de Débito, para ajustes (Art. 4 num. 31-32). Cada una tiene su propio código (`06` y `07`) y su propia serie
(Arts. 25 y 27), así que necesita su propio CAI registrado en la caja.

```js
const venta = await caja.emitir({
  cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }],
});

// Devolución de 1 bolsa. El cliente, la referencia y la moneda se toman de la factura guardada.
const nota = await caja.notaCredito({
  original: venta.numero,
  motivo: 'Devolución de 1 bolsa',
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }],
});
nota.numero;     // "000-001-06-00000001"
nota.referencia; // { cai, numero, fecha } de la factura
```

`caja.notaDebito` funciona igual. Sin la fachada, se emite con `emitir` y `tipoDocumento: '06'` o `'07'`, con
`referencia` y `motivo`.

Lo que exige una nota:

- **el nombre y el RTN del adquirente**, sin la opción de CONSUMIDOR FINAL (Arts. 26 y 28 num. 1-2);
- **el CAI, el número y la fecha** del documento que modifica, y el motivo (Arts. 26 y 28 num. 3-4);
- **moneda nacional** (Arts. 26 num. 9 y 28 num. 8). Si la factura fue en dólares, escribe las líneas en dólares:
  la nota se emite en lempiras con el tipo de cambio de la factura (DEC-018).

Si el original está en el almacén, el SDK comprueba además que no esté anulado y que su CAI, su fecha y su RTN
coincidan con los de la nota (DEC-004). Si no está (un talonario, otro sistema), la nota se emite con la
referencia completa y el aviso [`AVISO_ORIGINAL_EXTERNO`](/referencia/errores/#aviso_original_externo).

La suma de las notas de crédito sobre un documento no puede superar su total
([`NOTA_SUPERA_ORIGINAL`](/referencia/errores/#nota_supera_original), con el saldo en el mensaje), ni llevar
ISV a una tasa que el original no tenía ([`NOTA_TASA_DISTINTA`](/referencia/errores/#nota_tasa_distinta)).

:::note[Interpretación pendiente]
Ese tope de las notas de crédito es una regla derivada del Art. 4 num. 32, no un texto literal: DEC-051
[REVISAR]. Los usos concretos de la Nota de Débito (intereses, fletes, diferencias de precio) también están
por confirmar con un contador (F-19).
:::

Los detalles de cada tipo de documento están en [Documentos](/documentos/).

## Reimprimir

Reimprime siempre desde el documento guardado, sin recalcular. La copia es idéntica al original (Art. 38):

```js
const guardada = await caja.documento(venta.numero); // o buscarDocumento(almacen, numero)
```

## La fecha tampoco se elige

La fecha de emisión la pone el reloj, en hora de Honduras. No se puede retrofechar: un documento con una fecha
equivocada se anula y se emite otro. Ver [Reloj y fechas](/conceptos/reloj-y-fechas/).

Las funciones `anular`, `emitir` y `buscarDocumento` están en la [referencia del SDK](/referencia/sdk/).
