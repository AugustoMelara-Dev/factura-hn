#!/usr/bin/env node
/**
 * Publica en npm los paquetes cuya versión aún no está en el registro, en orden de dependencias.
 *
 * Cada paquete se empaqueta con `pnpm pack` (reemplaza `workspace:` por versiones) y el tarball se sube con
 * `npm publish`. En el flujo Release, npm se autentica con la publicación de confianza (OIDC de GitHub, npm
 * >= 11.5.1) y firma la procedencia sin tokens. Lo ya publicado se salta, así que se puede volver a correr.
 * Correr después de `pnpm build` y `node scripts/verificar-dist.mjs` (`pnpm release` hace las tres cosas).
 *
 * Uso:
 *   node scripts/publicar.mjs --dry-run       ensayo: empaqueta y simula la subida
 *   node scripts/publicar.mjs --otp=123456    desde la máquina del responsable (código 2FA de npm)
 *   node scripts/publicar.mjs                 en la CI (OIDC)
 *
 * Por cada paquete publicado crea la etiqueta de git `nombre@versión` e imprime «New tag: nombre@versión»
 * (changesets/action la usa para las releases de GitHub).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLICABLES, REPOSITORIO } from './paquetes.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const ensayo = args.includes('--dry-run');
const otp = args.find((a) => a.startsWith('--otp='))?.slice('--otp='.length);
const enCI = process.env.GITHUB_ACTIONS === 'true';
const desconocidos = args.filter((a) => a !== '--dry-run' && !a.startsWith('--otp='));
if (desconocidos.length) salir(`argumentos desconocidos: ${desconocidos.join(' ')}`);
if (otp !== undefined && !/^\d{6,8}$/.test(otp)) salir('--otp debe ser el código numérico de tu app de 2FA');

function salir(mensaje) {
  console.error(`publicar: ${mensaje}`);
  process.exit(1);
}

const ejecutar = (cmd, argumentos, opciones = {}) =>
  execFileSync(cmd, argumentos, { cwd: raiz, encoding: 'utf8', stdio: 'pipe', shell: windows, ...opciones }).trim();

// npm >= 11.5.1 es el mínimo de la publicación de confianza.
const versionNpm = ejecutar('npm', ['--version']);
const [ma, mi, pa] = versionNpm.split('.').map(Number);
if (enCI && !ensayo && (ma < 11 || (ma === 11 && (mi < 5 || (mi === 5 && pa < 1))))) {
  salir(`la publicación de confianza requiere npm >= 11.5.1 (hay ${versionNpm})`);
}

if (!ensayo && ejecutar('git', ['status', '--porcelain', '--untracked-files=no'])) {
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

const temporal = mkdtempSync(join(tmpdir(), 'fhn-publicar-'));
const nuevas = [];
try {
  for (const p of paquetes) {
    const etiqueta = `${p.nombre}@${p.version}`;
    if (publicada(p)) {
      console.log(`ya está en npm: ${etiqueta}`);
      continue;
    }
    const destino = mkdtempSync(join(temporal, 'p-'));
    ejecutar('pnpm', ['pack', '--pack-destination', destino], { cwd: p.dir });
    const tarball = readdirSync(destino).find((f) => f.endsWith('.tgz'));
    const r = spawnSync('npm', ['publish', tarball, '--access', 'public', ...(ensayo ? ['--dry-run'] : []), ...(otp ? [`--otp=${otp}`] : [])], {
      cwd: destino,
      stdio: ['inherit', 'inherit', 'pipe'],
      encoding: 'utf8',
      shell: windows,
    });
    process.stderr.write(r.stderr ?? '');
    if (r.status !== 0) {
      if (/EOTP|one-time pass/i.test(r.stderr ?? '')) {
        salir(`el código 2FA venció o no es válido en ${etiqueta}. Vuelve a correr con un código nuevo; lo ya publicado se salta.`);
      }
      salir(`falló npm publish de ${etiqueta}`);
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
  }
} finally {
  rmSync(temporal, { recursive: true, force: true });
}
console.log(ensayo ? 'Ensayo terminado: no se publicó nada.' : nuevas.length ? `Publicados: ${nuevas.join(', ')}` : 'Nada que publicar.');
