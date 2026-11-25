/**
 * Con el original en el almacén, una nota de crédito no puede llevar el acumulado de notas por
 * encima del total del original ni usar otra tasa de ISV (Art. 4 num. 32: ajuste, devolución o descuento sobre el
 * «correspondiente» comprobante). Con un original externo solo queda el aviso AVISO_ORIGINAL_EXTERNO.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  ErrorValidacion,
  registrarAutorizacion,
  type AlmacenFiscal,
  type DocumentoEntrada,
  type DocumentoFiscal,
} from '../src';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Ferretería Ejemplo', nombreComercial: 'Ferretería Ejemplo',
  direccionCasaMatriz: 'Tegucigalpa', direccionEstablecimiento: 'Tegucigalpa', telefono: '0000-0003', correo: 'f@ejemplo.example',
};
const CLIENTE = { nombre: 'Constructora Norte', rtn: '99990000000002' };
const caja = { establecimiento: '000', puntoEmision: '001' };
const MARTILLO = (cantidad: number) => [{ descripcion: 'Martillo', cantidad, precioUnitario: '100.00' }];

export async function prepararAlmacen(almacen: AlmacenFiscal): Promise<void> {
  for (const [tt, cai, punto] of [
    ['01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', '001'],
    ['06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06', '001'],
    ['06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-07', '002'],
  ] as const) {
    await registrarAutorizacion(almacen, {
      cai, tipoDocumento: tt, establecimiento: '000', puntoEmision: punto, rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2099-12-31',
    });
  }
}

let almacen: AlmacenFiscalMemoria;
beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  await prepararAlmacen(almacen);
});

const factura = (extra: Partial<DocumentoEntrada> = {}) =>
  emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: MARTILLO(1), ...extra }, { almacen, ...caja });
const nota = (original: DocumentoFiscal, lineas: DocumentoEntrada['lineas'], punto = '001') =>
  emitir({
    tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución',
    referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision }, lineas,
  }, { almacen, establecimiento: '000', puntoEmision: punto });
const errorDe = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => {
      if (!(e instanceof ErrorValidacion)) throw e;
      return e.errores;
    },
  );

describe('nota de crédito contra su original en el almacén (Art. 4 num. 32)', () => {
  it('una nota dentro del total y con la misma tasa se emite sin avisos', async () => {
    const nc = await nota(await factura(), MARTILLO(1));
    expect(nc.numero).toBe('000-001-06-00000001');
    expect(nc.advertencias).toEqual([]);
  });

  it('una nota que sola supera el original es NOTA_SUPERA_ORIGINAL, con el saldo, y no consume número', async () => {
    const f = await factura(); // L 115.00
    const errores = await errorDe(nota(f, MARTILLO(10))); // L 1,150.00
    expect(errores!.map((p) => p.codigo)).toEqual(['NOTA_SUPERA_ORIGINAL']);
    expect(errores![0]!.mensaje).toContain('L 1,150.00');
    expect(errores![0]!.mensaje).toContain('saldo disponible L 115.00');
    expect((await nota(f, MARTILLO(1))).numero).toBe('000-001-06-00000001');
  });

  it('el acumulado de varias notas, también de otro punto de emisión, no puede superar el original', async () => {
    const f = await factura({ lineas: MARTILLO(3) }); // L 345.00
    await nota(f, MARTILLO(1)); // 115 → saldo 230
    await nota(f, MARTILLO(1), '002'); // 115 → saldo 115
    const errores = await errorDe(nota(f, MARTILLO(2))); // 230 > 115
    expect(errores!.map((p) => p.codigo)).toEqual(['NOTA_SUPERA_ORIGINAL']);
    expect(errores![0]!.mensaje).toMatch(/ya acreditado L 230\.00 en 2 nota\(s\), saldo disponible L 115\.00/);
    // Justo el saldo sí cabe; después ya no queda nada.
    await nota(f, MARTILLO(1));
    const agotado = await errorDe(nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '0.01' }]));
    expect(agotado![0]!.mensaje).toContain('saldo disponible L 0.00');
  });

  it('una nota anulada libera su importe', async () => {
    const f = await factura(); // L 115.00
    const nc = await nota(f, MARTILLO(1));
    expect(await errorDe(nota(f, MARTILLO(1)))).not.toBeNull();
    await anular(nc.numero, { almacen, motivo: 'Nota con error' });
    expect((await nota(f, MARTILLO(1))).numero).toBe('000-001-06-00000002');
  });

  it('ISV sobre un original exonerado, o a una tasa que el original no tenía, es NOTA_TASA_DISTINTA', async () => {
    const exonerada = await factura({ exoneracion: { registroSAG: 'SAG-0001' } });
    // L 115 con ISV sobre una factura exonerada de L 100: también supera el original.
    expect((await errorDe(nota(exonerada, MARTILLO(1))))!.map((p) => p.codigo)).toEqual(['NOTA_SUPERA_ORIGINAL', 'NOTA_TASA_DISTINTA']);
    expect((await errorDe(nota(exonerada, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '50.00' }])))!.map((p) => p.codigo)).toEqual(['NOTA_TASA_DISTINTA']);
    const al15 = await factura();
    const otraTasa = await errorDe(nota(al15, [{ descripcion: 'Cerveza', cantidad: 1, precioUnitario: '10.00', isv: 'ISV18' }]));
    expect(otraTasa!.map((p) => p.codigo)).toEqual(['NOTA_TASA_DISTINTA']);
  });

  it('con un original en dólares compara en lempiras con su tipo de cambio', async () => {
    const usd = await factura({ moneda: 'USD', tipoCambio: '24.70' }); // USD 115.00 = L 2,840.50
    // Las líneas de la nota van en la moneda del original y se convierten (Arts. 26 num. 9 y 28 num. 8): USD 57.50 = L 1,420.25.
    expect((await nota(usd, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '50.00' }])).totales.total).toBe(1420.25);
    const errores = await errorDe(nota(usd, MARTILLO(1))); // USD 115.00 = L 2,840.50 > saldo
    expect(errores![0]!.mensaje).toContain('saldo disponible L 1,420.25');
  });

  it('con un original externo no hay con qué comparar: se emite con AVISO_ORIGINAL_EXTERNO', async () => {
    const externa = {
      cai: 'DEMO00-NO-VALIDO-EXTERNO', numero: '001-001-01-00000099', fecha: '2026-01-15',
    } as unknown as DocumentoFiscal;
    const nc = await emitir({
      tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución',
      referencia: { cai: externa.cai, numero: externa.numero, fecha: (externa as unknown as { fecha: string }).fecha }, lineas: MARTILLO(50),
    }, { almacen, ...caja });
    expect(nc.advertencias.map((p) => p.codigo)).toEqual(['AVISO_ORIGINAL_EXTERNO']);
  });

  it('la referencia se guarda con guiones aunque se escriba sin ellos, y cuenta para el acumulado', async () => {
    const f = await factura(); // L 115.00
    const sinGuiones = await emitir({
      tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución',
      referencia: { cai: f.cai, numero: f.numero.replace(/-/g, ''), fecha: f.fechaEmision }, lineas: MARTILLO(1),
    }, { almacen, ...caja });
    expect(sinGuiones.referencia!.numero).toBe(f.numero);
    expect((await errorDe(nota(f, MARTILLO(1))))!.map((p) => p.codigo)).toEqual(['NOTA_SUPERA_ORIGINAL']);
  });
});
