---
title: Nota de Débito (07)
description: Qué es la Nota de Débito, qué datos exige el Reglamento, en qué se diferencia de la Nota de Crédito y cómo se emite con factura-hn.
sidebar:
  order: 3
---

La Nota de Débito respalda ajustes sobre un documento ya emitido (Reglamento, Art. 4 num. 31). Su código es `07`.
El formato está en el Art. 27 y el contenido en el Art. 28. En el libro de ventas suma, al revés que la Nota de
Crédito.

## Requisitos

| Requisito | Artículo | Qué hace factura-hn |
|---|---|---|
| Denominación «Nota de Débito» y destino de los ejemplares | Art. 27 num. 2 y 7 | Se imprimen |
| Código `07` y serie propia | Art. 27 num. 5 | Necesita un CAI de tipo `07` en el mismo punto de emisión |
| Datos del emisor, CAI, rango y fecha límite vigentes | Art. 27 num. 1, 3-4 y 6 | Igual que en la factura |
| Nombre y RTN del adquirente | Art. 28 num. 1-2 | `cliente.nombre` y `cliente.rtn` obligatorios |
| CAI, número y fecha del «Comprobante Fiscal o el documento» que se modifica | Art. 28 num. 3 | `referencia: { cai, numero, fecha }` |
| Motivo | Art. 28 num. 4 | `motivo` obligatorio |
| Importe en números y letras, impuestos por tarifa, fecha, descripción y unidades | Art. 28 num. 5-7 y 9 | Igual que en la factura |
| Moneda nacional | Art. 28 num. 8 | Solo en lempiras (`NOTA_MONEDA`) |

## En qué se diferencia de la Nota de Crédito

- **Puede referir cualquier documento.** El Art. 4 num. 31 la vincula a un comprobante fiscal, pero el Art. 28
  num. 3 b dice «Comprobante Fiscal **o el documento**»: factura-hn deja que una Nota de Débito modifique una factura,
  otra Nota de Débito o una Nota de Crédito.
- **No lleva firma de quien la recibe.** Ese dato lo pide el Art. 26 num. 7 solo para la Nota de Crédito.
- **No tiene saldo.** `NOTA_SUPERA_ORIGINAL` y `NOTA_TASA_DISTINTA` se aplican solo a la Nota de Crédito, y una
  Nota de Débito no amplía el saldo disponible para notas de crédito.

Lo demás es igual que en la [Nota de Crédito](/documentos/nota-credito/): la coherencia con el original guardado
(CAI, fecha, RTN, no anulado), la fecha no anterior al original, el aviso para originales de
otro sistema y la conversión de dólares a lempiras.

## Campos obligatorios

| Campo | Notas |
|---|---|
| `tipoDocumento: '07'` | Con `crearFacturador`, lo pone `notaDebito` |
| `emisor` | Los siete datos del Art. 10 num. 1 |
| `cliente.nombre`, `cliente.rtn` | El adquirente del documento original |
| `referencia.cai`, `referencia.numero`, `referencia.fecha` | Del documento que se modifica |
| `motivo` | Queda impreso |
| `lineas` | El importe del ajuste |

## Ejemplo

Una venta a crédito y un ajuste posterior del precio:

```ts
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo();

const factura = await caja.emitir({
  cliente: { nombre: 'Ferretería Ejemplo S. de R.L.', rtn: '99990000000002' },
  preciosIncluyenISV: true,
  condicionPago: 'CREDITO',
  lineas: [{ descripcion: 'Varilla de hierro 3/8"', cantidad: '10', precioUnitario: '161.00' }],
});

const nota = await caja.notaDebito({
  original: factura.numero,
  motivo: 'Ajuste de precio de la varilla de hierro',
  lineas: [{ descripcion: 'Ajuste de precio: varilla de hierro 3/8"', cantidad: '10', precioUnitario: '11.50' }],
});

nota.numero;        // '000-001-07-00000001'
nota.totales.total; // 115
```

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`SIN_AUTORIZACION`](/referencia/errores/#sin_autorizacion) | No hay CAI de tipo `07` en ese punto de emisión |
| [`NOTA_CLIENTE_RTN`](/referencia/errores/#nota_cliente_rtn) | La nota no trae el RTN del adquirente |
| [`MOTIVO`](/referencia/errores/#motivo) | Falta el motivo |
| [`REFERENCIA`](/referencia/errores/#referencia) | Falta la referencia al documento que se modifica |
| [`REFERENCIA_FECHA_POSTERIOR`](/referencia/errores/#referencia_fecha_posterior) | La fecha del original es posterior a la de la nota |
| [`REFERENCIA_ANULADA`](/referencia/errores/#referencia_anulada) | El original está anulado |
| [`REFERENCIA_RTN_NO_COINCIDE`](/referencia/errores/#referencia_rtn_no_coincide) | El RTN de la nota no es el del original |
| [`NOTA_MONEDA`](/referencia/errores/#nota_moneda) | Se pidió la nota en dólares |

Avisos: [`AVISO_ORIGINAL_EXTERNO`](/referencia/errores/#aviso_original_externo) y
[`AVISO_ORIGINAL_SIN_RTN`](/referencia/errores/#aviso_original_sin_rtn).

## Fuentes

- Reglamento, Arts. 4 num. 31, 27 y 28. En la [matriz de cumplimiento](/referencia/cumplimiento/), busca esos
  artículos: cada uno tiene su estado y la prueba que lo verifica.
