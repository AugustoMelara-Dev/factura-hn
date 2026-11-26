/** Comandos de consola: init (con y sin --demo), registrar-cai y ayuda. */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buscarDocumento, registrarAutorizacion } from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';
import { bloqueMcpServers, ejecutarComando, type Contexto } from '../src/comandos';
import { LEYENDA_PRUEBA } from '../src/demo';
import { leerEmisor } from '../src/emisor';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const HOY = new Date('2026-11-24T15:00:00Z');

/** Ejecuta un comando y devuelve el código, stdout y stderr. */
async function correr(args: string[], c: Partial<Contexto> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const codigo = await ejecutarComando(args, { cwd: c.cwd ?? process.cwd(), env: c.env ?? {}, reloj: () => HOY, plataforma: c.plataforma ?? 'linux', salida: { out: (t) => out.push(t), err: (t) => err.push(t) } });
  return { codigo, out: out.join('\n'), err: err.join('\n') };
}

/** El bloque mcpServers impreso por init. */
const bloqueDe = (salida: string) => JSON.parse(/\{\n  "mcpServers"[\s\S]*?\n\}/.exec(salida)![0]) as { mcpServers: { 'factura-hn': { command: string; args: string[]; env: Record<string, string> } } };

const autorizaciones = (base: string) => {
  const db = new DatabaseSync(base);
  try {
    return (db.prepare('SELECT * FROM fhn_autorizaciones').all() as Record<string, unknown>[]).length;
  } finally {
    db.close();
  }
};

