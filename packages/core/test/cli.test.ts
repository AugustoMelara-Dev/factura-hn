/**
 * El bin `factura-hn`, ejecutado desde `dist` como lo haría `npx factura-hn`, en un directorio temporal. Si
 * `dist` no existe o es más viejo que algún archivo de `src` (o que `package.json`), se compila antes: la prueba
 * nunca corre contra un `dist` viejo.
 */
import { execSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEYENDA_PRUEBA } from '../src/modo';

const NUCLEO = join(__dirname, '..');
const paquete = JSON.parse(readFileSync(join(NUCLEO, 'package.json'), 'utf8')) as { version: string; bin: Record<string, string> };
const CLI = join(NUCLEO, paquete.bin['factura-hn']!);
let dir: string;

function correr(args: string[], cwd = dir) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 60_000 });
  return { codigo: r.status, salida: r.stdout, error: r.stderr };
}

/** Fecha de modificación más reciente de los archivos de `dir` (recursivo). */
function masReciente(dir: string): number {
  let max = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    max = Math.max(max, e.isDirectory() ? masReciente(ruta) : statSync(ruta).mtimeMs);
  }
  return max;
}

/** true si falta algún archivo de `dist` que usa la prueba, o si alguno es anterior a la fuente. */
function distViejo(): boolean {
  const salidas = [CLI, join(NUCLEO, 'dist', 'demo.js'), join(NUCLEO, 'dist', 'index.js')];
  if (!salidas.every((f) => existsSync(f))) return true;
  const fuente = Math.max(masReciente(join(NUCLEO, 'src')), statSync(join(NUCLEO, 'package.json')).mtimeMs);
  return Math.min(...salidas.map((f) => statSync(f).mtimeMs)) < fuente;
}

