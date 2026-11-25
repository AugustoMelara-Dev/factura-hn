/**
 * MCP remoto: el mismo servidor MCP (las mismas herramientas, errores y confirmaciones que por stdio) por el
 * transporte Streamable HTTP, para usarlo como conector personalizado en Claude (web, escritorio y móvil), en ChatGPT
 * o con el MCP Inspector.
 *
 * Corre como su propio proceso y habla con la API de factura-hn por HTTP, con una llave de API por conexión:
 * - `POST|GET|DELETE /mcp/<token>`: la URL personal (`fhnmcp_…`) que da `POST /v1/demo/entornos`. De ella se deriva
 *   la llave (ver `token.ts`). Es la forma que funciona en Claude, que agrega un conector solo con su URL.
 * - `POST|GET|DELETE /mcp` con `Authorization: Bearer <llave fhn_… o token fhnmcp_…>`: para clientes que mandan
 *   cabeceras (MCP Inspector, un agente propio).
 *
 * No guarda datos ni credenciales: cada sesión MCP vive en memoria, atada a su llave, y vence por inactividad. La API
 * hace todo lo demás (aislamiento por tenant con RLS, límites, idempotencia, reglas fiscales).
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { StreamableHTTPServerTransport, type EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { crearCliente, ErrorFacturaHN } from '@factura-hn/cliente';
import { BackendApi } from './backend';
import { crearServidorMCP } from './servidor';
import { esLlaveApi, llaveDeTokenMcp } from './token';
import { versionPaquete } from './version';

/** Orígenes de navegador aceptados por defecto (si la solicitud trae `Origin`): los clientes web conocidos. */
export const ORIGENES_MCP_POR_DEFECTO = ['https://claude.ai', 'https://claude.com', 'https://chatgpt.com', 'https://chat.openai.com'] as const;

export interface OpcionesMcpHttp {
  /** URL de la API de factura-hn (p. ej. la de la red privada del proveedor). */
  urlApi: string;
  /** Dónde emite cada sesión. Por defecto 000 y 001 (el punto de los entornos de prueba). */
  establecimiento?: string;
  puntoEmision?: string;
  /**
   * Proxies delante de este servidor, como `FHN_PROXIES_DE_CONFIANZA` de la API: 0 (por defecto) usa la dirección del
   * socket; N usa la N-ésima de `X-Forwarded-For` desde la derecha; una lista, solo si el socket es uno de ellos.
   */
  proxiesDeConfianza?: number | readonly string[];
  /** Cabecera con la dirección del cliente que pone el proxy de confianza (p. ej. `fly-client-ip`). Nunca por defecto. */
  cabeceraIpCliente?: string;
  /** Orígenes aceptados cuando la solicitud trae `Origin` (protección contra DNS rebinding). Sin `Origin`, se acepta. */
  origenes?: readonly string[];
  /** Sesiones MCP abiertas a la vez en el proceso. Por defecto 100. */
  maxSesiones?: number;
  /** Sesiones abiertas a la vez por llave; la más vieja se cierra al abrir otra. Por defecto 3. */
  sesionesPorLlave?: number;
  /** Una sesión sin solicitudes durante este tiempo se cierra. Por defecto 15 minutos. */
  sesionInactivaMs?: number;
  /** Solicitudes por minuto por dirección y por llave. Por defecto 60 y 60. */
  solicitudesPorMinutoIp?: number;
  solicitudesPorMinutoLlave?: number;
  /** Bytes de un cuerpo de solicitud. Por defecto 64 KiB. */
  maxCuerpo?: number;
  /** Caracteres del resultado de una herramienta (ver `maxResultado` de `crearServidorMCP`). Por defecto 64 KiB. */
  maxResultado?: number;
  /** Acepta `Authorization: Bearer` en `/mcp`. Por defecto true. */
  permitirBearer?: boolean;
  /** fetch hacia la API (para pruebas). */
  fetch?: typeof fetch;
  registrar?: (mensaje: string, error?: unknown) => void;
}

/** Token bucket por clave (como el de la API), en memoria: con una sola réplica el límite es exacto. */
class Cubetas {
  private readonly c = new Map<string, { fichas: number; t: number }>();
  constructor(private readonly porMinuto: number) {}
  /** 0 si se permite, o los segundos a esperar. */
  tomar(clave: string): number {
    const t = Date.now();
    const b = this.c.get(clave) ?? { fichas: this.porMinuto, t };
    b.fichas = Math.min(this.porMinuto, b.fichas + ((t - b.t) / 60_000) * this.porMinuto);
    b.t = t;
    if (!this.c.has(clave) && this.c.size >= 10_000) this.c.delete(this.c.keys().next().value!);
    this.c.set(clave, b);
    if (b.fichas >= 1) {
      b.fichas -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil(((1 - b.fichas) * 60) / this.porMinuto));
  }
}

