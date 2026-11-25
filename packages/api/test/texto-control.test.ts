/**
 * Lote 4: un NUL (u otro carácter de control) en un texto de la venta llegaba a Postgres y el listado de documentos
 * respondía 500 (`datos::jsonb - 'lineas'`). Ahora el núcleo lo rechaza con 422 `TEXTO_CARACTER_NO_PERMITIDO`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { cerrarPool, tenantListo, URL_PG, venta } from './ayuda';

afterAll(cerrarPool);
const json = async (r: Response) => (await r.json()) as Record<string, any>;

describe.skipIf(!URL_PG)('TEXTO_CARACTER_NO_PERMITIDO en la API', () => {
  it('422 con campo y solución, sin consumir número; el listado sigue respondiendo', async () => {
    const { admin } = await tenantListo();
    for (const malo of ['Martillo\u0000', 'Martillo\u001b', 'Martillo\ud800']) {
      const cuerpo = venta('10.00', { documento: { lineas: [{ descripcion: malo, cantidad: 1, precioUnitario: '10.00' }] } });
      const r = await admin('POST', '/v1/documentos', cuerpo, { 'idempotency-key': randomUUID() });
      const j = await json(r);
      expect([r.status, j.errores?.[0]?.codigo, j.errores?.[0]?.campo]).toEqual([422, 'TEXTO_CARACTER_NO_PERMITIDO', 'lineas[0].descripcion']);
      expect(j.errores[0].solucion).toMatch(/tabulador/);
    }
    const ok = await json(await admin('POST', '/v1/documentos', venta('10.00'), { 'idempotency-key': randomUUID() }));
    expect(ok.documento.correlativo).toBe(1);
    const hoy = ok.documento.fechaEmision as string;
    const lista = await admin('GET', `/v1/documentos?desde=${hoy}&hasta=${hoy}`);
    expect(lista.status).toBe(200);
    expect((await json(lista)).documentos.map((d: { numero: string }) => d.numero)).toEqual([ok.documento.numero]);
  });
});
