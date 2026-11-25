import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

// Un solo archivo para el navegador con el núcleo adentro: `public/index.html` se abre sin servidor.
export default defineConfig({
  entry: { playground: 'src/playground.ts' },
  format: ['iife'],
  globalName: 'Playground',
  platform: 'browser',
  target: 'es2020',
  outDir: 'public',
  minify: true,
  clean: false,
  esbuildOptions(o) {
    o.alias = {
      'factura-hn/demo': fileURLToPath(new URL('../../packages/core/src/demo.ts', import.meta.url)),
      'factura-hn': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) };
  },
});
