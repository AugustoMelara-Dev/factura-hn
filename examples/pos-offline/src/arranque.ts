/**
 * Prepara la caja a partir de las variables de entorno (ver `servidor.ts`). Aparte del servidor para poder
 * probar que arrancar dos veces sobre la misma base funciona: el CAI ficticio se registra solo la primera vez
 * y la numeración sigue donde quedó.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { registrarAutorizacion, type Emisor } from 'factura-hn';
import { autorizacionDemo, EMISOR_DEMO } from 'factura-hn/demo';
import { crearPOS } from './pos';

// node:sqlite se carga con require para que el empaquetador de las pruebas no intente resolverlo.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export async function prepararCaja(env: NodeJS.ProcessEnv = process.env) {
  const emisor: Emisor = env.POS_EMISOR ? JSON.parse(readFileSync(env.POS_EMISOR, 'utf8')) : EMISOR_DEMO;
  const puerto = Number(env.PUERTO ?? 3000);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('PUERTO debe ser un entero entre 1 y 65535.');
  const establecimiento = env.POS_ESTABLECIMIENTO ?? '000';
  const puntoEmision = env.POS_PUNTO ?? '001';
  const db = new DatabaseSync(env.POS_DB ?? 'pos.db');
  const pos = crearPOS({ db, emisor, establecimiento, puntoEmision, puerto });

  // Solo si la caja aún no tiene autorización: en la segunda corrida la base ya trae el CAI ficticio.
  let demoRegistrado = false;
  if (env.POS_DEMO === '1' && !(await pos.estado()).autorizacion) {
    await registrarAutorizacion(pos.almacen, autorizacionDemo({ tipoDocumento: '01', establecimiento, puntoEmision, rangoFinal: 5000 }));
    demoRegistrado = true;
  }
  return { pos, puerto, demoRegistrado, cerrar: () => db.close() };
}
