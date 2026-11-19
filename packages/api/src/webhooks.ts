/**
 * Webhooks firmados con HMAC-SHA256 y reintentos (bandeja de salida `api_entregas`).
 *
 * Cada evento se encola **dentro de la transacción** de la operación que lo origina: si la emisión se
 * revierte, no sale ningún aviso; si se confirma, el aviso sale aunque la API se reinicie.
 *
 * Cabeceras de cada entrega:
 * - `X-FacturaHN-Evento`: `documento.emitido`, `documento.anulado`, `autorizacion.por_vencer`, `autorizacion.agotada`
 * - `X-FacturaHN-Entrega`: id de la entrega (el mismo en cada reintento; úsalo para descartar duplicados)
 * - `X-FacturaHN-Firma`: `t=<segundos unix>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>`
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type pg from 'pg';
import { AlmacenPostgres, esTransaccionPostgres, type TransaccionPostgres } from '@factura-hn/postgres';

export const EVENTOS_WEBHOOK = ['documento.emitido', 'documento.anulado', 'autorizacion.por_vencer', 'autorizacion.agotada'] as const;
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number];

/** 12 intentos: entre el primero y el último pasan unas 14 h y media (cubre un receptor caído una noche). */
export const MAX_INTENTOS = 12;
/** Espera antes del intento n (n ≥ 1): 30 s, 1 min, 2 min, … hasta 6 h. */
export function esperaReintento(intentos: number): number {
  return Math.min(30 * 2 ** (intentos - 1), 6 * 3600) * 1000;
}

export function firmar(secreto: string, cuerpo: string, t: number): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * Verifica la cabecera `X-FacturaHN-Firma` en el receptor. Usa el cuerpo **crudo** (los bytes recibidos,
 * antes de parsear el JSON). Rechaza firmas con más de `toleranciaSegundos` de antigüedad (repetición).
 */
export function verificarFirmaWebhook(
  cuerpo: string,
  cabecera: string | null | undefined,
  secreto: string,
  opciones: { toleranciaSegundos?: number; ahora?: () => number } = {},
): boolean {
  if (!cabecera) return false;
  const partes = new Map(cabecera.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(partes.get('t'));
  const v1 = partes.get('v1');
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const ahora = Math.floor((opciones.ahora ?? Date.now)() / 1000);
  if (Math.abs(ahora - t) > (opciones.toleranciaSegundos ?? 300)) return false;
  const esperado = Buffer.from(firmar(secreto, cuerpo, t).slice(-64), 'hex');
  return timingSafeEqual(esperado, Buffer.from(v1, 'hex'));
}

// --- Secretos en reposo -------------------------------------------------------------------------------

/**
 * Cifra el secreto de un webhook con AES-256-GCM si hay clave maestra (`FHN_CLAVE_CIFRADO`, 32 bytes en
 * base64). Sin clave se guarda con el prefijo `plano:` (aceptable en la instalación local).
 */
export class CofreSecretos {
  private readonly clave: Buffer | null;
  constructor(claveBase64?: string | null) {
    if (!claveBase64) {
      this.clave = null;
      return;
    }
    const clave = Buffer.from(claveBase64, 'base64');
    if (clave.length !== 32) throw new Error('FHN_CLAVE_CIFRADO debe ser de 32 bytes en base64.');
    this.clave = clave;
  }
  get cifra(): boolean {
    return this.clave !== null;
  }
  guardar(secreto: string): string {
    if (!this.clave) return `plano:${secreto}`;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.clave, iv);
    const datos = Buffer.concat([c.update(secreto, 'utf8'), c.final()]);
    return `gcm:${Buffer.concat([iv, c.getAuthTag(), datos]).toString('base64')}`;
  }
  leer(guardado: string): string {
    if (guardado.startsWith('plano:')) return guardado.slice(6);
    if (!guardado.startsWith('gcm:') || !this.clave) throw new Error('Secreto de webhook cifrado sin FHN_CLAVE_CIFRADO.');
    const b = Buffer.from(guardado.slice(4), 'base64');
    const d = createDecipheriv('aes-256-gcm', this.clave, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }
}

// --- Destinos (SSRF) ------------------------------------------------------------------------------------

/** Expande una IPv6 a 8 grupos de 16 bits (admite `::` y una IPv4 al final). */
function gruposIPv6(ip: string): number[] | null {
  let x = ip.toLowerCase().split('%')[0]!;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(x);
  if (v4) {
    const o = v4[1]!.split('.').map(Number);
    x = x.slice(0, -v4[1]!.length) + `${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const [izq, der] = x.split('::') as [string, string | undefined];
  const a = izq ? izq.split(':') : [];
  const b = der !== undefined && der ? der.split(':') : [];
  const relleno = der === undefined ? 0 : 8 - a.length - b.length;
  const g = [...a, ...Array(relleno).fill('0'), ...b].map((h) => parseInt(h, 16));
  return g.length === 8 && g.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? g : null;
}

/**
 * true si la IP no es unicast pública: privadas, loopback, enlace local, CGNAT, pruebas (198.18/15),
 * multicast, reservadas, y en IPv6 además ULA, site-local, NAT64, 6to4, Teredo, documentación y las que
 * llevan una IPv4 adentro (::ffff:, ::a.b.c.d). Ante la duda, se bloquea.
 */
export function esIPPrivada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const g = gruposIPv6(ip);
    if (!g) return true;
    const ceros5 = g.slice(0, 5).every((n) => n === 0);
    if (ceros5 && (g[5] === 0xffff || g[5] === 0)) {
      if (g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // :: y ::1
      return esIPPrivada(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`);
    }
    const p = g[0]!;
    return (p & 0xfe00) === 0xfc00 || (p & 0xffc0) === 0xfe80 || (p & 0xffc0) === 0xfec0 || (p & 0xff00) === 0xff00 ||
      (p === 0x64 && g[1] === 0xff9b) || p === 0x2002 || (p === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) ||
      (p === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) || (p & 0xe000) !== 0x2000;
  }
  return true;
}

