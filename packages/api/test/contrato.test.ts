/**
 * El contrato HTTP de la API: `operationId` en cada operación, estados de error que dicen lo que el código hace,
 * `Solicitud-Id` y `FacturaHN-Version` en todas las respuestas, cabeceras `RateLimit` y `Retry-After` en
 * `LIMITE_MENSUAL`. Lo que no necesita la base corre siempre; lo demás, con FHN_PG_URL.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { HTTPException } from 'hono/http-exception';
import { afterAll, describe, expect, it } from 'vitest';
import { fechaHonduras } from 'factura-hn';
import { crearApp, segundosHastaElMesSiguiente, VERSION_API } from '../src/app';
import { cerrarPool, cliente, crearCaja, ROL, tenantListo, URL_PG, venta } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

type Operacion = { operationId?: string; requestBody?: unknown; responses: Record<string, { headers?: Record<string, unknown> }> };
const METODOS = ['get', 'put', 'post', 'delete', 'patch'] as const;

async function especificacion() {
  const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });
  const doc = (await (await app.request('/openapi.json')).json()) as { paths: Record<string, Partial<Record<(typeof METODOS)[number], Operacion>>> };
  return Object.entries(doc.paths).flatMap(([ruta, item]) =>
    METODOS.flatMap((m) => (item[m] ? [{ ruta, metodo: m, nombre: `${m.toUpperCase()} ${ruta}`, op: item[m]! }] : [])),
  );
}

/**
 * Verbos de los `operationId` (verbo + recurso, en español). Una operación nueva con otro verbo lo agrega aquí,
 * a propósito.
 */
const VERBOS = ['obtener', 'listar', 'crear', 'actualizar', 'registrar', 'emitir', 'anular', 'corregir', 'exportar', 'revocar', 'desactivar', 'reactivar', 'reenviar', 'probar', 'rotar', 'eliminar'];

describe('OpenAPI: operationId', () => {
  it('toda operación tiene un operationId en camelCase, en español (verbo + recurso) y sin repetirse', async () => {
    const ops = await especificacion();
    expect(ops.length).toBeGreaterThanOrEqual(24);
    const sinId = ops.filter((o) => !o.op.operationId).map((o) => o.nombre);
    expect(sinId, 'operaciones sin operationId').toEqual([]);
    const mal = ops.filter((o) => !/^[a-z]+(?:[A-Z][a-z]+)+$/.test(o.op.operationId!) || !VERBOS.some((v) => o.op.operationId!.startsWith(v) && /^[A-Z]/.test(o.op.operationId!.slice(v.length))));
    expect(mal.map((o) => `${o.nombre}: ${o.op.operationId}`), 'operationId que no son verbo + recurso en camelCase').toEqual([]);
    const vistos = new Map<string, string>();
    const repetidos: string[] = [];
    for (const o of ops) {
      const previo = vistos.get(o.op.operationId!);
      if (previo) repetidos.push(`${o.op.operationId}: ${previo} y ${o.nombre}`);
      vistos.set(o.op.operationId!, o.nombre);
    }
    expect(repetidos, 'operationId repetidos').toEqual([]);
  });

  it('los ids de las operaciones existentes no cambian (los clientes generados dependen de ellos)', async () => {
    const ids = Object.fromEntries((await especificacion()).map((o) => [o.nombre, o.op.operationId]));
    expect(ids).toMatchObject({
      'GET /salud': 'obtenerSalud',
      'POST /v1/emisores': 'crearEmisor',
      'GET /v1/emisores': 'listarEmisores',
      'GET /v1/emisores/{id}': 'obtenerEmisor',
      'PATCH /v1/emisores/{id}': 'actualizarEmisor',
      'POST /v1/autorizaciones': 'registrarAutorizacion',
      'GET /v1/autorizaciones': 'listarAutorizaciones',
      'GET /v1/autorizaciones/{cai}/estado': 'obtenerEstadoAutorizacion',
      'GET /v1/sesion': 'obtenerSesion',
      'POST /v1/documentos': 'emitirDocumento',
      'GET /v1/documentos': 'listarDocumentos',
      'GET /v1/documentos/{archivo}': 'obtenerDocumento',
      'POST /v1/documentos/{numero}/anular': 'anularDocumento',
      'POST /v1/series/{identificador}/corregir-fecha': 'corregirFechaSerie',
      'GET /v1/series/{identificador}/no-utilizados': 'listarNoUtilizados',
      'GET /v1/libro-ventas': 'obtenerLibroVentas',
      'GET /v1/exportacion': 'exportarPeriodo',
      'GET /v1/bitacora': 'listarBitacora',
      'POST /v1/llaves': 'crearLlave',
      'GET /v1/llaves': 'listarLlaves',
      'DELETE /v1/llaves/{prefijo}': 'revocarLlave',
      'POST /v1/webhooks': 'crearWebhook',
      'GET /v1/webhooks': 'listarWebhooks',
      'DELETE /v1/webhooks/{id}': 'desactivarWebhook',
    });
  });
});