/** Eventos de cada sesión, para que un cliente que se reconecta (`Last-Event-ID`) reciba lo que se perdió. Acotado. */
class EventosEnMemoria implements EventStore {
  private readonly eventos: Array<{ id: string; stream: string; mensaje: JSONRPCMessage }> = [];
  constructor(private readonly maximo = 200) {}
  async storeEvent(stream: string, mensaje: JSONRPCMessage): Promise<string> {
    const id = `${stream}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    this.eventos.push({ id, stream, mensaje });
    if (this.eventos.length > this.maximo) this.eventos.shift();
    return id;
  }
  async getStreamIdForEventId(id: string): Promise<string | undefined> {
    return this.eventos.find((e) => e.id === id)?.stream;
  }
  async replayEventsAfter(ultimo: string, { send }: { send: (id: string, m: JSONRPCMessage) => Promise<void> }): Promise<string> {
    const i = this.eventos.findIndex((e) => e.id === ultimo);
    if (i < 0) return '';
    const stream = this.eventos[i]!.stream;
    for (const e of this.eventos.slice(i + 1)) if (e.stream === stream) await send(e.id, e.mensaje);
    return stream;
  }
}

interface Sesion {
  transporte: StreamableHTTPServerTransport;
  /** Huella de la llave con que se abrió: una solicitud con otra llave no entra a esta sesión. */
  huella: string;
  ultimoUso: number;
}

/** Error JSON-RPC sin id, con el mensaje en español, y el estado HTTP. */
function responderError(res: ServerResponse, estado: number, mensaje: string, codigo = -32000, cabeceras: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabeceras });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: codigo, message: mensaje }, id: null }));
}

class ErrorHttp extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
    readonly codigo = -32000,
    readonly cabeceras: Record<string, string> = {},
  ) {
    super(mensaje);
  }
}

/** Lee el cuerpo con tope de bytes; más allá, 413 sin seguir leyendo. */
async function leerCuerpo(req: IncomingMessage, max: number): Promise<string> {
  const declarado = Number(req.headers['content-length']);
  if (Number.isFinite(declarado) && declarado > max) throw new ErrorHttp(413, `El cuerpo supera ${Math.floor(max / 1024)} KB.`);
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > max) throw new ErrorHttp(413, `El cuerpo supera ${Math.floor(max / 1024)} KB.`);
    partes.push(p as Buffer);
  }
  return Buffer.concat(partes).toString('utf8');
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** IPv6 por su /64; IPv4 tal cual. */
function agrupar(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:(?=\d)/, '');
  if (IPV4.test(v) || !v.includes(':')) return v;
  const [izq = '', der = ''] = v.split('::');
  const a = izq ? izq.split(':') : [];
  const b = der ? der.split(':') : [];
  const grupos = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** La dirección del cliente, con las mismas reglas que la API (ver `OpcionesMcpHttp.proxiesDeConfianza`). */
export function ipDelCliente(req: IncomingMessage, proxies: number | readonly string[] = 0, cabecera?: string): string {
  const socket = req.socket.remoteAddress ?? 'desconocida';
  if (cabecera) {
    const v = req.headers[cabecera.toLowerCase()];
    const t = (Array.isArray(v) ? v[0] : v)?.trim();
    if (t && isIP(t.replace(/^\[|\]$/g, '')) !== 0) return agrupar(t);
  }
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (typeof proxies === 'number') {
    if (proxies > 0 && xff.length >= proxies) return agrupar(xff[xff.length - proxies]!);
  } else if (proxies.length && proxies.map((p) => agrupar(p)).includes(agrupar(socket))) {
    const confiables = new Set(proxies.map((p) => agrupar(p)));
    for (let i = xff.length - 1; i >= 0; i--) if (!confiables.has(agrupar(xff[i]!))) return agrupar(xff[i]!);
  }
  return agrupar(socket);
}

export interface ManejadorMcpHttp {
  /** Atiende una solicitud de node:http. Nunca lanza: los errores se responden en JSON-RPC. */
  manejar(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Sesiones abiertas. */
  sesiones(): number;
  /** Cierra las sesiones y el barrido de inactivas. */
  cerrar(): Promise<void>;
}

export function crearManejadorMcpHttp(o: OpcionesMcpHttp): ManejadorMcpHttp {
  const urlApi = o.urlApi.replace(/\/+$/, '');
  const origenes = new Set(o.origenes ?? ORIGENES_MCP_POR_DEFECTO);
  const maxSesiones = o.maxSesiones ?? 100;
  const porLlave = o.sesionesPorLlave ?? 3;
  const inactiva = o.sesionInactivaMs ?? 15 * 60_000;
  const maxCuerpo = o.maxCuerpo ?? 64 * 1024;
  const porIp = new Cubetas(o.solicitudesPorMinutoIp ?? 60);
  const porLlaveMinuto = new Cubetas(o.solicitudesPorMinutoLlave ?? 60);
  const registrar = o.registrar ?? ((m: string, e?: unknown) => console.error(m, e ?? ''));
  const sesiones = new Map<string, Sesion>();

  const cerrarSesion = async (id: string) => {
    const s = sesiones.get(id);
    if (!s) return;
    sesiones.delete(id);
    await s.transporte.close().catch(() => undefined);
  };
  const barrido = setInterval(() => {
    const limite = Date.now() - inactiva;
    for (const [id, s] of sesiones) if (s.ultimoUso < limite) void cerrarSesion(id);
  }, Math.min(60_000, Math.max(1000, Math.floor(inactiva / 2))));
  barrido.unref();

  /** La llave de la solicitud: del token de la ruta o de `Authorization: Bearer`. */
  function llaveDe(req: IncomingMessage, ruta: string): string {
    const m = /^\/mcp\/([^/]+)$/.exec(ruta);
    if (m) {
      let token: string;
      try {
        token = decodeURIComponent(m[1]!);
      } catch {
        token = '';
      }
      const llave = llaveDeTokenMcp(token);
      // Un token que no tiene la forma se responde como una ruta inexistente: no se distingue de un error de tipeo.
      if (!llave) throw new ErrorHttp(404, 'No existe esta URL del MCP. Revisa que la copiaste completa.');
      return llave;
    }
    if (!(o.permitirBearer ?? true)) throw new ErrorHttp(404, 'Ruta no encontrada. Usa la URL personal del MCP (/mcp/<token>).');
    const auth = String(req.headers.authorization ?? '');
    const credencial = /^bearer +(\S+)$/i.exec(auth.trim())?.[1] ?? '';
    const llave = esLlaveApi(credencial) ? credencial : llaveDeTokenMcp(credencial);
    if (!llave) {
      throw new ErrorHttp(401, 'Falta la llave: usa tu URL personal del MCP (/mcp/<token>) o la cabecera Authorization: Bearer con tu llave de factura-hn.');
    }
    return llave;
  }

  /** Comprueba la llave contra la API antes de abrir una sesión: así el conector falla al agregarlo, no después. */
  async function validarLlave(llave: string): Promise<void> {
    try {
      await crearCliente({ url: urlApi, llave, fetch: o.fetch }).sesion();
    } catch (e) {
      if (e instanceof ErrorFacturaHN && (e.estado === 401 || e.estado === 403)) {
        throw new ErrorHttp(401, `La API no acepta esta llave o esta URL del MCP (${e.codigo}): ${e.message}`);
      }
      if (e instanceof ErrorFacturaHN && (e.estado === 429 || e.estado === 503)) {
        throw new ErrorHttp(e.estado, `La API no atiende por ahora (${e.codigo}): ${e.message}`, -32000, { 'retry-after': '30' });
      }
      throw new ErrorHttp(502, 'No se pudo conectar con la API de factura-hn. Reintenta en unos segundos.');
    }
  }

  async function nuevaSesion(llave: string, huella: string): Promise<StreamableHTTPServerTransport> {
    // A lo sumo `porLlave` sesiones por llave: la más vieja se cierra (los clientes reabren sesión seguido).
    const deLaLlave = [...sesiones.entries()].filter(([, s]) => s.huella === huella).sort((a, b) => a[1].ultimoUso - b[1].ultimoUso);
    for (const [id] of deLaLlave.slice(0, Math.max(0, deLaLlave.length - porLlave + 1))) await cerrarSesion(id);
    if (sesiones.size >= maxSesiones) {
      throw new ErrorHttp(503, 'El servidor MCP tiene demasiadas sesiones abiertas. Reintenta en unos minutos.', -32000, { 'retry-after': '60' });
    }
    const backend = new BackendApi({ url: urlApi, llave, establecimiento: o.establecimiento ?? '000', puntoEmision: o.puntoEmision ?? '001', fetch: o.fetch });
    const servidor = crearServidorMCP(backend, { maxResultado: o.maxResultado ?? 64 * 1024 });
    const transporte: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      eventStore: new EventosEnMemoria(),
      maxRequestBodySize: maxCuerpo,
      onsessioninitialized: (id) => {
        sesiones.set(id, { transporte, huella, ultimoUso: Date.now() });
      },
      onsessionclosed: (id) => {
        sesiones.delete(id);
      },
    });
    transporte.onclose = () => {
      if (transporte.sessionId) sesiones.delete(transporte.sessionId);
    };
    await servidor.connect(transporte);
    return transporte;
  }

  async function atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ruta = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (ruta === '/salud' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, version: versionPaquete() ?? '0.0.0', sesiones: sesiones.size }));
      return;
    }
    if (ruta !== '/mcp' && !ruta.startsWith('/mcp/')) throw new ErrorHttp(404, 'Ruta no encontrada.');
    const espera = porIp.tomar(ipDelCliente(req, o.proxiesDeConfianza, o.cabeceraIpCliente));
    if (espera) throw new ErrorHttp(429, 'Demasiadas solicitudes desde tu dirección. Espera y reintenta.', -32000, { 'retry-after': String(espera) });
    // Protección contra DNS rebinding: un navegador manda Origin; solo los orígenes conocidos.
    const origen = req.headers.origin;
    if (origen !== undefined && !origenes.has(origen)) throw new ErrorHttp(403, 'Origen no permitido.');
    if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
      throw new ErrorHttp(405, 'Método no permitido: usa POST, GET o DELETE.', -32000, { allow: 'POST, GET, DELETE' });
    }

    const llave = llaveDe(req, ruta);
    const huella = createHash('sha256').update(llave).digest('hex');
    const esperaLlave = porLlaveMinuto.tomar(huella);
    if (esperaLlave) throw new ErrorHttp(429, 'Demasiadas solicitudes con esta llave. Espera y reintenta.', -32000, { 'retry-after': String(esperaLlave) });

    const idSesion = req.headers['mcp-session-id'];
    const cuerpoTexto = req.method === 'POST' ? await leerCuerpo(req, maxCuerpo) : undefined;
    let cuerpo: unknown;
    if (cuerpoTexto !== undefined) {
      try {
        cuerpo = JSON.parse(cuerpoTexto);
      } catch {
        throw new ErrorHttp(400, 'El cuerpo no es JSON válido.', -32700);
      }
    }

    if (typeof idSesion === 'string' && idSesion) {
      const s = sesiones.get(idSesion);
      // Sesión inexistente, vencida o de otra llave: 404, y el cliente abre una nueva (especificación MCP).
      if (!s || s.huella !== huella) throw new ErrorHttp(404, 'La sesión no existe o venció. Inicia una nueva.', -32001);
      s.ultimoUso = Date.now();
      await s.transporte.handleRequest(req, res, cuerpo);
      return;
    }
    if (req.method !== 'POST' || !(Array.isArray(cuerpo) ? cuerpo.some(isInitializeRequest) : isInitializeRequest(cuerpo))) {
      throw new ErrorHttp(400, 'Falta la cabecera Mcp-Session-Id: inicia la sesión con initialize.');
    }
    await validarLlave(llave);
    const transporte = await nuevaSesion(llave, huella);
    await transporte.handleRequest(req, res, cuerpo);
  }

  return {
    async manejar(req, res) {
      try {
        await atender(req, res);
      } catch (e) {
        if (e instanceof ErrorHttp) responderError(res, e.estado, e.message, e.codigo, e.cabeceras);
        else {
          registrar('MCP remoto: error interno', e);
          responderError(res, 500, 'Error interno del servidor MCP.', -32603);
        }
      }
    },
    sesiones: () => sesiones.size,
    async cerrar() {
      clearInterval(barrido);
      await Promise.all([...sesiones.keys()].map(cerrarSesion));
    },
  };
}

/** Arranca el servidor HTTP del MCP remoto. Devuelve su dirección y cómo cerrarlo. */
export async function servirMcpHttp(o: OpcionesMcpHttp & { puerto?: number; host?: string }): Promise<{ url: string; servidor: Server; cerrar: () => Promise<void> }> {
  const m = crearManejadorMcpHttp(o);
  const servidor = createServer((req, res) => void m.manejar(req, res));
  // Un cliente lento no retiene la conexión para siempre; los flujos SSE llevan su propio latido (cada 15 s).
  servidor.headersTimeout = 30_000;
  servidor.requestTimeout = 0;
  await new Promise<void>((r) => servidor.listen(o.puerto ?? 8788, o.host ?? '0.0.0.0', r));
  const dir = servidor.address();
  const puerto = typeof dir === 'object' && dir ? dir.port : o.puerto;
  return {
    url: `http://${o.host && o.host !== '0.0.0.0' ? o.host : '127.0.0.1'}:${puerto}`,
    servidor,
    async cerrar() {
      await m.cerrar();
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}

/** Lee la configuración del MCP remoto de las variables de entorno (ver el README). */
export function opcionesMcpHttpDesdeEntorno(env: NodeJS.ProcessEnv): OpcionesMcpHttp & { puerto: number; host: string } {
  if (!env.FHN_API_URL) throw new Error('Falta FHN_API_URL: la URL de la API de factura-hn a la que llama el MCP remoto.');
  const entero = (nombre: string, defecto: number, min: number, max: number) => {
    const t = env[nombre]?.trim();
    if (!t) return defecto;
    if (!/^\d{1,9}$/.test(t) || Number(t) < min || Number(t) > max) throw new Error(`${nombre} debe ser un número entero entre ${min} y ${max} (no "${t}").`);
    return Number(t);
  };
  const proxiesTexto = (env.FHN_PROXIES_DE_CONFIANZA ?? '').trim();
  let proxies: number | string[] = 0;
  if (/^\d{1,2}$/.test(proxiesTexto)) proxies = Number(proxiesTexto);
  else if (proxiesTexto) {
    proxies = proxiesTexto.split(',').map((s) => s.trim()).filter(Boolean);
    if (proxies.some((p) => isIP(p.replace(/^\[|\]$/g, '')) === 0)) {
      throw new Error(`FHN_PROXIES_DE_CONFIANZA debe ser un número de proxies o una lista de direcciones IP (no "${proxiesTexto}").`);
    }
  }
  const cabecera = env.FHN_IP_CLIENTE_CABECERA?.trim().toLowerCase() || undefined;
  if (cabecera && !/^[a-z0-9-]{1,64}$/.test(cabecera)) throw new Error('FHN_IP_CLIENTE_CABECERA debe ser el nombre de una cabecera, p. ej. Fly-Client-IP.');
  const origenes = env.FHN_MCP_ORIGENES?.trim() ? env.FHN_MCP_ORIGENES.split(',').map((s) => s.trim()).filter(Boolean) : [...ORIGENES_MCP_POR_DEFECTO];
  if (origenes.some((x) => x === '*' || !/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(x))) {
    throw new Error('FHN_MCP_ORIGENES: cada origen va como https://sitio.ejemplo, sin ruta ni «*».');
  }
  return {
    urlApi: env.FHN_API_URL,
    puerto: entero('FHN_MCP_PUERTO', entero('PORT', 8788, 1, 65535), 1, 65535),
    host: env.FHN_MCP_HOST?.trim() || '0.0.0.0',
    establecimiento: env.FHN_ESTABLECIMIENTO || '000',
    puntoEmision: env.FHN_PUNTO || '001',
    proxiesDeConfianza: proxies,
    cabeceraIpCliente: cabecera,
    origenes,
    maxSesiones: entero('FHN_MCP_MAX_SESIONES', 100, 1, 100_000),
    sesionesPorLlave: entero('FHN_MCP_SESIONES_POR_LLAVE', 3, 1, 100),
    sesionInactivaMs: entero('FHN_MCP_SESION_INACTIVA_MIN', 15, 1, 24 * 60) * 60_000,
    solicitudesPorMinutoIp: entero('FHN_MCP_SOLICITUDES_POR_MINUTO_IP', 60, 1, 100_000),
    solicitudesPorMinutoLlave: entero('FHN_MCP_SOLICITUDES_POR_MINUTO', 60, 1, 100_000),
    maxCuerpo: entero('FHN_MCP_MAX_CUERPO', 64 * 1024, 1024, 4 * 1024 * 1024),
    maxResultado: entero('FHN_MCP_MAX_RESULTADO', 64 * 1024, 4 * 1024, 4 * 1024 * 1024),
    permitirBearer: env.FHN_MCP_SOLO_URL !== '1',
  };
}
