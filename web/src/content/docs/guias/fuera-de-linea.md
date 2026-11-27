---
title: Caja fuera de línea
description: Cómo emitir facturas sin internet con el SDK y SQLite en el equipo de la caja, sin duplicados y con una cola para sincronizar después, según el ejemplo pos-offline.
sidebar:
  order: 3
---

En el régimen vigente de CAI y rango autorizado, emitir no requiere una validación previa del SAR en línea: el
sistema numera dentro del rango que autoriza la resolución (ver [normativa](/referencia/normativa/)). Por eso una
caja puede emitir sin internet si el SDK y la base viven en el mismo equipo.

El repositorio trae un ejemplo completo: `examples/pos-offline`, un mini punto de venta con el SDK y SQLite
(`node:sqlite`). Esta guía explica sus piezas.

## Probarlo

Requiere Node 22.13 o más nuevo. Desde la raíz del repositorio:

```bash
pnpm install
POS_DEMO=1 pnpm --filter @factura-hn/ejemplo-pos-offline start   # abre http://127.0.0.1:3000
```

En PowerShell, el segundo comando es:

```powershell
$env:POS_DEMO = '1'; pnpm --filter @factura-hn/ejemplo-pos-offline start
```

`POS_DEMO=1` registra un CAI ficticio, sin validez fiscal, la primera vez. La base queda en
`examples/pos-offline/pos.db` (`POS_DB` para cambiarla): al volver a arrancar, la caja sigue con su CAI y su
numeración. Con tus datos: `POS_EMISOR=emisor.json`, `POS_PUNTO=001` y el CAI de tu resolución registrado con
`registrarAutorizacion`.

## Un punto de emisión por caja

Dos cajas fuera de línea no pueden compartir una serie: cada una tiene su propio archivo SQLite y no ve los
números de la otra. Por eso cada caja que emite sin conexión necesita su propio punto de emisión y sus propios CAI
(Art. 59). Es el modelo por sucursal del Art. 48: ver [Varias cajas y sucursales](/guias/varias-cajas/).

SQLite sí serializa varias cajas sobre **el mismo archivo** en la misma máquina: cada transacción abre con
`BEGIN IMMEDIATE` y espera si la base está ocupada.

## Sin duplicados: la clave de venta

Si la caja pierde la respuesta y reintenta, no debe emitir dos facturas por la misma venta. El ejemplo lo resuelve
así:

1. El navegador genera una clave por venta y la conserva hasta tener respuesta.
2. La clave se guarda con `alEmitir`, **dentro de la misma transacción** que el documento. No hay un momento en
   que exista el documento sin la clave, ni la clave sin el documento.
3. Un reintento con la misma clave devuelve el documento de entonces. Una venta rechazada no consume número ni
   guarda la clave.

Lo mismo, reducido a lo esencial:

