/**
 * La bitácora apoya los controles de auditoría del Art. 53 num. 2; el operador es opcional y no lo exige el Reglamento. En la bitácora, el actor es el id interno de la llave con su rol y nombre, y cada
 * solicitud puede indicar el operador (p. ej. el cajero) en el cuerpo o en la cabecera X-Operador.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { crearLlaveOperador, crearTenant } from '../src/operador';
import { cerrarPool, cliente, crearCaja, nombreTenant, poolPrueba, tenantListo, URL_PG, venta } from './ayuda';

afterAll(cerrarPool);
const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe.skipIf(!URL_PG)('actor y operador en la bitácora (operador opcional)', () => {
  it('actor = id de la llave (rol: nombre); operador del cuerpo o de X-Operador en ambas bitácoras; impreso solo si se pide', async () => {
    const { app, admin } = await tenantListo();
    const caja = cliente(app, await crearCaja(admin, '001'));
    const llaves = (await json(await admin('GET', '/v1/llaves'))).llaves as { id: string; nombre: string; rol: string }[];
    const llaveCaja = llaves.find((l) => l.rol === 'caja')!;
    expect(llaveCaja.id).toMatch(/^[0-9a-f-]{36}$/);

    // Operador en el cuerpo, sin imprimir.
    const r1 = await caja('POST', '/v1/documentos', venta('100.00', { operador: 'María López' }), { 'idempotency-key': randomUUID() });
    expect(r1.status).toBe(201);
    const d1 = (await json(r1)).documento;
    expect(d1.operador).toBeUndefined();
    expect(await (await caja('GET', `/v1/documentos/${d1.numero}.txt`)).text()).not.toContain('Atendido por');

    // Operador en la cabecera (con tildes, codificado) e impreso.
    const r2 = await caja('POST', '/v1/documentos', venta('50.00', { imprimirOperador: true }), {
      'idempotency-key': randomUUID(), 'x-operador': encodeURIComponent('José Núñez'),
    });
    expect(r2.status).toBe(201);
    const d2 = (await json(r2)).documento;
    expect(d2.operador).toBe('José Núñez');
    expect(await (await caja('GET', `/v1/documentos/${d2.numero}.txt`)).text()).toContain('Atendido por: José Núñez');

    // Anulación con operador (admin).
    expect((await admin('POST', `/v1/documentos/${d1.numero}/anular`, { motivo: 'Error en el precio', operador: 'Supervisora Ana' })).status).toBe(200);

    const bit = {
      fiscal: (await json(await admin('GET', '/v1/bitacora?origen=fiscal'))).eventos.reverse(),
      api: (await json(await admin('GET', '/v1/bitacora?origen=api'))).eventos.reverse(),
    };
    const actorCaja = `llave:${llaveCaja.id} (caja: ${llaveCaja.nombre})`;
    const fiscal = bit.fiscal.filter((e: any) => e.numero);
    expect(fiscal.map((e: any) => [e.tipo, e.numero, e.actor, e.operador ?? null])).toEqual([
      ['DOCUMENTO_EMITIDO', d1.numero, actorCaja, 'María López'],
      ['DOCUMENTO_EMITIDO', d2.numero, actorCaja, 'José Núñez'],
      ['DOCUMENTO_ANULADO', d1.numero, expect.stringMatching(/^llave:[0-9a-f-]{36} \(admin: admin inicial\)$/), 'Supervisora Ana'],
    ]);
    const api = bit.api.filter((e: any) => e.accion === 'documento.emitido');
    expect(api.map((e: any) => [e.actor, e.operador])).toEqual([[actorCaja, 'María López'], [actorCaja, 'José Núñez']]);
    // El prefijo de la llave ya no es el actor.
    expect(JSON.stringify(bit)).not.toMatch(/"actor":"llave:[0-9a-f]{12}"/);
  });

  it('el operador no cambia la venta salvo que se imprima (idempotencia) y se valida', async () => {
    const { app, admin } = await tenantListo();
    const caja = cliente(app, await crearCaja(admin, '001'));
    const clave = randomUUID();
    const a = await json(await caja('POST', '/v1/documentos', venta('100.00', { operador: 'María' }), { 'idempotency-key': clave }));
    // Reintento de otro cajero con la misma clave: la misma factura.
    const b = await caja('POST', '/v1/documentos', venta('100.00', { operador: 'Pedro' }), { 'idempotency-key': clave });
    expect([b.status, (await json(b)).documento.numero]).toEqual([201, a.documento.numero]);
    // Imprimirlo sí cambia el documento: otra solicitud.
    const c = await caja('POST', '/v1/documentos', venta('100.00', { operador: 'Pedro', imprimirOperador: true }), { 'idempotency-key': clave });
    expect([c.status, (await json(c)).error.codigo]).toEqual([422, 'IDEMPOTENCIA_CONFLICTO']);

    const errores: [Record<string, unknown>, Record<string, string>, number, string][] = [
      [{ imprimirOperador: true }, {}, 400, 'OPERADOR_REQUERIDO'],
      [{ operador: 'Ana' }, { 'x-operador': 'Beto' }, 400, 'OPERADOR_CONFLICTO'],
      [{}, { 'x-operador': '%E0%A4%A' }, 400, 'OPERADOR_CABECERA'],
      [{}, { 'x-operador': encodeURIComponent('Ana\nBeto') }, 422, 'OPERADOR'],
      [{ operador: 'x'.repeat(81) }, {}, 400, 'SOLICITUD_INVALIDA'],
    ];
    for (const [extra, cab, estado, codigo] of errores) {
      const r = await caja('POST', '/v1/documentos', venta('10.00', extra), { 'idempotency-key': randomUUID(), ...cab });
      const cuerpo = await json(r);
      expect([r.status, r.status === 422 ? cuerpo.errores[0].codigo : cuerpo.error.codigo]).toEqual([estado, codigo]);
    }
    // Ningún error consumió número.
    const sig = await json(await caja('POST', '/v1/documentos', venta('10.00'), { 'idempotency-key': randomUUID() }));
    expect(sig.documento.correlativo).toBe(a.documento.correlativo + 1);
  });
});

describe.skipIf(!URL_PG)('crearLlaveOperador con mcp', () => {
  it('el token del MCP por URL solo puede ser de una llave de caja: admin o sin caja se rechaza sin guardar nada', async () => {
    const pool = await poolPrueba();
    const { tenant } = await crearTenant(pool, { tenant: nombreTenant('mcp-op'), nombre: 'MCP operador' });
    for (const o of [{ rol: 'admin' as const }, { rol: 'admin' as const, establecimiento: '000', puntoEmision: '001' }, { rol: 'caja' as const }]) {
      await expect(crearLlaveOperador(pool, { tenant, nombre: 'MCP', mcp: true, ...o }), JSON.stringify(o)).rejects.toThrow(/solo puede ser de una llave de caja/);
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
      expect((await c.query('SELECT rol FROM api_llaves WHERE tenant = $1', [tenant])).rows).toEqual([{ rol: 'admin' }]);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    // De caja, sí: devuelve el token fhnmcp_.
    expect(await crearLlaveOperador(pool, { tenant, nombre: 'MCP', mcp: true, rol: 'caja', establecimiento: '000', puntoEmision: '001' })).toMatch(/^fhnmcp_live_/);
  });
});
