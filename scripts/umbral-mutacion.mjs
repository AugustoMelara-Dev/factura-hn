#!/usr/bin/env node
// Puntaje de mutación por módulo a partir del informe JSON de Stryker (packages/core/reports/mutacion/mutacion.json).
// `thresholds.break` de Stryker mira el puntaje global; este script exige el mínimo en **cada** módulo.
// Uso: node scripts/umbral-mutacion.mjs [informe.json] [--minimo 85]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const iMin = args.indexOf('--minimo');
const minimo = iMin >= 0 ? Number(args[iMin + 1]) : 85;
const ruta = args.find((a, i) => !a.startsWith('--') && i !== iMin + 1) ?? join(raiz, 'packages/core/reports/mutacion/mutacion.json');

const informe = JSON.parse(readFileSync(ruta, 'utf8'));
const filas = [];
const total = { muertos: 0, sobrevivientes: 0, sinCobertura: 0, excluidos: 0 };
for (const [archivo, { mutants }] of Object.entries(informe.files)) {
  const c = { muertos: 0, sobrevivientes: 0, sinCobertura: 0, excluidos: 0 };
  for (const m of mutants) {
    if (m.status === 'Killed' || m.status === 'Timeout') c.muertos++;
    else if (m.status === 'Survived') c.sobrevivientes++;
    else if (m.status === 'NoCoverage') c.sinCobertura++;
    else if (m.status === 'Ignored') c.excluidos++;
  }
  for (const k of Object.keys(total)) total[k] += c[k];
  const validos = c.muertos + c.sobrevivientes + c.sinCobertura;
  filas.push({ archivo, ...c, puntaje: validos ? (100 * c.muertos) / validos : 100 });
}
filas.sort((a, b) => a.archivo.localeCompare(b.archivo));
const validosTotal = total.muertos + total.sobrevivientes + total.sinCobertura;
const global = validosTotal ? (100 * total.muertos) / validosTotal : 100;

console.log('| Módulo | Muertos | Sobreviven | Sin cobertura | Excluidos | Puntaje |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const f of filas) {
  console.log(`| ${f.archivo} | ${f.muertos} | ${f.sobrevivientes} | ${f.sinCobertura} | ${f.excluidos} | ${f.puntaje.toFixed(2)} % |`);
}
console.log(`| **Total** | ${total.muertos} | ${total.sobrevivientes} | ${total.sinCobertura} | ${total.excluidos} | ${global.toFixed(2)} % |`);

const bajos = filas.filter((f) => f.puntaje < minimo);
if (bajos.length) {
  console.error(`\nPuntaje de mutación por debajo de ${minimo} % en: ${bajos.map((f) => `${f.archivo} (${f.puntaje.toFixed(2)} %)`).join(', ')}`);
  process.exit(1);
}
console.log(`\nTodos los módulos con puntaje ≥ ${minimo} %.`);
