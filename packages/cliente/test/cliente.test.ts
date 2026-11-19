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
    const fetchApi = ((entrada: RequestInfo | URL, init?: RequestInit) => app.fetch(entrada instanceof Request ? entrada : new Request(entrada, init))) as typeof fetch;
    const fhn = crearCliente({ url: 'http://api.local/', llave: llaveAdmin, fetch: fetchApi });
    await fhn.api.POST('/v1/emisores', {
      body: {
        rtn: '99990000000001', razonSocial: 'Ejemplo', nombreComercial: 'Ejemplo', direccionCasaMatriz: 'Tegucigalpa',
        direccionEstablecimiento: 'Tegucigalpa', telefono: '0000-0003', correo: 'a@ejemplo.example',
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

    // DEC-031: el operador del cliente (cabecera X-Operador, con tildes) llega a la bitácora y se imprime si se pide.
    const cajero = crearCliente({ url: 'http://api.local', llave: llaveAdmin, operador: 'José Núñez', fetch: fetchApi });
    const conOperador = await cajero.emitir({ ...venta, imprimirOperador: true }, { idempotencyKey: 'venta-3' });
    expect(conOperador.documento.operador).toBe('José Núñez');
    expect(await cajero.descargar(conOperador.documento.numero, 'txt')).toContain('Atendido por: José Núñez');

    expect((await cajero.anular(a.documento.numero, 'Error de precio', { operador: 'Supervisora Ana' })).estado).toBe('ANULADO');
    const bit = (await fhn.api.GET('/v1/bitacora', { params: { query: {} } })).data as unknown as { eventos: { tipo: string; numero?: string; operador?: string }[] };
    expect(bit.eventos.reverse().filter((e) => e.numero).map((e) => [e.tipo, e.operador ?? null])).toEqual([
      ['DOCUMENTO_EMITIDO', null], ['DOCUMENTO_EMITIDO', 'José Núñez'], ['DOCUMENTO_ANULADO', 'Supervisora Ana'],
    ]);
    const hoy = a.documento.fechaEmision;
    expect((await fhn.libroVentas(hoy, hoy)).filas).toHaveLength(2);
    expect(await fhn.libroVentasCSV(hoy, hoy)).toContain(a.documento.numero);
    expect(await fhn.exportacion(hoy, hoy)).toContain(a.documento.numero);

    // Paginación (DEC-047): página por página con el cursor, o todo de una vez con documentos().
    const p1 = await fhn.paginaDocumentos(hoy, hoy, { limite: 1 });
    expect(p1).toMatchObject({ hayMas: true, documentos: [{ numero: a.documento.numero }] });
    const p2 = await fhn.paginaDocumentos(hoy, hoy, { limite: 1, cursor: p1.siguiente! });
    expect(p2).toMatchObject({ hayMas: false, siguiente: null, documentos: [{ numero: conOperador.documento.numero }] });
    expect((await fhn.documentos(hoy, hoy)).map((d) => d.numero)).toEqual([a.documento.numero, conOperador.documento.numero]);
    await expect(fhn.documento('000-001-01-00000099')).rejects.toMatchObject({ estado: 404, codigo: 'NO_ENCONTRADO' });
  });
});
