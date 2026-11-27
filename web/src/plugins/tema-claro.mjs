// Integración de Astro: el sitio tiene un solo tema, claro. Starlight escribe <html data-theme="dark"> y su script
// (aquí, ProveedorTema.astro) lo cambia al cargar; sin JavaScript ese cambio no ocurre. Al terminar el build, el
// valor inicial pasa a "light" en cada página.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default function temaClaroSinJs() {
  return {
    name: 'factura-hn:tema-claro-sin-js',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const raiz = fileURLToPath(dir);
        for (const f of readdirSync(raiz, { recursive: true }).map(String)) {
          if (!f.endsWith('.html')) continue;
          const archivo = join(raiz, f);
          const html = readFileSync(archivo, 'utf8');
          const nuevo = html.replace(/<html\b[^>]*>/, (etiqueta) => etiqueta.replace(' data-theme="dark"', ' data-theme="light"'));
          if (nuevo !== html) writeFileSync(archivo, nuevo);
        }
      },
    },
  };
}
