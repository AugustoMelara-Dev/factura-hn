import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp, crearTenant, firmar, migrarApi } from '@factura-hn/api';
import { crearCliente, type AvisoWebhook } from '@factura-hn/cliente';
import { crearTienda, type Pedido } from '../src/app';

async function escuchar(app: ReturnType<typeof crearTienda>) {
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, cerrar: () => srv.close() };
}

const fhnSinUso = crearCliente({ url: 'http://127.0.0.1:9', llave: 'x' });

describe('receptor de webhooks', () => {
  it('acepta firmas válidas una sola vez por aviso y rechaza las falsas', async () => {
    const recibidos: AvisoWebhook[] = [];
    const tienda = crearTienda({ fhn: fhnSinUso, buscarPedido: async () => null, secretoWebhook: 's3creto', alRecibirAviso: async (a) => void recibidos.push(a) });
    const { base, cerrar } = await escuchar(tienda);
    try {
      const cuerpo = JSON.stringify({ id: '77', evento: 'documento.anulado', creado: new Date().toISOString(), datos: { numero: '000-001-01-00000001' } });
      const enviar = (firma: string, c = cuerpo) => fetch(`${base}/webhooks/factura-hn`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-facturahn-firma': firma }, body: c });
      const t = Math.floor(Date.now() / 1000);
      expect((await enviar(firmar('s3creto', cuerpo, t))).status).toBe(204);
      expect((await enviar(firmar('s3creto', cuerpo, t))).status).toBe(204);
      expect(recibidos).toHaveLength(1);
      expect((await enviar(firmar('otro', cuerpo, t))).status).toBe(400);
      expect((await enviar(firmar('s3creto', cuerpo, t), cuerpo.replace('77', '78'))).status).toBe(400);
      expect((await enviar(firmar('s3creto', cuerpo, t - 600))).status).toBe(400);
    } finally {
      cerrar();
    }
  });
});

const URL_PG = process.env.FHN_PG_URL;
describe.skipIf(!URL_PG)('tienda contra la API', () => {
  const pool = new pg.Pool({ connectionString: URL_PG, max: 5 });
  afterAll(() => pool.end());

  it('factura un pedido una sola vez, entrega el PDF y devuelve los errores fiscales', async () => {
    await migrarApi(pool);
    const tenant = `express-${randomUUID().slice(0, 8)}`;
    const { llaveAdmin } = await crearTenant(pool, { tenant, nombre: tenant });
    const api = crearApp({ pool, modo: 'local' });
    const fetchApi = ((e: RequestInfo | URL, init?: RequestInit) => api.fetch(e instanceof Request ? e : new Request(e, init))) as typeof fetch;
    const admin = crearCliente({ url: 'http://api', llave: llaveAdmin, fetch: fetchApi });
    await admin.api.POST('/v1/emisores', { body: { rtn: '08011999123456', razonSocial: 'Ferretería Norte', nombreComercial: 'Ferretería Norte', direccionCasaMatriz: 'SPS', direccionEstablecimiento: 'SPS', telefono: '2550-0000', correo: 'f@ejemplo.hn' } });
    await admin.registrarAutorizacion({ cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-10-31' });
    const { data } = await admin.api.POST('/v1/llaves', { body: { nombre: 'tienda', rol: 'caja', establecimiento: '000', puntoEmision: '001' } });
    const pedidos: Record<string, Pedido> = {
      '1': { id: '1', articulos: [{ descripcion: 'Cemento', cantidad: 2, precioConISV: '245.00' }] },
      '2': { id: '2', articulos: [{ descripcion: 'Malo', cantidad: 1, precioConISV: '-1.00' }] },
    };
    const tienda = crearTienda({
      fhn: crearCliente({ url: 'http://api', llave: (data as { llave: string }).llave, fetch: fetchApi }),
      buscarPedido: async (id) => pedidos[id] ?? null,
      secretoWebhook: 'x',
    });
    const { base, cerrar } = await escuchar(tienda);
    try {
      const r1 = await fetch(`${base}/pedidos/1/factura`, { method: 'POST' });
      expect(r1.status).toBe(201);
      const f = await r1.json();
      expect(f).toMatchObject({ numero: '000-001-01-00000001', total: 490 });
      const r2 = await fetch(`${base}/pedidos/1/factura`, { method: 'POST' });
      expect([r2.status, (await r2.json()).numero]).toEqual([200, f.numero]);
      const pdf = await fetch(`${base}${f.pdf}`);
      expect(pdf.headers.get('content-type')).toContain('application/pdf');
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
      const malo = await fetch(`${base}/pedidos/2/factura`, { method: 'POST' });
      expect(malo.status).toBe(422);
      expect((await malo.json()).errores.length).toBeGreaterThan(0);
      expect((await fetch(`${base}/pedidos/9/factura`, { method: 'POST' })).status).toBe(404);
      expect((await fetch(`${base}/facturas/..%2F..%2Fetc.pdf`)).status).toBe(404);
    } finally {
      cerrar();
    }
  });
});
