import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CofreSecretos,
  esIPPrivada,
  despacharWebhooks,
  esperaReintento,
  firmar,
  MAX_INTENTOS,
  problemaDeURL,
  verificarFirmaWebhook,
} from '../src/webhooks';
import { cerrarPool, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

afterAll(cerrarPool);

describe('firma HMAC', () => {
  const ahora = () => 1_800_000_000_000;
  const t = 1_800_000_000;
  it('verifica la firma del cuerpo crudo y rechaza alteraciones, otro secreto o firmas viejas', () => {
    const cuerpo = '{"evento":"documento.emitido"}';
    const cab = firmar('whsec_x', cuerpo, t);
    expect(cab).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verificarFirmaWebhook(cuerpo, cab, 'whsec_x', { ahora })).toBe(true);
    expect(verificarFirmaWebhook(`${cuerpo} `, cab, 'whsec_x', { ahora })).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, cab, 'whsec_y', { ahora })).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, cab, 'whsec_x', { ahora: () => ahora() + 301_000 })).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, 't=abc,v1=00', 'whsec_x', { ahora })).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, null, 'whsec_x', { ahora })).toBe(false);
  });

  it('secretos en reposo: AES-256-GCM con clave maestra; sin ella, marcados como planos', () => {
    const cofre = new CofreSecretos(Buffer.alloc(32, 7).toString('base64'));
    const g = cofre.guardar('whsec_abc');
    expect(g.startsWith('gcm:')).toBe(true);
    expect(g).not.toContain('whsec_abc');
    expect(cofre.leer(g)).toBe('whsec_abc');
    expect(() => new CofreSecretos(Buffer.alloc(32, 8).toString('base64')).leer(g)).toThrow();
    expect(new CofreSecretos(null).guardar('s')).toBe('plano:s');
    expect(() => new CofreSecretos('corta')).toThrow(/32 bytes/);
  });

  it('reintentos con espera creciente hasta 6 horas', () => {
    expect([1, 2, 3, 8].map(esperaReintento)).toEqual([30_000, 60_000, 120_000, 3_840_000]);
    expect(esperaReintento(20)).toBe(6 * 3600 * 1000);
  });
});

describe('destinos de webhooks (SSRF)', () => {
  it('modo alojado: solo https y sin direcciones internas', () => {
    for (const url of [
      'http://ejemplo.hn/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x',
      'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[fd00::1]/x', 'https://172.16.0.1/x', 'https://u:p@ejemplo.hn/x',
      'https://servicio.internal/x', 'ftp://ejemplo.hn', 'no-es-url',
    ]) {
      expect(problemaDeURL(url, false), url).not.toBeNull();
    }
    for (const ip of ['[64:ff9b::a9fe:a9fe]', '[::a9fe:a9fe]', '[fec0::1]', '198.18.0.1', '[2002:7f00:1::]', '[::ffff:7f00:1]', '[2001:db8::1]', '192.0.0.8']) {
      expect(problemaDeURL(`https://${ip}/x`, false), ip).not.toBeNull();
    }
    expect(esIPPrivada('2606:4700:4700::1111')).toBe(false);
    expect(esIPPrivada('8.8.8.8')).toBe(false);
    expect(problemaDeURL('https://hooks.ejemplo.hn/factura', false)).toBeNull();
    expect(problemaDeURL('https://8.8.8.8/x', false)).toBeNull();
  });
  it('modo local: se permite http y la red del negocio', () => {
    expect(problemaDeURL('http://192.168.1.20:3000/hook', true)).toBeNull();
    expect(problemaDeURL('file:///etc/passwd', true)).not.toBeNull();
  });
});

