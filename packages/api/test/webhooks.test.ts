import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CofreSecretos,
  esIPPrivada,
  despacharWebhooks,
  esperaReintento,
  firmar,
  MAX_INTENTOS,
  MAX_WEBHOOKS_ACTIVOS,
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
    // Entre el primer intento y el último (FALLIDA) pasan unas 14 h y media: un receptor caído una noche no pierde el aviso.
    let total = 0;
    for (let n = 1; n < MAX_INTENTOS; n++) total += esperaReintento(n);
    expect(total / 3_600_000).toBeCloseTo(14.525, 2);
  });
});

describe('destinos de webhooks (SSRF)', () => {
  it('modo alojado: solo https y sin direcciones internas', () => {
    for (const url of [
      'http://ejemplo.hn/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x',
      'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[fd00::1]/x', 'https://172.16.0.1/x', 'https://u:p@ejemplo.example/x',
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
    // URL propia de esta prueba: el despachador también entrega lo pendiente de otros tenants de la base.
    const urlHook = `http://127.0.0.1:9/hook-${randomUUID()}`;
    const alta = await admin('POST', '/v1/webhooks', { url: urlHook, eventos: ['documento.emitido', 'documento.anulado'] });
    expect(alta.status).toBe(201);
    const { secreto, webhook: { id } } = (await alta.json()) as { secreto: string; webhook: { id: string } };
    expect(secreto).toMatch(/^whsec_/);
    // El secreto no está en claro en la base del modo alojado (aquí, modo local sin clave: marcado como plano).
    const doc = (await (await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).json()).documento;
    await admin('POST', `/v1/documentos/${doc.numero}/anular`, { motivo: 'prueba' });
    // Una emisión rechazada no encola nada.
    await admin('POST', '/v1/documentos', venta('-1'), { 'idempotency-key': randomUUID() });

    const recibidas: { url: string; cuerpo: string; cabeceras: Headers }[] = [];
    let ahoraMs = Date.now();
    const correr = (estado: number) =>
      despacharWebhooks({
        pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, ahora: () => new Date(ahoraMs),
        fetch: (async (url: string, init: RequestInit) => {
          recibidas.push({ url: String(url), cuerpo: String(init.body), cabeceras: new Headers(init.headers) });
          return new Response(null, { status: estado });
        }) as unknown as typeof fetch,
      });

    // Primer intento: el receptor responde 500.
    expect(await correr(500)).toBeGreaterThanOrEqual(2);
    const deEste = () => recibidas.filter((r) => r.url === urlHook && JSON.parse(r.cuerpo).datos.numero === doc.numero);
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
    const { webhook: { id } } = (await (await admin('POST', '/v1/webhooks', { url: destino, eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } };
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

  it('un receptor que responde byte a byte no pasa del tiempo máximo ni retrasa a otro tenant', async () => {
    const http = await import('node:http');
    // Receptor lento: responde una cabecera válida de a un byte cada 50 ms, sin terminarla nunca.
    const sockets = new Set<import('node:net').Socket>();
    const lento = http.createServer();
    lento.on('connection', (s) => {
      sockets.add(s);
      s.write('HTTP/1.1 200 OK\r\nX-Goteo: ');
      const goteo = setInterval(() => s.writable && s.write('a'), 50);
      s.on('close', () => clearInterval(goteo));
    });
    let rapidoRecibio = 0;
    const rapido = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        rapidoRecibio++;
        res.end('ok');
      });
    });
    await Promise.all([lento, rapido].map((srv) => new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))));
    try {
      const puerto = (srv: typeof lento) => (srv.address() as { port: number }).port;
      const a = await tenantListo();
      const b = await tenantListo();
      const pool = await poolPrueba();
      await a.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${puerto(lento)}/hook`, eventos: ['documento.emitido'] });
      await b.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${puerto(rapido)}/hook`, eventos: ['documento.emitido'] });
      await a.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
      await b.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });

      // Tope total por entrega: con 300 ms, la entrega lenta termina en «Tiempo agotado» poco después.
      const enCurso = new Set<string>();
      const inicio = Date.now();
      const pasada = despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, tiempoMaximo: 300, enCurso });
      // Mientras el tenant lento está en curso, otra pasada lo omite y atiende al otro.
      await new Promise((r) => setTimeout(r, 50));
      expect(enCurso.has(a.tenant)).toBe(true);
      await pasada;
      expect(Date.now() - inicio).toBeLessThan(2_000);
      expect(enCurso.size).toBe(0);
      const estado = async (t: string) => (await pool.query('SELECT estado, ultimo_error FROM api_entregas WHERE tenant = $1', [t])).rows;
      expect(await estado(a.tenant)).toEqual([{ estado: 'PENDIENTE', ultimo_error: 'Tiempo agotado' }]);
      expect(await estado(b.tenant)).toEqual([{ estado: 'ENTREGADA', ultimo_error: null }]);
      expect(rapidoRecibio).toBe(1);

      // Un tenant marcado como en curso no se despacha en otra pasada.
      await b.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
      const ocupado = new Set([b.tenant]);
      await despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, tiempoMaximo: 300, enCurso: ocupado });
      expect(rapidoRecibio).toBe(1);
      expect(ocupado).toEqual(new Set([b.tenant]));
    } finally {
      for (const s of sockets) s.destroy();
      lento.close();
      rapido.close();
    }
  });

  it('modo alojado: rechaza registrar un webhook hacia la red interna', async () => {
    const { admin } = await tenantListo({ modo: 'alojado' });
    const r = await admin('POST', '/v1/webhooks', { url: 'https://169.254.169.254/latest/meta-data', eventos: ['documento.emitido'] });
    expect(r.status).toBe(422);
    expect((await r.json()).error.codigo).toBe('WEBHOOK_URL');
  });
});

