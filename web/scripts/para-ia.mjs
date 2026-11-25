#!/usr/bin/env node
/**
 * Recursos para agentes de IA, después de `astro build` (https://llmstxt.org):
 *
 * - `/<ruta>.md`: el Markdown de cada página (`/referencia/sdk/` → `/referencia/sdk.md`; la portada, `/index.md`),
 *   con los enlaces del sitio como URL completas para que sirvan fuera del sitio. Las páginas de la documentación
 *   salen de su fuente en `src/content/docs/`; las del producto (portada, Pruébalo, precios…), de `src/md/`.
 * - `/llms.txt`: el llms.txt del repositorio (el que prueba readme.test.ts) con sus enlaces llevados al sitio, más
 *   la lista de páginas con su versión .md.
 * - `/llms-full.txt`: todas las páginas en un solo archivo, en el orden del menú.
 *
 * El título y la descripción se leen del HTML ya construido, así que coinciden con lo que ve el visitante.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BASE, BLOQUES, DOCS, PAGINAS_PRODUCTO, RAIZ, SALIDA, SITIO_URL, WEB } from '../sitio.config.mjs';
import { reescribirEnlaces, resolverEnlace } from './lib/enlaces-md.mjs';
import { mapaDeEnlaces } from './lib/paginas.mjs';

const URL_SITIO = `${SITIO_URL}${BASE}`;
const absoluta = (href) => (href.startsWith('/') && !href.startsWith('//') ? `${URL_SITIO}${href}` : href);
const desescapar = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Título y descripción de una página, del HTML construido (lo mismo que ve el visitante). */
function delHtml(ruta) {
  const html = readFileSync(join(SALIDA, ruta, 'index.html'), 'utf8');
  return {
    titulo: desescapar(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ruta).replace(/ \| factura-hn$/, ''),
    descripcion: desescapar(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? ''),
  };
}

/** Páginas del sitio en el orden del menú: [{ archivo, ruta, md, titulo, descripcion, cuerpo }]. */
export function paginasDelSitio() {
  const archivos = readdirSync(DOCS, { recursive: true })
    .map((f) => String(f).replaceAll('\\', '/'))
    .filter((f) => /\.mdx?$/.test(f) && !f.split('/').some((p) => p.startsWith('_')) && !f.endsWith('/muestra.md') && f !== '404.md');
  const paginas = archivos.map((archivo) => {
    const ruta = archivo.replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
    const texto = readFileSync(join(DOCS, archivo), 'utf8').replace(/\r\n/g, '\n');
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(texto);
    const { titulo, descripcion } = delHtml(ruta);
    let cuerpo = fm ? texto.slice(fm[0].length) : texto;
    if (archivo.endsWith('.mdx')) {
      // MDX: fuera los import/export y las etiquetas de componentes (su contenido de Markdown se queda).
      cuerpo = cuerpo
        .replace(/^(import|export) .*$/gm, '')
        .replace(/^[ \t]*<\/?[A-Z][\w.]*(\s[^>]*)?\/?>[ \t]*$/gm, '')
        .replace(/\n{3,}/g, '\n\n');
    }
    cuerpo = cuerpo.replace(/<!-- Generado por [^\n]*-->\n+/, '').trim();
    const bloque = BLOQUES.findIndex((b) => ruta === b.dir || ruta.startsWith(`${b.dir}/`));
    const orden = Number(/order:\s*(\d+)/.exec(fm?.[1] ?? '')?.[1] ?? (ruta.endsWith('/') || !ruta.includes('/') ? 0 : 100));
    return { archivo, ruta, md: `${ruta || 'index'}.md`, titulo, descripcion, cuerpo, clave: [bloque, ruta === BLOQUES[bloque]?.dir ? -1 : orden, titulo] };
  });
  // Páginas del producto: antes que la documentación, en el orden de PAGINAS_PRODUCTO.
  PAGINAS_PRODUCTO.forEach(({ ruta, md }, i) => {
    const { titulo, descripcion } = delHtml(ruta);
    const cuerpo = readFileSync(join(WEB, 'src', 'md', md), 'utf8').replace(/\r\n/g, '\n').trim();
    paginas.push({ archivo: `src/md/${md}`, ruta, md: `${ruta || 'index'}.md`, titulo, descripcion, cuerpo, producto: true, clave: [-1, i, titulo] });
  });
  return paginas.sort((a, b) => a.clave[0] - b.clave[0] || a.clave[1] - b.clave[1] || a.clave[2].localeCompare(b.clave[2], 'es'));
}

function escribir(relativo, contenido) {
  const destino = join(SALIDA, relativo);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, contenido);
}

if (!existsSync(join(SALIDA, 'index.html'))) {
  console.error('Falta el sitio construido: corre antes `astro build` (o `pnpm sitio`).');
  process.exit(1);
}

const paginas = paginasDelSitio();
const enMarkdown = (p) => `# ${p.titulo}\n\n> ${p.descripcion}\n\nURL: ${URL_SITIO}/${p.ruta ? `${p.ruta}/` : ''}\n\n${reescribirEnlaces(p.cuerpo, absoluta)}\n`;

for (const p of paginas) escribir(p.md, enMarkdown(p));

// llms.txt: el del repositorio, con sus enlaces relativos llevados al sitio o a GitHub, y la lista de páginas.
const mapa = mapaDeEnlaces();
const llms = reescribirEnlaces(readFileSync(join(RAIZ, 'llms.txt'), 'utf8').replace(/\r\n/g, '\n'), (href) => absoluta(resolverEnlace(href, 'llms.txt', mapa))).trimEnd();
const porBloque = [
  { label: 'Producto', paginas: paginas.filter((p) => p.producto && p.ruta !== '') },
  ...BLOQUES.map((b) => ({ ...b, paginas: paginas.filter((p) => !p.producto && (p.ruta === b.dir || p.ruta.startsWith(`${b.dir}/`))) })),
].filter((b) => b.paginas.length);
const portada = paginas.find((p) => p.ruta === '');
const lista = [portada && `- [${portada.titulo}](${URL_SITIO}/${portada.md}): ${portada.descripcion}`]
  .concat(porBloque.map((b) => `### ${b.label}\n\n${b.paginas.map((p) => `- [${p.titulo}](${URL_SITIO}/${p.md}): ${p.descripcion}`).join('\n')}`)
  )
  .filter(Boolean)
  .join('\n\n');
escribir(
  'llms.txt',
  `${llms}\n\n## Sitio de documentación\n\nCada página del sitio (${URL_SITIO}/) tiene su versión en Markdown: la misma URL terminada en \`.md\`. Todo junto: ${URL_SITIO}/llms-full.txt\n\n${lista}\n`,
);

// llms-full.txt: todas las páginas, en el orden del menú.
escribir(
  'llms-full.txt',
  `# factura-hn: documentación completa\n\n> Todas las páginas de ${URL_SITIO}/ en un solo archivo, en el orden del menú. Proyecto independiente, no afiliado al SAR.\n\n${paginas.map(enMarkdown).join('\n---\n\n')}`,
);

console.log(`Para IA: ${paginas.length} páginas en .md, llms.txt y llms-full.txt.`);
