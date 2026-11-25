#!/usr/bin/env node
/**
 * Prepara el contenido del sitio antes de `astro build`:
 *
 * 1. Las páginas que salen de los Markdown del repositorio (lib/paginas.mjs): el H1 pasa al frontmatter y los
 *    enlaces relativos entre documentos se reescriben a la URL del sitio o al archivo en GitHub.
 * 2. La referencia de la API desde packages/api/openapi.json y la matriz de cumplimiento desde las pruebas (falla
 *    si una regla pierde su prueba).
 * 3. El índice de /referencia/ y una página «En preparación» en cada bloque del menú que aún no tiene páginas.
 * 4. El playground compilado (examples/playground/public) en public/playground/.
 *
 * Nada de esto se versiona: los archivos generados están en web/.gitignore y se listan en web/.generado.json,
 * que la siguiente corrida usa para borrarlos.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import GithubSlugger from 'github-slugger';
import { BLOQUES, DOCS, RAIZ, WEB } from '../sitio.config.mjs';
import { reescribirEnlaces, resolverEnlace } from './lib/enlaces-md.mjs';
import { matrizMarkdown, verificarMatriz } from './lib/matriz.mjs';
import { referenciaApi } from './lib/openapi.mjs';
import { mapaDeEnlaces, PAGINAS } from './lib/paginas.mjs';

const MANIFIESTO = join(WEB, '.generado.json');
const leer = (r) => readFileSync(join(RAIZ, r), 'utf8');
const generados = [];

function escribir(rutaDocs, contenido) {
  const archivo = join(DOCS, rutaDocs);
  // Lo generado en la corrida anterior ya se borró: si el archivo existe, alguien lo escribió a mano.
  if (existsSync(archivo)) {
    throw new Error(`src/content/docs/${rutaDocs} la genera scripts/generar.mjs: no se escribe a mano (cambia su fuente en el repositorio).`);
  }
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, contenido);
  generados.push(relative(WEB, archivo).replaceAll('\\', '/'));
}

const frontmatter = (campos) =>
  `---\n${Object.entries(campos)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) =>
      typeof v === 'object'
        ? `${k}:\n${Object.entries(v).map(([k2, v2]) => `  ${k2}: ${JSON.stringify(v2)}`).join('\n')}`
        : `${k}: ${JSON.stringify(v)}`,
    )
    .join('\n')}\n---\n\n`;

/** Texto plano de un encabezado Markdown, como lo ve github-slugger tras renderizarlo. */
const textoPlano = (s) => s.replace(/`([^`]*)`/g, '$1').replace(/\*\*|__/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();

/** Encabezados fuera de los bloques de código: [{ nivel, texto }]. */
function encabezados(md) {
  const r = [];
  let valla = null;
  for (const linea of md.split('\n')) {
    const v = /^[ \t]*(`{3,}|~{3,})/.exec(linea);
    if (v) {
      if (!valla) valla = v[1];
      else if (v[1][0] === valla[0] && v[1].length >= valla.length) valla = null;
      continue;
    }
    if (valla) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(linea);
    if (h) r.push({ nivel: h[1].length, texto: h[2] });
  }
  return r;
}

/** Quita el H1 inicial (lo pinta Starlight desde el frontmatter) y lo devuelve como título. */
function separarTitulo(md) {
  const m = /^\s*# (.+)\n/.exec(md);
  if (!m) return { titulo: null, cuerpo: md };
  return { titulo: textoPlano(m[1]), cuerpo: md.slice(m[0].length).replace(/^\s+/, '') };
}

/** Índice de las DEC al inicio de /referencia/decisiones/, con su estado y un enlace a su sección. */
function indiceDecisiones(cuerpo) {
  const slugger = new GithubSlugger();
  const filas = [];
  for (const { nivel, texto } of encabezados(cuerpo)) {
    const id = slugger.slug(textoPlano(texto));
    if (nivel !== 3) continue;
    const m = /^(DEC-\d+)\s*·\s*(.+?)(?:\s*·\s*\[(APROBADA[^\]]*|REVISAR)\])?$/.exec(texto.trim());
    if (!m) continue;
    const estado = !m[3] ? '—' : m[3] === 'REVISAR' ? '**[REVISAR]** pendiente de revisión' : m[3].replace('APROBADA', 'Aprobada');
    filas.push(`| [${m[1]}](#${id}) | ${m[2].replace(/\|/g, '\\|')} | ${estado} |`);
  }
  const pendientes = filas.filter((f) => f.includes('[REVISAR]')).length;
  return `:::caution[Interpretaciones pendientes]
Las decisiones marcadas **[REVISAR]** (${pendientes} de ${filas.length}) son interpretaciones que el responsable aún no
aprueba: no son reglas confirmadas. Las que cambian la interpretación fiscal llevan esa marca hasta que se aprueban, y
entonces pasan a [APROBADA] con la fecha.
:::

| Decisión | Tema | Estado |
|---|---|---|
${filas.join('\n')}

`;
}

