import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  crearFacturador,
  emitir,
  eventosAuditoria,
  registrarAutorizacion,
  type AlmacenFiscal,
  type AutorizacionCAI,
  type Emisor,
  type LibroContable,
} from '../src';

const EMISOR: Emisor = {
  rtn: '99990000000001', razonSocial: 'Comercial Ejemplo S. de R.L.', nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001', correo: 'ventas@ejemplo.example',
};
const aut = (tipoDocumento: '01' | '06' | '07' = '01', extra: Partial<AutorizacionCAI> = {}): Omit<AutorizacionCAI, 'establecimiento' | 'puntoEmision'> => ({
  cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${tipoDocumento}`, tipoDocumento, rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30', ...extra,
});
const lineas = [
  { descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' },
  { descripcion: 'Frijoles (lb)', cantidad: '3', precioUnitario: '28.00', isv: 'EXENTO' as const },
];

describe('crearFacturador', () => {
  it('emite lo mismo que emitir con la misma configuración (fachada, no otro camino)', async () => {
    const a = new AlmacenFiscalMemoria();
    const b = new AlmacenFiscalMemoria();
    const f = crearFacturador({ almacen: a, emisor: EMISOR, preciosIncluyenISV: true });
    expect([f.establecimiento, f.puntoEmision]).toEqual(['000', '001']);
    const registrada = await f.registrarAutorizacion(aut());
    expect(registrada).toMatchObject({ establecimiento: '000', puntoEmision: '001' });
    await registrarAutorizacion(b, { ...aut(), establecimiento: '000', puntoEmision: '001' });
    const porFachada = await f.emitir({ lineas });
    const directo = await emitir({ emisor: EMISOR, preciosIncluyenISV: true, lineas }, { almacen: b, establecimiento: '000', puntoEmision: '001' });
    expect(porFachada).toEqual(directo);
    expect(Object.isFrozen(porFachada)).toBe(true);
    // La misma bitácora.
    expect((await eventosAuditoria(a)).map((e) => e.tipo)).toEqual(['AUTORIZACION_REGISTRADA', 'DOCUMENTO_EMITIDO']);
  });

  it('cotizar da el total que se cobrará sin consumir número', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const f = crearFacturador({ almacen, emisor: EMISOR, establecimiento: 2, puntoEmision: '3', preciosIncluyenISV: true });
    await f.registrarAutorizacion(aut());
    const { totales } = f.cotizar({ lineas });
    const doc = await f.emitir({ lineas });
    expect(doc.numero).toBe('002-003-01-00000001');
    expect(doc.totales.total).toBe(totales.total);
  });

  it('valida la configuración al crearse: almacén y emisor', () => {
    expect(() => crearFacturador({ emisor: EMISOR } as unknown as Parameters<typeof crearFacturador>[0])).toThrow(/ALMACEN_REQUERIDO/);
    let error: unknown;
    try {
      crearFacturador({ almacen: new AlmacenFiscalMemoria(), emisor: { ...EMISOR, correo: '', nombreComercial: '' } });
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ errores: [{ codigo: 'EMISOR_NOMBRE_COMERCIAL' }, { codigo: 'EMISOR_CORREO' }] });
  });

  it('notaCredito y notaDebito toman del original el cliente, la referencia y la política de precios', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const f = crearFacturador({ almacen, emisor: EMISOR });
    for (const t of ['01', '06', '07'] as const) await f.registrarAutorizacion(aut(t));
    const factura = await f.emitir({ cliente: { nombre: 'Ferretería Pérez', rtn: '9999-0000-000002' }, preciosIncluyenISV: true, lineas });
    const nc = await f.notaCredito({
      original: factura.numero.replace(/-/g, ''),
      motivo: 'Devolución de 1 bolsa',
      lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }],
    });
    expect(nc).toMatchObject({
      numero: '000-001-06-00000001',
      cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
      referencia: { cai: factura.cai, numero: factura.numero, fecha: factura.fechaEmision },
      preciosIncluyenISV: true,
      advertencias: [],
    });
    const nd = await f.notaDebito({ original: factura.numero, motivo: 'Flete', lineas: [{ descripcion: 'Flete', cantidad: '1', precioUnitario: '50.00' }] });
    expect(nd.numero).toBe('000-001-07-00000001');
  });

  it('una nota sobre un original que no está en el almacén exige referencia y cliente', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const f = crearFacturador({ almacen, emisor: EMISOR });
    await f.registrarAutorizacion(aut('06'));
    const nota = { original: '000-009-01-00000042', motivo: 'Devolución', lineas: [{ descripcion: 'x', cantidad: '1', precioUnitario: '10.00' }] };
    await expect(f.notaCredito(nota)).rejects.toMatchObject({ errores: expect.arrayContaining([expect.objectContaining({ codigo: 'REFERENCIA_CAI' })]) });
    const externa = await f.notaCredito({
      ...nota,
      cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
      referencia: { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-99', fecha: '2026-10-01' },
    });
    expect(externa.advertencias.map((a) => a.codigo)).toEqual(['AVISO_ORIGINAL_EXTERNO']);
  });

  it('anular, documento y documentos', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const registrados: string[] = [];
    const libro: LibroContable = {
      registrarEmision: async (d) => void registrados.push(`+${d.numero}`),
      registrarAnulacion: async (d) => void registrados.push(`-${d.numero}`),
    };
    const f = crearFacturador({ almacen, emisor: EMISOR, actor: 'caja-1', libroContable: libro });
    await f.registrarAutorizacion(aut());
    const doc = await f.emitir({ lineas }, { operador: 'Cajera 1' });
    const anulado = await f.anular(doc.numero, 'Cantidad equivocada', { operador: 'Supervisora' });
    expect(anulado).toMatchObject({ estado: 'ANULADO', anulacion: { motivo: 'Cantidad equivocada' } });
    expect(await f.documento(doc.numero)).toEqual(anulado);
    expect(await f.documento('000-001-01-00000099')).toBeNull();
    expect((await f.documentos({ desde: '2026-11-01' })).map((d) => d.numero)).toEqual([doc.numero]);
    expect(registrados).toEqual([`+${doc.numero}`, `-${doc.numero}`]);
    const eventos = await eventosAuditoria(almacen);
    expect(eventos.slice(1).map((e) => [e.tipo, e.actor, e.operador])).toEqual([
      ['DOCUMENTO_EMITIDO', 'caja-1', 'Cajera 1'],
      ['DOCUMENTO_ANULADO', 'caja-1', 'Supervisora'],
    ]);
  });

  it('el reloj de la configuración manda en todas las operaciones', async () => {
    const almacen: AlmacenFiscal = new AlmacenFiscalMemoria();
    const reloj = () => new Date('2027-01-15T16:00:00Z');
    const f = crearFacturador({ almacen, emisor: EMISOR, reloj });
    await f.registrarAutorizacion(aut());
    const doc = await f.emitir({ lineas });
    expect(doc.fechaEmision).toBe('2027-01-15');
    expect((await f.anular(doc.numero, 'x')).anulacion!.fecha).toBe('2027-01-15');
  });
});
