/**
 * Lo que encontraron las pruebas de propiedades y el fuzzing en el núcleo, con su caso fijo.
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
  validarEntrada,
  validarLineas,
  type AutorizacionCAI,
  type DocumentoEntrada,
  type LineaEntrada,
} from '../src';
import { fechaHonduras } from '../src/autorizacion';

const AUTORIZACION: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2099-12-31',
};
const ENTRADA_BASE: DocumentoEntrada = {
  emisor: {
    rtn: '99990000000001', razonSocial: 'Exportadora Ejemplo S.A.', nombreComercial: 'Exportadora Ejemplo',
    direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
    telefono: '0000-0001', correo: 'ventas@ejemplo.example',
  },
  cliente: { nombre: 'Importadora Ejemplo', rtn: '99990000000002' },
  fechaEmision: fechaHonduras(),
  lineas: [],
};

describe('letras: billones (escala larga)', () => {
  it('10^12 es «UN BILLÓN», no «UN MILLÓN MILLONES»', () => {
    expect(enteroALetras(1_000_000_000_000)).toBe('UN BILLÓN');
    expect(montoEnLetras('1000000000000')).toBe('UN BILLÓN DE LEMPIRAS CON 00/100');
  });

  it('billones con millones y miles', () => {
    expect(montoEnLetras(`${2_500_000_000_000}.10`)).toBe('DOS BILLONES QUINIENTOS MIL MILLONES DE LEMPIRAS CON 10/100');
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

  it('el tope se mide con el ISV de cada grupo de tasa', () => {
    const linea = (precioUnitario: number | string, isv?: LineaEntrada['isv']): LineaEntrada => ({ descripcion: 'x', cantidad: 1, precioUnitario, ...(isv ? { isv } : {}) });
    const codigos = (ls: LineaEntrada[]) => validarLineas(ls).map((p) => p.codigo);
    // Al 15 %: L 8 billones caben (total 9.2); L 8.7 billones, no (10.005).
    expect(codigos([linea(8_000_000_000_000)])).toEqual([]);
    expect(calcularDocumento([linea(8_000_000_000_000)]).totales.total).toBe(9_200_000_000_000);
    expect(codigos([linea(8_700_000_000_000)])).toEqual(['MONTO_FUERA_DE_RANGO']);
    // Exento: cabe hasta el tope exacto (antes se rechazaba desde ~L 8.47 billones, como si fuera 18 %).
    expect(codigos([linea(`${9_999_999_999_999}.99`, 'EXENTO')])).toEqual([]);
    expect(codigos([linea(`${10_000_000_000_000}`, 'EXENTO')])).toEqual(['MONTO_FUERA_DE_RANGO']);
    // Al 18 %: L 8.4 billones caben (9.912); L 8.5 billones, no (10.03).
    expect(codigos([linea(8_400_000_000_000, 'ISV18')])).toEqual([]);
    expect(codigos([linea(8_500_000_000_000, 'ISV18')])).toEqual(['MONTO_FUERA_DE_RANGO']);
    // Mezcla: cada grupo con su tasa.
    expect(codigos([linea(5_000_000_000_000, 'EXENTO'), linea(4_000_000_000_000)])).toEqual([]); // 5 + 4.6
    expect(codigos([linea(5_000_000_000_000, 'EXENTO'), linea(4_500_000_000_000, 'ISV18')])).toEqual(['MONTO_FUERA_DE_RANGO']); // 5 + 5.31
  });

  it('en moneda extranjera, el total en lempiras también debe caber en el tope', () => {
    const entrada = (precioUnitario: string, tipoCambio: string): DocumentoEntrada => ({
      ...ENTRADA_BASE, moneda: 'USD', tipoCambio, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario }],
    });
    // L 1 billón × 1.15 × 24.123457 ≈ L 27.7 billones: el total en dólares cabe, el equivalente en lempiras no.
    const v = validarEntrada(entrada('1000000000000', '24.123457'), AUTORIZACION);
    expect(v.errores.map((e) => [e.codigo, e.campo])).toEqual([['MONTO_FUERA_DE_RANGO', 'tipoCambio']]);
    expect(validarEntrada(entrada('300000000000', '24.123457'), AUTORIZACION).errores).toEqual([]);
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
