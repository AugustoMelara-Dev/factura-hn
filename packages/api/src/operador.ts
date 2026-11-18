/**
 * Operaciones del operador del servidor (CLI), fuera de la API: crear tenants y su primera llave admin.
 * No hay registro público de tenants: en el modo alojado los crea quien opera el servicio.
 */
import type pg from 'pg';
import { registrarAutorizacion, type AutorizacionCAI } from 'factura-hn';
import { AlmacenPostgres } from '@factura-hn/postgres';
import { generarLlave, type RolLlave } from './llaves';
import { ROL_POR_DEFECTO } from './esquema';

export const TENANT_LOCAL = 'local';
const TENANT = /^[a-z0-9][a-z0-9_-]{0,62}$/;

async function enTenant<T>(pool: pg.Pool, tenant: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function existeTenant(pool: pg.Pool, tenant: string): Promise<boolean> {
  return enTenant(pool, tenant, async (c) => Boolean((await c.query('SELECT 1 FROM api_tenants WHERE tenant = $1', [tenant])).rowCount));
}

/** Crea un tenant y su primera llave admin. Devuelve la llave: se muestra una sola vez. */
export async function crearTenant(
  pool: pg.Pool,
  o: { tenant: string; nombre: string; limiteMensual?: number | null },
): Promise<{ tenant: string; llaveAdmin: string }> {
  if (!TENANT.test(o.tenant)) throw new Error('El tenant: minúsculas, dígitos, «-» o «_» (máx. 63).');
  const { llave, prefijo, hash } = generarLlave();
  await enTenant(pool, o.tenant, async (c) => {
    await c.query('INSERT INTO api_tenants (tenant, nombre, limite_mensual) VALUES ($1, $2, $3)', [o.tenant, o.nombre, o.limiteMensual ?? null]);
    await c.query("INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre) VALUES ($1, $2, $3, 'admin', 'admin inicial')", [prefijo, o.tenant, hash]);
    await c.query("INSERT INTO api_bitacora (tenant, actor, accion, detalle) VALUES ($1, 'operador', 'tenant.creado', $2)", [o.tenant, JSON.stringify({ prefijo })]);
  });
  return { tenant: o.tenant, llaveAdmin: llave };
}

/** Llave adicional desde la consola del operador (p. ej. si se perdió la única llave admin). */
export async function crearLlaveOperador(
  pool: pg.Pool,
  o: { tenant: string; rol: RolLlave; nombre: string; establecimiento?: string; puntoEmision?: string },
): Promise<string> {
  const { llave, prefijo, hash } = generarLlave();
  await enTenant(pool, o.tenant, async (c) => {
    await c.query(
      'INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre, establecimiento, punto_emision) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [prefijo, o.tenant, hash, o.rol, o.nombre, o.establecimiento ?? null, o.puntoEmision ?? null],
    );
    await c.query("INSERT INTO api_bitacora (tenant, actor, accion, detalle) VALUES ($1, 'operador', 'llave.creada', $2)", [o.tenant, JSON.stringify({ prefijo, rol: o.rol })]);
  });
  return llave;
}

/**
 * Datos de DEMOSTRACIÓN: el CAI es ficticio y no sirve para facturar. El nombre del emisor lo dice y la
 * fecha límite es corta. Solo para probar la API localmente.
 */
export const CAI_DEMO = 'DEMO00-NO-VALIDO-0000-0000-0000-00';
export const EMISOR_DEMO = {
  rtn: '08011999000000',
  razonSocial: 'NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)',
  nombreComercial: 'Demo factura-hn',
  direccionCasaMatriz: 'Tegucigalpa, M.D.C.',
  direccionEstablecimiento: 'Tegucigalpa, M.D.C.',
  telefono: '2200-0000',
  correo: 'demo@ejemplo.hn',
};

/**
 * Modo local (Art. 47): un solo negocio en su establecimiento. Crea el tenant `local` y su llave admin si
 * no existen. Con `demo`, además registra el emisor y un CAI ficticio y crea una llave de caja.
 */
export async function iniciarLocal(
  pool: pg.Pool,
  o: { demo?: boolean; rol?: string; hoy?: Date } = {},
): Promise<{ llaveAdmin?: string; llaveCaja?: string }> {
  if (await existeTenant(pool, TENANT_LOCAL)) return {};
  const { llaveAdmin } = await crearTenant(pool, { tenant: TENANT_LOCAL, nombre: 'Instalación local' });
  if (!o.demo) return { llaveAdmin };
  await enTenant(pool, TENANT_LOCAL, (c) => c.query('INSERT INTO api_emisores (tenant, datos) VALUES ($1, $2)', [TENANT_LOCAL, JSON.stringify(EMISOR_DEMO)]));
  const hoy = o.hoy ?? new Date();
  const limite = new Date(hoy.getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
  const almacen = new AlmacenPostgres(pool, { tenant: TENANT_LOCAL, rol: o.rol ?? ROL_POR_DEFECTO });
  for (const tipoDocumento of ['01', '06', '07'] as const) {
    const aut: AutorizacionCAI = {
      cai: `${CAI_DEMO.slice(0, -2)}${tipoDocumento}`,
      tipoDocumento,
      establecimiento: '000',
      puntoEmision: '001',
      rangoInicial: 1,
      rangoFinal: 5000,
      fechaLimiteEmision: limite,
    };
    await registrarAutorizacion(almacen, aut, { actor: 'operador:demo' });
  }
  const llaveCaja = await crearLlaveOperador(pool, { tenant: TENANT_LOCAL, rol: 'caja', nombre: 'Caja 1 (demo)', establecimiento: '000', puntoEmision: '001' });
  return { llaveAdmin, llaveCaja };
}
