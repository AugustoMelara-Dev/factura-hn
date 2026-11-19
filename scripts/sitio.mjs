#!/usr/bin/env node
/**
 * Sitio de documentación estático para GitHub Pages, en `sitio/`.
 *
 * Las páginas salen de los mismos Markdown del repositorio (una sola fuente), la referencia de la API se genera
 * de `packages/api/openapi.json` y el playground se copia de `examples/playground/public` (construirlo antes:
 * `pnpm sitio` lo hace). Los enlaces a otros Markdown del repositorio apuntan a su página si la tienen, o al
 * archivo en GitHub. Al final se verifica que todo enlace interno (archivo y ancla) exista: si no, falla.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SALIDA = join(RAIZ, 'sitio');
const REPO = 'https://github.com/AugustoMelara-Dev/factura-hn';
const leer = (r) => readFileSync(join(RAIZ, r), 'utf8');

/** Páginas: archivo de salida, título en el menú y fuente (ruta del repositorio). */
const PAGINAS = [
  { html: 'index.html', menu: 'Inicio', fuente: 'sitio-fuente/inicio.md' },
  { html: 'guia-sdk.html', menu: 'SDK', fuente: 'docs/guia-sdk.md' },
  { html: 'api.html', menu: 'API', fuente: 'docs/api.md', extra: referenciaApi },
  { html: 'autoalojamiento.html', menu: 'Autoalojamiento', fuente: 'docs/autoalojamiento.md' },
  { html: 'playground.html', menu: 'Playground', fuente: 'sitio-fuente/playground.md' },
  { html: 'cumplimiento.html', menu: 'Cumplimiento', fuente: 'docs/investigacion.md', recorte: (t) => t.slice(0, t.indexOf('\n## 2. ')) },
  { html: 'consulta-sar.html', menu: 'Consulta al SAR', fuente: 'docs/consulta-sar.md' },
];
const PAGINA_DE = new Map(PAGINAS.map((p) => [p.fuente, p.html]));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (texto) =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Enlace de Markdown del repositorio → enlace del sitio. */
function resolverEnlace(href, fuente) {
  if (/^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const [ruta, ancla] = href.split('#');
  if (!ruta) return href;
  const enRepo = posix.normalize(posix.join(posix.dirname(fuente), ruta));
  const pagina = PAGINA_DE.get(enRepo);
  if (pagina) return pagina + (ancla ? `#${ancla}` : '');
  const tipo = existsSync(join(RAIZ, enRepo)) && !/\.[a-z0-9]+$/i.test(enRepo) ? 'tree' : 'blob';
  return `${REPO}/${tipo}/main/${enRepo}${ancla ? `#${ancla}` : ''}`;
}

function convertir(markdown, fuente) {
  const ids = new Map();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        let id = slug(html);
        const n = ids.get(id) ?? 0;
        ids.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        return `<h${depth} id="${id}"><a class="ancla" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const destino = resolverEnlace(href, fuente);
        const externo = /^https?:/.test(destino);
        return `<a href="${esc(destino)}"${title ? ` title="${esc(title)}"` : ''}${externo ? ' rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
      table(token) {
        // Tablas anchas: se desplazan dentro de su caja, no la página.
        const cab = token.header.map((c, i) => `<th${token.align[i] ? ` style="text-align:${token.align[i]}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const filas = token.rows
          .map((f) => `<tr>${f.map((c, i) => `<td${token.align[i] ? ` style="text-align:${token.align[i]}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`)
          .join('\n');
        return `<div class="tabla"><table><thead><tr>${cab}</tr></thead><tbody>${filas}</tbody></table></div>\n`;
      },
    },
  });
  return marked.parse(markdown);
}

// --- Referencia de la API desde OpenAPI ------------------------------------------------------------------
function referenciaApi() {
  const spec = JSON.parse(leer('packages/api/openapi.json'));
  const esquemas = spec.components?.schemas ?? {};
  const nombreRef = (ref) => ref.split('/').at(-1);
  const tipo = (s) => {
    if (!s) return '';
    if (s.$ref) return `<a href="#esquema-${slug(nombreRef(s.$ref))}"><code>${esc(nombreRef(s.$ref))}</code></a>`;
    if (s.enum) return s.enum.map((v) => `<code>${esc(JSON.stringify(v))}</code>`).join(' | ');
    for (const k of ['anyOf', 'oneOf', 'allOf']) if (s[k]) return s[k].map(tipo).join(k === 'allOf' ? ' y ' : ' o ');
    const t = Array.isArray(s.type) ? s.type.join(' | ') : s.type;
    if (t === 'array') return `arreglo de ${tipo(s.items)}`;
    if (t === 'object' && s.properties) return 'objeto';
    return `<code>${esc(t ?? 'cualquiera')}${s.format ? ` (${esc(s.format)})` : ''}</code>`;
  };
  const tablaPropiedades = (s) => {
    if (s?.$ref) s = esquemas[nombreRef(s.$ref)];
    if (!s?.properties) return s ? `<p>Tipo: ${tipo(s)}</p>` : '';
    const req = new Set(s.required ?? []);
    const filas = Object.entries(s.properties)
      .map(([k, v]) => `<tr><td><code>${esc(k)}</code>${req.has(k) ? ' <span class="req">obligatorio</span>' : ''}</td><td>${tipo(v)}</td><td>${esc(v.description ?? '')}</td></tr>`)
      .join('\n');
    return `<div class="tabla"><table><thead><tr><th>Campo</th><th>Tipo</th><th>Descripción</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  };

  const operaciones = [];
  for (const [ruta, metodos] of Object.entries(spec.paths)) {
    for (const [metodo, op] of Object.entries(metodos)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(metodo)) continue;
      operaciones.push({ ruta, metodo, op, grupo: op.tags?.[0] ?? 'Otros' });
    }
  }
  const grupos = [...new Set(operaciones.map((o) => o.grupo))];
  let html = `<h2 id="referencia">Referencia de endpoints</h2>
<p>Generada de <a href="${REPO}/blob/main/packages/api/openapi.json"><code>openapi.json</code></a> (OpenAPI ${esc(spec.openapi)}).
Tu servidor la sirve en <code>/openapi.json</code> y la documentación interactiva en <code>/docs</code>.</p>
<p>${esc(spec.info.description).replaceAll('\n', '<br>')}</p>
<div class="tabla"><table><thead><tr><th>Método</th><th>Ruta</th><th>Qué hace</th></tr></thead><tbody>
${operaciones.map((o) => `<tr><td><span class="metodo ${o.metodo}">${o.metodo.toUpperCase()}</span></td><td><a href="#op-${slug(`${o.metodo} ${o.ruta}`)}"><code>${esc(o.ruta)}</code></a></td><td>${esc(o.op.summary ?? '')}</td></tr>`).join('\n')}
</tbody></table></div>\n`;
  for (const g of grupos) {
    html += `<h3 id="grupo-${slug(g)}">${esc(g)}</h3>\n`;
    for (const { ruta, metodo, op } of operaciones.filter((o) => o.grupo === g)) {
      html += `<section class="op" id="op-${slug(`${metodo} ${ruta}`)}"><h4><span class="metodo ${metodo}">${metodo.toUpperCase()}</span> <code>${esc(ruta)}</code></h4>
<p><strong>${esc(op.summary ?? '')}</strong>${op.security?.length ? ' · requiere llave' : ' · pública'}</p>${op.description ? `<p>${esc(op.description)}</p>` : ''}`;
      const params = (op.parameters ?? []).map((p) => (p.$ref ? spec.components.parameters[nombreRef(p.$ref)] : p));
      if (params.length) {
        html += `<div class="tabla"><table><thead><tr><th>Parámetro</th><th>En</th><th>Tipo</th><th>Descripción</th></tr></thead><tbody>${params
          .map((p) => `<tr><td><code>${esc(p.name)}</code>${p.required ? ' <span class="req">obligatorio</span>' : ''}</td><td>${esc(p.in)}</td><td>${tipo(p.schema)}</td><td>${esc(p.description ?? '')}</td></tr>`)
          .join('')}</tbody></table></div>`;
      }
      const cuerpo = op.requestBody?.content?.['application/json']?.schema;
      if (cuerpo) html += `<p>Cuerpo (JSON): ${tipo(cuerpo)}</p>`;
      const respuestas = Object.entries(op.responses ?? {});
      html += `<p>Respuestas: ${respuestas.map(([c, r]) => `<code>${esc(c)}</code> ${esc(r.description ?? '')}`).join(' · ')}</p></section>\n`;
    }
  }
  html += `<h3 id="esquemas">Esquemas</h3>\n`;
  for (const [nombre, s] of Object.entries(esquemas)) {
    html += `<section class="op" id="esquema-${slug(nombre)}"><h4><code>${esc(nombre)}</code></h4>${s.description ? `<p>${esc(s.description)}</p>` : ''}${tablaPropiedades(s)}</section>\n`;
  }
  return html;
}

// --- Plantilla --------------------------------------------------------------------------------------------
const CSS = `
:root{--fondo:#fbfaf7;--texto:#1d1d1b;--suave:#5c5a55;--borde:#e3e0d8;--caja:#f2efe8;--acento:#0b5d8f;--acento-suave:#e3eef5;--aviso:#7a4b00;
--codigo:#f2efe8;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--fondo:#141413;--texto:#ecebe7;--suave:#a9a69e;--borde:#2f2e2b;--caja:#1e1d1b;
--acento:#7cc0ec;--acento-suave:#1b2a33;--aviso:#f0c070;--codigo:#1e1d1b;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--fondo);color:var(--texto);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--acento)}a:hover{text-decoration-thickness:2px}
header{border-bottom:1px solid var(--borde);background:var(--fondo);position:sticky;top:0;z-index:1}
.barra{max-width:1040px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
.marca{font-weight:700;text-decoration:none;color:var(--texto);margin-right:auto}
nav{display:flex;flex-wrap:wrap;gap:2px 4px}nav a{text-decoration:none;color:var(--suave);padding:4px 8px;border-radius:6px;font-size:15px}
nav a[aria-current=page]{color:var(--texto);background:var(--caja)}nav a:hover{color:var(--texto)}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:2rem;line-height:1.2;margin:.4em 0 .6em;text-wrap:balance}h2{margin-top:2.2em;padding-top:.4em;border-top:1px solid var(--borde)}
h2,h3,h4{line-height:1.3;text-wrap:balance}h1,h2,h3,h4{position:relative;scroll-margin-top:72px}
.ancla{position:absolute;left:-1em;width:1em;color:var(--suave);text-decoration:none;opacity:0}h2:hover .ancla,h3:hover .ancla,h4:hover .ancla{opacity:1}
code{font:.88em/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--codigo);padding:.1em .3em;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--codigo);border:1px solid var(--borde);border-radius:8px;padding:12px 14px;overflow-x:auto}pre code{background:none;padding:0;overflow-wrap:normal}
/* Los prompts son prosa: se ajustan al ancho en lugar de desplazarse. */
pre:has(code.language-text){white-space:pre-wrap;overflow-wrap:anywhere}
td code,th code{overflow-wrap:break-word}
.tabla{overflow-x:auto;margin:1em 0;border:1px solid var(--borde);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{padding:7px 10px;border-bottom:1px solid var(--borde);text-align:left;vertical-align:top}
th{background:var(--caja);font-weight:600}tr:last-child td{border-bottom:0}
blockquote{margin:1em 0;padding:8px 14px;border-left:3px solid var(--aviso);background:var(--caja);border-radius:0 8px 8px 0}
.metodo{display:inline-block;min-width:4.2em;text-align:center;font:600 12px/1.8 ui-monospace,monospace;border-radius:4px;background:var(--acento-suave);color:var(--acento)}
.metodo.delete{color:#b42318;background:#fde7e5}.metodo.post{color:#11704a;background:#e2f4ec}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .metodo.delete{color:#ff9b91;background:#3a1c19}:root:not([data-theme=light]) .metodo.post{color:#7fdcb0;background:#16302a}}
.op{border:1px solid var(--borde);border-radius:8px;padding:2px 14px;margin:12px 0}.op h4{margin:.8em 0 .2em}
.req{font-size:12px;color:var(--aviso)}
.playground{width:100%;height:min(80vh,900px);border:1px solid var(--borde);border-radius:8px;background:#fff}
footer{border-top:1px solid var(--borde);color:var(--suave);font-size:14px}footer div{max-width:860px;margin:0 auto;padding:16px}
`;

function pagina(p, cuerpo) {
  const titulo = cuerpo.match(/<h1[^>]*>(?:<a[^>]*>#<\/a>)?([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '') ?? p.menu;
  const menu = PAGINAS.map((q) => `<a href="${q.html}"${q.html === p.html ? ' aria-current="page"' : ''}>${esc(q.menu)}</a>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.html === 'index.html' ? 'factura-hn: facturación SAR Honduras' : `${titulo} · factura-hn`)}</title>
<meta name="description" content="Facturación conforme al SAR de Honduras (Acuerdo 481-2017): SDK, API REST y servidor MCP de código abierto.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230b5d8f'/%3E%3Cpath d='M9 8h14v3H12v4h9v3h-9v6H9z' fill='white'/%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
<header><div class="barra"><a class="marca" href="index.html">factura-hn</a><nav aria-label="Secciones">${menu}<a href="${REPO}">GitHub</a></nav></div></header>
<main>
${cuerpo}
</main>
<footer><div>MIT · No es asesoría fiscal ni un sistema autorizado por el SAR. Fuente de esta página:
<a href="${REPO}/blob/main/${p.fuente}"><code>${esc(p.fuente)}</code></a>.</div></footer>
</body>
</html>
`;
}

// --- Construir --------------------------------------------------------------------------------------------
rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });
writeFileSync(join(SALIDA, '.nojekyll'), '');

const PLAYGROUND = join(RAIZ, 'examples', 'playground', 'public');
if (!existsSync(join(PLAYGROUND, 'playground.global.js'))) {
  console.error('Falta el playground compilado: corre `pnpm playground` (o `pnpm sitio`, que lo hace).');
  process.exit(1);
}
cpSync(PLAYGROUND, join(SALIDA, 'playground'), { recursive: true });

for (const p of PAGINAS) {
  let md = leer(p.fuente);
  if (p.recorte) md = p.recorte(md);
  let html = convertir(md, p.fuente);
  html = html.replace(
    '<!-- playground -->',
    '<iframe class="playground" src="playground/index.html" title="Playground de factura-hn"></iframe>\n<p><a href="playground/index.html">Abrir el playground en pantalla completa</a></p>',
  );
  if (p.extra) html += p.extra();
  writeFileSync(join(SALIDA, p.html), pagina(p, html));
}

// --- Verificar enlaces internos ---------------------------------------------------------------------------
const errores = [];
const idsDe = new Map();
const ids = (archivo) => {
  if (!idsDe.has(archivo)) idsDe.set(archivo, new Set([...readFileSync(archivo, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return idsDe.get(archivo);
};
for (const p of [...PAGINAS.map((q) => q.html), 'playground/index.html']) {
  const archivo = join(SALIDA, p);
  const html = readFileSync(archivo, 'utf8');
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const enRepo = url.startsWith(`${REPO}/`) && /\/(blob|tree)\/main\/([^#]+)/.exec(url)?.[2];
    if (enRepo && !existsSync(join(RAIZ, decodeURIComponent(enRepo)))) errores.push(`${p}: no existe en el repositorio ${enRepo}`);
    if (/^([a-z]+:|\/\/)/i.test(url)) continue;
    const [ruta, ancla] = url.replace(/&amp;/g, '&').split('#');
    const destino = ruta ? join(dirname(archivo), ruta) : archivo;
    if (!existsSync(destino)) errores.push(`${p}: no existe ${url}`);
    else if (ancla && destino.endsWith('.html') && !ids(destino).has(ancla)) errores.push(`${p}: no existe el ancla ${url}`);
  }
}
if (errores.length) {
  console.error(`Enlaces rotos en el sitio:\n${errores.join('\n')}`);
  process.exit(1);
}
console.log(`Sitio en ${relative(RAIZ, SALIDA)}/: ${PAGINAS.length} páginas y el playground; enlaces internos verificados.`);
