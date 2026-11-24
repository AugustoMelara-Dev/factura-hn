/** Idempotencia del backend local: sobrevive a un reinicio y resiste reintentos simultáneos. */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registrarAutorizacion } from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';
import { BackendLocal } from '../src';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'E', nombreComercial: 'E', direccionCasaMatriz: 'D', direccionEstablecimiento: 'D', telefono: '1', correo: 'e@ejemplo.example',
};

describe('claves de idempotencia en SQLite', () => {
  it('un reintento tras reiniciar el servidor devuelve el mismo documento; cinco simultáneos emiten uno', async () => {
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'fhn-claves-')), 'factura.db'));
    const almacen = new AlmacenSQLite(db);
    await registrarAutorizacion(almacen, {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 50, fechaLimiteEmision: '2027-10-31',
    });
    const nuevo = () => new BackendLocal({ db, emisor: EMISOR, establecimiento: '000', puntoEmision: '001' });
    const venta = { lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '10.00' }] };

    const a = await nuevo().emitir(venta, 'clave-1');
    expect(a.repetido).toBe(false);
    // «Reinicio»: otra instancia, misma base. El reintento dice que es repetido.
    const otra = await nuevo().emitir(venta, 'clave-1');
    expect([otra.documento.numero, otra.repetido]).toEqual([a.documento.numero, true]);

    const b = nuevo();
    const rs = await Promise.all(Array.from({ length: 5 }, () => b.emitir(venta, 'clave-2')));
    expect(new Set(rs.map((r) => r.documento.numero))).toEqual(new Set(['000-001-01-00000002']));
    // De los intentos simultáneos, solo uno emitió; los demás se marcan como repetidos.
    expect(rs.filter((r) => !r.repetido)).toHaveLength(1);
    expect((db.prepare('SELECT count(*) AS n FROM fhn_documentos').get() as { n: number }).n).toBe(2);
    await expect(nuevo().emitir({ lineas: [{ descripcion: 'otra', cantidad: 1, precioUnitario: '1.00' }] }, 'clave-1')).rejects.toMatchObject({ codigo: 'IDEMPOTENCIA_CONFLICTO' });
  });
});
