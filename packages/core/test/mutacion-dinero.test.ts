// Pruebas que matan mutantes de dinero.ts (pnpm mutacion, docs/calidad/mutacion.md).
// Lectura exacta de montos (texto o number), separador de miles, topes de magnitud, signos y la regla de
// redondeo del Art. 9 de la Ley del ISV (mitad lejos de cero) en cada combinación de signos.
import { describe, expect, it } from 'vitest';
import {
  aCentavos,
  centavosATexto,
  deCentavos,
  dividirRedondeando,
  ErrorMonto,
  escaladoATexto,
  formatearMoneda,
  formatearMonto,
  parsearDecimal,
  redondear2,
  redondearDecimal,
  textoSeguroCSV,
} from '../src/dinero';

/** El error que lanza `fn`, para revisar su clase, nombre y mensaje. */
function errorDe(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('no lanzó');
}

describe('ErrorMonto', () => {
  it('es un RangeError con nombre propio', () => {
    const e = errorDe(() => parsearDecimal('abc', 2));
    expect(e).toBeInstanceOf(ErrorMonto);
    expect(e).toBeInstanceOf(RangeError);
    expect(e.name).toBe('ErrorMonto');
    expect(e.message).toBe('Monto inválido: "abc"');
  });
});

describe('lectura del texto decimal', () => {
  it('el patrón va anclado: nada antes ni después del número', () => {
    expect(() => parsearDecimal('x1', 2)).toThrow(ErrorMonto);
    expect(() => parsearDecimal('1x', 2)).toThrow(ErrorMonto);
    expect(() => parsearDecimal('1.5.5', 2)).toThrow(ErrorMonto);
  });
  it('recorta espacios del texto y acepta «.5» y «5.», pero no «», «.» ni «-»', () => {
    expect(parsearDecimal(' 1.5 ', 2)).toBe(150n);
    expect(parsearDecimal('.5', 2)).toBe(50n);
    expect(parsearDecimal('5.', 2)).toBe(500n);
    expect(parsearDecimal('+5', 2)).toBe(500n);
    for (const malo of ['', '   ', '.', '-', '+.']) {
      const e = errorDe(() => parsearDecimal(malo, 2));
      expect(e).toBeInstanceOf(ErrorMonto);
      expect(e.message).toBe(`Monto inválido: "${malo}"`);
    }
  });
  it('un number no finito o un tipo que no es number ni string es ErrorMonto, no TypeError', () => {
    expect(errorDe(() => parsearDecimal(Number.POSITIVE_INFINITY, 2)).message).toBe('Monto inválido: Infinity');
    expect(errorDe(() => parsearDecimal(Number.NaN, 2)).message).toBe('Monto inválido: NaN');
    for (const raro of [null, undefined, {}, true, 10n]) {
      const e = errorDe(() => parsearDecimal(raro as never, 2));
      expect(e).toBeInstanceOf(ErrorMonto);
      expect(e.message).toBe(`Monto inválido: ${String(raro)}`);
    }
  });
  it('notación científica dentro del tope de exponente (±30)', () => {
    expect(parsearDecimal('1e2', 2)).toBe(10000n);
    expect(parsearDecimal('15E-1', 2)).toBe(150n);
    expect(parsearDecimal('1e30', 0)).toBe(10n ** 30n);
    expect(errorDe(() => parsearDecimal('1e31', 0)).message).toBe('Monto fuera de rango: "1e31"');
    expect(() => parsearDecimal('1e-31', 40)).toThrow('Monto fuera de rango');
  });
  it('hasta 40 dígitos en total (enteros + decimales); 41 es fuera de rango', () => {
    expect(parsearDecimal('9'.repeat(40), 0)).toBe(10n ** 40n - 1n);
    expect(parsearDecimal(`${'1'.repeat(20)}.${'0'.repeat(20)}`, 2)).toBe(BigInt('1'.repeat(20)) * 100n);
    expect(() => parsearDecimal('9'.repeat(41), 0)).toThrow(new ErrorMonto(`Monto fuera de rango: "${'9'.repeat(41)}"`));
    expect(() => parsearDecimal(`${'1'.repeat(20)}.${'0'.repeat(21)}`, 2)).toThrow('Monto fuera de rango');
  });
});

describe('separador de miles', () => {
  it('acepta grupos de 3 con o sin decimales, signo y exponente', () => {
    expect(parsearDecimal('1,234', 2)).toBe(123400n);
    expect(parsearDecimal('12,345', 2)).toBe(1234500n);
    expect(parsearDecimal('1,234,567.5', 2)).toBe(123456750n);
    expect(parsearDecimal('+1,234', 2)).toBe(123400n);
    expect(parsearDecimal('-1,234.5', 2)).toBe(-123450n);
    expect(parsearDecimal('1,234e2', 0)).toBe(123400n);
    expect(parsearDecimal('1,234E+1', 0)).toBe(12340n);
    expect(parsearDecimal('1,234e-2', 2)).toBe(1234n);
    expect(parsearDecimal('1,000e10', 0)).toBe(10n ** 13n);
  });
  it('rechaza la coma decimal y los grupos mal formados, con un mensaje que lo explica', () => {
    for (const malo of ['89,50', '1234,567', 'x1,234', '1,234x', '1,23', ',123']) {
      const e = errorDe(() => parsearDecimal(malo, 2));
      expect(e).toBeInstanceOf(ErrorMonto);
      expect(e.message).toBe(
        `Monto inválido: "${malo}". La coma solo separa miles en grupos de 3 (1,234.50); el separador decimal es el punto (89.50).`,
      );
    }
  });
});

