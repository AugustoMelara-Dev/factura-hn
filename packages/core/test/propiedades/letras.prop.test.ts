/**
 * Propiedades de los montos en letras (src/letras.ts). Reglamento Art. 11 num. 1 k (y Arts. 26 num. 5 y 28 num. 5
 * en las notas): el importe total va en números y en letras. El formato («… LEMPIRAS CON 50/100») es el del
 * SDK; las propiedades comprueban que las letras dicen el mismo número, no fijan una redacción nueva.
 */
import { describe, expect, it } from 'vitest';
import { centavosEnLetras, enteroALetras, montoEnLetras, centavosATexto } from '../../src';
import { fc, TIEMPO } from './config';

const VALORES: Record<string, number> = {
  UN: 1, UNO: 1, DOS: 2, TRES: 3, CUATRO: 4, CINCO: 5, SEIS: 6, SIETE: 7, OCHO: 8, NUEVE: 9, DIEZ: 10, ONCE: 11,
  DOCE: 12, TRECE: 13, CATORCE: 14, QUINCE: 15, 'DIECISÉIS': 16, DIECISIETE: 17, DIECIOCHO: 18, DIECINUEVE: 19,
  VEINTE: 20, VEINTIUNO: 21, 'VEINTIÚN': 21, 'VEINTIDÓS': 22, 'VEINTITRÉS': 23, VEINTICUATRO: 24, VEINTICINCO: 25,
  'VEINTISÉIS': 26, VEINTISIETE: 27, VEINTIOCHO: 28, VEINTINUEVE: 29, TREINTA: 30, CUARENTA: 40, CINCUENTA: 50,
  SESENTA: 60, SETENTA: 70, OCHENTA: 80, NOVENTA: 90, CIEN: 100, CIENTO: 100, DOSCIENTOS: 200, TRESCIENTOS: 300,
  CUATROCIENTOS: 400, QUINIENTOS: 500, SEISCIENTOS: 600, SETECIENTOS: 700, OCHOCIENTOS: 800, NOVECIENTOS: 900,
};

/** Lector independiente: palabras → número. Lanza si encuentra una palabra que no conoce. */
function leer(texto: string): number {
  if (texto === 'CERO') return 0;
  let total = 0;
  let miles = 0;
  let actual = 0;
  for (const p of texto.split(' ')) {
    if (p === 'Y') continue;
    if (p === 'MIL') {
      miles += (actual || 1) * 1000;
      actual = 0;
    } else if (p === 'BILLÓN' || p === 'BILLONES') {
      total += (miles + actual) * 1e12;
      miles = 0;
      actual = 0;
    } else if (p === 'MILLÓN' || p === 'MILLONES') {
      total += (miles + actual) * 1_000_000;
      miles = 0;
      actual = 0;
    } else if (p in VALORES) actual += VALORES[p]!;
    else throw new Error(`palabra desconocida: ${p}`);
  }
  return total + miles + actual;
}

const entero = fc.oneof(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1e15 - 1 }));

describe('letras: las palabras dicen el número', () => {
  it('enteroALetras(n) se lee de vuelta como n, de 0 a 10^15 − 1', () => {
    fc.assert(fc.property(entero, (n) => leer(enteroALetras(n)) === n));
  }, TIEMPO);

  it('enteroALetras es inyectiva: dos números distintos nunca se escriben igual', () => {
    fc.assert(fc.property(entero, entero, (a, b) => a === b || enteroALetras(a) !== enteroALetras(b)));
  }, TIEMPO);

  it('sin espacios dobles ni sobrantes, y «UNO» nunca antes de MIL, MILLONES o la moneda (apócope)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 17n - 1n }), fc.constantFrom('HNL' as const, 'USD' as const), (c, moneda) => {
        const t = centavosEnLetras(c, moneda);
        expect(t).toBe(t.trim());
        expect(t).not.toMatch(/ {2}/);
        expect(t).not.toMatch(/UNO (MIL|MILL|BILL|LEMPIRA|DÓLAR)/);
        expect(t).not.toMatch(/MILL(ÓN|ONES) MILL/);
      }),
    );
  }, TIEMPO);

  it('centavosEnLetras: «<letras> [DE] LEMPIRA(S) CON cc/100», con los enteros y los centavos del monto', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 17n - 1n }), fc.constantFrom('HNL' as const, 'USD' as const), (c, moneda) => {
        const t = centavosEnLetras(c, moneda);
        const m = /^(.+?)( DE)? (LEMPIRAS?|DÓLAR(?:ES)?) CON (\d{2})\/100$/.exec(t);
        expect(m, t).not.toBeNull();
        const enteros = Number(c / 100n);
        expect(leer(m![1]!)).toBe(enteros);
        expect(m![4]).toBe((c % 100n).toString().padStart(2, '0'));
        // Singular solo con 1; «DE» solo tras MILLÓN, MILLONES, BILLÓN o BILLONES.
        expect(m![3]).toBe(moneda === 'HNL' ? (enteros === 1 ? 'LEMPIRA' : 'LEMPIRAS') : enteros === 1 ? 'DÓLAR' : 'DÓLARES');
        expect(Boolean(m![2])).toBe(/(MILL|BILL)(ÓN|ONES)$/.test(m![1]!));
      }),
    );
  }, TIEMPO);

  it('montoEnLetras(texto) = centavosEnLetras(centavos): el mismo monto escrito de otra forma no cambia las letras', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 10n ** 17n - 1n }), (c) => montoEnLetras(centavosATexto(c)) === centavosEnLetras(c)));
  }, TIEMPO);

  it('negativos o desde 10^15 lempiras se rechazan con RangeError, no con letras equivocadas', () => {
    fc.assert(
      fc.property(fc.oneof(fc.bigInt({ min: -(10n ** 20n), max: -1n }), fc.bigInt({ min: 10n ** 17n, max: 10n ** 20n })), (c) => {
        expect(() => centavosEnLetras(c)).toThrow(RangeError);
      }),
    );
  }, TIEMPO);
});
