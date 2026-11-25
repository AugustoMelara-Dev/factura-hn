import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const core = (archivo: string) => fileURLToPath(new URL(`../../packages/core/src/${archivo}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^factura-hn\/demo$/, replacement: core('demo.ts') },
      { find: /^factura-hn$/, replacement: core('index.ts') },
    ],
  },
});
