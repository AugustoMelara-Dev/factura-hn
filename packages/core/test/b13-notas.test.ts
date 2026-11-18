/**
 * B-13 · coherencia de las notas de crédito (06) y débito (07) con el documento que modifican.
 * Reglamento Art. 4 num. 31-32 (definiciones), Art. 6 (Comprobantes Fiscales), Arts. 26 y 28 (requisitos al
 * emitir), Art. 41 (anulación).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  registrarAutorizacion,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoEntrada,
  type DocumentoFiscal,
  type Emisor,
} from '../src';

const EMISOR: Emisor = {
  rtn: '08011999123456', razonSocial: 'Ferretería Ejemplo', nombreComercial: 'Ferretería Ejemplo',
  direccionCasaMatriz: 'Tocoa', direccionEstablecimiento: 'Tocoa', telefono: '2444-0000', correo: 'f@ejemplo.hn',
};
const CLIENTE = { nombre: 'Constructora Pérez', rtn: '08019005123456' };
const aut = (tipo: AutorizacionCAI['tipoDocumento'], cai: string): AutorizacionCAI => ({
  cai, tipoDocumento: tipo, establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
});
const caja = { establecimiento: '000', puntoEmision: '001' };
const nota = (original: Pick<DocumentoFiscal, 'cai' | 'numero' | 'fechaEmision'>, extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  tipoDocumento: '06',
  emisor: EMISOR,
  cliente: CLIENTE,
  referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision },
  motivo: 'Devolución de mercadería',
  lineas: [{ descripcion: 'Clavos', cantidad: 1, precioUnitario: '50' }],
  ...extra,
});

describe('validaciones puras (sin almacén)', () => {
  const AUT_NC = aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06');
  const ref = { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-0F', numero: '000-001-01-00000001', fechaEmision: '2026-11-18' };

  it('Art. 4 num. 32 + Art. 6: la Nota de Crédito solo se aplica a un Comprobante Fiscal', () => {
    const sobreNota = nota({ ...ref, numero: '000-001-07-00000001' });
    expect(validarEntrada(sobreNota, AUT_NC).errores.map((p) => p.codigo)).toEqual(['REFERENCIA_TIPO']);
    const sobreGuia = nota({ ...ref, numero: '000-001-08-00000001' });
    expect(validarEntrada(sobreGuia, AUT_NC).errores.map((p) => p.codigo)).toEqual(['REFERENCIA_TIPO']);
    // Comprobantes Fiscales del Art. 6: factura, boleta de compra, ticket, etc.
    for (const tt of ['01', '09', '11']) {
      expect(validarEntrada(nota({ ...ref, numero: `000-001-${tt}-00000001` }), AUT_NC).ok).toBe(true);
    }
  });

  it('Art. 28 num. 3 b: la Nota de Débito puede aplicarse a «el Comprobante Fiscal o el documento»', () => {
    const nd = nota({ ...ref, numero: '000-001-06-00000001' }, { tipoDocumento: '07' });
    expect(validarEntrada(nd, aut('07', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-07')).ok).toBe(true);
  });

  it('Arts. 26 y 28 num. 3 c: el documento referido no puede tener fecha posterior a la nota', () => {
    const v = validarEntrada(nota({ ...ref, fechaEmision: '2026-11-19' }), AUT_NC);
    expect(v.errores.map((p) => p.codigo)).toEqual(['REFERENCIA_FECHA_POSTERIOR']);
    expect(validarEntrada(nota({ ...ref, fechaEmision: '2026-11-18' }), AUT_NC).ok).toBe(true);
  });
});

describe('contra el almacén, dentro de emitir', () => {
  let almacen: AlmacenFiscalMemoria;
  let factura: DocumentoFiscal;
  beforeEach(async () => {
    almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-0F'));
    await registrarAutorizacion(almacen, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'));
    await registrarAutorizacion(almacen, aut('07', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-07'));
    factura = await emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: [{ descripcion: 'Clavos', cantidad: 2, precioUnitario: '50' }] }, { almacen, ...caja });
  });
  const codigoAlEmitir = async (e: DocumentoEntrada) => {
    try {
      await emitir(e, { almacen, ...caja });
      return 'OK';
    } catch (err) {
      return (err as { errores: { codigo: string }[] }).errores.map((p) => p.codigo).join(',');
    }
  };

  it('nota coherente: se emite sin avisos', async () => {
    const nc = await emitir(nota(factura), { almacen, ...caja });
    expect(nc.numero).toBe('000-001-06-00000001');
    expect(nc.advertencias).toEqual([]);
  });

  it('acepta el número de referencia sin guiones', async () => {
    const nc = await emitir(nota({ ...factura, numero: factura.numero.replace(/-/g, '') }), { almacen, ...caja });
    expect(nc.advertencias).toEqual([]);
  });

  it('Art. 41: no se aplica una nota a un documento ANULADO', async () => {
    await anular(factura.numero, { almacen, motivo: 'Error' });
    expect(await codigoAlEmitir(nota(factura))).toBe('REFERENCIA_ANULADA');
  });

  it('Arts. 26 y 28 num. 3: CAI y fecha de la referencia deben ser los del original', async () => {
    expect(await codigoAlEmitir(nota({ ...factura, cai: 'EEEEEE-D4E5F6-A1B2C3-D4E5F6-A1B2C3-EE' }))).toBe('REFERENCIA_CAI_NO_COINCIDE');
    expect(await codigoAlEmitir(nota({ ...factura, fechaEmision: '2026-11-17' }))).toBe('REFERENCIA_FECHA_NO_COINCIDE');
  });

  it('Arts. 26 y 28 num. 1-2: el adquirente de la nota es el del original (mismo RTN)', async () => {
    const otro = nota(factura, { cliente: { nombre: 'Otro', rtn: '08011985000001' } });
    expect(await codigoAlEmitir(otro)).toBe('REFERENCIA_RTN_NO_COINCIDE');
  });

  it('un número de una autorización de este sistema que no se ha emitido: REFERENCIA_NO_EXISTE', async () => {
    expect(await codigoAlEmitir(nota({ ...factura, numero: '000-001-01-00000050' }))).toBe('REFERENCIA_NO_EXISTE');
  });

  it('DEC-004: original fuera del almacén (talonario de imprenta u otro sistema): se emite con AVISO_ORIGINAL_EXTERNO', async () => {
    const nc = await emitir(nota({ cai: 'FFFFFF-D4E5F6-A1B2C3-D4E5F6-A1B2C3-99', numero: '000-002-01-00000010', fechaEmision: '2026-10-01' }), { almacen, ...caja });
    expect(nc.advertencias.map((p) => p.codigo)).toEqual(['AVISO_ORIGINAL_EXTERNO']);
    expect(nc.referencia).toEqual({ cai: 'FFFFFF-D4E5F6-A1B2C3-D4E5F6-A1B2C3-99', numero: '000-002-01-00000010', fecha: '2026-10-01' });
  });

  it('DEC-004: original emitido antes de la migración (ultimoEmitidoAntes): aviso; la serie continúa después', async () => {
    const migrado = new AlmacenFiscalMemoria();
    await registrarAutorizacion(migrado, { ...aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-0F'), ultimoEmitidoAntes: 40 });
    await registrarAutorizacion(migrado, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'));
    const f = await emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, { almacen: migrado, ...caja });
    expect(f.correlativo).toBe(41);
    const previa = { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-0F', numero: '000-001-01-00000012', fechaEmision: '2026-09-30' };
    const nc = await emitir(nota(previa), { almacen: migrado, ...caja });
    expect(nc.advertencias.map((p) => p.codigo)).toEqual(['AVISO_ORIGINAL_EXTERNO']);
    // Un número de la misma autorización aún no consumido no puede existir.
    const futuro = { ...previa, numero: '000-001-01-00000060' };
    await expect(emitir(nota(futuro), { almacen: migrado, ...caja })).rejects.toMatchObject({ errores: [{ codigo: 'REFERENCIA_NO_EXISTE' }] });
  });

  it('ultimoEmitidoAntes fuera del rango se rechaza al registrar', async () => {
    await expect(registrarAutorizacion(new AlmacenFiscalMemoria(), { ...aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-0F'), ultimoEmitidoAntes: 101 }))
      .rejects.toMatchObject({ errores: [{ codigo: 'ULTIMO_EMITIDO_ANTES' }] });
  });

  it('original sin RTN: aviso para verificar que es el mismo cliente', async () => {
    const cf = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'Clavos', cantidad: 1, precioUnitario: '50' }] }, { almacen, ...caja });
    const nc = await emitir(nota(cf), { almacen, ...caja });
    expect(nc.advertencias.map((p) => p.codigo)).toEqual(['AVISO_ORIGINAL_SIN_RTN']);
  });

  it('un rechazo no consume número de la serie de notas', async () => {
    await codigoAlEmitir(nota({ ...factura, cai: 'EEEEEE-D4E5F6-A1B2C3-D4E5F6-A1B2C3-EE' }));
    expect((await emitir(nota(factura), { almacen, ...caja })).correlativo).toBe(1);
  });
});
