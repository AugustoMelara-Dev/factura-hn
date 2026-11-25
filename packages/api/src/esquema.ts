/**
 * Tablas propias de la API (`api_*`), junto a las tablas fiscales `fhn_*` de `@factura-hn/postgres`.
 *
 * Seguridad:
 * - Todas llevan `tenant` y RLS con la política `fhn_por_tenant` (la misma de las tablas fiscales). La API
 *   corre cada transacción como el rol de la aplicación (sin BYPASSRLS) con `factura_hn.tenant` fijado.
 * - Dos tablas se leen antes de saber el tenant o para todos los tenants, y por eso su RLS no se fuerza al
 *   dueño: `api_llaves` (autenticación) y `api_entregas` (el despachador de webhooks). El rol de la aplicación
 *   sigue sujeto a la política; solo funciones `SECURITY DEFINER` acotadas leen sin tenant.
 * - La bitácora es de solo inserción (disparador) y el rol no tiene DELETE en ninguna tabla.
 */
import type pg from 'pg';
import { AlmacenPostgres, esTransaccionPostgres, politicasRLS } from '@factura-hn/postgres';
import { EMISOR_DEMO } from 'factura-hn/demo';

export const VERSION_ESQUEMA_API = 10;
export const ROL_POR_DEFECTO = 'fhn_app';

export const TABLAS_API_FORZADAS = ['api_tenants', 'api_emisores', 'api_idempotencia', 'api_webhooks', 'api_uso', 'api_bitacora'] as const;
export const TABLAS_API_SIN_FORZAR = ['api_llaves', 'api_entregas', 'api_demo_entornos'] as const;

/**
 * Marca de la v9: el comentario de `fhn_api_tenants_con_pendientes()`, que desde la v9 omite los tenants inactivos.
 * La función ya existía; su cuerpo nuevo no se nota en los privilegios, así que `exigirEsquemaApi` busca la marca.
 */
export const MARCA_PENDIENTES_V9 = 'factura-hn api v9: solo tenants activos';

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
-- v3: id interno estable de la llave, el que identifica al actor en las bitácoras.
ALTER TABLE api_llaves ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS api_llaves_id ON api_llaves (id);
-- v4: una llave de caja nueva siempre va atada a un punto de emisión, aunque se inserte a mano.
-- Disparador de INSERT y no CHECK: un CHECK (aun NOT VALID) también se revisa en el UPDATE de ultimo_uso
-- y dejaría inservible, con error 500, una llave vieja que hoy solo lee. Esas llaves ya no emiten (la API
-- falla cerrado con CAJA_SIN_PUNTO).
CREATE OR REPLACE FUNCTION fhn_api_caja_con_punto() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rol = 'caja' AND (NEW.establecimiento IS NULL OR NEW.punto_emision IS NULL) THEN
    RAISE EXCEPTION 'api_llaves_caja_con_punto: una llave de caja se ata a un establecimiento y punto de emisión';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fhn_api_llaves_caja_con_punto ON api_llaves;
CREATE TRIGGER fhn_api_llaves_caja_con_punto BEFORE INSERT ON api_llaves
  FOR EACH ROW EXECUTE FUNCTION fhn_api_caja_con_punto();

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

-- v6: lo que falta compactar (el mantenimiento de cada hora no recorre las filas ya compactadas).
CREATE INDEX IF NOT EXISTS api_idempotencia_por_compactar ON api_idempotencia (tenant, creada) WHERE respuesta ? 'documento';

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
-- v8: rotación del secreto con gracia. Mientras anterior_hasta no pase, cada entrega se firma también con el
-- secreto anterior (dos v1). El mantenimiento borra el secreto anterior cuando la gracia termina.
ALTER TABLE api_webhooks ADD COLUMN IF NOT EXISTS secreto_anterior text;
ALTER TABLE api_webhooks ADD COLUMN IF NOT EXISTS anterior_hasta timestamptz;

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
-- v5: id público de la entrega (cabecera X-FacturaHN-Entrega y campo id del cuerpo). No sale de una secuencia
-- global: no revela cuántas entregas hay en el servicio. El bigserial sigue siendo solo interno.
ALTER TABLE api_entregas ADD COLUMN IF NOT EXISTS entrega uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
-- v8: las entregas de un webhook, de la más reciente a la más antigua (GET /v1/webhooks/{id}/entregas).
CREATE INDEX IF NOT EXISTS api_entregas_por_webhook ON api_entregas (webhook_id, creada DESC, entrega DESC);

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
-- v3: persona que operó (p. ej. el cajero), si la solicitud la indica.
ALTER TABLE api_bitacora ADD COLUMN IF NOT EXISTS operador text CHECK (operador IS NULL OR length(operador) BETWEEN 1 AND 80);

