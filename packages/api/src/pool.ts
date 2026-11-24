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
  // connectionTimeoutMillis: si el pool está agotado, la solicitud falla en vez de esperar para siempre.
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'factura-hn-api', connectionTimeoutMillis: 30_000 });
  pool.on('error', (e) => registrar(`PostgreSQL cerró una conexión inactiva (${e.message}). Se abrirá otra en la siguiente consulta.`));
  return pool;
}

/** Errores de una base que aún no acepta conexiones (arrancando, reiniciándose o sin red todavía). */
const NO_DISPONIBLE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|the database system is (starting up|shutting down|in recovery mode)|Connection terminated/i;

/**
 * Espera a que la base acepte conexiones, con reintentos crecientes hasta `esperaMaxMs`. Al arrancar junto con
 * Postgres (por ejemplo, tras reiniciar Docker o el equipo), la API espera en lugar de terminar y reiniciarse
 * en bucle. Un error que no sea de disponibilidad (contraseña, base inexistente) se lanza de inmediato.
 */
export async function esperarBase(
  pool: pg.Pool,
  { esperaMaxMs = 60_000, registrar = (m: string) => console.error(m) }: { esperaMaxMs?: number; registrar?: (m: string) => void } = {},
): Promise<void> {
  const limite = Date.now() + esperaMaxMs;
  for (let intento = 1, pausa = 250; ; intento++, pausa = Math.min(pausa * 2, 5_000)) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (!NO_DISPONIBLE.test(mensaje) || Date.now() + pausa > limite) throw e;
      if (intento === 1 || intento % 5 === 0) registrar(`Esperando a PostgreSQL (${mensaje})…`);
      await new Promise((r) => setTimeout(r, pausa));
    }
  }
}

/** Usuario de una URL de conexión `postgres://usuario@…`, o '' si no lo lleva o no es una URL. */
export function usuarioDeUrlSiHay(url: string): string {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return '';
  }
}

/** Usuario de una URL de conexión `postgres://usuario@…` (el rol LOGIN de la API). */
export function usuarioDeUrl(url: string): string {
  const usuario = usuarioDeUrlSiHay(url);
  if (!usuario) throw new Error('Con FHN_MIGRAR_URL, DATABASE_URL debe ser una URL postgres://usuario@host/base con el rol LOGIN de la API.');
  return usuario;
}

/** Conexión del dueño de las tablas (migraciones y consola): FHN_MIGRAR_URL si está, si no DATABASE_URL. */
export function urlDueno(env: NodeJS.ProcessEnv): string {
  const url = env.FHN_MIGRAR_URL || env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  return url;
}
