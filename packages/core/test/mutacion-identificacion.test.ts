// Pruebas que matan mutantes de identificacion.ts y modo.ts (pnpm mutacion, docs/calidad/mutacion.md).
// Cada caso fija un borde del formato: anclas de las expresiones regulares, longitud exacta y lo que se devuelve
// sin cambios cuando el valor no tiene la forma esperada.
import { describe, expect, it } from 'vitest';
import {
  esCAIValido,
  esDNIValido,
  esRTNValido,
  formatearDNI,
  formatearRTN,
  limpiarIdentificador,
  normalizarCAI,
  PATRON_CAI_BASICO,
} from '../src/identificacion';
import { esAutorizacionDePrueba, esCAIDemo, esDocumentoDePrueba, LEYENDA_PRUEBA } from '../src/modo';

const CAI = 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4';

describe('RTN: 14 dígitos exactos, con o sin guiones y espacios', () => {
  it('acepta 14 dígitos con o sin separadores', () => {
    expect(esRTNValido('99990000000001')).toBe(true);
    expect(esRTNValido('9999-0000-000001')).toBe(true);
    expect(esRTNValido(' 9999 0000 000001 ')).toBe(true);
  });
  it('rechaza un carácter extra al inicio o al final (el patrón va anclado)', () => {
    expect(esRTNValido('X99990000000001')).toBe(false);
    expect(esRTNValido('99990000000001X')).toBe(false);
    expect(esRTNValido('999900000000011')).toBe(false);
    expect(esRTNValido('9999000000000')).toBe(false);
  });
  it('formatea 4-4-6 y devuelve sin tocar lo que no tiene 14 dígitos', () => {
    expect(formatearRTN('99990000000001')).toBe('9999-0000-000001');
    expect(formatearRTN('9999 0000 000001')).toBe('9999-0000-000001');
    expect(formatearRTN('abc')).toBe('abc');
    expect(formatearRTN('X99990000000001')).toBe('X99990000000001');
    expect(formatearRTN('99990000000001X')).toBe('99990000000001X');
  });
});

describe('DNI: 13 dígitos exactos (DDMM-AAAA-NNNNN)', () => {
  it('valida 13 dígitos con o sin separadores', () => {
    expect(esDNIValido('9999000000001')).toBe(true);
    expect(esDNIValido('9999-0000-00001')).toBe(true);
    expect(esDNIValido('999900000001')).toBe(false);
    expect(esDNIValido('99990000000011')).toBe(false);
  });
  it('formatea 4-4-5 y devuelve sin tocar lo que no tiene 13 dígitos', () => {
    expect(formatearDNI('9999000000001')).toBe('9999-0000-00001');
    expect(formatearDNI('9999 0000 00001')).toBe('9999-0000-00001');
    expect(formatearDNI('9999-0000-00001')).toBe('9999-0000-00001');
    expect(formatearDNI('123')).toBe('123');
    expect(formatearDNI('X9999000000001')).toBe('X9999000000001');
    expect(formatearDNI('9999000000001X')).toBe('9999000000001X');
    expect(formatearDNI('ABCDEFGHIJKLM')).toBe('ABCDEFGHIJKLM');
  });
  it('limpiarIdentificador quita guiones y espacios, nada más', () => {
    expect(limpiarIdentificador(' 9999-0000 00001 ')).toBe('9999000000001');
    expect(limpiarIdentificador('A.B')).toBe('A.B');
  });
});

describe('CAI', () => {
  it('forma estricta 6-6-6-6-6-2 hexadecimal, anclada en los dos extremos', () => {
    expect(esCAIValido(CAI)).toBe(true);
    expect(esCAIValido(` ${CAI.toLowerCase()} `)).toBe(true);
    expect(esCAIValido(`0${CAI}`)).toBe(false);
    expect(esCAIValido(`${CAI}0`)).toBe(false);
    expect(esCAIValido(CAI.replace('A1', 'G1'))).toBe(false);
  });
  it('normaliza recortando y en mayúsculas; el patrón básico solo admite letras, dígitos y guiones', () => {
    expect(normalizarCAI('  demo00-x ')).toBe('DEMO00-X');
    expect(PATRON_CAI_BASICO.test('ABC-123')).toBe(true);
    expect(PATRON_CAI_BASICO.test('ABC 123')).toBe(false);
  });
});

describe('modo de prueba', () => {
  it('esCAIDemo: solo un texto con el prefijo ficticio', () => {
    expect(esCAIDemo('DEMO00-NO-VALIDO-000001')).toBe(true);
    expect(esCAIDemo('  demo00-no-valido-000001 ')).toBe(true);
    expect(esCAIDemo(CAI)).toBe(false);
    expect(esCAIDemo(undefined as unknown as string)).toBe(false);
    expect(esCAIDemo(123 as unknown as string)).toBe(false);
  });
  it('una autorización es de prueba con prueba: true aunque el CAI tenga forma real', () => {
    expect(esAutorizacionDePrueba({ cai: CAI, prueba: true })).toBe(true);
    expect(esAutorizacionDePrueba({ cai: CAI, prueba: false })).toBe(false);
    expect(esAutorizacionDePrueba({ cai: CAI })).toBe(false);
    expect(esAutorizacionDePrueba({ cai: 'DEMO00-NO-VALIDO-1' })).toBe(true);
  });
  it('un documento es de prueba con modo: prueba aunque el CAI tenga forma real', () => {
    expect(esDocumentoDePrueba({ modo: 'prueba', cai: CAI })).toBe(true);
    expect(esDocumentoDePrueba({ cai: CAI })).toBe(false);
    expect(esDocumentoDePrueba({ cai: 'DEMO00-NO-VALIDO-1' })).toBe(true);
    expect(LEYENDA_PRUEBA).toBe('DOCUMENTO DE PRUEBA — SIN VALOR FISCAL');
  });
});