describe('parsearDecimal: escala sin redondear', () => {
  it('ceros sobrantes a la derecha se aceptan; un decimal significativo de más se rechaza', () => {
    expect(parsearDecimal('1.230', 2)).toBe(123n);
    expect(parsearDecimal('-1.5', 2)).toBe(-150n);
    expect(parsearDecimal('-1.500', 2)).toBe(-150n);
    expect(parsearDecimal('7', 0)).toBe(7n);
    expect(errorDe(() => parsearDecimal('1.234', 2)).message).toBe('monto admite como máximo 2 decimales: "1.234"');
    expect(errorDe(() => parsearDecimal('1.234', 2, 'El precio')).message).toBe('El precio admite como máximo 2 decimales: "1.234"');
    expect(() => parsearDecimal(0.1 + 0.2, 2)).toThrow(ErrorMonto);
  });
});

describe('dividirRedondeando: Art. 9, mitad lejos de cero', () => {
  it('con cada combinación de signos', () => {
    expect(dividirRedondeando(5n, 2n)).toBe(3n);
    expect(dividirRedondeando(-5n, 2n)).toBe(-3n);
    expect(dividirRedondeando(5n, -2n)).toBe(-3n);
    expect(dividirRedondeando(-5n, -2n)).toBe(3n);
    expect(dividirRedondeando(4n, 3n)).toBe(1n);
    expect(dividirRedondeando(-4n, 3n)).toBe(-1n);
    expect(dividirRedondeando(-7n, 3n)).toBe(-2n);
    expect(dividirRedondeando(0n, 7n)).toBe(0n);
  });
  it('por cero es ErrorMonto', () => {
    expect(() => dividirRedondeando(1n, 0n)).toThrow(new ErrorMonto('División por cero'));
  });
});

describe('redondearDecimal, aCentavos y redondear2', () => {
  it('redondea sobre el texto decimal exacto', () => {
    expect(redondearDecimal('1.005', 2)).toBe(101n);
    expect(redondearDecimal('1.004', 2)).toBe(100n);
    expect(redondearDecimal('-1.005', 2)).toBe(-101n);
    expect(redondearDecimal('2', 2)).toBe(200n);
    expect(aCentavos(1.005)).toBe(101);
    expect(aCentavos('-0.015')).toBe(-2);
    expect(redondear2('2.675')).toBe(2.68);
    expect(redondear2(-2.675)).toBe(-2.68);
  });
});

describe('salida', () => {
  it('deCentavos y centavosATexto', () => {
    expect(deCentavos(12345n)).toBe(123.45);
    expect(deCentavos(-5)).toBe(-0.05);
    expect(centavosATexto(123456n)).toBe('1234.56');
    expect(centavosATexto(-5)).toBe('-0.05');
    expect(centavosATexto(0)).toBe('0.00');
  });
  it('formatearMonto con separador de miles en todos los grupos y signo', () => {
    expect(formatearMonto('1234567.891')).toBe('1,234,567.89');
    expect(formatearMonto(-1234.5)).toBe('-1,234.50');
    expect(formatearMonto('-0.5')).toBe('-0.50');
    expect(formatearMonto(999)).toBe('999.00');
    expect(formatearMonto('1000000')).toBe('1,000,000.00');
  });
  it('formatearMoneda: L por defecto, $ para USD', () => {
    expect(formatearMoneda('1234.5')).toBe('L 1,234.50');
    expect(formatearMoneda('1234.5', 'HNL')).toBe('L 1,234.50');
    expect(formatearMoneda(-3, 'USD')).toBe('$ -3.00');
  });
  it('escaladoATexto quita solo los ceros finales y conserva los del medio', () => {
    expect(escaladoATexto(15000n, 4)).toBe('1.5');
    expect(escaladoATexto(10500n, 4)).toBe('1.05');
    expect(escaladoATexto(5n, 4)).toBe('0.0005');
    expect(escaladoATexto(-15000n, 4)).toBe('-1.5');
    expect(escaladoATexto(20000n, 4)).toBe('2');
    expect(escaladoATexto(0n, 4)).toBe('0');
    expect(escaladoATexto(1000100n, 6)).toBe('1.0001');
  });
  it('textoSeguroCSV antepone apóstrofo a lo que una hoja tomaría por fórmula', () => {
    for (const s of ['=1+1', '+1', '-1', '@x', '\tx', '\rx']) expect(textoSeguroCSV(s)).toBe(`'${s}`);
    expect(textoSeguroCSV('Arroz =1')).toBe('Arroz =1');
  });
});