/**
 * Valida la URL de un webhook. En modo alojado: solo https y sin destinos internos (SSRF). En modo local
 * se permite http y la red del negocio (el POS suele estar en la misma LAN).
 */
export function problemaDeURL(url: string, permitirRedInterna: boolean): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'URL inválida.';
  }
  if (u.username || u.password) return 'La URL no puede llevar usuario ni contraseña.';
  if (permitirRedInterna) return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'Solo http o https.';
  if (u.protocol !== 'https:') return 'En el modo alojado los webhooks deben usar https.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return 'El destino no puede ser una dirección interna.';
  }
  if (isIP(host) && esIPPrivada(host)) return 'El destino no puede ser una dirección interna.';
  return null;
}

/**
 * `lookup` para la conexión: resuelve el nombre y rechaza si alguna dirección es interna. La conexión usa la
 * misma dirección que se validó, así que un DNS que cambia de respuesta (rebinding) no la puede desviar.
 */
function lookupSeguro(host: string, opciones: object, cb: (e: Error | null, dir: string | { address: string; family: number }[], fam?: number) => void) {
  dnsLookup(host, { ...opciones, all: true }, (e, dirs) => {
    if (e) return cb(e, '', 0);
    const lista = dirs as { address: string; family: number }[];
    if (!lista.length || lista.some((d) => esIPPrivada(d.address))) return cb(new Error('El nombre resuelve a una dirección interna.'), '', 0);
    if ((opciones as { all?: boolean }).all) return cb(null, lista);
    cb(null, lista[0]!.address, lista[0]!.family);
  });
}

/**
 * POST sin seguir redirecciones; en modo alojado, conectando solo a direcciones públicas validadas.
 * `tiempoMaximo` es el tope de TODA la entrega (conexión, envío y cabeceras de la respuesta), no de inactividad:
 * un receptor que responde byte a byte no la alarga. El cuerpo de la respuesta no se lee.
 */
