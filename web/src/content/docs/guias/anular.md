---
title: Anular o emitir una nota
description: Cuándo se anula un documento (Art. 41) y cuándo se emite una Nota de Crédito o de Débito, cómo se hace cada cosa con factura-hn y qué pasa con el número.
sidebar:
  order: 7
---

Un documento emitido no se borra ni se edita. Hay dos caminos para corregirlo, y elegir el equivocado deja el
archivo fiscal mal:

| Situación | Camino | Base |
|---|---|---|
| El documento **tuvo un error** al emitirse: cantidad, precio, cliente, fecha | **Anular** y, si la venta fue real, emitir uno nuevo | Art. 41 |
| La venta **fue correcta** y después hay una devolución, un descuento o se deshace la operación | **[Nota de Crédito](/documentos/nota-credito/)** sobre el documento | Art. 4 num. 32 |
| La venta fue correcta y después hay un ajuste sobre el documento | **Nota de Débito** (los casos admitidos están [por confirmar](/documentos/nota-debito/)) | Art. 4 num. 31 |
| Algo falló **después** de emitir: la impresión o el cobro | **Anular** | Art. 41 |

## Anular

El Art. 41 trata los documentos emitidos con errores: llevan la leyenda «ANULADA» y se resguardan el original y la
copia, en orden cronológico. En factura-hn:

- `anular` guarda el documento con `estado: 'ANULADO'`, el motivo y la fecha de la anulación;
- **el número sigue consumido**: no se reutiliza ni se borra, y la serie no tiene huecos;
- el documento conserva su contenido, su fecha y su CAI; al imprimirse lleva «ANULADA» al inicio y al final;
- el motivo es obligatorio y queda en el documento y en la bitácora, con quién anuló.

```ts
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo();
const venta = { lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }] };

const conError = await caja.emitir(venta);   // se cobró 2 y eran 3
const anulado = await caja.anular(conError.numero, 'Error en la cantidad', { operador: 'Supervisor' });
anulado.estado; // 'ANULADO'

// La venta fue real: se emite un documento nuevo, con otro número y la fecha de hoy.
const correcto = await caja.emitir({ lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '3', precioUnitario: '89.50' }] });
```

Con `emitir` y `anular` directamente:

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { anular } from 'factura-hn';

await anular('000-001-01-00000001', { almacen, motivo: 'Error en la cantidad', actor: 'supervisor' });
```

Con la API: `POST /v1/documentos/{numero}/anular` con `{ "motivo": "…" }`. Requiere la llave admin: una caja no
anula por su cuenta. Con `@factura-hn/cliente`: `fhn.anular(numero, motivo, { operador })`.

**Después de anular:**

- Si la venta fue real, emite un documento nuevo con los datos correctos. La fecha será la de hoy: no se
  retrofecha.
- Recupera el original del cliente cuando sea posible: el Art. 41 pide resguardar el original y la copia.
- En el libro de ventas, el anulado sale con su número y montos en cero. En la exportación de texto, con sus
  importes originales y `estado = ANULADO`. Ver [Reportes del mes](/guias/reportes/).

### Cuando algo falla después de emitir

`emitir` reserva el número y guarda el documento en una sola transacción: si falla la validación o tu
`alEmitir`, no se consume número. Pero si el documento ya se confirmó y **después** falla la impresión o el pago,
el número existe. No lo borres: anúlalo.

### Varios documentos con fecha errónea

Si una caja emitió con el reloj adelantado, `corregirFechaAdelantada` anula en una transacción todos los
documentos de la serie con fecha futura. Ver [Reloj adelantado o atrasado](/guias/reloj/).

## Emitir una nota

Si la venta fue correcta, el documento no se anula: se ajusta con una nota que lo refiere. La nota tiene su propio
número, su propia serie (`06` o `07`) y su propio CAI (Art. 59).

<!-- declaraciones:
import type { Facturador } from 'factura-hn';
declare const caja: Facturador;
declare const numeroFactura: string;
-->
```ts
// El cliente con RTN devuelve una unidad de una venta correcta.
const nota = await caja.notaCredito({
  original: numeroFactura,
  cliente: { nombre: 'Ferretería Ejemplo S. de R.L.', rtn: '99990000000002' },
  motivo: 'Devolución de 1 unidad',
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }],
});
```

Una Nota de Crédito necesita el RTN del adquirente (Art. 26 num. 1-2) y no puede superar el saldo del original
(lectura de factura-hn del Art. 4 num. 32: la nota ajusta el comprobante correspondiente).
Los detalles están en [Nota de Crédito](/documentos/nota-credito/).

## Lo que no se puede hacer

- **Anular dos veces.** Da `YA_ANULADO`. No hace falta hacer nada.
- **Emitir una nota sobre un documento anulado.** Da `REFERENCIA_ANULADA`: un anulado no respalda una operación
  que ajustar (el Art. 41 trata el anulado como un documento con errores). Si la venta sigue vigente, refiere al documento que la respalda.
- **Editar o borrar.** Los almacenes de SQLite y Postgres lo impiden con disparadores en la base, aunque alguien
  la edite a mano: un documento emitido solo puede pasar a ANULADO.

Anular una Nota de Crédito libera su importe: el saldo del original vuelve a estar disponible para otra nota.

Una devolución no es un error de emisión: no se anula, se hace con una nota de crédito.

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`ANULACION_MOTIVO`](/referencia/errores/#anulacion_motivo) | Se pidió anular sin motivo |
| [`YA_ANULADO`](/referencia/errores/#ya_anulado) | El documento ya estaba anulado |
| [`DOCUMENTO_NO_ENCONTRADO`](/referencia/errores/#documento_no_encontrado) | El número no está en el almacén: 16 dígitos con guiones |
| [`REFERENCIA_ANULADA`](/referencia/errores/#referencia_anulada) | Se intentó emitir una nota sobre un documento anulado |
| [`SOLO_ADMIN`](/referencia/errores/#solo_admin) | Con la API, anular requiere la llave admin |

## Fuentes

- Reglamento, Arts. 4 num. 31-32, 14, 26, 41 y 43: matriz de [cumplimiento](/referencia/cumplimiento/), filas
  4.31-32, 26 y 41.
- `anular` y `corregirFechaAdelantada` en el núcleo; [Documentos inmutables](/conceptos/inmutables/).
- Lecturas de factura-hn donde la norma no es literal: [Estado legal](/produccion/estado-legal/).
