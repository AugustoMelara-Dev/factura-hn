// Prueba de punta a punta como la haría alguien que acaba de llegar desde npm, fuera del repositorio.
// Correr después de `pnpm build`. Funciona igual en Windows, macOS y Linux, desde bash o PowerShell: todo pasa por
// child_process, y la shell se usa solo para npm, npx y pnpm en Windows (son .cmd).
//
// Pasos:
//   1. `pnpm pack` de los paquetes a una carpeta temporal (o usa los .tgz de --tarballs <carpeta>).
//   2. Proyecto nuevo en otra carpeta temporal: `npm init -y` y `npm install` de los tarballs.
//   3. `npx factura-hn init` y `node emitir.mjs`: debe imprimir el número 000-001-01-00000001.
//   4. `npx factura-hn demo`: emite y escribe factura-demo.html con la leyenda de prueba.
//   5. El ejemplo de 3 líneas del README de factura-hn (tal como viaja en el tarball) en un .mjs: emite.
//   6. Si la versión de Node cumple el `engines` de @factura-hn/mcp: `npx factura-hn-mcp init --demo` y, con el
//      bloque mcpServers que imprime (apuntado al binario instalado), una llamada real por stdio a emitir_factura.
//
//   node scripts/e2e-usuario.mjs
//   node scripts/e2e-usuario.mjs --tarballs <carpeta con los .tgz>   sin empaquetar
//   node scripts/e2e-usuario.mjs --conservar                         no borra la carpeta temporal
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
const LEYENDA_PRUEBA = 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL';
const PRIMER_NUMERO = '000-001-01-00000001';
/** El ejemplo canónico: el mismo en la landing y en el README. */
const EJEMPLO_CANONICO = [
  "import { crearFacturadorDemo } from 'factura-hn/demo';",
  'const caja = await crearFacturadorDemo();',
  "const factura = await caja.emitir({ lineas: [{ descripcion: 'Café molido', cantidad: 2, precioUnitario: '115.00' }] });",
].join('\n');

/** Carpeta de packages/ → nombre en npm. */
const PAQUETES = { core: 'factura-hn', sqlite: '@factura-hn/sqlite', cliente: '@factura-hn/cliente', mcp: '@factura-hn/mcp' };

// --- Utilidades -------------------------------------------------------------------------------------------

/** Error de un paso, con la salida del comando que falló. */
class FallaPaso extends Error {}

/** Entorno sin las variables que pnpm inyecta (npm_config_*, npm_package_*): el proyecto no debe heredarlas. */
function entornoLimpio() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|pnpm_)/i.test(k)));
}

