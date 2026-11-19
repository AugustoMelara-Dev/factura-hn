// Verificación de lo que se publica. Correr después de `pnpm build` (`pnpm verificar:dist` hace ambas cosas).
//
// 1. Cada paquete publicable se empaqueta como lo haría `pnpm publish` (corre `prepack`) y se revisa el tarball:
//    están los archivos que nombran main/module/types/exports/bin, README y LICENSE; no van fuentes ni pruebas;
//    `workspace:` se reemplazó por versiones; repository.url es exactamente el repositorio de GitHub y
//    repository.directory apunta al paquete (los exige la publicación de confianza de npm).
// 2. Cada entrada carga por import (ESM) y, si la tiene, por require (CJS), con las mismas exportaciones.
// 3. El núcleo compilado emite un documento y el PDF compilado lo imprime.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLICABLES, REPOSITORIO } from './paquetes.mjs';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
let fallas = 0;
const fallo = (m) => {
  fallas++;
  console.error(`ERR ${m}`);
};

/** Rutas de archivo que el manifiesto promete. */
function prometidas(j) {
  const rutas = new Set([j.main, j.module, j.types].filter(Boolean));
  const recorrer = (v) => (typeof v === 'string' ? rutas.add(v) : v && typeof v === 'object' && Object.values(v).forEach(recorrer));
  recorrer(j.exports);
  recorrer(j.bin);
  return [...rutas].map((r) => r.replace(/^\.\//, ''));
}

/** Archivos de un .tgz (formato ustar): nombre → contenido. Sin depender del `tar` del sistema. */
function leerTgz(ruta) {
  const datos = gunzipSync(readFileSync(ruta));
  const texto = (a, b, c) => c.subarray(a, b).toString('utf8').replace(/\0[\s\S]*$/, '');
  const archivos = new Map();
  for (let i = 0; i + 512 <= datos.length; ) {
    const cabecera = datos.subarray(i, i + 512);
    const nombre = texto(0, 100, cabecera);
    if (!nombre) break;
    const prefijo = texto(345, 500, cabecera);
    const tamano = parseInt(texto(124, 136, cabecera).trim() || '0', 8);
    const tipo = String.fromCharCode(cabecera[156] || 48);
    if (tipo === '0') archivos.set((prefijo ? `${prefijo}/` : '') + nombre, datos.subarray(i + 512, i + 512 + tamano));
    i += 512 + Math.ceil(tamano / 512) * 512;
  }
  return archivos;
}

const temporal = mkdtempSync(join(tmpdir(), 'fhn-pack-'));
try {
  for (const p of PUBLICABLES) {
    const dir = join(raiz, 'packages', p);
    const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const destino = join(temporal, p);
    execFileSync('pnpm', ['pack', '--pack-destination', destino], { cwd: dir, stdio: 'pipe', shell: process.platform === 'win32' });
    const tgz = join(destino, readdirSync(destino).find((f) => f.endsWith('.tgz')));
    const contenido = leerTgz(tgz);
    const archivos = [...contenido.keys()].map((f) => f.replace(/^package\//, ''));
    const faltan = [...prometidas(j), 'README.md', 'LICENSE'].filter((f) => !archivos.includes(f));
    if (faltan.length) fallo(`${j.name}: faltan en el paquete ${faltan.join(', ')}`);
    const sobran = archivos.filter((f) => /^(src|test)\//.test(f) || /\.test\.|tsconfig|vitest\.config/.test(f));
    if (sobran.length) fallo(`${j.name}: no deberían publicarse ${sobran.slice(0, 5).join(', ')}`);
    const manifiesto = contenido.get('package/package.json')?.toString('utf8') ?? '';
    if (manifiesto.includes('workspace:')) fallo(`${j.name}: el package.json publicado conserva «workspace:»`);
    if (j.repository?.url !== REPOSITORIO) fallo(`${j.name}: repository.url debe ser ${REPOSITORIO}`);
    if (j.repository?.directory !== `packages/${p}` || j.publishConfig?.access !== 'public') fallo(`${j.name}: falta repository.directory o publishConfig.access public`);
    if (j.private) fallo(`${j.name}: está marcado private`);
    if (!fallas) console.log(`ok  ${j.name}@${j.version}: ${archivos.length} archivos en el paquete`);
  }
} finally {
  rmSync(temporal, { recursive: true, force: true });
}

const entradas = { core: ['index', 'pruebas'], sqlite: ['index'], postgres: ['index'], pdf: ['index'], cliente: ['index'], mcp: ['index'] };
for (const [p, lista] of Object.entries(entradas)) {
  for (const e of lista) {
    const base = `${raiz}packages/${p}/dist/${e}`;
    try {
      const esm = await import(pathToFileURL(`${base}.js`).href);
      const a = Object.keys(esm).sort().join(',');
      let detalle = 'solo ESM';
      if (p !== 'mcp') {
        const b = Object.keys(require(`${base}.cjs`)).sort().join(',');
        if (a !== b) throw new Error(`exportaciones distintas ESM/CJS:\n  ${a}\n  ${b}`);
        detalle = 'ESM y CJS';
      }
      console.log(`ok  ${p}/${e} (${Object.keys(esm).length} exportaciones, ${detalle})`);
    } catch (err) {
      fallo(`${p}/${e}: ${err.message}`);
    }
  }
}

const { AlmacenFiscalMemoria, registrarAutorizacion, emitir } = require(`${raiz}packages/core/dist/index.cjs`);
const almacen = new AlmacenFiscalMemoria();
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2099-12-31',
});
const doc = await emitir({
  emisor: { rtn: '99990000000001', razonSocial: 'X', nombreComercial: 'X', direccionCasaMatriz: 'X', direccionEstablecimiento: 'X', telefono: '0000-0001', correo: 'x@ejemplo.example' },
  lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '100' }],
}, { almacen, establecimiento: '000', puntoEmision: '001' });
const { renderizarPDF } = await import(pathToFileURL(`${raiz}packages/pdf/dist/index.js`).href);
const pdf = await renderizarPDF(doc);
if (doc.totales.total !== 115 || pdf.length < 1000) fallo('emisión o PDF desde dist');
else console.log(`ok  emisión CJS + PDF ESM (${doc.numero}, ${pdf.length} bytes)`);
process.exit(fallas ? 1 : 0);
