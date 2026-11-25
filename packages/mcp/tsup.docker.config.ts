import { defineConfig } from 'tsup';

// Imagen de Docker del MCP remoto (Dockerfile.mcp): un solo archivo con todas las dependencias, sin node_modules.
// Queda en dist-docker/dist/cli.mjs, junto a dist-docker/package.json (lo copia el Dockerfile): así la versión que
// responde /salud se lee igual que en el paquete publicado (`../package.json`).
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  outDir: 'dist-docker/dist',
  outExtension: () => ({ js: '.mjs' }),
  target: 'node22',
  platform: 'node',
  clean: true,
  splitting: false,
  dts: false,
  noExternal: [/.*/],
  // Las dependencias en CommonJS que llaman a require() dentro de un módulo ES.
  banner: { js: "import { createRequire as __fhnRequire } from 'node:module'; const require = __fhnRequire(import.meta.url);" },
});
