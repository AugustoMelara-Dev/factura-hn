// Prueba de humo de lo que se publica. Correr después de `pnpm build` (`pnpm humo` hace ambas cosas).
//
// Empaqueta los paquetes con `pnpm pack` (como `pnpm publish`), crea un proyecto vacío en un directorio temporal
// fuera del repositorio, instala ahí los tarballs con npm (sin red mientras se pueda: `--offline`) y corre lo que
// haría alguien que acaba de llegar desde npm. Nada del monorepo queda al alcance del proyecto: si funciona aquí,
// funciona con lo publicado.
//
// Caminos (cada uno, una función):
//   sdk    el ejemplo mínimo del README de factura-hn, tal como viaja en el tarball, guardado como .mjs: emite.
//   demo   `npx factura-hn demo`, y `npx factura-hn init` + `node emitir.mjs`: el HTML lleva la leyenda de prueba.
//   mcp    `npx @factura-hn/mcp init --demo` y, con el bloque que imprime, el servidor por stdio con el cliente
//          MCP del SDK: emite una factura marcada de prueba (Node 22.13+).
//   api    la API desde packages/api/dist (no se publica en npm) contra una base nueva en el Postgres de
//          FHN_PG_URL: llave del demo con la consola, emite y descarga el PDF (los 3 pasos de docs/api.md).
//
//   node scripts/humo.mjs              los caminos activos (api, solo con FHN_PG_URL)
//   node scripts/humo.mjs sdk mcp      solo esos
//   node scripts/humo.mjs --conservar  no borra el directorio temporal (también se conserva si algo falla)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const windows = process.platform === 'win32';
/** Ctrl+C durante un comando: el hijo muere con la señal y se limpia antes de salir. */
let interrumpido = false;
/** Texto exacto de la leyenda de los documentos de prueba. */
const LEYENDA_PRUEBA = 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL';

/**
 * Los caminos. `paquetes`: carpetas de packages/ que necesita (se empaquetan e instalan solo esas).
 * `activo: false`: se corre solo si se pide por nombre.
 */
const CAMINOS = {
  sdk: { activo: true, paquetes: ['core'], correr: caminoSDK },
  demo: { activo: true, paquetes: ['core'], correr: caminoDemo },
  mcp: { activo: true, paquetes: ['core', 'sqlite', 'cliente', 'mcp'], correr: caminoMCP },
  api: { activo: Boolean(process.env.FHN_PG_URL), paquetes: [], correr: caminoAPI },
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
 * Es el bloque ```js con `crearFacturadorDemo` (el mismo que comprueba packages/core/test/readme.test.ts).
 */
async function caminoSDK({ proyecto, tarballs }) {
  const readme = leerDeTgz(tarballs.core, 'package/README.md').replace(/\r\n/g, '\n');
  const bloque = [...readme.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).find((c) => c.includes('crearFacturadorDemo'));
  if (!bloque) throw new Error('El README de factura-hn no trae el ejemplo mínimo (bloque ```js con «crearFacturadorDemo»).');
  if (!/const factura = await /.test(bloque)) throw new Error('El ejemplo mínimo no guarda el documento emitido en «factura».');
  const variable = 'factura';
  const archivo = join(proyecto, 'factura.mjs');
  writeFileSync(archivo, `${bloque}\nconsole.log(JSON.stringify({ numero: ${variable}.numero, total: ${variable}.totales.total }));\n`);
  const salida = correr(process.execPath, [archivo], { cwd: proyecto }).trim().split('\n').at(-1);
  const { numero, total } = JSON.parse(salida);
  if (!/^\d{3}-\d{3}-\d{2}-\d{8}$/.test(numero) || !(total > 0)) throw new Error(`El ejemplo no emitió: ${salida}`);
  return `${numero}, total ${total}`;
}

/**
 * `npx factura-hn demo` emite con el CAI ficticio y escribe el HTML con la leyenda; `npx factura-hn init` deja un
 * proyecto que emite con `node emitir.mjs`.
 */
