// Pruebas que matan mutantes de numeracion.ts (pnpm mutacion, docs/calidad/mutacion.md).
// Número NNN-NNN-TT-NNNNNNNN: límites del correlativo, anclas de los patrones, mensajes de error y pertenencia
// exacta a una autorización (cada parte del número y los dos extremos del rango).
import { describe, expect, it } from 'vitest';
import {
  CORRELATIVO_MAXIMO,
  esNumeroValido,
  formatearNumero,
  formatearRango,
  numeroDesdeAutorizacion,
  parsearNumero,
  perteneceAAutorizacion,
  TIPOS_DOCUMENTO,
} from '../src/numeracion';
import type { AutorizacionCAI } from '../src/tipos';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  establecimiento: '002',
  puntoEmision: 7,
  rangoInicial: 101,
  rangoFinal: 200,
  fechaLimiteEmision: '2027-06-30',
};

const partes = (extra: Partial<Parameters<typeof formatearNumero>[0]> = {}) => ({
  establecimiento: 0,
  puntoEmision: 1,
  tipoDocumento: '01' as const,
  correlativo: 1,
  ...extra,
});

describe('tabla de tipos de documento (Acuerdo 481-2017 reformado por el 609-2017)', () => {
  it('tiene los diez códigos vigentes con su nombre', () => {
    expect(TIPOS_DOCUMENTO).toEqual({
      '01': 'Factura',
      '04': 'Recibo por Honorarios Profesionales',
      '05': 'Comprobante de Retención',
      '06': 'Nota de Crédito',
      '07': 'Nota de Débito',
      '08': 'Guía de Remisión',
      '09': 'Ticket',
      '10': 'Factura Prevalorada',
      '11': 'Boleta de Compra',
      '12': 'Constancia de Donación',
    });
  });
});

describe('formatearNumero', () => {
  it('rellena con ceros y recorta espacios de los códigos', () => {
    expect(formatearNumero(partes({ establecimiento: ' 2 ', puntoEmision: '07 ', correlativo: 5 }))).toBe('002-007-01-00000005');
  });
  it('acepta el correlativo máximo 99999999 y rechaza 0 y el siguiente', () => {
    expect(CORRELATIVO_MAXIMO).toBe(99_999_999);
    expect(formatearNumero(partes({ correlativo: CORRELATIVO_MAXIMO }))).toBe('000-001-01-99999999');
    expect(() => formatearNumero(partes({ correlativo: CORRELATIVO_MAXIMO + 1 }))).toThrow(
      new RangeError('Correlativo fuera de 1..99999999: 100000000'),
    );
    expect(() => formatearNumero(partes({ correlativo: 0 }))).toThrow('Correlativo fuera de 1..99999999: 0');
    expect(() => formatearNumero(partes({ correlativo: 1.5 }))).toThrow('Correlativo fuera de 1..99999999: 1.5');
  });
  it('rechaza un tipo desconocido con su mensaje', () => {
    expect(() => formatearNumero(partes({ tipoDocumento: '02' as never }))).toThrow(new RangeError('Tipo de documento desconocido: 02'));
  });
  it('rechaza códigos con letras al inicio o al final, o más largos de 3 dígitos', () => {
    expect(() => formatearNumero(partes({ establecimiento: 'a1' }))).toThrow(
      new RangeError('Establecimiento debe tener hasta 3 dígitos numéricos: "a1"'),
    );
    expect(() => formatearNumero(partes({ establecimiento: '1a' }))).toThrow('Establecimiento debe tener hasta 3 dígitos numéricos: "1a"');
    expect(() => formatearNumero(partes({ puntoEmision: '1000' }))).toThrow(
      new RangeError('Punto de emisión debe tener hasta 3 dígitos numéricos: "1000"'),
    );
  });
});

describe('parsearNumero y esNumeroValido', () => {
  it('lee con o sin guiones y espacios', () => {
    expect(parsearNumero('002 007 01 00000150')).toEqual({ establecimiento: '002', puntoEmision: '007', tipoDocumento: '01', correlativo: 150 });
  });
  it('exige exactamente 16 dígitos (el patrón va anclado)', () => {
    expect(() => parsearNumero('0000010100000001X')).toThrow(new RangeError('El número de documento debe tener 16 dígitos: "0000010100000001X"'));
    expect(() => parsearNumero('X0000010100000001')).toThrow('El número de documento debe tener 16 dígitos: "X0000010100000001"');
    expect(() => parsearNumero('00000101000000011')).toThrow('debe tener 16 dígitos');
  });
  it('rechaza un tipo desconocido y el correlativo 0', () => {
    expect(() => parsearNumero('000-001-02-00000001')).toThrow(new RangeError('Tipo de documento desconocido: 02'));
    expect(() => parsearNumero('000-001-01-00000000')).toThrow(new RangeError('Correlativo fuera de 1..99999999: 0'));
  });
  it('esNumeroValido no lanza: true o false', () => {
    expect(esNumeroValido('000-001-01-00000001')).toBe(true);
    expect(esNumeroValido('000-001-01-00000000')).toBe(false);
    expect(esNumeroValido('abc')).toBe(false);
    expect(esNumeroValido('000-001-03-00000001')).toBe(false);
  });
});

describe('autorización y rango', () => {
  it('arma el número y el rango impreso', () => {
    expect(numeroDesdeAutorizacion(AUT, 150)).toBe('002-007-01-00000150');
    expect(formatearRango(AUT)).toBe('002-007-01-00000101 al 002-007-01-00000200');
  });
  it('pertenece: mismos establecimiento, punto y tipo, y dentro del rango, extremos incluidos', () => {
    expect(perteneceAAutorizacion('002-007-01-00000101', AUT)).toBe(true);
    expect(perteneceAAutorizacion('002-007-01-00000200', AUT)).toBe(true);
    expect(perteneceAAutorizacion('002-007-01-00000100', AUT)).toBe(false);
    expect(perteneceAAutorizacion('002-007-01-00000201', AUT)).toBe(false);
    expect(perteneceAAutorizacion('003-007-01-00000150', AUT)).toBe(false);
    expect(perteneceAAutorizacion('002-008-01-00000150', AUT)).toBe(false);
    expect(perteneceAAutorizacion('002-007-06-00000150', AUT)).toBe(false);
    expect(perteneceAAutorizacion('no es un número', AUT)).toBe(false);
  });
  it('una autorización con códigos mal escritos es un error, no un «no pertenece»', () => {
    expect(() => perteneceAAutorizacion('002-007-01-00000150', { ...AUT, establecimiento: 'abc' })).toThrow(
      new RangeError('Establecimiento debe tener hasta 3 dígitos numéricos: "abc"'),
    );
    expect(() => perteneceAAutorizacion('002-007-01-00000150', { ...AUT, puntoEmision: 'x' })).toThrow(
      new RangeError('Punto de emisión debe tener hasta 3 dígitos numéricos: "x"'),
    );
  });
});