-- v8: modo del tenant (sandbox con llaves fhn_test_, o producción con llaves fhn_live_). Los tenants que ya
-- existían quedan en producción, salvo el tenant «demo» de demostración, que pasa a prueba: tiene el emisor o un
-- CAI ficticios y **ninguna** autorización ni documento con un CAI real (la 0.2.0 no impedía registrar un CAI real
-- en «demo», ni crear en modo alojado un tenant real con ese nombre). Si tiene alguno, queda en producción y se
-- avisa. Solo la primera vez, al crear la columna. api_tenants fuerza RLS al dueño: se fija el tenant «demo» para
-- verlo y se devuelve el valor anterior.
DO $modo$
DECLARE
  v_previo text := current_setting('factura_hn.tenant', true);
  v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'api_tenants'::regclass AND attname = 'modo' AND NOT attisdropped) THEN
    ALTER TABLE api_tenants ADD COLUMN modo text NOT NULL DEFAULT 'produccion' CHECK (modo IN ('prueba', 'produccion'));
    PERFORM set_config('factura_hn.tenant', 'demo', true);
    UPDATE api_tenants SET modo = 'prueba'
     WHERE tenant = 'demo'
       AND (EXISTS (SELECT 1 FROM api_emisores e WHERE e.tenant = 'demo' AND e.datos->>'rtn' = '${EMISOR_DEMO.rtn}')
            OR EXISTS (SELECT 1 FROM fhn_autorizaciones a WHERE a.tenant = 'demo' AND starts_with(upper(btrim(a.cai)), 'DEMO00-NO-VALIDO-')))
       AND NOT EXISTS (SELECT 1 FROM fhn_autorizaciones a WHERE a.tenant = 'demo' AND NOT starts_with(upper(btrim(a.cai)), 'DEMO00-NO-VALIDO-'))
       AND NOT EXISTS (SELECT 1 FROM fhn_documentos d WHERE d.tenant = 'demo' AND NOT starts_with(upper(btrim(coalesce(d.datos->>'cai', ''))), 'DEMO00-NO-VALIDO-'));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 AND EXISTS (SELECT 1 FROM api_tenants WHERE tenant = 'demo') THEN
      RAISE NOTICE 'factura-hn: el tenant «demo» queda en producción (tiene autorizaciones o documentos con un CAI real, o no es el de demostración).';
    END IF;
    PERFORM set_config('factura_hn.tenant', coalesce(v_previo, ''), true);
  END IF;
END $modo$;

