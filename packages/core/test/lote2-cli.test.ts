/**
 * El bin `factura-hn`, ejecutado desde `dist` como lo haría `npx factura-hn`, en un directorio temporal. Si
 * `dist` no existe, se compila una vez (en la CI ya está compilado).
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

beforeAll(() => {
  if (!existsSync(CLI) || !existsSync(join(NUCLEO, 'dist', 'demo.js'))) execSync('pnpm run build', { cwd: NUCLEO, stdio: 'pipe' });
  dir = mkdtempSync(join(tmpdir(), 'fhn-cli-'));
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
    const html = readFileSync(join(dir, 'factura-demo.html'), 'utf8');
    expect(html.split(`>${LEYENDA_PRUEBA}</div>`)).toHaveLength(3);
  });

  it('init (y su alias iniciar): crea emitir.mjs y emisor.json sin sobrescribir; npm install → init → node emitir.mjs emite', () => {
    const proyecto = join(dir, 'proyecto');
    mkdirSync(join(proyecto, 'node_modules'), { recursive: true });
    // Lo que deja `npm install factura-hn`: el paquete en node_modules (aquí, un enlace al núcleo compilado).
    symlinkSync(NUCLEO, join(proyecto, 'node_modules', 'factura-hn'), 'junction');

    const r = correr(['init'], proyecto);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('node emitir.mjs');
    const emisor = JSON.parse(readFileSync(join(proyecto, 'emisor.json'), 'utf8')) as { rtn: string; correo: string; _instrucciones: string };
    expect(emisor._instrucciones).toMatch(/FICTICIOS/);
    expect(emisor.rtn).toMatch(/^9999/);
    expect(emisor.correo).toMatch(/\.example$/);

    // No sobrescribe: ni con init ni con iniciar, salvo con --forzar.
    writeFileSync(join(proyecto, 'emisor.json'), '{"mio":true}\n');
    const otra = correr(['iniciar'], proyecto);
    expect(otra.codigo).toBe(1);
    expect(otra.error).toContain('--forzar');
    expect(readFileSync(join(proyecto, 'emisor.json'), 'utf8')).toBe('{"mio":true}\n');
    expect(correr(['iniciar', '--forzar'], proyecto).codigo).toBe(0);
    expect(readFileSync(join(proyecto, 'emisor.json'), 'utf8')).toContain('"rtn"');

    const emitir = spawnSync(process.execPath, ['emitir.mjs'], { cwd: proyecto, encoding: 'utf8', timeout: 60_000 });
    expect(emitir.stderr).toBe('');
    expect(emitir.status).toBe(0);
    expect(emitir.stdout).toContain(LEYENDA_PRUEBA);
    expect(emitir.stdout).toMatch(/Factura 000-001-01-00000001 por L 230\.00/);
    expect(emitir.stdout).not.toContain('_instrucciones');
    expect(readFileSync(join(proyecto, 'factura.html'), 'utf8')).toContain(LEYENDA_PRUEBA);
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