const resolucion = ['--cai', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', '--tipo', '01', '--establecimiento', '000', '--punto', '001', '--desde', '1', '--hasta', '5000', '--fecha-limite', '2027-10-31'];

describe('init --demo', () => {
  it('crea la base y el emisor de prueba, registra el CAI ficticio e imprime el bloque con rutas absolutas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    const r = await correr(['init', '--demo'], { cwd: dir });
    expect(r.codigo).toBe(0);
    const base = join(dir, 'factura-demo.db');
    const emisor = join(dir, 'emisor-demo.json');
    expect(existsSync(base) && existsSync(emisor)).toBe(true);
    expect(leerEmisor(emisor).razonSocial).toMatch(/DEMOSTRACIÓN/);
    // CAI ficticio para 01, 06 y 07, con fecha límite a 180 días de hoy.
    expect(r.out).toContain('Registrado el CAI ficticio DEMO00-NO-VALIDO-0000-0000-0000-01 (000-001-01, rango 1–5000, fecha límite 2027-05-23)');
    expect(autorizaciones(base)).toBe(3);
    expect(r.out).toContain(LEYENDA_PRUEBA);
    const b = bloqueDe(r.out).mcpServers['factura-hn'];
    expect(b).toEqual({ command: 'npx', args: ['-y', expect.stringMatching(/^@factura-hn\/mcp@\d+\.\d+\.\d+/)], env: { FHN_SQLITE: base, FHN_EMISOR: emisor, FHN_ESTABLECIMIENTO: '000', FHN_PUNTO: '001' } });
    expect(r.out).toMatch(/Claude Desktop[\s\S]*Claude Code[\s\S]*Cursor[\s\S]*VS Code/);
    expect(r.out).toContain('«emite una factura de prueba»');
  });

  it('es idempotente: la segunda vez conserva todo y no registra otro CAI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    await correr(['iniciar', '--demo'], { cwd: dir });
    writeFileSync(join(dir, 'emisor-demo.json'), JSON.stringify({ ...leerEmisor(join(dir, 'emisor-demo.json')), telefono: '0000-0002' }));
    const r = await correr(['init', '--demo'], { cwd: dir });
    expect(r.codigo).toBe(0);
    expect(r.out).toMatch(/Se conserva .*emisor-demo\.json \(ya existía; usa --forzar/);
    expect(r.out).toContain('El CAI ficticio ya estaba registrado.');
    expect(leerEmisor(join(dir, 'emisor-demo.json')).telefono).toBe('0000-0002');
    expect(autorizaciones(join(dir, 'factura-demo.db'))).toBe(3);
  });

  it('--forzar reescribe el emisor y recrea la base de prueba; --dir, --establecimiento y --punto', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    await correr(['init', '--demo', '--dir', 'caja2', '--establecimiento', '1', '--punto', '2'], { cwd: raiz });
    const dir = join(raiz, 'caja2');
    const base = join(dir, 'factura-demo.db');
    const db = new DatabaseSync(base);
    db.exec('CREATE TABLE marca (x)'); // para comprobar que la base se recrea
    db.close();
    writeFileSync(join(dir, 'emisor-demo.json'), '{}');
    const r = await correr(['init', '--demo', '--forzar', '--dir', dir, '--establecimiento', '001', '--punto', '002']);
    expect(r.out).toMatch(/Reescrito .*emisor-demo\.json/);
    expect(r.out).toMatch(/Recreada la base de prueba/);
    expect(r.out).toContain('(001-002-01,');
    expect(bloqueDe(r.out).mcpServers['factura-hn'].env).toMatchObject({ FHN_ESTABLECIMIENTO: '001', FHN_PUNTO: '002' });
    expect(leerEmisor(join(dir, 'emisor-demo.json')).rtn).toBe('99990000000000');
    const recreada = new DatabaseSync(base);
    expect(recreada.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'marca'").get()).toEqual({ n: 0 });
    recreada.close();
    expect(autorizaciones(base)).toBe(3);
  });

  it('en Windows el bloque lanza npx con cmd /c', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    const r = await correr(['init', '--demo'], { cwd: dir, plataforma: 'win32' });
    const version = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version as string;
    // Con la versión fija: el cliente MCP arranca siempre la que imprimió el bloque.
    expect(bloqueDe(r.out).mcpServers['factura-hn']).toMatchObject({ command: 'cmd', args: ['/c', 'npx', '-y', `@factura-hn/mcp@${version}`] });
    expect(r.out).toContain('Claude Desktop: Settings > Developer > Edit Config');
    expect(bloqueMcpServers({}, 'darwin').mcpServers['factura-hn']).toMatchObject({ command: 'npx', args: ['-y', `@factura-hn/mcp@${version}`] });
  });

  it('opciones mal escritas: error en español y código 1', async () => {
    expect(await correr(['init', '--demoo'])).toMatchObject({ codigo: 1, err: expect.stringMatching(/^Opción desconocida: --demoo\./) });
    expect(await correr(['init', '--punto', 'abcd'])).toMatchObject({ codigo: 1, err: expect.stringMatching(/--punto debe tener hasta 3 dígitos/) });
  });
});

