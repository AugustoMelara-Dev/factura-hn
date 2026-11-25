// Prueba de humo de lo que se publica. Correr después de `pnpm build` (`pnpm humo` hace ambas cosas).
//
// Empaqueta los paquetes con `pnpm pack` (como `pnpm publish`), crea un proyecto vacío en un directorio temporal
// fuera del repositorio, instala ahí los tarballs con npm (sin red mientras se pueda: `--offline`) y corre lo que
// haría alguien que acaba de llegar desde npm. Nada del monorepo queda al alcance del proyecto: si funciona aquí,
// funciona con lo publicado.
//
// Caminos (cada uno, una función):
//   sdk    el ejemplo mínimo del README de factura-hn, tal como viaja en el tarball, guardado como .mjs: emite.
//   demo   `npx factura-hn demo` / `init`.            TODO(lote2-integracion)
//   api    la API con el cliente tipado.              TODO(lote2-integracion)
//   mcp    el servidor MCP por stdio.                 TODO(lote2-integracion)
//
//   node scripts/humo.mjs              los caminos activos
//   node scripts/humo.mjs sdk mcp      solo esos
//   node scripts/humo.mjs --conservar  no borra el directorio temporal (también se conserva si algo falla)
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
/** Ctrl+C durante un comando: el hijo muere con la señal y se limpia antes de salir. */
let interrumpido = false;

/**
 * Los caminos. `paquetes`: carpetas de packages/ que necesita (se empaquetan e instalan solo esas).
 * `activo: false` = todavía no existe lo que prueba; se corre solo si se pide por nombre.
 */
const CAMINOS = {
  sdk: { activo: true, paquetes: ['core'], correr: caminoSDK },
  demo: { activo: false, paquetes: ['core'], correr: caminoDemo },
  api: { activo: false, paquetes: ['core', 'cliente'], correr: caminoAPI },
  mcp: { activo: false, paquetes: ['core', 'sqlite', 'cliente', 'mcp'], correr: caminoMCP },
};

// --- Utilidades -------------------------------------------------------------------------------------------

/** Entorno sin las variables que pnpm inyecta (npm_config_*, npm_package_*): el proyecto no debe heredarlas. */
function entornoLimpio(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|pnpm_)/i.test(k)));
  return { ...env, ...extra };
}

