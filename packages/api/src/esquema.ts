/**
 * Tablas propias de la API (`api_*`), junto a las tablas fiscales `fhn_*` de `@factura-hn/postgres`.
 *
 * Seguridad:
 * - Todas llevan `tenant` y RLS con la política `fhn_por_tenant` (la misma de las tablas fiscales). La API
 *   corre cada transacción como el rol de la aplicación (sin BYPASSRLS) con `factura_hn.tenant` fijado.
 * - Dos tablas se leen antes de saber el tenant o para todos los tenants, y por eso su RLS no se fuerza al
 *   dueño: `api_llaves` (autenticación) y `api_entregas` (el despachador de webhooks). El rol de la aplicación
 *   sigue sujeto a la política; solo dos funciones `SECURITY DEFINER` acotadas leen sin tenant.
 * - La bitácora es de solo inserción (disparador) y el rol no tiene DELETE en ninguna tabla.
 */
import type pg from 'pg';
import { AlmacenPostgres, politicasRLS } from '@factura-hn/postgres';

export const VERSION_ESQUEMA_API = 2;
export const ROL_POR_DEFECTO = 'fhn_app';

export const TABLAS_API_FORZADAS = ['api_tenants', 'api_emisores', 'api_idempotencia', 'api_webhooks', 'api_uso', 'api_bitacora'] as const;
export const TABLAS_API_SIN_FORZAR = ['api_llaves', 'api_entregas'] as const;

export const ESQUEMA_API = `
CREATE TABLE IF NOT EXISTS api_tenants (
  tenant text PRIMARY KEY CHECK (tenant ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  nombre text NOT NULL,
  limite_mensual integer CHECK (limite_mensual IS NULL OR limite_mensual >= 0),
  activo boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_llaves (
  prefijo text PRIMARY KEY CHECK (prefijo ~ '^[0-9a-f]{12}$'),
  tenant text NOT NULL REFERENCES api_tenants(tenant),
  hash bytea NOT NULL,
  rol text NOT NULL CHECK (rol IN ('caja', 'admin')),
  nombre text NOT NULL,
  establecimiento text CHECK (establecimiento ~ '^[0-9]{3}$'),
  punto_emision text CHECK (punto_emision ~ '^[0-9]{3}$'),
  creada timestamptz NOT NULL DEFAULT now(),
  revocada timestamptz,
  ultimo_uso timestamptz
);
CREATE INDEX IF NOT EXISTS api_llaves_tenant ON api_llaves (tenant);

CREATE TABLE IF NOT EXISTS api_emisores (
  tenant text PRIMARY KEY REFERENCES api_tenants(tenant),
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  datos jsonb NOT NULL,
  creado timestamptz NOT NULL DEFAULT now(),
  actualizado timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_idempotencia (
  tenant text NOT NULL,
  clave text NOT NULL,
  huella text NOT NULL,
  codigo integer NOT NULL,
  respuesta jsonb NOT NULL,
  creada timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, clave)
);

CREATE TABLE IF NOT EXISTS api_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant text NOT NULL REFERENCES api_tenants(tenant),
  url text NOT NULL,
  secreto text NOT NULL,
  eventos text[] NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_webhooks_tenant ON api_webhooks (tenant);

CREATE TABLE IF NOT EXISTS api_entregas (
  id bigserial PRIMARY KEY,
  tenant text NOT NULL,
  webhook_id uuid NOT NULL REFERENCES api_webhooks(id),
  evento text NOT NULL,
  clave text NOT NULL,
  cuerpo jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ENTREGADA', 'FALLIDA')),
  intentos integer NOT NULL DEFAULT 0,
  proximo timestamptz NOT NULL DEFAULT now(),
  ultimo_codigo integer,
  ultimo_error text,
  creada timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webhook_id, clave)
);
CREATE INDEX IF NOT EXISTS api_entregas_pendientes ON api_entregas (tenant, proximo) WHERE estado = 'PENDIENTE';

CREATE TABLE IF NOT EXISTS api_uso (
  tenant text NOT NULL,
  mes text NOT NULL CHECK (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  documentos integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant, mes)
);

CREATE TABLE IF NOT EXISTS api_bitacora (
  id bigserial PRIMARY KEY,
  tenant text NOT NULL,
  instante timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  accion text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS api_bitacora_tenant ON api_bitacora (tenant, id);

CREATE OR REPLACE FUNCTION fhn_api_solo_insertar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora de la API es de solo inserción';
END $$;
DROP TRIGGER IF EXISTS fhn_api_bitacora_inmutable ON api_bitacora;
CREATE TRIGGER fhn_api_bitacora_inmutable BEFORE UPDATE OR DELETE ON api_bitacora
  FOR EACH ROW EXECUTE FUNCTION fhn_api_solo_insertar();

DO $do$ BEGIN
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_autenticar(p_prefijo text)
RETURNS TABLE (tenant text, hash bytea, rol text, establecimiento text, punto_emision text, limite_mensual integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
  SELECT l.tenant, l.hash, l.rol, l.establecimiento, l.punto_emision, t.limite_mensual
    FROM api_llaves l JOIN api_tenants t ON t.tenant = l.tenant
   WHERE l.prefijo = p_prefijo AND l.revocada IS NULL AND t.activo
$$$f$, current_schema());

-- Solo después de comprobar el secreto (la API lo llama a lo sumo una vez por minuto y llave).
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_marcar_uso(p_prefijo text, p_hash bytea)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
  UPDATE api_llaves SET ultimo_uso = now() WHERE prefijo = p_prefijo AND hash = p_hash AND revocada IS NULL
$$$f$, current_schema());

EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_tenants_con_pendientes()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
  SELECT DISTINCT tenant FROM api_entregas WHERE estado = 'PENDIENTE' AND proximo <= now()
$$$f$, current_schema());
END $do$;
REVOKE ALL ON FUNCTION fhn_api_autenticar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_tenants_con_pendientes() FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_marcar_uso(text, bytea) FROM PUBLIC;
`;

