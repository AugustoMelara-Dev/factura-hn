import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp, crearTenant, migrarApi } from '@factura-hn/api';
import { crearCliente, ErrorFacturaHN } from '../src';

const archivo = (p: string) => fileURLToPath(new URL(p, import.meta.url));

describe('los tipos están generados desde la especificación actual', () => {
  it('packages/api/openapi.json coincide con la API', async () => {
    const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });
    const actual = await (await app.request('/openapi.json')).json();
    expect(JSON.parse(readFileSync(archivo('../../api/openapi.json'), 'utf8'))).toEqual(actual);
  });
  it('src/esquema.ts coincide con openapi.json (si falla: pnpm --filter @factura-hn/api openapi && pnpm --filter @factura-hn/cliente generar)', async () => {
    const ast = await openapiTS(new URL('../../api/openapi.json', import.meta.url));
    const generado = astToString(ast).replace(/\r\n/g, '\n');
    const guardado = readFileSync(archivo('../src/esquema.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(guardado.endsWith(generado)).toBe(true);
  });
});

const URL_PG = process.env.FHN_PG_URL;
describe.skipIf(!URL_PG)('contra la API', () => {
  const pool = new pg.Pool({ connectionString: URL_PG, max: 5 });
  afterAll(() => pool.end());

  it('emite, reintenta con la misma clave, descarga, consulta el CAI, anula y lee el libro', async () => {
    await migrarApi(pool);
    const tenant = `cli-${randomUUID().slice(0, 8)}`;
    const { llaveAdmin } = await crearTenant(pool, { tenant, nombre: tenant });
    const app = crearApp({ pool, modo: 'local' });
    const fhn = crearCliente({
      url: 'http://api.local/',
      llave: llaveAdmin,
      fetch: ((entrada: RequestInfo | URL, init?: RequestInit) => app.fetch(entrada instanceof Request ? entrada : new Request(entrada, init))) as typeof fetch,
    });
    await fhn.api.POST('/v1/emisores', {
      body: {
        rtn: '08011999123456', razonSocial: 'Ejemplo', nombreComercial: 'Ejemplo', direccionCasaMatriz: 'Tegucigalpa',
        direccionEstablecimiento: 'Tegucigalpa', telefono: '2222-0000', correo: 'a@ejemplo.hn',
      },
    });
    const cai = 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4';
    await fhn.registrarAutorizacion({ cai, tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-10-31' });

    const venta = { establecimiento: '000', puntoEmision: '001', documento: { preciosIncluyenISV: true, lineas: [{ descripcion: 'Café', cantidad: 2, precioUnitario: '57.50' }] } };
    const a = await fhn.emitir(venta, { idempotencyKey: 'venta-1' });
    const b = await fhn.emitir(venta, { idempotencyKey: 'venta-1' });
    expect(a.documento.numero).toBe('000-001-01-00000001');
    expect(a.documento.totales.total).toBe(115);
    expect([a.repetida, b.repetida]).toEqual([false, true]);
    expect(b.documento.numero).toBe(a.documento.numero);

    const pdf = await fhn.descargar(a.documento.numero, 'pdf', { papel: 'ticket' });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    expect(await fhn.descargar(a.documento.numero, 'txt')).toContain(cai);
    expect((await fhn.estadoAutorizacion(cai)).correlativosRestantes).toBe(99);

    const err = await fhn.emitir({ ...venta, documento: { lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '-1' }] } }, { idempotencyKey: 'venta-2' }).catch((e) => e);
    expect(err).toBeInstanceOf(ErrorFacturaHN);
    expect(err.estado).toBe(422);
    expect(err.errores.length).toBeGreaterThan(0);

    expect((await fhn.anular(a.documento.numero, 'Error de precio')).estado).toBe('ANULADO');
    const hoy = a.documento.fechaEmision;
    expect((await fhn.libroVentas(hoy, hoy)).filas).toHaveLength(1);
    expect(await fhn.libroVentasCSV(hoy, hoy)).toContain(a.documento.numero);
    expect(await fhn.exportacion(hoy, hoy)).toContain(a.documento.numero);
    await expect(fhn.documento('000-001-01-00000099')).rejects.toMatchObject({ estado: 404, codigo: 'NO_ENCONTRADO' });
  });
});
