/**
 * Un reinicio de PostgreSQL no tumba la API: el pool registra el error de la conexión cerrada y la siguiente
 * consulta abre otra. Se simula con pg_terminate_backend sobre las conexiones inactivas del pool.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { crearPool } from '../src/pool';
import { cerrarPool, poolPrueba, URL_PG } from './ayuda';

afterAll(cerrarPool);

describe.skipIf(!URL_PG)('pool de PostgreSQL', () => {
  it('una conexión cerrada por el servidor se registra y la siguiente consulta funciona', async () => {
    const registros: string[] = [];
    const pool = crearPool(URL_PG!, 2, (m) => registros.push(m));
    try {
      const pid = (await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      const admin = await poolPrueba();
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      for (let i = 0; i < 50 && !registros.length; i++) await new Promise((r) => setTimeout(r, 20));
      expect(registros[0]).toMatch(/PostgreSQL cerró una conexión inactiva/);
      expect((await pool.query<{ n: number }>('SELECT 1 AS n')).rows[0]!.n).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
