// Prueba de humo de los paquetes compilados: cada uno carga por import (ESM) y por require (CJS), y el
// núcleo emite un documento. Correr después de `pnpm build`.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const paquetes = { core: ['index', 'pruebas'], sqlite: ['index'], postgres: ['index'], pdf: ['index'] };
let fallas = 0;

for (const [p, entradas] of Object.entries(paquetes)) {
  for (const e of entradas) {
    const base = `${raiz}packages/${p}/dist/${e}`;
    try {
      const esm = await import(pathToFileURL(`${base}.js`).href);
      const cjs = require(`${base}.cjs`);
      const a = Object.keys(esm).sort().join(',');
      const b = Object.keys(cjs).sort().join(',');
      if (a !== b) throw new Error(`exportaciones distintas ESM/CJS:\n  ${a}\n  ${b}`);
      console.log(`ok  ${p}/${e} (${Object.keys(esm).length} exportaciones)`);
    } catch (err) {
      fallas++;
      console.error(`ERR ${p}/${e}: ${err.message}`);
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
  emisor: { rtn: '08011999123456', razonSocial: 'X', nombreComercial: 'X', direccionCasaMatriz: 'X', direccionEstablecimiento: 'X', telefono: '2444-0000', correo: 'x@x.hn' },
  lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '100' }],
}, { almacen, establecimiento: '000', puntoEmision: '001' });
const { renderizarPDF } = await import(pathToFileURL(`${raiz}packages/pdf/dist/index.js`).href);
const pdf = await renderizarPDF(doc);
if (doc.totales.total !== 115 || pdf.length < 1000) { fallas++; console.error('ERR emisión o PDF desde dist'); }
else console.log(`ok  emisión CJS + PDF ESM (${doc.numero}, ${pdf.length} bytes)`);
process.exit(fallas ? 1 : 0);