/** Corre un comando sin shell (salvo npm/npx/pnpm en Windows) y devuelve stdout; si falla, lanza con toda la salida. */
function correr(comando, args, { cwd, env = entornoLimpio(), entrada } = {}) {
  const shell = windows && /^(npm|npx|pnpm)$/.test(comando);
  const citar = (a) => (shell && /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  const r = spawnSync(comando, shell ? args.map(citar) : args, {
    cwd, env, input: entrada, encoding: 'utf8', shell, timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  });
  const linea = `${comando === process.execPath ? 'node' : comando} ${args.join(' ')}`;
  if (r.error) throw new FallaPaso(`no se pudo correr «${linea}» en ${cwd}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new FallaPaso(`«${linea}» en ${cwd} terminó con ${r.status ?? r.signal}.\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
  }
  return r.stdout.replace(/\r\n/g, '\n');
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
  throw new FallaPaso(`${buscado} no está en ${ruta}`);
}

/** ¿La versión de Node de este proceso cumple un rango `>=X.Y.Z` de engines? (Los paquetes solo usan `>=`.) */
function cumpleEngines(rango) {
  const m = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(rango.trim());
  if (!m) throw new FallaPaso(`engines.node «${rango}» no tiene la forma >=X.Y.Z que entiende esta prueba`);
  const pedido = m.slice(1).map((n) => Number(n ?? 0));
  const actual = process.versions.node.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (actual[i] !== pedido[i]) return actual[i] > pedido[i];
  return true;
}

function exigirLeyenda(archivo, origen) {
  if (!existsSync(archivo)) throw new FallaPaso(`${origen} no escribió ${archivo}`);
  if (!readFileSync(archivo, 'utf8').includes(LEYENDA_PRUEBA)) throw new FallaPaso(`${archivo} (de ${origen}) no lleva la leyenda «${LEYENDA_PRUEBA}»`);
}

// --- Pasos ------------------------------------------------------------------------------------------------

/** `pnpm pack` de cada carpeta (corre prepack, igual que la publicación), o los .tgz ya hechos de --tarballs. */
function conseguirTarballs(carpetas, destino, origen) {
  const tarballs = {};
  for (const p of carpetas) {
    if (origen) {
      const prefijo = PAQUETES[p].replace('@', '').replace('/', '-');
      const tgz = readdirSync(origen).find((f) => f.startsWith(`${prefijo}-`) && /^\d/.test(f.slice(prefijo.length + 1)) && f.endsWith('.tgz'));
      if (!tgz) throw new FallaPaso(`no hay un ${prefijo}-<versión>.tgz en ${origen}`);
      tarballs[p] = join(origen, tgz);
      continue;
    }
    const dir = join(destino, p);
    mkdirSync(dir, { recursive: true });
    correr('pnpm', ['pack', '--pack-destination', dir], { cwd: join(raiz, 'packages', p), env: process.env });
    const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new FallaPaso(`pnpm pack no dejó un .tgz en ${dir}`);
    tarballs[p] = join(dir, tgz);
  }
  return tarballs;
}

function pasoInstalar(proyecto, tarballs) {
  mkdirSync(proyecto, { recursive: true });
  correr('npm', ['init', '-y'], { cwd: proyecto });
  correr('npm', ['install', '--no-audit', '--no-fund', ...Object.values(tarballs)], { cwd: proyecto });
  const instalados = Object.keys(tarballs).map((p) => {
    const pj = join(proyecto, 'node_modules', ...PAQUETES[p].split('/'), 'package.json');
    if (!existsSync(pj)) throw new FallaPaso(`npm install no dejó ${PAQUETES[p]} en node_modules`);
    return `${PAQUETES[p]}@${JSON.parse(readFileSync(pj, 'utf8')).version}`;
  });
  return instalados.join(', ');
}

/** `npx factura-hn init` y `node emitir.mjs`, en la raíz del proyecto, como dice el README. */
function pasoInit(proyecto) {
  // `--no`: el binario ya está instalado; si faltara, npx no debe bajar otra versión de npm y fingir que pasó.
  const init = correr('npx', ['--no', 'factura-hn', 'init'], { cwd: proyecto });
  for (const f of ['emitir.mjs', 'emisor.json']) {
    if (!existsSync(join(proyecto, f))) throw new FallaPaso(`npx factura-hn init no creó ${f}:\n${init}`);
  }
  const salida = correr(process.execPath, ['emitir.mjs'], { cwd: proyecto });
  if (!salida.includes(PRIMER_NUMERO)) throw new FallaPaso(`node emitir.mjs no imprimió ${PRIMER_NUMERO}:\n${salida}`);
  exigirLeyenda(join(proyecto, 'factura.html'), 'node emitir.mjs');
  return `node emitir.mjs imprimió ${PRIMER_NUMERO}; factura.html de prueba`;
}

/** `npx factura-hn demo` en una subcarpeta del proyecto. */
function pasoDemo(proyecto) {
  const dir = join(proyecto, 'demo');
  mkdirSync(dir, { recursive: true });
  const salida = correr('npx', ['--no', 'factura-hn', 'demo'], { cwd: dir });
  const numero = /\d{3}-\d{3}-01-\d{8}/.exec(salida)?.[0];
  if (!numero) throw new FallaPaso(`npx factura-hn demo no dijo el número emitido:\n${salida}`);
  exigirLeyenda(join(dir, 'factura-demo.html'), 'npx factura-hn demo');
  return `${numero}; factura-demo.html de prueba`;
}

/** El ejemplo de 3 líneas del README que viaja en el tarball, guardado como .mjs y corrido con node. */
function pasoEjemplo(proyecto, tgzCore) {
  const readme = leerDeTgz(tgzCore, 'package/README.md').replace(/\r\n/g, '\n');
  const bloque = [...readme.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1].trim()).find((c) => c.includes('crearFacturadorDemo'));
  if (!bloque) throw new FallaPaso('el README de factura-hn no trae un bloque ```js con «crearFacturadorDemo»');
  if (bloque !== EJEMPLO_CANONICO) {
    throw new FallaPaso(`el ejemplo del README no es el canónico de 3 líneas.\n--- README ---\n${bloque}\n--- esperado ---\n${EJEMPLO_CANONICO}`);
  }
  const archivo = join(proyecto, 'ejemplo.mjs');
  writeFileSync(archivo, `${bloque}\nconsole.log(JSON.stringify({ numero: factura.numero, total: factura.totales.total }));\n`);
  const ultima = correr(process.execPath, [archivo], { cwd: proyecto }).trim().split('\n').at(-1);
  let r;
  try {
    r = JSON.parse(ultima);
  } catch {
    throw new FallaPaso(`ejemplo.mjs no imprimió el documento: ${ultima}`);
  }
  if (!/^\d{3}-\d{3}-01-\d{8}$/.test(r.numero) || !(Number(r.total) > 0)) throw new FallaPaso(`ejemplo.mjs no emitió: ${ultima}`);
  return `${r.numero}, total ${r.total}`;
}

