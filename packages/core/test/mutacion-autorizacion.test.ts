// Pruebas que matan mutantes de autorizacion.ts (pnpm mutacion, docs/calidad/mutacion.md).
// Cada problema estructural de una autorización con su código, mensaje y campo; el aviso del Art. 62 (vigencia
// de hasta un año); y el estado operativo: consumo del rango, ventana de aviso del Art. 59 y bordes de cada alerta.
import { describe, expect, it } from 'vitest';
import {
  diasEntre,
  esAdvertencia,
  estadoAutorizacion,
  fechaHonduras,
  horaHonduras,
  restarMeses,
  validarAutorizacion,
} from '../src/autorizacion';
import type { AutorizacionCAI } from '../src/tipos';

const CAI = 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4';
const AUT: AutorizacionCAI = {
  cai: CAI,
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 101,
  rangoFinal: 200,
  fechaLimiteEmision: '2027-06-30',
};
const aut = (extra: Partial<AutorizacionCAI> = {}): AutorizacionCAI => ({ ...AUT, ...extra });
/** Los problemas sin `solucion` ni `documentacion`, para comparar código, mensaje y campo. */
const problemas = (a: AutorizacionCAI, opciones?: { caiEstricto?: boolean }) =>
  validarAutorizacion(a, opciones).map(({ codigo, mensaje, campo }) => ({ codigo, mensaje, campo }));

