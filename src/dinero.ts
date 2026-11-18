/**
 * Aritmética monetaria en centavos enteros para evitar errores de punto flotante.
 * Redondeo: mitad hacia arriba (lejos de cero), a 2 decimales.
 */

/** Redondea un número a entero, mitad lejos de cero, tolerando ruido de punto flotante. */
export function redondearEntero(x: number): number {
  const signo = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  // Corrige casos como 1.005*100 = 100.49999999999999
  return signo * Math.round(abs + abs * Number.EPSILON * 4);
}

export function aCentavos(monto: number): number {
  if (!Number.isFinite(monto)) throw new RangeError(`Monto inválido: ${monto}`);
  return redondearEntero(monto * 100);
}

export function deCentavos(centavos: number): number {
  return centavos / 100;
}

/** Redondea un monto a 2 decimales. */
export function redondear2(monto: number): number {
  return deCentavos(aCentavos(monto));
}

/** Formatea un monto como "1,234.56". */
export function formatearMonto(monto: number): string {
  const centavos = aCentavos(monto);
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const enteros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = (abs % 100).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${enteros}.${dec}`;
}

/** Formatea con símbolo: "L 1,234.56" o "$ 1,234.56". */
export function formatearMoneda(monto: number, moneda: 'HNL' | 'USD' = 'HNL'): string {
  return `${moneda === 'HNL' ? 'L' : '$'} ${formatearMonto(monto)}`;
}