describe.skipIf(!URL_PG)('entregas: id público, arrendamiento y límite de webhooks', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it('X-FacturaHN-Entrega es un UUID por entrega, igual al id del cuerpo y el mismo en cada reintento', async () => {
    const a = await tenantListo();
    const b = await tenantListo();
    const pool = await poolPrueba();
    for (const t of [a, b]) {
      expect((await t.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${t.tenant}`, eventos: ['documento.emitido'] })).status).toBe(201);
      expect((await t.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    }
    const recibidas: { tenant: string; entrega: string | null; id: unknown }[] = [];
    const correr = (estado: number) =>
      despacharWebhooks({
        pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [a.tenant, b.tenant],
        fetch: (async (url: string, init: RequestInit) => {
          recibidas.push({ tenant: String(url).split('hook-')[1]!, entrega: new Headers(init.headers).get('x-facturahn-entrega'), id: JSON.parse(String(init.body)).id });
          return new Response(null, { status: estado });
        }) as unknown as typeof fetch,
      });
    await correr(500);
    expect(recibidas).toHaveLength(2);
    for (const r of recibidas) {
      expect(r.entrega).toMatch(UUID);
      expect(r.id).toBe(r.entrega);
    }
    expect(new Set(recibidas.map((r) => r.entrega)).size).toBe(2);
    const primeras = new Map(recibidas.map((r) => [r.tenant, r.entrega]));
    // En la base: el UUID es la columna `entrega`; el id interno (bigserial) no sale.
    const filas = await pool.query('SELECT tenant, id::text, entrega::text FROM api_entregas WHERE tenant = ANY($1)', [[a.tenant, b.tenant]]);
    for (const f of filas.rows) {
      expect(primeras.get(f.tenant)).toBe(f.entrega);
      expect(recibidas.map((r) => r.entrega)).not.toContain(f.id);
    }
    // Reintento: el mismo id.
    recibidas.length = 0;
    await pool.query('UPDATE api_entregas SET proximo = now() WHERE tenant = ANY($1)', [[a.tenant, b.tenant]]);
    await correr(200);
    expect(new Map(recibidas.map((r) => [r.tenant, r.entrega]))).toEqual(primeras);
  });

  it('un resultado tardío (arrendamiento vencido) no devuelve a PENDIENTE una entrega que otra pasada ya entregó', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] });
    await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    await despacharWebhooks({
      pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant],
      fetch: (async () => {
        // Mientras este envío tarda, el arrendamiento vence y otra pasada reclama y entrega el aviso.
        await pool.query(
          "UPDATE api_entregas SET estado = 'ENTREGADA', intentos = intentos + 1, ultimo_codigo = 200, proximo = now() + interval '1 hour' WHERE tenant = $1",
          [tenant],
        );
        return new Response(null, { status: 500 });
      }) as unknown as typeof fetch,
    });
    const e = await pool.query('SELECT estado, intentos, ultimo_codigo FROM api_entregas WHERE tenant = $1', [tenant]);
    expect(e.rows).toEqual([{ estado: 'ENTREGADA', intentos: 1, ultimo_codigo: 200 }]);
  });

  it('un resultado tardío tampoco pisa una entrega que otra pasada reclamó de nuevo', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] });
    await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    await despacharWebhooks({
      pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant],
      fetch: (async () => {
        // Otra pasada reclamó la entrega: nuevo arrendamiento, sigue PENDIENTE.
        await pool.query("UPDATE api_entregas SET proximo = now() + interval '7 minutes' WHERE tenant = $1", [tenant]);
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch,
    });
    const e = await pool.query('SELECT estado, intentos FROM api_entregas WHERE tenant = $1', [tenant]);
    expect(e.rows).toEqual([{ estado: 'PENDIENTE', intentos: 0 }]);
  });

  it(`a lo sumo ${MAX_WEBHOOKS_ACTIVOS} webhooks activos por tenant, también con altas simultáneas`, async () => {
    expect(MAX_WEBHOOKS_ACTIVOS).toBe(20);
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    const altas = await Promise.all(
      Array.from({ length: 25 }, (_, i) => admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}-${i}`, eventos: ['documento.emitido'] })),
    );
    const estados = altas.map((r) => r.status);
    expect(estados.filter((e) => e === 201)).toHaveLength(20);
    expect(estados.filter((e) => e === 409)).toHaveLength(5);
    const rechazada = altas.find((r) => r.status === 409)!;
    expect((await rechazada.json()).error.codigo).toBe('LIMITE_WEBHOOKS');
    expect((await pool.query('SELECT count(*)::int AS n FROM api_webhooks WHERE tenant = $1 AND activo', [tenant])).rows[0].n).toBe(20);

    // Una emisión encola a lo sumo 20 entregas.
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    expect((await pool.query('SELECT count(*)::int AS n FROM api_entregas WHERE tenant = $1', [tenant])).rows[0].n).toBe(20);

    // Desactivar uno libera un lugar.
    const { webhooks } = (await (await admin('GET', '/v1/webhooks')).json()) as { webhooks: { id: string }[] };
    expect((await admin('DELETE', `/v1/webhooks/${webhooks[0]!.id}`)).status).toBe(200);
    expect((await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}-x`, eventos: ['documento.emitido'] })).status).toBe(201);
    expect((await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}-y`, eventos: ['documento.emitido'] })).status).toBe(409);
  });
});
