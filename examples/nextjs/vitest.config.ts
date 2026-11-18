import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^factura-hn$/, replacement: pkg('core/src/index.ts') },
      { find: /^@factura-hn\/(sqlite|postgres|pdf|api|cliente)$/, replacement: pkg('$1/src/index.ts') },
      // En Next, `server-only` solo falla dentro de un componente de cliente; en las pruebas (servidor) es vacío.
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)) },
    ],
  },
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
