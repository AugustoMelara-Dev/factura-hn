#!/usr/bin/env node
/**
 * Verificación del sitio construido (`sitio/`), sobre el HTML final y con la base de GitHub Pages en cuenta:
 *
 * 1. Cada enlace interno (href y src) lleva la base y llega a un archivo que existe, y su ancla, si tiene, a un id
 *    de esa página. Los enlaces a GitHub (`blob/main/…`, `tree/main/…`) apuntan a archivos del repositorio.
 * 2. Ningún enlace interno termina en `.md` salvo las versiones para IA que existen: un `../docs/api.md` sin
 *    reescribir es un error.
 * 3. Cada página tiene su `.md`, y existen `llms.txt` y `llms-full.txt`.
 * 4. El buscador (el índice de Pagefind generado, consultado con su propia API) encuentra «CAI», «nota de
 *    crédito» y «rango».
 * 5. Los comandos de la portada son los del README (la portada no puede desincronizarse de los pasos probados).
 *
 * Sale con 1 y la lista de problemas si algo falla.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASE, DOCS, RAIZ, REPO, SALIDA } from '../sitio.config.mjs';

/**
 * Páginas que escriben las ramas de contenido y que las páginas de esta rama ya enlazan. Mientras no existan, un
 * enlace a ellas es un aviso y no un error. Cuando todas las ramas estén integradas, esta lista queda vacía.
 */
const PENDIENTES = new Set(['/empezar/primera-factura/', '/produccion/']);
/**
 * Con FHN_SITIO_ENLACES_PENDIENTES=aviso, un enlace a una página del sitio que no existe es un aviso. Sirve a una
 * rama de contenido que enlaza páginas de otra rama aún sin integrar; la CI no lo usa.
 */
const TODO_PENDIENTE = process.env.FHN_SITIO_ENLACES_PENDIENTES === 'aviso';

const errores = [];
const avisos = [];
const desescapar = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const archivos = readdirSync(SALIDA, { recursive: true })
  .map((f) => String(f).replaceAll('\\', '/'))
  .filter((f) => !f.startsWith('pagefind/') && !f.startsWith('_astro/'));
const html = archivos.filter((f) => f.endsWith('.html'));

// --- 1 y 2. Enlaces y anclas ----------------------------------------------------------------------------
const idsDe = new Map();
const ids = (archivo) => {
  if (!idsDe.has(archivo)) idsDe.set(archivo, new Set([...readFileSync(archivo, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => desescapar(m[1]))));
  return idsDe.get(archivo);
};
/** Ruta interna (sin la base) → archivo de `sitio/`, o null. */
const archivoDe = (ruta) => {
  const candidatos = ruta.endsWith('/') ? [join(SALIDA, ruta, 'index.html')] : [join(SALIDA, ruta), join(SALIDA, ruta, 'index.html')];
  return candidatos.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
};

for (const pagina of html) {
  const archivo = join(SALIDA, pagina);
  const contenido = readFileSync(archivo, 'utf8');
  // URL de la página dentro del sitio, para resolver los enlaces relativos.
  const urlPagina = `${BASE}/${pagina.replace(/index\.html$/, '')}`;
  const vistos = new Set();
  for (const [, crudo] of contenido.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const url = desescapar(crudo);
    if (vistos.has(url)) continue;
    vistos.add(url);
    const github = url.startsWith(`${REPO}/`) && /\/(blob|tree)\/main\/([^#?]+)/.exec(url);
    if (github && !existsSync(join(RAIZ, decodeURIComponent(github[2])))) errores.push(`${pagina}: no existe en el repositorio ${github[2]} (${url})`);
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url) || url === '') continue;

    const [sinAncla, ancla] = url.split('#');
    let ruta = sinAncla.split('?')[0];
    if (!ruta) ruta = urlPagina;
    else if (!ruta.startsWith('/')) ruta = posix.normalize(posix.join(urlPagina, ruta)) + (ruta.endsWith('/') ? '/' : '');
    if (BASE && ruta !== BASE && !ruta.startsWith(`${BASE}/`)) {
      errores.push(`${pagina}: enlace interno sin la base ${BASE}: ${url}`);
      continue;
    }
    const enSitio = ruta.slice(BASE.length) || '/';
    const destino = archivoDe(enSitio);
    if (!destino) {
      if (/\.md$/i.test(enSitio)) errores.push(`${pagina}: enlace a un .md sin reescribir: ${url}`);
      else if (PENDIENTES.has(enSitio) || (TODO_PENDIENTE && enSitio.endsWith('/'))) avisos.push(`${pagina}: enlaza ${enSitio}, que escribe otra rama y aún no existe`);
      else errores.push(`${pagina}: no existe ${url}`);
      continue;
    }
    if (ancla && destino.endsWith('.html') && !ids(destino).has(decodeURIComponent(ancla))) errores.push(`${pagina}: no existe el ancla ${url}`);
  }
}

// --- 3. Recursos para IA ----------------------------------------------------------------------------------
for (const f of ['llms.txt', 'llms-full.txt']) if (!existsSync(join(SALIDA, f))) errores.push(`falta ${f}`);
for (const f of readdirSync(DOCS, { recursive: true }).map((x) => String(x).replaceAll('\\', '/'))) {
  if (!/\.mdx?$/.test(f) || f.split('/').some((p) => p.startsWith('_')) || f.endsWith('/muestra.md') || f === '404.md') continue;
  const md = `${f.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '') || 'index'}.md`;
  if (!existsSync(join(SALIDA, md))) errores.push(`falta la versión para IA ${md} de ${f}`);
}

// --- 4. Buscador --------------------------------------------------------------------------------------------
const TIPOS = { '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.html': 'text/html' };
const servidor = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const archivo = ruta.startsWith(`${BASE}/`) && join(SALIDA, ruta.slice(BASE.length));
  if (!archivo || !existsSync(archivo) || !statSync(archivo).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' }).end(readFileSync(archivo));
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
try {
  const pagefind = await import(pathToFileURL(join(SALIDA, 'pagefind', 'pagefind.js')).href);
  await pagefind.options({ basePath: `http://127.0.0.1:${servidor.address().port}${BASE}/pagefind/` });
  await pagefind.init();
  for (const termino of ['CAI', 'nota de crédito', 'rango']) {
    const { results } = await pagefind.search(termino);
    if (!results.length) {
      errores.push(`el buscador no encuentra «${termino}»`);
      continue;
    }
    const primeros = await Promise.all(results.slice(0, 3).map((r) => r.data()));
    console.log(`Buscador: «${termino}» → ${results.length} páginas; primeras: ${primeros.map((d) => d.url).join(', ')}`);
  }
} finally {
  servidor.close();
}

// --- 5. Portada y README ------------------------------------------------------------------------------------
const readme = readFileSync(join(RAIZ, 'README.md'), 'utf8');
const portada = readFileSync(join(DOCS, 'index.mdx'), 'utf8');
for (const [, bloque] of portada.matchAll(/```bash\n([\s\S]*?)```/g)) {
  for (const linea of bloque.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (!readme.includes(linea)) errores.push(`index.mdx: el comando «${linea}» no está en el README (la portada debe usar los pasos probados)`);
  }
}

for (const a of avisos) console.warn(`Aviso: ${a}`);
if (errores.length) {
  console.error(`Problemas en el sitio construido:\n  ${errores.join('\n  ')}`);
  process.exit(1);
}
console.log(`Sitio verificado: ${html.length} páginas HTML, enlaces internos y anclas, recursos para IA, buscador y portada.`);
