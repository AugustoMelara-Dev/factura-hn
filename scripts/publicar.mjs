#!/usr/bin/env node
/**
 * Publica en npm los paquetes cuya versión aún no está en el registro, en orden de dependencias.
 *
 * Cada paquete se empaqueta con `pnpm pack` (reemplaza `workspace:` por versiones) y el tarball se sube con
 * `npm publish`. Lo ya publicado se salta, así que se puede volver a correr. Correr después de `pnpm build` y
 * `node scripts/verificar-dist.mjs` (`pnpm release` hace las tres cosas).
 *
 * Autenticación:
 * - En el flujo Release (CI), npm usa la publicación de confianza (OIDC de GitHub, npm >= 11.5.1) y firma la
 *   procedencia sin tokens.
 * - Desde la máquina del responsable, npm usa la autenticación web (`--auth-type=web`): cada `npm publish`
 *   muestra un enlace, abre el navegador con Enter y espera la confirmación de la llave de seguridad (por
 *   ejemplo, Windows Hello). No hay códigos OTP. Cada paquete pide su propia confirmación y el script avisa
 *   antes de cada uno.
 *
 * Uso:
 *   node scripts/publicar.mjs --dry-run      ensayo: empaqueta y simula la subida, sin autenticarse
 *   node scripts/publicar.mjs --pendientes   solo dice qué versiones faltan en npm (sin empaquetar ni
 *                                            autenticarse); en GitHub Actions escribe `pendientes=true|false`
 *                                            en $GITHUB_OUTPUT
 *   node scripts/publicar.mjs                publica (en la máquina del responsable, tras `npm login`; o en la CI)
 *
 * En la CI la procedencia es explícita: release.yml pone NPM_CONFIG_PROVENANCE=true en el paso de publicación
 * (no va en publishConfig, que rompería la publicación manual: fuera de la CI no hay OIDC que la firme).
 *
 * Por cada paquete publicado crea la etiqueta de git `nombre@versión` e imprime «New tag: nombre@versión». Si
 * existe CHANGESETS_OUTPUT (lo pone changesets/action v2), escribe ahí un evento `git-tag` por paquete: con eso
 * la acción crea la etiqueta en GitHub y la release con el CHANGELOG del paquete.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLICABLES, REPOSITORIO } from './paquetes.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const ensayo = args.includes('--dry-run');
const soloPendientes = args.includes('--pendientes');
const enCI = process.env.GITHUB_ACTIONS === 'true';
if (args.some((a) => a.startsWith('--otp'))) {
  salir('--otp ya no se usa: npm pide la confirmación en el navegador, con tu llave de seguridad.');
}
const desconocidos = args.filter((a) => a !== '--dry-run' && a !== '--pendientes');
if (desconocidos.length) salir(`argumentos desconocidos: ${desconocidos.join(' ')}`);

function salir(mensaje) {
  console.error(`publicar: ${mensaje}`);
  process.exit(1);
}

const ejecutar = (cmd, argumentos, opciones = {}) =>
  execFileSync(cmd, argumentos, { cwd: raiz, encoding: 'utf8', stdio: 'pipe', shell: windows, ...opciones }).trim();

// npm >= 11.5.1 es el mínimo de la publicación de confianza.
const versionNpm = ejecutar('npm', ['--version']);
const [ma, mi, pa] = versionNpm.split('.').map(Number);
if (enCI && !ensayo && !soloPendientes && (ma < 11 || (ma === 11 && (mi < 5 || (mi === 5 && pa < 1))))) {
  salir(`la publicación de confianza requiere npm >= 11.5.1 (hay ${versionNpm})`);
}

if (!ensayo && !soloPendientes && ejecutar('git', ['status', '--porcelain', '--untracked-files=no'])) {
  salir('hay cambios sin confirmar: se publica solo desde un commit limpio');
}

// Manifiestos, con las comprobaciones que no dependen del registro.
const nombres = new Set();
const paquetes = PUBLICABLES.map((carpeta) => {
  const dir = join(raiz, 'packages', carpeta);
  const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (j.private) salir(`${j.name} está marcado private`);
  if (j.repository?.url !== REPOSITORIO) salir(`${j.name}: repository.url debe ser ${REPOSITORIO} (hay ${j.repository?.url})`);
  const internas = Object.keys({ ...j.dependencies, ...j.peerDependencies }).filter((d) => d === 'factura-hn' || d.startsWith('@factura-hn/'));
  const antes = internas.filter((d) => !nombres.has(d));
  if (antes.length) salir(`${j.name} depende de ${antes.join(', ')}, que debe ir antes en PUBLICABLES`);
  nombres.add(j.name);
  return { dir, nombre: j.name, version: j.version };
});

/** ¿Ya está esta versión en el registro? Un 404 significa que no; cualquier otro error detiene todo. */
function publicada({ nombre, version }) {
  try {
    return ejecutar('npm', ['view', `${nombre}@${version}`, 'version']) === version;
  } catch (e) {
    if (/E404|404 Not Found/.test(String(e.stderr))) return false;
    salir(`no se pudo consultar ${nombre}@${version} en npm:\n${e.stderr}`);
  }
}

