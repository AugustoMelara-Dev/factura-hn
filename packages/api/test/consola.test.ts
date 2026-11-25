/**
 * Consola del operador: ayuda, errores de uso en español con código 1, y `demo llave` contra PostgreSQL real.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { ejecutarConsola } from '../src/consola';
import { iniciarLocal, TENANT_DEMO } from '../src/operador';
import { arrancar } from '../src/servidor';
import { migrarApi } from '../src/esquema';
import { cerrarPool, cliente, EMISOR, poolPrueba, ROL, URL_PG } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

async function correr(args: string[], env: NodeJS.ProcessEnv = {}) {
  const log: string[] = [];
  const error: string[] = [];
  const codigo = await ejecutarConsola(args, { env, salida: { log: (t) => log.push(t), error: (t) => error.push(t) } });
  return { codigo, log: log.join('\n'), error: error.join('\n') };
}

describe('consola: ayuda y uso', () => {
  it('ayuda, --help y -h listan los comandos con código 0', async () => {
    for (const a of [['ayuda'], ['--help'], ['-h']]) {
      const r = await correr(a);
      expect(r.codigo).toBe(0);
      for (const c of ['migrar', 'tenant crear', 'llave crear', 'demo llave', 'openapi']) expect(r.log).toContain(c);
    }
  });

  it('ayuda de un subcomando, también con --help', async () => {
    const a = await correr(['ayuda', 'llave', 'crear']);
    expect(a.codigo).toBe(0);
    expect(a.log).toContain('Uso: node packages/api/dist/cli.js llave crear <tenant> --rol admin|caja');
    const b = await correr(['demo', 'llave', '--help']);
    expect(b.log).toContain('Uso: node packages/api/dist/cli.js demo llave');
  });

  it('usa FHN_CONSOLA para mostrar cómo se invoca', async () => {
    const r = await correr(['ayuda'], { FHN_CONSOLA: 'docker compose exec api factura-hn-api' });
    expect(r.log).toContain('Uso: docker compose exec api factura-hn-api <comando>');
  });

  it('sin comando, comando desconocido u opciones mal puestas: error en español y código 1, sin tocar la base', async () => {
    expect((await correr([])).codigo).toBe(1);
    const desconocido = await correr(['borrar', 'todo']);
    expect(desconocido).toMatchObject({ codigo: 1, error: expect.stringContaining('Error: no existe el comando «borrar todo»') });
    for (const [args, mensaje] of [
      [['llave', 'crear', 'local'], '--rol debe ser admin o caja'],
      [['llave', 'crear', 'local', '--rol', 'caja'], '--caja 000-001'],
      [['llave', 'crear', 'local', '--rol', 'caja', '--caja', '1-1'], 'establecimiento-punto'],
      [['llave', 'crear'], 'Falta <tenant>'],
      [['llave', 'crear', 'local', '--rol'], 'Falta el valor de --rol'],
      [['tenant', 'crear', 'x', '--limite', 'mil'], '--limite debe ser un número'],
      [['tenant', 'crear', 'x', '--color', 'azul'], 'Opción desconocida: --color'],
      [['migrar', 'ya'], 'Sobra el argumento «ya»'],
      [['demo', 'llave', '--rol', 'jefe'], '--rol debe ser admin o caja'],
    ] as const) {
      const r = await correr([...args]);
      expect(r.codigo, args.join(' ')).toBe(1);
      expect(r.error, args.join(' ')).toContain(mensaje);
      expect(r.error, args.join(' ')).toContain('Uso: node packages/api/dist/cli.js');
    }
    expect(await correr(['migrar'])).toMatchObject({ codigo: 1, error: expect.stringContaining('FHN_MIGRAR_URL') });
  });

  it('openapi imprime la especificación sin base', async () => {
    const r = await correr(['openapi']);
    expect(r.codigo).toBe(0);
    expect(JSON.parse(r.log).paths['/v1/sesion']).toBeDefined();
  });

  it('el servidor rechaza un FHN_PROXIES_DE_CONFIANZA que no es un número', async () => {
    await expect(arrancar({ DATABASE_URL: 'postgres://nadie@127.0.0.1:1/x', FHN_PROXIES_DE_CONFIANZA: 'uno' })).rejects.toThrow(/FHN_PROXIES_DE_CONFIANZA/);
  });
});

conBase('consola: demo llave', () => {
  it('crea una llave de caja del demo que emite, con el aviso de CAI ficticio', async () => {
    const pool = await poolPrueba();
    await iniciarLocal(pool, { demo: true, rol: ROL });
    const env = { DATABASE_URL: URL_PG, FHN_ROL: ROL };
    const r = await correr(['demo', 'llave'], env);
    expect(r.codigo).toBe(0);
    expect(r.log).toContain('CAI FICTICIO · DOCUMENTO DE PRUEBA — SIN VALOR FISCAL');
    const llave = /Llave de caja \(para emitir\): (fhn_\S+)/.exec(r.log)?.[1];
    expect(llave).toBeDefined();
    const app = crearApp({ pool, modo: 'local', rol: ROL, registrar: () => undefined });
    const { sesion } = (await (await cliente(app, llave!)('GET', '/v1/sesion')).json()) as { sesion: Record<string, any> };
    expect(sesion).toMatchObject({ tenant: TENANT_DEMO, demo: true, llave: { rol: 'caja', establecimiento: '000', puntoEmision: '001' } });

    // --solo-llave: la llave sola en la salida estándar; el aviso, en la de errores.
    const sola = await correr(['demo', 'llave', '--solo-llave'], env);
    expect(sola.codigo).toBe(0);
    expect(sola.log).toMatch(/^fhn_test_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(sola.error).toContain('CAI FICTICIO');
    expect(sola.error).toContain('caja 000-001');

    // La llave admin no está atada a un punto: el aviso no dice 000-001.
    const admin = await correr(['demo', 'llave', '--rol', 'admin'], env);
    expect(admin.codigo).toBe(0);
    expect(admin.log).toContain('Llave admin del demo:');
    expect(admin.log).not.toContain('000-001');
    const adminSola = await correr(['demo', 'llave', '--rol', 'admin', '--solo-llave'], env);
    expect(adminSola.error).toContain('tenant «demo»');
    expect(adminSola.error).not.toContain('000-001');
  });

  it('«tenant crear» no acepta los nombres reservados local y demo', async () => {
    const env = { DATABASE_URL: URL_PG, FHN_ROL: ROL };
    for (const nombre of ['demo', 'local']) {
      const r = await correr(['tenant', 'crear', nombre], env);
      expect(r.codigo).toBe(1);
      expect(r.error).toMatch(/reservado/);
    }
  });

  it('«demo llave» se niega si el tenant demo no es el de demostración', async () => {
    const p = await poolPrueba();
    const esquema = `prueba_demo_${randomBytes(4).toString('hex')}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      // Un tenant real que se llama «demo» (p. ej. creado antes de reservar el nombre), con su propio emisor.
      await propio.query("INSERT INTO api_tenants (tenant, nombre) VALUES ('demo', 'Negocio real')");
      await propio.query("INSERT INTO api_emisores (tenant, datos) VALUES ('demo', $1)", [JSON.stringify({ ...EMISOR, rtn: '99990000000002' })]);
      const r = await correr(['demo', 'llave'], { DATABASE_URL: u.toString(), FHN_ROL: ROL });
      expect(r.codigo).toBe(1);
      expect(r.error).toMatch(/no es el de demostración/);
      expect((await propio.query("SELECT count(*)::int AS n FROM api_llaves WHERE tenant = 'demo'")).rows[0].n).toBe(0);
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });
});