// --- 0. Limpiar lo generado en la corrida anterior ------------------------------------------------------
if (existsSync(MANIFIESTO)) {
  for (const r of JSON.parse(readFileSync(MANIFIESTO, 'utf8'))) rmSync(join(WEB, r), { force: true });
}
// La caché de contenido de Astro guarda el HTML ya renderizado: con otra base (FHN_SITIO_BASE) o un cambio en
// los plugins quedaría viejo. Se construye siempre desde cero; son pocos segundos.
rmSync(join(WEB, 'node_modules', '.astro'), { recursive: true, force: true });
rmSync(join(WEB, '.astro'), { recursive: true, force: true });

// --- 1 y 2. Páginas desde el repositorio ----------------------------------------------------------------
const mapa = mapaDeEnlaces();
for (const p of PAGINAS) {
  let titulo = p.titulo;
  let cuerpo;
  if (p.generar === 'openapi') {
    cuerpo = referenciaApi();
  } else if (p.generar === 'matriz') {
    cuerpo = matrizMarkdown(verificarMatriz(leer(p.fuente)));
  } else {
    const separado = separarTitulo(leer(p.fuente));
    titulo ??= separado.titulo;
    cuerpo = separado.cuerpo;
    if (p.generar === 'decisiones') cuerpo = indiceDecisiones(cuerpo) + cuerpo;
  }
  if (!titulo) throw new Error(`${p.fuente}: falta el título (un H1 al inicio o \`titulo\` en lib/paginas.mjs)`);
  cuerpo = reescribirEnlaces(cuerpo, (href) => resolverEnlace(href, p.fuente, mapa));
  escribir(
    `${p.ruta}.md`,
    frontmatter({ title: titulo, description: p.descripcion, fuente: p.fuente, sidebar: { label: p.menu, order: p.orden } }) +
      `<!-- Generado por web/scripts/generar.mjs desde ${p.fuente}. No se edita aquí: cambia la fuente. -->\n\n${cuerpo}`,
  );
}

// --- 3. Índice de /referencia/ y bloques vacíos ---------------------------------------------------------
const paginasDe = (dir) =>
  existsSync(join(DOCS, dir))
    ? readdirSync(join(DOCS, dir), { recursive: true })
        .map((f) => String(f).replaceAll('\\', '/'))
        .filter((f) => /\.mdx?$/.test(f) && !f.split('/').some((parte) => parte.startsWith('_')))
    : [];
const datos = (dir, f) => {
  const texto = readFileSync(join(DOCS, dir, f), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(texto)?.[1] ?? '';
  const campo = (k) => {
    const v = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm)?.[1]?.trim();
    return v && /^["']/.test(v) ? (v.startsWith('"') ? JSON.parse(v) : v.slice(1, -1)) : v;
  };
  const orden = Number(/order:\s*(\d+)/.exec(fm)?.[1] ?? 100);
  return { ruta: `/${dir}/${f.replace(/(^|\/)index\.mdx?$/, '$1').replace(/\.mdx?$/, '/')}`.replace(/\/+$/, '/'), titulo: campo('title'), descripcion: campo('description'), orden };
};
const referencia = paginasDe('referencia')
  .filter((f) => f !== 'index.md')
  .map((f) => datos('referencia', f))
  .sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo, 'es'));
escribir(
  'referencia/index.md',
  frontmatter({
    title: 'Referencia',
    description: 'Índice de la referencia de factura-hn: SDK, API REST, errores, cumplimiento, normativa y decisiones.',
    sidebar: { label: 'Índice', order: 0 },
  }) +
    `La referencia sale del repositorio al construir el sitio: las guías de \`docs/\`, la especificación OpenAPI de la API y
las pruebas. Así no se desincroniza del código.

| Página | Qué contiene |
|---|---|
${referencia.map((r) => `| [${r.titulo}](${r.ruta}) | ${r.descripcion ?? ''} |`).join('\n')}
`,
);

for (const { dir, label } of BLOQUES) {
  if (paginasDe(dir).length) continue;
  escribir(
    `${dir}/muestra.md`,
    frontmatter({
      title: 'En preparación',
      description: `Las páginas de «${label}» se están redactando.`,
      pagefind: false,
      sidebar: { order: 999 },
    }) +
      `Las páginas de esta sección se están redactando. Mientras tanto, la [referencia](/referencia/) reúne la
documentación generada desde el repositorio y el [registro de cambios](/ayuda/cambios/) dice qué hay en cada versión.
`,
  );
}

// --- 4. Playground ----------------------------------------------------------------------------------------
const PLAYGROUND = join(RAIZ, 'examples', 'playground', 'public');
if (!existsSync(join(PLAYGROUND, 'playground.global.js'))) {
  console.error('Falta el playground compilado: corre `pnpm playground` (o `pnpm sitio`, que lo hace).');
  process.exit(1);
}
const destinoPlayground = join(WEB, 'public', 'playground');
rmSync(destinoPlayground, { recursive: true, force: true });
cpSync(PLAYGROUND, destinoPlayground, { recursive: true });

writeFileSync(MANIFIESTO, `${JSON.stringify(generados, null, 2)}\n`);
console.log(`Contenido generado: ${generados.length} páginas (${generados.filter((g) => g.endsWith('/muestra.md')).length} «En preparación») y el playground.`);
