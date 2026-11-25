/**
 * Segunda revisión del Lote 2 (M4 y DEC-091): un punto de emisión pasa de prueba a real, nunca al revés. Una base
 * de la 0.2.0 tiene CAI de demostración `DEMO00-…` sin `prueba: true` junto a CAI reales en el mismo punto:
 * registrar CAI reales sigue funcionando, y la demo del punto queda retirada.
 */
import { describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, buscarDocumento, documentosNoUtilizados, emitir, registrarAutorizacion, renderizarTexto, type AutorizacionCAI } from '../src';
import { autorizacionDemo, crearFacturadorDemo, EMISOR_DEMO, LEYENDA_PRUEBA } from '../src/demo';

const venta = { emisor: EMISOR_DEMO, lineas: [{ descripcion: 'Café 1 lb', cantidad: '1', precioUnitario: '100.00' }] };
const caja = { establecimiento: '000', puntoEmision: '001' };
const real = (tipoDocumento: AutorizacionCAI['tipoDocumento'], rangoInicial: number, rangoFinal: number, sufijo = '01'): AutorizacionCAI => ({
  cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${sufijo}`,
  tipoDocumento,
  ...caja,
  rangoInicial,
  rangoFinal,
  fechaLimiteEmision: '2027-12-31',
});

/** Guarda autorizaciones como las dejó la 0.2.0, sin las validaciones de hoy. */
async function comoEn020(almacen: AlmacenFiscalMemoria, ...autorizaciones: AutorizacionCAI[]) {
  await almacen.transaccion(async (tx) => {
    for (const a of autorizaciones) await tx.guardarAutorizacion(a);
  });
}

describe('base de la 0.2.0: CAI de demostración sin `prueba` junto a CAI reales', () => {
  const reloj = () => new Date('2026-11-24T15:00:00Z');
  const demoVencido: AutorizacionCAI = {
    cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01',
    tipoDocumento: '01',
    ...caja,
    rangoInicial: 1,
    rangoFinal: 5000,
    fechaLimiteEmision: '2026-03-31',
  };

  it('un CAI de prueba vencido no impide registrar CAI reales en el mismo punto, del mismo tipo o de otro', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await comoEn020(almacen, demoVencido, real('01', 5001, 10000));
    await expect(registrarAutorizacion(almacen, real('01', 10001, 20000, '02'), { reloj })).resolves.toMatchObject({ rangoInicial: 10001 });
    await expect(registrarAutorizacion(almacen, real('06', 1, 500, '03'), { reloj })).resolves.toMatchObject({ tipoDocumento: '06' });
    // Y la emisión sigue con el CAI real.
    const doc = await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    expect(doc.cai).toBe('A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01');
  });

  it('un CAI real vencido impide registrar después uno de prueba en ese punto (tuvo una real)', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await comoEn020(almacen, { ...real('01', 1, 100), fechaLimiteEmision: '2026-01-31' });
    await expect(registrarAutorizacion(almacen, autorizacionDemo({ hoy: '2026-11-24', rangoInicial: 101, rangoFinal: 200 }), { reloj }))
      .rejects.toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }] });
  });
});

describe('de demo a real en el mismo almacén: la demo del punto queda retirada', () => {
  const reloj = () => new Date('2026-11-24T15:00:00Z');
  const hoy = '2026-11-24';

  it('demo vigente sin documentos, luego el CAI real del mismo tipo: se acepta y la siguiente emisión es real, sin leyenda', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, autorizacionDemo({ hoy, rangoFinal: 1000 }), { reloj });
    await registrarAutorizacion(almacen, autorizacionDemo({ hoy, tipoDocumento: '06', rangoFinal: 1000 }), { reloj });
    await expect(registrarAutorizacion(almacen, real('01', 1, 500), { reloj })).resolves.toMatchObject({ cai: real('01', 1, 500).cai });
    const doc = await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    expect(doc).toMatchObject({ numero: '000-001-01-00000001', cai: real('01', 1, 500).cai });
    expect(doc.modo).toBeUndefined();
    expect(renderizarTexto(doc)).not.toContain(LEYENDA_PRUEBA);
    // La demo del punto queda retirada en todos los tipos: la nota de crédito ya no la usa.
    const nota = emitir({ ...venta, tipoDocumento: '06', motivo: 'Devolución', referencia: undefined } as never, { almacen, ...caja, opciones: { reloj } });
    await expect(nota).rejects.toMatchObject({ errores: expect.arrayContaining([expect.objectContaining({ codigo: 'SIN_AUTORIZACION' })]) });
  });

  it('con documentos de prueba ya emitidos, el rango real no puede repetir sus números', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, autorizacionDemo({ hoy, rangoFinal: 1000 }), { reloj });
    const prueba = await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    await expect(registrarAutorizacion(almacen, real('01', 1, 500), { reloj })).rejects.toMatchObject({
      errores: [{ codigo: 'RANGO_USADO_EN_PRUEBA', solucion: expect.any(String) }],
    });
    await registrarAutorizacion(almacen, real('01', 3, 500), { reloj });
    const doc = await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    expect(doc).toMatchObject({ correlativo: 3, cai: real('01', 3, 500).cai });
    expect(doc.modo).toBeUndefined();
    // Los de prueba quedan como estaban.
    expect(await buscarDocumento(almacen, prueba.numero)).toMatchObject({ modo: 'prueba' });
  });

  it('punto real, luego demo: se rechaza', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, real('01', 1, 500), { reloj });
    await expect(registrarAutorizacion(almacen, autorizacionDemo({ hoy, tipoDocumento: '06' }), { reloj }))
      .rejects.toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }] });
  });
});

describe('no utilizados (Art. 42): las autorizaciones de prueba no se reportan al SAR', () => {
  it('un CAI ficticio vencido, con o sin prueba: true, no deja rangos por reportar; el real de la serie sí', () => {
    const demo: AutorizacionCAI = { cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01', tipoDocumento: '01', ...caja, rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: '2026-03-31' };
    expect(documentosNoUtilizados([demo], 10, { hoy: '2026-11-24' })).toEqual([]);
    expect(documentosNoUtilizados([{ ...demo, prueba: true }], 10, { hoy: '2026-11-24' })).toEqual([]);
    const vencida = { ...real('01', 5001, 6000), fechaLimiteEmision: '2026-10-31' };
    expect(documentosNoUtilizados([demo, vencida], () => null, { hoy: '2026-11-24' }).map((r) => r.cai)).toEqual([vencida.cai]);
  });
});

describe('crearFacturadorDemo: renovación sin correlativos libres', () => {
  it('si el rango ya llega a 99 999 999, error DEMO_SIN_NUMEROS en vez de un rango invertido', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const vieja = { ...autorizacionDemo({ hoy: '2025-01-10', rangoInicial: 99_000_001, rangoFinal: 99_999_999 }), fechaLimiteEmision: '2025-07-09' };
    await comoEn020(almacen, vieja);
    const e = await crearFacturadorDemo({ almacen, tipos: ['01'] }).catch((x: unknown) => x);
    expect(e).toMatchObject({ errores: [{ codigo: 'DEMO_SIN_NUMEROS', solucion: expect.stringContaining('otro almacén') }] });
    expect((e as Error).message).toContain('99999999');
  });
});
