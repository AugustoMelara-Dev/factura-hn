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

// Cruce forzado de bloqueos: cada transacción se detiene tras su primer `bloquearSerie` hasta que la otra tenga el
// suyo (o pase medio segundo). Si dos caminos tomaran las mismas series en orden inverso, Postgres cortaría uno
// con 40P01.
const senal = () => {
  let listo!: () => void;
  const p = new Promise<void>((r) => (listo = r));
  return { p, listo };
};
const pausa = (yo: ReturnType<typeof senal>, otro: ReturnType<typeof senal>) => {
  let primera = true;
  return async () => {
    if (!primera) return;
    primera = false;
    yo.listo();
    await Promise.race([otro.p, new Promise((r) => setTimeout(r, 500))]);
  };
};
const conPausa = (almacen: AlmacenFiscal, despues: () => Promise<void>): AlmacenFiscal =>
  new Proxy(almacen, {
    get(o, p) {
      const v = Reflect.get(o, p, o) as unknown;
      if (p !== 'transaccion') return typeof v === 'function' ? v.bind(o) : v;
      return (fn: (tx: unknown) => Promise<unknown>) =>
        o.transaccion((tx) =>
          fn(
            new Proxy(tx, {
              get(t, q) {
                const w = Reflect.get(t, q, t) as unknown;
                if (typeof w !== 'function') return w;
                if (q !== 'bloquearSerie') return w.bind(t);
                return async (serie: string) => {
                  const r = await w.call(t, serie);
                  await despues();
                  return r;
                };
              },
            }),
          ),
        );
    },
  });

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

  it('registros simultáneos de prueba y real en un mismo punto, de tipos distintos: la demo nunca entra después de la real', async () => {
    const fecha = '2099-12-31';
    for (let i = 0; i < 10; i++) {
      const tenant = `prueba-${randomUUID()}`;
      const prueba = { cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01', prueba: true, tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: fecha } as const;
      const real = { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06', tipoDocumento: '06', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: fecha } as const;
      const r = await Promise.allSettled([
        registrarAutorizacion(new AlmacenPostgres(pool, { tenant }), prueba),
        registrarAutorizacion(new AlmacenPostgres(nuevoPool(), { tenant }), real),
      ]);
      // El real siempre entra (retira la demo). La demo entra solo si se registró antes que el real.
      expect(r[1]!.status).toBe('fulfilled');
      if (r[0]!.status === 'rejected') {
        expect(r[0]!.reason).toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }] });
      } else {
        const orden = await pool.query(
          "SELECT datos->'detalle'->>'cai' AS cai FROM fhn_eventos WHERE tenant = $1 AND tipo = 'AUTORIZACION_REGISTRADA' ORDER BY id",
          [tenant],
        );
        expect(orden.rows.map((f) => f.cai)).toEqual([prueba.cai, real.cai]);
      }
    }
  });

  it('una nota de crédito y un registro simultáneos en el mismo punto no se bloquean entre sí', async () => {
    // La nota bloquea su serie 06 y luego la 01 del original. El registro bloquea las series del punto: si
    // empezara por la 01, cada uno esperaría al otro (40P01). Cada transacción se detiene tras su primer
    // bloqueo hasta que la otra tenga el suyo (o pase medio segundo), para forzar ese cruce.
    const tenant = `prueba-${randomUUID()}`;
    const a = new AlmacenPostgres(pool, { tenant });
    await registrarAutorizacion(a, D.autorizacion('A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', 1, 100));
    await registrarAutorizacion(a, D.autorizacion('A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06', 1, 100, { tipoDocumento: '06' }));
    const caja = { establecimiento: '000', puntoEmision: '001', opciones: { reloj: D.reloj } };
    const cliente = { nombre: 'Constructora Pérez', rtn: '99990000000002' };
    const f = await emitir(D.entrada({ cliente }), { almacen: a, ...caja });
    const notaBloqueo = senal();
    const registroBloqueo = senal();
    const r = await Promise.allSettled([
      emitir(
        D.entrada({ tipoDocumento: '06', cliente, motivo: 'Devolución', referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision } }),
        { almacen: conPausa(new AlmacenPostgres(nuevoPool(), { tenant }), pausa(notaBloqueo, registroBloqueo)), ...caja },
      ),
      registrarAutorizacion(
        conPausa(new AlmacenPostgres(nuevoPool(), { tenant }), pausa(registroBloqueo, notaBloqueo)),
        D.autorizacion('A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-07', 1, 100, { tipoDocumento: '07' }),
      ),
    ]);
    expect(r.map((x) => (x.status === 'rejected' ? String(x.reason) : 'ok'))).toEqual(['ok', 'ok']);
  });

  describe('dos notas de crédito cruzadas entre puntos de emisión (Lote 4)', () => {
    // La nota de 000-001 se aplica a una factura de 000-002 y la de 000-002 a una de 000-001. Cada nota bloquea su
    // serie 06 y después la 01 del original: 000-001-06 → 000-002-01 y 000-002-06 → 000-001-01.
    const cliente = { nombre: 'Constructora Pérez', rtn: '99990000000002' };
    const reloj = { opciones: { reloj: D.reloj } };
    const preparar = async () => {
      const tenant = `prueba-${randomUUID()}`;
      const a = new AlmacenPostgres(pool, { tenant });
      const facturas = [];
      for (const [i, punto] of ['001', '002'].entries()) {
        const extra = { puntoEmision: punto };
        await registrarAutorizacion(a, D.autorizacion(`A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${i}1`, 1, 100, extra));
        await registrarAutorizacion(a, D.autorizacion(`A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${i}6`, 1, 100, { ...extra, tipoDocumento: '06' }));
        facturas.push(await emitir(D.entrada({ cliente }), { almacen: a, establecimiento: '000', puntoEmision: punto, ...reloj }));
      }
      return { tenant, facturas: facturas as [(typeof facturas)[0], (typeof facturas)[0]] };
    };
    const nota = (f: { cai: string; numero: string; fechaEmision: string }) =>
      D.entrada({ tipoDocumento: '06', cliente, motivo: 'Devolución', lineas: [{ descripcion: 'Devolución', cantidad: '1', precioUnitario: '1.00' }], referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision } });

    it('no se bloquean entre sí: el orden ya es determinista (notas antes que el resto) y no se reproduce el 40P01', async () => {
      const { tenant, facturas: [f1, f2] } = await preparar();
      for (let ronda = 0; ronda < 3; ronda++) {
        const s1 = senal();
        const s2 = senal();
        const r = await Promise.allSettled([
          emitir(nota(f2), { almacen: conPausa(new AlmacenPostgres(nuevoPool(), { tenant }), pausa(s1, s2)), establecimiento: '000', puntoEmision: '001', ...reloj }),
          emitir(nota(f1), { almacen: conPausa(new AlmacenPostgres(nuevoPool(), { tenant }), pausa(s2, s1)), establecimiento: '000', puntoEmision: '002', ...reloj }),
        ]);
        expect(r.map((x) => (x.status === 'rejected' ? String(x.reason) : x.value.referencia?.numero))).toEqual([f2.numero, f1.numero]);
      }
    });

    it('control: el mismo cruce forzado sí detecta un orden inverso (la prueba anterior podría fallar)', async () => {
      // Una transacción que tomara 000-002-01 antes que 000-001-06 cerraría el ciclo con la nota de 000-001.
      const { tenant, facturas: [, f2] } = await preparar();
      const s1 = senal();
      const s2 = senal();
      const inverso = new AlmacenPostgres(nuevoPool(), { tenant }).transaccion(async (tx) => {
        await tx.bloquearSerie('000-002-01');
        await pausa(s2, s1)();
        await tx.bloquearSerie('000-001-06');
      });
      const r = await Promise.allSettled([
        emitir(nota(f2), { almacen: conPausa(new AlmacenPostgres(nuevoPool(), { tenant }), pausa(s1, s2)), establecimiento: '000', puntoEmision: '001', ...reloj }),
        inverso,
      ]);
      const codigos = r.map((x) => (x.status === 'rejected' ? (x.reason as { code?: string }).code : 'ok'));
      expect(codigos).toContain('40P01');
    });
  });

  it('un NUL o un sustituto suelto en un texto es TEXTO_CARACTER_NO_PERMITIDO, no un error de Postgres', async () => {
    const a = new AlmacenPostgres(pool, { tenant: `prueba-${randomUUID()}` });
    await registrarAutorizacion(a, D.autorizacion('CAI-A', 1, 100));
    const caja = { almacen: a, establecimiento: '000', puntoEmision: '001', opciones: { reloj: D.reloj } };
    for (const malo of ['Arroz\u0000', 'Arroz\ud800']) {
      const e = await emitir(D.entrada({ lineas: [{ descripcion: malo, cantidad: '1', precioUnitario: '10.00' }] }), caja).then(
        () => null,
        (x: { errores?: Array<{ codigo: string; campo?: string }> }) => x,
      );
      expect(e?.errores?.[0]).toMatchObject({ codigo: 'TEXTO_CARACTER_NO_PERMITIDO', campo: 'lineas[0].descripcion' });
    }
    // Sin número consumido, y el listado sin líneas (datos::jsonb - 'lineas') sigue funcionando.
    const doc = await emitir(D.entrada(), caja);
    expect(doc.correlativo).toBe(1);
    const pagina = await a.transaccion((tx) => tx.paginaDocumentos!({}, { limite: 10, sinLineas: true }));
    expect(pagina.map((d) => d.numero)).toEqual([doc.numero]);
  });

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
    const alterado = { ...doc, estado: 'ANULADO', totales: { ...doc.totales, total: 1 } };
    await expect(pool.query("UPDATE fhn_documentos SET estado = 'ANULADO', datos = $3 WHERE tenant = $1 AND numero = $2", [t, doc.numero, JSON.stringify(alterado)]))
      .rejects.toThrow(/solo puede anularse/);
    await pool.query("UPDATE fhn_documentos SET estado = 'ANULADO' WHERE tenant = $1 AND numero = $2", [t, doc.numero]);
    await expect(pool.query("UPDATE fhn_documentos SET estado = 'EMITIDO' WHERE tenant = $1", [t])).rejects.toThrow(/solo puede anularse/);
    await expect(pool.query('UPDATE fhn_series SET ultimo = 0 WHERE tenant = $1', [t])).rejects.toThrow(/no retrocede/);
    // Art. 53 num. 2: una autorización no se edita y al anular el contenido no cambia.
    await expect(pool.query('UPDATE fhn_autorizaciones SET rango_final = 999999 WHERE tenant = $1', [t])).rejects.toThrow(/no se modifican/);
    await expect(pool.query('DELETE FROM fhn_series WHERE tenant = $1', [t])).rejects.toThrow(/no se borran/);
    await expect(pool.query('DELETE FROM fhn_eventos WHERE tenant = $1', [t])).rejects.toThrow(/bitácora/);
    await expect(pool.query("UPDATE fhn_eventos SET tipo = 'X' WHERE tenant = $1", [t])).rejects.toThrow(/bitácora/);
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
