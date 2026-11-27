/**
 * MCP remoto (Streamable HTTP): el mismo servidor MCP por HTTP, con la llave derivada de la URL personal o de
 * `Authorization: Bearer`. Sin base: forma del token, configuración, solicitudes mal formadas (nunca 500), Origin,
 * límites con 429 y Retry-After. Con FHN_PG_URL: de punta a punta con el cliente del SDK contra la API en modo demo
 * (initialize, lista de herramientas, emitir, consultar), aislamiento entre dos visitantes y recorte de respuestas.
 */
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configDemo, crearApp, crearLlaveOperador, crearTenant, generarTokenMcp, migrarApi } from '@factura-hn/api';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { direccionDelCliente, EventosEnMemoria, ipDelCliente, lineaArranqueHttp, opcionesMcpHttpDesdeEntorno, servirMcpHttp, type OpcionesMcpHttp } from '../src/http';
import { esLlaveApi, llaveDeTokenMcp } from '../src/token';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cualquiera = any;
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1.0.0' } },
};
const ACEPTA = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

async function servidor(o: Partial<OpcionesMcpHttp> = {}) {
  return servirMcpHttp({ urlApi: 'http://127.0.0.1:9', puerto: 0, host: '127.0.0.1', registrar: () => undefined, ...o });
}

describe('token del MCP remoto', () => {
  it('deriva la misma llave que la API (generarTokenMcp) y rechaza lo que no tiene la forma', () => {
    for (let i = 0; i < 20; i++) {
      const t = generarTokenMcp(i % 2 ? 'prueba' : 'produccion');
      expect(llaveDeTokenMcp(t.token)).toBe(t.llave);
      expect(esLlaveApi(t.llave)).toBe(true);
      expect(esLlaveApi(t.token)).toBe(false);
    }
    const t = generarTokenMcp('prueba');
    for (const malo of ['', t.llave, `${t.token}x`, t.token.slice(0, -1), t.token.replace('fhnmcp_test', 'fhnmcp_prod'), ` ${t.token}`]) {
      expect(llaveDeTokenMcp(malo)).toBeNull();
    }
  });
});

