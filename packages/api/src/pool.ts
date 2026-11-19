import pg from 'pg';

/**
 * Pool de PostgreSQL para el servidor y la CLI. Cuando Postgres se reinicia o un administrador cierra una
 * conexión inactiva, `pg` emite `error` en el pool; sin manejador, Node lo trata como excepción no capturada y
 * el proceso termina. Aquí se registra en una línea y el pool abre una conexión nueva en la siguiente consulta.
 */
export function crearPool(
  url: string,
  max: number,
  registrar: (mensaje: string) => void = (m) => console.error(m),
): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'factura-hn-api' });
  pool.on('error', (e) => registrar(`PostgreSQL cerró una conexión inactiva (${e.message}). Se abrirá otra en la siguiente consulta.`));
  return pool;
}
