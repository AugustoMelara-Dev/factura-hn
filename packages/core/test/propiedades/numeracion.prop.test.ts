/**
 * Propiedades de la numeración (src/numeracion.ts, src/autorizacion.ts y la emisión sobre el almacén en memoria):
 * - Reglamento Art. 10 num. 7: número `NNN-NNN-NN-NNNNNNNN` (establecimiento, punto de emisión, tipo y
 *   correlativo de 8 dígitos, de 00000001 a 99999999);
 * - correlativos consecutivos y sin huecos dentro del rango autorizado (Art. 10 num. 5: rango autorizado);
 * - al agotar el rango no se emite (el número siguiente no existe en la autorización).
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  CORRELATIVO_MAXIMO,
  emitir,
  ErrorValidacion,
  estadoAutorizacion,
  formatearNumero,
  numeroDesdeAutorizacion,
  parsearNumero,
  perteneceAAutorizacion,
  registrarAutorizacion,
  TIPOS_DOCUMENTO,
  type AutorizacionCAI,
  type CodigoTipoDocumento,
} from '../../src';
import { corridas, fc, TIEMPO } from './config';

const TIPOS = Object.keys(TIPOS_DOCUMENTO) as CodigoTipoDocumento[];
const codigo3 = fc.integer({ min: 0, max: 999 });
const correlativo = fc.integer({ min: 1, max: CORRELATIVO_MAXIMO });
const partes = fc.record({ establecimiento: codigo3, puntoEmision: codigo3, tipoDocumento: fc.constantFrom(...TIPOS), correlativo });

const autorizacion = fc
  .record({
    establecimiento: codigo3,
    puntoEmision: codigo3,
    tipoDocumento: fc.constantFrom(...TIPOS),
    a: correlativo,
    b: correlativo,
  })
  .map(({ a, b, ...r }): AutorizacionCAI => ({
    ...r,
    cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
    rangoInicial: Math.min(a, b),
    rangoFinal: Math.max(a, b),
    fechaLimiteEmision: '2027-06-30',
  }));

describe('numeración: formato (Art. 10 num. 7)', () => {
  it('formatearNumero da NNN-NNN-NN-NNNNNNNN y parsearNumero devuelve las mismas partes', () => {
    fc.assert(
      fc.property(partes, (p) => {
        const n = formatearNumero(p);
        expect(n).toMatch(/^\d{3}-\d{3}-\d{2}-\d{8}$/);
        expect(parsearNumero(n)).toEqual({
          establecimiento: String(p.establecimiento).padStart(3, '0'),
          puntoEmision: String(p.puntoEmision).padStart(3, '0'),
          tipoDocumento: p.tipoDocumento,
          correlativo: p.correlativo,
        });
        // Sin guiones o con espacios es el mismo número.
        expect(parsearNumero(n.replace(/-/g, ''))).toEqual(parsearNumero(n));
      }),
    );
  }, TIEMPO);

  it('dentro de una serie, el orden del texto es el orden del correlativo (el archivo queda ordenado)', () => {
    fc.assert(
      fc.property(partes, correlativo, (p, otro) => {
        const a = formatearNumero(p);
        const b = formatearNumero({ ...p, correlativo: otro });
        expect(Math.sign(a.localeCompare(b, 'en'))).toBe(Math.sign(p.correlativo - otro));
      }),
    );
  }, TIEMPO);

  it('un correlativo fuera de 1..99999999 o no entero se rechaza con RangeError', () => {
    const malo = fc.oneof(
      fc.integer({ min: -1_000_000, max: 0 }),
      fc.integer({ min: CORRELATIVO_MAXIMO + 1, max: Number.MAX_SAFE_INTEGER }),
      fc.double({ noInteger: true }),
      fc.constantFrom(NaN, Infinity, -Infinity),
    );
    fc.assert(fc.property(partes, malo, (p, c) => {
      expect(() => formatearNumero({ ...p, correlativo: c })).toThrow(RangeError);
    }));
  }, TIEMPO);

  it('el correlativo 00000000 no existe: la serie empieza en 00000001', () => {
    fc.assert(fc.property(partes, (p) => {
      expect(() => parsearNumero(formatearNumero(p).replace(/-\d{8}$/, '-00000000'))).toThrow(RangeError);
    }));
  }, TIEMPO);
});

describe('numeración: rango autorizado', () => {
  it('perteneceAAutorizacion ⇔ misma serie y rangoInicial ≤ correlativo ≤ rangoFinal', () => {
    fc.assert(
      fc.property(autorizacion, correlativo, (aut, n) => {
        const numero = formatearNumero({ ...aut, correlativo: n });
        expect(perteneceAAutorizacion(numero, aut)).toBe(n >= aut.rangoInicial && n <= aut.rangoFinal);
      }),
    );
  }, TIEMPO);

  it('un número de otra serie (otro establecimiento, punto o tipo) nunca pertenece', () => {
    fc.assert(
      fc.property(autorizacion, partes, (aut, p) => {
        fc.pre(p.establecimiento !== aut.establecimiento || p.puntoEmision !== aut.puntoEmision || p.tipoDocumento !== aut.tipoDocumento);
        expect(perteneceAAutorizacion(formatearNumero(p), aut)).toBe(false);
      }),
    );
  }, TIEMPO);

  it('estadoAutorizacion: restantes + usados = tamaño del rango y siguiente = último + 1 (null si se agotó)', () => {
    fc.assert(
      fc.property(autorizacion, fc.nat(), (aut, k) => {
        const tamano = aut.rangoFinal - aut.rangoInicial + 1;
        const usados = k % (tamano + 1); // 0..tamano
        const ultimo = usados === 0 ? null : aut.rangoInicial + usados - 1;
        const e = estadoAutorizacion(aut, ultimo, { hoy: '2026-11-18' });
        expect(e.correlativosRestantes).toBe(tamano - usados);
        expect(e.siguienteCorrelativo).toBe(usados === tamano ? null : aut.rangoInicial + usados);
        expect(e.alertas.some((a) => a.codigo === 'RANGO_AGOTADO')).toBe(usados === tamano);
        expect(e.vigente).toBe(usados < tamano);
      }),
    );
  }, TIEMPO);
});

const EMISOR = {
  rtn: '99990000000001',
  razonSocial: 'Comercial Ejemplo S. de R.L.',
  nombreComercial: 'Comercial Ejemplo',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

describe('numeración: emisión consecutiva y sin huecos', () => {
  it('k emisiones en un rango de n números dan rangoInicial … rangoInicial + min(k, n) − 1; las demás fallan con RANGO_AGOTADO sin consumir número', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99_999_000 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 16 }),
        fc.integer({ min: 0, max: 999 }),
        async (inicial, tamano, intentos, punto) => {
          const almacen = new AlmacenFiscalMemoria();
          const puntoEmision = String(punto).padStart(3, '0');
          const aut: AutorizacionCAI = {
            cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision,
            rangoInicial: inicial, rangoFinal: inicial + tamano - 1, fechaLimiteEmision: '2027-06-30',
          };
          await registrarAutorizacion(almacen, aut);
          const emitidos: number[] = [];
          const rechazos: string[] = [];
          for (let i = 0; i < intentos; i++) {
            try {
              const d = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'x', cantidad: '1', precioUnitario: '1.00' }] }, { almacen, establecimiento: '000', puntoEmision });
              emitidos.push(d.correlativo);
              expect(d.numero).toBe(numeroDesdeAutorizacion(aut, d.correlativo));
            } catch (e) {
              expect(e).toBeInstanceOf(ErrorValidacion);
              rechazos.push(...(e as ErrorValidacion).errores.map((p) => p.codigo));
            }
          }
          const esperados = Math.min(intentos, tamano);
          expect(emitidos).toEqual(Array.from({ length: esperados }, (_, i) => inicial + i));
          expect(rechazos.length).toBe(intentos - esperados);
          expect(new Set(rechazos).size <= 1).toBe(true);
          if (rechazos.length) expect(rechazos[0]).toBe('RANGO_AGOTADO');
        },
      ),
      { numRuns: corridas(0.1) },
    );
  }, TIEMPO);
});