const pendientes = [];
for (const p of paquetes) {
  if (publicada(p)) console.log(`ya está en npm: ${p.nombre}@${p.version}`);
  else pendientes.push(p);
}
if (soloPendientes) {
  console.log(pendientes.length ? `Pendientes: ${pendientes.map((p) => `${p.nombre}@${p.version}`).join(', ')}` : 'Nada pendiente.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pendientes=${pendientes.length > 0}
`);
  process.exit(0);
}
if (!pendientes.length) {
  console.log('Nada que publicar.');
  process.exit(0);
}

// Desde la máquina del responsable: sesión abierta y aviso de cuántas confirmaciones hacen falta.
const manual = !enCI && !ensayo;
if (manual) {
  let usuario;
  try {
    usuario = ejecutar('npm', ['whoami']);
  } catch {
    salir('no hay sesión de npm en esta máquina. Corre `npm login` (abre el navegador) y vuelve a intentarlo.');
  }
  const n = pendientes.length;
  console.log(
    [
      '',
      `Publicando como ${usuario}: ${n} paquete${n === 1 ? '' : 's'} (${pendientes.map((p) => p.nombre).join(', ')}).`,
      `npm pide una confirmación por paquete: hasta ${n}, una antes de cada subida.`,
      'En cada una: pulsa Enter para abrir el navegador (o abre el enlace que imprime npm), confirma con tu',
      'llave de seguridad (Windows Hello) y vuelve a esta terminal; npm sigue solo.',
      '',
    ].join('\n'),
  );
  if (!process.stdin.isTTY) {
    console.log('Aviso: esta terminal no es interactiva. npm no podrá abrir el navegador con Enter: abre a mano el enlace que imprima.\n');
  }
}

const temporal = mkdtempSync(join(tmpdir(), 'fhn-publicar-'));
const nuevas = [];
try {
  for (const [i, p] of pendientes.entries()) {
    const etiqueta = `${p.nombre}@${p.version}`;
    const destino = mkdtempSync(join(temporal, 'p-'));
    ejecutar('pnpm', ['pack', '--pack-destination', destino], { cwd: p.dir });
    const tarball = readdirSync(destino).find((f) => f.endsWith('.tgz'));
    if (manual) {
      console.log(`\n[${i + 1}/${pendientes.length}] ${etiqueta}: confirma en el navegador con Windows Hello cuando npm lo pida.`);
    }
    const r = spawnSync(
      'npm',
      ['publish', tarball, '--access', 'public', ...(ensayo ? ['--dry-run'] : []), ...(manual ? ['--auth-type=web'] : [])],
      // Toda la salida va directo a la terminal: npm imprime ahí el enlace y espera el Enter.
      { cwd: destino, stdio: 'inherit', shell: windows },
    );
    if (r.status !== 0) {
      salir(
        manual
          ? `falló npm publish de ${etiqueta}. Si la confirmación venció o se canceló, vuelve a correr el mismo comando: lo ya publicado se salta.`
          : `falló npm publish de ${etiqueta}`,
      );
    }
    if (ensayo) {
      console.log(`ensayo ok: ${etiqueta}`);
      continue;
    }
    nuevas.push(etiqueta);
    try {
      ejecutar('git', ['tag', etiqueta]);
    } catch {
      // La etiqueta ya existía (p. ej. una publicación anterior a medias).
    }
    console.log(`New tag: ${etiqueta}`);
    if (process.env.CHANGESETS_OUTPUT) {
      appendFileSync(process.env.CHANGESETS_OUTPUT, `${JSON.stringify({ type: 'git-tag', tag: etiqueta, packageName: p.nombre })}
`);
    }
  }
} finally {
  rmSync(temporal, { recursive: true, force: true });
}
console.log(ensayo ? 'Ensayo terminado: no se publicó nada.' : `Publicados: ${nuevas.join(', ')}`);
