/**
 * Aislamiento entre tenants: por la API y directamente en la base con el rol de la aplicación.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { cerrarPool, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const TABLAS = [
  'fhn_series', 'fhn_autorizaciones', 'fhn_documentos', 'fhn_eventos',
  'api_tenants', 'api_llaves', 'api_emisores', 'api_idempotencia', 'api_webhooks', 'api_entregas', 'api_uso', 'api_bitacora',
];

conBase('RLS: un tenant no ve ni toca los datos de otro', () => {
  it('por la API: el documento, la autorización, el emisor, la idempotencia y las llaves de A no existen para B', async () => {
    const a = await tenantListo();
    const b = await tenantListo();
    const clave = randomUUID();
    const doc = (await (await a.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': clave })).json()).documento;
    await a.admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/a', eventos: ['documento.emitido'] });

    // B emite su propio 000-001-01-00000001: mismo número, otro tenant.
    const docB = (await (await b.admin('POST', '/v1/documentos', venta('7.00'), { 'idempotency-key': clave })).json()).documento;
    expect(docB.numero).toBe(doc.numero);
    expect(docB.totales.total).not.toBe(doc.totales.total); // la clave de A no se repitió en B

    const verB = await (await b.admin('GET', `/v1/documentos/${doc.numero}`)).json();
    expect(verB.documento.totales.total).toBe(docB.totales.total);
    expect((await b.admin('GET', `/v1/autorizaciones/${encodeURIComponent(doc.cai)}/estado`)).status).toBe(404);
    expect((await b.admin('GET', `/v1/emisores/${a.emisorId}`)).status).toBe(404);
    expect((await b.admin('PATCH', `/v1/emisores/${a.emisorId}`, { telefono: '1' })).status).toBe(404);
    const llavesB = (await (await b.admin('GET', '/v1/llaves')).json()).llaves as { prefijo: string }[];
    expect(llavesB.map((l) => l.prefijo)).not.toContain(a.llaveAdmin.split('_')[1]);
    expect((await b.admin('DELETE', `/v1/llaves/${a.llaveAdmin.split('_')[1]}`)).status).toBe(404);
    expect((await (await b.admin('GET', '/v1/webhooks')).json()).webhooks).toEqual([]);
    const bit = await (await b.admin('GET', '/v1/bitacora')).json();
    expect(JSON.stringify(bit)).not.toContain(a.tenant);
    // Anular en B el número de A anula solo el de B.
    await b.admin('POST', `/v1/documentos/${doc.numero}/anular`, { motivo: 'prueba' });
    expect((await (await a.admin('GET', `/v1/documentos/${doc.numero}`)).json()).documento.estado).toBe('EMITIDO');
  });

  it('en la base, como el rol de la aplicación con el tenant B: cero filas de A en las 12 tablas y no puede escribir como A', async () => {
    const a = await tenantListo();
    await a.admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
    await a.admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/a', eventos: ['documento.emitido'] });
    const b = await tenantListo();
    const pool = await poolPrueba();

    const comoB = async <T>(fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${ROL}`);
        await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [b.tenant]);
        return await fn((sql, p) => c.query(sql, p));
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    };

    for (const t of TABLAS) {
      const filas = await comoB(async (q) => (await q(`SELECT count(*)::int AS n FROM ${t} WHERE tenant = $1`, [a.tenant])).rows[0].n);
      expect(filas, t).toBe(0);
      // Sin filtro tampoco: solo se ven las de B.
      const otras = await comoB(async (q) => (await q(`SELECT count(*)::int AS n FROM ${t} WHERE tenant <> $1`, [b.tenant])).rows[0].n);
      expect(otras, t).toBe(0);
    }

    const intentos: [string, unknown[]][] = [
      ['INSERT INTO api_bitacora (tenant, actor, accion) VALUES ($1, $2, $3)', [a.tenant, 'x', 'x']],
      ['INSERT INTO api_idempotencia (tenant, clave, huella, codigo, respuesta) VALUES ($1, $2, $3, 201, $4)', [a.tenant, 'k', 'h', '{}']],
      ['INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre) VALUES ($1, $2, $3, $4, $5)', ['abcdefabcdef', a.tenant, Buffer.alloc(32), 'admin', 'x']],
      ['INSERT INTO api_webhooks (tenant, url, secreto, eventos) VALUES ($1, $2, $3, $4)', [a.tenant, 'http://x', 'plano:x', ['documento.emitido']]],
      ["INSERT INTO fhn_series (tenant, identificador) VALUES ($1, '000-009-01')", [a.tenant]],
    ];
    for (const [sql, p] of intentos) {
      await expect(comoB((q) => q(sql, p)), sql).rejects.toThrow(/row-level security/);
    }
    // UPDATE de filas de A: no las ve, no cambia nada.
    const cambiadas = await comoB(async (q) => (await q("UPDATE fhn_documentos SET estado = 'ANULADO' WHERE tenant = $1", [a.tenant])) as unknown as { rowCount: number });
    expect(cambiadas.rowCount).toBe(0);
  });

  it('el rol de la aplicación no borra, no edita la bitácora y no reescribe el hash de una llave', async () => {
    const a = await tenantListo();
    const pool = await poolPrueba();
    const comoA = async (sql: string) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${ROL}`);
        await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [a.tenant]);
        await c.query(sql);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    };
    for (const sql of [
      'DELETE FROM api_llaves',
      'DELETE FROM api_bitacora',
      'DELETE FROM fhn_documentos',
      "UPDATE api_bitacora SET accion = 'x'",
      "UPDATE api_llaves SET hash = '\\x00'",
      "UPDATE api_llaves SET rol = 'admin'",
      "UPDATE api_tenants SET limite_mensual = NULL",
    ]) {
      await expect(comoA(sql), sql).rejects.toThrow(/permission denied|solo inserción/);
    }
  });

  it('la función de autenticación devuelve solo la llave pedida, nada de las revocadas, y sin tenant no se ve ninguna llave', async () => {
    const a = await tenantListo();
    const caja = await (await a.admin('POST', '/v1/llaves', { nombre: 'c', rol: 'caja', establecimiento: '000', puntoEmision: '001' })).json();
    await a.admin('DELETE', `/v1/llaves/${caja.prefijo}`);
    const pool = await poolPrueba();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${ROL}`);
      const prefijo = a.llaveAdmin.split('_')[1];
      const r = await c.query('SELECT tenant FROM fhn_api_autenticar($1)', [prefijo]);
      expect(r.rows).toEqual([{ tenant: a.tenant }]);
      expect((await c.query('SELECT * FROM fhn_api_autenticar($1)', [caja.prefijo])).rowCount).toBe(0);
      expect((await c.query("SELECT * FROM fhn_api_autenticar('%')")).rowCount).toBe(0);
      await expect(c.query('SELECT * FROM api_llaves')).resolves.toMatchObject({ rowCount: 0 });
      await c.query('SAVEPOINT s');
      await expect(c.query('UPDATE api_llaves SET ultimo_uso = now()')).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK TO SAVEPOINT s');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
