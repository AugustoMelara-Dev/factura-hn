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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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
