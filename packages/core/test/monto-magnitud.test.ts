/**
 * Un monto en notación científica con exponente enorme («1e10000000», 10 caracteres) no debe llegar a
 * `10n ** exp`: bloquearía el proceso varios segundos. Se rechaza rápido con ErrorMonto (422 en la API).
 */
import { describe, expect, it } from 'vitest';
import { ErrorMonto, parsearDecimal } from '../src';

describe('magnitud de montos', () => {
  it('rechaza exponentes enormes sin calcular la potencia', () => {
    for (const v of ['1e10000000', '1e1000000', '1e31', '1e-31', '1e2000000000', '1e99999999999999999999']) {
      const t = performance.now();
      expect(() => parsearDecimal(v, 4)).toThrow(ErrorMonto);
      expect(performance.now() - t).toBeLessThan(50);
    }
  });

  it('rechaza montos con demasiados dígitos', () => {
    expect(() => parsearDecimal('1'.repeat(41), 2)).toThrow(ErrorMonto);
  });

  it('sigue aceptando notación científica razonable y montos normales', () => {
    expect(parsearDecimal('1e2', 2)).toBe(10000n);
    expect(parsearDecimal('1.5e3', 2)).toBe(150000n);
    expect(parsearDecimal('1e-2', 2)).toBe(1n);
    expect(parsearDecimal('1e30', 0)).toBe(10n ** 30n);
    expect(parsearDecimal(1e21, 0)).toBe(10n ** 21n);
    expect(parsearDecimal('1,234,567.89', 2)).toBe(123456789n);
  });
});