function enviarHttp(url: string, cabeceras: Record<string, string>, cuerpo: string, tiempoMaximo: number, permitirRedInterna: boolean): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method: 'POST',
        headers: { ...cabeceras, 'content-length': Buffer.byteLength(cuerpo) },
        timeout: tiempoMaximo,
        ...(permitirRedInterna ? {} : { lookup: lookupSeguro as never }),
      },
      (res) => {
        clearTimeout(tope);
        res.destroy();
        resolver(res.statusCode ?? 0);
      },
    );
    const agotado = () => req.destroy(Object.assign(new Error('Tiempo agotado'), { name: 'TimeoutError' }));
    const tope = setTimeout(agotado, tiempoMaximo);
    req.on('timeout', agotado);
    req.on('error', (e) => {
      clearTimeout(tope);
      rechazar(e);
    });
    req.end(cuerpo);
  });
}

// --- Encolar ----------------------------------------------------------------------------------------------

/** Encola un evento para cada webhook activo del tenant suscrito a él. Corre dentro de la transacción. */
export async function encolarEvento(tx: TransaccionPostgres, evento: EventoWebhook, clave: string, datos: unknown, instante: Date): Promise<void> {
  const cuerpo = { evento, creado: instante.toISOString(), datos };
  await tx.consulta(
    `INSERT INTO api_entregas (tenant, webhook_id, evento, clave, cuerpo)
     SELECT tenant, id, $2, $3, $4::jsonb FROM api_webhooks WHERE tenant = $1 AND activo AND $2 = ANY(eventos)
     ON CONFLICT (webhook_id, clave) DO NOTHING`,
    [tx.tenant, evento, clave, JSON.stringify(cuerpo)],
  );
}

export function comoTransaccionPostgres(tx: unknown): TransaccionPostgres {
  if (!esTransaccionPostgres(tx as never)) throw new Error('La API requiere el almacén de Postgres.');
  return tx as TransaccionPostgres;
}

// --- Despachar --------------------------------------------------------------------------------------------

export interface OpcionesDespacho {
  pool: pg.Pool;
  rol: string;
  cofre: CofreSecretos;
  permitirRedInterna: boolean;
  /** Solo para pruebas: reemplaza el envío HTTP (sin la protección de direcciones al conectar). */
  fetch?: typeof fetch;
  /** Milisegundos por entrega. */
  tiempoMaximo?: number;
  lote?: number;
  /** Entregas simultáneas por tenant. */
  paralelas?: number;
  ahora?: () => Date;
  /**
   * Tenants con un despacho en curso. Si se pasa, se omiten y se marcan mientras se atienden: el servidor llama
   * cada pocos segundos sin esperar a la pasada anterior, y un receptor lento solo retrasa a su propio tenant.
   */
  enCurso?: Set<string>;
}

interface Reclamada { id: string; evento: string; cuerpo: unknown; intentos: number; url: string; secreto: string }

/**
 * Entrega los avisos pendientes cuyo momento llegó. Cada entrega se **reclama** en una transacción corta
 * (`FOR UPDATE SKIP LOCKED` y `proximo` adelantado como arrendamiento), el HTTP corre fuera de la
 * transacción y el resultado se registra después: un receptor lento no retiene conexiones ni candados, y
 * los tenants se atienden en paralelo. Varias réplicas pueden correrlo a la vez. Devuelve cuántas intentó.
 */
export async function despacharWebhooks(o: OpcionesDespacho): Promise<number> {
  const base = new AlmacenPostgres(o.pool, { rol: o.rol });
  const ahora = o.ahora ?? (() => new Date());
  const tenants = await base.transaccion(async (tx) =>
    (await comoTransaccionPostgres(tx).consulta<{ t: string }>('SELECT fhn_api_tenants_con_pendientes() AS t')).rows.map((f) => f.t),
  );
  const libres = o.enCurso ? tenants.filter((t) => !o.enCurso!.has(t)) : tenants;
  for (const t of libres) o.enCurso?.add(t);
  const porTenant = await Promise.all(
    libres.map(async (tenant) => {
      try {
        return await despacharTenant(o, base, tenant, ahora);
      } finally {
        o.enCurso?.delete(tenant);
      }
    }),
  );
  return porTenant.reduce((a, b) => a + b, 0);
}

