import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CofreSecretos,
  ERROR_SECRETO_ILEGIBLE,
  esIPPrivada,
  despacharWebhooks,
  ESPERA_MAXIMA_MS,
  esperaBase,
  esperaReintento,
  firmar,
  leerFirma,
  MAX_INTENTOS,
  MAX_INTENTOS_PRUEBA,
  MAX_PRUEBAS_PENDIENTES,
  MAX_WEBHOOKS_ACTIVOS,
  problemaDeURL,
  verificarFirmaWebhook,
} from '../src/webhooks';
import pg from 'pg';
import { exigirEsquemaApi, mantenimientoApi, MARCA_PENDIENTES_V9, migrarApi, VERSION_ESQUEMA_API } from '../src/esquema';
import { cerrarPool, cliente, crearCaja, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

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

  it('reintentos durante unos 3 días: espera creciente hasta 6 horas, con fluctuación de ±20 %', () => {
    expect([1, 2, 3, 8, 10, 11].map((n) => esperaBase(n))).toEqual([30_000, 60_000, 120_000, 3_840_000, 15_360_000, 6 * 3600 * 1000]);
    expect(esperaBase(40)).toBe(ESPERA_MAXIMA_MS);
    // Con azar = 0,5 la espera es la base; en los extremos, 0,8 y 1,2 veces la base.
    expect(esperaReintento(3, () => 0.5)).toBe(120_000);
    expect(esperaReintento(3, () => 0)).toBe(96_000);
    expect(esperaReintento(3, () => 0.999_999)).toBe(144_000);
    for (let i = 0; i < 200; i++) {
      const e = esperaReintento(12);
      expect(e).toBeGreaterThanOrEqual(0.8 * ESPERA_MAXIMA_MS);
      expect(e).toBeLessThanOrEqual(1.2 * ESPERA_MAXIMA_MS);
    }
    // Entre el primer intento y el último (FALLIDA) pasan 74 h y media de media: unos 3 días.
    let total = 0;
    let minimo = 0;
    let maximo = 0;
    for (let n = 1; n < MAX_INTENTOS; n++) {
      total += esperaBase(n);
      minimo += esperaReintento(n, () => 0);
      maximo += esperaReintento(n, () => 0.999_999);
    }
    expect(MAX_INTENTOS).toBe(22);
    expect(total / 3_600_000).toBeCloseTo(74.525, 2);
    expect(minimo / 86_400_000).toBeGreaterThan(2.4);
    expect(maximo / 86_400_000).toBeLessThan(3.8);
  });

  it('acepta varias firmas v1: basta una válida; ignora entradas desconocidas y v1 mal formados', () => {
    const cuerpo = '{"evento":"webhook.prueba"}';
    // Dos firmas, una válida y otra no, en los dos órdenes.
    const valida = firmar('whsec_nuevo', cuerpo, t).split(',')[1]!;
    const otra = firmar('whsec_otro', cuerpo, t).split(',')[1]!;
    expect(verificarFirmaWebhook(cuerpo, `t=${t},${otra},${valida}`, 'whsec_nuevo', { ahora })).toBe(true);
    expect(verificarFirmaWebhook(cuerpo, `t=${t},${valida},${otra}`, 'whsec_nuevo', { ahora })).toBe(true);
    expect(verificarFirmaWebhook(cuerpo, `t=${t},${otra},${otra}`, 'whsec_nuevo', { ahora })).toBe(false);
    // La rotación: firmar con dos secretos da dos v1 en ese orden, y cada secreto verifica.
    const doble = firmar(['whsec_viejo', 'whsec_nuevo'], cuerpo, t);
    expect(doble).toMatch(/^t=1800000000,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
    expect(doble.split(',')[2]).toBe(valida);
    expect(verificarFirmaWebhook(cuerpo, doble, 'whsec_viejo', { ahora })).toBe(true);
    expect(verificarFirmaWebhook(cuerpo, doble, 'whsec_nuevo', { ahora })).toBe(true);
    expect(verificarFirmaWebhook(cuerpo, doble, 'whsec_otro', { ahora })).toBe(false);
    // Entradas de otros esquemas, espacios y un v1 mal formado no estorban.
    expect(verificarFirmaWebhook(cuerpo, `t=${t}, v0=abc, v1=zz, ${valida}, v2=${'0'.repeat(64)}`, 'whsec_nuevo', { ahora })).toBe(true);
    // Dos t es ambiguo: se rechaza. Sin ningún v1 bien formado, también.
    expect(verificarFirmaWebhook(cuerpo, `t=${t},t=${t + 1},${valida}`, 'whsec_nuevo', { ahora })).toBe(false);
    expect(verificarFirmaWebhook(cuerpo, `t=${t},v1=abc`, 'whsec_nuevo', { ahora })).toBe(false);
    expect(leerFirma(`t=${t},${otra},v1=xyz,${valida}`)).toEqual({ t, v1: [otra.slice(3), valida.slice(3)] });
    // Solo cuentan las 8 primeras firmas v1.
    expect(verificarFirmaWebhook(cuerpo, [`t=${t}`, ...Array(7).fill(otra), valida].join(','), 'whsec_nuevo', { ahora })).toBe(true);
    expect(verificarFirmaWebhook(cuerpo, [`t=${t}`, ...Array(8).fill(otra), valida].join(','), 'whsec_nuevo', { ahora })).toBe(false);
    // Secreto vacío: nunca verifica.
    expect(verificarFirmaWebhook(cuerpo, firmar('', cuerpo, t), '', { ahora })).toBe(false);
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
    let resolver!: (v: { cuerpo: string; firma: string; agente: string }) => void;
    const recibido = new Promise<{ cuerpo: string; firma: string; agente: string }>((r) => (resolver = r));
    const srv = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (d) => (cuerpo += d));
      req.on('end', () => {
        res.end('ok');
        resolver({ cuerpo, firma: String(req.headers['x-facturahn-firma']), agente: String(req.headers['user-agent']) });
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
      const { cuerpo, firma, agente } = await recibido;
      expect(verificarFirmaWebhook(cuerpo, firma, secreto)).toBe(true);
      // El User-Agent lleva la versión del paquete, no una fija.
      const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
      expect(agente).toBe(`factura-hn-webhooks/${version}`);
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

type Entrega = { id: string; webhookId: string; evento: string; estado: string; intentos: number; proximoIntento: string | null; ultimoCodigo: number | null; ultimoError: string | null };

describe.skipIf(!URL_PG)('webhooks de punta a punta: reintento, reenvío y rotación del secreto', () => {
  it('un receptor local que falla y luego responde: reintentos hasta FALLIDA, reenvío manual y rotación con gracia', async () => {
    const http = await import('node:http');
    let responder = 503;
    const recibidas: { cuerpo: string; firma: string; entrega: string }[] = [];
    const srv = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (d) => (cuerpo += d));
      req.on('end', () => {
        recibidas.push({ cuerpo, firma: String(req.headers['x-facturahn-firma']), entrega: String(req.headers['x-facturahn-entrega']) });
        res.statusCode = responder;
        res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const puerto = (srv.address() as { port: number }).port;
      const { admin, tenant, pool } = await tenantListo();
      const alta = await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${puerto}/hook`, eventos: ['documento.emitido'] });
      const { secreto: viejo, webhook } = (await alta.json()) as { secreto: string; webhook: { id: string; graciaHasta: string | null } };
      expect(webhook.graciaHasta).toBeNull();
      expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
      // Entrega real por HTTP, con un calendario de pruebas: 3 intentos y el próximo 1 s en el pasado (no 3 días de
      // verdad): `proximo` sale del reloj de Node y se compara con `now()` de PostgreSQL, que puede ir unos ms atrás.
      const despachar = () =>
        despacharWebhooks({
          pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant],
          reintentos: { maxIntentos: 3, espera: () => -1000 },
        });
      const entregas = async (q = '') => ((await (await admin('GET', `/v1/webhooks/${webhook.id}/entregas${q}`)).json()) as { entregas: Entrega[] }).entregas;

      // 1. El receptor falla: la entrega sigue PENDIENTE con el código y el error del intento.
      expect(await despachar()).toBe(1);
      const [primera] = await entregas();
      expect(primera).toMatchObject({ evento: 'documento.emitido', estado: 'PENDIENTE', intentos: 1, ultimoCodigo: 503, ultimoError: 'HTTP 503', webhookId: webhook.id });
      expect(primera!.proximoIntento).not.toBeNull();
      // 2. Se reintenta hasta agotar los intentos: FALLIDA, sin próximo intento, y nada más sale.
      await despachar();
      await despachar();
      expect((await entregas())[0]).toMatchObject({ id: primera!.id, estado: 'FALLIDA', intentos: 3, proximoIntento: null });
      expect(await despachar()).toBe(0);
      expect(recibidas).toHaveLength(3);
      for (const r of recibidas) {
        expect(r.entrega).toBe(primera!.id);
        expect(verificarFirmaWebhook(r.cuerpo, r.firma, viejo)).toBe(true);
      }

      // 3. El receptor vuelve y se reenvía a mano: el mismo id, con el calendario completo otra vez.
      responder = 200;
      const reenvio = await admin('POST', `/v1/webhooks/${webhook.id}/entregas/${primera!.id}/reenviar`);
      expect(reenvio.status).toBe(202);
      expect((await reenvio.json()).entrega).toMatchObject({ id: primera!.id, estado: 'PENDIENTE', intentos: 0, ultimoCodigo: 503 });
      expect(await despachar()).toBe(1);
      expect((await entregas())[0]).toMatchObject({ id: primera!.id, estado: 'ENTREGADA', intentos: 1, ultimoCodigo: 200, ultimoError: null });
      expect(recibidas.at(-1)!.entrega).toBe(primera!.id);

      // 4. Rotación con 1 h de gracia: el secreto nuevo se muestra una vez y cada entrega lleva dos v1.
      const rot = await admin('POST', `/v1/webhooks/${webhook.id}/rotar-secreto`, { graciaHoras: 1 });
      expect(rot.status).toBe(200);
      const { secreto: nuevo, webhook: rotado } = (await rot.json()) as { secreto: string; webhook: { graciaHasta: string } };
      expect(nuevo).toMatch(/^whsec_/);
      expect(nuevo).not.toBe(viejo);
      expect(Date.parse(rotado.graciaHasta) - Date.now()).toBeGreaterThan(55 * 60_000);
      expect(Date.parse(rotado.graciaHasta) - Date.now()).toBeLessThan(65 * 60_000);
      const listado = (await (await admin('GET', '/v1/webhooks')).json()) as { webhooks: { id: string; graciaHasta: string | null }[] };
      expect(listado.webhooks.find((w) => w.id === webhook.id)!.graciaHasta).toBe(rotado.graciaHasta);
      expect(JSON.stringify(listado)).not.toContain('whsec_');

      const prueba = await admin('POST', `/v1/webhooks/${webhook.id}/probar`);
      expect(prueba.status).toBe(202);
      const { entrega: ePrueba } = (await prueba.json()) as { entrega: Entrega };
      expect(ePrueba).toMatchObject({ evento: 'webhook.prueba', estado: 'PENDIENTE', intentos: 0 });
      await despachar();
      const enGracia = recibidas.at(-1)!;
      expect(enGracia.entrega).toBe(ePrueba.id);
      expect(JSON.parse(enGracia.cuerpo)).toMatchObject({ id: ePrueba.id, evento: 'webhook.prueba', datos: { webhookId: webhook.id } });
      const firma = leerFirma(enGracia.firma)!;
      expect(firma.v1).toHaveLength(2);
      // Primero el v1 del secreto anterior y después el del nuevo.
      expect(verificarFirmaWebhook(enGracia.cuerpo, `t=${firma.t},v1=${firma.v1[0]}`, viejo)).toBe(true);
      expect(verificarFirmaWebhook(enGracia.cuerpo, `t=${firma.t},v1=${firma.v1[1]}`, nuevo)).toBe(true);
      expect(verificarFirmaWebhook(enGracia.cuerpo, enGracia.firma, viejo)).toBe(true);
      expect(verificarFirmaWebhook(enGracia.cuerpo, enGracia.firma, nuevo)).toBe(true);

      // 5. Termina la gracia: solo el secreto nuevo.
      await pool.query("UPDATE api_webhooks SET anterior_hasta = now() - interval '1 second' WHERE id = $1", [webhook.id]);
      await admin('POST', `/v1/webhooks/${webhook.id}/probar`);
      await despachar();
      const despues = recibidas.at(-1)!;
      expect(leerFirma(despues.firma)!.v1).toHaveLength(1);
      expect(verificarFirmaWebhook(despues.cuerpo, despues.firma, nuevo)).toBe(true);
      expect(verificarFirmaWebhook(despues.cuerpo, despues.firma, viejo)).toBe(false);
      const sinGracia = (await (await admin('GET', '/v1/webhooks')).json()) as { webhooks: { id: string; graciaHasta: string | null }[] };
      expect(sinGracia.webhooks.find((w) => w.id === webhook.id)!.graciaHasta).toBeNull();
      // El mantenimiento borra el secreto anterior vencido.
      await mantenimientoApi(pool, ROL);
      expect((await pool.query('SELECT secreto_anterior, anterior_hasta FROM api_webhooks WHERE id = $1', [webhook.id])).rows).toEqual([
        { secreto_anterior: null, anterior_hasta: null },
      ]);

      // La bitácora de la API registra cada acción, sin secretos.
      const bitacora = (await (await admin('GET', '/v1/bitacora?origen=api')).json()) as { eventos: { accion: string }[] };
      const acciones = bitacora.eventos.map((e) => e.accion);
      for (const a of ['webhook.entrega_reenviada', 'webhook.secreto_rotado', 'webhook.prueba']) expect(acciones).toContain(a);
      expect(JSON.stringify(bitacora)).not.toContain('whsec_');
    } finally {
      srv.close();
    }
  });
});

describe.skipIf(!URL_PG)('rutas de entregas, prueba y rotación: permisos, RLS y casos límite', () => {
  it('solo admin; otro tenant ve 404 (RLS); 404 de entrega inexistente', async () => {
    const a = await tenantListo();
    const b = await tenantListo();
    const alta = (t: typeof a) => t.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${t.tenant}`, eventos: ['documento.emitido'] });
    const { webhook } = (await (await alta(a)).json()) as { webhook: { id: string } };
    const { entrega } = (await (await a.admin('POST', `/v1/webhooks/${webhook.id}/probar`)).json()) as { entrega: Entrega };
    const rutas: [string, string][] = [
      ['GET', `/v1/webhooks/${webhook.id}/entregas`],
      ['POST', `/v1/webhooks/${webhook.id}/entregas/${entrega.id}/reenviar`],
      ['POST', `/v1/webhooks/${webhook.id}/probar`],
      ['POST', `/v1/webhooks/${webhook.id}/rotar-secreto`],
    ];
    const caja = cliente(a.app, await crearCaja(a.admin, '001'));
    for (const [m, ruta] of rutas) {
      const r = await caja(m, ruta);
      expect(r.status, ruta).toBe(403);
      expect((await r.json()).error.codigo).toBe('SOLO_ADMIN');
      const otro = await b.admin(m, ruta);
      expect(otro.status, ruta).toBe(404);
      expect((await otro.json()).error.codigo).toBe('NO_ENCONTRADO');
    }
    // El tenant b tampoco alcanza la entrega de a desde un webhook propio.
    const { webhook: deB } = (await (await alta(b)).json()) as { webhook: { id: string } };
    expect((await b.admin('POST', `/v1/webhooks/${deB.id}/entregas/${entrega.id}/reenviar`)).status).toBe(404);
    expect((await a.admin('POST', `/v1/webhooks/${webhook.id}/entregas/${randomUUID()}/reenviar`)).status).toBe(404);
    // Nada cambió en a.
    const r = (await (await a.admin('GET', `/v1/webhooks/${webhook.id}/entregas`)).json()) as { entregas: Entrega[] };
    expect(r.entregas.map((e) => [e.id, e.estado, e.intentos])).toEqual([[entrega.id, 'PENDIENTE', 0]]);
  });

  it('paginación de las entregas (más reciente primero), filtro por estado y cursor inválido', async () => {
    const { admin, tenant, pool } = await tenantListo();
    const { webhook } = (await (await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } };
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(((await (await admin('POST', `/v1/webhooks/${webhook.id}/probar`)).json()) as { entrega: Entrega }).entrega.id);
    // Dos con el mismo instante: el cursor desempata por id.
    await pool.query('UPDATE api_entregas SET creada = (SELECT creada FROM api_entregas WHERE entrega = $2) WHERE entrega = $1', [ids[3], ids[2]]);
    const vistas: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const ruta: string = `/v1/webhooks/${webhook.id}/entregas?limite=2${cursor ? `&cursor=${cursor}` : ''}`;
      const r = (await (await admin('GET', ruta)).json()) as { entregas: Entrega[]; hayMas: boolean; siguiente: string | null };
      vistas.push(...r.entregas.map((e) => e.id));
      cursor = r.siguiente;
      expect(r.hayMas).toBe(cursor !== null);
      paginas++;
    } while (cursor);
    expect(paginas).toBe(3);
    expect(vistas).toHaveLength(5);
    expect(new Set(vistas)).toEqual(new Set(ids));
    expect(vistas[0]).toBe(ids[4]);
    expect(vistas.at(-1)).toBe(ids[0]);

    await pool.query("UPDATE api_entregas SET estado = 'FALLIDA' WHERE entrega = $1", [ids[1]]);
    const fallidas = (await (await admin('GET', `/v1/webhooks/${webhook.id}/entregas?estado=FALLIDA`)).json()) as { entregas: Entrega[] };
    expect(fallidas.entregas.map((e) => e.id)).toEqual([ids[1]]);
    const malo = await admin('GET', `/v1/webhooks/${webhook.id}/entregas?cursor=${Buffer.from('"x"').toString('base64url')}`);
    expect(malo.status).toBe(400);
    expect((await malo.json()).error.codigo).toBe('CURSOR_INVALIDO');
  });

  it('reenviar: una PENDIENTE se adelanta y conserva sus intentos; ENTREGA_VENCIDA sin cuerpo; WEBHOOK_INACTIVO', async () => {
    const { admin, tenant, pool } = await tenantListo();
    const { webhook } = (await (await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } };
    const { entrega } = (await (await admin('POST', `/v1/webhooks/${webhook.id}/probar`)).json()) as { entrega: Entrega };
    await pool.query("UPDATE api_entregas SET intentos = 4, proximo = now() + interval '5 hours' WHERE entrega = $1", [entrega.id]);
    const r = await admin('POST', `/v1/webhooks/${webhook.id}/entregas/${entrega.id}/reenviar`);
    expect(r.status).toBe(202);
    const adelantada = (await r.json()).entrega as Entrega;
    expect(adelantada).toMatchObject({ estado: 'PENDIENTE', intentos: 4 });
    expect(Date.parse(adelantada.proximoIntento!)).toBeLessThanOrEqual(Date.now() + 1000);

    // Una lápida de retención (cuerpo vacío) no se puede reenviar.
    await pool.query("UPDATE api_entregas SET estado = 'ENTREGADA', cuerpo = '{}'::jsonb WHERE entrega = $1", [entrega.id]);
    const vencida = await admin('POST', `/v1/webhooks/${webhook.id}/entregas/${entrega.id}/reenviar`);
    expect(vencida.status).toBe(409);
    expect((await vencida.json()).error.codigo).toBe('ENTREGA_VENCIDA');

    // Con el webhook desactivado: no se reenvía, no se prueba ni se rota; listar sí.
    expect((await admin('DELETE', `/v1/webhooks/${webhook.id}`)).status).toBe(200);
    for (const ruta of [`/v1/webhooks/${webhook.id}/entregas/${entrega.id}/reenviar`, `/v1/webhooks/${webhook.id}/probar`, `/v1/webhooks/${webhook.id}/rotar-secreto`]) {
      const x = await admin('POST', ruta);
      expect(x.status, ruta).toBe(409);
      expect((await x.json()).error.codigo).toBe('WEBHOOK_INACTIVO');
    }
    expect((await admin('GET', `/v1/webhooks/${webhook.id}/entregas`)).status).toBe(200);
  });

  it('rotar: 24 h de gracia sin cuerpo; 0 h sin gracia; fuera de rango es 400; el secreto queda cifrado en reposo', async () => {
    const cofre = new CofreSecretos(Buffer.alloc(32, 9).toString('base64'));
    const { admin, tenant, pool } = await tenantListo({ cofre });
    const alta = await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] });
    const { webhook, secreto: s0 } = (await alta.json()) as { webhook: { id: string }; secreto: string };
    const sinCuerpo = await admin('POST', `/v1/webhooks/${webhook.id}/rotar-secreto`);
    expect(sinCuerpo.status).toBe(200);
    const r1 = (await sinCuerpo.json()) as { secreto: string; webhook: { graciaHasta: string } };
    expect(Math.abs(Date.parse(r1.webhook.graciaHasta) - Date.now() - 24 * 3600_000)).toBeLessThan(60_000);
    const fila = (await pool.query('SELECT secreto, secreto_anterior FROM api_webhooks WHERE id = $1', [webhook.id])).rows[0];
    expect(fila.secreto.startsWith('gcm:')).toBe(true);
    expect(cofre.leer(fila.secreto)).toBe(r1.secreto);
    expect(cofre.leer(fila.secreto_anterior)).toBe(s0);

    const r2 = (await (await admin('POST', `/v1/webhooks/${webhook.id}/rotar-secreto`, { graciaHoras: 0 })).json()) as { webhook: { graciaHasta: string | null } };
    expect(r2.webhook.graciaHasta).toBeNull();
    expect((await pool.query('SELECT secreto_anterior, anterior_hasta FROM api_webhooks WHERE id = $1', [webhook.id])).rows).toEqual([
      { secreto_anterior: null, anterior_hasta: null },
    ]);
    for (const graciaHoras of [-1, 169, 1.5]) {
      const x = await admin('POST', `/v1/webhooks/${webhook.id}/rotar-secreto`, { graciaHoras });
      expect(x.status, String(graciaHoras)).toBe(400);
    }
  });

  it('migración v8: una base sin las columnas de la rotación no arranca hasta migrar', async () => {
    const p = await poolPrueba();
    const esquema = `prueba_v8_${randomUUID().slice(0, 8)}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      await exigirEsquemaApi(propio, ROL);
      // Como quedó una base en v7: sin las columnas ni la marca de v8.
      await propio.query('ALTER TABLE api_webhooks DROP COLUMN secreto_anterior, DROP COLUMN anterior_hasta');
      await propio.query('DELETE FROM fhn_migraciones WHERE clave = $1', [`api-v${VERSION_ESQUEMA_API}-${ROL}`]);
      await expect(exigirEsquemaApi(propio, ROL)).rejects.toThrow(/api_webhooks\.anterior_hasta/);
      await migrarApi(propio, ROL);
      await exigirEsquemaApi(propio, ROL);
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });
});

describe.skipIf(!URL_PG)('revisión: rotación doble, tope de pruebas y cursores falsos', () => {
  const correr = (pool: import('pg').Pool, tenant: string, fetchFalso: typeof fetch) =>
    despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant], fetch: fetchFalso, reintentos: { espera: () => -1000 } });

  it('rotar dos veces durante la gracia conserva el secreto más viejo hasta que la gracia termina', async () => {
    const { admin, tenant, pool } = await tenantListo();
    const alta = await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] });
    const { webhook, secreto: s0 } = (await alta.json()) as { webhook: { id: string }; secreto: string };
    const rotar = async (graciaHoras?: number) =>
      (await (await admin('POST', `/v1/webhooks/${webhook.id}/rotar-secreto`, graciaHoras === undefined ? undefined : { graciaHoras })).json()) as {
        secreto: string; webhook: { graciaHasta: string | null };
      };
    const r1 = await rotar(2);
    // Un reintento o un doble clic: la segunda rotación no tira s0. La gracia dura hasta la más tardía.
    const r2 = await rotar(1);
    expect(r2.webhook.graciaHasta).toBe(r1.webhook.graciaHasta);
    const firmas: { cuerpo: string; firma: string }[] = [];
    const fetchFalso = (async (_u: string, init: RequestInit) => {
      firmas.push({ cuerpo: String(init.body), firma: new Headers(init.headers).get('x-facturahn-firma')! });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await admin('POST', `/v1/webhooks/${webhook.id}/probar`);
    await correr(pool, tenant, fetchFalso);
    const f = firmas.at(-1)!;
    expect(leerFirma(f.firma)!.v1).toHaveLength(2);
    expect(verificarFirmaWebhook(f.cuerpo, f.firma, s0)).toBe(true);
    expect(verificarFirmaWebhook(f.cuerpo, f.firma, r2.secreto)).toBe(true);
    // El intermedio se descarta.
    expect(verificarFirmaWebhook(f.cuerpo, f.firma, r1.secreto)).toBe(false);
    // Una tercera rotación con más gracia la alarga, y s0 sigue valiendo.
    const r3 = await rotar(5);
    expect(Date.parse(r3.webhook.graciaHasta!)).toBeGreaterThan(Date.parse(r1.webhook.graciaHasta!));
    await admin('POST', `/v1/webhooks/${webhook.id}/probar`);
    await correr(pool, tenant, fetchFalso);
    expect(verificarFirmaWebhook(firmas.at(-1)!.cuerpo, firmas.at(-1)!.firma, s0)).toBe(true);
    // Al terminar la gracia, s0 deja de valer; la rotación siguiente toma el secreto actual como anterior.
    await pool.query("UPDATE api_webhooks SET anterior_hasta = now() - interval '1 second' WHERE id = $1", [webhook.id]);
    const r4 = await rotar(1);
    await admin('POST', `/v1/webhooks/${webhook.id}/probar`);
    await correr(pool, tenant, fetchFalso);
    const g = firmas.at(-1)!;
    expect(verificarFirmaWebhook(g.cuerpo, g.firma, s0)).toBe(false);
    expect(verificarFirmaWebhook(g.cuerpo, g.firma, r3.secreto)).toBe(true);
    expect(verificarFirmaWebhook(g.cuerpo, g.firma, r4.secreto)).toBe(true);
    // Con graciaHoras 0 en plena gracia, la gracia termina en el acto.
    expect((await rotar(0)).webhook.graciaHasta).toBeNull();
  });

  it(`a lo sumo ${MAX_PRUEBAS_PENDIENTES} pruebas pendientes por webhook, y cada prueba se intenta ${MAX_INTENTOS_PRUEBA} veces`, async () => {
    const { admin, tenant, pool } = await tenantListo();
    const { webhook } = (await (await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } };
    const probar = () => admin('POST', `/v1/webhooks/${webhook.id}/probar`);
    for (let i = 0; i < MAX_PRUEBAS_PENDIENTES; i++) expect((await probar()).status).toBe(202);
    const sobra = await probar();
    expect(sobra.status).toBe(409);
    expect((await sobra.json()).error.codigo).toBe('LIMITE_PRUEBAS');
    expect(MAX_INTENTOS_PRUEBA).toBe(3);

    // Un aviso real y las pruebas fallan juntos: las pruebas quedan FALLIDA a los 3 intentos; el aviso sigue.
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    const falla = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    for (let i = 0; i < MAX_INTENTOS_PRUEBA; i++) await correr(pool, tenant, falla);
    const filas = (await pool.query('SELECT evento, estado, intentos FROM api_entregas WHERE tenant = $1 ORDER BY id', [tenant])).rows;
    expect(filas.filter((f) => f.evento === 'webhook.prueba')).toEqual(
      Array(MAX_PRUEBAS_PENDIENTES).fill({ evento: 'webhook.prueba', estado: 'FALLIDA', intentos: MAX_INTENTOS_PRUEBA }),
    );
    expect(filas.find((f) => f.evento === 'documento.emitido')).toEqual({ evento: 'documento.emitido', estado: 'PENDIENTE', intentos: MAX_INTENTOS_PRUEBA });

    // Con las pruebas terminadas hay cupo otra vez; reenviar una prueba también respeta el tope.
    const ids = ((await (await admin('GET', `/v1/webhooks/${webhook.id}/entregas?estado=FALLIDA`)).json()) as { entregas: Entrega[] }).entregas.map((e) => e.id);
    for (let i = 0; i < MAX_PRUEBAS_PENDIENTES - 1; i++) expect((await probar()).status).toBe(202);
    expect((await admin('POST', `/v1/webhooks/${webhook.id}/entregas/${ids[0]}/reenviar`)).status).toBe(202);
    const reenvio = await admin('POST', `/v1/webhooks/${webhook.id}/entregas/${ids[1]}/reenviar`);
    expect(reenvio.status).toBe(409);
    expect((await reenvio.json()).error.codigo).toBe('LIMITE_PRUEBAS');
  });

  it('un cursor armado a mano da 400 CURSOR_INVALIDO, no 500 (entregas y bitácora)', async () => {
    const { admin, tenant } = await tenantListo();
    const { webhook } = (await (await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } };
    const cursor = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const uuid = randomUUID();
    for (const v of [
      ['99999999999999999999', uuid], // más de 19 dígitos
      ['9223372036854775807', uuid], // cabe en bigint pero desborda timestamptz
      ['999999999999999999', uuid],
      ['-1', uuid],
      ['1700000000000000', '------------------------------------'],
      ['1700000000000000', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'],
      ['1700000000000000', uuid.toUpperCase()],
    ]) {
      const r = await admin('GET', `/v1/webhooks/${webhook.id}/entregas?cursor=${cursor(v)}`);
      expect(r.status, JSON.stringify(v)).toBe(400);
      expect((await r.json()).error.codigo).toBe('CURSOR_INVALIDO');
    }
    expect((await admin('GET', `/v1/webhooks/${webhook.id}/entregas?cursor=${cursor(['1700000000000000', uuid])}`)).status).toBe(200);
    for (const v of ['9999999999999999999', '9223372036854775808']) {
      const r = await admin('GET', `/v1/bitacora?origen=api&cursor=${cursor(v)}`);
      expect(r.status, v).toBe(400);
      expect((await r.json()).error.codigo).toBe('CURSOR_INVALIDO');
    }
    expect((await admin('GET', `/v1/bitacora?origen=api&cursor=${cursor('9223372036854775807')}`)).status).toBe(200);
  });
});

describe.skipIf(!URL_PG)('un secreto que no se descifra', () => {
  it('falla solo su entrega (FALLIDA con el motivo) y no frena ni reenvía las demás del lote', async () => {
    const { admin, tenant, pool } = await tenantListo();
    const alta = async (n: string) =>
      ((await (await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/${n}-${tenant}`, eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } }).webhook.id;
    const malo = await alta('malo');
    const bueno = await alta('bueno');
    // Cifrado con otra FHN_CLAVE_CIFRADO que la del proceso que despacha.
    const otra = new CofreSecretos(Buffer.alloc(32, 3).toString('base64'));
    await pool.query('UPDATE api_webhooks SET secreto = $2 WHERE id = $1', [malo, otra.guardar('whsec_otro')]);
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);

    const enviadas: string[] = [];
    const correr = () =>
      despacharWebhooks({
        pool, rol: ROL, cofre: new CofreSecretos(Buffer.alloc(32, 9).toString('base64')), permitirRedInterna: true, soloTenants: [tenant],
        reintentos: { espera: () => -1000 },
        fetch: (async (url: string) => {
          enviadas.push(String(url));
          return new Response(null, { status: 200 });
        }) as unknown as typeof fetch,
      });
    await correr();
    const estado = async () =>
      (await pool.query('SELECT webhook_id::text AS webhook, estado, intentos, ultimo_error FROM api_entregas WHERE tenant = $1 ORDER BY id', [tenant])).rows;
    expect((await estado()).sort((a, b) => (a.webhook === malo ? -1 : b.webhook === malo ? 1 : 0))).toEqual([
      { webhook: malo, estado: 'FALLIDA', intentos: 1, ultimo_error: ERROR_SECRETO_ILEGIBLE },
      { webhook: bueno, estado: 'ENTREGADA', intentos: 1, ultimo_error: null },
    ]);
    expect(enviadas).toEqual([`http://127.0.0.1:9/bueno-${tenant}`]);
    // Otra pasada, aun con el arriendo vencido: nada se vuelve a enviar.
    await pool.query("UPDATE api_entregas SET proximo = now() - interval '1 minute' WHERE tenant = $1", [tenant]);
    await correr();
    expect(enviadas).toHaveLength(1);
  });
});

