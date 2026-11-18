/**
 * DEC-018: las notas se emiten en lempiras (Arts. 26 num. 9 y 28 num. 8). Si la factura original está en
 * moneda extranjera, la nota convierte con el tipo de cambio del original y lo imprime como referencia.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  emitir,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  validarEntrada,
  type DocumentoEntrada,
  type DocumentoFiscal,
} from '../src';

const EMISOR = {
  rtn: '08011999123456', razonSocial: 'Exportadora Ejemplo', nombreComercial: 'Exportadora Ejemplo',
  direccionCasaMatriz: 'San Pedro Sula', direccionEstablecimiento: 'San Pedro Sula', telefono: '2550-0000', correo: 'e@ejemplo.hn',
};
const CLIENTE = { nombre: 'Importadora Norte', rtn: '08019005123456' };
const aut = (tt: '01' | '06', cai: string) => ({
  cai, tipoDocumento: tt, establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
});
const caja = { establecimiento: '000', puntoEmision: '001' };
let almacen: AlmacenFiscalMemoria;
let factura: DocumentoFiscal;
const nota = (ref: Partial<NonNullable<DocumentoEntrada['referencia']>> = {}, precio = '10.00'): DocumentoEntrada => ({
  tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución de 1 unidad',
  referencia: { cai: factura.cai, numero: factura.numero, fecha: factura.fechaEmision, ...ref },
  lineas: [{ descripcion: 'Café 1 kg', cantidad: 1, precioUnitario: precio }],
});
const codigoAlEmitir = (e: DocumentoEntrada) =>
  emitir(e, { almacen, ...caja }).then(
    () => 'OK',
    (err: { errores: { codigo: string }[] }) => err.errores.map((p) => p.codigo).join(','),
  );

beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01'));
  await registrarAutorizacion(almacen, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'));
  factura = await emitir({
    emisor: EMISOR, cliente: CLIENTE, moneda: 'USD', tipoCambio: '24.7123',
    lineas: [{ descripcion: 'Café 1 kg', cantidad: 3, precioUnitario: '10.00' }],
  }, { almacen, ...caja });
});

describe('DEC-018 · nota sobre una factura en moneda extranjera', () => {
  it('se emite en lempiras con el tipo de cambio del original, tomado del almacén, y lo imprime', async () => {
    const nc = await emitir(nota(), { almacen, ...caja });
    expect(nc.moneda).toBe('HNL');
    expect(nc.lineas[0]!.precioUnitario).toBe(247.123); // 10.00 USD × 24.7123
    expect(nc.totales.importeGravado15).toBe(247.12);
    expect(nc.totales.total).toBe(284.19); // 247.12 + 37.07 (Art. 9)
    expect(nc.referencia).toMatchObject({ moneda: 'USD', tipoCambio: 24.7123 });
    expect(nc.advertencias).toEqual([]);
    expect(renderizarTexto(nc, { ancho: 100 })).toContain('Original en USD; tipo de cambio L 24.7123. Importes convertidos a lempiras.');
    expect(renderizarHTML(nc)).toContain('tipo de cambio L 24.7123');
  });

  it('un tipo de cambio o una moneda distintos de los del original son error', async () => {
    expect(await codigoAlEmitir(nota({ moneda: 'USD', tipoCambio: '25' }))).toBe('REFERENCIA_TIPO_CAMBIO_NO_COINCIDE');
    expect(await codigoAlEmitir(nota({ moneda: 'HNL' }))).toBe('REFERENCIA_MONEDA_NO_COINCIDE');
  });

  it('original fuera del almacén: hay que indicar moneda y tipo de cambio', async () => {
    const externa = { cai: 'FFFFFF-D4E5F6-A1B2C3-D4E5F6-A1B2C3-99', numero: '000-002-01-00000005', fecha: '2026-10-01' };
    const sinTC = nota({ ...externa, moneda: 'USD' });
    expect(validarEntrada(sinTC, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06')).errores.map((p) => p.codigo)).toEqual(['REFERENCIA_TIPO_CAMBIO']);
    const nc = await emitir(nota({ ...externa, moneda: 'USD', tipoCambio: '24.5' }, '2.50'), { almacen, ...caja });
    expect(nc.lineas[0]!.precioUnitario).toBe(61.25);
    expect(nc.advertencias.map((p) => p.codigo)).toEqual(['AVISO_ORIGINAL_EXTERNO']);
  });

  it('la nota misma sigue sin poder emitirse en moneda extranjera (NOTA_MONEDA)', async () => {
    expect(await codigoAlEmitir({ ...nota(), moneda: 'USD', tipoCambio: '24.7123' })).toBe('NOTA_MONEDA');
  });
});