describe('init --demo no toca una base con CAI reales', () => {
  /** Base factura-demo.db con un CAI real (p. ej. copiada por error), registrado sin pasar por las comprobaciones del MCP. */
  async function baseConCAIReal() {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    const base = join(dir, 'factura-demo.db');
    const db = new DatabaseSync(base);
    await registrarAutorizacion(new AlmacenSQLite(db), { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '06', establecimiento: '000', puntoEmision: '002', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-10-31' });
    db.close();
    return { dir, base };
  }

  it('--forzar no la borra', async () => {
    const { dir, base } = await baseConCAIReal();
    const r = await correr(['init', '--demo', '--forzar'], { cwd: dir });
    expect(r).toMatchObject({ codigo: 1, err: expect.stringMatching(/tiene un CAI real \(A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4\): no es una base de prueba\. No se modifica ni se borra\./) });
    expect(autorizaciones(base)).toBe(1);
  });

  it('sin --forzar no registra ningún CAI ficticio: todo o nada', async () => {
    const { dir, base } = await baseConCAIReal();
    expect((await correr(['init', '--demo'], { cwd: dir })).codigo).toBe(1);
    expect(autorizaciones(base)).toBe(1);
  });

  it('un documento con CAI real también cuenta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    await correr(['init', '--demo'], { cwd: dir });
    const db = new DatabaseSync(join(dir, 'factura-demo.db'));
    db.prepare("INSERT INTO fhn_documentos (numero, identificador, correlativo, fecha_emision, estado, datos) VALUES ('000-003-01-00000001', '000-003-01', 1, '2026-11-24', 'EMITIDO', ?)").run(JSON.stringify({ cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4' }));
    db.close();
    expect((await correr(['init', '--demo', '--forzar'], { cwd: dir })).err).toMatch(/tiene un CAI real/);
  });
});

describe('init sin --demo', () => {
  it('crea la base vacía y la plantilla, y explica cómo registrar el CAI real', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    const r = await correr(['init'], { cwd: dir });
    expect(r.codigo).toBe(0);
    const base = join(dir, 'factura.db');
    expect(autorizaciones(base)).toBe(0);
    expect(() => leerEmisor(join(dir, 'emisor.json'))).toThrow(/7 errores/);
    expect(r.out).toContain(`registrar-cai --base "${base}" --cai CAI_DE_LA_RESOLUCION --tipo 01`);
    expect(r.out).toContain('--ultimo-emitido-antes');
    expect(r.out).toContain('registrar_cai');
    expect(r.out).not.toContain(LEYENDA_PRUEBA);
    expect(bloqueDe(r.out).mcpServers['factura-hn'].env.FHN_SQLITE).toBe(base);
  });

  it('--forzar reescribe la plantilla pero nunca borra la base real', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    await correr(['init'], { cwd: dir });
    const base = join(dir, 'factura.db');
    expect((await correr(['registrar-cai', '--base', base, ...resolucion])).codigo).toBe(0);
    writeFileSync(join(dir, 'emisor.json'), '{"rtn": "99990000000001"}');
    const r = await correr(['init', '--forzar'], { cwd: dir });
    expect(r.out).toMatch(/Se conserva la base .*--forzar nunca borra la base real/);
    // El emisor real se reescribe, pero antes queda una copia.
    expect(r.out).toContain(`Copia del emisor anterior en ${join(dir, 'emisor.json')}.bak.`);
    expect(readFileSync(join(dir, 'emisor.json.bak'), 'utf8')).toBe('{"rtn": "99990000000001"}');
    expect(autorizaciones(base)).toBe(1);
  });

  it('demo y real conviven en la misma carpeta, en archivos distintos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
    await correr(['init', '--demo'], { cwd: dir });
    await correr(['init'], { cwd: dir });
    expect(autorizaciones(join(dir, 'factura-demo.db'))).toBe(3);
    expect(autorizaciones(join(dir, 'factura.db'))).toBe(0);
  });
});

describe('registrar-cai', () => {
  const nueva = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-cai-'));
    await correr(['init'], { cwd: dir });
    return { dir, base: join(dir, 'factura.db') };
  };

  it('registra en la base SQLite (por --base, FHN_SQLITE o ./factura.db) con las validaciones del núcleo', async () => {
    const { dir, base } = await nueva();
    const r = await correr(['registrar-cai', ...resolucion], { cwd: dir });
    expect(r).toMatchObject({ codigo: 0, out: `CAI registrado en ${base}: A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4 · serie 000-001-01 · rango 1–5000 · fecha límite 2027-10-31` });
    const nc = ['--cai', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06', '--tipo', '06', '--establecimiento', '0', '--punto', '1', '--desde', '1', '--hasta', '100', '--fecha-limite', '2027-10-31'];
    expect((await correr(['registrar-cai', ...nc], { env: { FHN_SQLITE: base } })).codigo).toBe(0);
    expect(autorizaciones(base)).toBe(2);
    // El núcleo rechaza el mismo CAI otra vez, con qué hacer y el enlace a la guía.
    const otra = await correr(['registrar-cai', '--base', base, ...resolucion]);
    expect(otra.codigo).toBe(1);
    expect(otra.err).toContain('[AUTORIZACION_DUPLICADA]');
    expect(otra.err).toContain('Qué hacer: Ese CAI ya está registrado');
    expect(otra.err).toContain('Guía: https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#autorizacion_duplicada');
  });

  it('datos inválidos: los errores del núcleo, uno por campo', async () => {
    const { base } = await nueva();
    const r = await correr(['registrar-cai', '--base', base, '--cai', 'A1B2 C3', '--tipo', '01', '--establecimiento', '000', '--punto', '001', '--desde', '10', '--hasta', '5', '--fecha-limite', '31/10/2027']);
    expect(r.codigo).toBe(1);
    expect(r.err).toMatch(/^No se registró el CAI \(VALIDACION\):/);
    for (const c of ['CAI_FORMATO', 'RANGO', 'FECHA_LIMITE']) expect(r.err).toContain(`[${c}]`);
    expect(autorizaciones(base)).toBe(0);
  });

  it('advertencias del núcleo: vigencia de más de un año (Art. 62)', async () => {
    const { base } = await nueva();
    const r = await correr(['registrar-cai', '--base', base, ...resolucion, '--fecha-autorizacion', '2026-01-15']);
    expect(r.codigo).toBe(0);
    expect(r.out).toContain('[AVISO_VIGENCIA_MAYOR_1_ANIO]');
  });

  it('faltan datos: los nombra y pide copiarlos de la resolución', async () => {
    const r = await correr(['registrar-cai', '--cai', 'A1B2C3', '--tipo', '01']);
    expect(r.codigo).toBe(1);
    expect(r.err).toMatch(/^Faltan datos de la resolución del SAR: --establecimiento, --punto, --desde, --hasta, --fecha-limite\. Cópialos de la resolución; no los inventes\./);
    const { base } = await nueva();
    expect((await correr(['registrar-cai', '--base', base, ...resolucion.slice(0, 8), '--desde', 'uno', '--hasta', '5', '--fecha-limite', '2027-10-31'])).err).toMatch(/--desde debe ser un número entero/);
  });

  it('no crea una base nueva si la ruta no existe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-cai-'));
    const r = await correr(['registrar-cai', ...resolucion], { cwd: dir });
    expect(r).toMatchObject({ codigo: 1, err: expect.stringMatching(/No existe la base .*factura\.db\. Indica la de FHN_SQLITE con --base, o créala con/) });
    expect(existsSync(join(dir, 'factura.db'))).toBe(false);
  });

  it('--ultimo-emitido-antes: la serie sigue después de lo ya emitido; mal escrito, error de uso', async () => {
    const { base } = await nueva();
    const r = await correr(['registrar-cai', '--base', base, ...resolucion, '--ultimo-emitido-antes', '120']);
    expect(r.codigo).toBe(0);
    const db = new DatabaseSync(base);
    expect(JSON.parse((db.prepare('SELECT datos FROM fhn_autorizaciones').get() as { datos: string }).datos).ultimoEmitidoAntes).toBe(120);
    db.close();
    expect((await correr(['registrar-cai', '--base', base, ...resolucion, '--ultimo-emitido-antes', 'x'])).err).toMatch(/--ultimo-emitido-antes debe ser un número entero/);
    const { base: otra } = await nueva();
    expect((await correr(['registrar-cai', '--base', otra, ...resolucion, '--ultimo-emitido-antes', '9000'])).err).toContain('[ULTIMO_EMITIDO_ANTES]');
  });

  it('el CAI ficticio y la base de demostración no se mezclan con CAI reales', async () => {
    const { base } = await nueva();
    const demo = await correr(['registrar-cai', '--base', base, ...resolucion.slice(2), '--cai', 'DEMO00-NO-VALIDO-0000-0000-0000-01']);
    expect(demo).toMatchObject({ codigo: 1, err: expect.stringContaining('[CAI_DEMO]') });
    const dir = mkdtempSync(join(tmpdir(), 'fhn-cai-'));
    await correr(['init', '--demo'], { cwd: dir });
    const real = await correr(['registrar-cai', '--base', join(dir, 'factura-demo.db'), ...resolucion.slice(0, 8), '--desde', '5001', '--hasta', '6000', '--fecha-limite', '2027-10-31']);
    expect(real.codigo).toBe(1);
    expect(real.err).toContain('[BASE_DEMO]');
    expect(real.err).toContain('npx -y @factura-hn/mcp init');
    // En cualquier serie: otro punto de emisión de la base de prueba tampoco recibe CAI reales.
    const otroPunto = await correr(['registrar-cai', '--base', join(dir, 'factura-demo.db'), ...resolucion.slice(0, 6), '--punto', '002', ...resolucion.slice(8)]);
    expect(otroPunto.err).toContain('[BASE_DEMO]');
    expect(autorizaciones(join(dir, 'factura-demo.db'))).toBe(3);
  });

  it('modo API sin llave: lo dice', async () => {
    const r = await correr(['registrar-cai', ...resolucion], { env: { FHN_API_URL: 'http://127.0.0.1:9' } });
    expect(r).toMatchObject({ codigo: 1, err: expect.stringMatching(/Falta la llave de API/) });
  });

  it('modo API con la API apagada: API_INACCESIBLE, con qué hacer', async () => {
    const r = await correr(['registrar-cai', ...resolucion, '--api-url', 'http://127.0.0.1:9', '--llave', 'fhn_x']);
    expect(r.codigo).toBe(1);
    expect(r.err).toContain('[API_INACCESIBLE]');
    expect(r.err).toContain('FHN_API_URL');
  });
});

