/**
 * Lo que encontraron el contrato OpenAPI en las pruebas y el fuzzing del Lote 5 en la API, con su caso fijo. Cada
 * respuesta pasa además por el validador del contrato (setup-contrato.ts).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cerrarPool, tenantListo, URL_PG, venta } from './ayuda';
import { SPEC } from './openapi-validador';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

describe('especificación (openapi.json)', () => {
  it('declara el 415 en cada operación con cuerpo JSON, y FacturaHN-Modo en los 429 de /v1', () => {
    for (const [ruta, item] of Object.entries(SPEC.paths)) {
      for (const [metodo, op] of Object.entries(item as Record<string, { requestBody?: unknown; responses: Record<string, { headers?: Record<string, unknown> }> }>)) {
        expect(Boolean(op.responses['415']), `${metodo} ${ruta}`).toBe(Boolean(op.requestBody));
        if (ruta.startsWith('/v1/') && op.responses['429']) expect(Object.keys(op.responses['429'].headers ?? {}), `${metodo} ${ruta}`).toContain('FacturaHN-Modo');
      }
    }
  });

  it('emitirDocumento declara Idempotency-Replayed; exportarPeriodo, los tres tipos de archivo; obtenerLibroVentas, el 403', () => {
    const paths = SPEC.paths as unknown as Record<string, Record<string, { responses: Record<string, { headers?: Record<string, unknown>; content?: Record<string, unknown> }> }>>;
    expect(Object.keys(paths['/v1/documentos']!.post!.responses['201']!.headers!)).toContain('Idempotency-Replayed');
    expect(Object.keys(paths['/v1/exportacion']!.get!.responses['200']!.content!).sort()).toEqual(['application/x-ndjson', 'text/csv', 'text/plain']);
    expect(paths['/v1/libro-ventas']!.get!.responses['403']).toBeDefined();
  });
});

conBase('hallazgos del fuzzing', () => {
  let t: Awaited<ReturnType<typeof tenantListo>>;
  beforeAll(async () => {
    t = await tenantListo();
  });

  it('un cuerpo sin Content-Type: application/json es 415 TIPO_DE_CONTENIDO con la forma de error (antes, texto plano)', async () => {
    for (const tipo of ['text/plain', 'application/x-www-form-urlencoded']) {
      const r = await t.app.request('/v1/emisores', { method: 'POST', headers: { authorization: `Bearer ${t.llaveAdmin}`, 'content-type': tipo }, body: '{}' });
      expect(r.status).toBe(415);
      const cuerpo = (await r.json()) as { error: { codigo: string; solucion?: string; solicitud?: string } };
      expect(cuerpo.error).toMatchObject({ codigo: 'TIPO_DE_CONTENIDO', solicitud: r.headers.get('solicitud-id') });
      expect(cuerpo.error.solucion).toContain('Content-Type: application/json');
    }
  });

  it('una fecha que no existe en un período es 400, no 500', async () => {
    for (const ruta of ['/v1/exportacion?desde=2026-01-01&hasta=2026-02-30', '/v1/libro-ventas?desde=2026-02-30&hasta=2026-03-01', '/v1/documentos?desde=2026-13-01&hasta=2026-12-31']) {
      const r = await t.admin('GET', ruta);
      expect(r.status, ruta).toBe(400);
      expect(((await r.json()) as { error: { codigo: string } }).error.codigo).toBe('SOLICITUD_INVALIDA');
    }
  });

  it('un CAI con NUL en la ruta es 404, no 500', async () => {
    const r = await t.admin('GET', '/v1/autorizaciones/%00/estado');
    expect(r.status).toBe(404);
  });

  it('un total por encima del tope es 422 MONTO_FUERA_DE_RANGO y no consume número (antes, 500 por un RangeError)', async () => {
    const r = await t.admin('POST', '/v1/documentos', venta('1000', { documento: { lineas: [{ descripcion: 'x', cantidad: '99999999999999999999', precioUnitario: '1000' }] } }), { 'idempotency-key': randomUUID() });
    expect(r.status).toBe(422);
    const cuerpo = (await r.json()) as { errores: Array<{ codigo: string }> };
    expect(cuerpo.errores.map((e) => e.codigo)).toEqual(['MONTO_FUERA_DE_RANGO']);
    const ok = await t.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    expect(((await ok.json()) as { documento: { correlativo: number } }).documento.correlativo).toBe(1);
  });
});
