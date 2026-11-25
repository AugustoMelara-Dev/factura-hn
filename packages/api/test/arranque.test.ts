/**
 * Arranque del servidor (`arrancar`): rol LOGIN propio de la API, lo que se imprime en una instalación nueva y
 * el modo por defecto. Cada prueba usa un esquema nuevo de la base de pruebas: es una instalación nueva y el
 * despachador del servidor no toca los datos de las demás pruebas.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mantenimientoApi, migrarApi, rolLoginApi } from '../src/esquema';
import { comandoLlaveAdminLocal, crearLlaveOperador, crearTenant, TENANT_DEMO, TENANT_LOCAL } from '../src/operador';
import { usuarioDeUrlSiHay } from '../src/pool';
import { arrancar } from '../src/servidor';
import { CofreSecretos, despacharWebhooks } from '../src/webhooks';
import { caiAleatorio, cerrarPool, cliente, EMISOR, FECHA_LIMITE, poolPrueba, ROL, URL_PG, venta } from './ayuda';

const esquemas: string[] = [];
const roles: string[] = [];
const pools: pg.Pool[] = [];

afterAll(async () => {
  for (const p of pools) await p.end().catch(() => undefined);
  if (!URL_PG) return;
  const p = await poolPrueba();
  for (const e of esquemas) await p.query(`DROP SCHEMA IF EXISTS ${e} CASCADE`);
  for (const r of roles) await p.query(`DROP ROLE IF EXISTS ${r}`);
  await cerrarPool();
});

const hex = () => randomBytes(4).toString('hex');

/** URL de la base de pruebas con un esquema nuevo y, si se pide, otro usuario. */
async function esquemaNuevo(dueno?: string): Promise<((usuario?: string) => string) & { esquema: string }> {
  const nombre = `prueba_arranque_${hex()}`;
  // Como el esquema public: cualquiera puede usarlo; los permisos están en cada tabla.
  await (await poolPrueba()).query(`CREATE SCHEMA ${nombre}${dueno ? ` AUTHORIZATION ${dueno}` : ''}; GRANT USAGE ON SCHEMA ${nombre} TO PUBLIC`);
  esquemas.push(nombre);
  const url = (usuario?: string) => {
    const u = new URL(URL_PG!);
    if (usuario) u.username = usuario;
    u.searchParams.set('options', `-c search_path=${nombre}`);
    return u.toString();
  };
  return Object.assign(url, { esquema: nombre });
}
const nuevoPool = (url: string) => {
  const p = new pg.Pool({ connectionString: url, max: 4 });
  pools.push(p);
  return p;
};

