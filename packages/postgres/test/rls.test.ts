/**
 * RLS real: con `migrar({ rls })` y la opción `rol`, un tenant no puede leer ni escribir filas de otro, ni
 * siquiera con SQL directo que olvide el filtro por tenant. Requiere FHN_PG_URL (ver contrato.test.ts).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitir, registrarAutorizacion, type AlmacenFiscal } from 'factura-hn';
import { DATOS_CONTRATO as D, ejecutarContratoAlmacen } from 'factura-hn/pruebas';
import { AlmacenPostgres, esTransaccionPostgres } from '../src';

const URL_PG = process.env.FHN_PG_URL;
const conPostgres = URL_PG ? describe : describe.skip;
const ROL = 'fhn_app';
const pools: pg.Pool[] = [];
const nuevoPool = () => {
  const p = new pg.Pool({ connectionString: URL_PG, max: 5 });
  pools.push(p);
  return p;
};
const tenants = new WeakMap<AlmacenFiscal, string>();

conPostgres('Postgres con RLS', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = nuevoPool();
    await new AlmacenPostgres(pool).migrar({ rls: { rol: ROL } });
  });
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  ejecutarContratoAlmacen({ describe, it }, {
    nombre: `Postgres con RLS (rol ${ROL})`,
    crear: async () => {
      const tenant = `rls-${randomUUID()}`;
      const a = new AlmacenPostgres(pool, { tenant, rol: ROL });
      tenants.set(a, tenant);
      return a;
    },
    otraConexion: async (a) => new AlmacenPostgres(nuevoPool(), { tenant: tenants.get(a)!, rol: ROL }),
  });

  const sql = async (tenant: string | null, texto: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${ROL}`);
      if (tenant !== null) await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
      return await c.query(texto, params);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  };

  it('intento de cruce: el tenant B no lee ni escribe filas del tenant A, aun sin filtro en la consulta', async () => {
    const A = `rls-a-${randomUUID()}`;
    const B = `rls-b-${randomUUID()}`;
    const almacenA = new AlmacenPostgres(pool, { tenant: A, rol: ROL });
    await registrarAutorizacion(almacenA, D.autorizacion('CAI-A', 1, 100));
    const doc = await emitir(D.entrada(), { almacen: almacenA, establecimiento: '000', puntoEmision: '001', opciones: { reloj: D.reloj } });

    // A ve su documento con una consulta sin filtro por tenant.
    expect((await sql(A, 'SELECT numero FROM fhn_documentos')).rows.map((r) => r.numero)).toEqual([doc.numero]);
    // B, con la misma consulta y aun filtrando por el tenant de A, no ve nada en ninguna tabla.
    for (const t of ['fhn_documentos', 'fhn_autorizaciones', 'fhn_series', 'fhn_eventos']) {
      expect((await sql(B, `SELECT * FROM ${t} WHERE tenant = $1`, [A])).rowCount).toBe(0);
    }
    // B no puede escribir filas con el tenant de A ni modificarlas.
    await expect(sql(B, "INSERT INTO fhn_eventos (tenant, tipo, instante, datos) VALUES ($1, 'X', now(), '{}')", [A]))
      .rejects.toThrow(/row-level security/);
    expect((await sql(B, "UPDATE fhn_documentos SET estado = 'ANULADO' WHERE tenant = $1", [A])).rowCount).toBe(0);
    // Sin tenant fijado no se ve nada (por defecto, denegar).
    expect((await sql(null, 'SELECT * FROM fhn_documentos')).rowCount).toBe(0);
    // El rol no tiene DELETE ni puede editar autorizaciones.
    await expect(sql(A, 'DELETE FROM fhn_eventos')).rejects.toThrow(/permission denied/);
    await expect(sql(A, 'UPDATE fhn_autorizaciones SET rango_final = 999')).rejects.toThrow(/permission denied/);
  });

  it('la transacción expone SQL dentro del mismo tenant (para la API)', async () => {
    const t = `rls-${randomUUID()}`;
    const visto = await new AlmacenPostgres(pool, { tenant: t, rol: ROL }).transaccion(async (tx) => {
      if (!esTransaccionPostgres(tx)) throw new Error('no es TransaccionPostgres');
      const r = await tx.consulta<{ t: string; rol: string }>("SELECT current_setting('factura_hn.tenant') AS t, current_user AS rol");
      return r.rows[0];
    });
    expect(visto).toEqual({ t, rol: ROL });
  });
});