describe('configuración del MCP remoto', () => {
  it('el log de arranque dice qué rutas acepta: con FHN_MCP_SOLO_URL=1, solo /mcp/<token>', () => {
    const base = { host: '127.0.0.1', puerto: 8788, urlApi: 'http://api.local' };
    expect(lineaArranqueHttp({ ...base, permitirBearer: true })).toBe('factura-hn MCP remoto: escucha en 127.0.0.1:8788, rutas /mcp/<token> y /mcp (Bearer); API en http://api.local.');
    expect(lineaArranqueHttp({ ...base, permitirBearer: false })).toBe('factura-hn MCP remoto: escucha en 127.0.0.1:8788, ruta /mcp/<token> (solo URL); API en http://api.local.');
    expect(lineaArranqueHttp(opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'http://a', FHN_MCP_SOLO_URL: '1' }))).toContain('(solo URL)');
  });

  it('valores por defecto estrictos y errores claros en español', () => {
    const o = opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'http://api.interna:8787' });
    expect(o).toMatchObject({ puerto: 8788, host: '0.0.0.0', proxiesDeConfianza: 0, cabeceraIpCliente: undefined, maxSesiones: 100, sesionesPorLlave: 3, maxCuerpo: 65536, maxResultado: 65536, permitirBearer: true });
    expect(o.origenes).toContain('https://claude.ai');
    expect(opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'x', PORT: '8080' }).puerto).toBe(8080);
    expect(opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'x', FHN_IP_CLIENTE_CABECERA: 'Fly-Client-IP', FHN_MCP_SOLO_URL: '1' })).toMatchObject({ cabeceraIpCliente: 'fly-client-ip', permitirBearer: false });
    expect(() => opcionesMcpHttpDesdeEntorno({})).toThrow(/Falta FHN_API_URL/);
    expect(() => opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'x', FHN_MCP_ORIGENES: '*' })).toThrow(/FHN_MCP_ORIGENES/);
    expect(() => opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'x', FHN_MCP_MAX_CUERPO: '10' })).toThrow(/entre 1024/);
    expect(() => opcionesMcpHttpDesdeEntorno({ FHN_API_URL: 'x', FHN_PROXIES_DE_CONFIANZA: 'proxy.interno' })).toThrow(/FHN_PROXIES_DE_CONFIANZA/);
  });

  it('dirección del cliente: el socket por defecto; X-Forwarded-For o la cabecera del proxy solo si se configuran', () => {
    const req = (socket: string, cabeceras: Record<string, string>) => ({ socket: { remoteAddress: socket }, headers: cabeceras }) as Cualquiera;
    const r = req('10.0.0.5', { 'x-forwarded-for': '198.51.100.7, 203.0.113.9', 'fly-client-ip': '198.51.100.20' });
    expect(ipDelCliente(r)).toBe('10.0.0.5');
    expect(ipDelCliente(r, 1)).toBe('203.0.113.9');
    expect(ipDelCliente(r, 2)).toBe('198.51.100.7');
    expect(ipDelCliente(r, 0, 'fly-client-ip')).toBe('198.51.100.20');
    expect(ipDelCliente(req('10.0.0.5', { 'fly-client-ip': 'no-es-ip' }), 0, 'fly-client-ip')).toBe('10.0.0.5');
    expect(ipDelCliente(r, ['10.0.0.5'])).toBe('203.0.113.9');
    expect(ipDelCliente(r, ['10.0.0.6'])).toBe('10.0.0.5');
    expect(ipDelCliente(req('2001:db8:1:2:3:4:5:6', {}))).toBe('2001:db8:1:2::/64');
    // La que se manda a la API va sin agrupar; un proxy de la lista cuenta por su dirección exacta, no por su /64.
    expect(direccionDelCliente(req('2001:db8:1:2:3:4:5:6', {}))).toBe('2001:db8:1:2:3:4:5:6');
    expect(direccionDelCliente(req('fdaa::2', { 'x-forwarded-for': '198.51.100.7' }), ['fdaa::3'])).toBe('fdaa::2');
    expect(direccionDelCliente(req('10.0.0.5', { 'fly-client-ip': '[2001:db8::9]' }), 0, 'fly-client-ip')).toBe('2001:db8::9');
  });
});

describe('eventos para reconexión: acotados por cantidad y por bytes', () => {
  it('por sesión y en todo el proceso', async () => {
    const global = { usados: 0, maximo: 5000 };
    const evento = (n: number) => ({ jsonrpc: '2.0' as const, method: 'x', params: { relleno: 'x'.repeat(n) } });
    const a = new EventosEnMemoria(global, 200, 2000);
    for (let i = 0; i < 10; i++) await a.storeEvent('s', evento(500));
    expect(a.ocupados).toBeLessThanOrEqual(2000);
    const b = new EventosEnMemoria(global, 200, 4000);
    for (let i = 0; i < 10; i++) await b.storeEvent('s', evento(500));
    expect(global.usados).toBeLessThanOrEqual(5000);
    expect(global.usados).toBe(a.ocupados + b.ocupados);
    const c = new EventosEnMemoria(global, 3, 1_000_000);
    for (let i = 0; i < 10; i++) await c.storeEvent('s', evento(1));
    expect(global.usados).toBe(a.ocupados + b.ocupados + c.ocupados);
    a.liberar();
    b.liberar();
    c.liberar();
    expect(global.usados).toBe(0);
    // Uno más grande que el tope no se guarda, pero tiene id.
    expect(await a.storeEvent('s', evento(10_000))).toMatch(/^s_/);
    expect(a.ocupados).toBe(0);
  });
});