/**
 * `npx factura-hn-mcp init --demo` y el bloque mcpServers que imprime. El bloque arranca el servidor con
 * `npx -y @factura-hn/mcp` (o `cmd /c npx …` en Windows), que bajaría la versión publicada: aquí se cambia solo el
 * comando por el binario instalado (`node <bin de @factura-hn/mcp>`) y se conservan sus variables de entorno.
 */
function pasoMCP(proyecto) {
  const dir = join(proyecto, 'mcp');
  mkdirSync(dir, { recursive: true });
  const salida = correr('npx', ['--no', 'factura-hn-mcp', 'init', '--demo'], { cwd: dir });
  const texto = /^\{\n[\s\S]*?^\}$/m.exec(salida)?.[0];
  if (!texto) throw new FallaPaso(`npx factura-hn-mcp init --demo no imprimió el bloque mcpServers:\n${salida}`);
  const servidor = JSON.parse(texto).mcpServers?.['factura-hn'];
  const pj = join(proyecto, 'node_modules', '@factura-hn', 'mcp', 'package.json');
  const { version, bin: bins } = JSON.parse(readFileSync(pj, 'utf8'));
  // El bloque fija la versión (`@factura-hn/mcp@X.Y.Z`): debe ser la instalada.
  const pedido = [servidor?.command, ...(servidor?.args ?? [])].find((a) => /^@factura-hn\/mcp(@|$)/.test(a ?? ''));
  if (!pedido) throw new FallaPaso(`el bloque mcpServers no arranca @factura-hn/mcp:\n${texto}`);
  if (pedido !== `@factura-hn/mcp@${version}`) throw new FallaPaso(`el bloque mcpServers pide ${pedido} y está instalada la ${version}`);
  const bin = bins?.['factura-hn-mcp'];
  if (!bin) throw new FallaPaso('@factura-hn/mcp no declara el binario factura-hn-mcp');
  const adaptado = { command: process.execPath, args: [resolve(proyecto, 'node_modules', '@factura-hn', 'mcp', bin)], env: servidor.env ?? {}, cwd: dir };
  const cliente = join(proyecto, 'cliente-mcp.mjs');
  writeFileSync(cliente, CLIENTE_MCP);
  const ultima = correr(process.execPath, [cliente], { cwd: proyecto, entrada: JSON.stringify(adaptado) }).trim().split('\n').at(-1);
  let r;
  try {
    r = JSON.parse(ultima);
  } catch {
    throw new FallaPaso(`el cliente MCP no imprimió el resultado: ${ultima}`);
  }
  const numero = r.datos?.documento?.numero;
  if (r.error || r.datos?.prueba !== true || !r.texto.includes(LEYENDA_PRUEBA) || !/^\d{3}-\d{3}-01-\d{8}$/.test(numero ?? '')) {
    throw new FallaPaso(`emitir_factura no devolvió un documento de prueba: ${ultima}`);
  }
  return `emitir_factura por stdio: ${numero} de prueba (${r.herramientas.length} herramientas)`;
}

