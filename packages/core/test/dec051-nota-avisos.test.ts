/**
 * DEC-051 [REVISAR]: avisos (no bloquean) de una nota de crédito contra el original guardado. El Art. 4 num. 32 no
 * fija un tope numérico; la nota respalda un ajuste sobre el «correspondiente» comprobante.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, emitir, registrarAutorizacion, type DocumentoEntrada, type DocumentoFiscal } from '../src';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Ferretería Ejemplo', nombreComercial: 'Ferretería Ejemplo',
  direccionCasaMatriz: 'Tegucigalpa', direccionEstablecimiento: 'Tegucigalpa', telefono: '0000-0003', correo: 'f@ejemplo.example',
};
const CLIENTE = { nombre: 'Constructora Norte', rtn: '99990000000002' };
const caja = { establecimiento: '000', puntoEmision: '001' };
let almacen: AlmacenFiscalMemoria;

beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  for (const [tt, cai] of [['01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01'], ['06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06']] as const) {
    await registrarAutorizacion(almacen, {
      cai, tipoDocumento: tt, establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2099-12-31',
    });
  }
});

const factura = (extra: Partial<DocumentoEntrada> = {}) =>
  emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }], ...extra }, { almacen, ...caja });
const nota = (original: DocumentoFiscal, lineas: DocumentoEntrada['lineas'], extra: Partial<DocumentoEntrada> = {}) =>
  emitir({
    tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución',
    referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision }, lineas, ...extra,
  }, { almacen, ...caja });
const codigos = (d: DocumentoFiscal) => d.advertencias.map((p) => p.codigo);

describe('nota de crédito contra su original (DEC-051)', () => {
  it('una nota dentro del total del original y con la misma tasa no avisa nada', async () => {
    const f = await factura();
    const nc = await nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }]);
    expect(codigos(nc)).toEqual([]);
  });

  it('una nota que supera el total del original se emite con AVISO_NOTA_SUPERA_ORIGINAL', async () => {
    const f = await factura(); // L 115.00
    const nc = await nota(f, [{ descripcion: 'Martillo', cantidad: 10, precioUnitario: '100.00' }]); // L 1,150.00
    expect(nc.estado).toBe('EMITIDO');
    expect(codigos(nc)).toContain('AVISO_NOTA_SUPERA_ORIGINAL');
    expect(nc.advertencias.find((p) => p.codigo === 'AVISO_NOTA_SUPERA_ORIGINAL')!.mensaje).toMatch(/1,150\.00.*115\.00/);
  });

  it('una nota con ISV sobre una factura exonerada o a otra tasa avisa AVISO_NOTA_TASA_DISTINTA', async () => {
    const exonerada = await factura({ exoneracion: { registroSAG: 'SAG-0001' } });
    const nc1 = await nota(exonerada, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }]);
    expect(codigos(nc1)).toContain('AVISO_NOTA_TASA_DISTINTA');

    const al15 = await factura();
    const nc2 = await nota(al15, [{ descripcion: 'Cerveza', cantidad: 1, precioUnitario: '10.00', isv: 'ISV18' }]);
    expect(codigos(nc2)).toContain('AVISO_NOTA_TASA_DISTINTA');
  });

  it('una nota sobre un original en dólares compara en lempiras con su tipo de cambio', async () => {
    const usd = await factura({ moneda: 'USD', tipoCambio: '24.70' }); // USD 115.00 = L 2,840.50
    const dentro = await nota(usd, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }]);
    expect(codigos(dentro)).not.toContain('AVISO_NOTA_SUPERA_ORIGINAL');
    const fuera = await nota(usd, [{ descripcion: 'Martillo', cantidad: 2, precioUnitario: '100.00' }]);
    expect(codigos(fuera)).toContain('AVISO_NOTA_SUPERA_ORIGINAL');
  });
});