-- v10: entornos de demostración (FHN_MODO=demo). Cada visitante recibe un tenant de prueba propio que vence a las
-- 24 h y se borra completo. api_demo_entornos se lee sin tenant (cupos y purga), por eso su RLS no se fuerza al
-- dueño; el rol de la aplicación solo ve el suyo y escribe a través de funciones SECURITY DEFINER acotadas.
-- origen: huella (HMAC) de la dirección de quien lo creó, para el cupo por dirección; nunca la dirección.
CREATE TABLE IF NOT EXISTS api_demo_entornos (
  tenant text PRIMARY KEY REFERENCES api_tenants(tenant),
  creado timestamptz NOT NULL,
  expira timestamptz NOT NULL,
  origen text NOT NULL CHECK (origen ~ '^[0-9a-f]{32}$')
);
CREATE INDEX IF NOT EXISTS api_demo_entornos_expira ON api_demo_entornos (expira);
CREATE INDEX IF NOT EXISTS api_demo_entornos_origen ON api_demo_entornos (origen, creado);
-- Interruptor global de la demostración: una sola fila, que cambia el dueño con la consola (demo pausar).
CREATE TABLE IF NOT EXISTS api_demo_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  pausado boolean NOT NULL DEFAULT false,
  motivo text CHECK (motivo IS NULL OR length(motivo) <= 200),
  cambiado timestamptz NOT NULL DEFAULT now()
);
INSERT INTO api_demo_control (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fhn_api_solo_insertar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- v10: la bitácora de un entorno de demostración vencido se borra con él (fhn_api_purgar_demo). Solo en la
  -- transacción que pide su purga y solo si el tenant es de prueba.
  IF TG_OP = 'DELETE' AND coalesce(current_setting('factura_hn.purga_prueba', true), '') = OLD.tenant
     AND fhn_api_modo_tenant(OLD.tenant) = 'prueba' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La bitácora de la API es de solo inserción';
END $$;
-- Las funciones de la purga de prueba buscan las tablas solo en este esquema (y pg_catalog), nunca en otro
-- que esté antes en el search_path de quien las llama.
DO $sp$ BEGIN
  EXECUTE format('ALTER FUNCTION fhn_api_solo_insertar() SET search_path = pg_catalog, %I, pg_temp', current_schema());
END $sp$;
DROP TRIGGER IF EXISTS fhn_api_bitacora_inmutable ON api_bitacora;
CREATE TRIGGER fhn_api_bitacora_inmutable BEFORE UPDATE OR DELETE ON api_bitacora
  FOR EACH ROW EXECUTE FUNCTION fhn_api_solo_insertar();

-- v3 cambia las columnas que devuelve (id y nombre de la llave) y v8 agrega el modo del tenant: hay que reemplazarla.
DROP FUNCTION IF EXISTS fhn_api_autenticar(text);
DO $do$ BEGIN
EXECUTE format($f$
-- v6: api_tenants fuerza RLS también al dueño; si el dueño no es superusuario (un Postgres administrado), el
-- JOIN sin tenant no veía ninguna fila y ninguna llave autenticaba. Se busca la llave (api_llaves no fuerza RLS
-- al dueño), se fija su tenant solo para leer api_tenants y se devuelve el valor anterior. Si algo falla, el
-- error aborta la transacción (o la subtransacción) de quien llama, y con ella se deshace el set_config.
CREATE OR REPLACE FUNCTION fhn_api_autenticar(p_prefijo text)
RETURNS TABLE (tenant text, hash bytea, rol text, establecimiento text, punto_emision text, limite_mensual integer, id uuid, nombre text, modo text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_previo text := current_setting('factura_hn.tenant', true);
  v_llave api_llaves%%ROWTYPE;
  v_limite integer;
  v_activo boolean;
  v_modo text;
BEGIN
  SELECT * INTO v_llave FROM api_llaves l WHERE l.prefijo = p_prefijo AND l.revocada IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('factura_hn.tenant', v_llave.tenant, true);
  SELECT t.limite_mensual, t.activo, t.modo INTO v_limite, v_activo, v_modo FROM api_tenants t WHERE t.tenant = v_llave.tenant;
  PERFORM set_config('factura_hn.tenant', coalesce(v_previo, ''), true);
  IF v_activo IS NOT TRUE THEN RETURN; END IF;
  RETURN QUERY SELECT v_llave.tenant, v_llave.hash, v_llave.rol, v_llave.establecimiento, v_llave.punto_emision,
    v_limite, v_llave.id, v_llave.nombre, v_modo;
END
$$$f$, current_schema());

-- v7: si un prefijo existe aunque su llave esté revocada o su tenant inactivo. La API lo usa solo para cobrar
-- el intento fallido al prefijo y no a la dirección de quien llama; la respuesta HTTP es el mismo 401.
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_prefijo_registrado(p_prefijo text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM api_llaves WHERE prefijo = p_prefijo)
$$$f$, current_schema());

-- Solo después de comprobar el secreto (la API lo llama a lo sumo una vez por minuto y llave).
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_marcar_uso(p_prefijo text, p_hash bytea)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
  UPDATE api_llaves SET ultimo_uso = now() WHERE prefijo = p_prefijo AND hash = p_hash AND revocada IS NULL
$$$f$, current_schema());

-- v9: solo tenants activos. Las entregas de un tenant desactivado se quedan PENDIENTE (no se borran ni fallan): si
-- se reactiva, salen. Como fhn_api_autenticar: api_tenants fuerza RLS también al dueño, así que se fija cada tenant
-- solo para leer su fila y al final se devuelve el valor anterior.
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_tenants_con_pendientes()
RETURNS SETOF text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
DECLARE
  v_previo text := current_setting('factura_hn.tenant', true);
  v_tenant text;
  v_activo boolean;
BEGIN
  FOR v_tenant IN SELECT DISTINCT e.tenant FROM api_entregas e WHERE e.estado = 'PENDIENTE' AND e.proximo <= now() LOOP
    PERFORM set_config('factura_hn.tenant', v_tenant, true);
    SELECT t.activo INTO v_activo FROM api_tenants t WHERE t.tenant = v_tenant;
    IF v_activo IS TRUE THEN RETURN NEXT v_tenant; END IF;
  END LOOP;
  PERFORM set_config('factura_hn.tenant', coalesce(v_previo, ''), true);
  RETURN;
END
$$$f$, current_schema());