describe('OpenAPI: estados de error', () => {
  it('ningún GET declara 422, salvo los reportes con tope de documentos', async () => {
    const con422 = (await especificacion()).filter((o) => o.metodo === 'get' && o.op.responses['422']).map((o) => o.nombre);
    expect(con422.sort()).toEqual(['GET /v1/exportacion', 'GET /v1/libro-ventas']);
  });

  it('toda operación de /v1 declara 401, 429 y 500; el 413, toda operación que no es GET', async () => {
    for (const o of await especificacion()) {
      const estados = Object.keys(o.op.responses);
      expect(estados, o.nombre).toContain('500');
      if (o.ruta.startsWith('/v1/')) expect(estados, o.nombre).toEqual(expect.arrayContaining(['401', '429']));
      // bodyLimit cubre todo /v1/*: una operación sin cuerpo esperado (DELETE, POST sin cuerpo) también puede dar 413.
      expect(estados.includes('413'), o.nombre).toBe(o.metodo !== 'get');
    }
  });

  it('cada respuesta declara Solicitud-Id y FacturaHN-Version; las de /v1, RateLimit salvo 401 y 413; los 429, Retry-After', async () => {
    for (const o of await especificacion()) {
      for (const [estado, r] of Object.entries(o.op.responses)) {
        const cabeceras = Object.keys(r.headers ?? {});
        expect(cabeceras, `${o.nombre} ${estado}`).toEqual(expect.arrayContaining(['Solicitud-Id', 'FacturaHN-Version']));
        const conLimite = o.ruta.startsWith('/v1/') && estado !== '401' && estado !== '413';
        expect(cabeceras.includes('RateLimit-Policy') && cabeceras.includes('RateLimit'), `${o.nombre} ${estado}`).toBe(conLimite);
        // La llave aún no se validó: un 401 nunca declara RateLimit.
        if (estado === '401') expect(cabeceras.filter((n) => n.startsWith('RateLimit')), `${o.nombre} 401`).toEqual([]);
        expect(cabeceras.includes('Retry-After'), `${o.nombre} ${estado}`).toBe(estado === '429');
      }
    }
  });
});

