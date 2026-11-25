/**
 * OWASP API9:2023 · Improper Inventory Management.
 *
 * Cómo aplica: una sola versión publicada (`/v1`), documentada en `/openapi.json` (que genera los clientes) y en
 * `packages/api/openapi.json` (versionado). Una ruta que existe en el servidor y no en la especificación es una
 * puerta que nadie revisa; una operación de la especificación que no está en el catálogo de estas pruebas es una
 * ruta sin pruebas de BOLA, autenticación ni roles.
 *
 * Ataque: comparar lo que el servidor atiende con lo que publica; buscar versiones viejas o rutas alternativas.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { crearApp, VERSION_API } from '../../src/app';
import { ROL } from '../ayuda';
import { operaciones } from './comun';

type Spec = { info: { version: string }; paths: Record<string, Record<string, { operationId: string; security?: unknown[]; responses: Record<string, unknown> }>> };

// Sin base: la especificación y la tabla de rutas no consultan Postgres.
const app = crearApp({ pool: { options: { max: 4 } } as unknown as pg.Pool, modo: 'local', rol: ROL });
const vivo = (await (await app.request('/openapi.json')).json()) as Spec;
const versionado = JSON.parse(readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8')) as Spec;

const opsDe = (s: Spec) =>
  Object.entries(s.paths).flatMap(([ruta, ops]) => Object.entries(ops).map(([metodo, op]) => ({ clave: `${metodo.toUpperCase()} ${ruta}`, ...op })));
/** Las rutas que el servidor atiende, en la forma de la especificación (`{param}`), sin los middleware. */
const rutasServidor = () =>
  [...new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, '{$1}')}`))].sort();

describe('API9 · inventario de rutas y versiones', () => {
  it('el servidor atiende exactamente lo que publica la especificación, más /openapi.json, /docs y /', () => {
    const publicadas = opsDe(vivo).map((o) => o.clave);
    expect(rutasServidor()).toEqual([...publicadas, 'GET /openapi.json', 'GET /docs', 'GET /'].sort());
  });

  it('los middleware (método ALL) son exactamente los conocidos: un manejador con app.all() no se cuela sin documentar', () => {
    // Por orden de registro: id de solicitud y cabeceras comunes (*), CORS de la demo (/v1/demo/*), límite del cuerpo,
    // autenticación y UTF-8 (/v1/*),
    // y los cupos de los tres reportes. Cualquier otro ALL es una ruta que atiende todos los métodos fuera de la especificación.
    expect(app.routes.filter((r) => r.method === 'ALL').map((r) => r.path)).toEqual([
      '/*', '/*', '/v1/demo/*', '/v1/*', '/v1/*', '/v1/*', '/v1/libro-ventas', '/v1/exportacion', '/v1/series/:identificador/no-utilizados',
    ]);
  });

  it('la especificación versionada (packages/api/openapi.json) tiene las mismas operaciones y versión que la servida', () => {
    expect(opsDe(versionado).map((o) => `${o.clave} ${o.operationId}`).sort()).toEqual(opsDe(vivo).map((o) => `${o.clave} ${o.operationId}`).sort());
    expect(versionado.info.version).toBe(vivo.info.version);
    expect(vivo.info.version).toBe(VERSION_API);
  });

  it('el catálogo de las pruebas OWASP cubre todas las operaciones: una ruta nueva no queda sin probar', () => {
    const catalogo = operaciones({ emisorId: 'e', numero: '000-001-01-00000001', cai: 'c', webhookId: 'w', entregaId: 'x', prefijoCaja: 'p' });
    // Más las públicas: /salud y la demo (ver demo.test.ts, con sus límites, CORS y aislamiento).
    const publicas = ['GET /salud obtenerSalud', 'POST /v1/demo/entornos crearEntornoDemo', 'OPTIONS /v1/demo/entornos preflightEntornoDemo'];
    expect([...catalogo.map((o) => `${o.metodo} ${o.plantilla} ${o.operationId}`), ...publicas].sort()).toEqual(
      opsDe(vivo).map((o) => `${o.clave} ${o.operationId}`).sort(),
    );
  });

  it('solo /salud y la creación de entornos de la demo son públicas; todas las demás piden la llave y declaran 401', () => {
    for (const o of opsDe(vivo)) {
      if (['obtenerSalud', 'crearEntornoDemo', 'preflightEntornoDemo'].includes(o.operationId)) {
        expect(o.security).toEqual([]);
        continue;
      }
      expect(o.clave.startsWith('GET /v1/') || / \/v1\//.test(o.clave), o.clave).toBe(true);
      expect(o.security, o.clave).toEqual([{ llave: [] }]);
      expect(o.responses['401'], o.clave).toBeDefined();
    }
  });

  it('no hay otras versiones ni prefijos alternativos: 404 JSON con la versión actual en la cabecera', async () => {
    for (const ruta of ['/v0/sesion', '/v2/sesion', '/api/v1/sesion', '/V1/sesion', '/v1.0/sesion', '/beta/sesion', '/internal/salud', '/admin', '/metrics', '/debug', '/.env', '/swagger.json', '/v1']) {
      const r = await app.request(ruta);
      // /v1 sin ruta pide la llave (todo /v1/* está detrás de la autenticación); lo demás no existe.
      expect([401, 404], ruta).toContain(r.status);
      expect(r.headers.get('content-type'), ruta).toContain('application/json');
      expect(r.headers.get('facturahn-version'), ruta).toBe(VERSION_API);
    }
  });
});
