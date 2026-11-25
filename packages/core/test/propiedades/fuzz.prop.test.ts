/**
 * Fuzzing de los lectores del núcleo: con cualquier entrada del tipo declarado, el núcleo responde o lanza uno de
 * sus errores (`ErrorMonto`, `ErrorCalculo`, `ErrorValidacion`, `ErrorExportacion` o un `RangeError` con mensaje
 * propio), nunca un `TypeError` ni otro error del motor. Las funciones de validación no lanzan: devuelven problemas.
 */
import { describe, expect, it } from 'vitest';
import {
  aCentavos,
  calcularDocumento,
  centavosEnLetras,
  ErrorCalculo,
  ErrorExportacion,
  ErrorMonto,
  ErrorValidacion,
  esCAIValido,
  esDNIValido,
  esFechaValida,
  esNumeroValido,
  esRTNValido,
  formatearMonto,
  formatearRTN,
  leerExportacionJSONL,
  montoEnLetras,
  parsearDecimal,
  parsearNumero,
  redondearDecimal,
  validarAutorizacion,
  validarEntrada,
  validarLineas,
  type AutorizacionCAI,
  type DocumentoEntrada,
  type LineaEntrada,
} from '../../src';
import { construirDocumento } from '../../src/documento';
import { fc, TIEMPO } from './config';

/** Mensajes de los RangeError que lanza el núcleo (numeracion.ts y letras.ts). Un RangeError del motor no pasa. */
const RANGE_PROPIOS = [/dígitos numéricos/, /^Correlativo fuera de/, /^Tipo de documento desconocido/, /^El número de documento debe tener 16 dígitos/, /^Se esperaba un entero no negativo/, /^Monto demasiado grande/, /^El monto no puede ser negativo/];

function esPropio(e: unknown): boolean {
  if (e instanceof ErrorMonto || e instanceof ErrorCalculo || e instanceof ErrorValidacion || e instanceof ErrorExportacion) return true;
  return e instanceof RangeError && e.constructor === RangeError && RANGE_PROPIOS.some((r) => r.test(e.message));
}

/** Corre `fn`; si lanza, el error debe ser propio. */
function soloPropios(fn: () => unknown): void {
  try {
    fn();
  } catch (e) {
    if (!esPropio(e)) throw Object.assign(new Error(`error ajeno: ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`), { cause: e });
  }
}

/** Textos con forma de monto, mutados: dígitos, signos, puntos, comas, exponentes y basura. */
const textoMonto = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom('0', '1', '5', '9', '.', ',', '-', '+', 'e', 'E', ' ', ' ', '٣', 'x') , maxLength: 45 }),
  fc.tuple(fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: -40, max: 40 })).map(([d, f, e]) => {
    const t = d.toString();
    return `${t.slice(0, Math.max(1, t.length - f))}.${t.slice(Math.max(1, t.length - f))}e${e}`;
  }),
);
const numeroCualquiera = fc.oneof(fc.double(), fc.integer(), fc.constantFrom(NaN, Infinity, -Infinity, -0, Number.MAX_VALUE, Number.MIN_VALUE, 1e21, 1e-7));
const monto = fc.oneof(textoMonto, numeroCualquiera);

describe('fuzz del núcleo: lectores de montos', () => {
  it('parsearDecimal, redondearDecimal, aCentavos y formatearMonto solo lanzan ErrorMonto', () => {
    fc.assert(
      fc.property(monto, fc.integer({ min: 0, max: 8 }), (v, e) => {
        for (const fn of [() => parsearDecimal(v, e), () => redondearDecimal(v, e), () => aCentavos(v), () => formatearMonto(v)]) {
          try {
            fn();
          } catch (err) {
            expect(err).toBeInstanceOf(ErrorMonto);
          }
        }
      }),
    );
  }, TIEMPO);

  it('montoEnLetras con cualquier monto: letras o un error propio', () => {
    fc.assert(fc.property(monto, (v) => soloPropios(() => montoEnLetras(v))));
    fc.assert(fc.property(fc.bigInt(), (c) => soloPropios(() => centavosEnLetras(c))));
  }, TIEMPO);
});

describe('fuzz del núcleo: números, identificadores y fechas', () => {
  const textoNumero = fc.oneof(
    fc.string(),
    fc.string({ unit: fc.constantFrom('0', '1', '9', '-', ' ', '\t', 'a'), maxLength: 30 }),
    fc.stringMatching(/^\d{3}-\d{3}-\d{2}-\d{8}$/),
  );

  it('parsearNumero solo lanza sus RangeError; esNumeroValido nunca lanza', () => {
    fc.assert(fc.property(textoNumero, (s) => {
      soloPropios(() => parsearNumero(s));
      expect(typeof esNumeroValido(s)).toBe('boolean');
    }));
  }, TIEMPO);

  it('RTN, DNI, CAI y fechas: los predicados nunca lanzan', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => {
      for (const f of [esRTNValido, esDNIValido, esCAIValido, esFechaValida]) expect(typeof f(s)).toBe('boolean');
      expect(typeof formatearRTN(s)).toBe('string');
    }));
  }, TIEMPO);

  it('leerExportacionJSONL con cualquier texto: documentos o ErrorExportacion', () => {
    const linea = fc.oneof(fc.string(), fc.json(), fc.constant('{"numero":'), fc.constant('5'), fc.constant('null'));
    fc.assert(fc.property(fc.array(linea, { maxLength: 5 }), fc.constantFrom('\n', '\r\n'), (ls, fin) => soloPropios(() => leerExportacionJSONL(ls.join(fin)))));
  }, TIEMPO);
});

