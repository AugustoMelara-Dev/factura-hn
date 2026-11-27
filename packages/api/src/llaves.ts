/**
 * Llaves de API. Tres formas:
 * - `fhn_live_<prefijo>_<secreto>`: llave nueva de un tenant de producción;
 * - `fhn_test_<prefijo>_<secreto>`: llave nueva de un tenant de prueba (sandbox);
 * - `fhn_<prefijo>_<secreto>`: llave sin marca de modo, de antes de que existieran las dos anteriores. Sigue
 *   valiendo en su tenant, sea cual sea el modo de ese tenant.
 *
 * - `prefijo`: 12 hexadecimales, público; identifica la llave en listados, en la bitácora y en `DELETE /v1/llaves/{prefijo}`.
 * - `secreto`: 32 bytes aleatorios (base64url). Solo se muestra al crearla.
 * En la base se guarda el SHA-256 de la llave completa: con 256 bits de entropía no hace falta un
 * hash lento, y la comparación es en tiempo constante. El hash cubre también la marca `live` o `test`: cambiarla
 * da otra llave, que no existe.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type RolLlave = 'caja' | 'admin';
/** Modo de un tenant: `prueba` (sandbox, solo CAI ficticios) o `produccion`. */
export type ModoTenant = 'prueba' | 'produccion';

const FORMATO = /^fhn_(?:(live|test)_)?([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export function hashLlave(llave: string): Buffer {
  return createHash('sha256').update(llave, 'utf8').digest();
}

/** Marca de la llave según el modo de su tenant: `test` para uno de prueba, `live` para uno de producción. */
export const marcaDeModo = (modo: ModoTenant): 'test' | 'live' => (modo === 'prueba' ? 'test' : 'live');

/** Llave nueva para un tenant del modo indicado: `fhn_test_…` (prueba) o `fhn_live_…` (producción). */
export function generarLlave(modo: ModoTenant): { llave: string; prefijo: string; hash: Buffer } {
  const prefijo = randomBytes(6).toString('hex');
  const llave = `fhn_${marcaDeModo(modo)}_${prefijo}_${randomBytes(32).toString('base64url')}`;
  return { llave, prefijo, hash: hashLlave(llave) };
}

/**
 * Prefijo y modo de una llave bien formada, o null. No dice nada sobre si es válida. `modo` es null en una llave
 * sin marca (`fhn_<prefijo>_…`).
 */
export function leerLlave(llave: string): { prefijo: string; modo: ModoTenant | null } | null {
  const m = FORMATO.exec(llave);
  if (!m) return null;
  return { prefijo: m[2]!, modo: m[1] === 'test' ? 'prueba' : m[1] === 'live' ? 'produccion' : null };
}

/** Prefijo de una llave bien formada (de cualquiera de las tres formas), o null. No dice nada sobre si es válida. */
export function prefijoDe(llave: string): string | null {
  return leerLlave(llave)?.prefijo ?? null;
}

export function coincide(llave: string, hashGuardado: Buffer): boolean {
  const h = hashLlave(llave);
  return h.length === hashGuardado.length && timingSafeEqual(h, hashGuardado);
}

/**
 * Token del MCP remoto: `fhnmcp_<test|live>_<prefijo>_<secreto>`. Va en la ruta de la URL del MCP
 * (`https://…/mcp/<token>`), porque un conector personalizado de Claude se agrega solo con la URL. No es una llave
 * de API: el servidor MCP deriva de él la llave `fhn_<marca>_<prefijo>_<HMAC-SHA256(secreto, ETIQUETA)>`, una llave
 * normal del tenant (con su fila en `api_llaves` y su hash). Así la base no guarda nada con que reconstruir el
 * token, y revocar esa llave (`DELETE /v1/llaves/{prefijo}`) apaga el token sin tocar las demás llaves.
 */
const FORMATO_TOKEN_MCP = /^fhnmcp_(live|test)_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const ETIQUETA_TOKEN_MCP = 'factura-hn/mcp/llave/v1';

/** La llave de API que corresponde a un token del MCP remoto, o null si el token no tiene la forma. */
export function llaveDeTokenMcp(token: string): string | null {
  const m = FORMATO_TOKEN_MCP.exec(token);
  if (!m) return null;
  const derivado = createHmac('sha256', m[3]!).update(ETIQUETA_TOKEN_MCP).digest('base64url');
  return `fhn_${m[1]}_${m[2]}_${derivado}`;
}

/** Token nuevo del MCP remoto para un tenant del modo indicado, con la llave que deriva (su hash va a `api_llaves`). */
export function generarTokenMcp(modo: ModoTenant): { token: string; llave: string; prefijo: string; hash: Buffer } {
  const prefijo = randomBytes(6).toString('hex');
  const token = `fhnmcp_${marcaDeModo(modo)}_${prefijo}_${randomBytes(32).toString('base64url')}`;
  const llave = llaveDeTokenMcp(token)!;
  return { token, llave, prefijo, hash: hashLlave(llave) };
}
