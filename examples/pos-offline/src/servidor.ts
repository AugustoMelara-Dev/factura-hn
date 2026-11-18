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
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { registrarAutorizacion, type Emisor } from 'factura-hn';
import { crearPOS } from './pos';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const env = process.env;

const EMISOR_DEMO: Emisor = {
  rtn: '08011999000000', razonSocial: 'NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)', nombreComercial: 'Demostración',
  direccionCasaMatriz: 'Tegucigalpa, M.D.C.', direccionEstablecimiento: 'Tegucigalpa, M.D.C.', telefono: '0000-0000', correo: 'demo@ejemplo.hn',
};

const emisor: Emisor = env.POS_EMISOR ? JSON.parse(readFileSync(env.POS_EMISOR, 'utf8')) : EMISOR_DEMO;
const pos = crearPOS({ db: new DatabaseSync(env.POS_DB ?? 'pos.db'), emisor, establecimiento: env.POS_ESTABLECIMIENTO ?? '000', puntoEmision: env.POS_PUNTO ?? '001' });

if (env.POS_DEMO === '1' && !(await pos.estado()).autorizacion) {
  const limite = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
  await registrarAutorizacion(pos.almacen, {
    cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01', tipoDocumento: '01', establecimiento: env.POS_ESTABLECIMIENTO ?? '000',
    puntoEmision: env.POS_PUNTO ?? '001', rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: limite,
  });
  console.log('DEMO: CAI ficticio registrado. Los documentos no tienen validez fiscal.');
}

const puerto = Number(env.PUERTO ?? 3000);
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
