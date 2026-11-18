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
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type pg from 'pg';
import { AlmacenPostgres, esTransaccionPostgres, type TransaccionPostgres } from '@factura-hn/postgres';

export const EVENTOS_WEBHOOK = ['documento.emitido', 'documento.anulado', 'autorizacion.por_vencer', 'autorizacion.agotada'] as const;
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number];

export const MAX_INTENTOS = 8;
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

function esIPPrivada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return esIPPrivada(x.slice(7));
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') ||
      x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
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

/** Al entregar se resuelve el nombre otra vez: un DNS que apunta a la red interna se rechaza. */
async function destinoPermitido(url: string, permitirRedInterna: boolean): Promise<string | null> {
  const p = problemaDeURL(url, permitirRedInterna);
  if (p || permitirRedInterna) return p;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return null;
  try {
    const ips = await lookup(host, { all: true });
    return ips.some((d) => esIPPrivada(d.address)) ? 'El nombre resuelve a una dirección interna.' : null;
  } catch {
    return 'No se pudo resolver el nombre del destino.';
  }
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
  fetch?: typeof fetch;
  /** Milisegundos por entrega. */
  tiempoMaximo?: number;
  lote?: number;
  ahora?: () => Date;
}

/**
 * Entrega los avisos pendientes cuyo momento llegó. Varias réplicas pueden correrlo a la vez: cada
 * entrega se toma con `FOR UPDATE SKIP LOCKED`. Devuelve cuántas entregas intentó.
 */
export async function despacharWebhooks(o: OpcionesDespacho): Promise<number> {
  const base = new AlmacenPostgres(o.pool, { rol: o.rol });
  const tenants = await base.transaccion(async (tx) =>
    (await comoTransaccionPostgres(tx).consulta<{ t: string }>('SELECT fhn_api_tenants_con_pendientes() AS t')).rows.map((f) => f.t),
  );
  let intentadas = 0;
  for (const tenant of tenants) {
    intentadas += await base.paraTenant(tenant).transaccion(async (t) => {
      const tx = comoTransaccionPostgres(t);
      const r = await tx.consulta<{ id: string; evento: string; cuerpo: unknown; intentos: number; url: string; secreto: string }>(
        `SELECT e.id, e.evento, e.cuerpo, e.intentos, w.url, w.secreto
           FROM api_entregas e JOIN api_webhooks w ON w.id = e.webhook_id
          WHERE e.tenant = $1 AND e.estado = 'PENDIENTE' AND e.proximo <= now()
          ORDER BY e.id LIMIT $2 FOR UPDATE OF e SKIP LOCKED`,
        [tenant, o.lote ?? 20],
      );
      for (const e of r.rows) {
        const resultado = await entregar(o, e);
        const intentos = e.intentos + 1;
        const estado = resultado.ok ? 'ENTREGADA' : intentos >= MAX_INTENTOS ? 'FALLIDA' : 'PENDIENTE';
        const proximo = new Date((o.ahora ?? (() => new Date()))().getTime() + esperaReintento(intentos));
        await tx.consulta(
          'UPDATE api_entregas SET estado = $2, intentos = $3, proximo = $4, ultimo_codigo = $5, ultimo_error = $6 WHERE id = $1',
          [e.id, estado, intentos, proximo, resultado.codigo, resultado.error],
        );
      }
      return r.rows.length;
    });
  }
  return intentadas;
}

async function entregar(
  o: OpcionesDespacho,
  e: { id: string; evento: string; cuerpo: unknown; url: string; secreto: string },
): Promise<{ ok: boolean; codigo: number | null; error: string | null }> {
  const problema = await destinoPermitido(e.url, o.permitirRedInterna);
  if (problema) return { ok: false, codigo: null, error: problema };
  const cuerpo = JSON.stringify({ id: e.id, ...(e.cuerpo as object) });
  const t = Math.floor((o.ahora ?? (() => new Date()))().getTime() / 1000);
  try {
    const resp = await (o.fetch ?? fetch)(e.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'factura-hn-webhooks/0.2',
        'x-facturahn-evento': e.evento,
        'x-facturahn-entrega': e.id,
        'x-facturahn-firma': firmar(o.cofre.leer(e.secreto), cuerpo, t),
      },
      body: cuerpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(o.tiempoMaximo ?? 10_000),
    });
    await resp.body?.cancel().catch(() => undefined);
    return resp.status >= 200 && resp.status < 300
      ? { ok: true, codigo: resp.status, error: null }
      : { ok: false, codigo: resp.status, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, codigo: null, error: (err as Error).name === 'TimeoutError' ? 'Tiempo agotado' : 'Error de red' };
  }
}
