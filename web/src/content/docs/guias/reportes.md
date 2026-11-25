---
title: Reportes del mes
description: Libro de ventas, exportación a CSV, TXT y JSONL (Art. 53 num. 5) y documentos no utilizados (Art. 42) con factura-hn, y por qué los documentos de prueba quedan fuera.
sidebar:
  order: 5
---

Al cerrar un período, un negocio necesita tres cosas de su sistema de facturación: el libro de ventas, los
archivos de texto del Art. 53 num. 5 y la lista de números que no usó (Art. 42). factura-hn calcula las tres desde
el almacén. Ninguna se envía sola al SAR: el SDK genera el contenido y el negocio lo presenta.

## Leer los documentos del período

Todos los reportes parten de los documentos guardados. Con el SDK, por fechas de emisión:

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
const docs = await almacen.transaccion((tx) => tx.documentos({ desde: '2026-11-01', hasta: '2026-11-30' }));
```

Con `crearFacturador`: `caja.documentos({ desde, hasta })`. Con la API, los reportes ya leen el período: ver más
abajo.

## Libro de ventas

<!-- declaraciones:
import type { DocumentoFiscal } from 'factura-hn';
declare const docs: DocumentoFiscal[];
-->
```ts
import { libroVentas, libroVentasCSV } from 'factura-hn';

const { filas, resumen, excluidos } = libroVentas(docs);
const csv = libroVentasCSV(filas); // UTF-8 con BOM, para que una hoja de cálculo abra bien los acentos
console.log(resumen.total, resumen.isv15, excluidos); // excluidos: documentos de prueba que quedaron fuera
```

Una fila por documento, con estas reglas:

- **Las notas de crédito restan y las de débito suman.** Los importes de una Nota de Crédito van con signo
  negativo.
- **Los anulados quedan con su número y montos en cero**, para que la numeración del libro no tenga huecos
  (Art. 41).
- **Todo en lempiras.** Un documento en dólares se convierte con el tipo de cambio que el propio documento imprime
  (Art. 11, párrafo final), campo por campo. La fila trae además la moneda, el tipo de cambio y el total en la
  moneda original. Por convertir cada campo por separado, la suma de las partes puede diferir del total en un
  centavo.
- **Texto seguro en hojas de cálculo.** Un nombre de cliente que empieza con `=`, `+`, `-` o `@` lleva un
  apóstrofo delante para que la hoja no lo ejecute como fórmula.

:::caution[Interpretación pendiente de revisión]
El repositorio no tiene una norma que fije el formato del libro de ventas ni cómo convertir los documentos en
moneda extranjera. La conversión a lempiras es la DEC-050, marcada [REVISAR].
:::

`resumenVentas(filas)` da los totales del período: exonerado, exento, gravado al 0 %, al 15 % y al 18 %, ISV 15 %,
ISV 18 % y total. Sirve de apoyo para la declaración mensual del ISV, pero factura-hn no la presenta.

:::caution[Por confirmar con fuente]
El repositorio no tiene la fuente del formulario de la declaración mensual ni de su relación con el libro de
ventas. Este tema aún no tiene pregunta propia en la [consulta al SAR](/produccion/consulta-sar/). Confírmalo
con tu contador.
:::

## Exportación a texto (Art. 53 num. 5)

El Art. 53 num. 5 pide que el sistema genere archivos de texto para enviarlos al SAR. `exportarTexto` genera tres
formatos:

| Formato | Contenido | Para qué |
|---|---|---|
| `jsonl` | Un documento completo por línea | Respaldo y traslado sin pérdida; se lee con `leerExportacionJSONL` |
| `csv` | Una fila de resumen por documento, separada por comas, con BOM | Hojas de cálculo |
| `txt` | Lo mismo separado por barras verticales, con una línea de encabezado que empieza con `#factura-hn` | Traslado a otro sistema |

<!-- declaraciones:
import type { DocumentoFiscal } from 'factura-hn';
declare const docs: DocumentoFiscal[];
-->
```ts
import { exportarTexto, separarDocumentosDePrueba } from 'factura-hn';

const txt = exportarTexto(docs, { formato: 'txt' });
const { excluidos } = separarDocumentosDePrueba(docs); // cuántos de prueba quedaron fuera
```

Al revés que el libro, la exportación conserva los anulados **con sus importes originales** y `estado = ANULADO`:
el archivo refleja lo emitido, y quien lo procese decide cómo contarlo. `VERSION_EXPORTACION` versiona las
columnas.

:::caution[Por confirmar con fuente]
No se encontró un formato oficial para estos archivos. Los tres formatos son propios del proyecto (DEC-011,
marcada [REVISAR]). Si el SAR publica uno, se agregará como un formato más. Son las preguntas P-04 y P-14 de la
[consulta al SAR](/produccion/consulta-sar/).
:::

