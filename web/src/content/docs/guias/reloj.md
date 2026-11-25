---
title: Reloj adelantado o atrasado
description: Por qué la fecha de emisión la pone el reloj, qué significan RELOJ_ADELANTADO_SOSPECHOSO y FECHA_ANTERIOR_AL_ULTIMO, y cómo corregir una serie con corregirFechaAdelantada.
sidebar:
  order: 4
---

La fecha de un documento es la fecha de hoy en Honduras (America/Tegucigalpa), según el reloj del equipo que
emite. No se puede retrofechar ni adelantar. Si el reloj de una caja está mal, la serie puede quedar con una fecha
equivocada. Esta guía explica cómo lo previene el SDK y cómo se corrige sin borrar ni editar nada.

## De dónde salen las reglas

- **Momento de emisión.** El documento se emite en la fecha real de la operación (Reglamento, Art. 14).
- **Archivo cronológico.** Los documentos se archivan «de forma ordenada, cronológica» (Art. 43). Los anulados
  también se resguardan en orden cronológico (Art. 41).

A partir de ahí, el proyecto adopta tres reglas:

1. **La fecha la pone el reloj.** Enviar una `fechaEmision` distinta de la de hoy es `FECHA_EMISION_NO_ES_HOY`
   (DEC-022, aprobada).
2. **Un documento válido no tiene fecha anterior al último válido de su serie**: `FECHA_ANTERIOR_AL_ULTIMO`. El
   Reglamento no dice «bloquear la emisión»; es la forma en que el SDK mantiene el archivo en orden cronológico
   sin depender de que alguien lo ordene después. Los anulados no cuentan (DEC-003, aprobada).
3. **Un salto grande del reloj se confirma**: `RELOJ_ADELANTADO_SOSPECHOSO`. El umbral de 7 días es una decisión
   operativa, no una regla fiscal (DEC-002, aprobada).

## Los dos casos

### `RELOJ_ADELANTADO_SOSPECHOSO`: prevención

La fecha de hoy está más de 7 días después de la última emisión de la serie. O el reloj está adelantado, o el
negocio estuvo cerrado. En la caja, muestra el mensaje con dos botones:

- **«Corregir el reloj»**: el operador ajusta la fecha del equipo y vuelve a intentar.
- **«La fecha es correcta»**: reintenta con `confirmarSaltoDeFecha: true`. La confirmación queda en la bitácora
  como `SALTO_DE_FECHA_CONFIRMADO`.

El umbral se cambia con `saltoMaximoDias`. Con la API, `confirmarSaltoDeFecha` en `POST /v1/documentos` requiere
una llave admin.

### `FECHA_ANTERIOR_AL_ULTIMO`: corrección

El último documento válido de la serie tiene una fecha posterior a hoy. Hay dos causas posibles:

- **El reloj de este equipo está atrasado.** Corrígelo y vuelve a emitir.
- **Antes se emitió con el reloj adelantado** (un salto menor de 7 días, o confirmado por error). Ese documento
  traba la serie hasta que llegue su fecha. Un supervisor corre `corregirFechaAdelantada`.

## `corregirFechaAdelantada`

Con el reloj ya corregido, `corregirFechaAdelantada` hace, en una sola transacción:

1. busca los documentos EMITIDOS de la serie con fecha posterior a hoy;
2. los anula (Art. 41), con un motivo que deja constancia de la fecha errónea y de la fecha real;
3. registra en la bitácora un `DOCUMENTO_ANULADO` por cada uno y un `FECHA_ADELANTADA_CORREGIDA` con el resumen.

Desde ahí, la referencia de la serie es el último documento válido y la caja vuelve a emitir con la fecha real. Si
esas ventas fueron reales, emite documentos nuevos con la fecha correcta.

El caso completo, con un reloj simulado:

```ts
import { corregirFechaAdelantada, esErrorValidacion } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

let ahora = new Date('2026-11-20T15:00:00Z');
const reloj = () => ahora; // en producción no se pasa: se usa el reloj del equipo
const caja = await crearFacturadorDemo({ reloj });
const venta = { lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }] };

await caja.emitir(venta); // 20 de noviembre

ahora = new Date('2026-12-05T15:00:00Z'); // el reloj salta 15 días
try {
  await caja.emitir(venta);
} catch (e) {
  if (esErrorValidacion(e)) console.log(e.errores[0]?.codigo); // 'RELOJ_ADELANTADO_SOSPECHOSO'
}
await caja.emitir(venta, { confirmarSaltoDeFecha: true }); // alguien confirmó por error: queda con fecha 5 de diciembre

ahora = new Date('2026-11-21T15:00:00Z'); // el reloj se corrige; emitir da FECHA_ANTERIOR_AL_ULTIMO
const anulados = await corregirFechaAdelantada(caja.almacen, {
  identificador: '000-001-01',
  motivo: 'Reloj de la caja 1 adelantado',
  actor: 'supervisor',
  reloj,
});
anulados.map((d) => d.numero); // ['000-001-01-00000002']: anulado, con su número y su fecha original
await caja.emitir(venta);      // 000-001-01-00000003, con fecha 21 de noviembre
```

Con la API: `POST /v1/series/{identificador}/corregir-fecha` con `{ "motivo": "…" }` y una llave admin. Responde
`{ anulados }`.

### Por qué respeta los Arts. 41 y 43

- Nada se borra ni se edita. Los documentos con fecha errónea conservan número, contenido y fecha; solo pasan a
  ANULADO, que es el tratamiento que el Reglamento da a una emisión con errores (Art. 41). La fecha es un dato del
  documento.
- El archivo sigue ordenado por número y sin huecos: los anulados ocupan su lugar.
- Ningún documento válido tiene fecha anterior a la de un válido previo.
- La bitácora deja la traza de quién corrigió, cuándo y qué números se anularon.
- El original del anulado se recupera del cliente cuando es posible (Art. 41: resguardo de original y copia).

## Lo que no cubre

Un reloj **atrasado** en la primera emisión de una serie (por ejemplo, la batería del equipo que vuelve a 2000) no
tiene un documento previo con el que compararse, y la autorización no trae una fecha de inicio que sirva de piso.
El SDK no tiene con qué detectarlo: revisa el reloj de una caja nueva antes de su primera venta.

:::caution[Por confirmar con fuente]
No se sabe si existe una fecha mínima válida para la primera emisión de una serie, por ejemplo la fecha de la
resolución que otorga el CAI. Es la pregunta P-13 de la [consulta al SAR](/produccion/consulta-sar/), aún sin
respuesta.
:::

## En las pruebas

Inyecta el reloj: `reloj` en `crearFacturador`, en las `opciones` de `emitir` y en `anular` y
`corregirFechaAdelantada`. Así una prueba no depende del día en que corre.

## Errores de esta página

| Código | Qué hacer |
|---|---|
| [`FECHA_EMISION_NO_ES_HOY`](/referencia/errores/#fecha_emision_no_es_hoy) | Omite `fechaEmision`: la pone el reloj |
| [`RELOJ_ADELANTADO_SOSPECHOSO`](/referencia/errores/#reloj_adelantado_sospechoso) | Revisa el reloj; si la fecha es correcta, confirma con `confirmarSaltoDeFecha` |
| [`FECHA_ANTERIOR_AL_ULTIMO`](/referencia/errores/#fecha_anterior_al_ultimo) | Corrige el reloj atrasado, o anula lo adelantado con `corregirFechaAdelantada` |
| [`SIN_DOCUMENTOS_ADELANTADOS`](/referencia/errores/#sin_documentos_adelantados) | No hay documentos con fecha futura en esa serie: nada que corregir |
| [`ANULACION_MOTIVO`](/referencia/errores/#anulacion_motivo) | La corrección necesita un motivo |
| [`SOLO_ADMIN`](/referencia/errores/#solo_admin) | Con la API, confirmar un salto o corregir la fecha requiere la llave admin |

## Fuentes

- Investigación normativa, «Reloj del dispositivo y orden cronológico (Art. 43)»; matriz de
  [cumplimiento](/referencia/cumplimiento/), filas 14, 41 y 43.
- `corregirFechaAdelantada` y `eventosAuditoria` en el núcleo; sección «Reloj del dispositivo» de
  [AGENTS.md](/ia/agents-md/).
- DEC-002, DEC-003 y DEC-022 en [decisiones](/referencia/decisiones/).