describe('Solicitud-Id y FacturaHN-Version (sin base)', () => {
  const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });

  it('en todas las respuestas, también en /docs, /openapi.json y una ruta inexistente', async () => {
    for (const ruta of ['/docs', '/openapi.json', '/no-existe']) {
      const r = await app.request(ruta);
      expect(r.headers.get('facturahn-version'), ruta).toBe(VERSION_API);
      expect(r.headers.get('solicitud-id'), ruta).toMatch(/^[0-9a-f-]{36}$/);
    }
    const r = await app.request('/no-existe');
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: { solicitud: string } }).error.solicitud).toBe(r.headers.get('solicitud-id'));
  });

  it('respeta la del cliente si es válida; si no, genera una nueva', async () => {
    const propia = `pos-caja1:${randomUUID()}`;
    const r = await app.request('/v1/sesion', { headers: { 'solicitud-id': propia } });
    expect(r.status).toBe(401);
    expect(r.headers.get('solicitud-id')).toBe(propia);
    const cuerpo = (await r.json()) as { error: { codigo: string; solicitud: string } };
    expect(cuerpo.error).toMatchObject({ codigo: 'NO_AUTENTICADO', solicitud: propia });

    for (const mala of ['con espacios', '-empieza-con-guion', 'x'.repeat(129), 'acento-é', 'a\tb']) {
      const otra = await app.request('/v1/sesion', { headers: { 'solicitud-id': mala } });
      expect(otra.headers.get('solicitud-id'), mala).toMatch(/^[0-9a-f-]{36}$/);
    }
    // 128 caracteres todavía valen.
    const larga = 'a'.repeat(128);
    expect((await app.request('/v1/sesion', { headers: { 'solicitud-id': larga } })).headers.get('solicitud-id')).toBe(larga);
  });

  it('dos solicitudes sin cabecera tienen ids distintos', async () => {
    const a = (await app.request('/no-existe')).headers.get('solicitud-id');
    const b = (await app.request('/no-existe')).headers.get('solicitud-id');
    expect(a).not.toBe(b);
  });

  it('un 500 trae el id en el cuerpo y en el log, sin detalles internos', async () => {
    const log: string[] = [];
    const roto = crearApp({
      pool: { query: async () => { throw new Error('conexión rechazada: secreto-interno'); } } as unknown as pg.Pool,
      modo: 'local',
      registrar: (m) => log.push(m),
    });
    const r = await roto.request('/salud', { headers: { 'solicitud-id': 'caso-500' } });
    expect(r.status).toBe(500);
    expect(r.headers.get('solicitud-id')).toBe('caso-500');
    const texto = await r.text();
    expect(texto).not.toContain('secreto-interno');
    expect(JSON.parse(texto)).toEqual({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno. Se registró para revisión.', solicitud: 'caso-500' } });
    // El log lleva un id del servidor y, aparte, el del cliente; el cuerpo y la cabecera repiten el del cliente.
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^Error interno \(solicitud [0-9a-f-]{36} \(cliente caso-500\)\)$/);
    const sinPropio = await roto.request('/salud');
    expect(log[1]).toBe(`Error interno (solicitud ${sinPropio.headers.get('solicitud-id')})`);
  });
});

describe('JSON_INVALIDO', () => {
  it('solo convierte el 400 de JSON mal formado; otro HTTPException(400) sigue con su respuesta', async () => {
    const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });
    app.get('/prueba-otro-400', () => {
      throw new HTTPException(400, { message: 'otro problema' });
    });
    const r = await app.request('/prueba-otro-400');
    expect(r.status).toBe(400);
    expect(await r.text()).toBe('otro problema');
  });
});

describe('segundosHastaElMesSiguiente', () => {
  it('cuenta hasta el día 1 del mes siguiente a las 00:00 de Honduras (06:00 UTC)', () => {
    expect(segundosHastaElMesSiguiente('2026-11', new Date('2026-11-30T12:00:00Z'))).toBe(18 * 3600);
    // 23:59:59 del 30 de noviembre en Honduras: falta un segundo.
    expect(segundosHastaElMesSiguiente('2026-11', new Date('2026-12-01T05:59:59Z'))).toBe(1);
    // Diciembre pasa a enero del año siguiente.
    expect(segundosHastaElMesSiguiente('2026-12', new Date('2026-12-31T06:00:00Z'))).toBe(24 * 3600);
    // Nunca menos de 1 segundo.
    expect(segundosHastaElMesSiguiente('2026-11', new Date('2026-12-01T07:00:00Z'))).toBe(1);
  });
});

