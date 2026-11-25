/**
 * Operaciones del operador del servidor (CLI), fuera de la API: crear tenants y su primera llave admin.
 * No hay registro público de tenants: en el modo alojado los crea quien opera el servicio.
 */
import type pg from 'pg';
import { registrarAutorizacion } from 'factura-hn';
import { autorizacionDemo, EMISOR_DEMO, LEYENDA_PRUEBA, PREFIJO_CAI_DEMO } from 'factura-hn/demo';
import { AlmacenPostgres } from '@factura-hn/postgres';
import { generarLlave, type ModoTenant, type RolLlave } from './llaves';
import { ROL_POR_DEFECTO } from './esquema';
import { CONSOLA_POR_DEFECTO } from './errores';

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
  return (await modoDeTenant(pool, tenant)) !== null;
}

/** Modo de un tenant (`prueba` o `produccion`), o null si no existe. */
export async function modoDeTenant(pool: pg.Pool, tenant: string): Promise<ModoTenant | null> {
  return enTenant(pool, tenant, async (c) => (await c.query<{ modo: ModoTenant }>('SELECT modo FROM api_tenants WHERE tenant = $1', [tenant])).rows[0]?.modo ?? null);
}

export const MODOS_TENANT: readonly ModoTenant[] = ['prueba', 'produccion'];

/**
 * Nombres que crea el propio servidor en modo local (`local` y el demo): el operador no los usa para un negocio,
 * para que un tenant real nunca se confunda con el de demostración.
 */
export const TENANTS_RESERVADOS: readonly string[] = ['local', 'demo'];

/**
 * Crea un tenant y su primera llave admin. Devuelve la llave: se muestra una sola vez. `modo` (por defecto
 * `produccion`) no cambia después: un tenant de prueba solo registra CAI ficticios y sus llaves son `fhn_test_…`;
 * uno de producción no acepta CAI ficticios y sus llaves son `fhn_live_…`.
 */
export async function crearTenant(
  pool: pg.Pool,
  o: { tenant: string; nombre: string; limiteMensual?: number | null; modo?: ModoTenant },
): Promise<{ tenant: string; llaveAdmin: string; modo: ModoTenant }> {
  if (TENANTS_RESERVADOS.includes(o.tenant)) {
    throw new Error(`El nombre «${o.tenant}» está reservado (el servidor usa «local» y «demo» en modo local): elige otro.`);
  }
  return crearTenantSinReserva(pool, o);
}

async function crearTenantSinReserva(
  pool: pg.Pool,
  o: { tenant: string; nombre: string; limiteMensual?: number | null; modo?: ModoTenant },
): Promise<{ tenant: string; llaveAdmin: string; modo: ModoTenant }> {
  if (!TENANT.test(o.tenant)) throw new Error('El tenant: minúsculas, dígitos, «-» o «_» (máx. 63).');
  const modo = o.modo ?? 'produccion';
  if (!MODOS_TENANT.includes(modo)) throw new Error('El modo del tenant: prueba o produccion.');
  const { llave, prefijo, hash } = generarLlave(modo);
  await enTenant(pool, o.tenant, async (c) => {
    await c.query('INSERT INTO api_tenants (tenant, nombre, limite_mensual, modo) VALUES ($1, $2, $3, $4)', [o.tenant, o.nombre, o.limiteMensual ?? null, modo]);
    await c.query("INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre) VALUES ($1, $2, $3, 'admin', 'admin inicial')", [prefijo, o.tenant, hash]);
    await c.query("INSERT INTO api_bitacora (tenant, actor, accion, detalle) VALUES ($1, 'operador', 'tenant.creado', $2)", [o.tenant, JSON.stringify({ prefijo, modo })]);
  });
  return { tenant: o.tenant, llaveAdmin: llave, modo };
}

/**
 * Llave adicional desde la consola del operador (p. ej. si se perdió la única llave admin). Lleva la marca del
 * modo de su tenant: `fhn_test_…` en uno de prueba y `fhn_live_…` en uno de producción.
 */
