/**
 * @factura-hn/postgres — `AlmacenFiscal` sobre PostgreSQL (≥ 13) con `pg` (o cualquier pool compatible).
 *
 * Garantías:
 * - La serie de cada identificador se bloquea con `SELECT … FOR UPDATE`: varias cajas o réplicas de la API
 *   se serializan por serie (no globalmente) y no repiten correlativos.
 * - Todo o nada: si algo falla dentro de la transacción, `ROLLBACK` y el número no se consume.
 * - La base se protege sola con disparadores: los documentos no se borran, uno emitido solo pasa a
 *   ANULADO (Art. 41) y la serie nunca retrocede.
 * - Cada fila lleva `tenant`. Cada transacción fija `factura_hn.tenant` con `set_config(…, true)`. Con
 *   `migrar({ rls: { rol } })` las tablas quedan con políticas RLS por tenant (FORCE) y, con la opción
 *   `rol`, cada transacción corre como ese rol sin BYPASSRLS: un tenant no puede leer ni escribir filas de
 *   otro aunque una consulta olvide el filtro. En modo local (un solo negocio) el tenant es `''`.
 *
 * @example
 * import pg from 'pg';
 * import { AlmacenPostgres } from '@factura-hn/postgres';
 * const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
 * await almacen.migrar();
 */
import { identificadorDe, identificadorDeNumero } from 'factura-hn';
import type {
  AlmacenFiscal,
  AutorizacionCAI,
  DocumentoFiscal,
  EstadoSerie,
  EventoAuditoria,
  FiltroDocumentos,
  FiltroEventos,
  PaginaDocumentos,
  ResumenDocumento,
  TransaccionFiscal,
} from 'factura-hn';

export interface ResultadoConsulta<F = Record<string, unknown>> {
  rows: F[];
  rowCount: number | null;
}

export interface ClientePostgres {
  query<F = Record<string, unknown>>(texto: string, parametros?: unknown[]): Promise<ResultadoConsulta<F>>;
  /** `pg` destruye la conexión si recibe un error o `true`. */
  release(destruir?: boolean | Error): void;
  /**
   * Eventos de `pg.Client`. Mientras la conexión está prestada, `pg-pool` no escucha su `error`: sin un
   * manejador, una conexión cortada por el servidor tumba el proceso.
   */
  on?(evento: 'error', fn: (e: Error) => void): unknown;
  removeListener?(evento: 'error', fn: (e: Error) => void): unknown;
}

/** Lo mínimo que el adaptador necesita: un pool como `pg.Pool`. */
export interface PoolPostgres {
  connect(): Promise<ClientePostgres>;
}

export interface OpcionesAlmacenPostgres {
  /** Inquilino (negocio). Por defecto `''` (instalación de un solo negocio). */
  tenant?: string;
  /**
   * Rol con el que corre cada transacción (`SET LOCAL ROLE`), creado por `migrar({ rls: { rol } })`.
   * Hace falta si la conexión es dueña de las tablas o superusuario: esos roles se saltan las políticas.
   */
  rol?: string;
}

/** Opciones de una transacción de `AlmacenPostgres`. */
export interface OpcionesTransaccionPostgres {
  /**
   * Transacción de solo lectura con aislamiento REPEATABLE READ: todas sus consultas ven la misma instantánea.
   * Para reportes que cuentan y luego leen por páginas (el conteo coincide con las filas leídas).
   */
  soloLectura?: boolean;
}

/** Transacción de `AlmacenPostgres`: además del contrato, da acceso SQL a la misma transacción y tenant. */
export interface TransaccionPostgres extends TransaccionFiscal {
  readonly tenant: string;
  /** Consulta dentro de la transacción fiscal (mismo `BEGIN`, mismo tenant y rol). */
  consulta<F = Record<string, unknown>>(texto: string, parametros?: unknown[]): Promise<ResultadoConsulta<F>>;
}

export function esTransaccionPostgres(tx: TransaccionFiscal): tx is TransaccionPostgres {
  return typeof (tx as Partial<TransaccionPostgres>).consulta === 'function';
}

const PATRON_ROL = /^[a-z_][a-z0-9_]{0,62}$/;
function rolValido(rol: string): string {
  if (!PATRON_ROL.test(rol)) throw new Error(`Nombre de rol inválido: ${rol}`);
  return rol;
}

