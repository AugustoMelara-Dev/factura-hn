/**
 * Una entrada con un tipo equivocado (un texto donde va un booleano, un número donde va un texto) se rechaza con
 * un `ErrorValidacion` que dice qué hacer, sin consumir número. Nunca se toma un texto como `true` ni se guarda
 * deformado en el documento.
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  calcularDocumento,
  crearFacturador,
  emitir,
  esErrorValidacion,
  montoEnLetras,
  registrarAutorizacion,
  type AutorizacionCAI,
  type DocumentoEntrada,
} from '../src';
import { EMISOR_DEMO } from '../src/demo';

const caja = { establecimiento: '000', puntoEmision: '001' };
const aut: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', ...caja,
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2099-12-31',
};
const lineas = [{ descripcion: 'Arroz', cantidad: '1', precioUnitario: '100.00' }];

async function preparar() {
  const almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, aut);
  return almacen;
}

/** Código del primer error de validación, o el nombre del error si no es de validación. */
async function codigoDe(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === 'function' ? p() : p);
    return 'OK';
  } catch (e) {
    return esErrorValidacion(e) ? e.errores.map((x) => x.codigo).join(',') : (e as Error).name;
  }
}

describe('preciosIncluyenISV es booleano', () => {
  it('emitir con un texto o un número da PRECIOS_INCLUYEN_ISV_FORMATO y no consume número', async () => {
    const almacen = await preparar();
    for (const valor of ['false', 'true', 1, 'no', null]) {
      const entrada = { emisor: EMISOR_DEMO, lineas, preciosIncluyenISV: valor } as unknown as DocumentoEntrada;
      expect(await codigoDe(emitir(entrada, { almacen, ...caja }))).toBe('PRECIOS_INCLUYEN_ISV_FORMATO');
    }
    const doc = await emitir({ emisor: EMISOR_DEMO, lineas, preciosIncluyenISV: false }, { almacen, ...caja });
    expect(doc.correlativo).toBe(1);
    expect(doc.totales.total).toBe(115);
    expect(doc.preciosIncluyenISV).toBe(false);
  });

  it('crearFacturador falla al crearse; cotizar y emitir de la venta también', async () => {
    const almacen = await preparar();
    const mal = { almacen, emisor: EMISOR_DEMO, preciosIncluyenISV: 'false' } as unknown as Parameters<typeof crearFacturador>[0];
    expect(await codigoDe(() => crearFacturador(mal))).toBe('PRECIOS_INCLUYEN_ISV_FORMATO');
    const caja2 = crearFacturador({ almacen, emisor: EMISOR_DEMO });
    const venta = { lineas, preciosIncluyenISV: 'false' } as unknown as Parameters<typeof caja2.emitir>[0];
    expect(await codigoDe(() => caja2.cotizar(venta))).toBe('PRECIOS_INCLUYEN_ISV_FORMATO');
    expect(await codigoDe(caja2.emitir(venta))).toBe('PRECIOS_INCLUYEN_ISV_FORMATO');
    expect((await caja2.emitir({ lineas })).correlativo).toBe(1);
  });

  it('calcularDocumento no toma un texto como verdadero', () => {
    const opciones = { preciosIncluyenISV: 'false' } as unknown as Parameters<typeof calcularDocumento>[1];
    expect(() => calcularDocumento(lineas, opciones)).toThrow(/preciosIncluyenISV.*true o false/);
  });
});

describe('moneda: HNL o USD', () => {
  it('emitir con EUR o usd da MONEDA sin consumir número (no un TypeError)', async () => {
    const almacen = await preparar();
    for (const moneda of ['EUR', 'usd', 7]) {
      const entrada = { emisor: EMISOR_DEMO, lineas, moneda, tipoCambio: '27' } as unknown as DocumentoEntrada;
      expect(await codigoDe(emitir(entrada, { almacen, ...caja }))).toBe('MONEDA');
    }
    expect((await emitir({ emisor: EMISOR_DEMO, lineas, moneda: 'USD', tipoCambio: '24.5' }, { almacen, ...caja })).correlativo).toBe(1);
  });

  it('cotizar y calcularDocumento lo dicen con su código; montoEnLetras con un RangeError claro', async () => {
    const caja2 = crearFacturador({ almacen: await preparar(), emisor: EMISOR_DEMO });
    const venta = { lineas, moneda: 'EUR' } as unknown as Parameters<typeof caja2.cotizar>[0];
    expect(await codigoDe(() => caja2.cotizar(venta))).toBe('MONEDA');
    const opciones = { moneda: 'EUR' } as unknown as Parameters<typeof calcularDocumento>[1];
    expect(() => calcularDocumento(lineas, opciones)).toThrow(/moneda debe ser 'HNL' o 'USD'/);
    expect(() => montoEnLetras(5, 'EUR' as 'HNL')).toThrow(/Moneda no soportada: "EUR". Usa 'HNL' o 'USD'/);
  });
});
