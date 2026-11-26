/**
 * Consola del operador: ayuda, errores de uso en español con código 1, y `demo llave` contra PostgreSQL real.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/app';
import { ejecutarConsola, textoTokenMcp } from '../src/consola';
import { generarTokenMcp, hashLlave, llaveDeTokenMcp, prefijoDe } from '../src/llaves';
import { iniciarLocal, TENANT_DEMO } from '../src/operador';
import { arrancar } from '../src/servidor';
import { migrarApi } from '../src/esquema';
import { cerrarPool, cliente, EMISOR, nombreTenant, poolPrueba, ROL, URL_PG } from './ayuda';

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
      // El token del MCP va en una URL: solo de caja, y lo dice con qué hacer.
      [['llave', 'crear', 'local', '--rol', 'admin', '--mcp'], 'solo puede ser de una llave de caja'],
      [['llave', 'crear', 'local', '--rol', 'admin', '--caja', '000-001', '--mcp'], 'usa --rol caja --caja 000-001 con --mcp'],
    ] as const) {
      const r = await correr([...args]);
      expect(r.codigo, args.join(' ')).toBe(1);
      expect(r.error, args.join(' ')).toContain(mensaje);
      expect(r.error, args.join(' ')).toContain('Uso: node packages/api/dist/cli.js');
    }
    expect(await correr(['migrar'])).toMatchObject({ codigo: 1, error: expect.stringContaining('FHN_MIGRAR_URL') });
  });

  it('«tenant crear» se niega en modo local o sin FHN_MODO, sin tocar la base', async () => {
    for (const env of [{}, { FHN_MODO: 'local' }]) {
      const r = await correr(['tenant', 'crear', 'otro-negocio'], { ...env, DATABASE_URL: 'postgres://nadie@127.0.0.1:1/x' });
      expect(r.codigo).toBe(1);
      expect(r.error).toContain('No se crea «otro-negocio»: el modo local es para un solo negocio');
      expect(r.error).toContain('FHN_MODO=alojado');
      expect(r.error).not.toContain('no se pudo conectar');
    }
  });

  it('llave crear --mcp: la ayuda lo dice y el texto lleva el token, la URL y el aviso', async () => {
    expect((await correr(['ayuda', 'llave', 'crear'])).log).toContain('[--mcp]');
    const t = generarTokenMcp('produccion');
    const texto = textoTokenMcp('000-001', t.token);
    expect(texto).toContain(`https://<tu-servidor>/mcp/${t.token}`);
    expect(texto).toMatch(/Trata esa URL como una contraseña/);
    expect(texto).toMatch(/no puede anular/);
    // La llave que se guarda es la que el servidor MCP deriva del token impreso.
    const derivada = llaveDeTokenMcp(t.token)!;
    expect(derivada).toBe(t.llave);
    expect(derivada).toMatch(/^fhn_live_/);
    expect(prefijoDe(derivada)).toBe(t.prefijo);
    expect(hashLlave(derivada).equals(t.hash)).toBe(true);
  });

  it('openapi imprime la especificación sin base', async () => {
    const r = await correr(['openapi']);
    expect(r.codigo).toBe(0);
    expect(JSON.parse(r.log).paths['/v1/sesion']).toBeDefined();
  });

  it('una conexión que vence por tiempo (pg-pool, sin code) da el mensaje de conexión, no el texto en inglés', async () => {
    const corte = new Error('Connection terminated due to connection timeout');
    const conectar = vi.spyOn(pg.Pool.prototype, 'connect').mockRejectedValue(corte as never);
    const consultar = vi.spyOn(pg.Pool.prototype, 'query').mockRejectedValue(corte as never);
    try {
      const r = await correr(['demo', 'limpiar'], { DATABASE_URL: 'postgres://nadie@127.0.0.1:1/x' });
      expect(r.codigo).toBe(1);
      expect(r.error).toContain('no se pudo conectar a la base (tiempo de espera agotado)');
      expect(r.error).toContain('DATABASE_URL');
      expect(r.error).not.toContain('Connection terminated');
    } finally {
      conectar.mockRestore();
      consultar.mockRestore();
    }
  });

  it('openapi <archivo>: lo escribe; si no puede (carpeta inexistente o sin permiso), lo dice en español y sugiere redirigir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-openapi-'));
    try {
      const bien = join(dir, 'op ñ.json');
      const r = await correr(['openapi', bien]);
      expect(r.codigo).toBe(0);
      expect(JSON.parse(readFileSync(bien, 'utf8')).paths['/v1/sesion']).toBeDefined();
      expect(r.log).toContain('Especificación OpenAPI escrita en');

      const sinCarpeta = await correr(['openapi', join(dir, 'no-existe', 'x.json')]);
      expect(sinCarpeta.codigo).toBe(1);
      expect(sinCarpeta.error).toMatch(/No se pudo escribir .*x\.json \(la carpeta no existe\)/);
      expect(sinCarpeta.error).toContain('openapi > openapi.json');
      expect(sinCarpeta.error).not.toMatch(/ENOENT|no such file/);

      // Un archivo de solo lectura (como la carpeta de trabajo de la imagen de Docker, que no se puede escribir).
      // (root escribe igual en un archivo de solo lectura: ahí no aplica.)
      if (process.getuid?.() === 0) return;
      const soloLectura = join(dir, 'solo-lectura.json');
      writeFileSync(soloLectura, '{}');
      chmodSync(soloLectura, 0o444);
      const sinPermiso = await correr(['openapi', soloLectura], { FHN_CONSOLA: 'docker compose exec -T api factura-hn-api' });
      expect(sinPermiso.codigo).toBe(1);
      expect(sinPermiso.error).toContain('(no hay permiso para escribir ahí)');
      expect(sinPermiso.error).toContain('docker compose exec -T api factura-hn-api openapi > openapi.json');
      expect(sinPermiso.error).not.toMatch(/EACCES|EPERM|permission denied/);
      chmodSync(soloLectura, 0o644);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('el servidor rechaza un FHN_PROXIES_DE_CONFIANZA que no es un número', async () => {
    await expect(arrancar({ DATABASE_URL: 'postgres://nadie@127.0.0.1:1/x', FHN_PROXIES_DE_CONFIANZA: 'uno' })).rejects.toThrow(/FHN_PROXIES_DE_CONFIANZA/);
  });
});

conBase('consola: llave crear --mcp', () => {
  it('guarda la llave derivada del token con su rol y caja, y se revoca como cualquier llave', async () => {
    const pool = await poolPrueba();
    const env = { DATABASE_URL: URL_PG, FHN_ROL: ROL, FHN_MODO: 'alojado' };
    const tenant = nombreTenant('mcp');
    const creado = await correr(['tenant', 'crear', tenant], env);
    expect(creado.codigo).toBe(0);
    const admin = /Llave admin \(solo se muestra ahora\): (fhn_\S+)/.exec(creado.log)![1]!;
    // Otra vez el mismo tenant: error en español que lo nombra, no el de Postgres.
    const repetido = await correr(['tenant', 'crear', tenant], env);
    expect(repetido.codigo).toBe(1);
    expect(repetido.error).toContain(`El tenant «${tenant}» ya existe. Para otra llave: llave crear ${tenant} --rol admin`);
    expect(repetido.error).not.toMatch(/duplicate key/);

    // Con --rol admin se niega y no guarda ninguna llave.
    const contar = async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
        const n = (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM api_llaves WHERE tenant = $1', [tenant])).rows[0]!.n;
        await c.query('COMMIT');
        return n;
      } finally {
        c.release();
      }
    };
    const antes = await contar();
    const negada = await correr(['llave', 'crear', tenant, '--rol', 'admin', '--mcp'], env);
    expect(negada.codigo).toBe(1);
    expect(negada.error).toContain('solo puede ser de una llave de caja');
    expect(negada.log).not.toMatch(/fhnmcp_/);
    expect(await contar()).toBe(antes);

    const r = await correr(['llave', 'crear', tenant, '--rol', 'caja', '--caja', '000-001', '--mcp'], env);
    expect(r.codigo).toBe(0);
    const token = /Token MCP de la caja 000-001 \(solo se muestra ahora\): (fhnmcp_\S+)/.exec(r.log)?.[1];
    expect(token).toMatch(/^fhnmcp_live_[0-9a-f]{12}_/);
    expect(r.log).toContain(`https://<tu-servidor>/mcp/${token}`);
    expect(r.log).not.toMatch(/fhn_live_/);

    const app = crearApp({ pool, modo: 'alojado', rol: ROL, registrar: () => undefined });
    const llave = llaveDeTokenMcp(token!)!;
    const sesion = await cliente(app, llave)('GET', '/v1/sesion');
    expect(sesion.status).toBe(200);
    expect(((await sesion.json()) as { sesion: unknown }).sesion).toMatchObject({ tenant, llave: { rol: 'caja', establecimiento: '000', puntoEmision: '001' } });

    // La bitácora dice que la llave es la de una URL del MCP.
    const bit = await pool.connect();
    try {
      await bit.query('BEGIN');
      await bit.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
      const fila = await bit.query("SELECT detalle FROM api_bitacora WHERE tenant = $1 AND accion = 'llave.creada' AND detalle->>'prefijo' = $2", [tenant, prefijoDe(llave)]);
      await bit.query('COMMIT');
      expect(fila.rows[0]?.detalle).toMatchObject({ rol: 'caja', mcp: true });
    } finally {
      bit.release();
    }

    const revocada = await cliente(app, admin)('DELETE', `/v1/llaves/${prefijoDe(llave)}`);
    expect(revocada.status).toBeLessThan(300);
    expect((await cliente(app, llave)('GET', '/v1/sesion')).status).toBe(401);
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
