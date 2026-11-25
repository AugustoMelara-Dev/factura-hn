/**
 * OWASP API5:2023 · Broken Function Level Authorization.
 *
 * Cómo aplica: dos roles. `caja` emite y consulta; `admin` hace todo lo demás (emisor, CAI, anulaciones, series,
 * exportación, bitácora, llaves y webhooks). Una caja no puede subir de rol creando una llave admin, ni usar las
 * opciones de una operación permitida que son solo de admin (salto de fecha, Art. 43; nota sobre un original
 * externo, DEC-051).
 *
 * Ataque: una llave de caja llama a **todas** las operaciones del catálogo; la clasificación sale del código y se
 * contrasta con la especificación (las que exigen admin declaran 403).
 */
import { afterAll, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { cerrarPool, cliente, poolPrueba, ROL, tenantListo, venta } from '../ayuda';
import { conBase, ejecutar, emitir, huella, json, operaciones, tenantConRecursos } from './comun';

afterAll(cerrarPool);

conBase('API5 · autorización a nivel de función', () => {
  it('una caja recibe 403 SOLO_ADMIN en cada operación de admin y no cambia nada', async () => {
    const t = await tenantConRecursos();
    const caja = cliente(t.app, t.caja);
    const antes = await huella(t);
    const deAdmin = operaciones(t).filter((o) => o.soloAdmin);
    expect(deAdmin).toHaveLength(18);
    for (const o of deAdmin) {
      const r = await ejecutar(caja, o);
      expect(r.status, o.operationId).toBe(403);
      expect((await json(r)).error.codigo, o.operationId).toBe('SOLO_ADMIN');
    }
    expect(await huella(t)).toEqual(antes);
  });

  it('las operaciones de caja sí responden a una caja (el catálogo no exagera las restricciones)', async () => {
    const t = await tenantConRecursos();
    const caja = cliente(t.app, t.caja);
    for (const o of operaciones(t).filter((x) => !x.soloAdmin)) {
      const r = await ejecutar(caja, o);
      expect(r.status, `${o.operationId}: ${await r.clone().text()}`).toBeLessThan(300);
    }
  });

  it('la especificación declara 403 exactamente en las operaciones que lo pueden dar', async () => {
    const app = crearApp({ pool: await poolPrueba(), modo: 'local', rol: ROL });
    const spec = (await (await app.request('/openapi.json')).json()) as { paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>> };
    const con403 = new Set<string>();
    for (const ops of Object.values(spec.paths)) for (const op of Object.values(ops)) if (op.responses['403']) con403.add(op.operationId);
    const t = { emisorId: 'x', numero: '000-001-01-00000001', cai: 'x', webhookId: 'x', entregaId: 'x', prefijoCaja: 'x' };
    const deAdmin = operaciones(t).filter((o) => o.soloAdmin).map((o) => o.operationId);
    // Las de admin, más las dos de caja con restricciones propias: emitir (caja de otro punto, salto de fecha, nota
    // externa) y el libro de ventas (caja sin punto).
    expect([...con403].sort()).toEqual([...deAdmin, 'emitirDocumento', 'obtenerLibroVentas'].sort());
  });

  it('una caja no se crea una llave admin ni otra caja, ni revoca la llave admin', async () => {
    const t = await tenantConRecursos();
    const caja = cliente(t.app, t.caja);
    for (const rol of ['admin', 'caja']) {
      expect((await caja('POST', '/v1/llaves', { nombre: 'x', rol, establecimiento: '000', puntoEmision: '001' })).status).toBe(403);
    }
    const prefijoAdmin = t.llaveAdmin.split('_')[2]!;
    expect((await caja('DELETE', `/v1/llaves/${prefijoAdmin}`)).status).toBe(403);
    expect((await t.admin('GET', '/v1/sesion')).status).toBe(200);
  });

  it('opciones de admin dentro de operaciones de caja: confirmar un salto de fecha y una nota de crédito sobre un original externo', async () => {
    const t = await tenantListo();
    const caja = cliente(t.app, (await json(await t.admin('POST', '/v1/llaves', { nombre: 'c', rol: 'caja', establecimiento: '000', puntoEmision: '001' }))).secreto);
    const salto = await emitir(caja, venta('1', { confirmarSaltoDeFecha: true }));
    expect(salto.status).toBe(403);
    expect((await json(salto)).error.codigo).toBe('SOLO_ADMIN');
    const cliente9 = { nombre: 'Cliente', rtn: '99990000000002' };
    const f = (await json(await emitir(t.admin, venta('10.00', { documento: { cliente: cliente9, lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '10.00' }] } })))).documento;
    const nota = await emitir(caja, venta('10.00', {
      documento: {
        tipoDocumento: '06', motivo: 'Devolución', cliente: cliente9,
        referencia: { cai: f.cai, numero: '000-001-01-99999999', fecha: f.fechaEmision },
        lineas: [{ descripcion: 'Devolución', cantidad: 1, precioUnitario: '10.00' }],
      },
    }));
    expect(nota.status).toBe(403);
    expect((await json(nota)).error.codigo).toBe('SOLO_ADMIN');
    // Ninguno de los dos consumió número: la factura de la admin fue la 1 y la siguiente es la 2.
    expect((await json(await emitir(caja, venta()))).documento.numero).toBe('000-001-01-00000002');
  });
});
