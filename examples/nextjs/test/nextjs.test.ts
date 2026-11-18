import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp, crearTenant, firmar, migrarApi } from '@factura-hn/api';
import { crearCliente } from '@factura-hn/cliente';
import { POST as webhook } from '../app/api/webhooks/factura-hn/route';
import { firmaValida } from '../lib/enlaces';
import { facturarVenta } from '../lib/ventas';

describe('route handler de webhooks', () => {
  it('204 con firma válida, 400 sin ella o con otro secreto', async () => {
    process.env.FHN_SECRETO_WEBHOOK = 'secreto-next';
    const cuerpo = JSON.stringify({ id: '5', evento: 'documento.emitido', creado: new Date().toISOString(), datos: {} });
    const t = Math.floor(Date.now() / 1000);
    const pedir = (firma?: string) => webhook(new Request('http://x/api/webhooks/factura-hn', { method: 'POST', body: cuerpo, headers: firma ? { 'x-facturahn-firma': firma } : {} }));
    expect((await pedir(firmar('secreto-next', cuerpo, t))).status).toBe(204);
    expect((await pedir()).status).toBe(400);
    expect((await pedir(firmar('otro', cuerpo, t))).status).toBe(400);
  });
});

const URL_PG = process.env.FHN_PG_URL;
describe.skipIf(!URL_PG)('server action contra la API', () => {
  const pool = new pg.Pool({ connectionString: URL_PG, max: 5 });
  afterAll(() => pool.end());

  it('emite una vez por clave, da una clave nueva y devuelve los errores fiscales', async () => {
    await migrarApi(pool);
    const tenant = `next-${randomUUID().slice(0, 8)}`;
    const { llaveAdmin } = await crearTenant(pool, { tenant, nombre: tenant });
    const api = crearApp({ pool, modo: 'local' });
    const fetchApi = ((e: RequestInfo | URL, init?: RequestInit) => api.fetch(e instanceof Request ? e : new Request(e, init))) as typeof fetch;
    const admin = crearCliente({ url: 'http://api', llave: llaveAdmin, fetch: fetchApi });
    await admin.api.POST('/v1/emisores', { body: { rtn: '08011999123456', razonSocial: 'Café Copán', nombreComercial: 'Café Copán', direccionCasaMatriz: 'Copán', direccionEstablecimiento: 'Copán', telefono: '2651-0000', correo: 'c@ejemplo.hn' } });
    await admin.registrarAutorizacion({ cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-10-31' });

    // Como en producción: la app usa una llave de caja, atada a su punto de emisión.
    const { data } = await admin.api.POST('/v1/llaves', { body: { nombre: 'next', rol: 'caja', establecimiento: '000', puntoEmision: '001' } });
    const fhn = crearCliente({ url: 'http://api', llave: (data as { llave: string }).llave, fetch: fetchApi });
    const formulario = (campos: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      return f;
    };
    process.env.FHN_SECRETO_ENLACES = 'x'.repeat(40);
    let n = 0;
    const nueva = () => `clave-nueva-${String(++n).padStart(4, '0')}`;
    const venta = { descripcion: 'Café molido 1 lb', cantidad: '2', precio: '120.00', cliente: 'Hotel Plaza', rtn: '08019005123456' };

    // Venta 1: se emite y el formulario recibe una clave nueva.
    const r1 = await facturarVenta(fhn, formulario({ ...venta, clave: 'clave-inicial-1' }), nueva);
    // Precio con ISV incluido (D-01): el total puede quedar un centavo abajo del precio, nunca arriba.
    expect(r1).toMatchObject({ tipo: 'emitida', numero: '000-001-01-00000001', total: 239.99, repetida: false, clave: 'clave-nueva-0001' });
    // Doble clic con la misma clave: la misma factura.
    expect(await facturarVenta(fhn, formulario({ ...venta, clave: 'clave-inicial-1' }), nueva)).toMatchObject({ numero: '000-001-01-00000001', repetida: true });

    // Venta 2 con un error: la clave vigente (no la de la venta 1) sigue disponible para corregir.
    const r2 = await facturarVenta(fhn, formulario({ ...venta, clave: 'clave-nueva-0001', precio: '-3' }), nueva);
    expect(r2).toMatchObject({ tipo: 'error', clave: 'clave-nueva-0001' });
    // Corregida, con el mismo contenido que la venta 1 (frecuente en una cafetería): es una factura NUEVA.
    const r3 = await facturarVenta(fhn, formulario({ ...venta, clave: r2.tipo === 'error' ? r2.clave : '' }), nueva);
    expect(r3).toMatchObject({ tipo: 'emitida', numero: '000-001-01-00000002', repetida: false });

    expect(await facturarVenta(fhn, formulario({ ...venta, clave: 'x' }), nueva)).toMatchObject({ tipo: 'error', mensajes: ['Formulario vencido: vuelve a intentar.'] });

    // El PDF solo sale con el enlace firmado de esa factura.
    const pdf = r1.tipo === 'emitida' ? r1.pdf : '';
    const firma = new URL(pdf, 'http://x').searchParams.get('firma');
    expect(firmaValida('000-001-01-00000001', firma)).toBe(true);
    expect(firmaValida('000-001-01-00000002', firma)).toBe(false);
    expect(firmaValida('000-001-01-00000001', null)).toBe(false);
  });
});
