// generar.mjs no deja nada a medias: si falta el playground compilado, sale antes de escribir una sola página
// (antes escribía las páginas, se cortaba sin manifiesto y la siguiente corrida las tomaba por escritas a mano).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const GENERAR = fileURLToPath(new URL('./generar.mjs', import.meta.url));

test('sin el playground compilado, generar.mjs falla sin escribir páginas ni manifiesto', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'fhn-generar-'));
  try {
    const docs = join(raiz, 'web', 'src', 'content', 'docs');
    mkdirSync(docs, { recursive: true });
    const r = spawnSync(process.execPath, [GENERAR], { env: { ...process.env, FHN_RAIZ: raiz }, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Falta el playground compilado/);
    assert.deepEqual(readdirSync(docs), []);
    assert.equal(existsSync(join(raiz, 'web', '.generado.json')), false);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