describe.skipIf(!URL_PG)('webhooks de un tenant inactivo', () => {
  it('no se despachan mientras el tenant está inactivo; siguen PENDIENTE y salen al reactivarlo', async () => {
    const { admin, tenant, pool } = await tenantListo();
    await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/inactivo-${tenant}`, eventos: ['documento.emitido'] });
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    // El pool de prueba es superusuario: salta la RLS forzada de api_tenants.
    await pool.query('UPDATE api_tenants SET activo = false WHERE tenant = $1', [tenant]);
    const enviadas: string[] = [];
    const correr = () =>
      despacharWebhooks({
        pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant],
        fetch: (async (url: string) => {
          enviadas.push(String(url));
          return new Response(null, { status: 200 });
        }) as unknown as typeof fetch,
      });
    // soloTenants solo filtra la lista que da fhn_api_tenants_con_pendientes(), que ya no lo incluye.
    await correr();
    expect(enviadas.filter((u) => u.endsWith(tenant))).toEqual([]);
    expect((await pool.query('SELECT estado, intentos FROM api_entregas WHERE tenant = $1', [tenant])).rows).toEqual([{ estado: 'PENDIENTE', intentos: 0 }]);
    // La función no deja fijado el tenant en la transacción de quien llama.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${ROL}`);
      await c.query("SELECT set_config('factura_hn.tenant', 'otro', true)");
      await c.query('SELECT fhn_api_tenants_con_pendientes()');
      expect((await c.query("SELECT current_setting('factura_hn.tenant', true) AS t")).rows[0].t).toBe('otro');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    await pool.query('UPDATE api_tenants SET activo = true WHERE tenant = $1', [tenant]);
    await correr();
    expect(enviadas.filter((u) => u.endsWith(tenant))).toHaveLength(1);
  });

  it('migración v9: sin la marca de fhn_api_tenants_con_pendientes() la base no arranca hasta migrar', async () => {
    const p = await poolPrueba();
    const esquema = `prueba_v9_${randomUUID().slice(0, 8)}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      expect((await propio.query("SELECT obj_description('fhn_api_tenants_con_pendientes()'::regprocedure, 'pg_proc') AS d")).rows[0].d).toBe(MARCA_PENDIENTES_V9);
      // Como quedó una base en v8: la función sin la marca.
      await propio.query('COMMENT ON FUNCTION fhn_api_tenants_con_pendientes() IS NULL');
      await propio.query('DELETE FROM fhn_migraciones WHERE clave = $1', [`api-v${VERSION_ESQUEMA_API}-${ROL}`]);
      await expect(exigirEsquemaApi(propio, ROL)).rejects.toThrow(/v9 de fhn_api_tenants_con_pendientes/);
      await migrarApi(propio, ROL);
      await exigirEsquemaApi(propio, ROL);
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });
});