-- v5: retención. (a) La copia guardada de la respuesta de una clave de idempotencia vieja se reduce al número
-- del documento: la clave y su huella se quedan para siempre, así que un reintento tardío nunca emite otro
-- documento. (b) Las entregas ENTREGADA o FALLIDA viejas de documento.* se borran (su clave lleva el número del
-- documento: no se vuelve a encolar). Las de autorizacion.* se quedan como lápida, con el cuerpo vacío: su
-- clave (evento:cai) es la que impide avisar dos veces. Las PENDIENTE no se tocan. v8: las de webhook.prueba
-- se borran como las de documento.* (su clave es única por prueba) y el secreto anterior de una rotación se
-- borra cuando termina su gracia.
-- api_idempotencia fuerza RLS también al dueño: se recorre tenant por tenant. Todo tenant con claves tiene
-- llaves (sin una no se emite y las llaves no se borran) y api_llaves no fuerza RLS al dueño.
-- factura_hn.tenant se guarda al entrar y se devuelve al salir: no queda fijado en la transacción de quien
-- llama. Si algo falla, el error aborta la transacción (o la subtransacción) de quien llama y con ella se
-- deshace el set_config. Sin cláusula SET en la función: en PostgreSQL 15+ fijar un parámetro propio en
-- la definición exige superusuario, y el dueño de las tablas en un Postgres administrado no lo es.
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_mantenimiento(p_dias integer)
RETURNS TABLE (compactadas bigint, entregas_borradas bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
DECLARE
  v_previo text := current_setting('factura_hn.tenant', true);
  v_limite timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 0), 7));
  v_tenant text;
  v_n bigint;
BEGIN
  compactadas := 0;
  FOR v_tenant IN SELECT tenant FROM api_llaves UNION SELECT tenant FROM api_idempotencia LOOP
    PERFORM set_config('factura_hn.tenant', v_tenant, true);
    UPDATE api_idempotencia SET respuesta = jsonb_build_object('numero', respuesta->'documento'->>'numero')
     WHERE tenant = v_tenant AND creada < v_limite AND respuesta ? 'documento';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    compactadas := compactadas + v_n;
    UPDATE api_webhooks SET secreto_anterior = NULL, anterior_hasta = NULL
     WHERE tenant = v_tenant AND anterior_hasta IS NOT NULL AND anterior_hasta <= now();
  END LOOP;
  PERFORM set_config('factura_hn.tenant', coalesce(v_previo, ''), true);
  DELETE FROM api_entregas
   WHERE estado IN ('ENTREGADA', 'FALLIDA') AND creada < v_limite AND (evento LIKE 'documento.%%' OR evento = 'webhook.prueba');
  GET DIAGNOSTICS entregas_borradas = ROW_COUNT;
  UPDATE api_entregas SET cuerpo = '{}'::jsonb
   WHERE estado IN ('ENTREGADA', 'FALLIDA') AND creada < v_limite AND evento LIKE 'autorizacion.%%' AND cuerpo <> '{}'::jsonb;
  RETURN NEXT;
END
$$$f$, current_schema());
-- v8: modo del tenant de una autorización, para el disparador de fhn_autorizaciones. null si el tenant no es de
-- la API (uso del SDK sin api_tenants). Como fhn_api_autenticar: fija el tenant solo para leer api_tenants y
-- devuelve el valor anterior.
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_modo_tenant(p_tenant text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
DECLARE
  v_previo text := current_setting('factura_hn.tenant', true);
  v_modo text;
BEGIN
  PERFORM set_config('factura_hn.tenant', p_tenant, true);
  SELECT t.modo INTO v_modo FROM api_tenants t WHERE t.tenant = p_tenant;
  PERFORM set_config('factura_hn.tenant', coalesce(v_previo, ''), true);
  RETURN v_modo;
END
$$$f$, current_schema());

-- v10: crea el tenant de un entorno de demostración, con los cupos revisados bajo un candado (sin carreras entre
-- solicitudes simultáneas). Solo crea tenants de prueba y solo el de la transacción de quien llama. Devuelve
-- 'ok', 'pausado', 'por_origen' o 'global', y en cuántos segundos se libera un cupo.
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_crear_entorno_demo(p_tenant text, p_nombre text, p_creado timestamptz, p_expira timestamptz,
  p_origen text, p_max_por_origen integer, p_max_activos integer, p_limite_documentos integer)
