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
const pasadas = new Set<Promise<unknown>>();
const intervalo = setInterval(() => {
  const p = despacharWebhooks({ pool, rol, cofre, permitirRedInterna: true, enCurso })
    .catch((e) => console.error('Despacho de webhooks', e))
    .finally(() => pasadas.delete(p));
  pasadas.add(p);
}, 5000);
let cerrando = false;
/**
 * Cierre ordenado: deja de aceptar conexiones, espera las solicitudes en curso (p. ej. las de un generador que
 * abortó) y la pasada de webhooks, y solo entonces cierra el pool. Cerrar el pool antes las haría fallar con
 * «Cannot use a pool after calling end on the pool» (500 en el log que tapa la causa real). Tope: 30 s.
 */
const cerrar = () => {
  if (cerrando) return;
  cerrando = true;
  clearInterval(intervalo);
  const tope = setTimeout(() => {
    console.error('Cierre: solicitudes en curso tras 30 s; se cortan.');
    (servidor as import('node:http').Server).closeAllConnections();
  }, 30_000);
  tope.unref();
  servidor.close(() => {
    void Promise.allSettled([...pasadas])
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
  // Las conexiones keep-alive sin solicitud en curso no tienen por qué esperar.
  (servidor as import('node:http').Server).closeIdleConnections();
};
process.once('SIGTERM', cerrar);
process.once('SIGINT', cerrar);
process.stdin.on('end', cerrar); // el generador cierra stdin al terminar
process.stdin.resume();
