/**
 * GET /v1/sesion contra PostgreSQL real, con el rol de la aplicación (RLS): con qué llave hablas y qué falta para
 * emitir, sin secretos ni datos de otros tenants.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, describe } from 'vitest';
import { crearApp } from '../src/app';
import { crearTenant } from '../src/operador';
import { cerrarPool, cliente, crearCaja, nombreTenant, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const sesionDe = async (c: ReturnType<typeof cliente>) => {
  const r = await c('GET', '/v1/sesion');
  expect(r.status).toBe(200);
  return (await json(r)).sesion;
};

conBase('GET /v1/sesion', () => {
  it('caja lista: su punto, sus autorizaciones vigentes y el siguiente número; sin secretos', async () => {
    const { app, admin, tenant } = await tenantListo({}, { cajas: ['001', '002'] });
    const llave = await crearCaja(admin, '002');
    const caja = cliente(app, llave);
    const s = await sesionDe(caja);
    expect(s).toMatchObject({
      tenant,
      modo: 'local',
      demo: false,
      llave: { rol: 'caja', nombre: 'caja 002', establecimiento: '000', puntoEmision: '002', prefijo: llave.split('_')[1] },
      emisor: { registrado: true, rtn: '99990000000001' },
      puedeEmitir: true,
      pendientes: [],
      limiteMensual: null,
      documentosDelMes: 0,
    });
    // Solo su punto de emisión, aunque el tenant tenga otros.
    expect(s.puntos.map((p: { puntoEmision: string }) => p.puntoEmision)).toEqual(['002']);
    const [factura, nc, nd] = s.puntos[0].tipos;
    expect(factura).toMatchObject({ tipoDocumento: '01', listo: true, siguienteNumero: '000-002-01-00000001', problema: null });
    expect(factura.autorizaciones).toHaveLength(1);
    expect(factura.autorizaciones[0]).toMatchObject({ rangoInicial: 1, rangoFinal: 1000, correlativosRestantes: 1000 });
    expect(nc).toMatchObject({ tipoDocumento: '06', listo: true });
    expect(nd).toMatchObject({ tipoDocumento: '07', listo: false, autorizaciones: [], problema: { codigo: 'SIN_AUTORIZACION' } });
    const texto = JSON.stringify(s);
    expect(texto).not.toContain(llave);
    expect(texto).not.toMatch(/hash|secreto|fhn_[0-9a-f]{12}_/);

    expect((await caja('POST', '/v1/documentos', { documento: venta().documento }, { 'idempotency-key': randomUUID() })).status).toBe(201);
    const despues = await sesionDe(caja);
    expect(despues.puntos[0].tipos[0].siguienteNumero).toBe('000-002-01-00000002');
    expect(despues.documentosDelMes).toBe(1);
  });

  it('admin ve todos los puntos con autorizaciones', async () => {
    const { admin } = await tenantListo({}, { cajas: ['001', '003'] });
    const s = await sesionDe(admin);
    expect(s.llave).toMatchObject({ rol: 'admin', establecimiento: null, puntoEmision: null });
    expect(s.puntos.map((p: { puntoEmision: string }) => p.puntoEmision)).toEqual(['001', '003']);
    expect(s.puedeEmitir).toBe(true);
  });

  it('tenant vacío: falta el emisor y el CAI, con solución y enlace; no ve el CAI de otro tenant', async () => {
    // Otro tenant con CAI en el mismo punto 000-001.
    await tenantListo();
    const p = await poolPrueba();
    const tenant = nombreTenant();
    const { llaveAdmin } = await crearTenant(p, { tenant, nombre: tenant });
    const app = crearApp({ pool: p, modo: 'alojado', rol: ROL, registrar: () => undefined });
    const admin = cliente(app, llaveAdmin);
    const s = await sesionDe(admin);
    expect(s).toMatchObject({ tenant, modo: 'alojado', demo: false, emisor: { registrado: false, rtn: null }, puntos: [], puedeEmitir: false });
    expect(s.pendientes.map((x: { codigo: string }) => x.codigo)).toEqual(['SIN_EMISOR', 'SIN_AUTORIZACION']);
    for (const x of s.pendientes) {
      expect(x.solucion).toEqual(expect.any(String));
      expect(x.documentacion).toMatch(/^https:\/\/github\.com\/AugustoMelara-Dev\/factura-hn\/blob\/main\/docs\/errores\.md#[a-z_]+$/);
    }
    // Una caja de este tenant en 000-001 no ve la autorización del otro tenant (RLS).
    const caja = cliente(app, await crearCaja(admin, '001'));
    const sc = await sesionDe(caja);
    expect(sc.puntos).toHaveLength(1);
    expect(sc.puntos[0].tipos.every((t: { listo: boolean; autorizaciones: unknown[] }) => !t.listo && t.autorizaciones.length === 0)).toBe(true);
    expect(sc.pendientes.map((x: { codigo: string }) => x.codigo)).toEqual(['SIN_EMISOR', 'SIN_AUTORIZACION']);
    expect(sc.pendientes[1].mensaje).toMatch(/^000-001, tipo 01: /);
  });

  it('CAI vencido y rango agotado: lo dice con su código', async () => {
    const { admin, pool } = await tenantListo({}, { rangoFinal: 1 });
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    const agotado = await sesionDe(admin);
    expect(agotado.puedeEmitir).toBe(false);
    expect(agotado.pendientes).toMatchObject([{ codigo: 'RANGO_AGOTADO', solucion: expect.stringContaining('POST /v1/autorizaciones') }]);

    const { llaveAdmin: otra } = await tenantListo();
    const futuro = crearApp({ pool, modo: 'local', rol: ROL, registrar: () => undefined, reloj: () => new Date('2027-11-15T15:00:00Z') });
    const vencida = await sesionDe(cliente(futuro, otra));
    expect(vencida.pendientes).toMatchObject([{ codigo: 'AUTORIZACION_VENCIDA' }]);
    expect(vencida.puntos[0].tipos[0].autorizaciones).toEqual([]);
  });

  it('límite mensual alcanzado', async () => {
    const { admin } = await tenantListo({}, { limiteMensual: 1 });
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);
    const s = await sesionDe(admin);
    expect(s).toMatchObject({ documentosDelMes: 1, limiteMensual: 1, puedeEmitir: false, pendientes: [{ codigo: 'LIMITE_MENSUAL' }] });
  });

  it('sin llave: 401', async () => {
    const p = await poolPrueba();
    const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined });
    expect((await cliente(app, null)('GET', '/v1/sesion')).status).toBe(401);
  });
});