describe('ayuda y comandos desconocidos', () => {
  it('ayuda lista los comandos en español', async () => {
    for (const c of ['ayuda', '--help', '-h']) {
      const r = await correr([c]);
      expect(r.codigo).toBe(0);
      expect(r.out).toMatch(/init, iniciar[\s\S]*--demo[\s\S]*registrar-cai[\s\S]*FHN_SQLITE/);
    }
  });

  it('un comando desconocido da la ayuda y código 1; sin comando, arranca el servidor', async () => {
    expect(await correr(['emitir'])).toMatchObject({ codigo: 1, err: expect.stringMatching(/^Comando desconocido: emitir\./) });
    expect((await correr([])).codigo).toBe('servidor');
  });
});

it('la base de init --demo queda lista para el SDK, sin documentos, y el emisor dice que es ficticio', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fhn-init-'));
  await correr(['init', '--demo'], { cwd: dir });
  const db = new DatabaseSync(join(dir, 'factura-demo.db'));
  expect(await buscarDocumento(new AlmacenSQLite(db), '000-001-01-00000001')).toBeNull();
  db.close();
  expect(readFileSync(join(dir, 'emisor-demo.json'), 'utf8')).toContain(LEYENDA_PRUEBA);
});

describe('README y versión del paquete', () => {
  it('los bloques mcpServers del README del MCP y del sitio fijan la versión de package.json', () => {
    const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
    const { version } = JSON.parse(leer('../package.json')) as { version: string };
    for (const ruta of ['../README.md', '../../../web/src/content/docs/ia/mcp.md']) {
      const texto = leer(ruta);
      // Toda mención entre comillas (argumento de un bloque) lleva la versión, y es la del paquete. Tras
      // `pnpm run version` (scripts/fijar-versiones.mjs), cambia el número en todos.
      expect(texto, ruta).not.toContain('"@factura-hn/mcp"');
      const fijadas = [...texto.matchAll(/"@factura-hn\/mcp@([^"<]+)"/g)].map((m) => m[1]);
      expect(fijadas.length, ruta).toBeGreaterThan(0);
      expect(new Set(fijadas), ruta).toEqual(new Set([version]));
    }
  });
});
