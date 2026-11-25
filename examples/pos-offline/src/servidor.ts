/**
 * Arranca la caja en http://127.0.0.1:3000 con la base SQLite en POS_DB (por defecto ./pos.db).
 *
 *   POS_EMISOR=emisor.json   datos del emisor (RTN, razón social, direcciones, teléfono, correo)
 *   POS_PUNTO=001            punto de emisión de esta caja (POS_ESTABLECIMIENTO=000)
 *   POS_DEMO=1               registra un CAI FICTICIO (sin validez fiscal) para probar
 *   POS_SINCRONIZAR_URL=…    cada 30 s envía lo emitido y anulado (POST JSON) cuando hay conexión
 *
 * Solo escucha en 127.0.0.1: la caja y el POS son el mismo equipo.
 */
import { createServer } from 'node:http';
import { prepararCaja } from './arranque';

const env = process.env;
const { pos, puerto, demoRegistrado } = await prepararCaja(env);
if (demoRegistrado) console.log('DEMO: CAI ficticio registrado. Los documentos no tienen validez fiscal.');
else if (env.POS_DEMO === '1') console.log('DEMO: la caja ya tiene el CAI ficticio; la numeración sigue donde quedó.');

createServer((req, res) => void pos.manejador(req, res)).listen(puerto, '127.0.0.1', () => console.log(`Caja en http://127.0.0.1:${puerto}`));

if (env.POS_SINCRONIZAR_URL) {
  const destino = env.POS_SINCRONIZAR_URL;
  setInterval(() => {
    void pos.sincronizar(async (aviso) => {
      const r = await fetch(destino, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(aviso), signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }).then((n) => n && console.log(`Sincronizados: ${n}`));
  }, 30_000).unref();
}