let salida: { log: string[]; warn: string[] };
beforeEach(() => {
  salida = { log: [], warn: [] };
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void salida.log.push(a.join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void salida.warn.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const base = { PUERTO: '0', FHN_HOST: '127.0.0.1' };
const LLAVE = /fhn_(?:live|test)_[0-9a-f]{12}_[A-Za-z0-9_-]+/g;

describe('rol LOGIN de la API', () => {
  it('valida el nombre del rol LOGIN y no admite el mismo rol de la aplicación', () => {
    expect(rolLoginApi('fhn_api')).toContain('LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT');
    expect(rolLoginApi('fhn_api')).toContain('GRANT fhn_app TO fhn_api;');
    for (const malo of ['Mayusculas', 'fhn-api', 'x; DROP TABLE y', '']) expect(() => rolLoginApi(malo), malo).toThrow(/inválido/);
    expect(() => rolLoginApi('fhn_app')).toThrow(/distinto/);
  });
});

describe.skipIf(!URL_PG)('arranque', () => {
  it('con FHN_MIGRAR_URL corre como un rol LOGIN creado por la migración, sin superusuario ni BYPASSRLS, y emite de punta a punta', async () => {
    const url = await esquemaNuevo();
    const login = `fhn_api_prueba_${hex()}`;
    roles.push(login);
    const claveCifrado = randomBytes(32).toString('base64');
    const s = await arrancar({
      ...base, DATABASE_URL: url(login), FHN_MIGRAR_URL: url(), FHN_MODO: 'alojado', FHN_CLAVE_CIFRADO: claveCifrado,
    });
    expect(salida.warn.join('\n')).not.toMatch(/dueño de las tablas/);
    const dueno = nuevoPool(url());
    const runtime = nuevoPool(url(login));
    let cerrado = false;
    try {
      // Dos tenants creados por el operador (con el dueño); todo lo demás pasa por la API, como el rol LOGIN.
      const tenants = [`a-${hex()}`, `b-${hex()}`];
      const admins = [];
      for (const tenant of tenants) {
        const { llaveAdmin } = await crearTenant(dueno, { tenant, nombre: tenant });
        const admin = cliente(s.app, llaveAdmin);
        expect((await admin('POST', '/v1/emisores', EMISOR)).status).toBe(201);
        const aut = await admin('POST', '/v1/autorizaciones', {
          cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: FECHA_LIMITE,
        });
        expect(aut.status).toBe(201);
        expect((await admin('POST', '/v1/webhooks', { url: 'https://hooks.ejemplo.example/factura', eventos: ['documento.emitido'] })).status).toBe(201);
        admins.push(admin);
      }
      const admin = admins[0]!;
      const clave = randomUUID();
      const r = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': clave });
      expect(r.status).toBe(201);
      const doc = (await r.json()).documento;
      const otra = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': clave });
      expect([otra.status, otra.headers.get('idempotency-replayed')]).toEqual([201, 'true']);
      expect((await admin('GET', `/v1/documentos/${doc.numero}.pdf`)).status).toBe(200);
      expect((await admin('GET', '/v1/bitacora?origen=api')).status).toBe(200);
      expect((await admins[1]!('POST', '/v1/documentos', venta(), { 'idempotency-key': clave })).status).toBe(201);
      expect((await dueno.query('SELECT tenant, documentos FROM api_uso ORDER BY tenant')).rows.map((f) => f.documentos)).toEqual([1, 1]);
      // El despachador del servidor ya no corre: el de la prueba entrega con un receptor simulado.
      await s.cerrar();
      cerrado = true;
      await dueno.query("UPDATE api_entregas SET estado = 'PENDIENTE', intentos = 0, proximo = now()");

      // Despachador y mantenimiento, también como el rol LOGIN.
      const enviados: string[] = [];
      const n = await despacharWebhooks({
        pool: runtime, rol: ROL, cofre: new CofreSecretos(claveCifrado), permitirRedInterna: false,
        fetch: (async (u: string) => {
          enviados.push(String(u));
          return new Response(null, { status: 200 });
        }) as unknown as typeof fetch,
      });
      expect(n).toBe(2);
      expect((await dueno.query("SELECT count(*)::int AS n FROM api_entregas WHERE estado = 'ENTREGADA'")).rows[0].n).toBe(2);
      await expect(mantenimientoApi(runtime, ROL, 30)).resolves.toMatchObject({ compactadas: 0 });

      // La sesión de la API no es superusuario ni salta RLS.
      const atributos = await runtime.query('SELECT rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = current_user');
      expect(atributos.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolinherit: false }]);

      // Aunque un SQL de la sesión haga RESET ROLE, el rol LOGIN no lee ni cambia nada.
      const trasReset = async (sql: string, p: unknown[] = []) => {
        const c = await runtime.connect();
        try {
          await c.query('BEGIN');
          await c.query(`SET LOCAL ROLE ${ROL}`);
          await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenants[1]]);
          await c.query('RESET ROLE');
          return await c.query(sql, p);
        } finally {
          await c.query('ROLLBACK');
          c.release();
        }
      };
      for (const [sql, p] of [
        ['SELECT * FROM api_llaves WHERE tenant = $1', [tenants[0]]],
        ['SELECT * FROM api_llaves', []],
        ['SELECT * FROM fhn_documentos', []],
        ['SELECT * FROM fhn_eventos', []],
        ['SELECT * FROM api_idempotencia', []],
        ["UPDATE fhn_documentos SET estado = 'ANULADO'", []],
        ['DELETE FROM fhn_documentos', []],
        ['DELETE FROM fhn_eventos', []],
        ['UPDATE fhn_series SET ultimo = 0', []],
        ['DELETE FROM fhn_autorizaciones', []],
      ] as [string, unknown[]][]) {
        await expect(trasReset(sql, p), sql).rejects.toThrow(/permission denied/);
      }
      await expect(trasReset('SET ROLE postgres')).rejects.toThrow(/permission denied/);
    } finally {
      if (!cerrado) await s.cerrar();
    }
  });

  it('instalación nueva en modo local: crea el tenant local sin llave, dice cómo crearla y solo imprime las llaves del demo', async () => {
    const url = await esquemaNuevo();
    const env = { ...base, DATABASE_URL: url(), FHN_MODO: 'local', FHN_DEMO: '1' };
    const s1 = await arrancar(env);
    await s1.cerrar();
    const log = salida.log.join('\n');
    expect(log).toContain(comandoLlaveAdminLocal('node packages/api/dist/cli.js'));
    expect(log).toContain('CAI FICTICIO · DOCUMENTO DE PRUEBA — SIN VALOR FISCAL');
    expect(log).toContain('node packages/api/dist/cli.js demo llave');
    // Sin FHN_MIGRAR_URL, un aviso; con FHN_MODO definido, ningún aviso de modo.
    expect(salida.warn.join('\n')).toMatch(/dueño de las tablas/);
    expect(salida.warn.join('\n')).not.toMatch(/FHN_MODO no está definida/);

    const pool = nuevoPool(url());
    const llaves = (await pool.query('SELECT tenant, prefijo FROM api_llaves ORDER BY tenant')).rows;
    expect(llaves.every((f) => f.tenant === TENANT_DEMO)).toBe(true);
    expect((await pool.query('SELECT tenant FROM api_tenants ORDER BY tenant')).rows.map((f) => f.tenant)).toEqual([TENANT_DEMO, TENANT_LOCAL]);
    // Las únicas llaves impresas son las del demo.
    const impresas = log.match(LLAVE) ?? [];
    expect(impresas).toHaveLength(2);
    expect(impresas.map((l) => l.split('_')[2]).sort()).toEqual(llaves.map((f) => f.prefijo).sort());

    // Segundo arranque: ninguna llave; sigue diciendo cómo crear la del negocio y otra llave del demo.
    salida.log.length = 0;
    await (await arrancar(env)).cerrar();
    expect(salida.log.join('\n')).not.toMatch(LLAVE);
    expect(salida.log.join('\n')).toContain(comandoLlaveAdminLocal('node packages/api/dist/cli.js'));
    expect(salida.log.join('\n')).toMatch(/demostración activa.*node packages\/api\/dist\/cli\.js demo llave/);

    // Con la llave admin creada por la consola, el aviso ya no sale. Con FHN_CONSOLA (la imagen de Docker), los
    // comandos salen como se invocan ahí.
    await crearLlaveOperador(pool, { tenant: TENANT_LOCAL, rol: 'admin', nombre: 'Administración' });
    salida.log.length = 0;
    await (await arrancar({ ...env, FHN_CONSOLA: 'docker compose exec api factura-hn-api' })).cerrar();
    expect(salida.log.join('\n')).not.toContain('llave crear local');
    expect(salida.log.join('\n')).not.toMatch(LLAVE);
    expect(salida.log.join('\n')).toContain('docker compose exec api factura-hn-api demo llave');
  });

  it('sin FHN_MODO avisa que corre en modo local y que un servicio con varios negocios usa alojado', async () => {
    const url = await esquemaNuevo();
    await (await arrancar({ ...base, DATABASE_URL: url() })).cerrar();
    const avisos = salida.warn.join('\n');
    expect(avisos).toMatch(/FHN_MODO no está definida/);
    expect(avisos).toMatch(/red interna/);
    expect(avisos).toMatch(/secretos/);
    expect(avisos).toMatch(/FHN_MODO=alojado/);
  });

  it('en modo local se niega a arrancar si la base tiene tenants de otros negocios; en alojado arranca', async () => {
    const url = await esquemaNuevo();
    const pool = nuevoPool(url());
    await migrarApi(pool, ROL);
    await crearTenant(pool, { tenant: 'otro-negocio', nombre: 'Otro negocio' });
    const error = await arrancar({ ...base, DATABASE_URL: url(), FHN_MODO: 'local' }).then(() => null, (e: Error) => e.message);
    expect(error).toMatch(/otro-negocio.*FHN_MODO=alojado/s);
    await expect(arrancar({ ...base, DATABASE_URL: url() })).rejects.toThrow(/FHN_MODO=alojado/);
    // No dejó creado el tenant local.
    expect((await pool.query("SELECT 1 FROM api_tenants WHERE tenant = 'local'")).rowCount).toBe(0);
    const s = await arrancar({ ...base, DATABASE_URL: url(), FHN_MODO: 'alojado', FHN_CLAVE_CIFRADO: randomBytes(32).toString('base64') });
    await s.cerrar();

    // El error trae el SQL para desactivar el tenant que sobra; aplicado, el modo local arranca.
    const sql = /-c "([^"]+)"/.exec(error!)![1]!;
    expect(sql).toContain("UPDATE api_tenants SET activo = false WHERE tenant = 'otro-negocio'");
    await pool.query(sql);
    await (await arrancar({ ...base, DATABASE_URL: url(), FHN_MODO: 'local' })).cerrar();
    expect((await pool.query("SELECT activo FROM api_tenants WHERE tenant = 'otro-negocio'")).rows).toEqual([{ activo: false }]);
    // Un tenant desactivado con una llave activa sigue contando.
    await crearLlaveOperador(pool, { tenant: 'otro-negocio', rol: 'admin', nombre: 'otra' });
    await expect(arrancar({ ...base, DATABASE_URL: url(), FHN_MODO: 'local' })).rejects.toThrow(/otro-negocio/);
  });

  it('la consola no crea llaves para un tenant que no existe', async () => {
    const p = await poolPrueba();
    await expect(crearLlaveOperador(p, { tenant: `no-existe-${hex()}`, rol: 'admin', nombre: 'x' })).rejects.toThrow(/no existe: arranca la API una vez.*tenant crear/);
  });

  it('con FHN_MIGRAR_URL no arranca si DATABASE_URL usa el mismo usuario que el dueño', async () => {
    const url = await esquemaNuevo();
    expect(usuarioDeUrlSiHay(url())).toBe('postgres');
    await expect(arrancar({ ...base, DATABASE_URL: url(), FHN_MIGRAR_URL: url(), FHN_MODO: 'local' })).rejects.toThrow(/mismo usuario/);
  });

  it('con FHN_MIGRAR_URL no arranca si DATABASE_URL salta RLS', async () => {
    const url = await esquemaNuevo();
    const poderoso = `fhn_poderoso_${hex()}`;
    roles.push(poderoso);
    await (await poolPrueba()).query(`CREATE ROLE ${poderoso} LOGIN BYPASSRLS`);
    await expect(arrancar({ ...base, DATABASE_URL: url(poderoso), FHN_MIGRAR_URL: url(), FHN_MODO: 'local' })).rejects.toThrow(/BYPASSRLS.*rol LOGIN propio/s);
  });

  it('con FHN_MIGRAR_URL no arranca si DATABASE_URL puede pasar (SET ROLE) a un rol superusuario, con BYPASSRLS o pg_write_all_data', async () => {
    const url = await esquemaNuevo();
    const p = await poolPrueba();
    const conBypass = `fhn_con_bypass_${hex()}`;
    const casos: [string, string, RegExp][] = [
      [`fhn_miembro_bypass_${hex()}`, `NOINHERIT IN ROLE ${conBypass}`, /miembro de un rol con BYPASSRLS/],
      [`fhn_miembro_super_${hex()}`, 'NOINHERIT IN ROLE postgres', /miembro de un rol superusuario/],
      [`fhn_miembro_escritura_${hex()}`, 'IN ROLE pg_write_all_data', /pg_write_all_data/],
    ];
    roles.push(...casos.map((c) => c[0]), conBypass);
    await p.query(`CREATE ROLE ${conBypass} NOLOGIN BYPASSRLS`);
    for (const [login, miembro, motivo] of casos) {
      await p.query(`CREATE ROLE ${login} LOGIN ${miembro}`);
      await expect(arrancar({ ...base, DATABASE_URL: url(login), FHN_MIGRAR_URL: url(), FHN_MODO: 'local' }), login).rejects.toThrow(motivo);
    }
  });

  it('dueño sin superusuario (Postgres administrado): migra, arranca, mantiene y devuelve el tenant de quien llama, también con error', async () => {
    const dueno = `fhn_dueno_${hex()}`;
    const app = `fhn_app_${hex()}`;
    const login = `fhn_api_${hex()}`;
    const miembroDelDueno = `fhn_api_mal_${hex()}`;
    roles.push(login, miembroDelDueno, app, dueno);
    const p = await poolPrueba();
    await p.query(`CREATE ROLE ${dueno} LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS`);
    const url = await esquemaNuevo(dueno);
    const claveCifrado = randomBytes(32).toString('base64');
    const env = { ...base, DATABASE_URL: url(login), FHN_MIGRAR_URL: url(dueno), FHN_ROL: app, FHN_MODO: 'alojado', FHN_CLAVE_CIFRADO: claveCifrado };
    await (await arrancar(env)).cerrar();
    expect((await p.query('SELECT rolsuper FROM pg_roles WHERE rolname = $1', [dueno])).rows).toEqual([{ rolsuper: false }]);

    // Un tenant que emite, con una clave vieja por compactar.
    const duenoPool = nuevoPool(url(dueno));
    const runtime = nuevoPool(url(login));
    const s2 = await arrancar(env);
    try {
      const tenant = `t-${hex()}`;
      const { llaveAdmin } = await crearTenant(duenoPool, { tenant, nombre: tenant });
      const admin = cliente(s2.app, llaveAdmin);
      expect((await admin('POST', '/v1/emisores', EMISOR)).status).toBe(201);
      expect((await admin('POST', '/v1/autorizaciones', {
        cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: FECHA_LIMITE,
      })).status).toBe(201);
      expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': 'vieja' })).status).toBe(201);
    } finally {
      await s2.cerrar();
    }
    await p.query(`UPDATE ${url.esquema}.api_idempotencia SET creada = now() - interval '40 days'`);

    const comoApp = async (fn: (c: pg.PoolClient) => Promise<void>) => {
      const c = await runtime.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${app}`);
        await c.query("SELECT set_config('factura_hn.tenant', 'quien-llama', true)");
        await fn(c);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    };
    const tenantActual = async (c: pg.PoolClient) => (await c.query("SELECT current_setting('factura_hn.tenant') AS t")).rows[0].t;

    // Con error a mitad del recorrido (un disparador de la prueba), el tenant de quien llama se recupera.
    await p.query(`CREATE FUNCTION ${url.esquema}.prueba_falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla de prueba'; END $$`);
    await p.query(`CREATE TRIGGER prueba_falla BEFORE UPDATE ON ${url.esquema}.api_idempotencia FOR EACH ROW EXECUTE FUNCTION ${url.esquema}.prueba_falla()`);
    await comoApp(async (c) => {
      await c.query('SAVEPOINT s');
      await expect(c.query('SELECT * FROM fhn_api_mantenimiento(30)')).rejects.toThrow(/falla de prueba/);
      await c.query('ROLLBACK TO SAVEPOINT s');
      expect(await tenantActual(c)).toBe('quien-llama');
    });
    await p.query(`DROP TRIGGER prueba_falla ON ${url.esquema}.api_idempotencia`);

    // Sin error: compacta como el rol de la aplicación y también devuelve el tenant.
    await comoApp(async (c) => {
      const r = (await c.query('SELECT compactadas FROM fhn_api_mantenimiento(30)')).rows[0];
      expect(Number(r.compactadas)).toBe(1);
      expect(await tenantActual(c)).toBe('quien-llama');
    });
    await expect(mantenimientoApi(runtime, app, 30)).resolves.toMatchObject({ compactadas: 1 });
    expect((await p.query(`SELECT respuesta FROM ${url.esquema}.api_idempotencia`)).rows[0].respuesta).toEqual({ numero: '000-001-01-00000001' });

    // Un rol LOGIN miembro del dueño no se acepta como DATABASE_URL.
    await p.query(`CREATE ROLE ${miembroDelDueno} LOGIN`);
    await p.query(`GRANT ${dueno} TO ${miembroDelDueno}`);
    await expect(arrancar({ ...env, DATABASE_URL: url(miembroDelDueno) })).rejects.toThrow(/dueño de las tablas/);
  });
});