/** Corre un comando y devuelve su salida; lanza un error con stdout y stderr si termina mal. */
function correr(comando, args, { cwd, env, entrada } = {}) {
  // En Windows npm, npx y pnpm son .cmd: hace falta la shell, y con ella hay que entrecomillar.
  const shell = windows && /^(npm|npx|pnpm)$/.test(comando);
  const citar = (a) => (shell && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const r = spawnSync(comando, shell ? args.map(citar) : args, {
    cwd, env: env ?? entornoLimpio(), input: entrada, encoding: 'utf8', shell, timeout: 300_000,
  });
  if (r.error) throw r.error;
  // 130 = SIGINT en POSIX; 0xC000013A = STATUS_CONTROL_C_EXIT en Windows.
  if (r.signal === 'SIGINT' || r.status === 130 || r.status === 0xc000013a) {
    interrumpido = true;
    throw new Error('interrumpido (Ctrl+C)');
  }
  if (r.status !== 0) {
    throw new Error(`${comando} ${args.join(' ')} terminó con ${r.status}\n${r.stdout ?? ''}${r.stderr ?? ''}`.trim());
  }
  return r.stdout;
}

/** Un archivo de un .tgz (formato ustar), sin depender del `tar` del sistema. */
function leerDeTgz(ruta, buscado) {
  const datos = gunzipSync(readFileSync(ruta));
  const texto = (a, b, c) => c.subarray(a, b).toString('utf8').replace(/\0[\s\S]*$/, '');
  for (let i = 0; i + 512 <= datos.length; ) {
    const cabecera = datos.subarray(i, i + 512);
    const nombre = texto(0, 100, cabecera);
    if (!nombre) break;
    const prefijo = texto(345, 500, cabecera);
    const tamano = parseInt(texto(124, 136, cabecera).trim() || '0', 8);
    if ((prefijo ? `${prefijo}/` : '') + nombre === buscado) return datos.subarray(i + 512, i + 512 + tamano).toString('utf8');
    i += 512 + Math.ceil(tamano / 512) * 512;
  }
  throw new Error(`${buscado} no está en ${ruta}`);
}

// --- Preparación ------------------------------------------------------------------------------------------

/** `pnpm pack` de cada carpeta de packages/ (corre prepack, igual que la publicación). Devuelve carpeta → .tgz. */
function empaquetar(carpetas, destino) {
  const tarballs = {};
  for (const p of carpetas) {
    const dir = join(destino, p);
    correr('pnpm', ['pack', '--pack-destination', dir], { cwd: join(raiz, 'packages', p), env: process.env });
    tarballs[p] = join(dir, readdirSync(dir).find((f) => f.endsWith('.tgz')));
  }
  return tarballs;
}

/**
 * Proyecto vacío con los tarballs instalados. Primero sin red (`--offline`); si falta algo en la caché de npm
 * (dependencias de terceros), vuelve a intentar con red y lo avisa.
 */
function crearProyecto(dir, tarballs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'humo-factura-hn', version: '0.0.0', private: true }, null, 2)}\n`);
  const args = ['install', '--no-audit', '--no-fund', '--no-package-lock', ...Object.values(tarballs)];
  try {
    correr('npm', [...args, '--offline'], { cwd: dir });
    return 'sin red';
  } catch (e) {
    console.warn(`AVISO sin red no se pudo instalar; se intenta con red.\n${String(e.message).split('\n').slice(-3).join('\n')}`);
    correr('npm', [...args, '--prefer-offline'], { cwd: dir });
    return 'con red';
  }
}

// --- Caminos ----------------------------------------------------------------------------------------------

/**
 * El ejemplo mínimo del README de factura-hn (el que se ve en npm), guardado como factura.mjs y corrido con node.
 * Es el bloque que sigue a «En cada venta» (el mismo que comprueba packages/core/test/readme.test.ts).
 */
async function caminoSDK({ proyecto, tarballs }) {
  const readme = leerDeTgz(tarballs.core, 'package/README.md').replace(/\r\n/g, '\n');
  const bloque = [...readme.matchAll(/```(?:ts|js)\n([\s\S]*?)```/g)].map((m) => m[1]).find((c) => c.includes('// En cada venta'));
  if (!bloque) throw new Error('El README de factura-hn no trae el ejemplo mínimo (bloque con «// En cada venta»).');
  const variable = /const (\w+) = await emitir\(/.exec(bloque)?.[1];
  if (!variable) throw new Error('El ejemplo mínimo no guarda el resultado de emitir en una constante.');
  const archivo = join(proyecto, 'factura.mjs');
  writeFileSync(archivo, `${bloque}\nconsole.log(JSON.stringify({ numero: ${variable}.numero, total: ${variable}.totales.total }));\n`);
  const salida = correr(process.execPath, [archivo], { cwd: proyecto }).trim().split('\n').at(-1);
  const { numero, total } = JSON.parse(salida);
  if (!/^\d{3}-\d{3}-\d{2}-\d{8}$/.test(numero) || !(total > 0)) throw new Error(`El ejemplo no emitió: ${salida}`);
  return `${numero}, total ${total}`;
}

/** TODO(lote2-integracion): `npx factura-hn demo` emite con el CAI ficticio y `npx factura-hn init` deja un proyecto que emite. */
async function caminoDemo() {
  return { omitido: 'npx factura-hn demo/init todavía no existe' };
}

/** TODO(lote2-integracion): arrancar la API (Postgres de FHN_PG_URL) y emitir con @factura-hn/cliente instalado del tarball. */
async function caminoAPI() {
  return { omitido: 'falta el arranque de la API fuera del monorepo' };
}

/** TODO(lote2-integracion): `npx factura-hn-mcp` por stdio: listar herramientas y emitir con el SDK local. */
async function caminoMCP() {
  return { omitido: 'falta el cliente MCP de prueba' };
}

// --- Principal --------------------------------------------------------------------------------------------

const argumentos = process.argv.slice(2);
const conservar = argumentos.includes('--conservar');
const pedidos = argumentos.filter((a) => !a.startsWith('--'));
const desconocidos = pedidos.filter((n) => !CAMINOS[n]);
if (desconocidos.length) {
  console.error(`Caminos desconocidos: ${desconocidos.join(', ')}. Hay: ${Object.keys(CAMINOS).join(', ')}.`);
  process.exit(2);
}
const elegidos = pedidos.length ? pedidos : Object.keys(CAMINOS).filter((n) => CAMINOS[n].activo);

const temporal = mkdtempSync(join(tmpdir(), 'fhn-humo-'));
/** Borra el directorio temporal. Si Windows lo tiene tomado (antivirus, un proceso que aún cierra), solo avisa. */
function limpiar() {
  try {
    rmSync(temporal, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.warn(`AVISO no se pudo borrar ${temporal}: ${e.message}`);
  }
}
process.on('SIGINT', () => {
  limpiar();
  process.exit(130);
});
let fallas = 0;
try {
  const carpetas = [...new Set(elegidos.flatMap((n) => CAMINOS[n].paquetes))];
  const tarballs = empaquetar(carpetas, join(temporal, 'tgz'));
  console.log(`ok  empaquetados: ${carpetas.join(', ')}`);
  const proyecto = join(temporal, 'proyecto');
  console.log(`ok  instalados en un proyecto vacío (${crearProyecto(proyecto, tarballs)})`);
  for (const nombre of elegidos) {
    try {
      const r = await CAMINOS[nombre].correr({ proyecto, tarballs, temporal });
      if (r && typeof r === 'object' && r.omitido) console.log(`--  ${nombre}: omitido (${r.omitido})`);
      else console.log(`ok  ${nombre}: ${r}`);
    } catch (e) {
      fallas++;
      console.error(`ERR ${nombre}: ${e.message}`);
    }
  }
} catch (e) {
  fallas++;
  console.error(`ERR ${e.message}`);
} finally {
  if (interrumpido) {
    limpiar();
    process.exit(130);
  }
  if (fallas || conservar) console.log(`Directorio de la prueba: ${temporal}`);
  else limpiar();
}
process.exit(fallas ? 1 : 0);