beforeAll(() => {
  if (distViejo()) execSync('pnpm run build', { cwd: NUCLEO, stdio: 'pipe' });
  expect(distViejo()).toBe(false);
  // realpath: en macOS tmpdir() es /var/folders/…, un enlace a /private/var/…, que es lo que imprime init.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'fhn-cli-')));
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('npx factura-hn', () => {
  it('el bin del paquete es dist/cli.js, con su línea #!', () => {
    expect(paquete.bin).toEqual({ 'factura-hn': './dist/cli.js' });
    expect(readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
  });

  it('demo: emite al instante, imprime el ticket con la leyenda, escribe factura-demo.html y da los siguientes pasos', () => {
    const r = correr(['demo']);
    expect(r.error).toBe('');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(LEYENDA_PRUEBA);
    expect(r.salida).toContain('N° 000-001-01-00000001');
    expect(r.salida).toContain('Siguientes pasos');
    expect(r.salida).toContain('npx factura-hn init');
    // El primer paso instala el SDK: emitir.mjs lo importa.
    expect(r.salida.indexOf('1. npm install factura-hn')).toBeGreaterThan(r.salida.indexOf('Siguientes pasos'));
    expect(r.salida.indexOf('1. npm install factura-hn')).toBeLessThan(r.salida.indexOf('npx factura-hn init'));
    const html = readFileSync(join(dir, 'factura-demo.html'), 'utf8');
    expect(html.split(`>${LEYENDA_PRUEBA}</div>`)).toHaveLength(3);
    // Otra vez: no sobrescribe, escribe factura-demo-2.html y lo dice.
    writeFileSync(join(dir, 'factura-demo.html'), 'mía');
    const otra = correr(['demo']);
    expect(otra.codigo).toBe(0);
    expect(otra.salida).toContain('factura-demo-2.html');
    expect(readFileSync(join(dir, 'factura-demo.html'), 'utf8')).toBe('mía');
    expect(readFileSync(join(dir, 'factura-demo-2.html'), 'utf8')).toContain(LEYENDA_PRUEBA);
  });

  it('init (y su alias iniciar): crea emitir.mjs y emisor.json sin sobrescribir; npm install → init → node emitir.mjs emite', () => {
    const proyecto = join(dir, 'proyecto');
    mkdirSync(join(proyecto, 'node_modules'), { recursive: true });
    // Lo que deja `npm install factura-hn`: el paquete en node_modules (aquí, un enlace al núcleo compilado).
    symlinkSync(NUCLEO, join(proyecto, 'node_modules', 'factura-hn'), 'junction');

    const r = correr(['init'], proyecto);
    expect(r.codigo).toBe(0);
    expect(r.error).toBe('');
    // Con factura-hn ya instalado: qué creó, el siguiente comando y la guía. Nada más.
    expect(r.salida.trim().split('\n')).toEqual([
      `Listo: creé emitir.mjs y emisor.json en ${proyecto} (modo de prueba, CAI ficticio).`,
      'Ahora corre: node emitir.mjs',
      expect.stringMatching(/^Para emitir de verdad, cambia emisor\.json .* Guía: https:\/\//),
    ]);
    const emisor = JSON.parse(readFileSync(join(proyecto, 'emisor.json'), 'utf8')) as { rtn: string; correo: string; _instrucciones: string };
    expect(emisor._instrucciones).toMatch(/FICTICIOS/);
    expect(emisor.rtn).toMatch(/^9999/);
    expect(emisor.correo).toMatch(/\.example$/);

    // Otra vez, sin cambios en los archivos: no estorban, termina bien.
    const repetido = correr(['init'], proyecto);
    expect(repetido.codigo).toBe(0);
    expect(repetido.salida).toContain(`Ya estaban emitir.mjs y emisor.json en ${proyecto} (sin cambios).`);
    expect(repetido.salida).not.toContain('Listo');
    expect(repetido.salida).toContain('Ahora corre: node emitir.mjs');

    // No sobrescribe un archivo con otro contenido: ni con init ni con iniciar, salvo con --forzar.
    writeFileSync(join(proyecto, 'emisor.json'), '{"mio":true}\n');
    const otra = correr(['iniciar'], proyecto);
    expect(otra.codigo).toBe(1);
    expect(otra.error).toContain(`Ya existe emisor.json en ${proyecto}, con otro contenido: no se tocó nada.`);
    expect(otra.error).toContain('--forzar reemplaza emitir.mjs y emisor.json con el ejemplo: npx factura-hn init --forzar');
    expect(otra.salida).toBe('');
    expect(readFileSync(join(proyecto, 'emisor.json'), 'utf8')).toBe('{"mio":true}\n');
    const forzado = correr(['iniciar', '--forzar'], proyecto);
    expect(forzado.codigo).toBe(0);
    expect(forzado.salida).toContain(`Listo: reemplacé emisor.json con el ejemplo en ${proyecto}; emitir.mjs ya estaba igual (modo de prueba, CAI ficticio).`);
    expect(readFileSync(join(proyecto, 'emisor.json'), 'utf8')).toContain('"rtn"');

    const emitir = spawnSync(process.execPath, ['emitir.mjs'], { cwd: proyecto, encoding: 'utf8', timeout: 60_000 });
    expect(emitir.stderr).toBe('');
    expect(emitir.status).toBe(0);
    expect(emitir.stdout).toContain(LEYENDA_PRUEBA);
    expect(emitir.stdout).toMatch(/Factura 000-001-01-00000001 por L 230\.00/);
    expect(emitir.stdout).not.toContain('_instrucciones');
    expect(readFileSync(join(proyecto, 'factura.html'), 'utf8')).toContain(LEYENDA_PRUEBA);
    // Otra vez: factura.html no se sobrescribe; la nueva va a factura-2.html.
    writeFileSync(join(proyecto, 'factura.html'), 'mía');
    const segunda = spawnSync(process.execPath, ['emitir.mjs'], { cwd: proyecto, encoding: 'utf8', timeout: 60_000 });
    expect(segunda.status).toBe(0);
    expect(segunda.stdout).toContain('abre factura-2.html');
    expect(readFileSync(join(proyecto, 'factura.html'), 'utf8')).toBe('mía');
    expect(readFileSync(join(proyecto, 'factura-2.html'), 'utf8')).toContain(LEYENDA_PRUEBA);
    // El almacén es en memoria: la segunda corrida repite el número, y lo dice.
    expect(segunda.stdout).toMatch(/Factura 000-001-01-00000001 por L 230\.00/);
    expect(segunda.stdout).toContain('cada vez que corres este archivo la numeración empieza otra vez en 00000001');
    // Un emisor.json que no es JSON: mensaje en español que lo nombra y dice cómo arreglarlo, sin la pila.
    writeFileSync(join(proyecto, 'emisor.json'), '{"rtn": "99990000000001",}\n');
    const roto = spawnSync(process.execPath, ['emitir.mjs'], { cwd: proyecto, encoding: 'utf8', timeout: 60_000 });
    expect(roto.status).toBe(1);
    expect(roto.stderr).toMatch(/^emisor\.json no es JSON válido \(.+\)\. Revisa las comillas dobles, las comas/);
    expect(roto.stderr).toContain('npx factura-hn init --forzar');
    expect(roto.stderr).not.toContain('SyntaxError');
  });

  it('init en una carpeta vacía, sin factura-hn instalado: no pregunta nada y dice la línea exacta para instalarlo', () => {
    const p = join(dir, 'vacia');
    mkdirSync(p);
    const r = correr(['init'], p);
    expect(r.codigo).toBe(0);
    expect(r.error).toBe('');
    expect(r.salida.trim().split('\n')).toEqual([
      `Listo: creé emitir.mjs y emisor.json en ${p} (modo de prueba, CAI ficticio).`,
      'Ahora corre: npm install factura-hn',
      'Y después:   node emitir.mjs',
    ]);
    expect(readdirSync(p).sort()).toEqual(['emisor.json', 'emitir.mjs']);
  });

  it('init usa el gestor de paquetes del proyecto (pnpm, yarn o bun) en la línea de instalación', () => {
    const casos = [
      ['pnpm-lock.yaml', 'pnpm add factura-hn'],
      ['yarn.lock', 'yarn add factura-hn'],
      ['bun.lock', 'bun add factura-hn'],
      ['package-lock.json', 'npm install factura-hn'],
    ] as const;
    for (const [bloqueo, comando] of casos) {
      const p = join(dir, `gestor-${bloqueo}`);
      mkdirSync(join(p, 'app'), { recursive: true });
      // El archivo de bloqueo en la raíz de un monorepo: init corre en un paquete de adentro.
      writeFileSync(join(p, bloqueo), '');
      const r = correr(['init'], join(p, 'app'));
      expect(r.codigo, bloqueo).toBe(0);
      expect(r.salida, bloqueo).toContain(`Ahora corre: ${comando}\n`);
    }
  });

  it('init en un proyecto "type": "commonjs" con factura-hn instalado: node emitir.mjs emite a la primera', () => {
    const p = join(dir, 'commonjs');
    mkdirSync(join(p, 'node_modules'), { recursive: true });
    const paqueteProyecto = { name: 'tienda', version: '1.0.0', type: 'commonjs' };
    writeFileSync(join(p, 'package.json'), JSON.stringify(paqueteProyecto));
    symlinkSync(NUCLEO, join(p, 'node_modules', 'factura-hn'), 'junction');
    const r = correr(['init'], p);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Ahora corre: node emitir.mjs');
    const emitir = spawnSync(process.execPath, ['emitir.mjs'], { cwd: p, encoding: 'utf8', timeout: 60_000 });
    expect(emitir.stderr).toBe('');
    expect(emitir.status).toBe(0);
    expect(emitir.stdout).toMatch(/Factura 000-001-01-00000001 por L 230\.00/);
    // package.json no se toca.
    expect(JSON.parse(readFileSync(join(p, 'package.json'), 'utf8'))).toEqual(paqueteProyecto);
  });

  it('en un Node anterior al mínimo, la CLI lo dice en español y no escribe nada', () => {
    const p = join(dir, 'node-viejo');
    mkdirSync(p);
    // Simula Node 18: reemplaza process.versions antes de cargar la CLI.
    const viejo = "data:text/javascript,Object.defineProperty(process,'versions',{value:{...process.versions,node:'18.19.0'}})";
    const r = spawnSync(process.execPath, ['--import', viejo, CLI, 'init'], { cwd: p, encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('factura-hn necesita Node 20 o más reciente, y tienes 18.19.0. Instala la versión LTS de https://nodejs.org');
    expect(readdirSync(p)).toEqual([]);
  });

  it('init dice «Ya existe» en singular con un solo archivo', () => {
    const p = join(dir, 'singular');
    mkdirSync(p);
    writeFileSync(join(p, 'emitir.mjs'), '// mío\n');
    const r = correr(['init'], p);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('Ya existe emitir.mjs en');
    expect(r.error).toContain('--forzar reemplaza emitir.mjs y emisor.json con el ejemplo');
    expect(existsSync(join(p, 'emisor.json'))).toBe(false);
    // Uno igual al ejemplo y el otro falta: crea solo el que falta y lo dice.
    rmSync(join(p, 'emitir.mjs'));
    expect(correr(['init'], p).codigo).toBe(0);
    rmSync(join(p, 'emisor.json'));
    const parcial = correr(['init'], p);
    expect(parcial.codigo).toBe(0);
    expect(parcial.salida).toContain(`Listo: creé emisor.json en ${p}; emitir.mjs ya estaba igual (modo de prueba, CAI ficticio).`);
  });

  it('una opción desconocida (o una errata) da error y código 1, sin escribir nada', () => {
    const p = join(dir, 'opciones');
    mkdirSync(p);
    const force = correr(['init', '--force'], p);
    expect(force.codigo).toBe(1);
    expect(force.error).toContain('Opción desconocida para init: «--force». ¿Quisiste decir --forzar?');
    expect(readdirSync(p)).toEqual([]);
    for (const args of [['demo', '--forzar'], ['init', '--frozar'], ['version', '-x']]) {
      const r = correr(args, p);
      expect(r.codigo, args.join(' ')).toBe(1);
      expect(r.error, args.join(' ')).toContain('Opción desconocida');
    }
    expect(readdirSync(p)).toEqual([]);
  });

  it('ayuda y versión', () => {
    for (const a of ['ayuda', '--help', '-h']) {
      const r = correr([a]);
      expect(r.codigo, a).toBe(0);
      expect(r.salida).toContain('Uso: npx factura-hn <comando>');
    }
    expect(correr([]).salida).toContain('Comandos:');
    for (const a of ['version', '--version']) expect(correr([a]).salida.trim()).toBe(paquete.version);
  });

  it('un comando desconocido da un error claro y código 1', () => {
    const r = correr(['facturar']);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('Comando desconocido: «facturar»');
    expect(r.error).toContain('demo, init (o iniciar), ayuda y version');
  });
});

describe('hallazgos de la auditoría de la CLI', () => {
  /** Un proyecto con factura-hn instalado (enlace al núcleo compilado) y lo que crea init. */
  function proyectoConInit(nombre: string) {
    const p = join(dir, nombre);
    mkdirSync(join(p, 'node_modules'), { recursive: true });
    symlinkSync(NUCLEO, join(p, 'node_modules', 'factura-hn'), 'junction');
    expect(correr(['init'], p).codigo).toBe(0);
    return p;
  }
  const emitir = (p: string) => spawnSync(process.execPath, ['emitir.mjs'], { cwd: p, encoding: 'utf8', timeout: 60_000 });

  it('CLI-1: emitir.mjs con emisor.json incompleto o ausente: mensaje en español y código 1, sin la pila', () => {
    const p = proyectoConInit('emisor-incompleto');
    writeFileSync(join(p, 'emisor.json'), '{"rtn": "1"}\n');
    const incompleto = emitir(p);
    expect(incompleto.status).toBe(1);
    expect(incompleto.stderr).toMatch(/^No se emitió: /);
    expect(incompleto.stderr).toMatch(/rtn/i);
    expect(incompleto.stderr).toContain('npx factura-hn init --forzar');
    rmSync(join(p, 'emisor.json'));
    const ausente = emitir(p);
    expect(ausente.status).toBe(1);
    expect(ausente.stderr.trim()).toBe('No está emisor.json en esta carpeta: créalo con npx factura-hn init (y cambia sus datos por los de tu negocio).');
    for (const r of [incompleto, ausente]) {
      expect(r.stderr).not.toMatch(/^\s+at /m);
      expect(r.stderr).not.toContain('node_modules');
      expect(r.stderr).not.toContain('ENOENT');
    }
    expect(existsSync(join(p, 'factura.html'))).toBe(false);
  });

  // Como root (contenedores de CI) el modo 444 no impide escribir: la prueba no aplica.
  it.skipIf(process.getuid?.() === 0)('CLI-2: init --forzar con un archivo de solo lectura no reemplaza ninguno', () => {
    const p = join(dir, 'solo-lectura');
    mkdirSync(p);
    writeFileSync(join(p, 'emitir.mjs'), '// mío\n');
    writeFileSync(join(p, 'emisor.json'), '{"mio": true}\n');
    chmodSync(join(p, 'emisor.json'), 0o444);
    try {
      const r = correr(['init', '--forzar'], p);
      expect(r.codigo).toBe(1);
      expect(r.error).toContain(`No se pudo escribir ${join(p, 'emisor.json')}: no hay permiso`);
      expect(r.error).toContain('No se cambió ningún archivo.');
      expect(readFileSync(join(p, 'emitir.mjs'), 'utf8')).toBe('// mío\n');
      expect(readFileSync(join(p, 'emisor.json'), 'utf8')).toBe('{"mio": true}\n');
    } finally {
      chmodSync(join(p, 'emisor.json'), 0o644);
    }
  });

  it('CLI-3: ayuda por comando y --ayuda, con código 0 y sin escribir nada', () => {
    const p = join(dir, 'ayuda-comando');
    mkdirSync(p);
    for (const args of [['init', '--help'], ['iniciar', '-h'], ['init', '--ayuda'], ['ayuda', 'init'], ['init', '--forzar', '--help']]) {
      const r = correr(args, p);
      expect(r.codigo, args.join(' ')).toBe(0);
      expect(r.salida, args.join(' ')).toContain('Uso: npx factura-hn init [--forzar]');
    }
    for (const args of [['demo', '--help'], ['--help', 'demo']]) {
      const r = correr(args, p);
      expect(r.codigo, args.join(' ')).toBe(0);
      expect(r.salida).toContain('Uso: npx factura-hn demo');
    }
    const general = correr(['--ayuda'], p);
    expect(general.codigo).toBe(0);
    expect(general.salida).toContain('Uso: npx factura-hn <comando>');
    expect(readdirSync(p)).toEqual([]);
    expect(correr(['ayuda', 'facturar'], p).codigo).toBe(1);
  });
});
