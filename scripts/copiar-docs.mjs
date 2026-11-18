// Copia archivos canónicos de la raíz al paquete antes de empaquetarlo (`prepack`), para que el tarball los
// incluya sin mantener dos copias en el repositorio:
//   node scripts/copiar-docs.mjs packages/core README.md AGENTS.md llms.txt LICENSE skills docs
//   node scripts/copiar-docs.mjs packages/sqlite LICENSE
// Sin lista, copia lo del núcleo. De `docs/` se omiten las notas internas del proyecto.
import { cpSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [dir = 'packages/core', ...lista] = process.argv.slice(2);
const items = lista.length ? lista : ['README.md', 'AGENTS.md', 'llms.txt', 'LICENSE', 'skills', 'docs'];
const INTERNOS = new Set(['avance.md', 'lanzamiento.md']);
for (const item of items) {
  cpSync(join(raiz, item), join(raiz, dir, item), {
    recursive: true,
    filter: (origen) => !(item === 'docs' && INTERNOS.has(basename(origen))),
  });
}