RETURNS TABLE (estado text, reintentar_en integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_n integer;
  v_libre timestamptz;
BEGIN
  IF p_tenant IS NULL OR p_tenant <> coalesce(current_setting('factura_hn.tenant', true), '') THEN
    RAISE EXCEPTION 'fhn_api_crear_entorno_demo: el tenant debe ser el de la transacción';
  END IF;
  IF p_expira <= p_creado OR p_expira > p_creado + interval '7 days' THEN
    RAISE EXCEPTION 'fhn_api_crear_entorno_demo: vencimiento fuera de rango';
  END IF;
  PERFORM pg_advisory_xact_lock(4823191);
  IF coalesce((SELECT c.pausado FROM api_demo_control c WHERE c.id), false) THEN
    RETURN QUERY SELECT 'pausado'::text, 3600;
    RETURN;
  END IF;
  SELECT count(*), min(e.creado) INTO v_n, v_libre FROM api_demo_entornos e
   WHERE e.origen = p_origen AND e.creado > p_creado - interval '1 day' AND e.creado <= p_creado;
  IF v_n >= p_max_por_origen THEN
    RETURN QUERY SELECT 'por_origen'::text, least(86400, greatest(1, ceil(extract(epoch FROM (v_libre + interval '1 day' - p_creado)))))::integer;
    RETURN;
  END IF;
  SELECT count(*), min(e.expira) INTO v_n, v_libre FROM api_demo_entornos e WHERE e.expira > p_creado AND e.creado <= p_creado;
  IF v_n >= p_max_activos THEN
    RETURN QUERY SELECT 'global'::text, least(604800, greatest(60, ceil(extract(epoch FROM (v_libre - p_creado)))))::integer;
    RETURN;
  END IF;
  INSERT INTO api_tenants (tenant, nombre, limite_mensual, modo) VALUES (p_tenant, p_nombre, p_limite_documentos, 'prueba');
  INSERT INTO api_demo_entornos (tenant, creado, expira, origen) VALUES (p_tenant, p_creado, p_expira, p_origen);
  INSERT INTO api_bitacora (tenant, actor, accion, detalle)
    VALUES (p_tenant, 'demo', 'tenant.creado', jsonb_build_object('modo', 'prueba', 'expira', p_expira));
  RETURN QUERY SELECT 'ok'::text, 0;
END
$$$f$, current_schema());

-- v10: borra los entornos de demostración vencidos, cada uno con todos sus datos. Corre como el dueño de las tablas
-- (el rol de la aplicación no tiene DELETE). Solo toca tenants de prueba registrados en api_demo_entornos; los
-- disparadores que impiden borrar dejan pasar solo esta purga (factura_hn.purga_prueba = el tenant) y solo con CAI
-- ficticios. Devuelve cuántos entornos borró.
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_purgar_demo(p_ahora timestamptz, p_maximo integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
DECLARE
  v_previo text := current_setting('factura_hn.tenant', true);
  v_tenant text;
  v_modo text;
  v_n integer := 0;
  -- Nunca más adelante que el reloj de la base: quien llama no puede vencer antes de tiempo un entorno vigente.
  v_ahora timestamptz := least(p_ahora, now());
BEGIN
  FOR v_tenant IN SELECT e.tenant FROM api_demo_entornos e WHERE e.expira <= v_ahora ORDER BY e.expira
                   LIMIT greatest(coalesce(p_maximo, 0), 0) FOR UPDATE SKIP LOCKED LOOP
    PERFORM set_config('factura_hn.tenant', v_tenant, true);
    SELECT t.modo INTO v_modo FROM api_tenants t WHERE t.tenant = v_tenant;
    IF v_modo IS DISTINCT FROM 'prueba' THEN
      RAISE WARNING 'factura-hn: el entorno de demostración %% no es de prueba; no se borra', v_tenant;
      CONTINUE;
    END IF;
    -- Cada entorno en su propio bloque: si la base niega borrar algo (p. ej. un CAI real, que un tenant de prueba
    -- no puede tener), ese entorno queda con un aviso y los demás se borran igual.
    BEGIN
    PERFORM set_config('factura_hn.purga_prueba', v_tenant, true);
    DELETE FROM api_entregas WHERE tenant = v_tenant;
    DELETE FROM api_webhooks WHERE tenant = v_tenant;
    DELETE FROM api_llaves WHERE tenant = v_tenant;
    DELETE FROM api_emisores WHERE tenant = v_tenant;
    DELETE FROM api_uso WHERE tenant = v_tenant;
    DELETE FROM api_idempotencia WHERE tenant = v_tenant;
    DELETE FROM api_bitacora WHERE tenant = v_tenant;
    DELETE FROM fhn_documentos WHERE tenant = v_tenant;
    DELETE FROM fhn_eventos WHERE tenant = v_tenant;
    DELETE FROM fhn_series WHERE tenant = v_tenant;
    DELETE FROM fhn_autorizaciones WHERE tenant = v_tenant;
    DELETE FROM api_demo_entornos WHERE tenant = v_tenant;
    DELETE FROM api_tenants WHERE tenant = v_tenant;
    PERFORM set_config('factura_hn.purga_prueba', '', true);
    v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('factura_hn.purga_prueba', '', true);
      RAISE WARNING 'factura-hn: el entorno de demostración %% no se pudo borrar: %%', v_tenant, SQLERRM;
    END;
  END LOOP;
  PERFORM set_config('factura_hn.purga_prueba', '', true);
  PERFORM set_config('factura_hn.tenant', coalesce(v_previo, ''), true);
  RETURN v_n;
END
$$$f$, current_schema());

