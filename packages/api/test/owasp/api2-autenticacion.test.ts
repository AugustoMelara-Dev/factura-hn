/**
 * OWASP API2:2023 · Broken Authentication.
 *
 * Cómo aplica: la única credencial es la llave de API en `Authorization: Bearer` (SHA-256 de 256 bits de entropía,
 * comparación en tiempo constante). Hay llaves revocadas, tenants inactivos y llaves con la marca de modo
 * equivocada, y un límite de intentos fallidos por prefijo y por dirección.
 *
 * Ataque: todas las operaciones sin llave; la llave en otros lugares (consulta, cookie, Basic, otra cabecera);
 * llaves mal formadas; un 401 que distinga «no existe» de «secreto equivocado»; fuerza bruta sobre un prefijo; prefijos
 * inventados desde una dirección que cambia `X-Forwarded-For` para parecer muchas.
 */
import { afterAll, expect, it } from 'vitest';
import { generarLlave, leerLlave } from '../../src/llaves';
import { cerrarPool, cliente, crearCaja, tenantListo } from '../ayuda';
import { comoDueno, conBase, ejecutar, json, nombresCabeceras, operaciones, tenantConRecursos } from './comun';

afterAll(cerrarPool);

/** El 401 sin lo que cambia en cada solicitud (el id). */
const forma401 = async (r: Response) => {
  const cuerpo = await json(r);
  delete cuerpo.error.solicitud;
  const cabeceras = nombresCabeceras(r).filter((k) => k !== 'solicitud-id').sort();
  return { estado: r.status, cuerpo, cabeceras };
};

