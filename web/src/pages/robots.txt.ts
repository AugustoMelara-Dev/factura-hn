// robots.txt con la URL del sitemap. En GitHub Pages el sitio vive bajo /factura-hn/, así que este archivo sirve
// cuando el sitio va en la raíz de un dominio propio (FHN_SITIO_BASE=''); el sitemap también se anuncia en cada
// página con <link rel="sitemap">.
import type { APIRoute } from 'astro';
import { BASE, SITIO_URL } from '../../sitio.config.mjs';

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${SITIO_URL}${BASE}/sitemap-index.xml\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
