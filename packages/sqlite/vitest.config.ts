import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Las pruebas corren contra el código fuente del core, sin compilarlo antes.
const core = (p: string) => fileURLToPath(new URL(`../core/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^factura-hn\/pruebas$/, replacement: core('pruebas.ts') },
      { find: /^factura-hn$/, replacement: core('index.ts') },
    ],
  },
});
