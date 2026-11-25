// Verificación de lo que se publica. Correr después de `pnpm build` (`pnpm verificar:dist` hace ambas cosas).
//
// 1. Cada paquete publicable se empaqueta como lo haría `pnpm publish` (corre `prepack`) y se revisa el tarball:
//    están los archivos que nombran main/module/types/exports/bin, README y LICENSE; no van fuentes ni pruebas;
//    de `docs/` solo van los de DOCS_PUBLICOS; `workspace:` se reemplazó por versiones; repository.url es
//    exactamente el repositorio de GitHub y repository.directory apunta al paquete (los exige la publicación de
//    confianza de npm). Ningún .md ni llms.txt del tarball enlaza con ruta relativa a algo que no viaja en él.
// 2. Cada entrada carga por import (ESM) y, si la tiene, por require (CJS), con las mismas exportaciones, entre
//    ellas `factura-hn/demo` y las exportaciones que la documentación promete.
// 3. Los ejecutables (`factura-hn`, `factura-hn-mcp`) existen y arrancan.
// 4. El núcleo compilado emite un documento (también uno de prueba, con la leyenda) y el PDF compilado lo imprime.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { enlacesRotos } from './enlaces.mjs';
import { DOCS_PUBLICOS, PUBLICABLES, REPOSITORIO } from './paquetes.mjs';

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

/**
 * Enlaces rotos conocidos que solo avisan, sin fallar: paquete → documento → destinos exactos. Uno roto que no
 * esté aquí hace fallar la verificación. Vacía: los documentos publicados enlazan el resto del repositorio con
 * URL absoluta.
 */
const ENLACES_PENDIENTES = {};

// Primero, las pruebas del revisor de enlaces.
try {
  execFileSync(process.execPath, ['--test', join(raiz, 'scripts', 'enlaces.test.mjs')], { stdio: 'pipe' });
  console.log('ok  pruebas de enlaces.mjs');
} catch (e) {
  fallo(`pruebas de enlaces.mjs:
${e.stdout ?? ''}${e.stderr ?? ''}`);
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
    // Solo los documentos públicos: nada interno (análisis, planes, avance, lanzamiento, modelo de negocio).
    const docsInternos = archivos.filter((f) => f.startsWith('docs/') && !DOCS_PUBLICOS.includes(f.slice('docs/'.length)));
    if (docsInternos.length) fallo(`${j.name}: documentos internos en el paquete: ${docsInternos.join(', ')}`);
    // Ni referencias a ellos: decisiones (DEC-xxx), pendientes de la matriz interna (B-xx, P-xx, D-xx) ni sus archivos.
    const INTERNO = /\bDEC-\d{3}\b|\[REVISAR\]|\b[BPD]-\d{2}\b|(?:decisiones|investigacion|consulta-sar|plan-v1|lanzamiento|avance|modelo-de-negocio)\.md|docs\/analisis/;
    for (const [nombre, bytes] of contenido) {
      if (!/\.(md|txt|d\.c?ts|c?js|json)$/.test(nombre)) continue;
      const linea = bytes.toString('utf8').split('\n').findIndex((l) => INTERNO.test(l));
      if (linea >= 0) fallo(`${j.name}: referencia interna en ${nombre.replace(/^package\//, '')}:${linea + 1}`);
    }
    const enPaquete = new Map([...contenido].map(([f, b]) => [f.replace(/^package\//, ''), b]));
    const rotos = enlacesRotos(enPaquete);
    for (const [doc, destino] of rotos) {
      const texto = `${j.name}: ${doc} enlaza a «${destino}», que no está en el paquete (usa una URL absoluta)`;
      if (ENLACES_PENDIENTES[j.name]?.[doc]?.includes(destino)) console.warn(`AVISO ${texto}`);
      else fallo(texto);
    }
    for (const [doc, destinos] of Object.entries(ENLACES_PENDIENTES[j.name] ?? {})) {
      for (const d of destinos) {
        if (!rotos.some(([x, y]) => x === doc && y === d)) console.warn(`AVISO ${j.name}: ${doc} ya no tiene «${d}» roto: quítalo de ENLACES_PENDIENTES`);
      }
    }
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

const entradas = { core: ['index', 'pruebas', 'demo'], sqlite: ['index'], postgres: ['index'], pdf: ['index'], cliente: ['index'], mcp: ['index'] };
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

// Las exportaciones que la documentación promete, en ESM y CJS (las de modo de prueba, reportes y la fachada).
const PROMETIDAS = {
  'core/index': [
    'crearFacturador', 'emitir', 'anular', 'registrarAutorizacion', 'libroVentas', 'filaLibroVentas', 'resumenVentas',
    'exportarTexto', 'separarDocumentosDePrueba', 'esDocumentoDePrueba', 'esAutorizacionDePrueba', 'esCAIDemo',
    'LEYENDA_PRUEBA', 'esErrorValidacion', 'ErrorValidacion',
  ],
  'core/demo': ['crearFacturadorDemo', 'autorizacionDemo', 'caiDemo', 'EMISOR_DEMO', 'LEYENDA_PRUEBA', 'esCAIDemo', 'PREFIJO_CAI_DEMO'],
};
for (const [entrada, nombres] of Object.entries(PROMETIDAS)) {
  const [p, e] = entrada.split('/');
  const base = `${raiz}packages/${p}/dist/${e}`;
  const esm = await import(pathToFileURL(`${base}.js`).href);
  const cjs = require(`${base}.cjs`);
  const faltan = nombres.filter((n) => !(n in esm) || !(n in cjs));
  if (faltan.length) fallo(`${entrada}: faltan ${faltan.join(', ')}`);
  else console.log(`ok  ${entrada}: ${nombres.length} exportaciones de la documentación`);
}
// La demo compilada emite un documento de prueba con la leyenda.
{
  const { crearFacturadorDemo, LEYENDA_PRUEBA } = require(`${raiz}packages/core/dist/demo.cjs`);
  const { renderizarHTML } = require(`${raiz}packages/core/dist/index.cjs`);
  const f = await crearFacturadorDemo();
  const d = await f.emitir({ lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '10.00' }] });
  if (d.modo !== 'prueba' || !renderizarHTML(d).includes(LEYENDA_PRUEBA)) fallo('core/demo: el documento no sale de prueba o sin la leyenda');
  else console.log(`ok  core/demo emite de prueba (${d.numero})`);
}

// Los ejecutables (`bin`) existen y arrancan.
const BINARIOS = [
  { paquete: 'core', nombre: 'factura-hn', args: ['--version'], espera: /^\d+\.\d+\.\d+/ },
  { paquete: 'mcp', nombre: 'factura-hn-mcp', args: ['ayuda'], espera: /init/ },
];
for (const b of BINARIOS) {
  const j = JSON.parse(readFileSync(join(raiz, 'packages', b.paquete, 'package.json'), 'utf8'));
  const ruta = j.bin?.[b.nombre];
  if (!ruta) {
    fallo(`${j.name}: falta bin «${b.nombre}»`);
    continue;
  }
  const archivo = join(raiz, 'packages', b.paquete, ruta);
  try {
    if (!readFileSync(archivo, 'utf8').startsWith('#!/usr/bin/env node')) throw new Error('sin «#!/usr/bin/env node» en la primera línea');
    const salida = execFileSync(process.execPath, [archivo, ...b.args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
    if (!b.espera.test(salida.trim())) throw new Error(`salida inesperada: ${salida.trim().slice(0, 200)}`);
    console.log(`ok  bin ${b.nombre} ${b.args.join(' ')}`);
  } catch (e) {
    fallo(`bin ${b.nombre}: ${e.message}`);
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