describe.skipIf(!URL_PG)('entregas', () => {
  it('emitir y anular encolan avisos firmados; el receptor los verifica; los fallos se reintentan hasta FALLIDA', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    const alta = await admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', eventos: ['documento.emitido', 'documento.anulado'] });
    expect(alta.status).toBe(201);
    const { secreto, id } = (await alta.json()) as { secreto: string; id: string };
    expect(secreto).toMatch(/^whsec_/);
    // El secreto no está en claro en la base del modo alojado (aquí, modo local sin clave: marcado como plano).
    const doc = (await (await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).json()).documento;
    await admin('POST', `/v1/documentos/${doc.numero}/anular`, { motivo: 'prueba' });
    // Una emisión rechazada no encola nada.
    await admin('POST', '/v1/documentos', venta('-1'), { 'idempotency-key': randomUUID() });

    const recibidas: { cuerpo: string; cabeceras: Headers }[] = [];
    let ahoraMs = Date.now();
    const correr = (estado: number) =>
      despacharWebhooks({
        pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, ahora: () => new Date(ahoraMs),
        fetch: (async (_url: string, init: RequestInit) => {
          recibidas.push({ cuerpo: String(init.body), cabeceras: new Headers(init.headers) });
          return new Response(null, { status: estado });
        }) as unknown as typeof fetch,
      });

    // Primer intento: el receptor responde 500.
    expect(await correr(500)).toBeGreaterThanOrEqual(2);
    const deEste = () => recibidas.filter((r) => JSON.parse(r.cuerpo).datos.numero === doc.numero);
    expect(deEste().map((r) => r.cabeceras.get('x-facturahn-evento'))).toEqual(['documento.emitido', 'documento.anulado']);
    for (const r of deEste()) {
      expect(verificarFirmaWebhook(r.cuerpo, r.cabeceras.get('x-facturahn-firma'), secreto)).toBe(true);
      expect(JSON.parse(r.cuerpo).id).toBe(r.cabeceras.get('x-facturahn-entrega'));
    }
    const estado = async () =>
      (await pool.query('SELECT evento, estado, intentos, ultimo_codigo FROM api_entregas WHERE tenant = $1 AND webhook_id = $2 ORDER BY id', [tenant, id])).rows;
    expect(await estado()).toEqual([
      { evento: 'documento.emitido', estado: 'PENDIENTE', intentos: 1, ultimo_codigo: 500 },
      { evento: 'documento.anulado', estado: 'PENDIENTE', intentos: 1, ultimo_codigo: 500 },
    ]);
    // Antes de que pase la espera no se reintenta.
    recibidas.length = 0;
    await pool.query("UPDATE api_entregas SET proximo = now() + interval '1 hour' WHERE tenant = $1", [tenant]);
    await correr(200);
    expect(deEste()).toHaveLength(0);
    // Pasada la espera, se entrega con el mismo id de entrega.
    await pool.query('UPDATE api_entregas SET proximo = now() WHERE tenant = $1', [tenant]);
    await correr(200);
    expect(deEste()).toHaveLength(2);
    expect((await estado()).map((e) => [e.estado, e.intentos])).toEqual([['ENTREGADA', 2], ['ENTREGADA', 2]]);

    // Un receptor caído agota los intentos.
    const doc2 = (await (await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).json()).documento;
    for (let i = 0; i < MAX_INTENTOS; i++) {
      await pool.query('UPDATE api_entregas SET proximo = now() WHERE tenant = $1 AND estado = $2', [tenant, 'PENDIENTE']);
      await correr(503);
    }
    const ultima = (await estado()).at(-1);
    expect(ultima).toMatchObject({ estado: 'FALLIDA', intentos: MAX_INTENTOS });
    expect(doc2.numero).toBe('000-001-01-00000002');
  });

  it('autorizacion.agotada y autorizacion.por_vencer se avisan una sola vez', async () => {
    const { admin, tenant } = await tenantListo({}, { rangoFinal: 3 });
    const pool = await poolPrueba();
    await admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', eventos: ['autorizacion.por_vencer', 'autorizacion.agotada'] });
    for (let i = 0; i < 3; i++) await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    const eventos = (await pool.query('SELECT evento FROM api_entregas WHERE tenant = $1 ORDER BY id', [tenant])).rows.map((r) => r.evento);
    // 3 de 3: el aviso del 90 % salta en el tercero, que además agota el rango.
    expect(eventos).toEqual(['autorizacion.agotada']);
    const r = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    expect(r.status).toBe(422);
    expect((await r.json()).errores[0].codigo).toBe('RANGO_AGOTADO');
  });

  it('un webhook desactivado no recibe lo que tenía pendiente', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    const destino = `http://127.0.0.1:9/hook-${tenant}`;
    const { id } = (await (await admin('POST', '/v1/webhooks', { url: destino, eventos: ['documento.emitido'] })).json()) as { id: string };
    await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    await admin('DELETE', `/v1/webhooks/${id}`);
    let llamadas = 0;
    const fetchFalso = (async (url: string) => {
      if (url === destino) llamadas++;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, fetch: fetchFalso });
    expect(llamadas).toBe(0);
    const e = await pool.query('SELECT estado, ultimo_error FROM api_entregas WHERE tenant = $1', [tenant]);
    expect(e.rows).toEqual([{ estado: 'FALLIDA', ultimo_error: 'Webhook desactivado' }]);
  });

  it('entrega real por HTTP (sin fetch inyectado) a un receptor local, con firma verificable', async () => {
    const http = await import('node:http');
    let resolver!: (v: { cuerpo: string; firma: string }) => void;
    const recibido = new Promise<{ cuerpo: string; firma: string }>((r) => (resolver = r));
    const srv = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (d) => (cuerpo += d));
      req.on('end', () => {
        res.end('ok');
        resolver({ cuerpo, firma: String(req.headers['x-facturahn-firma']) });
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const puerto = (srv.address() as { port: number }).port;
      const { admin, tenant } = await tenantListo();
      const pool = await poolPrueba();
      const { secreto } = (await (await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${puerto}/hook`, eventos: ['documento.emitido'] })).json()) as { secreto: string };
      await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
      await despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true });
      const { cuerpo, firma } = await recibido;
      expect(verificarFirmaWebhook(cuerpo, firma, secreto)).toBe(true);
      const e = await pool.query('SELECT estado, ultimo_codigo FROM api_entregas WHERE tenant = $1', [tenant]);
      expect(e.rows).toEqual([{ estado: 'ENTREGADA', ultimo_codigo: 200 }]);
    } finally {
      srv.close();
    }
  });

  it('modo alojado: rechaza registrar un webhook hacia la red interna', async () => {
    const { admin } = await tenantListo({ modo: 'alojado' });
    const r = await admin('POST', '/v1/webhooks', { url: 'https://169.254.169.254/latest/meta-data', eventos: ['documento.emitido'] });
    expect(r.status).toBe(422);
    expect((await r.json()).error.codigo).toBe('WEBHOOK_URL');
  });
});
