import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emitir, registrarAutorizacion, type AlmacenFiscal } from 'factura-hn';
import { DATOS_CONTRATO as D, ejecutarContratoAlmacen } from 'factura-hn/pruebas';
import { AlmacenSQLite } from '../src';

// node:sqlite se carga con require para que el empaquetador de las pruebas no intente resolverlo.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const carpeta = mkdtempSync(join(tmpdir(), 'fhn-sqlite-'));
const abiertas = new Set<InstanceType<typeof DatabaseSync>>();
afterAll(() => {
  for (const db of abiertas) if (db.isOpen) db.close();
  rmSync(carpeta, { recursive: true, force: true });
});

let n = 0;
const rutas = new WeakMap<AlmacenFiscal, string>();
const conexiones = new WeakMap<AlmacenFiscal, InstanceType<typeof DatabaseSync>>();
const abrir = (ruta: string) => {
  const db = new DatabaseSync(ruta);
  abiertas.add(db);
  const almacen = new AlmacenSQLite(db);
  rutas.set(almacen, ruta);
  conexiones.set(almacen, db);
  return almacen;
};

ejecutarContratoAlmacen({ describe, it }, {
  nombre: 'SQLite (node:sqlite, archivo en WAL)',
  crear: async () => abrir(join(carpeta, `p${++n}.db`)),
  // Otra caja = otra conexión al mismo archivo.
  otraConexion: async (a) => abrir(rutas.get(a)!),
  cerrar: async (a) => conexiones.get(a)?.close(),
});

describe('la base protege los documentos aunque se edite a mano', () => {
  const preparar = async () => {
    const a = abrir(join(carpeta, `m${++n}.db`));
    await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
    const doc = await emitir(D.entrada(), { almacen: a, establecimiento: '000', puntoEmision: '001', opciones: { reloj: D.reloj } });
    return { db: conexiones.get(a)!, doc };
  };

  it('no se puede borrar un documento (Art. 41)', async () => {
    const { db, doc } = await preparar();
    expect(() => db.prepare('DELETE FROM fhn_documentos WHERE numero = ?').run(doc.numero)).toThrow(/no se borran/);
  });

  it('un documento anulado no vuelve a EMITIDO y un emitido no cambia de número', async () => {
    const { db, doc } = await preparar();
    expect(() => db.prepare("UPDATE fhn_documentos SET correlativo = 9 WHERE numero = ?").run(doc.numero)).toThrow(/solo puede anularse/);
    db.prepare("UPDATE fhn_documentos SET estado = 'ANULADO' WHERE numero = ?").run(doc.numero);
    expect(() => db.prepare("UPDATE fhn_documentos SET estado = 'EMITIDO' WHERE numero = ?").run(doc.numero)).toThrow(/solo puede anularse/);
  });

  it('la serie no retrocede ni repite', async () => {
    const { db } = await preparar();
    expect(() => db.prepare("UPDATE fhn_series SET ultimo = 0 WHERE identificador = '000-001-01'").run()).toThrow(/no retrocede/);
  });

  it('las autorizaciones y las series no se borran; la bitácora no se modifica', async () => {
    const { db } = await preparar();
    expect(() => db.prepare('DELETE FROM fhn_autorizaciones').run()).toThrow(/no se borran/);
    expect(() => db.prepare('DELETE FROM fhn_series').run()).toThrow(/no se borran/);
    expect(() => db.prepare('DELETE FROM fhn_eventos').run()).toThrow(/bitácora/);
    expect(() => db.prepare("UPDATE fhn_eventos SET tipo = 'X'").run()).toThrow(/bitácora/);
  });
});
