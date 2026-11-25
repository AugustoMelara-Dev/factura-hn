#!/usr/bin/env node
/**
 * Medición del Lote 5, rama «propiedades»: propiedades del núcleo (fast-check), contrato OpenAPI de las respuestas
 * de la API y fuzzing. Imprime los números de `docs/calidad/propiedades.md`.
 *
 * - Núcleo: corre `packages/core/test/propiedades` y cuenta propiedades y casos (`FHN_PROP_INFORME`).
 * - API (con `FHN_PG_URL`): corre todas las pruebas de la API con el validador del contrato y cuenta las respuestas
 *   validadas, las combinaciones operación + estado de `openapi.json` que aparecieron, las violaciones y los casos
 *   del fuzz (`FHN_CONTRATO_INFORME`). Sin `FHN_PG_URL`, solo las pruebas que no usan la base.
 *
 * Variables: `FHN_PROP_CORRIDAS` (casos por propiedad, 200 por omisión), `FHN_FUZZ_CASOS` (casos del fuzz de la API,
 * 300 por omisión) y `FHN_PROP_SEMILLA`. El flujo nocturno sube las dos primeras a 20 000.
 *
 * Uso: FHN_PG_URL=postgres://… pnpm calidad:propiedades
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'fhn-propiedades-'));
const informeProp = join(dir, 'propiedades.jsonl');
const informeContrato = join(dir, 'contrato.jsonl');
const leer = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function correr(filtro, args, env) {
  const inicio = Date.now();
  const r = spawnSync('pnpm', ['--filter', filtro, 'exec', 'vitest', 'run', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  return { ok: r.status === 0, segundos: Math.round((Date.now() - inicio) / 100) / 10 };
}

const nucleo = correr('factura-hn', ['test/propiedades'], { FHN_PROP_INFORME: informeProp });
const api = correr('@factura-hn/api', [], { FHN_CONTRATO_INFORME: informeContrato });

const props = leer(informeProp);
const respuestas = leer(informeContrato);
const spec = JSON.parse(readFileSync('packages/api/openapi.json', 'utf8'));
const combinaciones = Object.entries(spec.paths).flatMap(([p, item]) =>
  Object.entries(item).flatMap(([m, op]) => Object.keys(op.responses).map((e) => `${m.toUpperCase()} ${p} ${e}`)),
);
const vistas = new Set(respuestas.map((r) => r.clave));
// Las del fuzz (incluye las ~30 solicitudes con que prepara el tenant), no las de hallazgos-fuzz.test.ts.
const deFuzz = respuestas.filter((r) => /[\\/]fuzz\.test\.ts$/.test(r.archivo));
const violaciones = respuestas.filter((r) => r.violaciones.length);

const resumen = {
  fecha: new Date().toISOString().slice(0, 10),
  nucleo: {
    ok: nucleo.ok,
    segundos: nucleo.segundos,
    propiedades: new Set(props.map((p) => p.prueba)).size,
    afirmaciones: props.length,
    casos: props.reduce((s, p) => s + p.casos, 0),
    fallos: props.filter((p) => p.fallo).length,
  },
  api: {
    ok: api.ok,
    segundos: api.segundos,
    conBase: Boolean(process.env.FHN_PG_URL),
    respuestasValidadas: respuestas.length,
    deLasPruebas: respuestas.length - deFuzz.length,
    casosDeFuzz: deFuzz.length,
    violaciones: violaciones.length,
    combinacionesEspecificacion: combinaciones.length,
    combinacionesVistas: combinaciones.filter((c) => vistas.has(c)).length,
    operaciones: new Set(Object.entries(spec.paths).flatMap(([p, item]) => Object.keys(item).map((m) => `${m} ${p}`))).size,
    operacionesVistas: new Set(respuestas.filter((r) => r.operacion).map((r) => r.operacion)).size,
  },
};

console.log('\n== Propiedades, contrato OpenAPI y fuzzing ==');
console.log(JSON.stringify(resumen, null, 2));
if (violaciones.length) {
  console.log('\nViolaciones del contrato:');
  for (const v of violaciones.slice(0, 20)) console.log(`- ${v.archivo}: ${v.violaciones.join('; ')}`);
}
rmSync(dir, { recursive: true, force: true });
process.exit(nucleo.ok && api.ok && violaciones.length === 0 ? 0 : 1);
