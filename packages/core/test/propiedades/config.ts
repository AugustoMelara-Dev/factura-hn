/**
 * Configuración común de las pruebas de propiedades (fast-check).
 *
 * - `FHN_PROP_CORRIDAS`: casos por propiedad. 200 en el CI; el flujo nocturno sube a 20 000.
 * - `FHN_PROP_SEMILLA`: semilla fija para reproducir un fallo. fast-check imprime la semilla y el `path` del
 *   contraejemplo al fallar; con la semilla basta para volver a correr la misma secuencia.
 * - `FHN_PROP_INFORME=<archivo>`: agrega una línea JSON por `fc.assert` (casos corridos, semilla, resultado). Lo usa
 *   `pnpm calidad:propiedades` para contar propiedades y casos.
 *
 * Las propiedades con emisión (almacén en memoria) son más lentas: usan `corridas(0.1)`.
 */
import { appendFileSync } from 'node:fs';
import fc from 'fast-check';
import { expect } from 'vitest';

export const CORRIDAS = Math.max(1, Number(process.env.FHN_PROP_CORRIDAS ?? 200));
const semilla = process.env.FHN_PROP_SEMILLA;
const informe = process.env.FHN_PROP_INFORME;

/** Anota la corrida y, si falló, lanza el mismo mensaje que fast-check (contraejemplo, semilla y `path`). */
function reportar(d: fc.RunDetails<unknown>): void {
  if (informe) {
    const prueba = expect.getState().currentTestName ?? '';
    appendFileSync(informe, JSON.stringify({ prueba, casos: d.numRuns, saltados: d.numSkips, semilla: d.seed, fallo: d.failed }) + '\n');
  }
  if (d.failed) throw Object.assign(new Error(fc.defaultReportMessage(d)), { cause: d.errorInstance });
}

fc.configureGlobal({
  numRuns: CORRIDAS,
  ...(semilla ? { seed: Number(semilla) } : {}),
  // También para las propiedades asíncronas: fast-check usa `reporter` si no hay `asyncReporter`.
  reporter: reportar,
});

/** Casos para una propiedad cara: una fracción de `CORRIDAS`, al menos 10. */
export const corridas = (fraccion: number) => Math.max(10, Math.round(CORRIDAS * fraccion));

/** Tiempo máximo de una prueba de propiedades: crece con los casos. */
export const TIEMPO = Math.max(30_000, CORRIDAS * 30);

export { fc };
