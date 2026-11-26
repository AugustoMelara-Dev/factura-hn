---
title: Imprimir y reimprimir
description: Cómo imprimir un documento de factura-hn en carta, en ticket de 80 mm, en PDF o como texto para una impresora térmica, y cómo reimprimirlo idéntico.
sidebar:
  order: 1
---

Un documento emitido se imprime desde el objeto que devuelve `emitir` o desde el que está guardado en el almacén.
Las tres salidas imprimen los mismos datos de los Arts. 10 y 11 del Reglamento.

| Salida | Función | Para qué |
|---|---|---|
| HTML carta o ticket | `renderizarHTML(doc, { formato })` | Navegador, vista previa, «Imprimir» del sistema operativo |
| Texto de 32, 42 o 48 columnas | `renderizarTexto(doc, { ancho })` | Impresora térmica en modo texto |
| PDF carta o ticket de 80 mm | `renderizarPDF(doc, { formato })` de `@factura-hn/pdf` | Correo, descarga, archivo |

## Ejemplo

```ts
import { renderizarHTML, renderizarTexto } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';
import { renderizarPDF } from '@factura-hn/pdf'; // npm install @factura-hn/pdf

const caja = await crearFacturadorDemo();
const { numero } = await caja.emitir({
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
});

const doc = await caja.documento(numero); // lo guardado: la fuente de toda impresión
if (doc) {
  const carta = renderizarHTML(doc);                          // carta, por defecto
  const ticketHTML = renderizarHTML(doc, { formato: 'ticket' }); // 80 mm
  const ticket = renderizarTexto(doc, { ancho: 42 });          // texto para la térmica
  const pdf = await renderizarPDF(doc, { formato: 'ticket' }); // bytes del PDF
}
```

## Carta y ticket en HTML

`renderizarHTML` devuelve una página completa con el texto escapado. Opciones:

- `formato`: `'carta'` (por defecto) o `'ticket'` (80 mm);
- `logo`: una URL o un data URI;
- `titulo`: el título de la pestaña;
- `leyenda`: una línea al pie.

Una leyenda como «La factura es beneficio de todos, exíjala» es opcional: el Reglamento no la exige.

## Ticket de 42 columnas

`renderizarTexto` arma el documento en texto plano con el ancho que le pidas. El ancho típico es de 32, 42 o 48
columnas; por defecto, 42, el de una impresora de 80 mm. Ninguna línea pasa del ancho: las largas se parten.

El texto sirve para una impresora ESC/POS en modo texto. La librería no envía comandos a la impresora: el corte
de papel, la apertura del cajón y la codificación de caracteres los pone tu sistema o el controlador de la
impresora. Antes de maquetar, `renderizarTexto` quita los caracteres de control del nombre del cliente y de las
descripciones. Así, un ESC escrito en un dato no llega a la impresora como comando.

Un ticket impreso por factura-hn es una **Factura** (`01`) en papel angosto, no un Ticket (`09`). El Ticket solo
lo emite una máquina registradora (Art. 4 num. 43). Ver [documentos no emitibles](/documentos/no-emitibles/).

## PDF

`@factura-hn/pdf` arma el PDF con `pdf-lib`: no necesita navegador ni dependencias nativas, así que funciona en
Node, en funciones serverless y en el navegador.

- **Mismo contenido que el texto.** El PDF dibuja las líneas de `renderizarTexto`: a 90 columnas en carta y a 42
  en ticket. Un solo lugar decide qué se imprime.
- **Determinista.** El mismo documento produce los mismos bytes.
- **Latin-1.** Las fuentes estándar de PDF solo dibujan la tabla WinAnsi. Los acentos y la ñ salen bien; un emoji
  u otro carácter fuera de la tabla sale como «?» (`aWinAnsi`).
- **Ticket.** 80 mm de ancho y el alto que pida el contenido, en una sola página.

## Leyendas

### Documento de prueba

Un documento emitido con un CAI ficticio (`DEMO00-NO-VALIDO-…`) lleva `modo: 'prueba'`. El HTML, el texto y el
PDF imprimen `LEYENDA_PRUEBA`, «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL», al inicio y al final; el PDF agrega una
marca de agua PRUEBA. El texto es fijo: no se traduce ni se personaliza. Un documento real se imprime sin ella.

### Documento anulado

Un documento anulado lleva la leyenda «ANULADA» al inicio y al final, y el PDF una marca de agua (Art. 41). Se
imprime con el mismo número y el mismo contenido. Ver [Anular o emitir una nota](/guias/anular/).

### Quién atendió

Para imprimir «Atendido por», pasa `operador` en la entrada de `emitir`. Queda en el documento y en todas sus
copias. Si solo quieres dejarlo en la bitácora, pásalo en las opciones de `emitir`, no en la entrada.

## Reimprimir sin recalcular

Reimprime siempre desde el documento guardado. La copia debe ser idéntica al original (Art. 38), y el documento
guardado es inmutable: vuelve a dar los mismos montos, la misma fecha y el mismo CAI aunque hayan cambiado los
precios, la configuración o la autorización vigente.

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { buscarDocumento, renderizarTexto } from 'factura-hn';

const guardado = await buscarDocumento(almacen, '000-001-01-00000001');
if (guardado) console.log(renderizarTexto(guardado, { ancho: 42 }));
```

No vuelvas a llamar a `emitir` ni a `calcularDocumento` para reimprimir: eso sería otro documento, con otro
número.

Con la API REST, la reimpresión es `GET /v1/documentos/{numero}.pdf`, `.html` o `.txt`:

- en el PDF, `?formato=carta` o `?formato=ticket`;
- en el texto, `?ancho=`.

Con `@factura-hn/cliente`: `fhn.descargar(numero, 'pdf', { papel: 'ticket' })`. Ver la
[referencia de la API](/referencia/api/).

## Papel térmico

Antes de imprimir documentos en papel térmico hay que presentar al SAR la certificación del proveedor del papel
de que la impresión se conserva al menos 5 años (Art. 38). Sin ella, el documento no sustenta gastos ni crédito
fiscal.

## Errores frecuentes

`buscarDocumento` no lanza error si el número no está en el almacén: devuelve `null`. Revisa el número, de 16
dígitos con guiones.

| Código | Causa habitual |
|---|---|
| [`NO_ENCONTRADO`](/referencia/errores/#no_encontrado) | Con la API: el documento no existe en el tenant de la llave |
| [`OPERADOR`](/referencia/errores/#operador) | El nombre de quien atiende está vacío, pasa de 80 caracteres o tiene caracteres de control |

## Fuentes

- `render.ts` del núcleo y `packages/pdf`; matriz de [cumplimiento](/referencia/cumplimiento/), filas 10, 11, 38
  y 41.
