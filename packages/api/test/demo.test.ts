/**
 * Modo demo (`FHN_MODO=demo`): entornos de prueba por visitante con `POST /v1/demo/entornos`, aislados entre sí,
 * que vencen y se borran; límites con 429 y `Retry-After`; interruptor global; CAI real imposible; CORS. Requiere
 * FHN_PG_URL. Las pruebas usan un reloj inyectado lejos en el futuro: así no cuentan los entornos de otras pruebas.
 */
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { configDemo, leerConfigDemo, type ConfigDemo } from '../src/demo';
import { ejecutarConsola } from '../src/consola';
import { generarTokenMcp, llaveDeTokenMcp, leerLlave } from '../src/llaves';
import { datosRealesEnBase, pausarDemo, purgarEntornosDemo, resumenDemo } from '../src/operador';
import { arrancar } from '../src/servidor';
import { migrarApi } from '../src/esquema';
import { caiAleatorio, cerrarPool, cliente, poolPrueba, ROL, URL_PG } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as any;
const HORA = 3_600_000;

/** Un año distinto por app: los cupos globales solo ven los entornos de su propio año. */
let anio = 2200 + Math.floor(Math.random() * 7000);
function appDemo(cambios: Partial<ConfigDemo> = {}, o: { reloj?: { t: number } } = {}) {
  const reloj = o.reloj ?? { t: Date.UTC(anio++, 0, 15, 15) };
  return poolPrueba().then((pool) => {
    const demo = configDemo({ maxEntornos: 1000, entornosPorIp: 100, creacionesPorMinuto: 1000, urlMcp: 'https://mcp.ejemplo.example/mcp', urlApi: 'https://api.ejemplo.example', ...cambios });
    const app = crearApp({ pool, modo: 'demo', rol: ROL, demo, reloj: () => new Date(reloj.t), registrar: () => undefined });
    return { app, reloj, pool, demo };
  });
}
const crear = (app: ReturnType<typeof crearApp>, ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`, cabeceras: Record<string, string> = {}) =>
  cliente(app, null, { ip })('POST', '/v1/demo/entornos', undefined, cabeceras);
const venta = (descripcion = 'Café molido') => ({
  establecimiento: '000', puntoEmision: '001',
  documento: { tipoDocumento: '01', lineas: [{ descripcion, cantidad: 1, precioUnitario: '57.50' }] },
});
const emitir = (llave: string, app: ReturnType<typeof crearApp>, cuerpo: unknown = venta()) =>
  cliente(app, llave)('POST', '/v1/documentos', cuerpo, { 'idempotency-key': `d-${randomBytes(8).toString('hex')}` });

describe('token del MCP remoto', () => {
  it('deriva siempre la misma llave fhn_test_ con su prefijo, distinta del token; un token mal formado no da llave', () => {
    const t = generarTokenMcp('prueba');
    expect(t.token).toMatch(/^fhnmcp_test_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(llaveDeTokenMcp(t.token)).toBe(t.llave);
    expect(leerLlave(t.llave)).toEqual({ prefijo: t.prefijo, modo: 'prueba' });
    expect(t.llave).not.toContain(t.token.split('_')[3]);
    expect(llaveDeTokenMcp(t.token.slice(0, -1))).toBeNull();
    expect(llaveDeTokenMcp(t.llave)).toBeNull();
  });
});

describe('configuración del modo demo', () => {
  it('valores estrictos por defecto y errores claros', () => {
    const c = leerConfigDemo({ FHN_DEMO_SECRETO: 'x'.repeat(32) });
    expect(c).toMatchObject({ horas: 24, entornosPorIp: 3, documentos: 50, solicitudesPorMinuto: 30, maxCuerpo: 32 * 1024, pausado: false });
    expect(c.origenes).toEqual(['https://augustomelara-dev.github.io']);
    expect(() => leerConfigDemo({ FHN_DEMO_SECRETO: 'x'.repeat(32), FHN_DEMO_ORIGENES: '*' })).toThrow(/FHN_DEMO_ORIGENES/);
    expect(() => leerConfigDemo({ FHN_DEMO_SECRETO: 'corto' })).toThrow(/32 caracteres/);
    expect(() => leerConfigDemo({ FHN_DEMO_SECRETO: 'x'.repeat(32), FHN_DEMO_HORAS: '0' })).toThrow(/FHN_DEMO_HORAS/);
    expect(() => leerConfigDemo({ FHN_DEMO_SECRETO: 'x'.repeat(32), FHN_DEMO_URL_MCP: 'http://mcp.ejemplo.example' })).toThrow(/https/);
    let aviso = '';
    leerConfigDemo({}, (m) => (aviso = m));
    expect(aviso).toMatch(/FHN_DEMO_SECRETO/);
  });
});

conBase('modo demo', () => {
  it('crea un entorno listo: llave fhn_test_, URL del MCP, ejemplos; emite DOCUMENTO DE PRUEBA con CAI ficticio', async () => {
    const { app } = await appDemo();
    const r = await crear(app);
    expect(r.status).toBe(201);
    const e = await json(r);
    expect(e.llave).toMatch(/^fhn_test_/);
    expect(e.entorno).toMatchObject({ modo: 'prueba', leyenda: 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL', establecimiento: '000', puntoEmision: '001' });
    expect(new Date(e.entorno.expira).getTime() - new Date(e.entorno.creado).getTime()).toBe(24 * HORA);
    expect(e.mcp.url).toMatch(/^https:\/\/mcp\.ejemplo\.example\/mcp\/fhnmcp_test_[0-9a-f]{12}_/);
    expect(e.ejemplos.curl).toContain(e.llave);
    expect(e.ejemplos.curl).toContain('https://api.ejemplo.example/v1/documentos');
    expect(e.ejemplos.sdk).toContain('@factura-hn/cliente');
    expect(e.ejemplos.mcp).toContain(e.mcp.url);

    const d = await emitir(e.llave, app);
    expect(d.status).toBe(201);
    const { documento } = await json(d);
    expect(documento.cai).toMatch(/^DEMO00-NO-VALIDO-/);
    expect(documento.emisor.rtn).toMatch(/^9999/);
    const txt = await (await cliente(app, e.llave)('GET', `/v1/documentos/${documento.numero}.txt`)).text();
    expect(txt).toContain('DOCUMENTO DE PRUEBA');

    // La llave que deriva el token del MCP también es del entorno.
    const llaveMcp = llaveDeTokenMcp(e.mcp.url.split('/').pop())!;
    const s = await json(await cliente(app, llaveMcp)('GET', '/v1/sesion'));
    expect(s.sesion?.tenant ?? s.tenant).toBe(e.entorno.id);
  });

  it('aísla a dos visitantes: datos, llaves y tokens', async () => {
    const { app } = await appDemo();
    const a = await json(await crear(app));
    const b = await json(await crear(app));
    expect(a.entorno.id).not.toBe(b.entorno.id);
    const docA = (await json(await emitir(a.llave, app, venta('Solo de A')))).documento;
    const docB = (await json(await emitir(b.llave, app, venta('Solo de B')))).documento;
    // Los dos empiezan en el mismo número: cada uno tiene su propia serie.
    expect(docA.numero).toBe(docB.numero);
    const leerCon = async (llave: string) => (await json(await cliente(app, llave)('GET', `/v1/documentos/${docA.numero}`))).documento;
    expect((await leerCon(a.llave)).lineas[0].descripcion).toBe('Solo de A');
    expect((await leerCon(b.llave)).lineas[0].descripcion).toBe('Solo de B');
    const mcpB = llaveDeTokenMcp(b.mcp.url.split('/').pop())!;
    expect((await leerCon(mcpB)).lineas[0].descripcion).toBe('Solo de B');
    const llaves = await json(await cliente(app, a.llave)('GET', '/v1/llaves'));
    const prefijos = llaves.llaves.map((l: { prefijo: string }) => l.prefijo);
    expect(prefijos).toContain(a.mcp.prefijo);
    expect(prefijos).not.toContain(b.mcp.prefijo);
    // A no puede revocar la llave del MCP de B.
    expect((await cliente(app, a.llave)('DELETE', `/v1/llaves/${b.mcp.prefijo}`)).status).toBe(404);
    // Revocar su propia URL del MCP la apaga sin tocar su llave.
    expect((await cliente(app, a.llave)('DELETE', `/v1/llaves/${a.mcp.prefijo}`)).status).toBeLessThan(300);
    const mcpA = llaveDeTokenMcp(a.mcp.url.split('/').pop())!;
    expect((await cliente(app, mcpA)('GET', '/v1/sesion')).status).toBe(401);
    expect((await cliente(app, a.llave)('GET', '/v1/sesion')).status).toBe(200);
  });

  it('un CAI real es imposible: la API y la base lo rechazan en un entorno de prueba', async () => {
    const { app, pool } = await appDemo();
    const e = await json(await crear(app));
    const r = await cliente(app, e.llave)('POST', '/v1/autorizaciones', {
      cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '002', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2199-01-01',
    });
    expect(r.status).toBe(422);
    expect(JSON.stringify(await json(r))).toMatch(/AUTORIZACION_REAL_EN_DEMO/);
    // Ni el dueño de las tablas, directo en la base.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [e.entorno.id]);
      await expect(
        c.query("INSERT INTO fhn_autorizaciones (tenant, identificador, cai, rango_inicial, rango_final, datos) VALUES ($1, '000-002-01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', 1, 9, '{}')", [e.entorno.id]),
      ).rejects.toThrow(/AUTORIZACION_REAL_EN_DEMO/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('cierra webhooks, el emisor ficticio y la creación de llaves', async () => {
    const { app } = await appDemo();
    const e = await json(await crear(app));
    const c = cliente(app, e.llave);
    for (const [m, ruta, cuerpo] of [
      ['POST', '/v1/webhooks', { url: 'http://postgres.internal:5432/', eventos: ['documento.emitido'] }],
      ['GET', '/v1/webhooks', undefined],
      ['POST', '/v1/llaves', { nombre: 'otra', rol: 'admin' }],
    ] as const) {
      const r = await c(m, ruta, cuerpo);
      expect(r.status, `${m} ${ruta}`).toBe(403);
      expect((await json(r)).error.codigo).toBe('DEMO_NO_DISPONIBLE');
    }
    const emisores = await json(await c('GET', '/v1/emisores'));
    const r = await c('PATCH', `/v1/emisores/${emisores.emisores[0].id}`, { razonSocial: 'Empresa Real S.A.' });
    expect(r.status).toBe(403);
  });

  it('una llave de un tenant que no es entorno de la demo no entra', async () => {
    const { app, pool } = await appDemo();
    const { crearTenant } = await import('../src/operador');
    const prod = await crearTenant(pool, { tenant: `prod-${randomBytes(4).toString('hex')}`, nombre: 'Negocio', modo: 'produccion' });
    const prueba = await crearTenant(pool, { tenant: `prueba-${randomBytes(4).toString('hex')}`, nombre: 'Prueba', modo: 'prueba' });
    for (const llave of [prod.llaveAdmin, prueba.llaveAdmin]) {
      const r = await cliente(app, llave)('GET', '/v1/sesion');
      expect(r.status).toBe(403);
      expect((await json(r)).error.codigo).toBe('DEMO_SOLO_PRUEBA');
    }
  });

  it('vence a las 24 h y la limpieza lo borra con todos sus datos (reloj inyectado)', async () => {
    const { app, reloj, pool } = await appDemo();
    const e = await json(await crear(app));
    expect((await emitir(e.llave, app)).status).toBe(201);
    const hasta = new Date(e.entorno.expira).getTime();
    reloj.t = hasta - 1000;
    expect((await cliente(app, e.llave)('GET', '/v1/sesion')).status).toBe(200);
    // Antes de vencer, la limpieza no lo toca.
    await purgarEntornosDemo(pool, { rol: ROL, ahora: new Date(reloj.t) });
    expect((await cliente(app, e.llave)('GET', '/v1/sesion')).status).toBe(200);
    reloj.t = hasta + 1000;
    const vencido = await cliente(app, e.llave)('GET', '/v1/sesion');
    expect(vencido.status).toBe(401);
    expect((await json(vencido)).error.codigo).toBe('ENTORNO_VENCIDO');
    // Con el rol de la aplicación, como el temporizador de la API.
    expect(await purgarEntornosDemo(pool, { rol: ROL, ahora: new Date(reloj.t) })).toBeGreaterThanOrEqual(1);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [e.entorno.id]);
      const n = await c.query(
        `SELECT (SELECT count(*) FROM api_tenants WHERE tenant = $1) + (SELECT count(*) FROM api_llaves WHERE tenant = $1)
              + (SELECT count(*) FROM api_emisores WHERE tenant = $1) + (SELECT count(*) FROM api_bitacora WHERE tenant = $1)
              + (SELECT count(*) FROM api_idempotencia WHERE tenant = $1) + (SELECT count(*) FROM api_uso WHERE tenant = $1)
              + (SELECT count(*) FROM fhn_documentos WHERE tenant = $1) + (SELECT count(*) FROM fhn_autorizaciones WHERE tenant = $1)
              + (SELECT count(*) FROM fhn_series WHERE tenant = $1) + (SELECT count(*) FROM fhn_eventos WHERE tenant = $1)
              + (SELECT count(*) FROM api_demo_entornos WHERE tenant = $1) AS n`,
        [e.entorno.id],
      );
      expect(Number(n.rows[0].n)).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    expect((await cliente(app, e.llave)('GET', '/v1/sesion')).status).toBe(401);
  });

  it('la limpieza nunca borra un tenant de producción ni datos con CAI real', async () => {
    const pool = await poolPrueba();
    const { crearTenant } = await import('../src/operador');
    const t = `prod-${randomBytes(4).toString('hex')}`;
    await crearTenant(pool, { tenant: t, nombre: 'Negocio', modo: 'produccion' });
    // Aunque alguien lo registre a mano como entorno vencido.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [t]);
      await c.query("INSERT INTO api_demo_entornos (tenant, creado, expira, origen) VALUES ($1, '2000-01-01', '2000-01-02', $2)", [t, '0'.repeat(32)]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    await purgarEntornosDemo(pool, { rol: ROL, ahora: new Date('2000-02-01') });
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      await c2.query("SELECT set_config('factura_hn.tenant', $1, true)", [t]);
      expect((await c2.query('SELECT 1 FROM api_tenants WHERE tenant = $1', [t])).rowCount).toBe(1);
      await c2.query("DELETE FROM api_demo_entornos WHERE tenant = $1", [t]);
      await c2.query('COMMIT');
    } finally {
      c2.release();
    }
  });

  it('límites: entornos por dirección y globales, solicitudes por entorno y documentos, con 429 y Retry-After', async () => {
    const { app } = await appDemo({ entornosPorIp: 2, maxEntornos: 3, documentos: 2, solicitudesPorMinuto: 5 });
    const ip = '198.51.100.7';
    expect((await crear(app, ip)).status).toBe(201);
    expect((await crear(app, ip)).status).toBe(201);
    const porIp = await crear(app, ip);
    expect(porIp.status).toBe(429);
    expect(Number(porIp.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await json(porIp)).error.codigo).toBe('DEMO_LIMITE_ENTORNOS');
    const e = await json(await crear(app, '198.51.100.8'));
    expect(e.llave).toBeDefined();
    const global = await crear(app, '198.51.100.9');
    expect(global.status).toBe(429);
    expect(Number(global.headers.get('retry-after'))).toBeGreaterThan(0);

    expect((await emitir(e.llave, app)).status).toBe(201);
    expect((await emitir(e.llave, app)).status).toBe(201);
    const tercera = await emitir(e.llave, app);
    expect(tercera.status).toBe(429);
    expect((await json(tercera)).error.codigo).toBe('DEMO_LIMITE_DOCUMENTOS');
    expect(Number(tercera.headers.get('retry-after'))).toBeGreaterThan(0);
    let r: Response | undefined;
    for (let i = 0; i < 6; i++) r = await cliente(app, e.llave)('GET', '/v1/sesion');
    expect(r!.status).toBe(429);
    expect(Number(r!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('cuerpo acotado: 413', async () => {
    const { app } = await appDemo({ maxCuerpo: 2048 });
    const e = await json(await crear(app));
    const r = await emitir(e.llave, app, venta('x'.repeat(4000)));
    expect(r.status).toBe(413);
  });

  it('interruptor global: con la consola o con FHN_DEMO_PAUSADO=1, 503 DEMO_PAUSADO con Retry-After', async () => {
    const { app, pool } = await appDemo();
    const e = await json(await crear(app));
    const salida: string[] = [];
    const io = { log: (t: string) => salida.push(t), error: (t: string) => salida.push(t) };
    try {
      expect(await ejecutarConsola(['demo', 'pausar', '--motivo', 'prueba'], { env: { DATABASE_URL: URL_PG, FHN_ROL: ROL }, salida: io })).toBe(0);
      // La app recuerda el estado 5 s: una app nueva lo ve ya.
      const { app: otra } = await appDemo();
      const r = await crear(otra);
      expect(r.status).toBe(503);
      expect(r.headers.get('retry-after')).toBeTruthy();
      expect((await json(r)).error.codigo).toBe('DEMO_PAUSADO');
      const s = await cliente(otra, e.llave)('GET', '/v1/sesion');
      expect(s.status).toBe(503);
      expect((await resumenDemo(pool, { rol: ROL })).pausado).toBe(true);
    } finally {
      await pausarDemo(pool, false);
    }
    const { app: tras } = await appDemo();
    expect((await crear(tras)).status).toBe(201);
    const { app: fija } = await appDemo({ pausado: true });
    expect((await crear(fija)).status).toBe(503);
    expect(salida.join('\n')).toMatch(/pausa/);
  });

  it('CORS solo para los orígenes configurados, con preflight y cabeceras expuestas, también en los errores', async () => {
    const { app } = await appDemo({ origenes: ['https://sitio.ejemplo.example'], entornosPorIp: 1 });
    const pre = await app.request('/v1/demo/entornos', { method: 'OPTIONS', headers: { origin: 'https://sitio.ejemplo.example', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://sitio.ejemplo.example');
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    const ajeno = await app.request('/v1/demo/entornos', { method: 'OPTIONS', headers: { origin: 'https://otro.ejemplo.example' } });
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await crear(app, '192.0.2.10', { origin: 'https://sitio.ejemplo.example' });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://sitio.ejemplo.example');
    expect(ok.headers.get('access-control-expose-headers')).toContain('Retry-After');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const lleno = await crear(app, '192.0.2.10', { origin: 'https://sitio.ejemplo.example' });
    expect(lleno.status).toBe(429);
    expect(lleno.headers.get('access-control-allow-origin')).toBe('https://sitio.ejemplo.example');
    expect((await json(lleno)).error).toMatchObject({ codigo: 'DEMO_LIMITE_ENTORNOS', mensaje: expect.any(String) });
  });

  it('la dirección del visitante sale de la cabecera configurada (Fly-Client-IP) y nunca por defecto', async () => {
    const pool = await poolPrueba();
    const demo = configDemo({ entornosPorIp: 1, maxEntornos: 1000, creacionesPorMinuto: 1000 });
    const reloj = Date.UTC(anio++, 0, 1);
    const conCabecera = crearApp({ pool, modo: 'demo', rol: ROL, demo, reloj: () => new Date(reloj), cabeceraIpCliente: 'fly-client-ip', registrar: () => undefined });
    // Mismo socket (el proxy), clientes distintos: cada uno con su cupo.
    expect((await crear(conCabecera, '10.0.0.1', { 'fly-client-ip': '203.0.113.50' })).status).toBe(201);
    expect((await crear(conCabecera, '10.0.0.1', { 'fly-client-ip': '203.0.113.51' })).status).toBe(201);
    expect((await crear(conCabecera, '10.0.0.1', { 'fly-client-ip': '203.0.113.50' })).status).toBe(429);
    // Sin configurarla, la cabecera no cuenta: el socket manda.
    const sin = crearApp({ pool, modo: 'demo', rol: ROL, demo: configDemo({ entornosPorIp: 1, maxEntornos: 1000, creacionesPorMinuto: 1000 }), reloj: () => new Date(reloj), registrar: () => undefined });
    expect((await crear(sin, '10.0.0.2', { 'fly-client-ip': '203.0.113.60' })).status).toBe(201);
    expect((await crear(sin, '10.0.0.2', { 'fly-client-ip': '203.0.113.61' })).status).toBe(429);
  });

  it('fuera del modo demo la ruta no existe', async () => {
    const pool = await poolPrueba();
    const app = crearApp({ pool, modo: 'alojado', rol: ROL, registrar: () => undefined });
    const r = await crear(app);
    expect(r.status).toBe(404);
  });

  it('fuzz: cabeceras, cuerpos y llaves arbitrarios contra la demo nunca dan 500', async () => {
    const { app } = await appDemo({ entornosPorIp: 1000, solicitudesPorMinuto: 10_000, solicitudesPorEntorno: 100_000 });
    const e = await json(await crear(app));
    const rutas = ['/v1/demo/entornos', '/v1/sesion', '/v1/documentos', '/v1/llaves', '/v1/webhooks', '/v1/emisores', '/v1/autorizaciones'];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...rutas),
        fc.constantFrom('GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'),
        fc.oneof(fc.constant(undefined), fc.string({ maxLength: 200 }), fc.json({ maxDepth: 3 })),
        fc.constantFrom(null, e.llave, 'fhn_test_000000000000_' + 'A'.repeat(43), 'fhnmcp_test_x', 'Bearer'),
        fc.record({ origin: fc.oneof(fc.constant('https://augustomelara-dev.github.io'), fc.webUrl()), 'content-type': fc.constantFrom('application/json', 'text/plain', '') }),
        async (ruta, metodo, cuerpo, llave, cab) => {
          const r = await app.request(ruta, {
            method: metodo,
            headers: { ...(llave ? { authorization: `Bearer ${llave}` } : {}), ...cab, 'idempotency-key': `f-${randomBytes(4).toString('hex')}` },
            body: metodo === 'GET' || metodo === 'OPTIONS' || cuerpo === undefined ? undefined : cuerpo,
          }, { incoming: { socket: { remoteAddress: '192.0.2.201' } } });
          expect(r.status, `${metodo} ${ruta}`).toBeLessThan(500);
        },
      ),
      { numRuns: Number(process.env.FHN_FUZZ_CASOS ?? 150), seed: Number(process.env.FHN_PROP_SEMILLA ?? 20261125) },
    );
  });

  it('solicitudes mal formadas a la demo: nunca 500', async () => {
    const { app } = await appDemo();
    const casos: Array<[string, RequestInit]> = [
      ['/v1/demo/entornos', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } }],
      ['/v1/demo/entornos', { method: 'POST', body: '\u0000ÿ', headers: { 'content-type': 'text/plain' } }],
      ['/v1/demo/entornos', { method: 'GET' }],
      ['/v1/demo/entornos', { method: 'PUT' }],
      ['/v1/demo/entornos/x', { method: 'POST' }],
      ['/v1/sesion', { method: 'GET', headers: { authorization: 'Bearer fhnmcp_test_000000000000_' + 'A'.repeat(43) } }],
    ];
    for (const [ruta, init] of casos) {
      const r = await app.request(ruta, init, { incoming: { socket: { remoteAddress: '192.0.2.200' } } });
      expect(r.status, `${init.method} ${ruta}`).toBeLessThan(500);
    }
  });
});

conBase('arranque en modo demo', () => {
  /** Una base propia (un esquema aparte) para probar el arranque. */
  async function baseAparte() {
    const p = await poolPrueba();
    const esquema = `prueba_demo_${randomBytes(4).toString('hex')}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    return { url: u.toString(), cerrar: () => p.query(`DROP SCHEMA ${esquema} CASCADE`) };
  }
  const ENV = { FHN_MODO: 'demo', FHN_ROL: ROL, PUERTO: '0', FHN_HOST: '127.0.0.1', FHN_PROXIES_DE_CONFIANZA: '0', FHN_DEMO_SECRETO: 'x'.repeat(32) };

  it('se niega sin saber la dirección del visitante, con FHN_DEMO=1 o con una base con datos reales', async () => {
    const b = await baseAparte();
    try {
      await expect(arrancar({ ...ENV, FHN_PROXIES_DE_CONFIANZA: undefined, DATABASE_URL: b.url })).rejects.toThrow(/FHN_PROXIES_DE_CONFIANZA[^]*FHN_IP_CLIENTE_CABECERA/);
      await expect(arrancar({ ...ENV, FHN_DEMO: '1', DATABASE_URL: b.url })).rejects.toThrow(/FHN_DEMO=1/);
      await expect(arrancar({ ...ENV, FHN_MODO: 'demos', DATABASE_URL: b.url })).rejects.toThrow(/"local", "alojado" o "demo"/);
      // Una base que ya usó el modo local (tenant «local», de producción).
      const p = new pg.Pool({ connectionString: b.url, max: 2 });
      try {
        await migrarApi(p, ROL);
        const { iniciarLocal } = await import('../src/operador');
        await iniciarLocal(p, { rol: ROL });
        expect(await datosRealesEnBase(p)).toEqual([expect.stringMatching(/«local» es de producción/)]);
      } finally {
        await p.end();
      }
      await expect(arrancar({ ...ENV, DATABASE_URL: b.url })).rejects.toThrow(/datos reales/);
    } finally {
      await b.cerrar();
    }
  });

  it('la limpieza salta un entorno con un CAI real (forzado a mano) y borra los demás vencidos', async () => {
    const b = await baseAparte();
    const p = new pg.Pool({ connectionString: b.url, max: 2 });
    try {
      await migrarApi(p, ROL);
      const { crearTenant } = await import('../src/operador');
      const vence = new Date(Date.UTC(1990, 0, 1));
      const c = await p.connect();
      try {
        for (const t of ['con-real', 'normal']) {
          await crearTenant(p, { tenant: t, nombre: 'Entorno', modo: 'prueba' });
          await c.query('BEGIN');
          await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [t]);
          await c.query('INSERT INTO api_demo_entornos (tenant, creado, expira, origen) VALUES ($1, $2, $2, $3)', [t, vence, '0'.repeat(32)]);
          if (t === 'con-real') {
            // Saltando el disparador que lo impide (solo el dueño puede): un dato que no debería existir.
            await c.query('ALTER TABLE fhn_autorizaciones DISABLE TRIGGER fhn_api_autorizacion_por_modo');
            await c.query("INSERT INTO fhn_autorizaciones (tenant, identificador, cai, rango_inicial, rango_final, datos) VALUES ($1, '000-001-01', $2, 1, 10, '{}')", [t, caiAleatorio()]);
            await c.query('ALTER TABLE fhn_autorizaciones ENABLE TRIGGER fhn_api_autorizacion_por_modo');
          }
          await c.query('COMMIT');
        }
        expect(await purgarEntornosDemo(p, { rol: ROL, ahora: new Date(Date.UTC(1990, 0, 2)) })).toBe(1);
        await c.query('BEGIN');
        for (const [t, queda] of [['con-real', 1], ['normal', 0]] as const) {
          await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [t]);
          expect((await c.query('SELECT 1 FROM api_tenants WHERE tenant = $1', [t])).rowCount).toBe(queda);
          expect((await c.query('SELECT 1 FROM fhn_autorizaciones WHERE tenant = $1', [t])).rowCount).toBe(queda);
        }
        await c.query('COMMIT');
        expect(await datosRealesEnBase(p)).toEqual([expect.stringMatching(/«con-real» tiene autorizaciones con un CAI real/)]);
      } finally {
        c.release();
      }
    } finally {
      await p.end();
      await b.cerrar();
    }
  });

  it('arranca con una base limpia y crea entornos', async () => {
    const b = await baseAparte();
    try {
      const s = await arrancar({ ...ENV, DATABASE_URL: b.url, FHN_IP_CLIENTE_CABECERA: 'Fly-Client-IP' });
      try {
        const r = await s.app.request('/v1/demo/entornos', { method: 'POST', headers: { 'fly-client-ip': '203.0.113.9' } });
        expect(r.status).toBe(201);
      } finally {
        await s.cerrar();
      }
    } finally {
      await b.cerrar();
    }
  });
});
