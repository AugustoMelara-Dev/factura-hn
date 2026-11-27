/**
 * Abrir el almacén mientras otra caja (de este proceso o de otro) tiene la base ocupada: espera hasta
 * `esperaMaxima`, como las transacciones, en lugar de fallar con «database is locked».
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emitir, registrarAutorizacion } from 'factura-hn';
import { DATOS_CONTRATO as D } from 'factura-hn/pruebas';
import { AlmacenSQLite } from '../src';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const carpeta = mkdtempSync(join(tmpdir(), 'fhn-sqlite-apertura-'));
const abiertas: Array<InstanceType<typeof DatabaseSync>> = [];
const conexion = (ruta: string) => {
  const db = new DatabaseSync(ruta);
  abiertas.push(db);
  return db;
};
afterAll(() => {
  for (const db of abiertas) if (db.isOpen) db.close();
  rmSync(carpeta, { recursive: true, force: true });
});

/** Otro proceso que toma la base con BEGIN IMMEDIATE, avisa y la suelta a los `ms` milisegundos. */
function otroProcesoOcupa(ruta: string, ms: number): Promise<{ termino: Promise<number> }> {
  const codigo = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('ocupada\\n');
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, Number(process.argv[2]));`;
  const hijo = spawn(process.execPath, ['-e', codigo, ruta, String(ms)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const termino = new Promise<number>((r) => hijo.on('exit', (c) => r(c ?? -1)));
  return new Promise((resolve, reject) => {
    hijo.stdout.on('data', (d: Buffer) => d.toString().includes('ocupada') && resolve({ termino }));
    hijo.on('error', reject);
  });
}

const caja = { establecimiento: '000', puntoEmision: '001', opciones: { reloj: D.reloj } };

describe('AlmacenSQLite espera al abrir una base ocupada', () => {
  it('otra conexión del mismo proceso con BEGIN IMMEDIATE: abre sin error y emite cuando se libera', async () => {
    const ruta = join(carpeta, 'mismo-proceso.db');
    const primera = new AlmacenSQLite(conexion(ruta));
    await registrarAutorizacion(primera, D.autorizacion('CAI-A', 1, 100));
    const ocupada = conexion(ruta);
    ocupada.exec('BEGIN IMMEDIATE');
    setTimeout(() => ocupada.exec('ROLLBACK'), 200);
    const segunda = new AlmacenSQLite(conexion(ruta), { esperaMaxima: 10_000 });
    const doc = await emitir(D.entrada(), { almacen: segunda, ...caja });
    expect(doc.correlativo).toBe(1);
  });

  it('otro proceso tiene la base (nueva o ya creada): 5 cajas abren a la vez y emiten sin repetir números', async () => {
    for (const nueva of [true, false]) {
      const ruta = join(carpeta, `procesos-${nueva}.db`);
      if (!nueva) await registrarAutorizacion(new AlmacenSQLite(conexion(ruta)), D.autorizacion('CAI-A', 1, 100));
      const { termino } = await otroProcesoOcupa(ruta, 300);
      const cajas = Array.from({ length: 5 }, () => new AlmacenSQLite(conexion(ruta), { esperaMaxima: 10_000 }));
      if (nueva) await registrarAutorizacion(cajas[0]!, D.autorizacion('CAI-A', 1, 100));
      const docs = await Promise.all(cajas.map((a) => emitir(D.entrada(), { almacen: a, ...caja })));
      expect(docs.map((d) => d.correlativo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      expect(await termino).toBe(0);
    }
  });

  it('si la base sigue ocupada pasada esperaMaxima, la primera transacción recibe el error', async () => {
    const ruta = join(carpeta, 'siempre-ocupada.db');
    new AlmacenSQLite(conexion(ruta));
    const ocupada = conexion(ruta);
    ocupada.exec('BEGIN IMMEDIATE');
    const almacen = new AlmacenSQLite(conexion(ruta), { esperaMaxima: 100 });
    await expect(almacen.transaccion(async () => 1)).rejects.toThrow(/locked|busy/i);
    ocupada.exec('ROLLBACK');
  });
});