/** Tablas del almacén fiscal; la API agrega las suyas con `politicasRLS`. */
export const TABLAS_FISCALES = ['fhn_series', 'fhn_autorizaciones', 'fhn_documentos', 'fhn_eventos'] as const;

/**
 * SQL idempotente que crea el rol (NOLOGIN, sin BYPASSRLS) y activa RLS forzada en `tablas`, con una
 * política por tenant: solo se ven y se escriben filas con `tenant = current_setting('factura_hn.tenant')`.
 * Sin tenant fijado no se ve nada (por defecto, denegar).
 *
 * Con `forzar: false` la política no aplica al dueño de la tabla: solo para tablas que una función
 * `SECURITY DEFINER` del dueño debe leer sin tenant (p. ej. buscar una llave de API antes de saber de
 * qué tenant es).
 */
export function politicasRLS(rol: string, tablas: readonly string[], opciones: { forzar?: boolean } = {}): string {
  const forzar = opciones.forzar ?? true;
  const r = rolValido(rol);
  const partes = [
    `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} NOLOGIN NOBYPASSRLS; END IF;
END $$;`,
    `DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO ${r}', current_schema()); END $$;`,
    `GRANT ${r} TO CURRENT_USER;`,
  ];
  for (const t of tablas) {
    if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`Nombre de tabla inválido: ${t}`);
    partes.push(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${t} ${forzar ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fhn_por_tenant ON ${t};
CREATE POLICY fhn_por_tenant ON ${t}
  USING (tenant = current_setting('factura_hn.tenant', true))
  WITH CHECK (tenant = current_setting('factura_hn.tenant', true));`);
  }
  return partes.join('\n');
}

/** Permisos del rol sobre las tablas fiscales: sin DELETE; la bitácora solo admite INSERT y SELECT. */
function permisosFiscales(rol: string): string {
  const r = rolValido(rol);
  return `GRANT SELECT, INSERT, UPDATE ON fhn_series, fhn_documentos TO ${r};
GRANT SELECT, INSERT ON fhn_autorizaciones TO ${r};
REVOKE UPDATE, DELETE ON fhn_autorizaciones FROM ${r};
GRANT SELECT, INSERT ON fhn_eventos TO ${r};
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SEQUENCE %s TO ${r}', pg_get_serial_sequence('fhn_eventos', 'id')); END $$;`;
}

export const VERSION_ESQUEMA_POSTGRES = 4;

/** Esquema idempotente; `migrar()` lo aplica con un candado consultivo para no chocar entre réplicas. */
export const ESQUEMA_POSTGRES = `
CREATE TABLE IF NOT EXISTS fhn_series (
  tenant text NOT NULL,
  identificador text NOT NULL,
  ultimo integer,
  ultima_fecha date,
  PRIMARY KEY (tenant, identificador)
);
CREATE TABLE IF NOT EXISTS fhn_autorizaciones (
  tenant text NOT NULL,
  identificador text NOT NULL,
  cai text NOT NULL,
  rango_inicial integer NOT NULL,
  rango_final integer NOT NULL,
  datos json NOT NULL,
  registrada timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, identificador, cai)
);
CREATE TABLE IF NOT EXISTS fhn_documentos (
  tenant text NOT NULL,
  numero text NOT NULL,
  identificador text NOT NULL,
  correlativo integer NOT NULL,
  fecha_emision date NOT NULL,
  estado text NOT NULL CHECK (estado IN ('EMITIDO', 'ANULADO')),
  datos json NOT NULL,
  PRIMARY KEY (tenant, numero),
  UNIQUE (tenant, identificador, correlativo)
);
CREATE INDEX IF NOT EXISTS fhn_documentos_fecha ON fhn_documentos (tenant, fecha_emision, numero);
-- Notas de un documento (suma de notas de crédito sobre un original).
CREATE INDEX IF NOT EXISTS fhn_documentos_referencia ON fhn_documentos (tenant, (datos->'referencia'->>'numero'))
  WHERE datos->'referencia' IS NOT NULL;
-- Bitácora de auditoría: solo inserción.
CREATE TABLE IF NOT EXISTS fhn_eventos (
  id bigserial PRIMARY KEY,
  tenant text NOT NULL,
  tipo text NOT NULL,
  identificador text,
  numero text,
  instante timestamptz NOT NULL,
  datos json NOT NULL
);
CREATE INDEX IF NOT EXISTS fhn_eventos_identificador ON fhn_eventos (tenant, identificador, id);

-- v4: purga de datos de prueba. Un documento o una autorización con CAI ficticio (DEMO00-NO-VALIDO-…) no tiene
-- valor fiscal. Se puede borrar solo si la transacción pide la purga de ese tenant
-- (factura_hn.purga_prueba = tenant) y el tenant no tiene ninguna autorización con un CAI real; entonces se borran
-- también sus series y su bitácora. Solo el dueño de las tablas tiene DELETE (el rol de la aplicación no). Un
-- documento con CAI real nunca se borra (Art. 41).
CREATE OR REPLACE FUNCTION fhn_purga_prueba_permitida(p_tenant text) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT p_tenant <> '' AND coalesce(current_setting('factura_hn.purga_prueba', true), '') = p_tenant
     AND NOT EXISTS (SELECT 1 FROM fhn_autorizaciones a
                      WHERE a.tenant = p_tenant AND NOT starts_with(upper(btrim(a.cai)), 'DEMO00-NO-VALIDO-'))
$f$;

CREATE OR REPLACE FUNCTION fhn_no_borrar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF fhn_purga_prueba_permitida(OLD.tenant) THEN
    IF TG_TABLE_NAME = 'fhn_documentos' THEN
      IF starts_with(upper(btrim(coalesce(OLD.datos->>'cai', ''))), 'DEMO00-NO-VALIDO-') THEN RETURN OLD; END IF;
    ELSIF TG_TABLE_NAME = 'fhn_autorizaciones' THEN
      IF starts_with(upper(btrim(OLD.cai)), 'DEMO00-NO-VALIDO-') THEN RETURN OLD; END IF;
    ELSE
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'factura-hn: % no se borran (Art. 41)', TG_TABLE_NAME;
END $$;

CREATE OR REPLACE FUNCTION fhn_solo_anular() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.estado = 'EMITIDO' AND NEW.estado = 'ANULADO' AND NEW.tenant = OLD.tenant
          AND NEW.numero = OLD.numero AND NEW.identificador = OLD.identificador
          AND NEW.correlativo = OLD.correlativo AND NEW.fecha_emision = OLD.fecha_emision
          -- Al anular, el contenido no cambia: solo «estado» y «anulacion» (Art. 41; Art. 53 num. 2).
          AND (NEW.datos::jsonb - 'estado' - 'anulacion') = (OLD.datos::jsonb - 'estado' - 'anulacion')) THEN
    RAISE EXCEPTION 'factura-hn: un documento emitido solo puede anularse (Art. 41)';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fhn_serie_solo_avanza() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- La serie nunca retrocede (la unicidad de fhn_documentos impide repetir); ultima_fecha sí puede bajar
  -- al anular un documento con fecha errónea.
  IF OLD.ultimo IS NOT NULL AND (NEW.ultimo IS NULL OR NEW.ultimo < OLD.ultimo) THEN
    RAISE EXCEPTION 'factura-hn: la serie de correlativos no retrocede';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fhn_documentos_sin_borrar ON fhn_documentos;
CREATE TRIGGER fhn_documentos_sin_borrar BEFORE DELETE ON fhn_documentos FOR EACH ROW EXECUTE FUNCTION fhn_no_borrar();
CREATE OR REPLACE FUNCTION fhn_autorizacion_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'factura-hn: las autorizaciones registradas no se modifican';
END $$;
DROP TRIGGER IF EXISTS fhn_autorizaciones_sin_editar ON fhn_autorizaciones;
-- Art. 53 num. 2 y Art. 62: una autorización registrada no se edita (rango ni fecha límite).
CREATE TRIGGER fhn_autorizaciones_sin_editar BEFORE UPDATE ON fhn_autorizaciones FOR EACH ROW EXECUTE FUNCTION fhn_autorizacion_inmutable();
DROP TRIGGER IF EXISTS fhn_autorizaciones_sin_borrar ON fhn_autorizaciones;
CREATE TRIGGER fhn_autorizaciones_sin_borrar BEFORE DELETE ON fhn_autorizaciones FOR EACH ROW EXECUTE FUNCTION fhn_no_borrar();
DROP TRIGGER IF EXISTS fhn_documentos_solo_anular ON fhn_documentos;
CREATE TRIGGER fhn_documentos_solo_anular BEFORE UPDATE ON fhn_documentos FOR EACH ROW EXECUTE FUNCTION fhn_solo_anular();
CREATE OR REPLACE FUNCTION fhn_bitacora_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- v4: la bitácora de un tenant solo de prueba se borra con él en la purga (ver fhn_no_borrar).
  IF TG_OP = 'DELETE' AND fhn_purga_prueba_permitida(OLD.tenant) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'factura-hn: la bitácora no se modifica';
END $$;

DROP TRIGGER IF EXISTS fhn_eventos_inmutables ON fhn_eventos;
CREATE TRIGGER fhn_eventos_inmutables BEFORE UPDATE OR DELETE ON fhn_eventos FOR EACH ROW EXECUTE FUNCTION fhn_bitacora_inmutable();
DROP TRIGGER IF EXISTS fhn_series_sin_borrar ON fhn_series;
CREATE TRIGGER fhn_series_sin_borrar BEFORE DELETE ON fhn_series FOR EACH ROW EXECUTE FUNCTION fhn_no_borrar();
DROP TRIGGER IF EXISTS fhn_series_solo_avanza ON fhn_series;
CREATE TRIGGER fhn_series_solo_avanza BEFORE UPDATE ON fhn_series FOR EACH ROW EXECUTE FUNCTION fhn_serie_solo_avanza();
`;

/** Clave del candado consultivo de `migrar()` («fhn» en ASCII). */
const CANDADO_MIGRACION = 0x66686e;

interface FilaDatos {
  datos: unknown;
}

/** `pg` entrega `json` ya parseado; otros drivers pueden entregar texto. */
const leer = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

/** Condiciones SQL de `FiltroDocumentos` (parámetros posicionales; `$1` es el tenant). */
function condicionesDocumentos(tenant: string, filtro: FiltroDocumentos) {
  const donde = ['tenant = $1'];
  const parametros: unknown[] = [tenant];
  const agregar = (sql: string, v: unknown) => {
    parametros.push(v);
    donde.push(sql.replace('?', `$${parametros.length}`));
  };
  if (filtro.desde) agregar('fecha_emision >= ?', filtro.desde);
  if (filtro.hasta) agregar('fecha_emision <= ?', filtro.hasta);
  if (filtro.identificador) agregar('identificador = ?', filtro.identificador);
  if (filtro.tipoDocumento) agregar("datos->>'tipoDocumento' = ?", filtro.tipoDocumento);
  if (filtro.referencia) agregar("datos->'referencia'->>'numero' = ?", filtro.referencia);
  return { donde, parametros, agregar };
}

export class AlmacenPostgres implements AlmacenFiscal {
  private readonly tenant: string;
  private readonly rol: string | null;

  constructor(
    private readonly pool: PoolPostgres,
    opciones: OpcionesAlmacenPostgres = {},
  ) {
    this.tenant = opciones.tenant ?? '';
    this.rol = opciones.rol ? rolValido(opciones.rol) : null;
  }

  /**
   * Crea o actualiza las tablas, funciones y disparadores `fhn_*`. Seguro de llamar en cada arranque.
   * Con `rls`, además crea el rol y las políticas por tenant (ver `politicasRLS`).
   */
  async migrar(opciones: { rls?: { rol: string } } = {}): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock($1)', [CANDADO_MIGRACION]);
      // El DDL toma candados exclusivos sobre las tablas: se aplica una sola vez por versión, para que el
      // arranque de una réplica no choque con las emisiones de las demás.
      await c.query('CREATE TABLE IF NOT EXISTS fhn_migraciones (clave text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())');
      const aplicar = async (clave: string, sql: string) => {
        const r = await c.query('SELECT 1 FROM fhn_migraciones WHERE clave = $1', [clave]);
        if (r.rowCount) return;
        await c.query(sql);
        await c.query('INSERT INTO fhn_migraciones (clave) VALUES ($1)', [clave]);
      };
      await aplicar(`esquema-v${VERSION_ESQUEMA_POSTGRES}`, ESQUEMA_POSTGRES);
      if (opciones.rls) {
        const rol = rolValido(opciones.rls.rol);
        await aplicar(`rls-${rol}-v${VERSION_ESQUEMA_POSTGRES}`, `${politicasRLS(rol, TABLAS_FISCALES)}
${permisosFiscales(rol)}`);
      }
      await c.query('COMMIT');
      c.release();
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release(true);
      throw e;
    }
  }

  /** Un almacén del mismo pool para otro inquilino. */
  paraTenant(tenant: string): AlmacenPostgres {
    return new AlmacenPostgres(this.pool, { tenant, rol: this.rol ?? undefined });
  }

  async transaccion<T>(fn: (tx: TransaccionFiscal) => Promise<T>, opciones: OpcionesTransaccionPostgres = {}): Promise<T> {
    const c = await this.pool.connect();
    // La conexión puede caerse mientras está prestada (p. ej. un reporte transmitido que espera al cliente). El
    // error se registra aquí para no tumbar el proceso; la siguiente consulta falla y la conexión se descarta.
    let errorConexion: Error | null = null;
    const alError = (e: Error) => {
      errorConexion = e;
    };
    c.on?.('error', alError);
    const devolver = (destruir: boolean) => {
      c.removeListener?.('error', alError);
      c.release(destruir || errorConexion !== null);
    };
    try {
      await c.query(opciones.soloLectura ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      if (this.rol) await c.query(`SET LOCAL ROLE ${this.rol}`);
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [this.tenant]);
      const resultado = await fn(this.tx(c));
      await c.query('COMMIT');
      devolver(false);
      return resultado;
    } catch (e) {
      let rota = false;
      await c.query('ROLLBACK').catch(() => {
        rota = true;
      });
      devolver(rota);
      throw e;
    }
  }

  private tx(c: ClientePostgres): TransaccionPostgres {
    const t = this.tenant;
    return {
      tenant: t,
      consulta: <F = Record<string, unknown>>(texto: string, parametros?: unknown[]) => c.query<F>(texto, parametros),
      async bloquearSerie(id: string): Promise<EstadoSerie> {
        await c.query('INSERT INTO fhn_series (tenant, identificador) VALUES ($1, $2) ON CONFLICT DO NOTHING', [t, id]);
        const r = await c.query<{ ultimo: number | null; ultima_fecha: string | null }>(
          "SELECT ultimo, to_char(ultima_fecha, 'YYYY-MM-DD') AS ultima_fecha FROM fhn_series WHERE tenant = $1 AND identificador = $2 FOR UPDATE",
          [t, id],
        );
        const fila = r.rows[0]!;
        return { ultimo: fila.ultimo ?? null, ultimaFecha: fila.ultima_fecha ?? null };
      },
      async autorizaciones(id: string): Promise<AutorizacionCAI[]> {
        const r = await c.query<FilaDatos>(
          'SELECT datos FROM fhn_autorizaciones WHERE tenant = $1 AND identificador = $2 ORDER BY rango_inicial',
          [t, id],
        );
        return r.rows.map((f) => leer<AutorizacionCAI>(f.datos));
      },
      async guardarAutorizacion(a: AutorizacionCAI): Promise<void> {
        await c.query(
          'INSERT INTO fhn_autorizaciones (tenant, identificador, cai, rango_inicial, rango_final, datos) VALUES ($1, $2, $3, $4, $5, $6)',
          [t, identificadorDe(a), a.cai, a.rangoInicial, a.rangoFinal, JSON.stringify(a)],
        );
      },
      async guardarDocumento(doc: DocumentoFiscal): Promise<void> {
        const id = identificadorDeNumero(doc.numero);
        await c.query(
          'INSERT INTO fhn_documentos (tenant, numero, identificador, correlativo, fecha_emision, estado, datos) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [t, doc.numero, id, doc.correlativo, doc.fechaEmision, doc.estado, JSON.stringify(doc)],
        );
        await c.query(
          `INSERT INTO fhn_series (tenant, identificador, ultimo, ultima_fecha) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant, identificador) DO UPDATE SET ultimo = excluded.ultimo, ultima_fecha = excluded.ultima_fecha`,
          [t, id, doc.correlativo, doc.fechaEmision],
        );
      },
      async guardarAnulacion(doc: DocumentoFiscal): Promise<void> {
        const r = await c.query('UPDATE fhn_documentos SET estado = $1, datos = $2 WHERE tenant = $3 AND numero = $4', [
          doc.estado,
          JSON.stringify(doc),
          t,
          doc.numero,
        ]);
        if (r.rowCount !== 1) throw new Error(`No existe el documento ${doc.numero}`);
        // La referencia cronológica es el último documento válido (Art. 43).
        await c.query(
          `UPDATE fhn_series SET ultima_fecha = (
             SELECT max(fecha_emision) FROM fhn_documentos WHERE tenant = $1 AND identificador = $2 AND estado = 'EMITIDO')
           WHERE tenant = $1 AND identificador = $2`,
          [t, identificadorDeNumero(doc.numero)],
        );
      },
      async buscarDocumento(numero: string): Promise<DocumentoFiscal | null> {
        const r = await c.query<FilaDatos>('SELECT datos FROM fhn_documentos WHERE tenant = $1 AND numero = $2', [t, numero]);
        return r.rows[0] ? leer<DocumentoFiscal>(r.rows[0].datos) : null;
      },
      async documentos(filtro: FiltroDocumentos = {}): Promise<DocumentoFiscal[]> {
        const { donde, parametros } = condicionesDocumentos(t, filtro);
        const r = await c.query<FilaDatos>(`SELECT datos FROM fhn_documentos WHERE ${donde.join(' AND ')} ORDER BY numero`, parametros);
        return r.rows.map((f) => leer<DocumentoFiscal>(f.datos));
      },
      // Páginas por clave (keyset) sobre el número, en el mismo orden que `documentos`: cada consulta lee como
      // mucho `limite` filas, sin importar cuántos documentos tenga el período.
      async paginaDocumentos(filtro: FiltroDocumentos, pagina: PaginaDocumentos): Promise<ResumenDocumento[]> {
        const { donde, parametros, agregar } = condicionesDocumentos(t, filtro);
        if (pagina.despuesDe !== undefined) agregar('numero > ?', pagina.despuesDe);
        parametros.push(Math.max(1, Math.floor(pagina.limite)));
        const columna = pagina.sinLineas ? "datos::jsonb - 'lineas'" : 'datos';
        const r = await c.query<FilaDatos>(
          `SELECT ${columna} AS datos FROM fhn_documentos WHERE ${donde.join(' AND ')} ORDER BY numero LIMIT $${parametros.length}`,
          parametros,
        );
        return r.rows.map((f) => leer<ResumenDocumento>(f.datos));
      },
      async contarDocumentos(filtro: FiltroDocumentos): Promise<number> {
        const { donde, parametros } = condicionesDocumentos(t, filtro);
        const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM fhn_documentos WHERE ${donde.join(' AND ')}`, parametros);
        return r.rows[0]!.n;
      },
      async correlativos(identificador: string): Promise<number[]> {
        const r = await c.query<{ correlativo: number }>(
          'SELECT correlativo FROM fhn_documentos WHERE tenant = $1 AND identificador = $2 ORDER BY numero',
          [t, identificador],
        );
        return r.rows.map((f) => f.correlativo);
      },
      async registrarEvento(e: EventoAuditoria): Promise<void> {
        await c.query(
          'INSERT INTO fhn_eventos (tenant, tipo, identificador, numero, instante, datos) VALUES ($1, $2, $3, $4, $5, $6)',
          [t, e.tipo, e.identificador ?? null, e.numero ?? null, e.instante, JSON.stringify(e)],
        );
      },
      async eventos(filtro: FiltroEventos = {}): Promise<EventoAuditoria[]> {
        const condiciones = ['tenant = $1'];
        const parametros: unknown[] = [t];
        if (filtro.identificador) (parametros.push(filtro.identificador), condiciones.push(`identificador = $${parametros.length}`));
        if (filtro.tipo) (parametros.push(filtro.tipo), condiciones.push(`tipo = $${parametros.length}`));
        const r = await c.query<FilaDatos>(`SELECT datos FROM fhn_eventos WHERE ${condiciones.join(' AND ')} ORDER BY id`, parametros);
        return r.rows.map((f) => leer<EventoAuditoria>(f.datos));
      },
    };
  }
}

