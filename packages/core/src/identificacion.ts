/**
 * Validaciones de formato de RTN, DNI y CAI.
 * Solo se valida el formato; la existencia y vigencia se consultan en el SAR / RNP.
 */

/** Quita guiones y espacios. */
export function limpiarIdentificador(valor: string): string {
  return valor.replace(/[\s-]/g, '');
}

/** RTN: 14 dígitos. */
export function esRTNValido(rtn: string): boolean {
  return /^\d{14}$/.test(limpiarIdentificador(rtn));
}

/** DNI hondureño: 13 dígitos (DDMM-AAAA-NNNNN). */
export function esDNIValido(dni: string): boolean {
  return /^\d{13}$/.test(limpiarIdentificador(dni));
}

/** RTN como "0801-1999-123456" (4-4-6). */
export function formatearRTN(rtn: string): string {
  const l = limpiarIdentificador(rtn);
  if (!/^\d{14}$/.test(l)) return rtn;
  return `${l.slice(0, 4)}-${l.slice(4, 8)}-${l.slice(8)}`;
}

/** DNI como "0801-1999-12345" (4-4-5). */
export function formatearDNI(dni: string): string {
  const l = limpiarIdentificador(dni);
  if (!/^\d{13}$/.test(l)) return dni;
  return `${l.slice(0, 4)}-${l.slice(4, 8)}-${l.slice(8)}`;
}

/**
 * Forma observada de los CAI: 32 caracteres hexadecimales en grupos 6-6-6-6-6-2 separados por guiones,
 * p. ej. "A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4". **No tiene fuente normativa** (B-09: el Reglamento define
 * el CAI en el Art. 4, C L.235-237, sin fijar su formato); solo se exige con `caiEstricto: true`.
 */
export const PATRON_CAI = /^[0-9A-F]{6}(-[0-9A-F]{6}){4}-[0-9A-F]{2}$/;

export function normalizarCAI(cai: string): string {
  return cai.trim().toUpperCase();
}

/**
 * Forma mínima por defecto (DEC-013): solo letras, dígitos y guiones, después de recortar los espacios del
 * inicio y del final (`normalizarCAI`). Un espacio u otro carácter en medio es error.
 */
export const PATRON_CAI_BASICO = /^[0-9A-Z-]+$/;

export function esCAIValido(cai: string): boolean {
  return PATRON_CAI.test(normalizarCAI(cai));
}
