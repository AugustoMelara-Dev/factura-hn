// Sitio de documentación de factura-hn: Astro Starlight en español, publicado en GitHub Pages.
// `pnpm sitio` (en la raíz) genera las páginas que salen de los Markdown del repositorio, construye y verifica.
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';
import rehypeBase from './src/plugins/rehype-base.mjs';
import { BASE, BLOQUES, REPO, SALIDA, SITIO_URL } from './sitio.config.mjs';

export default defineConfig({
  site: SITIO_URL,
  base: BASE || '/',
  trailingSlash: 'always',
  // Los bloques sin página índice llevan a su primera página: quien recorta la dirección no cae en un 404.
  // Astro no antepone la base al destino de una redirección: va escrita.
  redirects: Object.fromEntries(
    Object.entries({
      empezar: 'primera-factura',
      conceptos: 'como-funciona',
      guias: 'imprimir',
      ayuda: 'preguntas-frecuentes',
    }).map(([bloque, pagina]) => [`/${bloque}/`, `${BASE}/${bloque}/${pagina}/`]),
  ),
  outDir: SALIDA,
  // El sitio casi no tiene imágenes: sin sharp (y sin su script de instalación).
  image: { service: passthroughImageService() },
  markdown: {
    processor: unified({ rehypePlugins: [[rehypeBase, { base: BASE }]] }),
  },
  integrations: [
    starlight({
      title: 'factura-hn',
      description:
        'Facturación conforme al Acuerdo 481-2017 de Honduras: SDK, API REST y servidor MCP de código abierto. Proyecto independiente, no afiliado al SAR.',
      defaultLocale: 'root',
      locales: { root: { label: 'Español', lang: 'es' } },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      customCss: ['./src/styles/fuentes.css', './src/styles/tema.css'],
      components: { Footer: './src/components/Pie.astro', Hero: './src/components/Portada.astro' },
      credits: false,
      lastUpdated: false,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        // Los prompts (`text`) son prosa: se ajustan al ancho en vez de desplazarse.
        defaultProps: { overridesByLang: { text: { wrap: true } } },
        styleOverrides: {
          borderRadius: '6px',
          codeFontFamily: 'var(--__sl-font-mono)',
          uiFontFamily: 'var(--__sl-font)',
          codeBackground: 'var(--fhn-superficie)',
          borderColor: 'var(--sl-color-hairline-light)',
        },
      },
      sidebar: BLOQUES.map(({ dir, label }) => ({ label, items: [{ autogenerate: { directory: dir } }] })),
    }),
  ],
});
