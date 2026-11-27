/**
 * Documentos no utilizados (Reglamento Art. 42) y aviso de renovación (Art. 59).
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  decimoDiaHabilDelMesSiguiente,
  documentosNoUtilizados,
  emitir,
  esErrorValidacion,
  estadoAutorizacion,
  noUtilizadosDelAlmacen,
  registrarAutorizacion,
  type AlmacenFiscal,
  type AutorizacionCAI,
} from '../src';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2026-10-31',
};

describe('Art. 42: plazo de «diez (10) días hábiles del mes siguiente»', () => {
  it('cuenta lunes a viernes desde el día 1 del mes siguiente', () => {
    // Noviembre 2026 empieza en domingo: hábiles 2-6 y 9-13.
    expect(decimoDiaHabilDelMesSiguiente('2026-10-31')).toBe('2026-11-13');
    expect(decimoDiaHabilDelMesSiguiente('2026-10-01')).toBe('2026-11-13');
  });
  it('descuenta los feriados que se le pasen', () => {
    expect(decimoDiaHabilDelMesSiguiente('2026-10-31', ['2026-11-03', '2026-11-04'])).toBe('2026-11-17');
  });
  it('de diciembre pasa a enero del año siguiente', () => {
    // Enero 2027 empieza en viernes: 1, 4-8, 11-14.
    expect(decimoDiaHabilDelMesSiguiente('2026-12-15')).toBe('2027-01-14');
  });
});

describe('Art. 42: rangos no utilizados', () => {
  it('Art. 42 num. 1: autorización vencida con 40 números libres', () => {
    const r = documentosNoUtilizados([AUT], 60, { hoy: '2026-11-05' });
    expect(r).toEqual([{
      cai: AUT.cai, identificador: '000-001-01', desde: 61, hasta: 100, cantidad: 40,
      causal: 1, descripcionCausal: 'Vencimiento del plazo de vigencia de la autorización',
      fechaEvento: '2026-10-31', fechaLimiteAviso: '2026-11-13', avisoVencido: false,
    }]);
    expect(documentosNoUtilizados([AUT], 60, { hoy: '2026-11-14' })[0]!.avisoVencido).toBe(true);
  });

  it('sin emisiones, todo el rango; rango agotado, nada', () => {
    expect(documentosNoUtilizados([AUT], null, { hoy: '2026-11-05' })[0]).toMatchObject({ desde: 1, cantidad: 100 });
    expect(documentosNoUtilizados([AUT], 100, { hoy: '2026-11-05' })).toEqual([]);
  });

  it('una autorización vigente sin acontecimiento no se reporta', () => {
    expect(documentosNoUtilizados([AUT], 10, { hoy: '2026-10-31' })).toEqual([]);
  });

  it('Art. 42 num. 5: baja del punto de emisión deja sin uso lo restante de una autorización vigente', () => {
    const r = documentosNoUtilizados([AUT], 10, { hoy: '2026-10-20', evento: { causal: 5, fecha: '2026-10-20' } });
    expect(r).toMatchObject([{ desde: 11, cantidad: 90, causal: 5, descripcionCausal: 'Baja del punto de emisión', fechaLimiteAviso: '2026-11-13' }]);
  });

  it('con varias autorizaciones, cada una con su rango y su causal', () => {
    const segunda: AutorizacionCAI = { ...AUT, cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-02', rangoInicial: 101, rangoFinal: 200, fechaLimiteEmision: '2027-06-30' };
    const r = documentosNoUtilizados([segunda, AUT], 150, { hoy: '2026-12-01', evento: { causal: 4, fecha: '2026-12-01' } });
    // La primera ya está agotada (150 > 100); la segunda queda sin uso desde 151 por cese de operaciones.
    expect(r).toMatchObject([{ cai: segunda.cai, desde: 151, hasta: 200, causal: 4, fechaLimiteAviso: '2027-01-14' }]);
  });

  it('respeta lo emitido antes de la migración (ultimoEmitidoAntes)', () => {
    expect(documentosNoUtilizados([{ ...AUT, ultimoEmitidoAntes: 90 }], null, { hoy: '2026-11-05' })[0]).toMatchObject({ desde: 91, cantidad: 10 });
  });

  it('desde el almacén: usa el último correlativo de la serie', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const reloj = () => new Date('2026-10-30T15:00:00Z');
    await registrarAutorizacion(almacen, AUT, { reloj });
    const emisor = { rtn: '99990000000001', razonSocial: 'X', nombreComercial: 'X', direccionCasaMatriz: 'X', direccionEstablecimiento: 'X', telefono: '0000-0001', correo: 'x@ejemplo.example' };
    for (let i = 0; i < 3; i++) {
      await emitir({ emisor, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, { almacen, establecimiento: '000', puntoEmision: '001', opciones: { reloj } });
    }
    expect(await noUtilizadosDelAlmacen(almacen, '000-001-01', { hoy: '2026-11-02' })).toMatchObject([{ desde: 4, cantidad: 97 }]);
  });
});

describe('Art. 42: números saltados de una autorización vencida', () => {
  it('se siguen reportando después de que la serie continúa en la autorización siguiente', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const A = { ...AUT, rangoFinal: 10 };
    const B: AutorizacionCAI = { ...AUT, cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-0B', rangoInicial: 11, rangoFinal: 20, fechaLimiteEmision: '2027-06-30' };
    const antes = () => new Date('2026-10-30T15:00:00Z');
    const despues = () => new Date('2026-11-02T15:00:00Z');
    await registrarAutorizacion(almacen, A, { reloj: antes });
    await registrarAutorizacion(almacen, B, { reloj: antes });
    const emisor = { rtn: '99990000000001', razonSocial: 'X', nombreComercial: 'X', direccionCasaMatriz: 'X', direccionEstablecimiento: 'X', telefono: '0000-0001', correo: 'x@ejemplo.example' };
    const vender = (reloj: () => Date) => emitir({ emisor, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, { almacen, establecimiento: '000', puntoEmision: '001', opciones: { reloj } });
    for (let i = 0; i < 5; i++) await vender(antes);
    const esperado = [{ cai: A.cai, desde: 6, hasta: 10, cantidad: 5, causal: 1, fechaLimiteAviso: '2026-11-13' }];
    expect(await noUtilizadosDelAlmacen(almacen, '000-001-01', { hoy: '2026-11-02' })).toMatchObject(esperado);
    // A venció: la serie salta a B (Art. 62) y emite el 11.
    expect((await vender(despues)).correlativo).toBe(11);
    expect(await noUtilizadosDelAlmacen(almacen, '000-001-01', { hoy: '2026-11-02' })).toMatchObject(esperado);
  });
  it('documentosNoUtilizados acepta el último emitido por autorización', () => {
    const r = documentosNoUtilizados([{ ...AUT, rangoFinal: 10 }], (a) => (a.cai === AUT.cai ? 5 : null), { hoy: '2026-11-02' });
    expect(r).toMatchObject([{ desde: 6, hasta: 10 }]);
  });
});

describe('Art. 59: aviso de renovación «dentro de los dos (2) meses previos»', () => {
  const aut = { ...AUT, fechaLimiteEmision: '2027-01-31' };
  it('avisa por defecto desde que se abre la ventana de dos meses de calendario', () => {
    const codigos = (hoy: string) => estadoAutorizacion(aut, 1, { hoy }).alertas.map((a) => a.codigo);
    expect(codigos('2026-11-30')).toEqual(['AVISO_VENCIMIENTO']); // 31/01 − 2 meses = 30/11 (no hay 31/11)
    expect(codigos('2026-12-15')).toEqual(['AVISO_VENCIMIENTO']);
    expect(codigos('2026-11-29')).toEqual([]);
    const marzo = { ...AUT, fechaLimiteEmision: '2027-03-15' };
    expect(estadoAutorizacion(marzo, 1, { hoy: '2027-01-15' }).alertas.map((a) => a.codigo)).toEqual(['AVISO_VENCIMIENTO']);
    expect(estadoAutorizacion(marzo, 1, { hoy: '2027-01-14' }).alertas).toEqual([]);
  });
  it('se puede ajustar con diasAviso', () => {
    expect(estadoAutorizacion(aut, 1, { hoy: '2026-12-03', diasAviso: 30 }).alertas).toEqual([]);
  });
});

describe('noUtilizadosDelAlmacen: el identificador se valida y la consulta no crea series', () => {
  /** Almacén que cuenta las series que se bloquean (en un adaptador real, bloquear una serie nueva la crea). */
  const conConteo = (almacen: AlmacenFiscalMemoria) => {
    const bloqueadas: string[] = [];
    const espia: AlmacenFiscal = {
      transaccion: (fn) => almacen.transaccion((tx) => fn({ ...tx, bloquearSerie: (id: string) => (bloqueadas.push(id), tx.bloquearSerie(id)) })),
    };
    return { espia, bloqueadas };
  };

  it('uno mal escrito da IDENTIFICADOR, no «nada que avisar»', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, AUT, { reloj: () => new Date('2026-10-30T15:00:00Z') });
    const { espia, bloqueadas } = conConteo(almacen);
    for (const id of ['000-1-01', '0000101', '000-001-01 ', '000-001', 'basura-xyz', '000-001-99']) {
      const e = await noUtilizadosDelAlmacen(espia, id, { hoy: '2026-11-26' }).then(() => null, (x: unknown) => x);
      expect([id, esErrorValidacion(e) ? e.errores[0]!.codigo : e]).toEqual([id, 'IDENTIFICADOR']);
    }
    expect(bloqueadas).toEqual([]);
    expect(await noUtilizadosDelAlmacen(espia, '000-001-01', { hoy: '2026-11-26' })).toMatchObject([{ desde: 1, hasta: 100 }]);
  });

  it('una serie sin autorizaciones devuelve [] sin bloquearla (no la crea)', async () => {
    const { espia, bloqueadas } = conConteo(new AlmacenFiscalMemoria());
    expect(await noUtilizadosDelAlmacen(espia, '000-009-01')).toEqual([]);
    expect(bloqueadas).toEqual([]);
  });
});
