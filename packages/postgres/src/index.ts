/**
 * @factura-hn/postgres — `AlmacenFiscal` sobre PostgreSQL (≥ 13) con `pg` (o cualquier pool compatible).
 *
 * Garantías:
 * - La serie de cada identificador se bloquea con `SELECT … FOR UPDATE`: varias cajas o réplicas de la API
 *   se serializan por serie (no globalmente) y no repiten correlativos.
 * - Todo o nada: si algo falla dentro de la transacción, `ROLLBACK` y el número no se consume.
 * - La base se protege sola con disparadores: los documentos no se borran, uno emitido solo pasa a
 *   ANULADO (Art. 41) y la serie nunca retrocede.
 * - Cada fila lleva `tenant`. Cada transacción fija `factura_hn.tenant` con `set_config(…, true)`; las
 *   políticas RLS de la API alojada (Fase 2) se apoyan en ese valor. En modo local (un solo negocio) el
 *   tenant por defecto es `''`.
 *
 * @example
 * import pg from 'pg';
 * import { AlmacenPostgres } from '@factura-hn/postgres';
 * const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
 * await almacen.migrar();
 */
import { identificadorDe, identificadorDeNumero } from 'factura-hn';
import type { AlmacenFiscal, AutorizacionCAI, DocumentoFiscal, EstadoSerie, FiltroDocumentos, TransaccionFiscal } from 'factura-hn';

export interface ResultadoConsulta<F = Record<string, unknown>> {
  rows: F[];
  rowCount: number | null;
}

export interface ClientePostgres {
  query<F = Record<string, unknown>>(texto: string, parametros?: unknown[]): Promise<ResultadoConsulta<F>>;
  /** `pg` destruye la conexión si recibe un error o `true`. */
  release(destruir?: boolean | Error): void;
}

/** Lo mínimo que el adaptador necesita: un pool como `pg.Pool`. */
export interface PoolPostgres {
  connect(): Promise<ClientePostgres>;
}

export interface OpcionesAlmacenPostgres {
  /** Inquilino (negocio). Por defecto `''` (instalación de un solo negocio). */
  tenant?: string;
}

export const VERSION_ESQUEMA_POSTGRES = 1;

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

CREATE OR REPLACE FUNCTION fhn_no_borrar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'factura-hn: % no se borran (Art. 41)', TG_TABLE_NAME;
END $$;

CREATE OR REPLACE FUNCTION fhn_solo_anular() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (OLD.estado = 'EMITIDO' AND NEW.estado = 'ANULADO' AND NEW.tenant = OLD.tenant
          AND NEW.numero = OLD.numero AND NEW.identificador = OLD.identificador
          AND NEW.correlativo = OLD.correlativo AND NEW.fecha_emision = OLD.fecha_emision) THEN
    RAISE EXCEPTION 'factura-hn: un documento emitido solo puede anularse (Art. 41)';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fhn_serie_solo_avanza() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ultimo IS NOT NULL AND (NEW.ultimo IS NULL OR NEW.ultimo <= OLD.ultimo) THEN
    RAISE EXCEPTION 'factura-hn: la serie de correlativos no retrocede';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fhn_documentos_sin_borrar ON fhn_documentos;
CREATE TRIGGER fhn_documentos_sin_borrar BEFORE DELETE ON fhn_documentos FOR EACH ROW EXECUTE FUNCTION fhn_no_borrar();
DROP TRIGGER IF EXISTS fhn_autorizaciones_sin_borrar ON fhn_autorizaciones;
CREATE TRIGGER fhn_autorizaciones_sin_borrar BEFORE DELETE ON fhn_autorizaciones FOR EACH ROW EXECUTE FUNCTION fhn_no_borrar();
DROP TRIGGER IF EXISTS fhn_documentos_solo_anular ON fhn_documentos;
CREATE TRIGGER fhn_documentos_solo_anular BEFORE UPDATE ON fhn_documentos FOR EACH ROW EXECUTE FUNCTION fhn_solo_anular();
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

export class AlmacenPostgres implements AlmacenFiscal {
  private readonly tenant: string;

  constructor(
    private readonly pool: PoolPostgres,
    opciones: OpcionesAlmacenPostgres = {},
  ) {
    this.tenant = opciones.tenant ?? '';
  }

  /** Crea o actualiza las tablas, funciones y disparadores `fhn_*`. Seguro de llamar en cada arranque. */
  async migrar(): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock($1)', [CANDADO_MIGRACION]);
      await c.query(ESQUEMA_POSTGRES);
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
    return new AlmacenPostgres(this.pool, { tenant });
  }

  async transaccion<T>(fn: (tx: TransaccionFiscal) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [this.tenant]);
      const resultado = await fn(this.tx(c));
      await c.query('COMMIT');
      c.release();
      return resultado;
    } catch (e) {
      let rota = false;
      await c.query('ROLLBACK').catch(() => {
        rota = true;
      });
      c.release(rota);
      throw e;
    }
  }

  private tx(c: ClientePostgres): TransaccionFiscal {
    const t = this.tenant;
    return {
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
      },
      async buscarDocumento(numero: string): Promise<DocumentoFiscal | null> {
        const r = await c.query<FilaDatos>('SELECT datos FROM fhn_documentos WHERE tenant = $1 AND numero = $2', [t, numero]);
        return r.rows[0] ? leer<DocumentoFiscal>(r.rows[0].datos) : null;
      },
      async documentos(filtro: FiltroDocumentos = {}): Promise<DocumentoFiscal[]> {
        const condiciones = ['tenant = $1'];
        const parametros: unknown[] = [t];
        const agregar = (sql: string, v: unknown) => {
          parametros.push(v);
          condiciones.push(sql.replace('?', `$${parametros.length}`));
        };
        if (filtro.desde) agregar('fecha_emision >= ?', filtro.desde);
        if (filtro.hasta) agregar('fecha_emision <= ?', filtro.hasta);
        if (filtro.identificador) agregar('identificador = ?', filtro.identificador);
        const r = await c.query<FilaDatos>(`SELECT datos FROM fhn_documentos WHERE ${condiciones.join(' AND ')} ORDER BY numero`, parametros);
        return r.rows.map((f) => leer<DocumentoFiscal>(f.datos));
      },
    };
  }
}

