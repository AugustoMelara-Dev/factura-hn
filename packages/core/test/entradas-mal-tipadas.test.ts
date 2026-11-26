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

describe('entradas mal tipadas: un ErrorValidacion con código, nunca un TypeError', () => {
  const venta = (extra: Record<string, unknown>) => ({ emisor: EMISOR_DEMO, lineas, ...extra }) as unknown as DocumentoEntrada;
  const linea = (extra: Record<string, unknown>) => venta({ lineas: [{ ...lineas[0], ...extra }] });
  const grande = { descripcion: 'Refrigeradora', cantidad: '1', precioUnitario: '20000.00' };
  const nota = (extra: Record<string, unknown>) =>
    venta({
      tipoDocumento: '06', motivo: 'x', cliente: { nombre: 'Ana', rtn: '99990000000002' },
      referencia: { cai: 'X', numero: '000-001-01-00000001', fecha: '2026-01-01' }, ...extra,
    });

  it('cada caso da su código y ninguno consume número', async () => {
    const almacen = await preparar();
    const casos: Array<[string, () => Promise<unknown>]> = [
      ['ENTRADA', () => emitir(null as unknown as DocumentoEntrada, { almacen, ...caja })],
      ['LINEA', () => emitir(venta({ lineas: [null] }), { almacen, ...caja })],
      ['LINEA_DESCRIPCION', () => emitir(linea({ descripcion: 5 }), { almacen, ...caja })],
      ['LINEA', () => emitir(linea({ unidad: 5 }), { almacen, ...caja })],
      ['CLIENTE', () => emitir(venta({ cliente: 'Juan' }), { almacen, ...caja })],
      ['CLIENTE_NOMBRE', () => emitir(venta({ cliente: { nombre: 5 } }), { almacen, ...caja })],
      ['CLIENTE_RTN', () => emitir(venta({ cliente: { nombre: 'Ana', rtn: 9999000000002 } }), { almacen, ...caja })],
      ['EMISOR_NOMBRE', () => emitir({ ...venta({}), emisor: { ...EMISOR_DEMO, razonSocial: 5 } } as unknown as DocumentoEntrada, { almacen, ...caja })],
      ['CLIENTE_IDENTIFICACION', () =>
        emitir(venta({ lineas: [grande], cliente: { nombre: 'Ana', identificacion: { tipo: 'XYZ', numero: '1' } } }), { almacen, ...caja })],
      ['CLIENTE_IDENTIFICACION', () =>
        emitir(venta({ lineas: [grande], cliente: { nombre: 'Ana', identificacion: { tipo: 'DNI', numero: 801199912345 } } }), { almacen, ...caja })],
      ['PUNTO_EMISION', () => emitir(venta({}), { almacen, establecimiento: '000', puntoEmision: '0001' })],
      ['ESTABLECIMIENTO', () => emitir(venta({}), { almacen, establecimiento: 'A', puntoEmision: '001' })],
      ['REFERENCIA_CAI', () => emitir(nota({ referencia: { cai: 5, numero: '000-001-01-00000001', fecha: '2026-01-01' } }), { almacen, ...caja })],
      ['MOTIVO', () => emitir(nota({ motivo: 5 }), { almacen, ...caja })],
    ];
    for (const [codigo, llamada] of casos) expect([codigo, await codigoDe(llamada())]).toEqual([codigo, codigo]);
    // Un tipo de identificación válido sí cuenta como identificado sobre el umbral.
    const ok = await emitir(venta({ lineas: [grande], cliente: { nombre: 'Ana', identificacion: { tipo: 'PASAPORTE', numero: 'X1' } } }), { almacen, ...caja });
    expect(ok.correlativo).toBe(1);
    expect(ok.cliente).toEqual({ nombre: 'Ana', identificacion: { tipo: 'PASAPORTE', numero: 'X1' }, nombreImpreso: 'Ana' });
  });

  it('crearFacturador rechaza un punto de 4 dígitos; anular, un motivo que no es texto', async () => {
    const almacen = await preparar();
    expect(await codigoDe(() => crearFacturador({ almacen, emisor: EMISOR_DEMO, puntoEmision: '0001' }))).toBe('PUNTO_EMISION');
    const f = crearFacturador({ almacen, emisor: EMISOR_DEMO });
    const doc = await f.emitir({ lineas });
    expect(await codigoDe(f.anular(doc.numero, 5 as unknown as string))).toBe('ANULACION_MOTIVO');
    expect((await f.documento(doc.numero))!.estado).toBe('EMITIDO');
  });

  it('calcularDocumento con una línea null da un ErrorCalculo, no un TypeError', () => {
    expect(() => calcularDocumento([null] as unknown as typeof lineas)).toThrow(/Línea 1: debe ser un objeto/);
  });
});

describe('horaEmision: HH:mm válida, y si falta la pone el reloj', () => {
  it("'99:99', 'ayer' o un número dan HORA_EMISION sin consumir número", async () => {
    const almacen = await preparar();
    for (const horaEmision of ['99:99', 'ayer', '24:00', '9:05', 905]) {
      const entrada = { emisor: EMISOR_DEMO, lineas, horaEmision } as unknown as DocumentoEntrada;
      expect([horaEmision, await codigoDe(emitir(entrada, { almacen, ...caja }))]).toEqual([horaEmision, 'HORA_EMISION']);
    }
    const doc = await emitir({ emisor: EMISOR_DEMO, lineas, horaEmision: '23:59' }, { almacen, ...caja });
    expect([doc.correlativo, doc.horaEmision]).toEqual([1, '23:59']);
  });

  it('sin el campo, emitir pone la hora de Honduras del mismo reloj que la fecha', async () => {
    const almacen = await preparar();
    const reloj = () => new Date('2026-11-27T04:30:00Z'); // 26/11 a las 22:30 en Honduras
    const doc = await emitir({ emisor: EMISOR_DEMO, lineas }, { almacen, ...caja, opciones: { reloj } });
    expect([doc.fechaEmision, doc.horaEmision]).toEqual(['2026-11-26', '22:30']);
  });
});
