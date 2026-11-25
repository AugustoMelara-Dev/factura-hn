import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Las pruebas corren contra el código fuente de los paquetes, sin compilarlos antes.
const pkg = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^factura-hn\/demo$/, replacement: pkg('core/src/demo.ts') },
      { find: /^factura-hn$/, replacement: pkg('core/src/index.ts') },
      { find: /^@factura-hn\/postgres$/, replacement: pkg('postgres/src/index.ts') },
      { find: /^@factura-hn\/pdf$/, replacement: pkg('pdf/src/index.ts') },
    ],
  },
  // Todos los archivos comparten la misma base: uno a la vez.
  test: { fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
});
