/**
 * Contrato OpenAPI en todas las pruebas de la API: cada app de `crearApp` (también la que arma `arrancar`) valida
 * cada respuesta contra `openapi.json` con `./openapi-validador`. Una respuesta fuera de la especificación hace
 * fallar la solicitud, y con ella la prueba.
 *
 * - `FHN_CONTRATO=registrar`: no falla; solo anota (para ver todas las diferencias de una vez).
 * - `FHN_CONTRATO_INFORME=<archivo>`: agrega una línea JSON por respuesta validada (lo usa `pnpm calidad:propiedades`).
 */
import { appendFileSync } from 'node:fs';
import { afterAll, expect, vi } from 'vitest';
import { validarRespuesta, type Resultado } from './openapi-validador';

const registrar = process.env.FHN_CONTRATO === 'registrar';
const informe = process.env.FHN_CONTRATO_INFORME;
const resultados: Resultado[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type App = { fetch: (req: Request, ...resto: any[]) => Response | Promise<Response> };

/** Envuelve `fetch` de la app: `request` (las pruebas) y el servidor de node pasan por él. */
export function conContrato<T extends App>(app: T): T {
  const original = app.fetch;
  app.fetch = async (req: Request, ...resto: any[]) => {
    const r = await original(req, ...resto);
    const resultado = await validarRespuesta(req.method, req.url, r);
    resultados.push(resultado);
    if (resultado.violaciones.length && !registrar) {
      throw new Error(`Respuesta fuera del contrato OpenAPI (${req.method} ${new URL(req.url).pathname}):\n- ${resultado.violaciones.join('\n- ')}`);
    }
    return r;
  };
  return app;
}

vi.mock('../src/app', async (importar) => {
  const original = await importar<typeof import('../src/app')>();
  return { ...original, crearApp: (...args: Parameters<typeof original.crearApp>) => conContrato(original.crearApp(...args)) };
});

afterAll(() => {
  if (informe) {
    const archivo = expect.getState().testPath ?? '';
    appendFileSync(informe, resultados.map((r) => JSON.stringify({ archivo, ...r }) + '\n').join(''));
  }
});