export async function crearLlaveOperador(
  pool: pg.Pool,
  o: { tenant: string; rol: RolLlave; nombre: string; establecimiento?: string; puntoEmision?: string },
): Promise<string> {
  const est = o.establecimiento || null;
  const pto = o.puntoEmision || null;
  const tresDigitos = /^[0-9]{3}$/;
  if (Boolean(est) !== Boolean(pto) || (o.rol === 'caja' && !est) || (est && !tresDigitos.test(est)) || (pto && !tresDigitos.test(pto))) {
    throw new Error('Una llave de caja se ata a un establecimiento y punto de emisión: --caja 000-001.');
  }
  const modo = TENANT.test(o.tenant) ? await modoDeTenant(pool, o.tenant) : null;
  if (!modo) {
    throw new Error(`El tenant «${o.tenant}» no existe: arranca la API una vez (crea «${TENANT_LOCAL}») o créalo con «tenant crear».`);
  }
  const { llave, prefijo, hash } = generarLlave(modo);
  await enTenant(pool, o.tenant, async (c) => {
    await c.query(
      'INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre, establecimiento, punto_emision) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [prefijo, o.tenant, hash, o.rol, o.nombre, est, pto],
    );
    await c.query("INSERT INTO api_bitacora (tenant, actor, accion, detalle) VALUES ($1, 'operador', 'llave.creada', $2)", [o.tenant, JSON.stringify({ prefijo, rol: o.rol, modo })]);
  });
  return llave;
}

/**
 * Datos de DEMOSTRACIÓN, de `factura-hn/demo`: el CAI es ficticio y no sirve para facturar, y el nombre del
 * emisor lo dice. `CAI_DEMO` queda por compatibilidad: el de cada tipo termina en su código (`…-01`).
 */
export const CAI_DEMO = `${PREFIJO_CAI_DEMO}00`;
export { EMISOR_DEMO, LEYENDA_PRUEBA };

export const TENANT_DEMO = 'demo';

/**
 * Cómo invocar la consola del operador: lo que diga `FHN_CONSOLA` (la imagen de Docker la define como
 * `docker compose exec api factura-hn-api`) o, fuera de Docker, `node packages/api/dist/cli.js`.
 */
export const consolaDe = (env: NodeJS.ProcessEnv): string => env.FHN_CONSOLA?.trim() || CONSOLA_POR_DEFECTO;

/** Comando para crear la llave admin del tenant `local`. */
export const comandoLlaveAdminLocal = (consola: string): string => `${consola} llave crear local --rol admin --nombre Administración`;
/** Comando para crear otra llave de caja del demo. */
export const comandoLlaveDemo = (consola: string): string => `${consola} demo llave`;

/**
 * Bloque destacado con llaves del demo, para el log del servidor y la consola: dice que el CAI es ficticio y
 * cómo crear otra llave si se pierde.
 */
export function bloqueLlavesDemo(llaves: { caja?: string; admin?: string }, consola: string): string {
  const linea = '='.repeat(78);
  return [
    '',
    linea,
    `  DEMOSTRACIÓN · CAI FICTICIO · ${LEYENDA_PRUEBA}`,
    llaves.caja
      ? '  Tenant «demo», punto de emisión 000-001. Nada de lo que emitas aquí tiene validez fiscal.'
      : '  Tenant «demo». Nada de lo que emitas aquí tiene validez fiscal.',
    '',
    ...(llaves.caja ? [`  Llave de caja (para emitir): ${llaves.caja}`] : []),
    ...(llaves.admin ? [`  Llave admin del demo:        ${llaves.admin}`] : []),
    '',
    '  Se muestra solo esta vez. Si pierdes la llave de caja, crea otra con:',
    `    ${comandoLlaveDemo(consola)}`,
    '  Primera factura en 3 pasos: docs/api.md, «La primera factura».',
    linea,
    '',
  ].join('\n');
}

/**
 * Modo local (Art. 47): un solo negocio en su establecimiento. Crea el tenant `local` si no existe, **sin
 * llave**: la llave admin del negocio la crea el operador con la consola (`llave crear local --rol admin`), que
 * la imprime solo en su terminal y no en el log del servidor. Con `demo`, crea **además** un tenant aparte,
 * `demo`, con el emisor y un CAI ficticios y sus llaves (sin validez fiscal): el tenant `local` del negocio
 * queda limpio para su RTN y sus CAI reales.
 * Devuelve si `local` sigue sin llave admin activa, si existe el tenant `demo` y las llaves del demo creadas en
 * esta llamada.
 */
