/**
 * Lo que encontraron las pruebas de propiedades y el fuzzing del Lote 5 en el núcleo, con su caso fijo.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularDocumento,
  centavosEnLetras,
  enteroALetras,
  ErrorCalculo,
  ErrorExportacion,
  leerExportacionJSONL,
  montoEnLetras,
  MONTO_MAXIMO_CENTAVOS,
  validarLineas,
} from '../src';

describe('letras: billones (escala larga)', () => {
  it('10^12 es «UN BILLÓN», no «UN MILLÓN MILLONES»', () => {
    expect(enteroALetras(1_000_000_000_000)).toBe('UN BILLÓN');
    expect(montoEnLetras('1000000000000')).toBe('UN BILLÓN DE LEMPIRAS CON 00/100');
  });

  it('billones con millones y miles', () => {
    expect(montoEnLetras('2500000000000.10')).toBe('DOS BILLONES QUINIENTOS MIL MILLONES DE LEMPIRAS CON 10/100');
    expect(enteroALetras(1_000_001_000_000)).toBe('UN BILLÓN UN MILLÓN');
    expect(enteroALetras(21_000_000_000_001)).toBe('VEINTIÚN BILLONES UNO');
    expect(centavosEnLetras(MONTO_MAXIMO_CENTAVOS)).toBe(
      'NUEVE BILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE LEMPIRAS CON 99/100',
    );
  });

  it('por debajo de 10^12 no cambia', () => {
    expect(enteroALetras(999_999_999_999)).toBe('NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE');
    expect(montoEnLetras(1_000_000)).toBe('UN MILLÓN DE LEMPIRAS CON 00/100');
  });
});

describe('cálculo: tope técnico del total (MONTO_FUERA_DE_RANGO)', () => {
  it('un total de más de L 9,999,999,999,999.99 es un problema de validación, no un RangeError a mitad de la emisión', () => {
    const linea = { descripcion: 'x', cantidad: '99999999999999999999', precioUnitario: '1000' };
    expect(validarLineas([linea]).map((p) => p.codigo)).toEqual(['MONTO_FUERA_DE_RANGO']);
    expect(() => calcularDocumento([linea])).toThrow(ErrorCalculo);
  });

  it('el tope cuenta el ISV más alto: L 8 billones gravados al 15 % caben; L 8.5 billones, no', () => {
    expect(validarLineas([{ descripcion: 'x', cantidad: 1, precioUnitario: '8000000000000' }])).toEqual([]);
    expect(calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: '8000000000000' }]).totales.total).toBe(9_200_000_000_000);
    expect(validarLineas([{ descripcion: 'x', cantidad: 1, precioUnitario: '8500000000000' }]).map((p) => p.codigo)).toEqual(['MONTO_FUERA_DE_RANGO']);
  });
});

describe('exportación jsonl: errores con su línea', () => {
  it('una línea que no es JSON lanza ErrorExportacion (que sigue siendo SyntaxError) con el número de línea', () => {
    let error: unknown;
    try {
      leerExportacionJSONL('{"numero":"000-001-01-00000001"}\n\n{roto');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorExportacion);
    expect(error).toBeInstanceOf(SyntaxError);
    expect((error as ErrorExportacion).linea).toBe(3);
  });

  it('una línea con JSON que no es un documento (número, null, lista) también', () => {
    for (const linea of ['5', 'null', '[]', '"texto"']) expect(() => leerExportacionJSONL(linea)).toThrow(ErrorExportacion);
    expect(leerExportacionJSONL('{"a":1}\r\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
