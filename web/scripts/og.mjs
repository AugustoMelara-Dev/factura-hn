#!/usr/bin/env node
/**
 * Genera public/og.png (1200×630, la imagen para compartir el sitio) desde src/og/og.svg, con un Chrome o un Edge
 * ya instalado en el equipo, sin red: el SVG y sus fuentes (Figtree e IBM Plex Mono, de node_modules) se cargan como
 * archivos locales. No corre en la CI: el PNG se versiona y se vuelve a generar solo si cambia el SVG.
 *
 *   node web/scripts/og.mjs            (o FHN_NAVEGADOR=/ruta/al/chrome node web/scripts/og.mjs)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WEB } from '../sitio.config.mjs';

const CANDIDATOS = [
  process.env.FHN_NAVEGADOR,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const navegador = CANDIDATOS.find((c) => existsSync(c));
if (!navegador) {
  console.error('No encontré Chrome ni Edge: define FHN_NAVEGADOR con la ruta de uno.');
  process.exit(1);
}

const fuente = (ruta) => pathToFileURL(join(WEB, 'node_modules', ruta)).href;
const svg = readFileSync(join(WEB, 'src', 'og', 'og.svg'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Figtree; font-weight: 500; src: url(${fuente('@astryxdesign/theme-neutral/fonts/figtree-latin-500-normal.woff2')}); }
@font-face { font-family: Figtree; font-weight: 600; src: url(${fuente('@astryxdesign/theme-neutral/fonts/figtree-latin-600-normal.woff2')}); }
@font-face { font-family: 'IBM Plex Mono'; font-weight: 500; src: url(${fuente('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2')}); }
html, body { margin: 0; overflow: hidden; } svg { display: block; }
</style>${svg}`;

const carpeta = mkdtempSync(join(tmpdir(), 'fhn-og-'));
try {
  const pagina = join(carpeta, 'og.html');
  writeFileSync(pagina, html);
  const salida = join(WEB, 'public', 'og.png');
  const r = spawnSync(
    navegador,
    ['--headless', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${join(carpeta, 'perfil')}`, '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=2000', `--screenshot=${salida}`, pathToFileURL(pagina).href],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 || !existsSync(salida)) {
    console.error(`El navegador no generó la imagen:\n${r.stderr}`);
    process.exit(1);
  }
  console.log(`Imagen para compartir: ${salida}`);
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}
