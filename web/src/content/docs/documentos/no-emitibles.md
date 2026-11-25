---
title: Documentos que factura-hn no emite
description: Por qué factura-hn no emite los tipos 04, 09, 10 y 12, qué falta para emitir el 05, el 08 y el 11, y qué puede hacer un negocio mientras tanto.
sidebar:
  order: 4
  label: No emitibles y pendientes
---

factura-hn es software para la modalidad de **autoimpresor por sistema computarizado** (Reglamento, Art. 47). De
los diez tipos de documento, emite tres: Factura (`01`), Nota de Crédito (`06`) y Nota de Débito (`07`). Los
otros siete se dividen en dos grupos:

- **No emitibles por sistema (`04`, `09`, `10`, `12`).** El Reglamento los reserva a otra modalidad. Ninguna
  versión de factura-hn los va a emitir. El SDK responde `TIPO_NO_EMITIBLE`.
- **Pendientes (`05`, `08`, `11`).** Están en la hoja de ruta. Hoy el SDK responde `TIPO_NO_SOPORTADO`.

Los siete códigos se reconocen al leer un número o una referencia (`parsearNumero('000-001-09-00000001')` funciona).
Lo que no se puede es emitirlos.

```ts
import { problemaDeTipo } from 'factura-hn';

problemaDeTipo('09')?.mensaje;
// 'Un sistema computarizado no puede emitir el tipo 09: el Ticket se emite exclusivamente por máquinas
//  registradoras (Art. 4 num. 43).'
problemaDeTipo('05')?.codigo; // 'TIPO_NO_SOPORTADO'
problemaDeTipo('01');         // null: se emite
```

## No emitibles por sistema

### 04 · Recibo por Honorarios Profesionales

- **Lo regula:** Art. 18.
- **Por qué no:** el Art. 46 dice que se emite «exclusivamente bajo la modalidad de imprenta».
- **Qué haría falta:** emitirlo en formularios de una imprenta autorizada. El Registro Fiscal de Imprentas está en
  los Arts. 66-70. No es algo que un sistema computarizado pueda hacer.

:::caution[Por confirmar con fuente]
El repositorio no dice si un profesional independiente puede facturar sus servicios con una Factura (`01`) como
autoimpresor en lugar del Recibo por Honorarios, ni cómo se tratan el ISV y las retenciones sobre honorarios. Consulta con tu contador.
:::

### 09 · Ticket

- **Lo regula:** Art. 17.
- **Por qué no:** el Ticket se emite «exclusivamente para consumidores finales a través de máquinas registradoras»
  (Art. 4 num. 43).
- **Qué haría falta:** una máquina registradora autorizada. Un sistema computarizado emite **Factura** también a
  consumidor final: omite `cliente` y el documento sale a nombre de «CONSUMIDOR FINAL» (Art. 11 num. 2 a).

Un ticket de 80 mm impreso por factura-hn no es un Ticket (`09`): es una Factura (`01`) en papel angosto. Ver
[Imprimir](/guias/imprimir/).

### 10 · Factura Prevalorada

- **Lo regula:** Art. 15.
- **Por qué no:** igual que el Recibo por Honorarios, se emite «exclusivamente bajo la modalidad de imprenta»
  (Art. 46).
- **Qué haría falta:** formularios de una imprenta autorizada (Arts. 66-70).

### 12 · Constancia de Donación

- **Lo regula:** Art. 23.
- **Por qué no:** el Art. 47 la excluye de la modalidad de autoimpresor.
- **Qué haría falta:** emitirla por otra modalidad.

:::caution[Por confirmar con fuente]
El Art. 46 no nombra a la Constancia de Donación entre los documentos exclusivos de imprenta. El repositorio no
resume qué modalidad le corresponde. Confírmalo con tu contador o con el SAR.
:::

## Pendientes

El 05, el 08 y el 11 sí pueden emitirse desde un sistema: el Reglamento no los reserva a otra modalidad. Esa es la
lectura que aplica factura-hn. factura-hn
todavía no los emite.

| Código | Documento | Lo regula |
|---|---|---|
| `05` | Comprobante de Retención | Art. 33 |
| `08` | Guía de Remisión | Art. 29 |
| `11` | Boleta de Compra | Art. 20 |

Para emitir cualquiera de los tres haría falta, en este orden:

1. **Sus requisitos, artículo por artículo**, con la línea del texto consolidado que los sostiene, como ya está
   hecho para la factura y las notas en la matriz de cumplimiento. Por ahora, factura-hn solo sabe en qué
   artículos están (33, 29 y 20), no qué exige cada uno.
2. **Cuándo son obligatorios.** Por ejemplo, si una ferretería debe emitir Guía de Remisión al despachar
   mercadería.
3. **Su cálculo y su impresión en el núcleo**, con una prueba por requisito, y el tipo agregado a
   `TipoDocumentoSoportado`.
4. **Un CAI de ese tipo** por cada punto de emisión que lo emita (Art. 59).

:::caution[Por confirmar con fuente]
Los requisitos de contenido de estos tres documentos y los casos en que son obligatorios no están analizados en
el repositorio. Esta
página no los resume para no inventarlos.
Mientras factura-hn no los emita, qué hacer con cada uno es una pregunta para tu contador.
:::

## Errores de esta página

| Código | Cuándo |
|---|---|
| [`TIPO_NO_EMITIBLE`](/referencia/errores/#tipo_no_emitible) | Se pidió un 04, 09, 10 o 12 |
| [`TIPO_NO_SOPORTADO`](/referencia/errores/#tipo_no_soportado) | Se pidió un 05, 08 u 11 |

## Fuentes

- `TIPOS_NO_EMITIBLES_POR_SISTEMA` y `problemaDeTipo` en el núcleo.
- Matriz de [cumplimiento](/referencia/cumplimiento/), filas 4.43, 17, 46 y 47.
- [Normativa](/referencia/normativa/), «Fuera de alcance».
