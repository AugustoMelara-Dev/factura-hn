/**
 * MCP remoto (Streamable HTTP): el mismo servidor MCP por HTTP, con la llave derivada de la URL personal o de
 * `Authorization: Bearer`. Sin base: forma del token, configuración, solicitudes mal formadas (nunca 500), Origin,
 * límites con 429 y Retry-After. Con FHN_PG_URL: de punta a punta con el cliente del SDK contra la API en modo demo
 * (initialize, lista de herramientas, emitir, consultar), aislamiento entre dos visitantes y recorte de respuestas.
 */
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configDemo, crearApp, generarTokenMcp, migrarApi } from '@factura-hn/api';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ipDelCliente, opcionesMcpHttpDesdeEntorno, servirMcpHttp, type OpcionesMcpHttp } from '../src/http';
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
    expect(await r.json()).toMatchObject({ ok: true, sesiones: 0 });
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
  const reloj = { t: Date.UTC(9500 + Math.floor(Math.random() * 400), 2, 10, 15) };
  let app: ReturnType<typeof crearApp>;
  let fetchApp: typeof fetch;
  let s: Awaited<ReturnType<typeof servidor>>;

  beforeAll(async () => {
    await migrarApi(pool);
    const demo = configDemo({ maxEntornos: 100_000, entornosPorIp: 1000, creacionesPorMinuto: 1000, urlMcp: 'https://mcp.ejemplo.example/mcp', urlApi: 'https://api.ejemplo.example' });
    app = crearApp({ pool, modo: 'demo', demo, reloj: () => new Date(reloj.t), registrar: () => undefined });
    fetchApp = ((e: RequestInfo | URL, init?: RequestInit) => app.fetch(e instanceof Request ? e : new Request(e, init))) as typeof fetch;
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
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['emitir_factura', 'consultar_documento', 'anular_documento', 'estado_cai', 'libro_ventas']));
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
});
