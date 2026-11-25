/**
 * Propiedades de la aritmética monetaria (src/dinero.ts): lectura exacta de decimales, redondeo del Art. 9 de la
 * Ley del ISV y conversión a texto. Ninguna propiedad agrega una regla: cada una dice lo que el código promete
 * en su comentario y, si es fiscal, cita el artículo.
 */
import { describe, expect, it } from 'vitest';
import {
  aCentavos,
  centavosATexto,
  deCentavos,
  dividirRedondeando,
  ErrorMonto,
  escaladoATexto,
  formatearMonto,
  MONTO_MAXIMO_CENTAVOS,
  parsearDecimal,
  redondearDecimal,
} from '../../src';
import { fc, TIEMPO } from './config';

/** Centavos de hasta L 10^13 (los totales en letras llegan a 10^15 − 1). */
const centavos = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const escala = fc.integer({ min: 0, max: 8 });

describe('dinero: lectura exacta', () => {
  it('centavos → texto → centavos devuelve el mismo entero (sin flotante, sin perder un centavo)', () => {
    fc.assert(fc.property(centavos, (c) => parsearDecimal(centavosATexto(c), 2) === c));
  }, TIEMPO);

  it('escaladoATexto y parsearDecimal son inversas en cualquier escala', () => {
    fc.assert(fc.property(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), escala, (v, e) => parsearDecimal(escaladoATexto(v, e), e) === v));
  }, TIEMPO);

  it('formatearMonto (con comas de miles) se vuelve a leer como el mismo monto', () => {
    fc.assert(fc.property(centavos, (c) => redondearDecimal(formatearMonto(centavosATexto(c)), 2) === c));
  }, TIEMPO);

  it('formatearMonto agrupa de 3 en 3 y siempre lleva 2 decimales', () => {
    fc.assert(fc.property(centavos, (c) => /^-?\d{1,3}(,\d{3})*\.\d{2}$/.test(formatearMonto(centavosATexto(c)))));
  }, TIEMPO);

  // Hasta MONTO_MAXIMO_CENTAVOS (15 cifras) un double guarda cualquier decimal de 2 posiciones: la salida en
  // `number` es exacta. Más arriba no (p. ej. −7066295701030826 centavos): por eso el cálculo tiene ese tope.
  const enDominio = fc.integer({ min: -Number(MONTO_MAXIMO_CENTAVOS), max: Number(MONTO_MAXIMO_CENTAVOS) });

  it('un number con hasta 2 decimales se lee exacto: aCentavos(c / 100) === c, hasta MONTO_MAXIMO_CENTAVOS', () => {
    // String(n) es la representación decimal más corta que vuelve al mismo double (dinero.ts).
    fc.assert(fc.property(enDominio, (c) => aCentavos(c / 100) === c));
  }, TIEMPO);

  it('deCentavos y aCentavos son inversas hasta MONTO_MAXIMO_CENTAVOS', () => {
    fc.assert(fc.property(enDominio, (c) => aCentavos(deCentavos(c)) === c));
  }, TIEMPO);

  it('parsearDecimal rechaza con ErrorMonto un texto con más decimales significativos que la escala', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 1, max: 9 }), escala, (v, extra, e) => {
        // v·10 + extra (1..9) tiene un decimal más que la escala `e`, distinto de 0.
        const texto = escaladoATexto(v * 10n + BigInt(extra), e + 1);
        expect(() => parsearDecimal(texto, e)).toThrow(ErrorMonto);
      }),
    );
  }, TIEMPO);

  it('los ceros a la derecha no cambian el valor ni cuentan como decimales', () => {
    fc.assert(fc.property(centavos, fc.integer({ min: 1, max: 10 }), (c, ceros) => parsearDecimal(centavosATexto(c) + '0'.repeat(ceros), 2) === c));
  }, TIEMPO);
});

describe('dinero: redondeo del Art. 9 de la Ley del ISV', () => {
  const noCero = fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }).filter((d) => d !== 0n);
  const numerador = fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n });

  it('el error del redondeo nunca pasa de medio: |q·d − n| ≤ |d| / 2', () => {
    fc.assert(
      fc.property(numerador, noCero, (n, d) => {
        const q = dividirRedondeando(n, d);
        const err = q * d - n;
        const abs = (x: bigint) => (x < 0n ? -x : x);
        return abs(err) * 2n <= abs(d);
      }),
    );
  }, TIEMPO);

  it('Art. 9: fracción < 0.005 baja, ≥ 0.005 sube (en valor absoluto, igual para negativos)', () => {
    // Milésimas → centavos: la fracción es el último dígito. 0-4 baja, 5-9 sube; en negativos, simétrico.
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.boolean(), (milesimas, negativo) => {
        const n = negativo ? -milesimas : milesimas;
        const q = dividirRedondeando(n, 10n);
        const esperado = milesimas / 10n + (milesimas % 10n >= 5n ? 1n : 0n);
        return q === (negativo ? -esperado : esperado);
      }),
    );
  }, TIEMPO);

  it('redondearDecimal sobre el texto: «x.xx5» sube y «x.xx4» baja, sin pasar por flotante', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 13n }), fc.integer({ min: 0, max: 9 }), (c, d) => {
        const texto = `${centavosATexto(c)}${d}`; // tres decimales
        return redondearDecimal(texto, 2) === c + (d >= 5 ? 1n : 0n);
      }),
    );
  }, TIEMPO);

  it('dividirRedondeando no depende del signo del denominador', () => {
    fc.assert(fc.property(numerador, noCero, (n, d) => dividirRedondeando(n, d) === dividirRedondeando(-n, -d)));
  }, TIEMPO);
});