```ts
import { DatabaseSync } from 'node:sqlite';
import { emitir, registrarAutorizacion, type LineaEntrada } from 'factura-hn';
import { autorizacionDemo, EMISOR_DEMO } from 'factura-hn/demo';
import { AlmacenSQLite } from '@factura-hn/sqlite';

const db = new DatabaseSync('./caja-003.db');
const almacen = new AlmacenSQLite(db); // crea las tablas fhn_* si no existen
// Una sola vez por base: registrar el mismo CAI otra vez da AUTORIZACION_DUPLICADA, así que solo si la caja aún
// no tiene ninguno. En producción, el CAI de la resolución de esta caja.
const autorizaciones = await almacen.transaccion((tx) => tx.autorizaciones('000-003-01'));
if (autorizaciones.length === 0) await registrarAutorizacion(almacen, autorizacionDemo({ puntoEmision: '003' }));

db.exec(`
  CREATE TABLE IF NOT EXISTS ventas (clave TEXT PRIMARY KEY, numero TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS salida (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL, enviado INTEGER NOT NULL DEFAULT 0);
`);

export async function vender(clave: string, lineas: LineaEntrada[]): Promise<string> {
  const previa = db.prepare('SELECT numero FROM ventas WHERE clave = ?').get(clave) as { numero: string } | undefined;
  if (previa) return previa.numero; // reintento: la misma factura
  const doc = await emitir(
    { emisor: EMISOR_DEMO, preciosIncluyenISV: true, lineas },
    {
      almacen,
      establecimiento: '000',
      puntoEmision: '003',
      // Dentro de la transacción: si algo falla aquí, no hay documento ni número consumido.
      alEmitir: async (d) => {
        db.prepare('INSERT INTO ventas (clave, numero) VALUES (?, ?)').run(clave, d.numero);
        db.prepare('INSERT INTO salida (numero) VALUES (?)').run(d.numero);
      },
    },
  );
  return doc.numero;
}
```

Esto funciona porque `AlmacenSQLite` y las tablas propias usan la misma conexión: lo que se ejecuta en `alEmitir`
queda dentro de la transacción. El ejemplo completo además compara una huella de la venta: la misma clave con otra
venta es un error (`CLAVE_VENTA_USADA`), no un reintento. Ese código es del ejemplo, no del SDK.

## La cola de salida

Lo emitido y lo anulado entra en la tabla `pos_salida` en la misma transacción. Cuando vuelve la conexión,
`sincronizar(enviar)` manda lo pendiente en orden y se detiene en el primer fallo: lo demás queda para la siguiente
vuelta. Solo corre una vuelta a la vez.

El destino (la contabilidad o la oficina central) debe tolerar repetidos: si el envío llega pero la marca de
«enviado» no se guarda, el mismo aviso sale otra vez. Usa el `id` de cada aviso para descartarlo. Con
`POS_SINCRONIZAR_URL`, el ejemplo envía la cola a esa dirección.

## Lo demás del ejemplo

- **Estado del CAI.** Muestra la vigencia y las alertas de vencimiento y de fin de rango (Arts. 59 y 62), con
  `estadoAutorizacion`. Sin internet, la caja no sabe nada que no esté en su base: registra el CAI nuevo antes de
  que venza el anterior.
- **Anulación.** `POST /api/documentos/{numero}/anular` llama a `anular` (Art. 41). Ver
  [Anular o emitir una nota](/guias/anular/).
- **Solo este equipo.** El servidor escucha en 127.0.0.1 y no tiene usuarios. Acepta solo el `Host` 127.0.0.1 o
  localhost con su puerto, el `Origin` propio y POST con `application/json`. Así otra página abierta en el
  navegador no puede emitir ni anular.
- **Respaldos.** Copia la base con `VACUUM INTO` o `.backup`; no copies el archivo mientras está abierto en modo
  WAL. El Código Tributario pide conservar la información 5 años en el domicilio fiscal (Arts. 58.4 y 63.3).

Para varias cajas en red que comparten una serie, usa la API REST: ver [Varias cajas y sucursales](/guias/varias-cajas/).

:::note
Si el equipo de la caja falla, el Reglamento prevé talonarios preimpresos de imprenta para la contingencia
(Art. 55). Vender sin documento no está permitido, y la contingencia no justifica emitir después con otra fecha.
:::

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`SIN_AUTORIZACION`](/referencia/errores/#sin_autorizacion) | La caja no tiene CAI registrado para su punto de emisión |
| [`AUTORIZACION_VENCIDA`](/referencia/errores/#autorizacion_vencida) | El CAI de la caja venció y no se registró el nuevo |
| [`RELOJ_ADELANTADO_SOSPECHOSO`](/referencia/errores/#reloj_adelantado_sospechoso) | El reloj del equipo saltó más de 7 días: ver [Reloj](/guias/reloj/) |
| [`FECHA_ANTERIOR_AL_ULTIMO`](/referencia/errores/#fecha_anterior_al_ultimo) | El reloj del equipo está atrasado, o antes se emitió con el reloj adelantado |

## Fuentes

- `examples/pos-offline` (README y `src/pos.ts`), que corre en la CI.
- `@factura-hn/sqlite` (README); Reglamento, Arts. 41, 48, 55, 59 y 62.