async function despacharTenant(o: OpcionesDespacho, base: AlmacenPostgres, tenant: string, ahora: () => Date): Promise<number> {
  const almacen = base.paraTenant(tenant);
  const reclamadas = await almacen.transaccion(async (t) => {
    const tx = comoTransaccionPostgres(t);
    // Lo pendiente de un webhook desactivado ya no se entrega.
    await tx.consulta(
      `UPDATE api_entregas e SET estado = 'FALLIDA', ultimo_error = 'Webhook desactivado'
         FROM api_webhooks w WHERE w.id = e.webhook_id AND e.tenant = $1 AND e.estado = 'PENDIENTE' AND NOT w.activo`,
      [tenant],
    );
    const r = await tx.consulta<Reclamada>(
      `SELECT e.id, e.evento, e.cuerpo, e.intentos, w.url, w.secreto
         FROM api_entregas e JOIN api_webhooks w ON w.id = e.webhook_id
        WHERE e.tenant = $1 AND e.estado = 'PENDIENTE' AND e.proximo <= now() AND w.activo
        ORDER BY e.id LIMIT $2 FOR UPDATE OF e SKIP LOCKED`,
      [tenant, o.lote ?? 20],
    );
    if (r.rows.length) {
      await tx.consulta("UPDATE api_entregas SET proximo = now() + interval '5 minutes' WHERE id = ANY($1::bigint[])", [r.rows.map((e) => e.id)]);
    }
    return r.rows;
  });
  const resultados: { e: Reclamada; ok: boolean; codigo: number | null; error: string | null }[] = [];
  const cola = [...reclamadas];
  await Promise.all(
    Array.from({ length: Math.min(o.paralelas ?? 4, cola.length) }, async () => {
      for (let e = cola.shift(); e; e = cola.shift()) resultados.push({ e, ...(await entregar(o, e)) });
    }),
  );
  if (resultados.length) {
    await almacen.transaccion(async (t) => {
      const tx = comoTransaccionPostgres(t);
      for (const { e, ok, codigo, error } of resultados) {
        const intentos = e.intentos + 1;
        const estado = ok ? 'ENTREGADA' : intentos >= MAX_INTENTOS ? 'FALLIDA' : 'PENDIENTE';
        await tx.consulta(
          'UPDATE api_entregas SET estado = $2, intentos = $3, proximo = $4, ultimo_codigo = $5, ultimo_error = $6 WHERE id = $1',
          [e.id, estado, intentos, new Date(ahora().getTime() + esperaReintento(intentos)), codigo, error],
        );
      }
    });
  }
  return resultados.length;
}

async function entregar(o: OpcionesDespacho, e: Reclamada): Promise<{ ok: boolean; codigo: number | null; error: string | null }> {
  const problema = problemaDeURL(e.url, o.permitirRedInterna);
  if (problema) return { ok: false, codigo: null, error: problema };
  const cuerpo = JSON.stringify({ id: e.id, ...(e.cuerpo as object) });
  const t = Math.floor((o.ahora ?? (() => new Date()))().getTime() / 1000);
  const cabeceras = {
    'content-type': 'application/json',
    'user-agent': 'factura-hn-webhooks/0.2',
    'x-facturahn-evento': e.evento,
    'x-facturahn-entrega': e.id,
    'x-facturahn-firma': firmar(o.cofre.leer(e.secreto), cuerpo, t),
  };
  const tiempo = o.tiempoMaximo ?? 10_000;
  try {
    let estado: number;
    if (o.fetch) {
      const resp = await o.fetch(e.url, { method: 'POST', headers: cabeceras, body: cuerpo, redirect: 'manual', signal: AbortSignal.timeout(tiempo) });
      await resp.body?.cancel().catch(() => undefined);
      estado = resp.status;
    } else {
      estado = await enviarHttp(e.url, cabeceras, cuerpo, tiempo, o.permitirRedInterna);
    }
    return estado >= 200 && estado < 300 ? { ok: true, codigo: estado, error: null } : { ok: false, codigo: estado, error: `HTTP ${estado}` };
  } catch (err) {
    const m = (err as Error).message;
    return { ok: false, codigo: null, error: (err as Error).name === 'TimeoutError' ? 'Tiempo agotado' : /interna/.test(m) ? m : 'Error de red' };
  }
}
