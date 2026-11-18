/**
 * Llaves de API: `fhn_<prefijo>_<secreto>`.
 * - `prefijo`: 12 hexadecimales, público; identifica la llave en listados y en la bitácora.
 * - `secreto`: 32 bytes aleatorios (base64url). Solo se muestra al crearla.
 * En la base se guarda el SHA-256 de la llave completa (DEC-026): con 256 bits de entropía no hace falta un
 * hash lento, y la comparación es en tiempo constante.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type RolLlave = 'caja' | 'admin';

const FORMATO = /^fhn_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export function hashLlave(llave: string): Buffer {
  return createHash('sha256').update(llave, 'utf8').digest();
}

export function generarLlave(): { llave: string; prefijo: string; hash: Buffer } {
  const prefijo = randomBytes(6).toString('hex');
  const llave = `fhn_${prefijo}_${randomBytes(32).toString('base64url')}`;
  return { llave, prefijo, hash: hashLlave(llave) };
}

/** Prefijo de una llave bien formada, o null. No dice nada sobre si es válida. */
export function prefijoDe(llave: string): string | null {
  return FORMATO.exec(llave)?.[1] ?? null;
}

export function coincide(llave: string, hashGuardado: Buffer): boolean {
  const h = hashLlave(llave);
  return h.length === hashGuardado.length && timingSafeEqual(h, hashGuardado);
}
