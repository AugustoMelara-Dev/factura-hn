/**
 * Numeración de documentos fiscales: NNN-NNN-NN-NNNNNNNN (16 dígitos).
 * - Establecimiento (3): casa matriz = 000
 * - Punto de emisión (3)
 * - Tipo de documento (2)
 * - Correlativo (8): 00000001 … 99999999
 */
import type { AutorizacionCAI, CodigoTipoDocumento } from './tipos';

export const TIPOS_DOCUMENTO: Record<CodigoTipoDocumento, string> = {
  '01': 'Factura',
  '02': 'Factura Prevalorada',
  '03': 'Ticket',
  '04': 'Recibo por Honorarios Profesionales',
  '05': 'Boleta de Compra',
  '06': 'Constancia de Donación',
  '07': 'Nota de Crédito',
  '08': 'Nota de Débito',
  '09': 'Guía de Remisión',
  '10': 'Comprobante de Retención',
};

export const CORRELATIVO_MAXIMO = 99_999_999;

export interface PartesNumero {
  establecimiento: string;
  puntoEmision: string;
  tipoDocumento: CodigoTipoDocumento;
  correlativo: number;
}

function codigo(valor: string | number, digitos: number, campo: string): string {
  const s = String(valor).trim();
  if (!/^\d+$/.test(s) || s.length > digitos) {
    throw new RangeError(`${campo} debe tener hasta ${digitos} dígitos numéricos: "${valor}"`);
  }
  return s.padStart(digitos, '0');
}

function validarCorrelativo(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > CORRELATIVO_MAXIMO) {
    throw new RangeError(`Correlativo fuera de 1..${CORRELATIVO_MAXIMO}: ${n}`);
  }
}

/** Arma el número de 16 dígitos con guiones. */
export function formatearNumero(partes: {
  establecimiento: string | number;
  puntoEmision: string | number;
  tipoDocumento: CodigoTipoDocumento;
  correlativo: number;
}): string {
  validarCorrelativo(partes.correlativo);
  if (!(partes.tipoDocumento in TIPOS_DOCUMENTO)) {
    throw new RangeError(`Tipo de documento desconocido: ${partes.tipoDocumento}`);
  }
  return [
    codigo(partes.establecimiento, 3, 'Establecimiento'),
    codigo(partes.puntoEmision, 3, 'Punto de emisión'),
    partes.tipoDocumento,
    String(partes.correlativo).padStart(8, '0'),
  ].join('-');
}

/** Interpreta un número con o sin guiones. Lanza error si no es válido. */
export function parsearNumero(numero: string): PartesNumero {
  const limpio = numero.replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(limpio)) {
    throw new RangeError(`El número de documento debe tener 16 dígitos: "${numero}"`);
  }
  const tipo = limpio.slice(6, 8) as CodigoTipoDocumento;
  if (!(tipo in TIPOS_DOCUMENTO)) throw new RangeError(`Tipo de documento desconocido: ${tipo}`);
  const correlativo = Number(limpio.slice(8));
  validarCorrelativo(correlativo);
  return {
    establecimiento: limpio.slice(0, 3),
    puntoEmision: limpio.slice(3, 6),
    tipoDocumento: tipo,
    correlativo,
  };
}

export function esNumeroValido(numero: string): boolean {
  try {
    parsearNumero(numero);
    return true;
  } catch {
    return false;
  }
}

/** Número completo para un correlativo dentro de una autorización. */
export function numeroDesdeAutorizacion(aut: AutorizacionCAI, correlativo: number): string {
  return formatearNumero({
    establecimiento: aut.establecimiento,
    puntoEmision: aut.puntoEmision,
    tipoDocumento: aut.tipoDocumento,
    correlativo,
  });
}

/** "000-001-01-00000001 al 000-001-01-00001000" */
export function formatearRango(aut: AutorizacionCAI): string {
  return `${numeroDesdeAutorizacion(aut, aut.rangoInicial)} al ${numeroDesdeAutorizacion(aut, aut.rangoFinal)}`;
}

/** ¿El número pertenece a esta autorización (mismo establecimiento, punto, tipo y dentro del rango)? */
export function perteneceAAutorizacion(numero: string, aut: AutorizacionCAI): boolean {
  let p: PartesNumero;
  try {
    p = parsearNumero(numero);
  } catch {
    return false;
  }
  return (
    p.establecimiento === codigo(aut.establecimiento, 3, 'Establecimiento') &&
    p.puntoEmision === codigo(aut.puntoEmision, 3, 'Punto de emisión') &&
    p.tipoDocumento === aut.tipoDocumento &&
    p.correlativo >= aut.rangoInicial &&
    p.correlativo <= aut.rangoFinal
  );
}
