---
title: Almacén fiscal
description: Qué es un AlmacenFiscal, cuándo usar SQLite, PostgreSQL o memoria, cómo garantiza correlativos atómicos y sin huecos, y qué guarda la bitácora.
sidebar:
  order: 5
---

`factura-hn` emite siempre sobre un **almacén fiscal** (`AlmacenFiscal`): el lugar donde viven las
autorizaciones, los documentos y la bitácora. No hay otra forma de emitir: `emitir` y `anular` lo reciben
siempre, y `crearFacturador` lo guarda una vez.

El almacén reserva cada número en la **misma transacción** que guarda el documento. Por eso tu código no
calcula el siguiente número ni guarda el documento por su cuenta.

## Qué almacén usar

| Proyecto | Almacén |
|---|---|
| PostgreSQL (Supabase, Neon, RDS…), un servidor con varias cajas | `@factura-hn/postgres`: `new AlmacenPostgres(pool)` y `await almacen.migrar()` |
| Una caja sin internet, Electron, una instalación local | `@factura-hn/sqlite`: `new AlmacenSQLite(db)` (Node 20+ con `better-sqlite3`; Node 22.13+ con `node:sqlite`) |
| Pruebas y demos | `AlmacenFiscalMemoria`, incluido en `factura-hn`. Se pierde al reiniciar |
| Otra base (MySQL, SQL Server, IndexedDB…) | Implementa `AlmacenFiscal` y hazlo pasar la batería de contrato |

**SQLite**, con el módulo `node:sqlite` de Node:

```js
import { DatabaseSync } from 'node:sqlite';
import { AlmacenSQLite } from '@factura-hn/sqlite';

// Un archivo en el equipo de la caja; crea las tablas fhn_* si no existen.
const almacen = new AlmacenSQLite(new DatabaseSync('./factura.db'));
```

**PostgreSQL**, con `pg`:

```js
import pg from 'pg';
import { AlmacenPostgres } from '@factura-hn/postgres';

const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await almacen.migrar(); // tablas fhn_*; idempotente
```

Crea el almacén una vez por proceso, al arrancar, no en cada solicitud.

`AlmacenFiscalMemoria` cumple las mismas reglas, pero no guarda nada al reiniciar: no sirve para facturar de
verdad.

## Reglas que cumple cualquier almacén

1. **Una serie por identificador.** La serie es `establecimiento-puntoEmision-tipo` (`000-001-01`, Art. 10
   num. 7 del Reglamento), no el CAI. Un identificador acumula autorizaciones y la numeración continúa de una a
   otra.
2. **Sin huecos ni repetidos.** `emitir` bloquea la serie durante la transacción. Dos cajas que emiten a la vez
   en la misma serie se ordenan: una espera a la otra.
3. **Todo o nada.** El documento se guarda en la misma transacción que consume el número. Si algo falla antes
   de confirmar (una validación, tu asiento contable en `alEmitir`), se revierte todo y el número no se consume.
   Lo que falle *después* (la impresión, el pago) se resuelve anulando, nunca borrando.
4. **Inmutable.** El documento guardado no se modifica; solo pasa de EMITIDO a ANULADO. Ver
   [Documentos inmutables](/conceptos/inmutables/).

Los almacenes de Postgres y SQLite crean sus tablas `fhn_*` y las protegen con disparadores: no se pueden borrar
documentos ni autorizaciones, un documento emitido solo puede pasar a ANULADO y la serie nunca retrocede. Se
cumple aunque alguien edite la base a mano.

## Una serie, un almacén

Dos procesos pueden emitir en la misma serie solo si comparten el mismo almacén transaccional: el mismo
PostgreSQL, o el mismo archivo SQLite en la misma máquina. Dos cajas con bases separadas nunca comparten serie:
cada una lleva su propio punto de emisión y su propio CAI.

El Reglamento admite tres estructuras para un sistema en red (Art. 48): centralizado (una numeración para todo
el país), regional (una por región) o por sucursal (varias). En factura-hn se eligen con los puntos de emisión
que registras y con dónde vive el almacén:

| Estructura | Cómo se configura |
|---|---|
| Centralizado | Un establecimiento y un punto de emisión (p. ej. `000-001`) en un PostgreSQL central. Todas las cajas emiten contra él |
| Regional | Un punto de emisión por región (`000-001` norte, `000-002` sur), cada uno con sus autorizaciones |
| Por sucursal | Un establecimiento por sucursal y un punto de emisión por caja (`001-001`, `001-002`…). Con SQLite, cada caja fuera de línea tiene su propio punto |

## La bitácora

El almacén guarda, en la misma transacción que cada operación, un evento de auditoría. La bitácora es de solo
inserción: un evento no se modifica ni se borra (Art. 53 num. 2, controles de auditoría).

| Evento | Cuándo |
|---|---|
| `AUTORIZACION_REGISTRADA` | Se registró un CAI |
| `DOCUMENTO_EMITIDO` | Se emitió un documento |
| `DOCUMENTO_ANULADO` | Se anuló un documento |
| `SALTO_DE_FECHA_CONFIRMADO` | Alguien confirmó que la fecha era correcta tras un salto sospechoso. Ver [Reloj y fechas](/conceptos/reloj-y-fechas/) |
| `FECHA_ADELANTADA_CORREGIDA` | Se corrigieron documentos emitidos con el reloj adelantado |

Cada evento lleva el instante, la fecha en Honduras, el identificador y el número, y quién lo hizo: `actor` (el
usuario, la caja o la llave) y `operador` (la persona que cobra), si los pasas.

```js
import { crearFacturador, eventosAuditoria } from 'factura-hn';

// `almacen` es el de arriba; `emisor` y `venta`, los de tu sistema.
const caja = crearFacturador({ almacen, emisor, actor: 'caja-1' });
await caja.emitir(venta, { operador: 'María' });

const bitacora = await eventosAuditoria(almacen, { identificador: '000-001-01' });
// [{ tipo: 'DOCUMENTO_EMITIDO', numero: '000-001-01-00000001', actor: 'caja-1', operador: 'María', … }]
```

## Conservación y respaldos

Haz respaldos del almacén: es tu archivo fiscal. Consérvalo al menos 5 años y no borres nada: ver
[Operación mensual](/produccion/operacion-mensual/).

## Escribir tu propio almacén

Si tu base no es PostgreSQL ni SQLite, implementa las interfaces `AlmacenFiscal` y `TransaccionFiscal` y pasa la
batería `ejecutarContratoAlmacen` de `factura-hn/pruebas`. Verifica la numeración consecutiva, la continuidad
entre autorizaciones, que un fallo no consuma número, la anulación, el orden cronológico, la bitácora y 50
emisiones concurrentes desde 5 conexiones.

Las clases, las interfaces y `ejecutarContratoAlmacen` están en la [referencia del SDK](/referencia/sdk/).
