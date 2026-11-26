---
title: Nota de Crédito (06)
description: Cuándo se emite una Nota de Crédito, qué datos exige el Reglamento, cómo la valida factura-hn contra el original y qué pasa con documentos de otro sistema.
sidebar:
  order: 2
---

La Nota de Crédito respalda ajustes, devoluciones, descuentos posteriores y la anulación de operaciones sobre un
comprobante fiscal ya emitido (Reglamento, Art. 4 num. 32). Su código es `06`. El formato está en el Art. 25 y el
contenido en el Art. 26.

Se usa cuando **la venta fue correcta** y después cambia algo: el cliente devuelve mercadería o se le concede un
descuento. Si el documento tuvo un error al emitirse, se anula y se emite otro (Art. 41). La diferencia está en
[Anular o emitir una nota](/guias/anular/).

## Requisitos

| Requisito | Artículo | Qué hace factura-hn |
|---|---|---|
| Vinculada a un comprobante fiscal | Art. 4 num. 32; Art. 6 | `REFERENCIA_TIPO` si el original no es un comprobante fiscal |
| Denominación «Nota de Crédito» y destino de los ejemplares | Art. 25 num. 2 y 7 | Se imprimen |
| Código `06` y serie propia | Art. 25 num. 5 | Necesita un CAI de tipo `06` en el mismo punto de emisión |
| Datos del emisor, CAI, rango y fecha límite vigentes | Art. 25 num. 1, 3-4 y 6 | Igual que en la factura |
| Nombre y RTN del adquirente, sin la opción «CONSUMIDOR FINAL» | Art. 26 num. 1-2 | `cliente.nombre` y `cliente.rtn` obligatorios |
| CAI, número y fecha del documento que se modifica | Art. 26 num. 3 | `referencia: { cai, numero, fecha }` |
| Motivo | Art. 26 num. 4 | `motivo` obligatorio |
| Importe en números y letras, impuestos por tarifa, fecha, descripción y unidades | Art. 26 num. 5-6, 8 y 10 | Igual que en la factura |
| Nombre, identidad y firma de quien recibe la nota | Art. 26 num. 7 | El impreso deja los tres campos en blanco para llenarlos a mano |
| Moneda nacional | Art. 26 num. 9 | Solo en lempiras (`NOTA_MONEDA`) |

## Campos obligatorios

| Campo | Notas |
|---|---|
| `tipoDocumento: '06'` | Con `crearFacturador`, lo pone `notaCredito` |
| `emisor` | Los siete datos del Art. 10 num. 1, como en la factura |
| `cliente.nombre`, `cliente.rtn` | El adquirente del documento original |
| `referencia.cai`, `referencia.numero`, `referencia.fecha` | Del documento original. Con `notaCredito`, se toman del original guardado |
| `motivo` | Queda impreso |
| `lineas` | Lo que se devuelve o descuenta, con el mismo tratamiento de ISV que en el original |

## Ejemplo

Una venta de cuatro bolsas de cemento y la devolución de una. `notaCredito` toma del original guardado el
cliente, la referencia, la moneda y si los precios incluyen ISV.

```ts
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo(); // trae CAI ficticios de 01, 06 y 07

const factura = await caja.emitir({
  cliente: { nombre: 'Ferretería Ejemplo S. de R.L.', rtn: '99990000000002' },
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Cemento gris (bolsa)', cantidad: '4', precioUnitario: '230.00' }],
});

const nota = await caja.notaCredito({
  original: factura.numero,
  motivo: 'Devolución de 1 bolsa dañada',
  lineas: [{ descripcion: 'Cemento gris (bolsa)', cantidad: '1', precioUnitario: '230.00' }],
});

nota.numero;            // '000-001-06-00000001': la serie 06 es propia
nota.referencia?.numero; // '000-001-01-00000001'
nota.totales.total;     // 230
```

Con `emitir` directamente, la nota lleva todos los datos. Es el ejemplo de la
[referencia del SDK](/referencia/sdk/):

<!-- declaraciones:
import type { AlmacenFiscal, DocumentoFiscal, Emisor } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const emisor: Emisor;
declare const original: DocumentoFiscal;
-->
```ts
import { emitir } from 'factura-hn';

const nota = await emitir(
  {
    tipoDocumento: '06',
    emisor,
    cliente: { nombre: original.cliente.nombreImpreso, rtn: original.cliente.rtn },
    referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision },
    motivo: 'Devolución de mercadería',
    preciosIncluyenISV: original.preciosIncluyenISV,
    lineas: [{ descripcion: 'Cemento gris (bolsa)', cantidad: '1', precioUnitario: '230.00' }],
  },
  { almacen, establecimiento: '000', puntoEmision: '001' },
);
```

## Coherencia con el original

Si el original está en el mismo almacén, `emitir` lo compara con la nota. Estas reglas son errores: la nota no
se emite y no consume número.

- **El original existe y no está anulado.** Un documento anulado no respalda una operación que ajustar:
  `REFERENCIA_ANULADA` (el Art. 41 trata el anulado como un documento con errores).
- **Mismo CAI, fecha y RTN del adquirente** (Art. 26 num. 1-3):
  `REFERENCIA_CAI_NO_COINCIDE`, `REFERENCIA_FECHA_NO_COINCIDE`, `REFERENCIA_RTN_NO_COINCIDE`.
- **La nota no es anterior al original**: `REFERENCIA_FECHA_POSTERIOR`.
- **Mismo modo.** Una nota de prueba no modifica un documento real, ni al revés: `REFERENCIA_MODO_MEZCLADO`.
  Esta regla es del producto, no fiscal.

