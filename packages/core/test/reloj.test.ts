/**
 * Fechas en America/Tegucigalpa, nunca la zona del servidor; sin retrofechar (Reglamento Arts. 14 y 43,
 * docs/investigacion.md B-08).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AlmacenMemoria,
  construirDocumento,
  crearDocumento,
  estadoAutorizacion,
  hoyHonduras,
  validarEntrada,
  type AutorizacionCAI,
} from '../src';

const AUT: AutorizacionCAI = {
  cai: 'X1', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2026-11-18',
};
const entrada = (fechaEmision?: string) => ({
  ...(fechaEmision ? { fechaEmision } : {}),
  emisor: { rtn: '08011999123456', razonSocial: 'E', direccionCasaMatriz: 'D', telefono: '1', correo: 'a@b.hn' },
  lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '10' }],
});
// 23:30 del 18 de noviembre en Honduras = 05:30 UTC del 19.
const nocheEnHonduras = () => new Date('2026-11-19T05:30:00Z');

describe('reloj de Honduras', () => {
  it('a las 23:30 en Tegucigalpa la fecha es la de Honduras, aunque en UTC ya sea mañana', () => {
    expect(hoyHonduras({ reloj: nocheEnHonduras })).toBe('2026-11-18');
    const doc = construirDocumento(entrada(), AUT, 1, { reloj: nocheEnHonduras });
    expect(doc.fechaEmision).toBe('2026-11-18');
  });

  it('el último día de la fecha límite todavía se puede emitir (Art. 62), aunque en UTC ya sea el día siguiente', () => {
    expect(validarEntrada(entrada(), AUT, { reloj: nocheEnHonduras }).ok).toBe(true);
    expect(estadoAutorizacion(AUT, null, { hoy: hoyHonduras({ reloj: nocheEnHonduras }) }).vigente).toBe(true);
  });

  it('crearDocumento usa el reloj de las opciones', async () => {
    const doc = await crearDocumento(entrada(), {
      autorizacion: AUT,
      almacen: new AlmacenMemoria(),
      opciones: { reloj: nocheEnHonduras },
    });
    expect(doc.fechaEmision).toBe('2026-11-18');
  });
});

describe('no se permite retrofechar ni adelantar (Arts. 14 y 43)', () => {
  it('fecha de ayer: error', () => {
    const v = validarEntrada(entrada('2026-11-17'), AUT, { reloj: nocheEnHonduras });
    expect(v.errores.map((e) => e.codigo)).toEqual(['FECHA_EMISION_NO_ES_HOY']);
  });

  it('fecha de mañana (la de UTC): error', () => {
    const v = validarEntrada(entrada('2026-11-19'), AUT, { reloj: nocheEnHonduras });
    expect(v.errores.map((e) => e.codigo)).toContain('FECHA_EMISION_NO_ES_HOY');
  });

  it('la fecha de hoy explícita es válida', () => {
    expect(validarEntrada(entrada('2026-11-18'), AUT, { reloj: nocheEnHonduras }).ok).toBe(true);
  });

  it('construirDocumento también la rechaza', () => {
    expect(() => construirDocumento(entrada('2026-11-01'), AUT, 1, { reloj: nocheEnHonduras })).toThrow(
      /FECHA_EMISION_NO_ES_HOY/,
    );
  });
});

describe('la zona del servidor nunca decide la fecha', () => {
  it('el código fuente no usa getters de fecha en la zona local', () => {
    const dir = join(__dirname, '..', 'src');
    const archivos = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((a) => a.endsWith('.ts'));
    for (const archivo of archivos) {
      const fuente = readFileSync(join(dir, archivo), 'utf8');
      expect(fuente, archivo).not.toMatch(
        /\.(getDate|getDay|getMonth|getFullYear|getHours|toDateString|toLocaleDateString)\(/,
      );
    }
  });
});
