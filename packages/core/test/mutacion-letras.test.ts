// Pruebas que matan mutantes de letras.ts (pnpm mutacion, docs/calidad/mutacion.md).
// Reglamento Art. 11: el importe total va en número y en letras. Se recorre cada palabra de las tablas, los
// casos especiales (CIEN, UN/VEINTIÚN delante de un sustantivo, «DE» tras MILLÓN) y los límites de entrada.
import { describe, expect, it } from 'vitest';
import { centavosEnLetras, enteroALetras, montoEnLetras } from '../src/letras';

const DEL_1_AL_29 = [
  'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
  'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE',
  'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const DECENAS: Array<[number, string]> = [
  [30, 'TREINTA'], [40, 'CUARENTA'], [50, 'CINCUENTA'], [60, 'SESENTA'], [70, 'SETENTA'], [80, 'OCHENTA'], [90, 'NOVENTA'],
];
const CENTENAS: Array<[number, string]> = [
  [200, 'DOSCIENTOS'], [300, 'TRESCIENTOS'], [400, 'CUATROCIENTOS'], [500, 'QUINIENTOS'],
  [600, 'SEISCIENTOS'], [700, 'SETECIENTOS'], [800, 'OCHOCIENTOS'], [900, 'NOVECIENTOS'],
];

describe('enteroALetras: cada palabra de las tablas', () => {
  it('del 1 al 29', () => {
    DEL_1_AL_29.forEach((palabra, i) => expect(enteroALetras(i + 1)).toBe(palabra));
  });
  it('decenas exactas y con unidades', () => {
    for (const [n, palabra] of DECENAS) {
      expect(enteroALetras(n)).toBe(palabra);
      expect(enteroALetras(n + 7)).toBe(`${palabra} Y SIETE`);
    }
  });
  it('CIEN solo, CIENTO con algo más, y las demás centenas', () => {
    expect(enteroALetras(100)).toBe('CIEN');
    expect(enteroALetras(101)).toBe('CIENTO UNO');
    expect(enteroALetras(199)).toBe('CIENTO NOVENTA Y NUEVE');
    for (const [n, palabra] of CENTENAS) {
      expect(enteroALetras(n)).toBe(palabra);
      expect(enteroALetras(n + 15)).toBe(`${palabra} QUINCE`);
    }
  });
  it('miles y millones con apócope (UN, VEINTIÚN)', () => {
    expect(enteroALetras(1000)).toBe('MIL');
    expect(enteroALetras(1001)).toBe('MIL UNO');
    expect(enteroALetras(21_000)).toBe('VEINTIÚN MIL');
    expect(enteroALetras(31_000)).toBe('TREINTA Y UN MIL');
    expect(enteroALetras(100_000)).toBe('CIEN MIL');
    expect(enteroALetras(1_000_000)).toBe('UN MILLÓN');
    expect(enteroALetras(2_000_000)).toBe('DOS MILLONES');
    expect(enteroALetras(21_000_000)).toBe('VEINTIÚN MILLONES');
    expect(enteroALetras(1_234_567)).toBe('UN MILLÓN DOSCIENTOS TREINTA Y CUATRO MIL QUINIENTOS SESENTA Y SIETE');
  });
  it('cero, y los límites: entero no negativo menor que 10^15', () => {
    expect(enteroALetras(0)).toBe('CERO');
    expect(enteroALetras(999_999_999_999_999)).toMatch(/^NOVECIENTOS NOVENTA Y NUEVE BILLONES /);
    expect(() => enteroALetras(1e15)).toThrow(new RangeError('Monto demasiado grande para convertir a letras'));
    expect(() => enteroALetras(-1)).toThrow(new RangeError('Se esperaba un entero no negativo: -1'));
    expect(() => enteroALetras(1.5)).toThrow(new RangeError('Se esperaba un entero no negativo: 1.5'));
  });
});

describe('montoEnLetras y centavosEnLetras', () => {
  it('singular y plural de la moneda, y la fracción en /100', () => {
    expect(montoEnLetras('1')).toBe('UN LEMPIRA CON 00/100');
    expect(montoEnLetras('2.05')).toBe('DOS LEMPIRAS CON 05/100');
    expect(montoEnLetras('0.5')).toBe('CERO LEMPIRAS CON 50/100');
    expect(montoEnLetras('21', 'USD')).toBe('VEINTIÚN DÓLARES CON 00/100');
    expect(montoEnLetras('1', 'USD')).toBe('UN DÓLAR CON 00/100');
  });
  it('«DE» solo cuando el número termina en MILLÓN o MILLONES', () => {
    expect(montoEnLetras('1000000')).toBe('UN MILLÓN DE LEMPIRAS CON 00/100');
    expect(montoEnLetras('3000000')).toBe('TRES MILLONES DE LEMPIRAS CON 00/100');
    expect(montoEnLetras('1000001')).toBe('UN MILLÓN UN LEMPIRAS CON 00/100');
    expect(montoEnLetras('2000300')).toBe('DOS MILLONES TRESCIENTOS LEMPIRAS CON 00/100');
  });
  it('rechaza un monto negativo', () => {
    expect(() => centavosEnLetras(-1n)).toThrow(new RangeError('El monto no puede ser negativo'));
    expect(centavosEnLetras(0n)).toBe('CERO LEMPIRAS CON 00/100');
  });
});

describe('billones (escala larga: 10^12 es un billón)', () => {
  it('no repite MILLONES: un millón de millones es UN BILLÓN', () => {
    expect(enteroALetras(1_000_000_000_000)).toBe('UN BILLÓN');
    expect(enteroALetras(2_000_000_000_000)).toBe('DOS BILLONES');
    expect(enteroALetras(21_000_000_000_000)).toBe('VEINTIÚN BILLONES');
    expect(enteroALetras(1_000_000_000)).toBe('MIL MILLONES');
    expect(enteroALetras(1_001_000_000_000)).toBe('UN BILLÓN MIL MILLONES');
    expect(enteroALetras(1_000_001_000_000)).toBe('UN BILLÓN UN MILLÓN');
    expect(enteroALetras(999_999_999_999_999)).toBe(
      'NOVECIENTOS NOVENTA Y NUEVE BILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES ' +
        'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE',
    );
  });
  it('«DE» tras BILLÓN o BILLONES al final', () => {
    expect(montoEnLetras('1000000000000')).toBe('UN BILLÓN DE LEMPIRAS CON 00/100');
    expect(montoEnLetras('3,000,000,000,000.50')).toBe('TRES BILLONES DE LEMPIRAS CON 50/100');
    expect(montoEnLetras('1000000000001')).toBe('UN BILLÓN UN LEMPIRAS CON 00/100');
  });
});
