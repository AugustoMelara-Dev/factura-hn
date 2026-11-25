/**
 * 503 `BASE_NO_DISPONIBLE` sin base de verdad: qué errores cuentan como «la base no está» y cómo responde la API.
 * La prueba con PostgreSQL reiniciándose de verdad es reinicio-pg.test.ts (`pnpm resiliencia`).
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { esBaseNoDisponible } from '../../src/errores';

const conCodigo = (mensaje: string, code: string) => Object.assign(new Error(mensaje), { code });

describe('esBaseNoDisponible', () => {
  it('reconoce reinicios, caídas, conexiones cortadas o rechazadas y el pool agotado', () => {
    for (const e of [
      conCodigo('terminating connection due to administrator command', '57P01'),
      conCodigo('terminating connection due to immediate shutdown command', '57P02'),
      conCodigo('the database system is starting up', '57P03'),
      conCodigo('sorry, too many clients already', '53300'),
      conCodigo('connection failure', '08006'),
      conCodigo('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
      conCodigo('read ECONNRESET', 'ECONNRESET'),
      new Error('Connection terminated unexpectedly'),
      new Error('timeout exceeded when trying to connect'),
      new Error('Client has encountered a connection error and is not queryable'),
    ]) {
      expect(esBaseNoDisponible(e), e.message).toBe(true);
    }
  });

  it('no confunde los errores de datos, de permisos ni los propios', () => {
    for (const e of [
      conCodigo('duplicate key value violates unique constraint', '23505'),
      conCodigo('permission denied for table api_llaves', '42501'),
      conCodigo('could not serialize access', '40001'),
      conCodigo('factura-hn: la serie de correlativos no retrocede', 'P0001'),
      // Clase 08, pero es un error del código (SELECT $1::int + $2::int con un solo parámetro): 500, no 503.
      conCodigo('bind message supplies 1 parameters, but prepared statement "" requires 2', '08P01'),
      new Error('conexión rechazada: secreto-interno'),
      new TypeError('x is undefined'),
    ]) {
      expect(esBaseNoDisponible(e), e.message).toBe(false);
    }
    expect(esBaseNoDisponible('ECONNREFUSED')).toBe(false);
    expect(esBaseNoDisponible(null)).toBe(false);
  });
});

describe('la API con la base caída', () => {
  it('responde 503 BASE_NO_DISPONIBLE con Retry-After, solución y enlace; el log lleva una línea sin traza', async () => {
    const log: unknown[][] = [];
    const caida = { query: async () => { throw conCodigo('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'); }, connect: async () => { throw conCodigo('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'); } };
    const app = crearApp({ pool: caida as unknown as pg.Pool, modo: 'alojado', registrar: (...a) => log.push(a) });
    const r = await app.request('/v1/documentos', {
      method: 'POST',
      headers: { authorization: `Bearer fhn_live_${'a'.repeat(12)}_${'b'.repeat(43)}`, 'content-type': 'application/json', 'idempotency-key': 'venta-1', 'solicitud-id': 'caso-503' },
      body: JSON.stringify({ documento: { lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1.00' }] } }),
    });
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('2');
    const cuerpo = (await r.json()) as { error: Record<string, string> };
    expect(cuerpo.error).toMatchObject({ codigo: 'BASE_NO_DISPONIBLE', solicitud: 'caso-503' });
    expect(cuerpo.error.solucion).toMatch(/misma Idempotency-Key/);
    expect(cuerpo.error.documentacion).toMatch(/errores\.md#base_no_disponible$/);
    expect(JSON.stringify(cuerpo)).not.toContain('127.0.0.1');
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual([expect.stringMatching(/^Base de datos no disponible \(solicitud .*caso-503.*\): connect ECONNREFUSED/)]);
  });

  it('el 503 está en el contrato de cada operación que declara 500, con Retry-After', async () => {
    const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });
    const doc = (await (await app.request('/openapi.json')).json()) as { paths: Record<string, Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>> };
    let operaciones = 0;
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item)) {
        if (!op.responses?.['500']) continue;
        operaciones++;
        expect(op.responses['503']).toBeDefined();
        expect(op.responses['503']!.headers).toHaveProperty('Retry-After');
      }
    }
    expect(operaciones).toBeGreaterThan(20);
  });
});
