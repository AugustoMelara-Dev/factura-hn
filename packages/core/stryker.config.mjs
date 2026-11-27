// Pruebas de mutación del núcleo (cálculo, dinero, numeración y validación).
// Uso: pnpm mutacion (desde la raíz) o pnpm --filter factura-hn mutacion.
import { availableParallelism } from 'node:os';

// Igual que el CI (TZ=UTC): las fechas fiscales salen de America/Tegucigalpa, no de la zona del equipo, y así una
// prueba de zona horaria mata los mismos mutantes en cualquier máquina.
process.env.TZ = 'UTC';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutacion.config.ts' },
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: [
    'src/calculo.ts',
    'src/dinero.ts',
    'src/letras.ts',
    'src/numeracion.ts',
    'src/documento.ts',
    'src/autorizacion.ts',
    'src/identificacion.ts',
    'src/modo.ts',
  ],
  coverageAnalysis: 'perTest',
  // Un proceso de vitest por núcleo, dejando uno libre: 3 en el runner de GitHub (4 vCPU), hasta 8 en un equipo grande.
  concurrency: Math.max(1, Math.min(8, availableParallelism() - 1)),
  timeoutMS: 20000,
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutacion/index.html' },
  jsonReporter: { fileName: 'reports/mutacion/mutacion.json' },
  // break: el puntaje global no puede bajar de 85 %. scripts/umbral-mutacion.mjs exige además 85 % en cada módulo.
  thresholds: { high: 90, low: 85, break: 85 },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};
