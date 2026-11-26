---
title: Operación mensual
description: Lo que se repite cada mes al facturar con factura-hn, libro de ventas, exportación, documentos no utilizados, anulaciones, respaldos y renovación del CAI, con su artículo.
sidebar:
  order: 4
---

Una rutina para el cierre de cada mes. La hace el dueño o el contador, con la ayuda del desarrollador para sacar
los reportes. Los artículos son del Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas).

| Tarea | Cuándo | Fuente |
|---|---|---|
| [Libro de ventas](#libro-de-ventas) | Al cerrar el mes | Formato propio de factura-hn |
| [Archivo de texto](#archivo-de-texto-art-53-num-5) | Cuando el SAR lo pida; conviene generarlo cada mes como respaldo | Art. 53 num. 5 |
| [Documentos no utilizados](#documentos-no-utilizados) | Dentro de los 10 días hábiles del mes siguiente al acontecimiento | Art. 42 |
| [Anulaciones del mes](#anulaciones-del-mes) | Al cerrar el mes | Art. 41 |
| [Renovación del CAI](#renovación-del-cai) | Desde dos meses antes de la fecha límite | Art. 59 |
| [Respaldos](#respaldos-y-conservación) | Cada día, y una prueba de restauración periódica | Arts. 41 y 43 |

Los ejemplos de código usan el SDK sobre tu almacén (`almacen`). Con la API y el MCP se indica la ruta o la
herramienta equivalente. Los reportes en detalle están en [Reportes](/guias/reportes/).

## Libro de ventas

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { libroVentas, libroVentasCSV } from 'factura-hn';

// Los documentos del mes, por fecha de emisión.
const docs = await almacen.transaccion((tx) => tx.documentos({ desde: '2026-11-01', hasta: '2026-11-30' }));

const { filas, resumen, excluidos } = libroVentas(docs); // sin los documentos de prueba
const csv = libroVentasCSV(filas);                       // en lempiras; los anulados, con su número y montos en cero
console.log(resumen, `${excluidos} documentos de prueba fuera del libro`);
```

- Cada fila trae fecha, tipo, número, CAI, cliente y RTN, los importes exonerado, exento, gravado 0 %, gravado 15 %
  y gravado 18 %, el ISV por tasa, el total y si está anulado.
- Los documentos anulados salen con su número y los montos en cero: el número existe y no se puede saltar.
- Los documentos de prueba (CAI `DEMO00-…`) quedan fuera.
- Un documento en moneda extranjera se convierte a lempiras con el tipo de cambio que imprime, campo por campo.
  Por eso la suma de las partes puede diferir del total en 1 centavo.

Con la API: `GET /v1/libro-ventas?desde=2026-11-01&hasta=2026-11-30&formato=csv` (llave de caja o admin). Con el
MCP: la herramienta `libro_ventas`.

## Archivo de texto (Art. 53 num. 5)

El Art. 53 num. 5 pide que el sistema genere archivos de texto para enviarlos al SAR. factura-hn genera tres
formatos propios y versionados:

<!-- declaraciones:
import type { DocumentoFiscal } from 'factura-hn';
declare const docs: DocumentoFiscal[];
-->
```ts
import { exportarTexto, separarDocumentosDePrueba } from 'factura-hn';

const archivo = exportarTexto(docs, { formato: 'csv' }); // también 'jsonl' o 'txt'; sin los documentos de prueba
const { excluidos } = separarDocumentosDePrueba(docs);   // cuántos de prueba quedaron fuera
```

A diferencia del libro de ventas, el archivo conserva los importes de los documentos anulados junto con su estado
y el motivo de la anulación: refleja lo que se emitió.

Con la API: `GET /v1/exportacion?desde=2026-11-01&hasta=2026-11-30&formato=csv` (solo llave admin). Cada
exportación queda en la bitácora de la API.

Los formatos de factura-hn son propios.

## Documentos no utilizados

Los números que quedan sin usar se comunican al SAR **dentro de los diez días hábiles del mes siguiente** al
acontecimiento (Art. 42). Las causales más comunes:

- el vencimiento de la autorización (causal 1);
- el cambio de los datos del obligado tributario (2);
- el cese de un establecimiento o del negocio (3 y 4);
- la baja de un punto de emisión (5);
- las fallas técnicas del sistema (10).

factura-hn calcula los rangos, la causal y la fecha límite del aviso. **No envía el aviso**: se hace en el sistema
del SAR.

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { noUtilizadosDelAlmacen } from 'factura-hn';

// Por cada serie (establecimiento-punto-tipo). Los feriados los pasas tú: el SDK no trae calendario.
const rangos = await noUtilizadosDelAlmacen(almacen, '000-001-01', {
  feriados: ['2026-12-25'],
});
for (const r of rangos) {
  console.log(`${r.identificador} ${r.desde}-${r.hasta} (${r.cantidad}): ${r.descripcionCausal}. Avisar a más tardar el ${r.fechaLimiteAviso}.`);
}

// Al dar de baja una caja: los números restantes quedan sin uso con la causal 5 del Art. 42.
const porBaja = await noUtilizadosDelAlmacen(almacen, '000-001-01', { evento: { causal: 5, fecha: '2026-11-30' } });
```

Cómo cuenta los plazos:

- Sin `evento`, solo reporta las autorizaciones **vencidas** con números libres. Una autorización vigente todavía
  se puede usar.
- Para el vencimiento, factura-hn toma como acontecimiento la fecha límite misma: así el aviso nunca queda tarde.
- Solo descuenta sábados y domingos. Los feriados de Honduras cambian por decreto y el SDK no los trae: pásalos en
  `feriados`. Sin ellos, la fecha calculada puede quedar uno o más días después de la real.
- No incluye las autorizaciones de prueba: un CAI ficticio no es una autorización del SAR.

Con la API: `GET /v1/series/000-001-01/no-utilizados` (solo llave admin).

## Anulaciones del mes

Un documento con errores se anula: lleva la leyenda «ANULADA», conserva su número y se resguarda el original y la
copia en orden cronológico (Art. 41). En factura-hn se anula con `anular`, con un motivo
obligatorio. Nada se borra. Ver [Anular](/guias/anular/).

Al cerrar el mes, revisa las anulaciones con su motivo y quién las hizo:

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { eventosAuditoria } from 'factura-hn';

// Las anulaciones hechas en noviembre, con quién las hizo y el motivo (bitácora de solo inserción).
const anulaciones = (await eventosAuditoria(almacen, { tipo: 'DOCUMENTO_ANULADO' }))
  .filter((e) => e.fecha >= '2026-11-01' && e.fecha <= '2026-11-30');
for (const e of anulaciones) console.log(e.fecha, e.numero, e.actor ?? '', e.operador ?? '', e.detalle);
```

Con la API: `GET /v1/bitacora` (solo llave admin).

Qué mirar:

- Que cada anulación tenga un motivo claro. Muchas anulaciones por el mismo motivo suelen indicar un problema de
  la caja o de la capacitación.
- Que no se haya anulado una venta correcta para «corregir» una devolución o un descuento. Esos casos van con Nota
  de Crédito (06) sobre el documento vigente (Art. 4 num. 32). Ver [Nota de Crédito](/documentos/nota-credito/).
- Que el original anulado se recupere del cliente cuando sea posible (Art. 41: resguardo de original y copia).

## Renovación del CAI

Revisa las alertas de cada caja. La nueva autorización se solicita dentro de los dos meses previos a la fecha
límite (Art. 59), y factura-hn avisa desde que se abre esa ventana (`AVISO_VENCIMIENTO`, contando dos meses de calendario) y al
usar el 90 % del rango (`AVISO_RANGO`). Cómo verlas y qué hacer: [CAI y rangos](/produccion/cai-y-rangos/#renovar-antes-de-vencer-o-de-agotar).

## Respaldos y conservación

El Reglamento pide custodiar los documentos en orden cronológico durante el plazo del Código Tributario, incluidos
los anulados (Arts. 41 y 43). factura-hn guarda cada documento tal como se emitió y no permite borrarlo, pero eso
no protege de un disco dañado: el respaldo es responsabilidad del negocio.

- Con la API en Docker, el respaldo diario y la restauración están en [Autoalojamiento](/guias/autoalojar/).
- Con SQLite, copia el archivo de la base con la caja cerrada, o usa la copia en línea de SQLite.
- Guarda las copias fuera del equipo: un disco externo o el almacenamiento en la nube del negocio.
- **Prueba la restauración** al menos una vez, en una instalación nueva y antes de emitir nada en ella.

Conserva los documentos **al menos 5 años desde el vencimiento de la declaración del período** (Código
Tributario, Arts. 58 num. 4, 63 num. 3, 144 y 145). No borres nada.