conBase('API2 · autenticación', () => {
  it('todas las operaciones autenticadas sin llave: 401 NO_AUTENTICADO, sin cabeceras de la llave ni del tenant', async () => {
    const t = await tenantConRecursos();
    const anonimo = cliente(t.app, null);
    for (const o of operaciones(t)) {
      const r = await ejecutar(anonimo, o);
      expect(r.status, o.operationId).toBe(401);
      expect((await json(r)).error.codigo, o.operationId).toBe('NO_AUTENTICADO');
      for (const h of ['ratelimit', 'ratelimit-policy', 'facturahn-modo']) expect(r.headers.get(h), `${o.operationId} ${h}`).toBeNull();
    }
  });

  it('la llave solo vale en Authorization: Bearer (no en la consulta, una cookie, Basic ni otra cabecera)', async () => {
    const { app, llaveAdmin } = await tenantListo();
    const anonimo = cliente(app, null);
    const intentos: [string, Record<string, string>][] = [
      [`/v1/sesion?llave=${llaveAdmin}`, {}],
      [`/v1/sesion?api_key=${llaveAdmin}`, {}],
      [`/v1/sesion?access_token=${llaveAdmin}`, {}],
      ['/v1/sesion', { cookie: `llave=${llaveAdmin}` }],
      ['/v1/sesion', { 'x-api-key': llaveAdmin }],
      ['/v1/sesion', { authorization: `Basic ${Buffer.from(`${llaveAdmin}:`).toString('base64')}` }],
      ['/v1/sesion', { authorization: `Token ${llaveAdmin}` }],
      ['/v1/sesion', { authorization: llaveAdmin }],
      ['/v1/sesion', { authorization: `Bearer ${llaveAdmin} ${llaveAdmin}` }],
      ['/v1/sesion', { authorization: `Bearer ${llaveAdmin}x` }],
      ['/v1/sesion', { authorization: `Bearer ${llaveAdmin.slice(0, -1)}` }],
      ['/v1/sesion', { authorization: `Bearer ${llaveAdmin.toUpperCase()}` }],
    ];
    for (const [ruta, cabeceras] of intentos) {
      const r = await anonimo('GET', ruta, undefined, cabeceras);
      expect(r.status, `${ruta} ${JSON.stringify(cabeceras).slice(0, 40)}`).toBe(401);
    }
    // Control: la misma llave en su lugar entra.
    expect((await cliente(app, llaveAdmin)('GET', '/v1/sesion')).status).toBe(200);
  });

  it('el 401 es idéntico para un prefijo inexistente, un secreto equivocado, una llave revocada, un tenant inactivo y la marca de modo cambiada', async () => {
    const t = await tenantListo();
    const pool = t.pool;
    const caja = await crearCaja(t.admin, '001');
    const { prefijo } = leerLlave(caja)!;
    // Prefijo inexistente.
    const inexistente = generarLlave('produccion').llave;
    // Prefijo que existe, secreto equivocado.
    const equivocada = `fhn_live_${prefijo}_${'A'.repeat(43)}`;
    // La misma llave con la otra marca (live → test): el hash cubre la marca, así que es otra llave.
    const otraMarca = caja.replace('fhn_live_', 'fhn_test_');
    // Revocada.
    const revocada = await crearCaja(t.admin, '001');
    expect((await cliente(t.app, revocada)('GET', '/v1/sesion')).status).toBe(200); // ya validada en memoria
    expect((await t.admin('DELETE', `/v1/llaves/${leerLlave(revocada)!.prefijo}`)).status).toBe(200);

    const formas = [];
    for (const llave of [inexistente, equivocada, otraMarca, revocada]) formas.push(await forma401(await cliente(t.app, llave)('GET', '/v1/sesion')));
    // Tenant inactivo: su llave admin, ya validada en memoria, deja de entrar.
    const otro = await tenantListo();
    expect((await otro.admin('GET', '/v1/sesion')).status).toBe(200);
    await comoDueno(pool, otro.tenant, 'UPDATE api_tenants SET activo = false WHERE tenant = $1', [otro.tenant]);
    formas.push(await forma401(await otro.admin('GET', '/v1/sesion')));

    for (const f of formas) expect(f).toEqual(formas[0]);
    expect(formas[0]!.estado).toBe(401);
    // La llave buena del mismo prefijo sigue entrando: los intentos no la bloquean.
    expect((await cliente(t.app, caja)('GET', '/v1/sesion')).status).toBe(200);
  });

  it('fuerza bruta sobre un prefijo que existe: 429 DEMASIADOS_INTENTOS tras la ráfaga, sin dejar fuera al dueño', async () => {
    const t = await tenantListo({ limiteIntentos: { porSegundo: 0.001, rafaga: 5 } });
    const { prefijo } = leerLlave(t.llaveAdmin)!;
    const estados: number[] = [];
    for (let i = 0; i < 10; i++) {
      const falsa = `fhn_live_${prefijo}_${String(i).padStart(43, 'B')}`;
      const r = await cliente(t.app, falsa, { ip: '203.0.113.7' })('GET', '/v1/sesion', undefined, { 'x-forwarded-for': `198.51.100.${i}` });
      estados.push(r.status);
      if (r.status === 429) {
        expect((await json(r)).error.codigo).toBe('DEMASIADOS_INTENTOS');
        expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      }
    }
    expect(estados.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(estados.slice(5).every((e) => e === 429)).toBe(true);
    // El dueño de la llave no queda fuera.
    expect((await t.admin('GET', '/v1/sesion')).status).toBe(200);
  });

  it('prefijos inventados con X-Forwarded-For cambiante: sin proxies de confianza cuentan todos a la dirección del socket', async () => {
    // El límite por dirección solo frena con el semáforo de consultas lleno: una consulta a la vez y
    // todas las demás llegan mientras tanto. Cada prefijo es nuevo, así que lo que frena es la cubeta de la dirección,
    // no la del prefijo. La misma ráfaga, desde el mismo socket, con 0 y con 1 proxy de confianza.
    const rafaga = async (proxiesDeConfianza: number) => {
      const t = await tenantListo({ proxiesDeConfianza, limiteIntentos: { porSegundo: 0.001, rafaga: 3, consultasSimultaneas: 1 } });
      const r = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          cliente(t.app, generarLlave('produccion').llave, { ip: '203.0.113.7' })('GET', '/v1/sesion', undefined, { 'x-forwarded-for': `198.51.100.${i + 1}` }),
        ),
      );
      const estados = r.map((x) => x.status);
      expect(estados.every((e) => e === 401 || e === 429)).toBe(true);
      return estados.filter((e) => e === 429).length;
    };
    // Sin proxies, X-Forwarded-For se ignora: las 30 son de 203.0.113.7 y casi todas se frenan sin consultar la base.
    expect(await rafaga(0)).toBeGreaterThanOrEqual(20);
    // Control: con 1 proxy de confianza, cada X-Forwarded-For es otra dirección con su propia cubeta: ninguna se frena.
    expect(await rafaga(1)).toBe(0);
  });

  it('las llaves no se guardan en claro: la base tiene solo el SHA-256 y la respuesta de creación es la única que trae el secreto', async () => {
    const t = await tenantListo();
    const r = await json(await t.admin('POST', '/v1/llaves', { nombre: 'Caja 9', rol: 'caja', establecimiento: '000', puntoEmision: '001' }));
    const secreto = r.secreto as string;
    const fila = (await comoDueno(t.pool, t.tenant, 'SELECT * FROM api_llaves WHERE prefijo = $1', [leerLlave(secreto)!.prefijo])).rows[0]!;
    expect(JSON.stringify(fila)).not.toContain(secreto.split('_').slice(3).join('_'));
    expect((fila.hash as Buffer).length).toBe(32);
    for (const ruta of ['/v1/llaves', '/v1/bitacora?origen=api', '/v1/sesion']) {
      expect(await (await t.admin('GET', ruta)).text(), ruta).not.toContain(secreto);
    }
  });
});
