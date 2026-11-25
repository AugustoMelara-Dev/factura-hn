/**
 * OWASP API6:2023 · Unrestricted Access to Sensitive Business Flows.
 *
 * Cómo aplica: los flujos sensibles son fiscales. Emitir consume un correlativo autorizado por el SAR (Arts. 4 y 59),
 * los documentos de prueba quedan fuera del libro y de la exportación (DEC-063, DEC-087), y la exportación entrega
 * todo el período (Art. 53 num. 5). Abusarlos sería: emitir dos veces la misma venta, hacer pasar ventas reales por
 * «de prueba» para sacarlas de los reportes, o sacar datos en masa sin rastro.
 *
 * Ataque: reintentos simultáneos con la misma clave y la misma clave con otro cuerpo; CAI ficticios en un tenant de
 * producción y reales en uno de prueba; exportar y buscar el registro.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { crearTenant } from '../../src/operador';
import { caiAleatorio, cerrarPool, cliente, FECHA_LIMITE, nombreTenant, poolPrueba, ROL, tenantListo, venta } from '../ayuda';
import { conBase, emitir, json, PERIODO } from './comun';

afterAll(cerrarPool);

conBase('API6 · flujos de negocio sensibles', () => {
  it('20 reintentos simultáneos con la misma Idempotency-Key: un solo documento; la misma clave con otro cuerpo es 422', async () => {
    const t = await tenantListo();
    const clave = randomUUID();
    const respuestas = await Promise.all(Array.from({ length: 20 }, () => emitir(t.admin, venta('20.00'), clave)));
    const numeros = new Set<string>();
    for (const r of respuestas) {
      expect(r.status).toBe(201);
      numeros.add((await json(r)).documento.numero);
    }
    expect([...numeros]).toEqual(['000-001-01-00000001']);
    const otro = await emitir(t.admin, venta('21.00'), clave);
    expect(otro.status).toBe(422);
    expect((await json(otro)).error.codigo).toBe('IDEMPOTENCIA_CONFLICTO');
    expect((await json(await t.admin('GET', `/v1/documentos?${PERIODO}`))).documentos).toHaveLength(1);
  });

  it('un tenant de producción no registra un CAI ficticio (sus ventas saldrían «de prueba», fuera del libro) y uno de prueba no registra uno real', async () => {
    const t = await tenantListo();
    const ficticio = await t.admin('POST', '/v1/autorizaciones', {
      cai: 'DEMO00-NO-VALIDO-000000-000000-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '007', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: FECHA_LIMITE, prueba: true,
    });
    expect(ficticio.status).toBe(422);
    expect((await json(ficticio)).error.codigo).toBe('CAI_DE_PRUEBA');

    const pool = await poolPrueba();
    const { llaveAdmin } = await crearTenant(pool, { tenant: nombreTenant('prueba'), nombre: 'Sandbox', modo: 'prueba' });
    expect(llaveAdmin.startsWith('fhn_test_')).toBe(true);
    const sandbox = cliente(crearApp({ pool, modo: 'alojado', rol: ROL, registrar: () => undefined }), llaveAdmin);
    const real = await sandbox('POST', '/v1/autorizaciones', {
      cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '007', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: FECHA_LIMITE,
    });
    expect(real.status).toBe(422);
    expect((await json(real)).error.codigo).toBe('AUTORIZACION_REAL_EN_DEMO');
  });

  it('emitir en un punto sin CAI es 422 y no deja rastro de número; anular dos veces no reabre el número', async () => {
    const t = await tenantListo();
    const sinCai = await emitir(t.admin, venta('1', { puntoEmision: '099' }));
    expect(sinCai.status).toBe(422);
    const d = (await json(await emitir(t.admin, venta()))).documento;
    expect(d.numero).toBe('000-001-01-00000001');
    expect((await t.admin('POST', `/v1/documentos/${d.numero}/anular`, { motivo: 'Error de digitación' })).status).toBe(200);
    expect((await t.admin('POST', `/v1/documentos/${d.numero}/anular`, { motivo: 'Otra vez' })).status).toBe(422);
    // El número anulado sigue consumido (Art. 41): la siguiente venta toma el 2.
    expect((await json(await emitir(t.admin, venta()))).documento.numero).toBe('000-001-01-00000002');
  });

  it('cada exportación del período queda en la bitácora de la API con quién, cuándo y cuántos documentos', async () => {
    const t = await tenantListo();
    await emitir(t.admin, venta());
    const r = await t.admin('GET', `/v1/exportacion?${PERIODO}&formato=csv`);
    expect(r.status).toBe(200);
    await r.text();
    const ev = (await json(await t.admin('GET', '/v1/bitacora?origen=api&limite=1'))).eventos[0];
    expect(ev.accion).toBe('exportacion');
    expect(ev.actor).toMatch(/^llave:[0-9a-f-]{36} \(admin: /);
    expect(ev.detalle).toMatchObject({ formato: 'csv', documentos: 1 });
  });
});
