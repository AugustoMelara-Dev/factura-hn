---
title: Reloj y fechas
description: La fecha de emisión la pone el reloj en hora de Honduras (America/Tegucigalpa), no se puede retrofechar, y dos errores protegen el orden cronológico de cada serie ante un reloj adelantado o atrasado.
sidebar:
  order: 6
---

La fecha de un documento no se elige: la pone el **reloj**, en **hora de Honduras** (zona
`America/Tegucigalpa`). No se puede retrofechar ni adelantar.

El motivo está en el Reglamento: el documento se emite en el momento de la operación (Art. 14) y el archivo se
lleva «de forma ordenada, cronológica» (Art. 43). Ver [Normativa](/referencia/normativa/).

## Hora de Honduras

El SDK toma la fecha de hoy en Honduras, no la del servidor ni la UTC. Un servidor en otra zona horaria, o
configurado en UTC, emite con la fecha correcta:

```js
import { fechaHonduras, horaHonduras } from 'factura-hn';

const instante = new Date('2026-11-25T05:30:00Z'); // ya es 25 en UTC…
fechaHonduras(instante); // "2026-11-24"           …pero en Honduras son las 23:30 del 24
horaHonduras(instante);  // "23:30"
```

`hoyHonduras()` da la fecha de hoy. Las fechas del SDK son texto `AAAA-MM-DD`.

## No se retrofecha

`emitir` toma la fecha del reloj. Si envías `fechaEmision` con otra fecha, falla con
[`FECHA_EMISION_NO_ES_HOY`](/referencia/errores/#fecha_emision_no_es_hoy): omite el campo. Que la fecha sea
siempre la de hoy es una decisión aprobada del proyecto, porque los Arts. 14 y 43 no lo prohíben literalmente
(DEC-022).

Un documento con la fecha equivocada no se edita: se anula y se emite otro. Ver
[Documentos inmutables](/conceptos/inmutables/).

En pruebas, el reloj se inyecta con la opción `reloj`: en `crearFacturador` y `crearFacturadorDemo`, o en
`emitir` dentro de `opciones` (`{ almacen, …, opciones: { reloj } }`).

```js
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo({ reloj: () => new Date('2026-11-24T15:00:00Z') });
const factura = await caja.emitir({
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '1', precioUnitario: '100.00' }],
});
factura.fechaEmision; // "2026-11-24"
```

## El orden cronológico de la serie

Dentro de una serie, la fecha de un documento válido no puede ser anterior a la del último documento válido. El
número ordena el archivo; esta regla hace que el orden también sea cronológico (Art. 43). Los anulados no
cuentan como referencia.

Un reloj mal puesto rompe ese orden. Dos errores lo detectan:

| Código | Qué pasa | Qué hacer |
|---|---|---|
| [`RELOJ_ADELANTADO_SOSPECHOSO`](/referencia/errores/#reloj_adelantado_sospechoso) | La fecha de hoy está más de 7 días después de la última emisión de la serie | Corregir el reloj. Si la fecha es correcta (el negocio estuvo cerrado), reintentar con `confirmarSaltoDeFecha: true`; queda en la bitácora |
| [`FECHA_ANTERIOR_AL_ULTIMO`](/referencia/errores/#fecha_anterior_al_ultimo) | El último documento válido tiene una fecha posterior a hoy | Si el reloj de esta caja está atrasado, corregirlo. Si un documento anterior salió con el reloj adelantado, anularlo con `corregirFechaAdelantada` |

El umbral de 7 días es una decisión operativa, no una regla fiscal: ningún artículo lo fija (DEC-002). Se cambia
con `saltoMaximoDias`.

`corregirFechaAdelantada` anula en una transacción los documentos de la serie con fecha futura, sin borrar ni
editar nada, y lo deja en la bitácora (Arts. 41 y 43). Si esas ventas fueron reales, después se emiten
documentos nuevos con la fecha correcta. El procedimiento paso a paso está en
[Reloj adelantado o atrasado](/guias/reloj/).

:::caution[Por confirmar con fuente]
Un reloj **atrasado** en la primera emisión de una serie no se detecta: no hay una emisión anterior con la cual
comparar, y la autorización no trae una fecha que sirva de piso. Falta saber si existe esa fecha mínima (P-13).
Revisa el reloj de cada caja antes de su primera venta. Ver la [consulta al SAR](/produccion/consulta-sar/).
:::

Las funciones de fecha y `corregirFechaAdelantada` están en la [referencia del SDK](/referencia/sdk/).
