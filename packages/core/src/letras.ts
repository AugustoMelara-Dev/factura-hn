/**
 * Conversión de montos a letras en español (Art. 11: importe total en número y letras).
 * Formato: "MIL DOSCIENTOS TREINTA Y CUATRO LEMPIRAS CON 50/100".
 */
import { redondearDecimal, type Monto } from './dinero';
import type { Moneda } from './tipos';

const UNIDADES = [
  // Stryker disable next-line StringLiteral: mutante equivalente, el índice 0 nunca se lee (menorQueMil solo lo pide con r > 0 o u > 0).
  '',
  'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const DECENAS = [
  // Stryker disable next-line StringLiteral: mutantes equivalentes, las decenas 0 a 2 nunca se leen (r < 30 usa UNIDADES).
  '', '', '',
  'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
];
const CENTENAS = [
  // Stryker disable next-line StringLiteral: mutante equivalente, el índice 0 nunca se lee (solo se pide con c > 0).
  '',
  'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

/** De 1 a 999 (quien llama ya descarta el 0). */
function menorQueMil(n: number): string {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]!);
  if (r > 0) {
    if (r < 30) partes.push(UNIDADES[r]!);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u === 0 ? DECENAS[d]! : `${DECENAS[d]} Y ${UNIDADES[u]}`);
    }
  }
  return partes.join(' ');
}

/** "UNO" → "UN" al final cuando precede a un sustantivo (mil, millones, lempiras). */
function apocopar(texto: string): string {
  // Quitar el ancla $ es un mutante equivalente: cada bloque que no es el último ya sale apocopado (VEINTIÚN MIL,
  // UN MILLÓN), así que VEINTIUNO y UNO solo pueden aparecer al final del texto.
  // Stryker disable next-line Regex: equivalente (ver arriba)
  return texto.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
}

/** Convierte un entero no negativo a palabras en mayúsculas. */
export function enteroALetras(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`Se esperaba un entero no negativo: ${n}`);
  if (n === 0) return 'CERO';
  if (n >= 1e15) throw new RangeError('Monto demasiado grande para convertir a letras');

  // Escala larga del español: un billón es un millón de millones (10^12). Antes, de 10^12 en adelante salía
  // «UN MILLÓN MILLONES» (lo encontraron las pruebas de mutación).
  const billones = Math.floor(n / 1_000_000_000_000);
  const millones = Math.floor((n % 1_000_000_000_000) / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (billones > 0) {
    partes.push(billones === 1 ? 'UN BILLÓN' : `${apocopar(menorQueMil(billones))} BILLONES`);
  }
  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLÓN' : `${apocopar(enteroALetras(millones))} MILLONES`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${apocopar(menorQueMil(miles))} MIL`);
  }
  if (resto > 0) partes.push(menorQueMil(resto));
  return partes.join(' ');
}

/** Monedas que el SDK sabe escribir en letras (y en las que se emite). */
export const MONEDAS: readonly Moneda[] = ['HNL', 'USD'];

const NOMBRE_MONEDA: Record<Moneda, { singular: string; plural: string }> = {
  HNL: { singular: 'LEMPIRA', plural: 'LEMPIRAS' },
  USD: { singular: 'DÓLAR', plural: 'DÓLARES' },
};

/**
 * Monto a letras con centavos en fracción /100.
 * @example montoEnLetras(1234.5) // "MIL DOSCIENTOS TREINTA Y CUATRO LEMPIRAS CON 50/100"
 */
export function montoEnLetras(monto: Monto, moneda: Moneda = 'HNL'): string {
  return centavosEnLetras(redondearDecimal(monto, 2), moneda);
}

/** Igual que `montoEnLetras`, a partir de centavos exactos. */
export function centavosEnLetras(centavos: bigint, moneda: Moneda = 'HNL'): string {
  if (centavos < 0n) throw new RangeError('El monto no puede ser negativo');
  const enteros = Number(centavos / 100n);
  const fraccion = (centavos % 100n).toString().padStart(2, '0');
  if (!Object.prototype.hasOwnProperty.call(NOMBRE_MONEDA, moneda)) {
    throw new RangeError(`Moneda no soportada: ${JSON.stringify(moneda) ?? String(moneda)}. Usa 'HNL' o 'USD'.`);
  }
  const nombre = NOMBRE_MONEDA[moneda];
  const palabras = apocopar(enteroALetras(enteros)); // 0 → «CERO»
  // "UN MILLÓN DE LEMPIRAS", "DOS MILLONES DE LEMPIRAS", "UN BILLÓN DE LEMPIRAS"
  const conDe = /(?:MILLÓN|MILLONES|BILLÓN|BILLONES)$/.test(palabras) ? ' DE' : '';
  const sustantivo = enteros === 1 ? nombre.singular : nombre.plural;
  return `${palabras}${conDe} ${sustantivo} CON ${fraccion}/100`;
}
