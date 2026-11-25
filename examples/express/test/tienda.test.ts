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
const JSON_ = { 'content-type': 'application/json' };

describe('POST /pedidos/:id/factura solo acepta JSON', () => {
  it('text/plain, un formulario o sin content-type: 415 y no se emite nada', async () => {
    const llamadas: string[] = [];
    const fhn = {
      emitir: async () => {
        llamadas.push('emitir');
        throw new Error('El emisor de prueba no emite.');
      },
    } as unknown as typeof fhnSinUso;
    const tienda = crearTienda({
      fhn,
      buscarPedido: async (id) => {
        llamadas.push(`buscar ${id}`);
        return { id, articulos: [{ descripcion: 'Cemento', cantidad: 1, precioConISV: '245.00' }] };
      },
      guardarFactura: async () => void llamadas.push('guardar'),
      secretoWebhook: 'x',
    });
    const { base, cerrar } = await escuchar(tienda);
    const error = console.error;
    console.error = () => undefined;
    try {
      const enviar = (headers: Record<string, string>, body?: string) => fetch(`${base}/pedidos/1/factura`, { method: 'POST', headers, body });
      // Lo que un formulario de otro sitio puede enviar sin preflight de CORS.
      expect((await enviar({ 'content-type': 'text/plain' }, '{}')).status).toBe(415);
      expect((await enviar({ 'content-type': 'application/x-www-form-urlencoded' }, 'a=1')).status).toBe(415);
      expect((await enviar({ 'content-type': 'multipart/form-data; boundary=x' }, '--x--')).status).toBe(415);
      expect((await enviar({})).status).toBe(415);
      expect((await enviar({ 'content-type': 'application/jsonx' }, '{}')).status).toBe(415);
      expect(llamadas).toEqual([]);
      // Con JSON sí llega al pedido y al emisor (el de prueba falla a propósito: 500).
      expect((await enviar({ 'content-type': 'Application/JSON; charset=utf-8' }, '{}')).status).toBe(500);
      expect(llamadas).toEqual(['buscar 1', 'emitir']);
    } finally {
      console.error = error;
      cerrar();
    }
  });
});