conBase('contrato con la base', () => {
  const json = async (r: Response) => (await r.json()) as Record<string, any>;

  it('RateLimit-Policy y RateLimit en las respuestas autenticadas y en el 429 de la llave', async () => {
    const { pool, llaveAdmin } = await tenantListo();
    // Una app nueva: la cubeta de la llave empieza llena.
    const admin = cliente(crearApp({ pool, modo: 'local', rol: ROL, limiteSolicitudes: { porSegundo: 1, rafaga: 3 } }), llaveAdmin);
    const r1 = await admin('GET', '/v1/sesion');
    expect(r1.status).toBe(200);
    expect(r1.headers.get('ratelimit-policy')).toBe('"llave";q=3;w=3');
    expect(r1.headers.get('ratelimit')).toBe('"llave";r=2;t=1');
    await admin('GET', '/v1/sesion');
    await admin('GET', '/v1/sesion');
    const r4 = await admin('GET', '/v1/sesion');
    expect(r4.status).toBe(429);
    expect(r4.headers.get('retry-after')).toBe('1');
    expect(r4.headers.get('ratelimit')).toMatch(/^"llave";r=0;t=3$/);
    expect((await json(r4)).error).toMatchObject({ codigo: 'DEMASIADAS_SOLICITUDES', solicitud: r4.headers.get('solicitud-id') });
  });

  it('sin llave válida no hay cabeceras RateLimit, tampoco con una llave ya usada y revocada', async () => {
    const { app, admin } = await tenantListo();
    const caja = await crearCaja(admin, '001');
    expect((await cliente(app, caja)('GET', '/v1/sesion')).headers.get('ratelimit')).not.toBeNull();
    expect((await admin('DELETE', `/v1/llaves/${/^fhn_(?:live_|test_)?([0-9a-f]+)_/.exec(caja)![1]}`)).status).toBe(200);
    for (const llave of ['fhn_000000000000_secretoequivocado', caja]) {
      const r = await cliente(app, llave)('GET', '/v1/sesion');
      expect(r.status).toBe(401);
      expect(r.headers.get('ratelimit')).toBeNull();
      expect(r.headers.get('ratelimit-policy')).toBeNull();
    }
  });

  it('LIMITE_MENSUAL trae Retry-After hasta el primer día del mes siguiente en Honduras', async () => {
    const ahora = new Date();
    const { admin } = await tenantListo({ reloj: () => ahora }, { limiteMensual: 1 });
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    const r = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    expect(r.status).toBe(429);
    expect((await json(r)).error.codigo).toBe('LIMITE_MENSUAL');
    expect(r.headers.get('retry-after')).toBe(String(segundosHastaElMesSiguiente(fechaHonduras(ahora).slice(0, 7), ahora)));
  });

  it('Solicitud-Id en una emisión y en su 422; un cuerpo que no es JSON es 400 JSON_INVALIDO con la forma de error', async () => {
    const { app, admin, llaveAdmin } = await tenantListo();
    const ok = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID(), 'solicitud-id': 'venta-123' });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('solicitud-id')).toBe('venta-123');
    expect(ok.headers.get('facturahn-version')).toBe(VERSION_API);

    const fiscal = await admin('POST', '/v1/documentos', venta('-1.00'), { 'idempotency-key': randomUUID() });
    expect(fiscal.status).toBe(422);
    expect((await json(fiscal)).error.solicitud).toBe(fiscal.headers.get('solicitud-id'));

    const roto = await app.request('/v1/emisores', {
      method: 'POST',
      headers: { authorization: `Bearer ${llaveAdmin}`, 'content-type': 'application/json' },
      body: '{"rtn": "99990000000001",',
    });
    expect(roto.status).toBe(400);
    expect(roto.headers.get('content-type')).toContain('application/json');
    expect((await json(roto)).error).toMatchObject({ codigo: 'JSON_INVALIDO', solicitud: roto.headers.get('solicitud-id') });
  });
});
