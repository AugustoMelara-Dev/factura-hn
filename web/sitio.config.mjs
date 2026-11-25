// Constantes del sitio que comparten la configuración de Astro y los scripts de generación y verificación.
// `site` y `base` se pueden cambiar con FHN_SITIO_URL y FHN_SITIO_BASE (por ejemplo, para un fork o un dominio propio).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITIO_URL = (process.env.FHN_SITIO_URL ?? 'https://augustomelara-dev.github.io').replace(/\/+$/, '');
/** La base, con barra inicial y sin barra final ('' si el sitio va en la raíz del dominio). */
export const BASE = `/${(process.env.FHN_SITIO_BASE ?? '/factura-hn').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
export const REPO = 'https://github.com/AugustoMelara-Dev/factura-hn';

// La raíz se calcula una vez, al cargar este archivo desde la configuración de Astro o un script. Los componentes
// lo reciben empaquetado en .astro/, donde import.meta.url ya no apunta aquí: por eso queda en FHN_RAIZ.
process.env.FHN_RAIZ ??= fileURLToPath(new URL('..', import.meta.url));
export const RAIZ = process.env.FHN_RAIZ;
export const WEB = join(RAIZ, 'web');
/** La salida del build: `sitio/` en la raíz del repositorio, la carpeta que sube pages.yml. */
export const SALIDA = join(RAIZ, 'sitio');
export const DOCS = join(WEB, 'src', 'content', 'docs');

/** Bloques del menú lateral, en orden. Cada uno es una carpeta de `src/content/docs/`. */
export const BLOQUES = [
  { dir: 'empezar', label: 'Empezar' },
  { dir: 'documentos', label: 'Guías por documento' },
  { dir: 'negocios', label: 'Guías por negocio' },
  { dir: 'conceptos', label: 'Conceptos' },
  { dir: 'guias', label: 'Guías' },
  { dir: 'produccion', label: 'Ir a producción' },
  { dir: 'referencia', label: 'Referencia' },
  { dir: 'ia', label: 'IA y agentes' },
  { dir: 'ayuda', label: 'Ayuda' },
];

/**
 * Guías de entrada por producto (`src/content/docs/guias/<slug>.md`). En el menú van en su propio grupo, después de
 * «Empezar»: con «Guías por documento» y «Guías por negocio» son las tres formas de entrar a la documentación. Su
 * frontmatter lleva `sidebar.hidden` para no repetirse en el grupo «Guías».
 */
export const GUIAS_PRODUCTO = ['guias/sdk', 'guias/cli', 'guias/api', 'guias/mcp'];

/** El menú lateral de Starlight. */
export const MENU = BLOQUES.flatMap(({ dir, label }) => [
  { label, items: [{ autogenerate: { directory: dir } }] },
  ...(dir === 'empezar' ? [{ label: 'Guías por producto', items: GUIAS_PRODUCTO.map((slug) => ({ slug })) }] : []),
]);

/**
 * Páginas del producto: `src/pages/*.astro`, con su propio diseño y fuera de Starlight. `ruta` es la URL sin la base
 * y sin barras ('' es la portada). Su versión para IA (`/<ruta>.md`, `/index.md`) sale de `src/md/<archivo>`,
 * que la página también muestra o resume. `scripts/verificar.mjs` comprueba cada una.
 */
export const PAGINAS_PRODUCTO = [
  { ruta: '', md: 'portada.md' },
  { ruta: 'probar', md: 'probar.md' },
  { ruta: 'cumplimiento', md: 'cumplimiento.md' },
  { ruta: 'precios', md: 'precios.md' },
  { ruta: 'contacto', md: 'contacto.md' },
];