describe('solicitudes mal formadas o no permitidas: errores claros, nunca 500', () => {
  let s: Awaited<ReturnType<typeof servidor>>;
  beforeAll(async () => {
    s = await servidor();
  });
  afterAll(() => s.cerrar());
  const token = generarTokenMcp('prueba').token;

  const casos: Array<[string, string, RequestInit, number, RegExp]> = [
    ['ruta de más tras el token', `/mcp/${token}/x`, { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) }, 404, /No existe esta URL del MCP/],
    ['/mcp/ sin token', '/mcp/', { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) }, 404, /No existe esta URL del MCP/],
    ['token mal formado', '/mcp/fhnmcp_test_x', { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) }, 404, /No existe esta URL/],
    ['token con escape inválido', '/mcp/%E0%A4%A', { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) }, 404, /No existe/],
    ['sin llave', '/mcp', { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) }, 401, /Falta la llave/],
    ['Bearer que no es llave', '/mcp', { method: 'POST', headers: { ...ACEPTA, authorization: 'Bearer hola' }, body: JSON.stringify(INIT) }, 401, /Falta la llave/],
    ['JSON inválido', `/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: '{"jsonrpc":' }, 400, /no es JSON/],
    ['cuerpo vacío', `/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: '' }, 400, /no es JSON/],
    ['sin initialize ni sesión', `/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }, 400, /Mcp-Session-Id/],
    ['GET sin sesión', `/mcp/${token}`, { method: 'GET', headers: { accept: 'text/event-stream' } }, 400, /Mcp-Session-Id/],
    ['sesión inexistente', `/mcp/${token}`, { method: 'POST', headers: { ...ACEPTA, 'mcp-session-id': 'no-existe' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }, 404, /no existe o venció/],
    ['método no permitido', `/mcp/${token}`, { method: 'PUT', headers: ACEPTA, body: '{}' }, 405, /Método no permitido/],
    ['origen ajeno', `/mcp/${token}`, { method: 'POST', headers: { ...ACEPTA, origin: 'https://sitio-malo.ejemplo.example' }, body: JSON.stringify(INIT) }, 403, /Origen no permitido/],
    ['cuerpo enorme', `/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: 'x'.repeat(70 * 1024) }, 413, /supera 64 KB/],
    ['varios mensajes en un arreglo', `/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: JSON.stringify([INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]) }, 400, /un mensaje JSON-RPC por solicitud/],
    ['ruta desconocida', '/otra', { method: 'GET' }, 404, /Ruta no encontrada/],
    ['API caída al iniciar', `/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) }, 502, /No se pudo conectar con la API/],
  ];
  it.each(casos)('%s', async (_n, ruta, init, estado, mensaje) => {
    const r = await fetch(`${s.url}${ruta}`, init);
    expect(r.status).toBe(estado);
    const cuerpo = (await r.json()) as Cualquiera;
    expect(cuerpo).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: expect.any(Number) } });
    expect(cuerpo.error.message).toMatch(mensaje);
  });

  it('salud responde sin llave y sin datos', async () => {
    const r = await fetch(`${s.url}/salud`);
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as Cualquiera;
    expect(cuerpo).toMatchObject({ ok: true });
    expect(Object.keys(cuerpo).sort()).toEqual(['ok', 'version']);
  });

  it('con FHN_MCP_SOLO_URL=1, /mcp con Bearer no existe', async () => {
    const solo = await servidor({ permitirBearer: false });
    try {
      const r = await fetch(`${solo.url}/mcp`, { method: 'POST', headers: { ...ACEPTA, authorization: `Bearer ${token}` }, body: JSON.stringify(INIT) });
      expect(r.status).toBe(404);
    } finally {
      await solo.cerrar();
    }
  });

  it('demasiadas solicitudes por dirección o por llave: 429 con Retry-After', async () => {
    const porIp = await servidor({ solicitudesPorMinutoIp: 2 });
    const porLlave = await servidor({ solicitudesPorMinutoLlave: 2 });
    try {
      for (const [srv, mensaje] of [[porIp, /desde tu dirección/], [porLlave, /con esta llave/]] as const) {
        const pedir = () => fetch(`${srv.url}/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
        expect((await pedir()).status).toBe(400);
        expect((await pedir()).status).toBe(400);
        const r = await pedir();
        expect(r.status).toBe(429);
        expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        expect(((await r.json()) as Cualquiera).error.message).toMatch(mensaje);
      }
    } finally {
      await porIp.cerrar();
      await porLlave.cerrar();
    }
  });
});

const URL_PG = process.env.FHN_PG_URL;
describe.skipIf(!URL_PG)('MCP remoto contra la API en modo demo', () => {
  const pool = new pg.Pool({ connectionString: URL_PG, max: 10 });
  // Un reloj lejos en el futuro (y distinto de los de las pruebas de la API): la limpieza de otras pruebas no toca
  // estos entornos y los cupos globales solo ven los de este año.
  const reloj = { t: Date.UTC(2001 + Math.floor(Math.random() * 19), 2, 10, 15) };
  /** X-Forwarded-For de cada solicitud que el MCP hizo a la API. */
  const reenviadas: Array<string | null> = [];
  let app: ReturnType<typeof crearApp>;
  let fetchApp: typeof fetch;
  let s: Awaited<ReturnType<typeof servidor>>;

  beforeAll(async () => {
    await migrarApi(pool);
    const demo = configDemo({ maxEntornos: 100_000, entornosPorIp: 1000, creacionesPorMinuto: 1000, urlMcp: 'https://mcp.ejemplo.example/mcp', urlApi: 'https://api.ejemplo.example' });
    app = crearApp({ pool, modo: 'demo', demo, reloj: () => new Date(reloj.t), registrar: () => undefined });
    fetchApp = ((e: RequestInfo | URL, init?: RequestInit) => {
      const r = e instanceof Request ? e : new Request(e, init);
      reenviadas.push(r.headers.get('x-forwarded-for'));
      return app.fetch(r);
    }) as typeof fetch;
    s = await servidor({ urlApi: 'http://api.local', fetch: fetchApp });
  });
  afterAll(async () => {
    await s?.cerrar();
    await pool.end();
  });

  async function entorno() {
    const ip = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
    const r = await app.request('/v1/demo/entornos', { method: 'POST' }, { incoming: { socket: { remoteAddress: ip } } });
    expect(r.status).toBe(201);
    const c = (await r.json()) as Cualquiera;
    const token = String(c.mcp.url).split('/').pop()!;
    expect(llaveDeTokenMcp(token)).toMatch(/^fhn_test_/);
    return { llave: c.llave as string, token };
  }
  async function conectar(url: string, cabeceras: Record<string, string> = {}) {
    const transporte = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: cabeceras } });
    const cliente = new Client({ name: 'asistente', version: '1.0.0' });
    await cliente.connect(transporte);
    return { cliente, transporte };
  }
  const llamar = async (c: Client, name: string, args: Record<string, unknown>) =>
    (await c.callTool({ name, arguments: args })) as unknown as { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Cualquiera };

  it('de punta a punta con el cliente del SDK: initialize, herramientas, emitir y consultar', async () => {
    const { token } = await entorno();
    const { cliente } = await conectar(`${s.url}/mcp/${token}`);
    try {
      expect(cliente.getServerVersion()?.name).toBe('factura-hn');
      const { tools } = await cliente.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['emitir_factura', 'consultar_documento', 'listar_documentos', 'anular_documento', 'estado_cai', 'libro_ventas']));
      const r = await llamar(cliente, 'emitir_factura', {
        lineas: [{ descripcion: 'Producto de prueba', cantidad: 2, precioUnitario: '100.00' }],
        idempotencyKey: `http-${randomBytes(6).toString('hex')}`,
      });
      expect(r.isError).toBeFalsy();
      expect(r.content[0]!.text).toMatch(/^Emitida: Factura 000-001-01-00000001 /);
      expect(r.content[0]!.text).toContain('DOCUMENTO DE PRUEBA — SIN VALOR FISCAL');
      expect(r.structuredContent.documento.cai).toMatch(/^DEMO00-NO-VALIDO-/);
      const numero = r.structuredContent.documento.numero as string;
      const c = await llamar(cliente, 'consultar_documento', { numero });
      expect(c.isError).toBeFalsy();
      expect(c.structuredContent.documento.numero).toBe(numero);
      expect(s.servidor.listening).toBe(true);
    } finally {
      await cliente.close();
    }
  });

  it('también con Authorization: Bearer (la llave del visitante o el token)', async () => {
    const { llave, token } = await entorno();
    for (const credencial of [llave, token]) {
      const { cliente } = await conectar(`${s.url}/mcp`, { authorization: `Bearer ${credencial}` });
      try {
        expect((await cliente.listTools()).tools.length).toBeGreaterThan(3);
      } finally {
        await cliente.close();
      }
    }
  });

  it('aislamiento: dos visitantes no ven sus documentos, llaves ni sesiones', async () => {
    const a = await entorno();
    const b = await entorno();
    const ca = await conectar(`${s.url}/mcp/${a.token}`);
    const cb = await conectar(`${s.url}/mcp/${b.token}`);
    try {
      const r = await llamar(ca.cliente, 'emitir_factura', {
        lineas: [{ descripcion: 'Solo de A', cantidad: 1, precioUnitario: '10.00' }],
        idempotencyKey: `iso-${randomBytes(6).toString('hex')}`,
      });
      const numero = r.structuredContent.documento.numero as string;
      // El mismo número no existe para B: cada visitante tiene su tenant y su serie.
      const enB = await llamar(cb.cliente, 'consultar_documento', { numero, formato: 'json' });
      expect(enB.isError).toBe(true);
      expect(enB.content[0]!.text).toMatch(/NO_ENCONTRADO|No existe/);
      // La sesión de A no sirve con la URL de B: 404, como una sesión inexistente.
      const idA = ca.transporte.sessionId!;
      const robo = await fetch(`${s.url}/mcp/${b.token}`, {
        method: 'POST',
        headers: { ...ACEPTA, 'mcp-session-id': idA, 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'consultar_documento', arguments: { numero } } }),
      });
      expect(robo.status).toBe(404);
      // Ni con la llave de API de B por Bearer.
      const robo2 = await fetch(`${s.url}/mcp`, {
        method: 'POST',
        headers: { ...ACEPTA, authorization: `Bearer ${b.llave}`, 'mcp-session-id': idA },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
      });
      expect(robo2.status).toBe(404);
      // La URL de A sigue funcionando.
      expect((await llamar(ca.cliente, 'consultar_documento', { numero })).isError).toBeFalsy();
    } finally {
      await ca.cliente.close();
      await cb.cliente.close();
    }
  });

  it('un token válido en forma pero desconocido para la API no abre sesión (401)', async () => {
    const r = await fetch(`${s.url}/mcp/${generarTokenMcp('prueba').token}`, { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) });
    expect(r.status).toBe(401);
    expect(((await r.json()) as Cualquiera).error.message).toMatch(/no acepta esta llave/);
  });

  it('revocar la llave del MCP apaga la URL sin tocar la llave del visitante', async () => {
    const { llave, token } = await entorno();
    const prefijo = token.split('_')[2]!;
    const del = await app.request(`/v1/llaves/${prefijo}`, { method: 'DELETE', headers: { authorization: `Bearer ${llave}` } });
    expect(del.status).toBeLessThan(300);
    const r = await fetch(`${s.url}/mcp/${token}`, { method: 'POST', headers: ACEPTA, body: JSON.stringify(INIT) });
    expect(r.status).toBe(401);
    expect((await app.request('/v1/sesion', { headers: { authorization: `Bearer ${llave}` } })).status).toBe(200);
  });

  it('sesiones por llave acotadas: la más vieja se cierra', async () => {
    const pocas = await servidor({ urlApi: 'http://api.local', fetch: fetchApp, sesionesPorLlave: 1 });
    const { token } = await entorno();
    const uno = await conectar(`${pocas.url}/mcp/${token}`);
    const dos = await conectar(`${pocas.url}/mcp/${token}`);
    try {
      expect((await dos.cliente.listTools()).tools.length).toBeGreaterThan(0);
      const r = await fetch(`${pocas.url}/mcp/${token}`, {
        method: 'POST',
        headers: { ...ACEPTA, 'mcp-session-id': uno.transporte.sessionId!, 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      });
      expect(r.status).toBe(404);
    } finally {
      await uno.cliente.close().catch(() => undefined);
      await dos.cliente.close();
      await pocas.cerrar();
    }
  });

  it('una respuesta grande se recorta con aviso', async () => {
    const corto = await servidor({ urlApi: 'http://api.local', fetch: fetchApp, maxResultado: 1024 });
    const { token } = await entorno();
    const { cliente } = await conectar(`${corto.url}/mcp/${token}`);
    try {
      const r = await llamar(cliente, 'emitir_factura', {
        lineas: Array.from({ length: 5 }, (_, i) => ({ descripcion: `Artículo de prueba ${i + 1}`, cantidad: 1, precioUnitario: '10.00' })),
        idempotencyKey: `big-${randomBytes(6).toString('hex')}`,
      });
      const numero = r.content[0]!.text.match(/\d{3}-\d{3}-\d{2}-\d{8}/)![0];
      const c = await llamar(cliente, 'consultar_documento', { numero, formato: 'json' });
      expect(JSON.stringify(c).length).toBeLessThan(2048);
      expect(c.content.at(-1)!.text).toContain('[Respuesta recortada');
      expect(c.structuredContent).toBeUndefined();
    } finally {
      await cliente.close();
      await corto.cerrar();
    }
  });

  it('manda a la API la dirección del cliente en X-Forwarded-For', async () => {
    const conCabecera = await servidor({ urlApi: 'http://api.local', fetch: fetchApp, cabeceraIpCliente: 'x-ip-prueba' });
    const { token } = await entorno();
    reenviadas.length = 0;
    const { cliente } = await conectar(`${conCabecera.url}/mcp/${token}`, { 'x-ip-prueba': '203.0.113.44' });
    try {
      await cliente.listTools();
      await llamar(cliente, 'estado_cai', {});
      expect(reenviadas.length).toBeGreaterThanOrEqual(2);
      expect(new Set(reenviadas)).toEqual(new Set(['203.0.113.44']));
    } finally {
      await cliente.close();
      await conCabecera.cerrar();
    }
  });

  it('cupos de sesiones por tenant y por dirección: un visitante no llena el cupo de todos', async () => {
    const chico = await servidor({ urlApi: 'http://api.local', fetch: fetchApp, maxSesiones: 10, sesionesPorTenant: 3, sesionesPorIp: 6, cabeceraIpCliente: 'x-ip-prueba' });
    const abiertos: Client[] = [];
    try {
      const a = await entorno();
      // A abre 12 sesiones con sus dos credenciales y desde varias direcciones: le quedan 3.
      for (let i = 0; i < 12; i++) {
        const url = i % 2 ? `${chico.url}/mcp/${a.token}` : `${chico.url}/mcp`;
        const cab: Record<string, string> = { 'x-ip-prueba': `198.51.100.${100 + i}` };
        if (!(i % 2)) cab.authorization = `Bearer ${a.llave}`;
        abiertos.push((await conectar(url, cab)).cliente);
      }
      const salud = await fetch(`${chico.url}/salud`);
      expect(salud.status).toBe(200);
      const b = await entorno();
      const cb = await conectar(`${chico.url}/mcp/${b.token}`, { 'x-ip-prueba': '198.51.100.200' });
      abiertos.push(cb.cliente);
      expect((await cb.cliente.listTools()).tools.length).toBeGreaterThan(0);
      // Por dirección: desde una sola, a lo sumo 6 sesiones aunque sean de entornos distintos.
      const unaIp = await servidor({ urlApi: 'http://api.local', fetch: fetchApp, sesionesPorIp: 2, cabeceraIpCliente: 'x-ip-prueba' });
      try {
        const abiertas: Array<{ token: string; id: string }> = [];
        for (let i = 0; i < 3; i++) {
          const e = await entorno();
          const c = await conectar(`${unaIp.url}/mcp/${e.token}`, { 'x-ip-prueba': '198.51.100.250' });
          abiertos.push(c.cliente);
          abiertas.push({ token: e.token, id: c.transporte.sessionId! });
        }
        const usar = ({ token, id }: { token: string; id: string }) =>
          fetch(`${unaIp.url}/mcp/${token}`, {
            method: 'POST',
            headers: { ...ACEPTA, 'mcp-session-id': id, 'mcp-protocol-version': '2025-06-18', 'x-ip-prueba': '198.51.100.250' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
          }).then((r) => r.status);
        expect(await usar(abiertas[0]!)).toBe(404);
        expect(await usar(abiertas[2]!)).toBe(200);
      } finally {
        await unaIp.cerrar();
      }
    } finally {
      for (const c of abiertos) await c.close().catch(() => undefined);
      await chico.cerrar();
    }
  });

  it('una ráfaga de tokens falsos desde una dirección no deja sin sesión a un visitante nuevo de otra', async () => {
    // La API con el semáforo de llaves no validadas casi siempre lleno (1 lugar) y pocas fichas por dirección. Cree
    // X-Forwarded-For solo del MCP (10.9.9.9).
    const demo = configDemo({ maxEntornos: 100_000, entornosPorIp: 1000, creacionesPorMinuto: 1000, urlMcp: 'https://mcp.ejemplo.example/mcp', urlApi: 'https://api.ejemplo.example' });
    const apiEstricta = crearApp({
      pool, modo: 'demo', demo, reloj: () => new Date(reloj.t), registrar: () => undefined,
      proxiesDeConfianza: ['10.9.9.9'], limiteIntentos: { consultasSimultaneas: 1, porSegundo: 0.01, rafaga: 2 },
    });
    const desdeElMcp = ((e: RequestInfo | URL, init?: RequestInit) =>
      apiEstricta.fetch(e instanceof Request ? e : new Request(e, init), { incoming: { socket: { remoteAddress: '10.9.9.9' } } })) as typeof fetch;
    const mcp = await servidor({ urlApi: 'http://api.local', fetch: desdeElMcp, cabeceraIpCliente: 'x-ip-prueba', rechazosPorMinutoIp: 10_000, solicitudesPorMinutoIp: 10_000 });
    try {
      const visitante = await entorno();
      const rafaga = Array.from({ length: 30 }, () =>
        fetch(`${mcp.url}/mcp/${generarTokenMcp('prueba').token}`, { method: 'POST', headers: { ...ACEPTA, 'x-ip-prueba': '203.0.113.66' }, body: JSON.stringify(INIT) }).then((r) => r.status));
      const nuevo = conectar(`${mcp.url}/mcp/${visitante.token}`, { 'x-ip-prueba': '203.0.113.77' });
      const estados = await Promise.all(rafaga);
      expect(estados.every((e) => e === 401 || e === 429)).toBe(true);
      const { cliente } = await nuevo;
      expect((await cliente.listTools()).tools.length).toBeGreaterThan(0);
      await cliente.close();
    } finally {
      await mcp.cerrar();
    }
  });

  it('el MCP frena por su cuenta a una dirección que manda muchas URL no válidas', async () => {
    const frena = await servidor({ urlApi: 'http://api.local', fetch: fetchApp, rechazosPorMinutoIp: 2, cabeceraIpCliente: 'x-ip-prueba' });
    try {
      const pedir = (ip: string) =>
        fetch(`${frena.url}/mcp/${generarTokenMcp('prueba').token}`, { method: 'POST', headers: { ...ACEPTA, 'x-ip-prueba': ip }, body: JSON.stringify(INIT) });
      expect((await pedir('203.0.113.90')).status).toBe(401);
      expect((await pedir('203.0.113.90')).status).toBe(401);
      const r = await pedir('203.0.113.90');
      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect((await pedir('203.0.113.91')).status).toBe(401);
    } finally {
      await frena.cerrar();
    }
  });
});

describe.skipIf(!URL_PG)('MCP remoto con una llave de caja', () => {
  const pool = new pg.Pool({ connectionString: URL_PG, max: 5 });
  let app: ReturnType<typeof crearApp>;
  let s: Awaited<ReturnType<typeof servidor>>;
  let token: string;
  let tenant: string;
  let llaveAdmin: string;

  beforeAll(async () => {
    await migrarApi(pool);
    app = crearApp({ pool, modo: 'local', registrar: () => undefined });
    tenant = `mcp-caja-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    ({ llaveAdmin } = await crearTenant(pool, { tenant, nombre: tenant }));
    const admin = (ruta: string, cuerpo: unknown) =>
      app.request(ruta, { method: 'POST', headers: { authorization: `Bearer ${llaveAdmin}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    const e = await admin('/v1/emisores', {
      rtn: '99990000000001', razonSocial: 'Ferretería Ejemplo S. de R.L.', nombreComercial: 'Ferretería Ejemplo', direccionCasaMatriz: 'Tegucigalpa, M.D.C.',
      direccionEstablecimiento: 'San Pedro Sula', telefono: '0000-0003', correo: 'ventas@ejemplo.example',
    });
    expect(e.status, await e.clone().text()).toBe(201);
    const limite = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    const hex = (n: number) => randomBytes(n).toString('hex').toUpperCase();
    const a = await admin('/v1/autorizaciones', {
      cai: `${hex(3)}-${hex(3)}-${hex(3)}-${hex(3)}-${hex(3)}-${hex(1)}`, tipoDocumento: '01', establecimiento: '001', puntoEmision: '002',
      rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: limite,
    });
    expect(a.status, await a.clone().text()).toBe(201);
    // La URL que imprime `llave crear --rol caja --caja 001-002 --mcp`.
    token = await crearLlaveOperador(pool, { tenant, rol: 'caja', nombre: 'Caja 2 (MCP)', establecimiento: '001', puntoEmision: '002', mcp: true });
    // El punto del servidor (000-001 por defecto) no aplica a una llave de caja.
    s = await servidor({ urlApi: 'http://api.local', fetch: ((u: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(u, init))) as typeof fetch });
  });
  afterAll(async () => {
    await s?.cerrar();
    await pool.end();
  });

  it('un token de caja 001-002 emite en su caja, no en la del servidor', async () => {
    const cliente = new Client({ name: 'asistente', version: '1.0.0' });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp/${token}`)));
    try {
      const r = (await cliente.callTool({
        name: 'emitir_factura',
        arguments: { lineas: [{ descripcion: 'Producto de prueba', cantidad: 1, precioUnitario: '50.00' }], idempotencyKey: `caja-${randomBytes(6).toString('hex')}` },
      })) as unknown as { isError?: boolean; content: { text: string }[] };
      expect(r.isError, r.content[0]?.text).toBeFalsy();
      expect(r.content[0]!.text).toMatch(/^Emitida: Factura 001-002-01-00000001 /);
    } finally {
      await cliente.close();
    }
  });

  it('un token fhnmcp_ de una llave admin (creado antes de la regla) no abre sesión: 403 por URL y por Bearer', async () => {
    // Como lo dejaba la consola antes: la llave derivada del token, con rol admin.
    const t = generarTokenMcp('produccion');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
      await c.query("INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre) VALUES ($1, $2, $3, 'admin', 'MCP admin viejo')", [t.prefijo, tenant, t.hash]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    for (const [ruta, cabeceras] of [[`/mcp/${t.token}`, {}], ['/mcp', { authorization: `Bearer ${t.token}` }]] as const) {
      const r = await fetch(`${s.url}${ruta}`, { method: 'POST', headers: { ...ACEPTA, ...cabeceras }, body: JSON.stringify(INIT) });
      expect(r.status, ruta).toBe(403);
      expect(((await r.json()) as Cualquiera).error.message).toMatch(/solo puede ser de una llave de caja.*--rol caja --caja 000-001 --mcp/);
    }
    expect(s.servidor.listening).toBe(true);
    // La llave admin (fhn_…) por Bearer sí abre sesión: solo el token de URL está limitado a caja.
    const admin = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { ...ACEPTA, authorization: `Bearer ${llaveAdmin}` }, body: JSON.stringify(INIT) });
    expect(admin.status).toBe(200);
  });
});

