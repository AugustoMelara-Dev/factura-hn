/**
 * Segunda revisión del Lote 2 (M4): una base que viene de la 0.2.0 tiene CAI de demostración `DEMO00-…` sin
 * `prueba: true`, a menudo vencidos, junto a CAI reales en el mismo punto de emisión. `AUTORIZACION_MODO_MEZCLADO`
 * compara solo con las autorizaciones en uso (vigentes y no agotadas): las de prueba vencidas o agotadas no
 * impiden registrar CAI reales.
 */
import { describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, documentosNoUtilizados, emitir, registrarAutorizacion, type AutorizacionCAI } from '../src';
import { autorizacionDemo, crearFacturadorDemo, EMISOR_DEMO } from '../src/demo';

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

  it('un CAI de prueba agotado tampoco lo impide; uno vigente con números libres, sí', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, autorizacionDemo({ hoy: '2026-11-24', rangoFinal: 2 }), { reloj });
    const otroTipo = real('06', 1, 500, '03');
    await expect(registrarAutorizacion(almacen, otroTipo, { reloj })).rejects.toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }] });
    await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    await emitir(venta, { almacen, ...caja, opciones: { reloj } });
    await expect(registrarAutorizacion(almacen, otroTipo, { reloj })).resolves.toMatchObject({ tipoDocumento: '06' });
  });

  it('un CAI real vencido no impide registrar uno de prueba en ese punto', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await comoEn020(almacen, { ...real('01', 1, 100), fechaLimiteEmision: '2026-01-31' });
    await expect(registrarAutorizacion(almacen, autorizacionDemo({ hoy: '2026-11-24', rangoInicial: 101, rangoFinal: 200 }), { reloj })).resolves.toMatchObject({
      prueba: true,
    });
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
