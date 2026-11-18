/**
 * Conversión de montos a letras en español (Art. 11: importe total en número y letras).
 * Formato: "MIL DOSCIENTOS TREINTA Y CUATRO LEMPIRAS CON 50/100".
 */
import { aCentavos } from './dinero';
import type { Moneda } from './tipos';

const UNIDADES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

function menorQueMil(n: number): string {
  if (n === 0) return '';
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
  return texto.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
}

/** Convierte un entero no negativo a palabras en mayúsculas. */
export function enteroALetras(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`Se esperaba un entero no negativo: ${n}`);
  if (n === 0) return 'CERO';
  if (n >= 1e15) throw new RangeError('Monto demasiado grande para convertir a letras');

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];

  if (millones > 0) {
    partes.push(millones === 1 ? 'UN MILLÓN' : `${apocopar(enteroALetras(millones))} MILLONES`);
  }
  if (miles > 0) {
    partes.push(miles === 1 ? 'MIL' : `${apocopar(menorQueMil(miles))} MIL`);
  }
  if (resto > 0) partes.push(menorQueMil(resto));
  return partes.join(' ');
}

const NOMBRE_MONEDA: Record<Moneda, { singular: string; plural: string }> = {
  HNL: { singular: 'LEMPIRA', plural: 'LEMPIRAS' },
  USD: { singular: 'DÓLAR', plural: 'DÓLARES' },
};

/**
 * Monto a letras con centavos en fracción /100.
 * @example montoEnLetras(1234.5) // "MIL DOSCIENTOS TREINTA Y CUATRO LEMPIRAS CON 50/100"
 */
export function montoEnLetras(monto: number, moneda: Moneda = 'HNL'): string {
  const centavos = aCentavos(monto);
  if (centavos < 0) throw new RangeError('El monto no puede ser negativo');
  const enteros = Math.floor(centavos / 100);
  const fraccion = (centavos % 100).toString().padStart(2, '0');
  const nombre = NOMBRE_MONEDA[moneda];
  const palabras = enteros === 0 ? 'CERO' : apocopar(enteroALetras(enteros));
  // "UN MILLÓN DE LEMPIRAS", "DOS MILLONES DE LEMPIRAS"
  const conDe = /MILLÓN$|MILLONES$/.test(palabras) ? ' DE' : '';
  const sustantivo = enteros === 1 ? nombre.singular : nombre.plural;
  return `${palabras}${conDe} ${sustantivo} CON ${fraccion}/100`;
}
