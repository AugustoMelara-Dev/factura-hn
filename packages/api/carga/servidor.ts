/**
 * La API para la medición de carga, en su propio proceso (el generador no comparte el bucle de eventos con
 * ella). Es lo mismo que `src/servidor.ts` (pool, app, despacho de webhooks cada 5 s) con dos diferencias:
 * - el límite por llave (20 solicitudes por segundo) se levanta: se mide la emisión, no el limitador;
 * - migra con la misma conexión (DATABASE_URL, el dueño de las tablas). Cada transacción corre igual con
 *   `SET LOCAL ROLE fhn_app`, sujeta a RLS, como en producción.
 * Imprime `LISTO <puerto>` cuando escucha.
 */
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import { crearApp } from '../src/app';
import { migrarApi, ROL_POR_DEFECTO } from '../src/esquema';
import { crearPool, esperarBase } from '../src/pool';
import { CofreSecretos, despacharWebhooks } from '../src/webhooks';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL.');
const rol = ROL_POR_DEFECTO;
const pool = crearPool(url, Number(process.env.FHN_POOL ?? 20));
await esperarBase(pool);
await migrarApi(pool, rol);
const cofre = new CofreSecretos(randomBytes(32).toString('base64'));
const app = crearApp({
  pool,
  modo: 'local',
  rol,
  cofre,
  limiteSolicitudes: { porSegundo: 1_000_000, rafaga: 1_000_000 },
  registrar: (m, e) => console.error(m, e instanceof Error ? e.message : (e ?? '')),
});
const servidor = serve({ fetch: app.fetch, port: Number(process.env.PUERTO ?? 0), hostname: '127.0.0.1' }, (info) => {
  console.log(`LISTO ${info.port}`);
});
const enCurso = new Set<string>();
const intervalo = setInterval(() => {
  despacharWebhooks({ pool, rol, cofre, permitirRedInterna: true, enCurso }).catch((e) => console.error('Despacho de webhooks', e));
}, 5000);
const cerrar = () => {
  clearInterval(intervalo);
  servidor.close();
  void pool.end().then(() => process.exit(0));
};
process.once('SIGTERM', cerrar);
process.once('SIGINT', cerrar);
process.stdin.on('end', cerrar); // el generador cierra stdin al terminar
process.stdin.resume();
