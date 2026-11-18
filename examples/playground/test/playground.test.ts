import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { crearSesion, EJEMPLOS } from '../src/playground';

const reloj = () => new Date('2026-11-18T16:00:00Z');
const json = (k: string) => JSON.stringify(EJEMPLOS[k]!.entrada);

describe('playground (código fuente)', () => {
  it('cada ejemplo hace lo que promete: tres válidos, uno con errores y la NC sobre la última factura', async () => {
    const s = await crearSesion(reloj);
    for (const k of ['simple', 'rtn', 'descuento']) {
      const r = await s.emitir(json(k));
      expect(r.ok, k).toBe(true);
    }
    const malo = await s.emitir(json('invalida'));
    expect(malo.ok).toBe(false);
    if (!malo.ok) expect(malo.errores.map((e) => e.codigo)).toContain('EMISOR_RTN');
    const nc = await s.emitir(json('notaCredito'));
    expect(nc.ok).toBe(true);
    if (nc.ok) {
      expect(nc.documento.numero).toBe('000-001-06-00000001');
      expect(nc.documento.referencia?.numero).toBe('000-001-01-00000002');
      expect(nc.documento.cliente.rtn).toBe('08019005123456');
      expect(nc.html).toContain('FICTICIO');
    }
    expect((await s.estado()).map((e) => [e.serie, e.restantes])).toEqual([['000-001-01', 47], ['000-001-06', 49], ['000-001-07', 50]]);
  });

  it('JSON roto y anulación', async () => {
    const s = await crearSesion(reloj);
    expect(await s.emitir('{')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/^JSON inválido/) });
    await s.emitir(json('simple'));
    const a = await s.anular('000-001-01-00000001', 'Prueba');
    expect(a.ok && a.documento.estado).toBe('ANULADO');
    expect(s.emitidos()[0]!.estado).toBe('ANULADO');
    expect((await s.anular('000-001-01-00000001', 'otra vez')).ok).toBe(false);
  });
});

describe('playground (página)', () => {
  it('index.html está en el repositorio, carga el paquete y muestra el documento en un iframe sin permisos', () => {
    const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
    expect(html).toContain('<script src="playground.global.js"></script>');
    expect(html).toMatch(/<iframe id="vista" sandbox=""/);
    const ignorado = execFileSync('git', ['check-ignore', '--no-index', '-v', 'examples/playground/public/index.html'], {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8',
    }).trim();
    // La única regla que lo toca es la excepción `!…` (si lo ignorara, el clon no tendría página).
    expect(ignorado).toMatch(/:!examples\/playground\/public\/index\.html\t/);
  });
});

describe('playground (paquete para el navegador)', () => {
  it('el archivo compilado corre sin APIs de Node y emite', async () => {
    const raiz = fileURLToPath(new URL('..', import.meta.url));
    const tsup = createRequire(import.meta.url).resolve('tsup/dist/cli-default.js', { paths: [raiz, fileURLToPath(new URL('../../..', import.meta.url))] });
    execFileSync(process.execPath, [tsup], { cwd: raiz, stdio: 'pipe' });
    const codigo = readFileSync(new URL('../public/playground.global.js', import.meta.url), 'utf8');
    expect(codigo).not.toMatch(/require\(["']node:|from ["']node:/);
    // Solo lo que da un navegador moderno: sin process, require, Buffer ni módulos de Node.
    const contexto = vm.createContext({ console, structuredClone });
    vm.runInContext(codigo, contexto);
    const { crearSesion: crear, EJEMPLOS: ej } = (contexto as { Playground: typeof import('../src/playground') }).Playground;
    const s = await crear(() => new Date('2026-11-18T16:00:00Z'));
    const r = await s.emitir(JSON.stringify(ej.simple!.entrada));
    expect(r.ok && r.documento.numero).toBe('000-001-01-00000001');
    expect(r.ok && r.texto).toContain('DEMO00-NO-VALIDO');
  }, 60_000);
});