TXT y JSONL son archivos de traslado: no se protegen contra fórmulas. No los abras con el asistente de importación
de una hoja de cálculo.

## Documentos no utilizados (Art. 42)

Hay que comunicar al SAR los números que no se usaron dentro de los primeros 10 días hábiles del mes siguiente al
acontecimiento que los dejó sin uso (Art. 42). El acontecimiento más común es el vencimiento de la autorización: los
números posteriores al último emitido quedan sin usar.

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { noUtilizadosDelAlmacen } from 'factura-hn';

// Feriados en formato YYYY-MM-DD: el SDK no trae calendario.
const rangos = await noUtilizadosDelAlmacen(almacen, '000-001-01', { feriados: ['2026-12-25'] });
for (const r of rangos) {
  console.log(r.cai, r.desde, r.hasta, r.descripcionCausal, r.fechaLimiteAviso, r.avisoVencido);
}
```

Cada rango trae el CAI, los números sin usar, la causal del Art. 42 (`CAUSALES_NO_UTILIZACION`, numerales 1 a
12), la fecha del acontecimiento y la fecha límite del aviso.

- **Causal 1 (vencimiento).** Se calcula sola. El acontecimiento es la fecha límite misma, no el día siguiente:
  así el aviso nunca queda tarde (DEC-009, aprobada).
- **Otras causales.** Si das de baja un punto de emisión o cierra un establecimiento, pásalo como `evento`, por
  ejemplo `{ causal: 5, fecha: '2026-11-18' }` para la baja de un punto de emisión.
- **Feriados.** Solo se descuentan sábados y domingos. Sin `feriados`, la fecha límite puede quedar uno o dos días
  después de la real (DEC-010, marcada [REVISAR]).
- **La comunicación la haces tú**, en el sistema que establezca el SAR. El SDK no la envía.

:::caution[Por confirmar con fuente]
El formato de la comunicación de no utilizados tampoco está publicado en las fuentes revisadas (P-04 de la
[consulta al SAR](/produccion/consulta-sar/)).
:::

## Los documentos de prueba quedan fuera

Un documento de prueba (CAI ficticio `DEMO00-NO-VALIDO-…`, `modo: 'prueba'`) no tiene valor fiscal. Por eso:

- `libroVentas` y `exportarTexto` lo dejan fuera; `excluidos` y `separarDocumentosDePrueba(docs).excluidos` dicen
  cuántos;
- `documentosNoUtilizados` y `noUtilizadosDelAlmacen` no reportan autorizaciones de prueba;
- la API lo indica en la cabecera `Documentos-Prueba-Excluidos` y, en el libro JSON, en `excluidos`.

`filaLibroVentas` y `lineaExportacion` trabajan documento por documento y **no filtran**. Si armas el archivo por
partes con ellas, pasa antes los documentos por `separarDocumentosDePrueba` (DEC-064).

## Con la API REST

| Ruta | Rol | Contenido |
|---|---|---|
| `GET /v1/libro-ventas?desde&hasta&formato=json` (o `csv`) | caja | Libro de ventas |
| `GET /v1/exportacion?desde&hasta&formato=jsonl` (o `csv`, `txt`) | admin | Art. 53 num. 5 |
| `GET /v1/series/{identificador}/no-utilizados` | admin | Art. 42 |

- Un período es de hasta 366 días. El libro y la exportación se transmiten por partes, a medida que se leen.
- Si el período pasa de 50 000 documentos (`FHN_MAX_DOCUMENTOS_REPORTE`), la respuesta es
  `PERIODO_DEMASIADO_GRANDE`: divídelo, por ejemplo por mes.
- Cada exportación queda en la bitácora de la API.

Detalle en la [referencia de la API](/referencia/api/).

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`PERIODO_DEMASIADO_GRANDE`](/referencia/errores/#periodo_demasiado_grande) | El período tiene más documentos que el máximo por reporte |
| [`LIMITE_SOLICITUDES`](/referencia/errores/#limite_solicitudes) | Ya hay demasiados reportes en curso: espera y reintenta |
| [`SOLO_ADMIN`](/referencia/errores/#solo_admin) | La exportación y los no utilizados requieren la llave admin |
| [`METODO_NO_PERMITIDO`](/referencia/errores/#metodo_no_permitido) | Se pidió un reporte con `HEAD`: usa `GET` |

## Fuentes

- Reglamento, Arts. 11, 41, 42 y 53: matriz de [cumplimiento](/referencia/cumplimiento/), filas 41, 42 y 53.
- `reportes.ts`, `exportacion.ts` y `no-utilizados.ts` del núcleo; [referencia de la API](/referencia/api/),
  «Reportes de período».
- DEC-009, DEC-010, DEC-011, DEC-050 y DEC-064 en [decisiones](/referencia/decisiones/).
