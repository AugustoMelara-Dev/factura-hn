/**
 * La medición de carga (`pnpm carga`) cuenta documentos y avisos de webhook en la misma foto de la base. Al vencer
 * su tiempo, autocannon suelta las solicitudes en vuelo y la API las termina después: esas emisiones (y sus avisos)
 * llegan a la base cuando el generador ya terminó. Antes, la revisión contaba los documentos en ese instante y los
 * avisos más tarde: «6037 avisos para 6021 documentos» sin que hubiera avisos de más.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { esperarQuietud, revisarAvisos, revisarIntegridad } from '../carga/integridad';
import { cerrarPool, tenantListo, URL_PG, venta } from './ayuda';

describe.skipIf(!URL_PG)('medición de carga: documentos y avisos', () => {
  afterAll(cerrarPool);

  it('una emisión que termina después de que el cliente se fue entra en la revisión, con su aviso', async () => {
    const { admin, tenant, pool } = await tenantListo();
    expect((await admin('POST', '/v1/webhooks', { url: 'https://ejemplo.example/hook', eventos: ['documento.emitido'] })).status).toBe(201);
    expect((await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() })).status).toBe(201);

    // La serie bloqueada deja la segunda emisión en vuelo; se suelta poco después, como la API que termina una
    // solicitud que el generador ya abandonó.
    const bloqueo = await pool.connect();
    await bloqueo.query('BEGIN');
    await bloqueo.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
    await bloqueo.query('SELECT 1 FROM fhn_series WHERE tenant = $1 FOR UPDATE', [tenant]);
    const enVuelo = admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    const soltar = new Promise<void>((r) => setTimeout(() => void bloqueo.query('COMMIT').finally(() => { bloqueo.release(); r(); }), 700));

    await esperarQuietud(pool, tenant);
    const integridad = await revisarIntegridad(pool, tenant);
    const avisos = await revisarAvisos(pool, tenant);
    await soltar;
    expect((await enVuelo).status).toBe(201);

    expect(integridad.documentos).toBe(2);
    expect(avisos).toMatchObject({ documentos: 2, avisos: 2, documentosSinAviso: 0, avisosSinDocumento: 0, documentosConVariosAvisos: 0 });
  });
});
