#!/usr/bin/env node
/**
 * Pone en los README la versión actual de @factura-hn/mcp en los bloques `mcpServers` («@factura-hn/mcp@X.Y.Z»).
 * Corre después de `changeset version` (script `version` de la raíz, que usa el flujo Release), para que el PR de
 * versión ya traiga los README al día y la prueba que los compara con package.json siga en verde.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(raiz, 'packages/mcp/package.json'), 'utf8'));
const patron = /@factura-hn\/mcp@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g;

for (const archivo of ['README.md', 'packages/mcp/README.md']) {
  const ruta = join(raiz, archivo);
  const antes = readFileSync(ruta, 'utf8');
  const despues = antes.replace(patron, `@factura-hn/mcp@${version}`);
  if (despues !== antes) {
    writeFileSync(ruta, despues);
    console.log(`${archivo}: @factura-hn/mcp@${version}`);
  }
}
