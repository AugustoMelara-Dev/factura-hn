// Medición OWASP API Security Top 10 (2023) de @factura-hn/api: corre packages/api/test/owasp contra Postgres
// (FHN_PG_URL) y resume, por riesgo, cuántas pruebas pasan. Sale con error si alguna falla o se omite,
// o si un riesgo queda sin pruebas.
//
//   FHN_PG_URL=postgres://postgres@127.0.0.1:54329/factura_hn_pruebas pnpm calidad:owasp
//
// El resumen sale en la consola; no se escribe en el repositorio.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.FHN_PG_URL) {
  console.error('Define FHN_PG_URL con una base de Postgres de pruebas (p. ej. postgres://postgres@127.0.0.1:54329/factura_hn_pruebas).');
  process.exit(1);
}

const RIESGOS = {
  api1: 'API1 Autorización a nivel de objeto (BOLA)',
  api2: 'API2 Autenticación',
  api3: 'API3 Autorización a nivel de propiedad',
  api4: 'API4 Consumo de recursos',
  api5: 'API5 Autorización a nivel de función',
  api6: 'API6 Flujos de negocio sensibles',
  api7: 'API7 SSRF',
  api8: 'API8 Configuración',
  api9: 'API9 Inventario',
  api10: 'API10 Consumo de APIs de terceros',
};

const dir = mkdtempSync(join(tmpdir(), 'fhn-owasp-'));
const salida = join(dir, 'owasp.json');
const inicio = Date.now();
spawnSync('pnpm', ['--filter', '@factura-hn/api', 'exec', 'vitest', 'run', 'test/owasp', '--reporter=json', `--outputFile=${salida}`], {
  stdio: ['ignore', 'ignore', 'inherit'],
  shell: process.platform === 'win32',
});
let informe;
try {
  informe = JSON.parse(readFileSync(salida, 'utf8'));
} catch {
  console.error('Vitest no dejó el informe JSON: revisa los errores de arriba.');
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const filas = Object.entries(RIESGOS).map(([clave, nombre]) => {
  const archivos = informe.testResults.filter((f) => new RegExp(`[\\\\/]${clave}-[^\\\\/]+\\.test\\.ts$`).test(f.name));
  const pruebas = archivos.flatMap((f) => f.assertionResults);
  const cuenta = (estado) => pruebas.filter((p) => p.status === estado).length;
  return { nombre, pasan: cuenta('passed'), fallan: cuenta('failed'), omitidas: pruebas.length - cuenta('passed') - cuenta('failed') };
});

const ancho = Math.max(...filas.map((f) => f.nombre.length));
console.log(`\n${'Riesgo'.padEnd(ancho)}  Pasan  Fallan  Omitidas`);
for (const f of filas) console.log(`${f.nombre.padEnd(ancho)}  ${String(f.pasan).padStart(5)}  ${String(f.fallan).padStart(6)}  ${String(f.omitidas).padStart(8)}`);
const total = filas.reduce((a, f) => ({ pasan: a.pasan + f.pasan, fallan: a.fallan + f.fallan, omitidas: a.omitidas + f.omitidas }), { pasan: 0, fallan: 0, omitidas: 0 });
// Un riesgo con una prueba omitida no cuenta como cubierto: una omitida no prueba nada de su control.
const cubiertos = filas.filter((f) => f.pasan > 0 && f.fallan === 0 && f.omitidas === 0).length;
console.log(`\nRiesgos cubiertos sin fallas: ${cubiertos}/10 · pruebas: ${total.pasan} pasan, ${total.fallan} fallan, ${total.omitidas} omitidas · ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
process.exit(cubiertos === 10 ? 0 : 1);
