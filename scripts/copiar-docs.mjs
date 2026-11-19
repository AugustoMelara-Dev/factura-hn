// Copia archivos canónicos de la raíz al paquete antes de empaquetarlo (`prepack`), para que el tarball los
// incluya sin mantener dos copias en el repositorio:
//   node scripts/copiar-docs.mjs packages/core README.md AGENTS.md llms.txt LICENSE skills docs
//   node scripts/copiar-docs.mjs packages/sqlite LICENSE
// Sin lista, copia lo del núcleo. De `docs/` solo se copian los documentos de DOCS_PUBLICOS (scripts/paquetes.mjs):
// las notas internas del proyecto no se publican, aunque haya archivos nuevos o sin confirmar en la carpeta.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_PUBLICOS } from './paquetes.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [dir = 'packages/core', ...lista] = process.argv.slice(2);
const items = lista.length ? lista : ['README.md', 'AGENTS.md', 'llms.txt', 'LICENSE', 'skills', 'docs'];
for (const item of items) {
  if (item === 'docs') {
    // Se vacía antes: una copia anterior podría traer documentos que ya no son públicos.
    const destino = join(raiz, dir, 'docs');
    rmSync(destino, { recursive: true, force: true });
    mkdirSync(destino, { recursive: true });
    for (const doc of DOCS_PUBLICOS) cpSync(join(raiz, 'docs', doc), join(destino, doc));
    continue;
  }
  cpSync(join(raiz, item), join(raiz, dir, item), { recursive: true });
}
