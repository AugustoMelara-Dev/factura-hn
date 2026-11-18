// Copia la documentación canónica de la raíz al paquete antes de `npm pack`,
// para que el tarball de factura-hn incluya README, AGENTS, llms.txt, skills, docs y LICENSE
// sin mantener dos copias en el repositorio.
import { cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, process.argv[2] ?? 'packages/core');
for (const item of ['README.md', 'AGENTS.md', 'llms.txt', 'LICENSE', 'skills', 'docs']) {
  cpSync(join(raiz, item), join(destino, item), { recursive: true });
}
