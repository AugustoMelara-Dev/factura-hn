/**
 * Requiere Postgres: `pnpm test:pg` (levanta docker-compose.yml) o FHN_PG_URL apuntando a una base de pruebas.
 * Sin FHN_PG_URL estas pruebas se omiten y lo dicen.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buscarDocumento, emitir, registrarAutorizacion, type AlmacenFiscal } from 'factura-hn';
import { DATOS_CONTRATO as D, ejecutarContratoAlmacen } from 'factura-hn/pruebas';
import { AlmacenPostgres } from '../src';

const URL_PG = process.env.FHN_PG_URL;
const conPostgres = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('[@factura-hn/postgres] FHN_PG_URL no está definido: se omiten las pruebas de Postgres. Usa `pnpm test:pg`.');

const pools: pg.Pool[] = [];
const nuevoPool = () => {
  const p = new pg.Pool({ connectionString: URL_PG, max: 5 });
  pools.push(p);
  return p;
};
const tenants = new WeakMap<AlmacenFiscal, string>();

conPostgres('Postgres', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = nuevoPool();
    // Dos migraciones a la vez: el candado consultivo las serializa.
    await Promise.all([new AlmacenPostgres(pool).migrar(), new AlmacenPostgres(nuevoPool()).migrar()]);
  });
  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  // Cada prueba usa su propio tenant: aislamiento sin recrear tablas.
  ejecutarContratoAlmacen({ describe, it }, {
    nombre: 'Postgres (pg, varias conexiones)',
    crear: async () => {
      const tenant = `prueba-${randomUUID()}`;
      const a = new AlmacenPostgres(pool, { tenant });
      tenants.set(a, tenant);
      return a;
    },
    // Otra caja = otro pool (otras conexiones), mismo tenant.
    otraConexion: async (a) => new AlmacenPostgres(nuevoPool(), { tenant: tenants.get(a)! }),
  });

  const emitido = async () => {
    const a = new AlmacenPostgres(pool, { tenant: `prueba-${randomUUID()}` });
    await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
    const doc = await emitir(D.entrada(), { almacen: a, establecimiento: '000', puntoEmision: '001', opciones: { reloj: D.reloj } });
    return { a, doc };
  };

  it('un tenant no ve los documentos de otro', async () => {
    const { a, doc } = await emitido();
    expect(await buscarDocumento(a, doc.numero)).not.toBeNull();
    expect(await buscarDocumento(a.paraTenant(`otro-${randomUUID()}`), doc.numero)).toBeNull();
  });

  it('la base impide borrar, cambiar un emitido salvo para anularlo y hacer retroceder la serie', async () => {
    const { a, doc } = await emitido();
    const t = (a as unknown as { tenant: string }).tenant;
    await expect(pool.query('DELETE FROM fhn_documentos WHERE tenant = $1', [t])).rejects.toThrow(/no se borran/);
    await expect(pool.query('DELETE FROM fhn_autorizaciones WHERE tenant = $1', [t])).rejects.toThrow(/no se borran/);
    await expect(pool.query('UPDATE fhn_documentos SET correlativo = 9 WHERE tenant = $1', [t])).rejects.toThrow(/solo puede anularse/);
    await pool.query("UPDATE fhn_documentos SET estado = 'ANULADO' WHERE tenant = $1 AND numero = $2", [t, doc.numero]);
    await expect(pool.query("UPDATE fhn_documentos SET estado = 'EMITIDO' WHERE tenant = $1", [t])).rejects.toThrow(/solo puede anularse/);
    await expect(pool.query('UPDATE fhn_series SET ultimo = 1 WHERE tenant = $1', [t])).rejects.toThrow(/no retrocede/);
  });

  it('cada transacción fija factura_hn.tenant (local a la transacción) para las políticas RLS', async () => {
    const tenant = `prueba-${randomUUID()}`;
    const vistos: string[] = [];
    // Pool espía: misma conexión real; lee el valor desde dentro de la transacción del adaptador.
    const espia = {
      connect: async () => {
        const c = await pool.connect();
        return {
          query: async (texto: string, params?: unknown[]) => {
            const r = await c.query(texto, params);
            if (/^SELECT set_config/.test(texto)) {
              vistos.push((await c.query("SELECT current_setting('factura_hn.tenant') AS t")).rows[0].t);
            }
            return r;
          },
          release: (d?: boolean | Error) => {
            c.query("SELECT current_setting('factura_hn.tenant', true) AS t").then((r) => vistos.push(`fuera:${r.rows[0].t ?? ''}`)).finally(() => c.release(d));
          },
        };
      },
    } as unknown as pg.Pool;
    await new AlmacenPostgres(espia, { tenant }).transaccion(async (tx) => tx.bloquearSerie('000-001-01'));
    await new Promise((r) => setTimeout(r, 50));
    expect(vistos).toEqual([tenant, 'fuera:']);
  });
});