async function caminoDemo({ proyecto }) {
  const demo = join(proyecto, 'demo');
  mkdirSync(demo, { recursive: true });
  // `--no`: el paquete ya está instalado; npx no debe bajar otro.
  const salida = correr('npx', ['--no', 'factura-hn', 'demo'], { cwd: demo });
  exigirLeyenda(join(demo, 'factura-demo.html'), 'npx factura-hn demo');
  const numero = /\d{3}-\d{3}-01-\d{8}/.exec(salida)?.[0];
  if (!numero) throw new Error(`npx factura-hn demo no dijo el número emitido:\n${salida}`);

  const init = join(proyecto, 'init');
  mkdirSync(init, { recursive: true });
  correr('npx', ['--no', 'factura-hn', 'init'], { cwd: init });
  correr(process.execPath, ['emitir.mjs'], { cwd: init });
  exigirLeyenda(join(init, 'factura.html'), 'node emitir.mjs');
  return `demo ${numero}; init + node emitir.mjs: factura.html de prueba`;
}

/** El HTML existe y lleva la leyenda de prueba. */
function exigirLeyenda(archivo, origen) {
  if (!existsSync(archivo)) throw new Error(`${origen} no escribió ${archivo}`);
  if (!readFileSync(archivo, 'utf8').includes(LEYENDA_PRUEBA)) throw new Error(`${archivo} (de ${origen}) no lleva la leyenda «${LEYENDA_PRUEBA}»`);
}

/**
 * La API desde `packages/api/dist`, contra una base nueva en el Postgres de FHN_PG_URL (se borra al final), en modo
 * local con el demo, como en docker-compose.yml. La llave sale de la consola (`demo llave --solo-llave`) y los
 * 3 pasos de docs/api.md se hacen con fetch: emite con una clave nueva y descarga el PDF del enlace.
 */
