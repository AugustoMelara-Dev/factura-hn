import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^factura-hn$/, replacement: pkg('core/src/index.ts') },
      { find: /^@factura-hn\/sqlite$/, replacement: pkg('sqlite/src/index.ts') },
    ],
  },
});