/** Cliente MCP (el SDK que instaló @factura-hn/mcp): lee de stdin command, args, env y cwd, y emite una factura. */
const CLIENTE_MCP = `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';

let entrada = '';
for await (const parte of process.stdin) entrada += parte;
const { command, args, env, cwd } = JSON.parse(entrada);
const transporte = new StdioClientTransport({ command, args, env: { ...process.env, ...env }, cwd, stderr: 'inherit' });
const cliente = new Client({ name: 'e2e-usuario', version: '0.0.0' });
await cliente.connect(transporte);
try {
  const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
  const r = await cliente.callTool({
    name: 'emitir_factura',
    arguments: { lineas: [{ descripcion: 'Café molido', cantidad: '2', precioUnitario: '115.00' }], idempotencyKey: randomUUID() },
  });
  const texto = r.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  console.log(JSON.stringify({ herramientas, error: Boolean(r.isError), texto, datos: r.structuredContent }));
} finally {
  await cliente.close();
}
`;

// --- Principal --------------------------------------------------------------------------------------------

const argumentos = process.argv.slice(2);
const conservar = argumentos.includes('--conservar');
const iTgz = argumentos.indexOf('--tarballs');
const origenTgz = iTgz >= 0 ? resolve(argumentos[iTgz + 1] ?? '') : null;
if (iTgz >= 0 && !(argumentos[iTgz + 1] && existsSync(origenTgz))) {
  console.error('Uso: node scripts/e2e-usuario.mjs [--tarballs <carpeta con los .tgz>] [--conservar]');
  process.exit(2);
}

const enginesMCP = JSON.parse(readFileSync(join(raiz, 'packages', 'mcp', 'package.json'), 'utf8')).engines.node;
const conMCP = cumpleEngines(enginesMCP);
const carpetas = conMCP ? ['core', 'sqlite', 'cliente', 'mcp'] : ['core'];

console.log(`e2e-usuario: Node ${process.versions.node} en ${process.platform}/${process.arch}`);
const temporal = mkdtempSync(join(tmpdir(), 'fhn-e2e-'));
const proyecto = join(temporal, 'mi-proyecto');
let fallas = 0;

/** Corre un paso y dice ok/ERR. Si `critico`, un fallo detiene la prueba (lo que sigue depende de él). */
function paso(nombre, fn, { critico = false } = {}) {
  const inicio = Date.now();
  try {
    const r = fn();
    console.log(`ok   ${nombre} (${((Date.now() - inicio) / 1000).toFixed(1)} s): ${r}`);
    return r;
  } catch (e) {
    fallas++;
    console.error(`ERR  ${nombre}: ${e instanceof FallaPaso ? e.message : e.stack}`);
    if (critico) throw new FallaPaso('detenida: los pasos que siguen dependen de este');
    return undefined;
  }
}

try {
  let tarballs = {};
  paso(origenTgz ? `tarballs de ${origenTgz}` : 'pnpm pack', () => {
    tarballs = conseguirTarballs(carpetas, join(temporal, 'tgz'), origenTgz);
    return Object.values(tarballs).map((t) => t.split(/[\\/]/).at(-1)).join(', ');
  }, { critico: true });
  paso('npm install en un proyecto nuevo', () => pasoInstalar(proyecto, tarballs), { critico: true });
  paso('npx factura-hn init + node emitir.mjs', () => pasoInit(proyecto));
  paso('npx factura-hn demo', () => pasoDemo(proyecto));
  paso('ejemplo de 3 líneas del README', () => pasoEjemplo(proyecto, tarballs.core));
  if (conMCP) paso('npx factura-hn-mcp init --demo + emitir_factura por stdio', () => pasoMCP(proyecto));
  else console.log(`--   MCP omitido: @factura-hn/mcp pide Node ${enginesMCP} y este es ${process.versions.node}`);
} catch (e) {
  console.error(`ERR  ${e.message}`);
}

if (fallas || conservar) {
  console.log(`Carpeta de la prueba (se conserva): ${temporal}`);
} else {
  try {
    rmSync(temporal, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.warn(`AVISO no se pudo borrar ${temporal}: ${e.message}`);
  }
}
console.log(fallas ? `e2e-usuario: ${fallas} paso(s) fallaron.` : 'e2e-usuario: todo pasó.');
process.exit(fallas ? 1 : 0);
