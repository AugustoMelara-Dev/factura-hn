/**
 * Propiedades de la validación (src/identificacion.ts, src/autorizacion.ts, src/documento.ts):
 * - RTN de 14 dígitos (Reglamento Art. 10 num. 1 a; Art. 11 num. 1 b) y DNI de 13; solo se valida el formato;
 * - CAI: la forma 6-6-6-6-6-2 hexadecimal **no tiene fuente normativa** (identificacion.ts) y solo se exige con
 *   `caiEstricto`; por defecto solo letras, dígitos y guiones (DEC-013);
 * - fechas en America/Tegucigalpa (UTC−6 sin horario de verano desde 2007; el de 2006 queda fuera del dominio);
 * - fecha de emisión = hoy en Honduras (Arts. 14 y 43);
 * - vigencia de la autorización de hasta un año (Art. 62), como aviso.
 */
import { describe, expect, it } from 'vitest';
import {
  diasEntre,
  esCAIValido,
  esDNIValido,
  esFechaValida,
  esRTNValido,
  fechaHonduras,
  formatearDNI,
  formatearRTN,
  horaHonduras,
  limpiarIdentificador,
  normalizarCAI,
  validarAutorizacion,
  validarEntrada,
  type AutorizacionCAI,
} from '../../src';
import { fc, TIEMPO } from './config';

const digitos = (n: number) => fc.stringMatching(new RegExp(`^\\d{${n}}$`));
/** Guiones y espacios sueltos entre los dígitos: limpiarIdentificador los quita. */
const conSeparadores = (s: string) =>
  fc.array(fc.constantFrom('', '', '', '-', ' ', ' - '), { minLength: s.length + 1, maxLength: s.length + 1 }).map((seps) => seps.map((x, i) => x + (s[i] ?? '')).join(''));

describe('validación: RTN y DNI', () => {
  it('esRTNValido ⇔ 14 dígitos después de quitar guiones y espacios', () => {
    fc.assert(fc.property(fc.string(), (s) => esRTNValido(s) === /^\d{14}$/.test(s.replace(/[\s-]/g, ''))));
    fc.assert(fc.property(digitos(14).chain(conSeparadores), (s) => esRTNValido(s)));
  }, TIEMPO);

  it('un RTN con 13 o 15 dígitos, o con una letra, no es válido', () => {
    fc.assert(fc.property(fc.oneof(digitos(13), digitos(15), digitos(14).map((s) => s.slice(0, 13) + 'A')), (s) => !esRTNValido(s)));
  }, TIEMPO);

  it('formatearRTN da 4-4-6 y conserva los dígitos; formatearDNI da 4-4-5', () => {
    fc.assert(fc.property(digitos(14).chain(conSeparadores), (s) => {
      const f = formatearRTN(s);
      expect(f).toMatch(/^\d{4}-\d{4}-\d{6}$/);
      expect(limpiarIdentificador(f)).toBe(limpiarIdentificador(s));
    }));
    fc.assert(fc.property(digitos(13).chain(conSeparadores), (s) => {
      expect(esDNIValido(s)).toBe(true);
      expect(formatearDNI(s)).toMatch(/^\d{4}-\d{4}-\d{5}$/);
    }));
  }, TIEMPO);

  it('formatearRTN devuelve sin cambios lo que no es un RTN', () => {
    fc.assert(fc.property(fc.string(), (s) => esRTNValido(s) || formatearRTN(s) === s));
  }, TIEMPO);
});

const hex = (n: number) => fc.stringMatching(new RegExp(`^[0-9A-Fa-f]{${n}}$`));
const caiForma = fc.tuple(hex(6), hex(6), hex(6), hex(6), hex(6), hex(2)).map((g) => g.join('-'));

describe('validación: CAI', () => {
  it('toda cadena 6-6-6-6-6-2 hexadecimal, en mayúsculas o minúsculas y con espacios a los lados, es válida en modo estricto', () => {
    fc.assert(fc.property(caiForma, fc.constantFrom('', ' ', '\t'), (cai, borde) => esCAIValido(`${borde}${cai}${borde}`)));
  }, TIEMPO);

  it('cambiar un carácter del CAI por uno que no es hexadecimal ni guion lo invalida', () => {
    fc.assert(
      fc.property(caiForma, fc.nat(), fc.constantFrom('G', 'Z', ' ', '.', 'Ñ', '_'), (cai, i, c) => {
        const pos = i % cai.length;
        return !esCAIValido(cai.slice(0, pos) + c + cai.slice(pos + 1));
      }),
    );
  }, TIEMPO);

  it('normalizarCAI es idempotente', () => {
    fc.assert(fc.property(fc.string(), (s) => normalizarCAI(normalizarCAI(s)) === normalizarCAI(s)));
  }, TIEMPO);

  it('sin caiEstricto, CAI_FORMATO ⇔ tras recortar queda un carácter que no es letra, dígito o guion (DEC-013)', () => {
    const aut = (cai: string): AutorizacionCAI => ({ cai, tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-06-30' });
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('A', 'b', '1', '-', ' ', '.', 'é', 'Z', '0') }), (cai) => {
        fc.pre(cai.trim() !== '');
        const codigos = validarAutorizacion(aut(cai)).map((p) => p.codigo);
        expect(codigos.includes('CAI_FORMATO')).toBe(!/^[0-9A-Z-]+$/.test(cai.trim().toUpperCase()));
      }),
    );
  }, TIEMPO);
});

