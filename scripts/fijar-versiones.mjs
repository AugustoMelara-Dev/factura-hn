#!/usr/bin/env node
/**
 * Lleva la versión nueva a donde `changeset version` no llega. Corre justo después (script `version` de la raíz,
 * que usa el flujo Release), para que el PR «Versión de paquetes» ya traiga todo al día:
 *
 * 1. Comprueba que los seis paquetes publicables comparten versión (grupo `fixed` de .changeset/config.json).
 * 2. `@factura-hn/api` (privada, en el `ignore` de changesets) toma esa versión en su package.json, y
 *    `packages/api/openapi.json` en `info.version`. El código la lee de package.json (`VERSION_API`).
 * 3. Los bloques `mcpServers` («@factura-hn/mcp@X.Y.Z») del README, de packages/mcp/README.md y de la página del
 *    MCP en el sitio fijan la versión nueva (las pruebas los comparan con package.json).
 * 4. `CHANGELOG.md` de la raíz (historia hasta la 0.2.0) recibe una sección de la versión nueva que enlaza al
 *    CHANGELOG de cada paquete, donde changesets escribe el detalle. Si la sección ya existe, no la toca.
 * 5. `packages/api/CHANGELOG.md` recibe la sección de la versión nueva (remite al de `@factura-hn/cliente`).
 *    changesets/action lee el CHANGELOG de todo paquete cuya versión cambió: sin este archivo, el trabajo
 *    `version` de release.yml falla.
 *
 * Uso: node scripts/fijar-versiones.mjs [--fecha AAAA-MM-DD]   (por defecto, hoy en Honduras)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PUBLICABLES, REPOSITORIO } from './paquetes.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8');
const escribir = (ruta, texto) => {
  writeFileSync(join(raiz, ruta), texto);
  console.log(`${ruta}: ${version}`);
};
const salir = (mensaje) => {
  console.error(`fijar-versiones: ${mensaje}`);
  process.exit(1);
};

// 1. Una sola versión para los seis.
const manifiestos = PUBLICABLES.map((p) => ({ carpeta: p, ...JSON.parse(leer(`packages/${p}/package.json`)) }));
const version = manifiestos[0].version;
const distintos = manifiestos.filter((m) => m.version !== version);
if (distintos.length) salir(`los paquetes publicables no comparten versión: ${manifiestos.map((m) => `${m.name}@${m.version}`).join(', ')}`);
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) salir(`versión inesperada: ${version}`);

/** Cambia el primer `"version": "…"` de un JSON sin reformatearlo, y comprueba el resultado. */
function fijarVersionJSON(ruta, leerVersion) {
  const antes = leer(ruta);
  const despues = antes.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (leerVersion(JSON.parse(despues)) !== version) salir(`${ruta}: no se pudo fijar la versión`);
  if (despues !== antes) escribir(ruta, despues);
}

// 2. La API: package.json (la fuente de VERSION_API) y la especificación generada.
fijarVersionJSON('packages/api/package.json', (j) => j.version);
fijarVersionJSON('packages/api/openapi.json', (j) => j.info.version);

// 3. Los bloques mcpServers.
const patronMcp = /@factura-hn\/mcp@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g;
for (const ruta of ['README.md', 'packages/mcp/README.md', 'web/src/content/docs/ia/mcp.md']) {
  const antes = leer(ruta);
  const despues = antes.replace(patronMcp, `@factura-hn/mcp@${version}`);
  if (despues !== antes) escribir(ruta, despues);
}

// 4. La sección del CHANGELOG de la raíz.
const iFecha = process.argv.indexOf('--fecha');
const fecha = iFecha > 0 ? process.argv[iFecha + 1] : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) salir(`--fecha debe ser AAAA-MM-DD (hay ${fecha})`);
const changelog = leer('CHANGELOG.md');
if (!new RegExp(`^## ${version.replace(/\./g, '\\.')} `, 'm').test(changelog)) {
  const web = REPOSITORIO.replace(/^git\+/, '').replace(/\.git$/, '');
  // Ancla de GitHub para «## 0.3.0»: «030».
  const ancla = version.replace(/[^0-9A-Za-z-]/g, '').toLowerCase();
  const seccion = [
    `## ${version} — ${fecha}`,
    '',
    'El detalle de esta versión está en el CHANGELOG de cada paquete (viaja también dentro de cada paquete de npm).',
    'Los seis comparten número de versión. Busca primero «Cambios incompatibles» en cada uno.',
    '',
    ...manifiestos.map((m) => `- [\`${m.name}\`](${web}/blob/main/packages/${m.carpeta}/CHANGELOG.md#${ancla})`),
    '',
    `La API REST (\`@factura-hn/api\`, no se publica en npm) sigue la misma versión: sus cambios van en el CHANGELOG`,
    'de `@factura-hn/cliente`.',
    '',
    '',
  ].join('\n');
  const inicio = changelog.search(/^## /m);
  if (inicio < 0) salir('CHANGELOG.md: no encuentro la primera sección «## »');
  escribir('CHANGELOG.md', changelog.slice(0, inicio) + seccion + changelog.slice(inicio));
}

// 5. El CHANGELOG de la API (changesets/action lo lee porque su versión cambió en el paso 2).
const changelogApi = leer('packages/api/CHANGELOG.md');
if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}$`, 'm').test(changelogApi)) {
  const inicio = changelogApi.search(/^## /m);
  const seccion = `## ${version}\n\nVer \`packages/cliente/CHANGELOG.md\`, sección ${version}.\n\n`;
  escribir('packages/api/CHANGELOG.md', inicio < 0 ? `${changelogApi.trimEnd()}\n\n${seccion}` : changelogApi.slice(0, inicio) + seccion + changelogApi.slice(inicio));
}