describe('validarAutorizacion', () => {
  it('una autorización completa no tiene problemas', () => {
    expect(validarAutorizacion(AUT)).toEqual([]);
    expect(validarAutorizacion(AUT, { caiEstricto: true })).toEqual([]);
    expect(validarAutorizacion(aut({ cai: `  ${CAI}  ` }))).toEqual([]);
  });
  it('CAI vacío, solo espacios o ausente', () => {
    const requerido = [{ codigo: 'CAI_REQUERIDO', mensaje: 'La autorización no tiene CAI.', campo: 'cai' }];
    expect(problemas(aut({ cai: '' }))).toEqual(requerido);
    expect(problemas(aut({ cai: '   ' }))).toEqual(requerido);
    expect(problemas(aut({ cai: undefined as never }))).toEqual(requerido);
    expect(validarAutorizacion(aut({ cai: '' }))[0]!.solucion).toMatch(/Indica el CAI/);
  });
  it('CAI con un carácter que no es letra, dígito ni guion', () => {
    expect(problemas(aut({ cai: 'A1B2 C3' }))).toEqual([
      {
        codigo: 'CAI_FORMATO',
        mensaje: 'El CAI "A1B2 C3" solo puede tener letras, dígitos y guiones. Cópialo tal como viene en la resolución del SAR.',
        campo: 'cai',
      },
    ]);
  });
  it('caiEstricto exige la forma 6-6-6-6-6-2; sin él basta la forma básica', () => {
    expect(problemas(aut({ cai: 'ABC-123' }))).toEqual([]);
    expect(problemas(aut({ cai: 'ABC-123' }), { caiEstricto: true })).toEqual([
      { codigo: 'CAI_FORMATO', mensaje: 'El CAI "ABC-123" no tiene la forma 6-6-6-6-6-2 hexadecimal exigida con caiEstricto.', campo: 'cai' },
    ]);
  });
  it('tipo de documento desconocido', () => {
    expect(problemas(aut({ tipoDocumento: '02' as never }))).toEqual([
      { codigo: 'TIPO_DOCUMENTO', mensaje: 'Tipo de documento desconocido: 02', campo: 'tipoDocumento' },
    ]);
  });
  it('establecimiento y punto de emisión: de 1 a 3 dígitos, nada más', () => {
    for (const malo of ['1234', 'a12', '12a', '']) {
      expect(problemas(aut({ establecimiento: malo }))).toEqual([
        { codigo: 'ESTABLECIMIENTO', mensaje: 'Establecimiento debe tener hasta 3 dígitos.', campo: 'establecimiento' },
      ]);
      expect(problemas(aut({ puntoEmision: malo }))).toEqual([
        { codigo: 'PUNTO_EMISION', mensaje: 'Punto de emisión debe tener hasta 3 dígitos.', campo: 'puntoEmision' },
      ]);
    }
    expect(problemas(aut({ establecimiento: 7, puntoEmision: 12 }))).toEqual([]);
  });
  it('rango: enteros de 1 a 99999999, dice cuál está mal', () => {
    expect(problemas(aut({ rangoInicial: 1.5 }))).toEqual([
      { codigo: 'RANGO', mensaje: 'Rango autorizado inválido: rangoInicial (1.5) debe ser un entero entre 1 y 99999999.', campo: 'rangoInicial' },
    ]);
    expect(problemas(aut({ rangoInicial: 0 }))[0]!.campo).toBe('rangoInicial');
    expect(problemas(aut({ rangoFinal: 100_000_000 }))).toEqual([
      { codigo: 'RANGO', mensaje: 'Rango autorizado inválido: rangoFinal (100000000) debe ser un entero entre 1 y 99999999.', campo: 'rangoFinal' },
    ]);
    expect(problemas(aut({ rangoInicial: 1, rangoFinal: 99_999_999 }))).toEqual([]);
  });
  it('rango: el inicial no puede pasar del final; iguales sí', () => {
    expect(problemas(aut({ rangoInicial: 201 }))).toEqual([
      { codigo: 'RANGO', mensaje: 'Rango autorizado inválido: el inicial (201) es mayor que el final (200).', campo: 'rangoInicial' },
    ]);
    expect(problemas(aut({ rangoInicial: 200 }))).toEqual([]);
  });
  it('fecha límite y fecha de autorización con formato AAAA-MM-DD', () => {
    expect(problemas(aut({ fechaLimiteEmision: '30/06/2027' }))).toEqual([
      { codigo: 'FECHA_LIMITE', mensaje: 'fechaLimiteEmision debe ser YYYY-MM-DD.', campo: 'fechaLimiteEmision' },
    ]);
    expect(problemas(aut({ fechaAutorizacion: '2026-13-01' }))).toEqual([
      { codigo: 'FECHA_AUTORIZACION', mensaje: 'fechaAutorizacion debe ser YYYY-MM-DD.', campo: 'fechaAutorizacion' },
    ]);
    // Con la fecha límite mal escrita no se compara la vigencia (no hay aviso del Art. 62).
    expect(problemas(aut({ fechaAutorizacion: '2026-01-15', fechaLimiteEmision: 'x' })).map((p) => p.codigo)).toEqual(['FECHA_LIMITE']);
  });
  it('Art. 62: aviso si la fecha límite pasa de un año desde la autorización (un año justo no)', () => {
    expect(problemas(aut({ fechaAutorizacion: '2026-06-30', fechaLimiteEmision: '2027-06-30' }))).toEqual([]);
    const avisos = validarAutorizacion(aut({ fechaAutorizacion: '2026-06-29', fechaLimiteEmision: '2027-06-30' }));
    expect(avisos).toEqual([
      {
        codigo: 'AVISO_VIGENCIA_MAYOR_1_ANIO',
        mensaje:
          'La fecha límite (2027-06-30) está a más de un año de la autorización (2026-06-29); el Art. 62 fija una vigencia máxima de 1 año. Verifícala contra la resolución.',
        campo: 'fechaLimiteEmision',
      },
    ]);
  });
  it('prueba: booleano, y solo con un CAI ficticio', () => {
    expect(problemas(aut({ prueba: 'si' as never }))).toEqual([
      { codigo: 'AUTORIZACION_PRUEBA_FORMATO', mensaje: '«prueba» debe ser true o false (booleano), no "si".', campo: 'prueba' },
    ]);
    expect(problemas(aut({ prueba: true }))).toEqual([
      {
        codigo: 'AUTORIZACION_PRUEBA_CAI_REAL',
        mensaje: `El CAI ${CAI} no es ficticio: una autorización de prueba usa un CAI que empieza con DEMO00-NO-VALIDO-.`,
        campo: 'prueba',
      },
    ]);
    expect(problemas(aut({ prueba: true, cai: 'DEMO00-NO-VALIDO-000001' }))).toEqual([]);
    expect(problemas(aut({ prueba: false }))).toEqual([]);
  });
});

describe('esAdvertencia', () => {
  it('AVISO_ al inicio o _ADVERTENCIA al final', () => {
    expect(esAdvertencia({ codigo: 'AVISO_RANGO', mensaje: '' })).toBe(true);
    expect(esAdvertencia({ codigo: 'X_ADVERTENCIA', mensaje: '' })).toBe(true);
    expect(esAdvertencia({ codigo: 'ADVERTENCIA_X', mensaje: '' })).toBe(false);
    expect(esAdvertencia({ codigo: 'X_AVISO', mensaje: '' })).toBe(false);
    expect(esAdvertencia({ codigo: 'RANGO', mensaje: '' })).toBe(false);
  });
});