// Entradas con la forma de los tipos del SDK y valores arbitrarios: lo que llega de un integrador sin TypeScript
// estricto o de la API después de su esquema.
const texto = fc.oneof(fc.string(), fc.string({ unit: 'binary', maxLength: 20 }), fc.constantFrom('', ' ', '99990000000001', '2026-11-18', 'ISV15'));
const lineaArb: fc.Arbitrary<LineaEntrada> = fc.record(
  {
    descripcion: texto,
    cantidad: monto,
    precioUnitario: monto,
    isv: fc.constantFrom('ISV15', 'ISV18', 'GRAVADO0', 'EXENTO', 'ISV99', '') as fc.Arbitrary<LineaEntrada['isv']>,
    descuento: monto,
    codigo: texto,
    unidad: texto,
  },
  { requiredKeys: ['descripcion', 'cantidad', 'precioUnitario'] },
);
const emisorArb = fc.record({
  rtn: texto, razonSocial: texto, nombreComercial: texto, direccionCasaMatriz: texto, direccionEstablecimiento: texto, telefono: texto, correo: texto,
});
const entradaArb: fc.Arbitrary<DocumentoEntrada> = fc.record(
  {
    tipoDocumento: fc.constantFrom('01', '04', '06', '07', '09', '99') as fc.Arbitrary<DocumentoEntrada['tipoDocumento']>,
    emisor: emisorArb,
    cliente: fc.record({
      nombre: texto,
      rtn: texto,
      identificacion: fc.record({ tipo: fc.constantFrom('DNI', 'RTN', 'PASAPORTE', 'OTRO') as fc.Arbitrary<'DNI'>, numero: texto }),
      direccion: texto,
    }, { requiredKeys: [] }),
    lineas: fc.array(lineaArb, { maxLength: 4 }),
    fechaEmision: fc.oneof(texto, fc.constant('2026-11-18')),
    moneda: fc.constantFrom('HNL', 'USD', 'EUR') as fc.Arbitrary<'HNL'>,
    tipoCambio: monto,
    preciosIncluyenISV: fc.boolean(),
    exoneracion: fc.record({ ordenCompraExenta: texto, constanciaRegistroExonerado: texto, registroSAG: texto }, { requiredKeys: [] }),
    referencia: fc.record({ cai: texto, numero: fc.oneof(texto, fc.constant('000-001-01-00000001')), fecha: texto, moneda: fc.constantFrom('HNL', 'USD', 'EUR') as fc.Arbitrary<'HNL'>, tipoCambio: monto }, { requiredKeys: ['cai', 'numero', 'fecha'] }),
    motivo: texto,
    observaciones: texto,
    operador: texto,
  },
  { requiredKeys: ['emisor', 'lineas'] },
);
const autorizacionArb: fc.Arbitrary<AutorizacionCAI> = fc.record({
  cai: texto,
  tipoDocumento: fc.constantFrom('01', '06', '07', '09', '99') as fc.Arbitrary<'01'>,
  establecimiento: fc.oneof(texto, fc.integer()),
  puntoEmision: fc.oneof(texto, fc.integer()),
  rangoInicial: fc.oneof(fc.integer(), fc.double()),
  rangoFinal: fc.oneof(fc.integer(), fc.double()),
  fechaLimiteEmision: fc.oneof(texto, fc.constant('2027-06-30')),
});

describe('fuzz del núcleo: validación de documentos', () => {
  it('validarLineas y validarAutorizacion devuelven problemas, nunca lanzan', () => {
    fc.assert(fc.property(fc.array(lineaArb, { maxLength: 6 }), autorizacionArb, (ls, aut) => {
      expect(Array.isArray(validarLineas(ls))).toBe(true);
      expect(Array.isArray(validarAutorizacion(aut))).toBe(true);
    }));
  }, TIEMPO);

  it('calcularDocumento: totales o ErrorCalculo', () => {
    fc.assert(fc.property(fc.array(lineaArb, { maxLength: 6 }), fc.boolean(), fc.boolean(), (ls, incluye, exonerado) =>
      soloPropios(() => calcularDocumento(ls, { preciosIncluyenISV: incluye, exonerado }))));
  }, TIEMPO);

  it('validarEntrada nunca lanza y construirDocumento solo lanza ErrorValidacion', () => {
    fc.assert(fc.property(entradaArb, autorizacionArb, fc.integer({ min: -5, max: 100_000_000 }), (entrada, aut, correlativo) => {
      const v = validarEntrada(entrada, aut);
      expect(v.ok).toBe(v.errores.length === 0);
      try {
        construirDocumento(entrada, aut, correlativo);
      } catch (e) {
        expect(e, (e as Error).message).toBeInstanceOf(ErrorValidacion);
      }
    }));
  }, TIEMPO);
});
