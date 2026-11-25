/**
 * Segunda revisión del Lote 2 (M4): una base que viene de la 0.2.0 tiene CAI de demostración `DEMO00-…` sin
 * `prueba: true`, a menudo vencidos, junto a CAI reales en el mismo punto de emisión. `AUTORIZACION_MODO_MEZCLADO`
 * compara solo con las autorizaciones en uso (vigentes y no agotadas): las de prueba vencidas o agotadas no
 * impiden registrar CAI reales.
 */
import { describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, emitir, registrarAutorizacion, type AutorizacionCAI } from '../src';
import { autorizacionDemo, EMISOR_DEMO } from '../src/demo';

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
    const doc = await emitir(venta, { almacen, ...caja, reloj });
    expect(doc.cai).toBe('A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01');
  });

  it('un CAI de prueba agotado tampoco lo impide; uno vigente con números libres, sí', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, autorizacionDemo({ hoy: '2026-11-24', rangoFinal: 2 }), { reloj });
    const otroTipo = real('06', 1, 500, '03');
    await expect(registrarAutorizacion(almacen, otroTipo, { reloj })).rejects.toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }] });
    await emitir(venta, { almacen, ...caja, reloj });
    await emitir(venta, { almacen, ...caja, reloj });
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