/** Instantes de 2007 a 2099 (sin el horario de verano de 2006). */
const instante = fc.date({ min: new Date('2007-01-01T06:00:00Z'), max: new Date('2099-12-31T23:59:59Z'), noInvalidDate: true });
const fecha = fc.date({ min: new Date('2007-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));

describe('validación: fechas en America/Tegucigalpa', () => {
  it('fechaHonduras y horaHonduras son la fecha y la hora UTC − 6 horas', () => {
    fc.assert(
      fc.property(instante, (d) => {
        const local = new Date(d.getTime() - 6 * 3_600_000).toISOString();
        expect(fechaHonduras(d)).toBe(local.slice(0, 10));
        expect(horaHonduras(d)).toBe(local.slice(11, 16));
      }),
    );
  }, TIEMPO);

  it('esFechaValida ⇔ AAAA-MM-DD de un día que existe en el calendario', () => {
    const diasDelMes = (a: number, m: number) => [31, a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 9999 }), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 32 }), (a, m, d) => {
        const texto = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        expect(esFechaValida(texto)).toBe(m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(a, m));
      }),
    );
    fc.assert(fc.property(fc.string(), (s) => !esFechaValida(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)));
  }, TIEMPO);

  it('diasEntre es aditiva y antisimétrica', () => {
    fc.assert(
      fc.property(fecha, fecha, fecha, (a, b, c) => {
        expect(diasEntre(a, b) + diasEntre(b, c)).toBe(diasEntre(a, c));
        expect(diasEntre(a, b) + diasEntre(b, a)).toBe(0);
      }),
    );
  }, TIEMPO);

  it('Arts. 14 y 43: una fecha de emisión distinta de hoy en Honduras da FECHA_EMISION_NO_ES_HOY; la de hoy, no', () => {
    const aut: AutorizacionCAI = { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2099-12-31' };
    const emisor = { rtn: '99990000000001', razonSocial: 'Ejemplo', nombreComercial: 'Ejemplo', direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo', telefono: '0000-0001', correo: 'ventas@ejemplo.example' };
    fc.assert(
      fc.property(instante, fecha, (ahora, f) => {
        const hoy = fechaHonduras(ahora);
        fc.pre(hoy <= aut.fechaLimiteEmision);
        const v = validarEntrada({ emisor, fechaEmision: f, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, aut, { reloj: () => ahora });
        expect(v.errores.some((p) => p.codigo === 'FECHA_EMISION_NO_ES_HOY')).toBe(f !== hoy);
        const sinFecha = validarEntrada({ emisor, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, aut, { reloj: () => ahora });
        expect(sinFecha.ok).toBe(true);
      }),
    );
  }, TIEMPO);

  it('Art. 62: AVISO_VIGENCIA_MAYOR_1_ANIO ⇔ la fecha límite pasa de un año desde la autorización; nunca bloquea', () => {
    fc.assert(
      fc.property(fecha, fc.integer({ min: 0, max: 800 }), (autorizada, dias) => {
        const limite = new Date(Date.parse(`${autorizada}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
        const p = validarAutorizacion({ cai: 'A1B2C3', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: limite, fechaAutorizacion: autorizada });
        const codigos = p.map((x) => x.codigo);
        // Un año tiene 365 o 366 días: hasta 365 nunca hay aviso; desde 367, siempre. Con 366 depende del 29 de febrero.
        expect(codigos.filter((c) => c !== 'AVISO_VIGENCIA_MAYOR_1_ANIO')).toEqual([]);
        if (dias <= 365) expect(codigos).toEqual([]);
        if (dias >= 367) expect(codigos).toEqual(['AVISO_VIGENCIA_MAYOR_1_ANIO']);
      }),
    );
  }, TIEMPO);
});