describe('receptor de webhooks', () => {
  it('acepta firmas válidas una sola vez por aviso y rechaza las falsas', async () => {
    const recibidos: AvisoWebhook[] = [];
    const tienda = crearTienda({
      fhn: fhnSinUso, buscarPedido: async () => null, guardarFactura: async () => undefined, secretoWebhook: 's3creto',
      // Lento a propósito: dos entregas simultáneas del mismo aviso deben procesarse una sola vez.
      alRecibirAviso: async (a) => { await new Promise((r) => setTimeout(r, 50)); recibidos.push(a); },
    });
    const { base, cerrar } = await escuchar(tienda);
    try {
      const cuerpo = JSON.stringify({ id: '77', evento: 'documento.anulado', creado: new Date().toISOString(), datos: { numero: '000-001-01-00000001' } });
      const enviar = (firma: string, c = cuerpo) => fetch(`${base}/webhooks/factura-hn`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-facturahn-firma': firma }, body: c });
      const t = Math.floor(Date.now() / 1000);
      const dos = await Promise.all([enviar(firmar('s3creto', cuerpo, t)), enviar(firmar('s3creto', cuerpo, t))]);
      expect(dos.map((r) => r.status)).toEqual([204, 204]);
      expect((await enviar(firmar('s3creto', cuerpo, t))).status).toBe(204);
      expect(recibidos).toHaveLength(1);
      expect((await enviar(firmar('otro', cuerpo, t))).status).toBe(400);
      expect((await enviar(firmar('s3creto', cuerpo, t), cuerpo.replace('77', '78'))).status).toBe(400);
      expect((await enviar(firmar('s3creto', cuerpo, t - 600))).status).toBe(400);
      // Rotación del secreto: la API firma con los dos (dos v1). Basta una válida, en cualquier orden.
      const otro = JSON.stringify({ id: '79', evento: 'webhook.prueba', creado: new Date().toISOString(), datos: {} });
      expect((await enviar(firmar(['viejo', 's3creto'], otro, t), otro)).status).toBe(204);
      expect((await enviar(firmar(['s3creto', 'viejo'], otro, t), otro)).status).toBe(204);
      expect((await enviar(firmar(['viejo', 'otro'], otro, t), otro)).status).toBe(400);
      expect(recibidos.map((a) => a.id)).toEqual(['77', '79']);
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
    await admin.api.POST('/v1/emisores', { body: { rtn: '99990000000001', razonSocial: 'Ferretería Norte', nombreComercial: 'Ferretería Norte', direccionCasaMatriz: 'SPS', direccionEstablecimiento: 'SPS', telefono: '0000-0002', correo: 'f@ejemplo.example' } });
    await admin.registrarAutorizacion({ cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-10-31' });
    const { data } = await admin.api.POST('/v1/llaves', { body: { nombre: 'tienda', rol: 'caja', establecimiento: '000', puntoEmision: '001' } });
    const pedidos: Record<string, Pedido> = {
      '1': { id: '1', articulos: [{ descripcion: 'Cemento', cantidad: 2, precioConISV: '245.00' }] },
      '2': { id: '2', articulos: [{ descripcion: 'Malo', cantidad: 1, precioConISV: '-1.00' }] },
    };
    const tienda = crearTienda({
      fhn: crearCliente({ url: 'http://api', llave: (data as { secreto: string }).secreto, fetch: fetchApi }),
      buscarPedido: async (id) => pedidos[id] ?? null,
      guardarFactura: async (id, numero) => void (pedidos[id]!.numeroFactura = numero),
      secretoWebhook: 'x',
      operadorDe: (req) => req.get('x-usuario-prueba'),
    });
    const { base, cerrar } = await escuchar(tienda);
    try {
      const r1 = await fetch(`${base}/pedidos/1/factura`, { method: 'POST', headers: { ...JSON_, 'x-usuario-prueba': 'Despacho Ana' } });
      expect(r1.status).toBe(201);
      const f = await r1.json();
      expect(f).toMatchObject({ numero: '000-001-01-00000001', total: 490 });
      const r2 = await fetch(`${base}/pedidos/1/factura`, { method: 'POST', headers: JSON_ });
      expect([r2.status, (await r2.json()).numero]).toEqual([200, f.numero]);
      const pdf = await fetch(`${base}${f.pdf}`);
      expect(pdf.headers.get('content-type')).toContain('application/pdf');
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
      const malo = await fetch(`${base}/pedidos/2/factura`, { method: 'POST', headers: JSON_ });
      expect(malo.status).toBe(422);
      expect((await malo.json()).errores.length).toBeGreaterThan(0);
      expect((await fetch(`${base}/pedidos/9/factura`, { method: 'POST', headers: JSON_ })).status).toBe(404);
      // Sin factura emitida o pedido ajeno: 404. No hay ruta por número de factura.
      expect((await fetch(`${base}/pedidos/2/factura.pdf`)).status).toBe(404);
      expect((await fetch(`${base}/facturas/000-001-01-00000001.pdf`)).status).toBe(404);
      // El operador es opcional y no lo exige el Reglamento; apoya los
      // controles de auditoría del Art. 53 num. 2. El de la sesión llega a la bitácora junto a la llave de la tienda.
      const bit = (await admin.api.GET('/v1/bitacora', { params: { query: {} } })).data as unknown as { eventos: { numero?: string; tipo: string; operador?: string; actor: string }[] };
      expect(bit.eventos.find((e) => e.tipo === 'DOCUMENTO_EMITIDO')).toMatchObject({ numero: f.numero, operador: 'Despacho Ana', actor: expect.stringMatching(/\(caja: tienda\)$/) });
    } finally {
      cerrar();
    }

    // Segunda corrida: la tienda reinicia sin recordar nada (como servidor.ts, con sus pedidos en memoria) contra
    // la misma API. El pedido ya facturado devuelve su factura y uno nuevo toma el número que diga la API.
    const pedidos2: Record<string, Pedido> = {
      '1': { id: '1', articulos: [{ descripcion: 'Cemento', cantidad: 2, precioConISV: '245.00' }] },
      '3': { id: '3', articulos: [{ descripcion: 'Arena', cantidad: 1, precioConISV: '100.00' }] },
    };
    const otraVez = await escuchar(crearTienda({
      fhn: crearCliente({ url: 'http://api', llave: (data as { secreto: string }).secreto, fetch: fetchApi }),
      buscarPedido: async (id) => pedidos2[id] ?? null,
      guardarFactura: async (id, numero) => void (pedidos2[id]!.numeroFactura = numero),
      secretoWebhook: 'x',
    }));
    try {
      const repetida = await fetch(`${otraVez.base}/pedidos/1/factura`, { method: 'POST', headers: JSON_ });
      expect(repetida.status).toBe(200);
      const r = await repetida.json();
      const nueva = await fetch(`${otraVez.base}/pedidos/3/factura`, { method: 'POST', headers: JSON_ });
      expect(nueva.status).toBe(201);
      expect((await nueva.json()).numero).not.toBe(r.numero);
      const pdf = await fetch(`${otraVez.base}${r.pdf}`);
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      otraVez.cerrar();
    }
  });
});