### El saldo del original

La suma de las notas de crédito vigentes sobre un documento no puede superar su total. Si la nueva lo supera,
`NOTA_SUPERA_ORIGINAL` dice en el mensaje el total, lo ya acreditado y el saldo disponible. Una nota anulada
libera su importe; una nota de débito no amplía el saldo. Un original en dólares se compara en lempiras, con su
tipo de cambio.

La nota tampoco puede llevar ISV a una tasa que el original no tenía, importe exento o gravado al 0 % que el
original no tenía, ni ISV sobre un original exonerado (`NOTA_TASA_DISTINTA`). Usa en cada línea el mismo tratamiento de ISV que en el original.

factura-hn no deja que las notas superen el saldo del documento original ni cambien su tasa.

## El RTN del adquirente

Toda nota lleva nombre y RTN del adquirente (Art. 26 num. 1-2). Por eso una devolución sobre una factura a
«CONSUMIDOR FINAL» falla con `NOTA_CLIENTE_RTN` y `CLIENTE_NOMBRE` mientras no indiques un cliente.

Si pasas `cliente` con nombre y RTN y el original no tenía RTN, la nota se emite con
`AVISO_ORIGINAL_SIN_RTN`: confirma que es el mismo cliente.

## Documentos que no están en este sistema

Una nota puede modificar un documento emitido en un talonario de imprenta, en otro sistema o antes de migrar a
factura-hn. Como no hay con qué compararlo, se emite con la referencia completa y el aviso
`AVISO_ORIGINAL_EXTERNO`. Revisa a mano que la referencia y el cliente coinciden con el papel.

<!-- declaraciones:
import type { Facturador } from 'factura-hn';
declare const caja: Facturador;
-->
```ts
// El original es la factura 57 de otra caja, emitida en papel. Sus datos se copian del documento.
const nota = await caja.notaCredito({
  original: '000-002-01-00000057',
  referencia: { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', fecha: '2026-11-02' },
  cliente: { nombre: 'Ferretería Ejemplo S. de R.L.', rtn: '99990000000002' },
  motivo: 'Descuento por pronto pago',
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Descuento por pronto pago', cantidad: '1', precioUnitario: '50.00' }],
});
nota.advertencias.map((a) => a.codigo); // ['AVISO_ORIGINAL_EXTERNO']
```

Con un original externo no se puede comprobar el saldo ni la tasa.

- **Números que este sistema administra.** Si el número del original cae en una autorización registrada aquí y
  todavía no se emitió, el documento no puede existir: `REFERENCIA_NO_EXISTE`.
- **Series migradas.** Para una serie que se emitió en parte fuera de factura-hn, la autorización acepta
  `ultimoEmitidoAntes`. Los números hasta ese valor cuentan como externos y la serie sigue en el siguiente.
- **Con la API REST**, una nota sobre un original externo exige una llave admin. Con una llave de caja la
  respuesta es 403 `SOLO_ADMIN` y no se consume número. Es una política de seguridad de la API, no una regla
  fiscal.

## Moneda extranjera

La nota se emite en lempiras (Art. 26 num. 9). Si el original está en dólares, escribe las líneas de la nota en
dólares: se convierten con el tipo de cambio del original, que la nota imprime como referencia. Sus importes se
convierten igual que el libro de ventas convierte el original (columna por columna), así que una nota con las
mismas líneas lo acredita entero. Con el original
en el almacén, la moneda y el tipo de cambio se toman de él. Con un original externo, indica
`referencia.moneda` y `referencia.tipoCambio`.

## En el libro de ventas

En `libroVentas` y `filaLibroVentas`, los importes de una Nota de Crédito van con signo negativo: restan de las
ventas del período. Una nota anulada sale con su número y montos en cero.

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`SIN_AUTORIZACION`](/referencia/errores/#sin_autorizacion) | No hay CAI de tipo `06` en ese punto de emisión |
| [`NOTA_CLIENTE_RTN`](/referencia/errores/#nota_cliente_rtn) | El original se emitió a consumidor final y la nota no trae RTN |
| [`REFERENCIA`](/referencia/errores/#referencia) | Falta la referencia al documento original |
| [`MOTIVO`](/referencia/errores/#motivo) | Falta el motivo |
| [`NOTA_SUPERA_ORIGINAL`](/referencia/errores/#nota_supera_original) | La nota, sumada a las anteriores, supera el total del original |
| [`NOTA_TASA_DISTINTA`](/referencia/errores/#nota_tasa_distinta) | La nota lleva ISV a otra tasa, exento o 0 % que el original no tenía, o ISV sobre un original exonerado |
| [`REFERENCIA_ANULADA`](/referencia/errores/#referencia_anulada) | El original está anulado |
| [`REFERENCIA_FECHA_NO_COINCIDE`](/referencia/errores/#referencia_fecha_no_coincide) | La fecha de la referencia no es la del original guardado |
| [`REFERENCIA_TIPO`](/referencia/errores/#referencia_tipo) | El original no es un comprobante fiscal |
| [`NOTA_MONEDA`](/referencia/errores/#nota_moneda) | Se pidió la nota en dólares |

Avisos: [`AVISO_ORIGINAL_EXTERNO`](/referencia/errores/#aviso_original_externo) y
[`AVISO_ORIGINAL_SIN_RTN`](/referencia/errores/#aviso_original_sin_rtn).

## Fuentes

- Reglamento, Arts. 4 num. 32, 6, 25, 26 y 41. En la [matriz de cumplimiento](/referencia/cumplimiento/), busca
  esos artículos: cada uno tiene su estado y la prueba que lo verifica.