export async function iniciarLocal(
  pool: pg.Pool,
  o: { demo?: boolean; rol?: string; hoy?: Date } = {},
): Promise<{ localSinLlaveAdmin: boolean; hayDemo: boolean; demo?: { llaveAdmin: string; llaveCaja: string } }> {
  if (!(await existeTenant(pool, TENANT_LOCAL))) {
    await enTenant(pool, TENANT_LOCAL, async (c) => {
      await c.query("INSERT INTO api_tenants (tenant, nombre, modo) VALUES ($1, $2, 'produccion')", [TENANT_LOCAL, 'Instalación local']);
      await c.query("INSERT INTO api_bitacora (tenant, actor, accion, detalle) VALUES ($1, 'operador', 'tenant.creado', '{}')", [TENANT_LOCAL]);
    });
  }
  const localSinLlaveAdmin = await enTenant(pool, TENANT_LOCAL, async (c) =>
    !(await c.query("SELECT 1 FROM api_llaves WHERE tenant = $1 AND rol = 'admin' AND revocada IS NULL", [TENANT_LOCAL])).rowCount,
  );
  const hayDemo = await existeTenant(pool, TENANT_DEMO);
  const r: { localSinLlaveAdmin: boolean; hayDemo: boolean; demo?: { llaveAdmin: string; llaveCaja: string } } = { localSinLlaveAdmin, hayDemo };
  if (o.demo && !hayDemo) {
    r.demo = await crearDemo(pool, o);
    r.hayDemo = true;
  }
  return r;
}

/**
 * Otra llave del tenant `demo` (por defecto de caja, en 000-001), para quien perdió la del log. Falla si el demo
 * no existe: se crea al arrancar en modo local con `FHN_DEMO=1`.
 */
export async function crearLlaveDemo(pool: pg.Pool, o: { rol?: RolLlave } = {}): Promise<string> {
  if (!(await existeTenant(pool, TENANT_DEMO))) {
    throw new Error('El tenant «demo» no existe: arranca la API una vez en modo local con FHN_DEMO=1 (el docker-compose.yml lo trae).');
  }
  if (!(await esDemoFicticio(pool))) {
    throw new Error('El tenant «demo» de esta base no es el de demostración (no tiene el emisor ni el CAI ficticios): «demo llave» no le crea llaves. Usa «llave crear».');
  }
  if ((await modoDeTenant(pool, TENANT_DEMO)) !== 'prueba') {
    throw new Error('El tenant «demo» de esta base es de producción (tiene autorizaciones o documentos con un CAI real): «demo llave» no le crea llaves. Usa «llave crear».');
  }
  const rol = o.rol ?? 'caja';
  return crearLlaveOperador(pool, rol === 'caja'
    ? { tenant: TENANT_DEMO, rol, nombre: 'Caja demo (consola)', establecimiento: '000', puntoEmision: '001' }
    : { tenant: TENANT_DEMO, rol, nombre: 'Admin demo (consola)' });
}

