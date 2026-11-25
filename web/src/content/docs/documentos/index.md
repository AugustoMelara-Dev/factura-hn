---
title: Tipos de documento
description: Los diez códigos de tipo de documento del Reglamento de Facturación y cuáles emite factura-hn hoy, con el artículo que lo explica.
sidebar:
  order: 0
  label: Los 10 códigos
---

El Reglamento del Régimen de Facturación (Acuerdo 481-2017) asigna a cada documento fiscal un código de dos
dígitos. Ese código va en el número de cada documento: `000-001-01-00000042` es una factura (tipo `01`) del
establecimiento `000` y el punto de emisión `001` (Art. 10 num. 7).

La tabla vigente es la del texto consolidado, reformada por el Acuerdo 609-2017. Algunas fuentes todavía usan la
tabla original de 2017 (03 Ticket, 07 Nota de Crédito, 08 Nota de Débito). factura-hn no toma ningún código de
esa tabla derogada.

## Los diez códigos

| Código | Documento | Lo regula | En factura-hn | Por qué |
|---|---|---|---|---|
| `01` | [Factura](/documentos/factura/) | Art. 10 | **Se emite** | Comprobante fiscal principal del autoimpresor |
| `04` | Recibo por Honorarios Profesionales | Art. 18 | **No se emite** | Solo por imprenta (Art. 46) |
| `05` | Comprobante de Retención | Art. 33 | Pendiente | Falta el cálculo y la impresión; sus requisitos no están analizados en el proyecto |
| `06` | [Nota de Crédito](/documentos/nota-credito/) | Art. 25 | **Se emite** | Devoluciones, descuentos y anulación de operaciones (Art. 4 num. 32) |
| `07` | [Nota de Débito](/documentos/nota-debito/) | Art. 27 | **Se emite** | Ajustes que aumentan el monto (Art. 4 num. 31) |
| `08` | Guía de Remisión | Art. 29 | Pendiente | Igual que el 05 |
| `09` | Ticket | Art. 17 | **No se emite** | Solo por máquina registradora (Art. 4 num. 43) |
| `10` | Factura Prevalorada | Art. 15 | **No se emite** | Solo por imprenta (Art. 46) |
| `11` | Boleta de Compra | Art. 20 | Pendiente | Igual que el 05 |
| `12` | Constancia de Donación | Art. 23 | **No se emite** | Excluida de la modalidad de autoimpresor (Art. 47) |

Los artículos de la columna «Lo regula» son los que cita el tipo `CodigoTipoDocumento` del SDK. Los del 05, 08 y
11 dicen dónde están sus requisitos; el proyecto todavía no los ha resumido. La explicación de cada tipo que no se
emite, y lo que haría falta, está en [Documentos que factura-hn no emite](/documentos/no-emitibles/).

## Tres estados, tres respuestas del SDK

- **Se emite (`01`, `06`, `07`).** Es el tipo `TipoDocumentoSoportado`. Cada uno necesita su propio CAI
  registrado para el mismo establecimiento y punto de emisión: la autorización es por punto de emisión y por tipo
  de documento (Art. 59).
- **Pendiente (`05`, `08`, `11`).** La numeración los reconoce: `parsearNumero` lee una referencia a ellos. Pedir
  que se emitan da `TIPO_NO_SOPORTADO`.
- **No emitible por sistema (`04`, `09`, `10`, `12`).** El Reglamento los reserva a otra modalidad. Pedir que se
  emitan da `TIPO_NO_EMITIBLE`, con el artículo en el mensaje. Esto no va a cambiar con una versión nueva.

Puedes preguntarle al SDK por cada código sin emitir nada:

```ts
import { problemaDeTipo, TIPOS_DOCUMENTO } from 'factura-hn';

// Las claves se ordenan a mano: en un objeto JavaScript, '10', '11' y '12' salen antes que '01'.
for (const codigo of Object.keys(TIPOS_DOCUMENTO).sort()) {
  const problema = problemaDeTipo(codigo);
  console.log(codigo, TIPOS_DOCUMENTO[codigo as keyof typeof TIPOS_DOCUMENTO], problema?.codigo ?? 'se emite');
}
// 01 Factura se emite
// 04 Recibo por Honorarios Profesionales TIPO_NO_EMITIBLE
// 05 Comprobante de Retención TIPO_NO_SOPORTADO
// …
```

`TIPOS_NO_EMITIBLES_POR_SISTEMA` trae el motivo de cada tipo no emitible, con su artículo. El SDK lo usa para el
mensaje de `TIPO_NO_EMITIBLE`.

## Comprobantes fiscales y documentos complementarios

El Art. 6 llama **comprobantes fiscales** a la Factura (`01`), la Factura Prevalorada (`10`), el Ticket (`09`), el
Recibo por Honorarios (`04`), la Boleta de Compra (`11`) y la Constancia de Donación (`12`). El SDK los tiene en
`COMPROBANTES_FISCALES`. La distinción importa para las notas:

- una Nota de Crédito solo puede modificar un comprobante fiscal (Art. 4 num. 32); si no, `REFERENCIA_TIPO`;
- una Nota de Débito puede referir «el Comprobante Fiscal o el documento» (Art. 28 num. 3 b). El proyecto lo lee
  como cualquier tipo de documento (DEC-016, aprobada).

## Errores de esta página

| Código | Cuándo |
|---|---|
| [`TIPO_NO_EMITIBLE`](/referencia/errores/#tipo_no_emitible) | Se pidió un 04, 09, 10 o 12 |
| [`TIPO_NO_SOPORTADO`](/referencia/errores/#tipo_no_soportado) | Se pidió un 05, 08 u 11 |
| [`TIPO_DOCUMENTO`](/referencia/errores/#tipo_documento) | La autorización trae un código que no está en la tabla vigente |
| [`SIN_AUTORIZACION`](/referencia/errores/#sin_autorizacion) | No hay CAI registrado para ese tipo en ese punto de emisión |
| [`REFERENCIA_TIPO`](/referencia/errores/#referencia_tipo) | Una Nota de Crédito refiere a un documento que no es un comprobante fiscal |

## Fuentes

- Tabla de códigos: `TIPOS_DOCUMENTO` y `CodigoTipoDocumento` en el núcleo; matriz de cumplimiento, filas 4.43,
  17, 25-28, 46 y 47 ([cumplimiento](/referencia/cumplimiento/)).
- Tipos no emitibles: `TIPOS_NO_EMITIBLES_POR_SISTEMA`; [normativa](/referencia/normativa/), «Fuera de alcance».
- Interpretaciones: DEC-016 en [decisiones](/referencia/decisiones/).
