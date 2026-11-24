/**
 * Retención: la copia de la respuesta de una clave de idempotencia vieja se compacta al número del documento
 * (la clave nunca vuelve a servir para otra venta) y las entregas terminadas viejas se borran.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { mantenimientoApi, migrarApi } from '../src/esquema';
import { cerrarPool, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

afterAll(cerrarPool);
const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe.skipIf(!URL_PG)('retención de idempotencia y entregas', () => {
  it('compacta la respuesta de una clave vieja; el reintento devuelve el mismo documento sin emitir otro; otro cuerpo es 422', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    const vieja = randomUUID();
    const reciente = randomUUID();
    const doc = (await json(await admin('POST', '/v1/documentos', venta('100.00'), { 'idempotency-key': vieja }))).documento;
    await admin('POST', '/v1/documentos', venta('5.00'), { 'idempotency-key': reciente });
    const huellaAntes = (await pool.query('SELECT huella FROM api_idempotencia WHERE tenant = $1 AND clave = $2', [tenant, vieja])).rows[0].huella;
    await pool.query("UPDATE api_idempotencia SET creada = now() - interval '31 days' WHERE tenant = $1 AND clave = $2", [tenant, vieja]);

    const r = await mantenimientoApi(pool, ROL, 30);
    expect(r.compactadas).toBeGreaterThanOrEqual(1);
    const filas = await pool.query('SELECT clave, huella, respuesta FROM api_idempotencia WHERE tenant = $1', [tenant]);
    const porClave = new Map(filas.rows.map((f) => [f.clave, f]));
    expect(porClave.get(vieja).respuesta).toEqual({ numero: doc.numero });
    expect(porClave.get(vieja).huella).toBe(huellaAntes);
    expect(porClave.get(reciente).respuesta.documento).toBeDefined();
    // Ya compactada: otra pasada no la toca.
    await mantenimientoApi(pool, ROL, 30);
    expect((await pool.query('SELECT respuesta FROM api_idempotencia WHERE tenant = $1 AND clave = $2', [tenant, vieja])).rows[0].respuesta).toEqual({ numero: doc.numero });

    const contar = async () => (await pool.query('SELECT count(*)::int AS n FROM fhn_documentos WHERE tenant = $1', [tenant])).rows[0].n;
    const antes = await contar();
    const repetida = await admin('POST', '/v1/documentos', venta('100.00'), { 'idempotency-key': vieja });
    expect(repetida.status).toBe(201);
    expect(repetida.headers.get('idempotency-replayed')).toBe('true');
    const cuerpo = await json(repetida);
    expect(cuerpo.documento.numero).toBe(doc.numero);
    expect(cuerpo.documento).toEqual((await json(await admin('GET', `/v1/documentos/${doc.numero}`))).documento);
    expect(await contar()).toBe(antes);

    const otra = await admin('POST', '/v1/documentos', venta('999.00'), { 'idempotency-key': vieja });
    expect(otra.status).toBe(422);
    expect((await json(otra)).error.codigo).toBe('IDEMPOTENCIA_CONFLICTO');
    expect(await contar()).toBe(antes);

    // Anulado después: la respuesta compactada trae el estado actual.
    await admin('POST', `/v1/documentos/${doc.numero}/anular`, { motivo: 'prueba' });
    expect((await json(await admin('POST', '/v1/documentos', venta('100.00'), { 'idempotency-key': vieja }))).documento.estado).toBe('ANULADO');
  });

  it('la retención nunca baja de 7 días', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    const clave = randomUUID();
    await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': clave });
    await pool.query("UPDATE api_idempotencia SET creada = now() - interval '3 days' WHERE tenant = $1", [tenant]);
    await mantenimientoApi(pool, ROL, 0);
    expect((await pool.query('SELECT respuesta FROM api_idempotencia WHERE tenant = $1', [tenant])).rows[0].respuesta.documento).toBeDefined();
    await pool.query("UPDATE api_idempotencia SET creada = now() - interval '8 days' WHERE tenant = $1", [tenant]);
    await mantenimientoApi(pool, ROL, 0);
    expect(Object.keys((await pool.query('SELECT respuesta FROM api_idempotencia WHERE tenant = $1', [tenant])).rows[0].respuesta)).toEqual(['numero']);
  });

  it('borra las entregas ENTREGADA y FALLIDA pasada la retención y conserva las PENDIENTE y las recientes', async () => {
    const { admin, tenant } = await tenantListo();
    const pool = await poolPrueba();
    await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido'] });
    for (let i = 0; i < 4; i++) await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    const ids = (await pool.query('SELECT id FROM api_entregas WHERE tenant = $1 ORDER BY id', [tenant])).rows.map((f) => f.id);
    expect(ids).toHaveLength(4);
    const fijar = (id: string, estado: string, dias: number) =>
      pool.query(`UPDATE api_entregas SET estado = $2, creada = now() - make_interval(days => $3), proximo = now() + interval '1 day' WHERE id = $1`, [id, estado, dias]);
    await fijar(ids[0], 'ENTREGADA', 40);
    await fijar(ids[1], 'FALLIDA', 40);
    await fijar(ids[2], 'PENDIENTE', 40);
    await fijar(ids[3], 'ENTREGADA', 2);
    const r = await mantenimientoApi(pool, ROL, 30);
    expect(r.entregasBorradas).toBeGreaterThanOrEqual(2);
    const quedan = await pool.query('SELECT id, estado FROM api_entregas WHERE tenant = $1 ORDER BY id', [tenant]);
    expect(quedan.rows).toEqual([{ id: ids[2], estado: 'PENDIENTE' }, { id: ids[3], estado: 'ENTREGADA' }]);
  });

  it('las entregas de autorizacion.* quedan como lápida (cuerpo vacío) para no avisar dos veces', async () => {
    const { admin, tenant } = await tenantListo({}, { rangoFinal: 3 });
    const pool = await poolPrueba();
    await admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:9/hook-${tenant}`, eventos: ['documento.emitido', 'autorizacion.agotada'] });
    for (let i = 0; i < 3; i++) await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    await pool.query("UPDATE api_entregas SET estado = 'ENTREGADA', creada = now() - interval '40 days' WHERE tenant = $1", [tenant]);
    await mantenimientoApi(pool, ROL, 30);
    const quedan = await pool.query('SELECT webhook_id, evento, clave, cuerpo FROM api_entregas WHERE tenant = $1', [tenant]);
    expect(quedan.rows.map((f) => [f.evento, f.cuerpo])).toEqual([['autorizacion.agotada', {}]]);
    // La lápida sigue ocupando su clave: el mismo aviso no se vuelve a encolar.
    const f = quedan.rows[0];
    const otra = await pool.query(
      "INSERT INTO api_entregas (tenant, webhook_id, evento, clave, cuerpo) VALUES ($1, $2, $3, $4, '{}') ON CONFLICT (webhook_id, clave) DO NOTHING",
      [tenant, f.webhook_id, f.evento, f.clave],
    );
    expect(otra.rowCount).toBe(0);
  });

  it('la compactación usa el índice parcial de lo que falta compactar (no recorre lo ya compactado)', async () => {
    // Esquema propio para controlar los datos: muchas claves ya compactadas y pocas por compactar, como en un
    // servicio que lleva tiempo corriendo.
    const p = await poolPrueba();
    const esquema = `prueba_retencion_${randomUUID().slice(0, 8)}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      await propio.query(
        `INSERT INTO api_idempotencia (tenant, clave, huella, codigo, respuesta, creada)
         SELECT 'x', 'c' || i, 'h', 201, CASE WHEN i % 1000 = 0 THEN '{"documento":{"numero":"1"}}'::jsonb ELSE '{"numero":"1"}'::jsonb END,
                now() - interval '40 days'
           FROM generate_series(1, 5000) i`,
      );
      await propio.query('ANALYZE api_idempotencia');
      const plan = (await propio.query(
        `EXPLAIN UPDATE api_idempotencia SET respuesta = jsonb_build_object('numero', respuesta->'documento'->>'numero')
          WHERE tenant = 'x' AND creada < now() - interval '30 days' AND respuesta ? 'documento'`,
      )).rows.map((f) => f['QUERY PLAN']).join('\n');
      expect(plan).toContain('api_idempotencia_por_compactar');
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });

  it('solo el rol de la aplicación ejecuta el mantenimiento y no deja fijado ningún tenant en la transacción', async () => {
    const pool = await poolPrueba();
    const acl = (await pool.query("SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'fhn_api_mantenimiento' AND pronamespace = current_schema()::regnamespace")).rows[0].acl as string;
    expect(acl).toContain(`${ROL}=X/`);
    expect(acl).not.toMatch(/[{,]=X/); // PUBLIC
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${ROL}`);
      await c.query("SELECT set_config('factura_hn.tenant', 'tenant-de-quien-llama', true)");
      await c.query('SELECT * FROM fhn_api_mantenimiento(30)');
      expect((await c.query("SELECT current_setting('factura_hn.tenant') AS t")).rows[0].t).toBe('tenant-de-quien-llama');
      await c.query("SELECT set_config('factura_hn.tenant', '', true)");
      await c.query('SELECT * FROM fhn_api_mantenimiento(30)');
      expect((await c.query("SELECT current_setting('factura_hn.tenant') AS t")).rows[0].t).toBe('');
      // Tras la función, el rol sigue sin ver otros tenants.
      expect((await c.query('SELECT count(*)::int AS n FROM api_idempotencia')).rows[0].n).toBe(0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