/** Si el tenant `demo` es el de demostración: tiene el emisor ficticio o algún CAI ficticio (`DEMO00-NO-VALIDO-…`). */
export async function esDemoFicticio(pool: pg.Pool): Promise<boolean> {
  const prefijoCai = CAI_DEMO.slice(0, CAI_DEMO.indexOf('NO-VALIDO-') + 'NO-VALIDO-'.length);
  return enTenant(pool, TENANT_DEMO, async (c) => {
    const r = await c.query<{ demo: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM api_emisores WHERE tenant = $1 AND datos->>'rtn' = $2)
           OR EXISTS (SELECT 1 FROM fhn_autorizaciones WHERE tenant = $1 AND starts_with(cai, $3)) AS demo`,
      [TENANT_DEMO, EMISOR_DEMO.rtn, prefijoCai],
    );
    return r.rows[0]?.demo === true;
  });
}

/**
 * Tenants distintos de `local` y `demo` que siguen en uso, para negarse a arrancar en modo local con datos de
 * varios negocios. Se ignoran los desactivados (`activo = false`) sin llaves activas. Corre con el dueño de las
 * tablas. `api_tenants` fuerza RLS también al dueño, así que cada tenant se revisa con su tenant fijado; los
 * candidatos salen de `api_llaves` (no fuerza RLS al dueño, y todo tenant creado con la consola tiene al menos
 * una llave) y de `api_tenants` (visible completa solo para un superusuario).
 */
export async function tenantsAjenosAlModoLocal(pool: pg.Pool, maximo = 5): Promise<string[]> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const candidatos = (await c.query<{ tenant: string }>(
      `SELECT tenant FROM (SELECT tenant FROM api_llaves UNION SELECT tenant FROM api_tenants) t
        WHERE tenant NOT IN ($1, $2) ORDER BY tenant`,
      [TENANT_LOCAL, TENANT_DEMO],
    )).rows.map((f) => f.tenant);
    const ajenos: string[] = [];
    for (const tenant of candidatos) {
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
      const f = (await c.query<{ activo: boolean | null; llaves: boolean }>(
        `SELECT (SELECT activo FROM api_tenants WHERE tenant = $1) AS activo,
                EXISTS (SELECT 1 FROM api_llaves WHERE tenant = $1 AND revocada IS NULL) AS llaves`,
        [tenant],
      )).rows[0]!;
      if (f.activo === false && !f.llaves) continue;
      ajenos.push(tenant);
      if (ajenos.length >= maximo) break;
    }
    await c.query('COMMIT');
    return ajenos;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Mensaje de `tenant crear` en modo local (o sin FHN_MODO): el modo local es de un solo negocio. Si se creara el
 * tenant, tendría webhooks del modo local (sin el filtro de la red interna) hasta el próximo arranque, que se negaría
 * a seguir (ver `errorTenantsAjenos`).
 */
export function errorTenantEnModoLocal(tenant: string): string {
  return [
    `No se crea «${tenant}»: el modo local es para un solo negocio (el tenant «${TENANT_LOCAL}»; «${TENANT_DEMO}» es el de demostración).`,
    'Si la base sirve a varios negocios, arranca con FHN_MODO=alojado (y FHN_CLAVE_CIFRADO), y corre esta consola también con FHN_MODO=alojado.',
    `Para tu propio negocio no hace falta otro tenant: crea su llave con «llave crear ${TENANT_LOCAL} --rol admin».`,
  ].join('\n');
}

/** Mensaje de error del modo local con tenants ajenos: cómo arreglarlo, con el SQL para desactivarlos. */
export function errorTenantsAjenos(ajenos: string[]): string {
  const sql = ajenos
    .map((t) => `SELECT set_config('factura_hn.tenant', '${t}', true); UPDATE api_tenants SET activo = false WHERE tenant = '${t}'; ` +
      `UPDATE api_llaves SET revocada = now() WHERE tenant = '${t}' AND revocada IS NULL;`)
    .join(' ');
  return [
    `La base tiene tenants de otros negocios (${ajenos.join(', ')}) y el modo local es para un solo negocio.`,
    'Si la base sirve a varios negocios, arranca con FHN_MODO=alojado (y FHN_CLAVE_CIFRADO).',
    'Si esos tenants sobran, desactívalos y revoca sus llaves con el dueño de las tablas (no se borra nada), por ejemplo:',
    `  docker compose exec db psql -U postgres -d factura_hn -c "${sql}"`,
  ].join('\n');
}

async function crearDemo(pool: pg.Pool, o: { rol?: string; hoy?: Date }): Promise<{ llaveAdmin: string; llaveCaja: string }> {
  const { llaveAdmin } = await crearTenantSinReserva(pool, { tenant: TENANT_DEMO, nombre: 'Demostración (CAI ficticio)', modo: 'prueba' });
  await enTenant(pool, TENANT_DEMO, (c) => c.query('INSERT INTO api_emisores (tenant, datos) VALUES ($1, $2)', [TENANT_DEMO, JSON.stringify(EMISOR_DEMO)]));
  const hoy = o.hoy ?? new Date();
  const almacen = new AlmacenPostgres(pool, { tenant: TENANT_DEMO, rol: o.rol ?? ROL_POR_DEFECTO });
  // Rango 1–5000, como los demos creados antes de factura-hn/demo; `prueba: true` lo marca de prueba.
  for (const tipoDocumento of ['01', '06', '07'] as const) {
    await registrarAutorizacion(almacen, autorizacionDemo({ hoy, tipoDocumento, rangoFinal: 5000 }), { actor: 'operador:demo' });
  }
  const llaveCaja = await crearLlaveOperador(pool, { tenant: TENANT_DEMO, rol: 'caja', nombre: 'Caja 1 (demo)', establecimiento: '000', puntoEmision: '001' });
  return { llaveAdmin, llaveCaja };
}

// --- Modo demo (FHN_MODO=demo) -----------------------------------------------------------------------------------

/**
 * Por qué una base no sirve para el modo demo, o `[]`. La demostración pública no debe compartir base con datos
 * reales: cualquier tenant de producción (también el «local») o autorización con un CAI real la descarta. Corre con
 * el dueño de las tablas; como `api_tenants` fuerza RLS también al dueño, cada candidato se revisa con su tenant fijado.
 */
export async function datosRealesEnBase(pool: pg.Pool): Promise<string[]> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const candidatos = (await c.query<{ tenant: string }>(
      `SELECT tenant FROM api_llaves UNION SELECT tenant FROM api_demo_entornos UNION SELECT unnest($1::text[]) ORDER BY 1`,
      [[TENANT_LOCAL, TENANT_DEMO]],
    )).rows.map((f) => f.tenant);
    const motivos: string[] = [];
    for (const tenant of candidatos) {
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
      const f = (await c.query<{ modo: string | null; reales: boolean }>(
        `SELECT (SELECT modo FROM api_tenants WHERE tenant = $1) AS modo,
                EXISTS (SELECT 1 FROM fhn_autorizaciones WHERE tenant = $1 AND NOT starts_with(upper(btrim(cai)), 'DEMO00-NO-VALIDO-')) AS reales`,
        [tenant],
      )).rows[0]!;
      if (f.modo === 'produccion') motivos.push(`el tenant «${tenant}» es de producción`);
      else if (f.reales) motivos.push(`el tenant «${tenant}» tiene autorizaciones con un CAI real`);
      if (motivos.length >= 5) break;
    }
    await c.query('COMMIT');
    return motivos;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Mensaje de error del modo demo sobre una base con datos reales. */
export function errorDatosRealesEnDemo(motivos: string[]): string {
  return [
    `FHN_MODO=demo necesita una base solo para la demostración, y esta tiene datos reales: ${motivos.join('; ')}.`,
    'La demostración pública la usa cualquiera: crea una base aparte para ella (p. ej. factura_hn_demo) y no la compartas',
    'con la de ningún negocio.',
  ].join('\n');
}

/**
 * Borra los entornos de demostración vencidos a la hora `ahora`, de a `porTransaccion` (50) por transacción, hasta que no quede
 * ninguno. `fhn_api_purgar_demo` corre como el dueño de las tablas (SECURITY DEFINER): sirve desde la API (con el rol
 * de la aplicación) y desde la consola del operador. Devuelve cuántos borró.
 */
export async function purgarEntornosDemo(pool: pg.Pool, o: { rol?: string; ahora?: Date; porTransaccion?: number } = {}): Promise<number> {
  const almacen = new AlmacenPostgres(pool, o.rol ? { rol: o.rol } : {});
  const porTransaccion = o.porTransaccion ?? 50;
  let total = 0;
  for (;;) {
    const n = await almacen.transaccion(async (t) => {
      const tx = t as unknown as { consulta: <F>(sql: string, p?: unknown[]) => Promise<{ rows: F[] }> };
      return (await tx.consulta<{ n: number }>('SELECT fhn_api_purgar_demo($1, $2) AS n', [o.ahora ?? new Date(), porTransaccion])).rows[0]!.n;
    });
    total += n;
    if (n < porTransaccion) return total;
  }
}

/** Cifras de la demostración: entornos vigentes, vencidos por borrar y si está en pausa. */
export async function resumenDemo(pool: pg.Pool, o: { rol?: string; ahora?: Date } = {}): Promise<{ activos: number; vencidos: number; pausado: boolean }> {
  const almacen = new AlmacenPostgres(pool, o.rol ? { rol: o.rol } : {});
  return almacen.transaccion(async (t) => {
    const tx = t as unknown as { consulta: <F>(sql: string, p?: unknown[]) => Promise<{ rows: F[] }> };
    const f = (await tx.consulta<{ activos: string; vencidos: string; pausado: boolean }>('SELECT * FROM fhn_api_demo_resumen($1)', [o.ahora ?? new Date()])).rows[0]!;
    return { activos: Number(f.activos), vencidos: Number(f.vencidos), pausado: f.pausado };
  });
}

/** Interruptor global de la demostración (con el dueño de las tablas). La API lo nota en a lo sumo 5 segundos. */
export async function pausarDemo(pool: pg.Pool, pausado: boolean, motivo?: string): Promise<void> {
  await pool.query('UPDATE api_demo_control SET pausado = $1, motivo = $2, cambiado = now() WHERE id', [pausado, motivo?.slice(0, 200) ?? null]);
}