-- v10: cifras de la demostración, sin datos de ningún entorno (consola y /salud del modo demo).
EXECUTE format($f$
CREATE OR REPLACE FUNCTION fhn_api_demo_resumen(p_ahora timestamptz)
RETURNS TABLE (activos bigint, vencidos bigint, pausado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $$
  SELECT (SELECT count(*) FROM api_demo_entornos WHERE expira > p_ahora),
         (SELECT count(*) FROM api_demo_entornos WHERE expira <= p_ahora),
         coalesce((SELECT pausado FROM api_demo_control WHERE id), false)
$$$f$, current_schema());
END $do$;

-- v8: el modo del tenant decide qué CAI se registran, por cualquier camino (la API o el SDK sobre la base de la
-- API): un tenant de prueba solo CAI ficticios (AUTORIZACION_REAL_EN_DEMO) y uno de producción ninguno
-- (CAI_DE_PRUEBA). Un tenant sin fila en api_tenants (solo el SDK) no cambia. Solo al insertar: las autorizaciones
-- que ya estaban no se tocan.
CREATE OR REPLACE FUNCTION fhn_api_autorizacion_por_modo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_modo text := fhn_api_modo_tenant(NEW.tenant);
  v_ficticio boolean := starts_with(upper(btrim(NEW.cai)), 'DEMO00-NO-VALIDO-');
BEGIN
  IF v_modo = 'prueba' AND NOT v_ficticio THEN
    RAISE EXCEPTION 'AUTORIZACION_REAL_EN_DEMO: el tenant % es de prueba y solo acepta CAI ficticios (DEMO00-NO-VALIDO-…)', NEW.tenant
      USING ERRCODE = 'check_violation';
  ELSIF v_modo = 'produccion' AND v_ficticio THEN
    RAISE EXCEPTION 'CAI_DE_PRUEBA: el tenant % es de producción y no acepta CAI ficticios', NEW.tenant
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fhn_api_autorizacion_por_modo ON fhn_autorizaciones;
CREATE TRIGGER fhn_api_autorizacion_por_modo BEFORE INSERT ON fhn_autorizaciones
  FOR EACH ROW EXECUTE FUNCTION fhn_api_autorizacion_por_modo();
REVOKE ALL ON FUNCTION fhn_api_modo_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_mantenimiento(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_autenticar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_prefijo_registrado(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_tenants_con_pendientes() FROM PUBLIC;
COMMENT ON FUNCTION fhn_api_tenants_con_pendientes() IS '${MARCA_PENDIENTES_V9}';
REVOKE ALL ON FUNCTION fhn_api_marcar_uso(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_crear_entorno_demo(text, text, timestamptz, timestamptz, text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_purgar_demo(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION fhn_api_demo_resumen(timestamptz) FROM PUBLIC;
-- En un Postgres administrado (Supabase), los privilegios por defecto dan EXECUTE de las funciones nuevas a sus roles
-- de la API de datos: se quitan también, si existen. Solo el rol de la aplicación las ejecuta.
DO $do$
DECLARE
  v_rol text;
  v_fn text;
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) THEN
      FOREACH v_fn IN ARRAY ARRAY[
        'fhn_api_crear_entorno_demo(text, text, timestamptz, timestamptz, text, integer, integer, integer)',
        'fhn_api_purgar_demo(timestamptz, integer)', 'fhn_api_demo_resumen(timestamptz)', 'fhn_api_modo_tenant(text)',
        'fhn_api_mantenimiento(integer)', 'fhn_api_autenticar(text)', 'fhn_api_prefijo_registrado(text)',
        'fhn_api_tenants_con_pendientes()', 'fhn_api_marcar_uso(text, bytea)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_fn, v_rol);
      END LOOP;
    END IF;
  END LOOP;
END $do$;
`;

/**
 * En Supabase, los privilegios por defecto del esquema `public` dan todas las tablas y secuencias nuevas a los roles de
 * su API de datos (`anon`, `authenticated`, `service_role`), y esa API las publica por HTTP con una llave que es
 * pública por diseño. Las tablas sin RLS (`api_demo_control`, `fhn_migraciones`) quedarían a la vista y modificables
 * desde internet. Se quitan esos privilegios en cada migración, solo en las tablas, secuencias y funciones de factura-hn
 * (`fhn_*`, `api_*`) del esquema: lo demás que haya en el esquema no se toca. Las funciones pierden también el EXECUTE
 * de PUBLIC. No se cambian los privilegios por defecto del esquema: en Postgres, un REVOKE por esquema no quita el
 * EXECUTE global de PUBLIC, y quitarles a los roles de Supabase los suyos afectaría a otros objetos del esquema.
 */
function sinRolesApiDeDatos(rol: string, login?: string): string {
  if (!ROL.test(rol) || (login !== undefined && !ROL.test(login))) throw new Error('Nombre de rol inválido');
  const conservan = [rol, ...(login ? [login] : [])].map((r) => `'${r}'`).join(', ');
  return `DO $do$
DECLARE
  v_rol text;
  v_obj record;
  v_quien text;
  v_pueden text[];
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) THEN
      FOR v_obj IN
        SELECT c.relname, c.relkind FROM pg_class c
         WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
           AND (c.relname LIKE 'fhn\\_%' OR c.relname LIKE 'api\\_%')
      LOOP
        EXECUTE format('REVOKE ALL ON %s %I FROM %I', CASE WHEN v_obj.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, v_obj.relname, v_rol);
      END LOOP;
    END IF;
  END LOOP;
  -- Funciones: nadie las ejecuta por PUBLIC ni por los roles de la API de datos. El rol de la aplicación (y el LOGIN
  -- de la API) conservan exactamente las que ya podían ejecutar, ahora con un permiso propio.
  FOR v_obj IN
    SELECT p.oid::regprocedure AS firma FROM pg_proc p
     WHERE p.pronamespace = current_schema()::regnamespace AND p.prokind IN ('f', 'p')
       AND (p.proname LIKE 'fhn\\_%' OR p.proname LIKE 'api\\_%')
  LOOP
    v_pueden := ARRAY(SELECT r FROM unnest(ARRAY[${conservan}]) AS r
                       WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, v_obj.firma, 'EXECUTE'));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_obj.firma);
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', v_obj.firma, v_rol);
      END IF;
    END LOOP;
    FOREACH v_quien IN ARRAY v_pueden LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v_obj.firma, v_quien);
    END LOOP;
  END LOOP;
END $do$;`;
}

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
GRANT UPDATE (activo, secreto, secreto_anterior, anterior_hasta) ON api_webhooks TO ${rol};
GRANT SELECT, INSERT ON api_entregas TO ${rol};
GRANT UPDATE (estado, intentos, proximo, ultimo_codigo, ultimo_error) ON api_entregas TO ${rol};
GRANT SELECT, INSERT, UPDATE ON api_uso TO ${rol};
GRANT SELECT, INSERT ON api_bitacora TO ${rol};
GRANT USAGE ON SEQUENCE api_entregas_id_seq, api_bitacora_id_seq TO ${rol};
GRANT SELECT ON api_demo_entornos, api_demo_control TO ${rol};
GRANT EXECUTE ON FUNCTION fhn_api_crear_entorno_demo(text, text, timestamptz, timestamptz, text, integer, integer, integer), fhn_api_purgar_demo(timestamptz, integer), fhn_api_demo_resumen(timestamptz) TO ${rol};
GRANT EXECUTE ON FUNCTION fhn_api_autenticar(text), fhn_api_modo_tenant(text), fhn_api_prefijo_registrado(text), fhn_api_tenants_con_pendientes(), fhn_api_marcar_uso(text, bytea), fhn_api_mantenimiento(integer) TO ${rol};`;
}

/**
 * SQL que crea (si no existe) un rol LOGIN para correr la API y le concede el rol de la aplicación. El rol se
 * crea sin contraseña (dentro de Compose rige `trust`), sin privilegios de administración y con NOINHERIT: por
 * sí solo no tiene ningún permiso sobre las tablas; solo puede pasar al rol de la aplicación con `SET ROLE`.
 */
export function rolLoginApi(login: string, rol = ROL_POR_DEFECTO): string {
  if (!ROL.test(login)) throw new Error(`Nombre de rol inválido: ${login}`);
  if (!ROL.test(rol)) throw new Error(`Nombre de rol inválido: ${rol}`);
  if (login === rol) throw new Error('El rol LOGIN de la API debe ser distinto del rol de la aplicación.');
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${login}') THEN
    CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
GRANT ${rol} TO ${login};`;
}

export interface OpcionesMigrarApi {
  /** Rol LOGIN con el que corre la API (no es dueño de las tablas). Se crea si no existe y recibe `rol`. */
  login?: string;
}

/**
 * Crea o actualiza las tablas fiscales y las de la API, con RLS y el rol de la aplicación. Una vez por
 * versión (tabla `fhn_migraciones`), protegida con un candado para varias réplicas. Todo el SQL es
 * idempotente: una versión nueva lo vuelve a aplicar completo. Debe correr con el dueño de las tablas.
 */
export async function migrarApi(pool: pg.Pool, rol = ROL_POR_DEFECTO, opciones: OpcionesMigrarApi = {}): Promise<void> {
  const sqlLogin = opciones.login ? rolLoginApi(opciones.login, rol) : null;
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
    // Fuera de la clave de versión: el rol LOGIN puede cambiar sin que cambie el esquema.
    if (sqlLogin) await c.query(sqlLogin);
    // También fuera: los privilegios por defecto de un Postgres administrado pueden haber dado las tablas a otros roles.
    await c.query(sinRolesApiDeDatos(rol, opciones.login));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Función que añadió la v7 del esquema: si el rol de la API no la ve, la base no está migrada. */
export const MARCA_ESQUEMA_API = 'fhn_api_prefijo_registrado(text)';
/** Columnas que añadió la v8: la rotación del secreto de webhooks (el rol de la API debe poder actualizarla) y el
 * modo del tenant. */
export const MARCA_COLUMNA_API = { tabla: 'api_webhooks', columna: 'anterior_hasta' } as const;
export const MARCA_MODO_API = 'api_tenants.modo';

/**
 * Falla con un mensaje claro si la base tiene el esquema de la API en una versión anterior a la del código.
 * Corre con la conexión de la API (no hace falta ser dueño de las tablas). Sin esto, una base sin migrar
 * respondería 500 a cada llave no válida.
 */
export async function exigirEsquemaApi(pool: pg.Pool, rol = ROL_POR_DEFECTO, consola = 'node packages/api/dist/cli.js'): Promise<void> {
  // La columna se busca en pg_attribute antes de preguntar el privilegio: has_column_privilege falla si no existe.
  const r = await pool.query<{ ok: boolean }>(
    `SELECT coalesce(has_function_privilege($2, to_regprocedure($1), 'EXECUTE'), false)
        AND CASE WHEN EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass($3) AND attname = $4 AND NOT attisdropped)
                 THEN has_column_privilege($2, to_regclass($3), $4, 'UPDATE') ELSE false END
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('api_tenants') AND attname = 'modo' AND NOT attisdropped)
        AND coalesce(obj_description(to_regprocedure('fhn_api_tenants_con_pendientes()'), 'pg_proc'), '') = $5
        AND coalesce(has_function_privilege($2, to_regprocedure('fhn_api_purgar_demo(timestamptz,integer)'), 'EXECUTE'), false) AS ok`,
    [MARCA_ESQUEMA_API, rol, MARCA_COLUMNA_API.tabla, MARCA_COLUMNA_API.columna, MARCA_PENDIENTES_V9],
  );
  if (r.rows[0]?.ok) return;
  throw new Error(
    `La base tiene el esquema de la API en una versión anterior a la ${VERSION_ESQUEMA_API} que necesita este código ` +
      `(falta ${MARCA_ESQUEMA_API}, ${MARCA_COLUMNA_API.tabla}.${MARCA_COLUMNA_API.columna}, ${MARCA_MODO_API} o la v9 de ` +
      `fhn_api_tenants_con_pendientes(), las funciones de la demostración (v10), o el rol de ` +
      'la API no puede usarlas). Migra antes de arrancar: arranca con ' +
      `FHN_MIGRAR_URL (conexión del dueño de las tablas; la API migra al arrancar) o corre «${consola} migrar» ` +
      'con FHN_MIGRAR_URL o DATABASE_URL del dueño. Ver docs/autoalojamiento.md.',
  );
}

/** Días que se guarda la copia completa de una respuesta idempotente y una entrega terminada. */
export const RETENCION_POR_DEFECTO = 30;
/** Mínimo que aplica la base, aunque se pida menos. */
export const RETENCION_MINIMA = 7;

/**
 * Mantenimiento de retención (`fhn_api_mantenimiento`), como el rol de la aplicación. Compacta las claves de
 * idempotencia de más de `dias` días (las conserva con su huella y el número del documento) y borra las
 * entregas terminadas de más de `dias` días. `dias` nunca baja de 7.
 */
export async function mantenimientoApi(pool: pg.Pool, rol = ROL_POR_DEFECTO, dias = RETENCION_POR_DEFECTO): Promise<{ compactadas: number; entregasBorradas: number }> {
  if (!Number.isInteger(dias) || dias < 0) throw new Error(`Días de retención inválidos: ${dias}`);
  const almacen = new AlmacenPostgres(pool, { rol });
  return almacen.transaccion(async (t) => {
    if (!esTransaccionPostgres(t)) throw new Error('La API requiere el almacén de Postgres.');
    const f = (await t.consulta<{ compactadas: string; entregas_borradas: string }>('SELECT compactadas, entregas_borradas FROM fhn_api_mantenimiento($1)', [dias])).rows[0]!;
    return { compactadas: Number(f.compactadas), entregasBorradas: Number(f.entregas_borradas) };
  });
}