async function caminoAPI() {
  const urlBase = process.env.FHN_PG_URL;
  if (!urlBase) throw new Error('Falta FHN_PG_URL (p. ej. postgres://postgres@127.0.0.1:54329/factura_hn_pruebas).');
  const pg = createRequire(join(raiz, 'packages', 'api', 'package.json'))('pg');
  const base = `fhn_humo_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const urlDe = (usuario) => {
    const u = new URL(urlBase);
    u.pathname = `/${base}`;
    if (usuario) {
      u.username = usuario;
      u.password = '';
    }
    return u.toString();
  };
  const dueno = new pg.Client({ connectionString: urlBase });
  await dueno.connect();
  await dueno.query(`CREATE DATABASE ${base}`);
  let servidor = null;
  let log = '';
  try {
    const puerto = await puertoLibre();
    // La API con su propio rol (fhn_api) y el dueño solo para migrar y para la consola.
    const env = entornoLimpio({
      DATABASE_URL: urlDe('fhn_api'), FHN_MIGRAR_URL: urlDe(), FHN_MODO: 'local', FHN_DEMO: '1',
      PUERTO: String(puerto), FHN_HOST: '127.0.0.1',
    });
    const dist = join(raiz, 'packages', 'api', 'dist');
    servidor = spawn(process.execPath, [join(dist, 'servidor.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    servidor.stdout.on('data', (d) => (log += d));
    servidor.stderr.on('data', (d) => (log += d));
    const url = `http://127.0.0.1:${puerto}`;
    await esperar(async () => (await fetch(`${url}/salud`)).ok, 60_000, () => `la API no respondió en /salud:\n${log}`, servidor);

    // 1. La llave de caja del demo.
    const llave = correr(process.execPath, [join(dist, 'cli.js'), 'demo', 'llave', '--solo-llave'], { env }).trim();
    if (!/^fhn_\S+$/.test(llave)) throw new Error(`demo llave --solo-llave no devolvió una llave: ${llave}`);
    // 2. Emite con una clave nueva y el cuerpo de ejemplo.
    const r = await fetch(`${url}/v1/documentos`, {
      method: 'POST',
      headers: { authorization: `Bearer ${llave}`, 'idempotency-key': `venta-${Date.now()}`, 'content-type': 'application/json' },
      body: readFileSync(join(raiz, 'packages', 'api', 'ejemplos', 'factura.json')),
    });
    const cuerpo = await r.json();
    if (r.status !== 201 || !cuerpo.enlaces?.pdf) throw new Error(`la emisión respondió ${r.status}: ${JSON.stringify(cuerpo)}`);
    if (cuerpo.documento.modo !== 'prueba') throw new Error('el documento del demo no salió de prueba');
    // 3. El PDF del enlace.
    const pdf = await fetch(`${url}${cuerpo.enlaces.pdf}`, { headers: { authorization: `Bearer ${llave}` } });
    const bytes = Buffer.from(await pdf.arrayBuffer());
    if (!pdf.ok || bytes.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error(`el PDF no empieza con %PDF (${pdf.status})`);
    return `${cuerpo.documento.numero} de prueba, PDF de ${bytes.length} bytes`;
  } finally {
    if (servidor && servidor.exitCode === null) {
      const fin = new Promise((res) => servidor.once('exit', res));
      servidor.kill();
      await fin;
    }
    await dueno.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`).catch((e) => console.warn(`AVISO no se pudo borrar la base ${base}: ${e.message}`));
    await dueno.end();
  }
}

/**
 * `npx @factura-hn/mcp init --demo` crea la base de prueba e imprime el bloque `mcpServers`. Con ese bloque, tal
 * cual, el cliente MCP del SDK arranca el servidor por stdio, lista las herramientas y emite una factura, que
 * vuelve marcada de prueba.
 */
async function caminoMCP({ proyecto }) {
  const dir = join(proyecto, 'mcp');
  mkdirSync(dir, { recursive: true });
  const salida = correr('npx', ['--no', '@factura-hn/mcp', 'init', '--demo'], { cwd: dir }).replace(/\r\n/g, '\n');
  const bloque = /^\{\n[\s\S]*?^\}$/m.exec(salida)?.[0];
  if (!bloque) throw new Error(`init --demo no imprimió el bloque mcpServers:\n${salida}`);
  const servidor = JSON.parse(bloque).mcpServers['factura-hn'];
  const cliente = join(proyecto, 'cliente-mcp.mjs');
  writeFileSync(cliente, CLIENTE_MCP);
  const salidaCliente = correr(process.execPath, [cliente], { cwd: proyecto, entrada: JSON.stringify({ ...servidor, cwd: proyecto }) });
  const r = JSON.parse(salidaCliente.trim().split('\n').at(-1));
  const faltan = HERRAMIENTAS_MCP.filter((h) => !r.herramientas.includes(h));
  if (faltan.length) throw new Error(`el servidor MCP no registra ${faltan.join(', ')}`);
  if (r.error || r.datos?.prueba !== true || !r.texto.includes(LEYENDA_PRUEBA)) {
    throw new Error(`emitir_factura no devolvió un documento de prueba: ${JSON.stringify(r)}`);
  }
  return `${r.herramientas.length} herramientas; ${r.datos.documento.numero} de prueba`;
}

const HERRAMIENTAS_MCP = ['emitir_factura', 'emitir_nota_credito', 'consultar_documento', 'anular_documento', 'estado_cai', 'libro_ventas', 'registrar_cai'];

/** Cliente MCP del proyecto de prueba: lee de stdin el servidor (command, args, env, cwd) y emite una factura. */
const CLIENTE_MCP = `import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';

let entrada = '';
for await (const parte of process.stdin) entrada += parte;
const { command, args, env, cwd } = JSON.parse(entrada);
const transporte = new StdioClientTransport({ command, args, env: { ...process.env, ...env }, cwd, stderr: 'inherit' });
const cliente = new Client({ name: 'humo-factura-hn', version: '0.0.0' });
await cliente.connect(transporte);
try {
  const herramientas = (await cliente.listTools()).tools.map((t) => t.name);
  const r = await cliente.callTool({
    name: 'emitir_factura',
    arguments: { lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }], idempotencyKey: randomUUID() },
  });
  const texto = r.content.filter((c) => c.type === 'text').map((c) => c.text).join(' ');
  console.log(JSON.stringify({ herramientas, error: Boolean(r.isError), texto, datos: r.structuredContent }));
} finally {
  await cliente.close();
}
`;

/** Un puerto TCP libre en 127.0.0.1. */
function puertoLibre() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** Repite `condicion` hasta que dé true o pasen `ms`; falla antes si el proceso terminó. */
async function esperar(condicion, ms, mensaje, proceso) {
  const limite = Date.now() + ms;
  for (;;) {
    if (proceso && proceso.exitCode !== null) throw new Error(mensaje());
    try {
      if (await condicion()) return;
    } catch {
      // todavía no escucha
    }
    if (Date.now() > limite) throw new Error(mensaje());
    await new Promise((r) => setTimeout(r, 250));
  }
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
  const proyecto = join(temporal, 'proyecto');
  const tarballs = carpetas.length ? empaquetar(carpetas, join(temporal, 'tgz')) : {};
  if (carpetas.length) {
    console.log(`ok  empaquetados: ${carpetas.join(', ')}`);
    console.log(`ok  instalados en un proyecto vacío (${crearProyecto(proyecto, tarballs)})`);
  }
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
