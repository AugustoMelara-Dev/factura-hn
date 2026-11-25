#!/usr/bin/env node
/**
 * Falla si un archivo versionado del repositorio contiene un término del proceso interno de desarrollo
 * (scripts/terminos-internos.mjs). Con `--sitio`, revisa también el sitio construido en `sitio/`, que no se
 * versiona pero es lo que se publica en GitHub Pages.
 *
 *   node scripts/verificar-terminos.mjs [--sitio]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarTerminos } from './terminos-internos.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));

// Solo lo que necesita contener los términos: la lista de patrones y sus pruebas.
const EXCLUIDOS = new Set(['scripts/terminos-internos.mjs', 'scripts/terminos-internos.test.mjs']);
// Binarios: no hay texto que revisar.
const BINARIO = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|tgz|db|sqlite)$/i;

const versionados = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);
const archivos = versionados.filter((f) => !EXCLUIDOS.has(f) && !BINARIO.test(f) && existsSync(join(raiz, f)));

function recorrer(dir) {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? recorrer(r) : [r];
  });
}
if (process.argv.includes('--sitio')) {
  const sitio = join(raiz, 'sitio');
  if (!existsSync(sitio)) {
    console.error('No existe sitio/: corre `pnpm sitio` antes de `verificar-terminos.mjs --sitio`.');
    process.exit(1);
  }
  archivos.push(...recorrer(sitio).map((r) => relative(raiz, r).replaceAll('\\', '/')).filter((f) => !BINARIO.test(f)));
}

let fallas = 0;
for (const f of archivos) {
  for (const h of buscarTerminos(readFileSync(join(raiz, f), 'utf8'))) {
    console.error(`${f}:${h.linea}: ${h.nombre} («${h.texto}»)`);
    fallas++;
  }
}
if (fallas) {
  console.error(`\n${fallas} término(s) internos. Explica la regla con su artículo o en palabras simples, sin códigos internos.`);
  process.exit(1);
}
console.log(`ok  sin términos internos en ${archivos.length} archivos`);