describe('fechas', () => {
  it('fecha y hora en Honduras (UTC-6), no en la zona del equipo', () => {
    const casiMedianoche = new Date('2026-11-19T03:30:00Z');
    expect(fechaHonduras(casiMedianoche)).toBe('2026-11-18');
    expect(horaHonduras(casiMedianoche)).toBe('21:30');
    expect(fechaHonduras()).toBe('2026-11-18');
  });
  it('restarMeses rellena mes y día con ceros y ajusta al último día del mes', () => {
    expect(restarMeses('2026-03-05', 2)).toBe('2026-01-05');
    expect(restarMeses('2026-03-31', 1)).toBe('2026-02-28');
    expect(restarMeses('2026-01-15', 2)).toBe('2025-11-15');
    expect(restarMeses('2024-04-30', 2)).toBe('2024-02-29');
  });
  it('diasEntre cuenta días de calendario', () => {
    expect(diasEntre('2026-11-18', '2026-11-19')).toBe(1);
    expect(diasEntre('2026-11-18', '2026-11-17')).toBe(-1);
    expect(diasEntre('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('estadoAutorizacion', () => {
  const HOY = '2026-11-18';
  it('sin emitir: empieza en el rango inicial, nada usado', () => {
    expect(estadoAutorizacion(AUT, null, { hoy: HOY })).toEqual({
      vigente: true,
      diasRestantes: 224,
      correlativosRestantes: 100,
      siguienteCorrelativo: 101,
      porcentajeUsado: 0,
      alertas: [],
    });
  });
  it('a la mitad del rango', () => {
    const e = estadoAutorizacion(AUT, 150, { hoy: HOY });
    expect(e.siguienteCorrelativo).toBe(151);
    expect(e.correlativosRestantes).toBe(50);
    expect(e.porcentajeUsado).toBe(50);
  });
  it('aviso de rango desde el porcentaje exacto (90 % por defecto)', () => {
    expect(estadoAutorizacion(AUT, 189, { hoy: HOY }).alertas).toEqual([]);
    expect(estadoAutorizacion(AUT, 190, { hoy: HOY }).alertas).toEqual([
      { codigo: 'AVISO_RANGO', mensaje: 'Se ha usado el 90% del rango (10 disponibles).' },
    ]);
    expect(estadoAutorizacion(AUT, 150, { hoy: HOY, porcentajeAviso: 50 }).alertas.map((a) => a.codigo)).toEqual(['AVISO_RANGO']);
  });
  it('rango agotado: sin siguiente y no vigente', () => {
    const e = estadoAutorizacion(AUT, 200, { hoy: HOY });
    expect(e.vigente).toBe(false);
    expect(e.siguienteCorrelativo).toBeNull();
    expect(e.correlativosRestantes).toBe(0);
    expect(e.alertas).toEqual([{ codigo: 'RANGO_AGOTADO', mensaje: 'Se agotó el rango autorizado.' }]);
  });
  it('vencida desde el día siguiente a la fecha límite', () => {
    expect(estadoAutorizacion(AUT, null, { hoy: '2027-06-30' }).vigente).toBe(true);
    const e = estadoAutorizacion(AUT, null, { hoy: '2027-07-01' });
    expect(e.vigente).toBe(false);
    expect(e.diasRestantes).toBe(-1);
    expect(e.alertas).toEqual([{ codigo: 'AUTORIZACION_VENCIDA', mensaje: 'La fecha límite de emisión (2027-06-30) ya pasó.' }]);
  });
  it('Art. 59: avisa desde que se abre la ventana de dos meses antes de la fecha límite', () => {
    expect(estadoAutorizacion(AUT, null, { hoy: '2027-04-29' }).alertas).toEqual([]);
    expect(estadoAutorizacion(AUT, null, { hoy: '2027-04-30' }).alertas).toEqual([
      { codigo: 'AVISO_VENCIMIENTO', mensaje: 'Faltan 61 días para la fecha límite de emisión.' },
    ]);
  });
  it('con diasAviso, avisa desde ese número de días (incluido)', () => {
    expect(estadoAutorizacion(AUT, null, { hoy: '2027-05-30', diasAviso: 30 }).alertas).toEqual([]);
    expect(estadoAutorizacion(AUT, null, { hoy: '2027-05-31', diasAviso: 30 }).alertas).toEqual([
      { codigo: 'AVISO_VENCIMIENTO', mensaje: 'Faltan 30 días para la fecha límite de emisión.' },
    ]);
  });
  it('una autorización de prueba de un punto con una real queda retirada; una real no', () => {
    const prueba = aut({ cai: 'DEMO00-NO-VALIDO-000001' });
    expect(estadoAutorizacion(prueba, 150, { hoy: HOY, puntoConReal: true })).toEqual({
      vigente: false,
      diasRestantes: 224,
      correlativosRestantes: 0,
      siguienteCorrelativo: null,
      porcentajeUsado: 50,
      alertas: [],
      retirada: true,
    });
    expect(estadoAutorizacion(AUT, 150, { hoy: HOY, puntoConReal: true }).retirada).toBeUndefined();
    expect(estadoAutorizacion(prueba, 150, { hoy: HOY }).retirada).toBeUndefined();
  });
});