const ROL = /^[a-z_][a-z0-9_]{0,62}$/;

/** Permisos mínimos del rol de la aplicación: sin DELETE; columnas acotadas donde se actualiza. */
export function permisosApi(rol: string): string {
  if (!ROL.test(rol)) throw new Error(`Nombre de rol inválido: ${rol}`);
  return `
GRANT SELECT ON api_tenants TO ${rol};
GRANT SELECT, INSERT ON api_llaves TO ${rol};
GRANT UPDATE (revocada) ON api_llaves TO ${rol};
GRANT SELECT, INSERT, UPDATE ON api_emisores TO ${rol};
GRANT SELECT, INSERT ON api_idempotencia TO ${rol};
GRANT SELECT, INSERT ON api_webhooks TO ${rol};
GRANT UPDATE (activo) ON api_webhooks TO ${rol};
GRANT SELECT, INSERT ON api_entregas TO ${rol};
GRANT UPDATE (estado, intentos, proximo, ultimo_codigo, ultimo_error) ON api_entregas TO ${rol};
GRANT SELECT, INSERT, UPDATE ON api_uso TO ${rol};
GRANT SELECT, INSERT ON api_bitacora TO ${rol};
GRANT USAGE ON SEQUENCE api_entregas_id_seq, api_bitacora_id_seq TO ${rol};
GRANT EXECUTE ON FUNCTION fhn_api_autenticar(text), fhn_api_tenants_con_pendientes(), fhn_api_marcar_uso(text, bytea) TO ${rol};`;
}

/**
 * Crea o actualiza las tablas fiscales y las de la API, con RLS y el rol de la aplicación. Una vez por
 * versión (tabla `fhn_migraciones`), protegida con un candado para varias réplicas. Todo el SQL es
 * idempotente: una versión nueva lo vuelve a aplicar completo.
 */
export async function migrarApi(pool: pg.Pool, rol = ROL_POR_DEFECTO): Promise<void> {
  await new AlmacenPostgres(pool).migrar({ rls: { rol } });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(4823190)');
    const clave = `api-v${VERSION_ESQUEMA_API}-${rol}`;
    const ya = await c.query('SELECT 1 FROM fhn_migraciones WHERE clave = $1', [clave]);
    if (!ya.rowCount) {
      await c.query(ESQUEMA_API);
      await c.query(politicasRLS(rol, TABLAS_API_FORZADAS));
      await c.query(politicasRLS(rol, TABLAS_API_SIN_FORZAR, { forzar: false }));
      await c.query(permisosApi(rol));
      await c.query('INSERT INTO fhn_migraciones (clave) VALUES ($1)', [clave]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
