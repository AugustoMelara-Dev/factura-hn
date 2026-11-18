import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^factura-hn$/, replacement: pkg('core/src/index.ts') },
      { find: /^@factura-hn\/sqlite$/, replacement: pkg('sqlite/src/index.ts') },
      { find: /^@factura-hn\/postgres$/, replacement: pkg('postgres/src/index.ts') },
      { find: /^@factura-hn\/pdf$/, replacement: pkg('pdf/src/index.ts') },
      { find: /^@factura-hn\/api$/, replacement: pkg('api/src/index.ts') },
      { find: /^@factura-hn\/cliente$/, replacement: pkg('cliente/src/index.ts') },
    ],
  },
  test: { fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
});
