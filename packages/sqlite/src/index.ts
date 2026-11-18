/**
 * @factura-hn/sqlite — `AlmacenFiscal` sobre SQLite, para el POS fuera de línea o la instalación local
 * en el negocio (docs/investigacion.md, «Modos de despliegue»).
 *
 * Funciona con cualquier driver síncrono con `exec` y `prepare().run/get/all`: `better-sqlite3` o
 * `node:sqlite` (`DatabaseSync`, Node ≥ 22.5). El adaptador no instala ni elige el driver.
 *
 * Garantías:
 * - Cada transacción abre con `BEGIN IMMEDIATE` (bloqueo de escritura desde el inicio), así que dos
 *   cajas, en el mismo proceso o en procesos distintos, se serializan y no repiten correlativos.
 *   Si la base está ocupada, espera de forma asíncrona y reintenta, sin bloquear el hilo.
 * - La base protege por sí misma lo que el SAR exige aunque alguien la edite a mano: los documentos no se
 *   borran, solo pasan de EMITIDO a ANULADO, y la serie nunca retrocede (disparadores).
 *
 * @example
 * import Database from 'better-sqlite3';
 * import { AlmacenSQLite } from '@factura-hn/sqlite';
 * const almacen = new AlmacenSQLite(new Database('fiscal.db'));
 */
import { identificadorDe, identificadorDeNumero } from 'factura-hn';
import type { AlmacenFiscal, AutorizacionCAI, DocumentoFiscal, EstadoSerie, FiltroDocumentos, TransaccionFiscal } from 'factura-hn';

export interface SentenciaSQLite {
  run(...parametros: unknown[]): unknown;
  get(...parametros: unknown[]): unknown;
  all(...parametros: unknown[]): unknown[];
}

/** Lo mínimo que el adaptador necesita del driver. `better-sqlite3` y `node:sqlite` lo cumplen. */
export interface BaseSQLite {
  exec(sql: string): unknown;
  prepare(sql: string): SentenciaSQLite;
}

export interface OpcionesAlmacenSQLite {
  /** Pone la base en modo WAL (recomendado para varias cajas). Por defecto true. */
  wal?: boolean;
  /** Milisegundos máximos esperando a que otra caja libere la base. Por defecto 10 000. */
  esperaMaxima?: number;
}

/** Versión del esquema creado por `ESQUEMA_SQLITE`. */
export const VERSION_ESQUEMA_SQLITE = 1;

/** Esquema idempotente. Se aplica al crear el almacén; puedes revisarlo o aplicarlo en tus migraciones. */
export const ESQUEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS fhn_series (
  identificador TEXT PRIMARY KEY,
  ultimo INTEGER,
  ultima_fecha TEXT
);
CREATE TABLE IF NOT EXISTS fhn_autorizaciones (
  identificador TEXT NOT NULL,
  cai TEXT NOT NULL,
  rango_inicial INTEGER NOT NULL,
  rango_final INTEGER NOT NULL,
  datos TEXT NOT NULL,
  registrada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (identificador, cai)
);
CREATE TABLE IF NOT EXISTS fhn_documentos (
  numero TEXT PRIMARY KEY,
  identificador TEXT NOT NULL,
  correlativo INTEGER NOT NULL,
  fecha_emision TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('EMITIDO', 'ANULADO')),
  datos TEXT NOT NULL,
  UNIQUE (identificador, correlativo)
);
CREATE INDEX IF NOT EXISTS fhn_documentos_fecha ON fhn_documentos (fecha_emision, numero);

-- Reglamento Art. 41: los documentos no se borran; uno emitido solo puede pasar a ANULADO.
CREATE TRIGGER IF NOT EXISTS fhn_documentos_sin_borrar BEFORE DELETE ON fhn_documentos
BEGIN SELECT RAISE(ABORT, 'factura-hn: los documentos fiscales no se borran (Art. 41)'); END;
CREATE TRIGGER IF NOT EXISTS fhn_documentos_solo_anular BEFORE UPDATE ON fhn_documentos
WHEN NOT (OLD.estado = 'EMITIDO' AND NEW.estado = 'ANULADO' AND NEW.numero = OLD.numero
  AND NEW.identificador = OLD.identificador AND NEW.correlativo = OLD.correlativo
  AND NEW.fecha_emision = OLD.fecha_emision)
BEGIN SELECT RAISE(ABORT, 'factura-hn: un documento emitido solo puede anularse (Art. 41)'); END;
-- Un número consumido no se reutiliza: la serie solo avanza.
CREATE TRIGGER IF NOT EXISTS fhn_series_solo_avanza BEFORE UPDATE ON fhn_series
WHEN OLD.ultimo IS NOT NULL AND (NEW.ultimo IS NULL OR NEW.ultimo <= OLD.ultimo)
BEGIN SELECT RAISE(ABORT, 'factura-hn: la serie de correlativos no retrocede'); END;
CREATE TRIGGER IF NOT EXISTS fhn_autorizaciones_sin_borrar BEFORE DELETE ON fhn_autorizaciones
BEGIN SELECT RAISE(ABORT, 'factura-hn: las autorizaciones registradas no se borran'); END;
`;

const esOcupada = (e: unknown): boolean => {
  const err = e as { code?: unknown; errcode?: unknown; message?: unknown };
  return err?.code === 'SQLITE_BUSY' || err?.errcode === 5 || /database is locked|SQLITE_BUSY/i.test(String(err?.message));
};
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FilaDatos {
  datos: string;
}
interface FilaSerie {
  ultimo: number | null;
  ultima_fecha: string | null;
}

export class AlmacenSQLite implements AlmacenFiscal {
  private cola: Promise<unknown> = Promise.resolve();
  private readonly esperaMaxima: number;

  constructor(
    private readonly db: BaseSQLite,
    opciones: OpcionesAlmacenSQLite = {},
  ) {
    this.esperaMaxima = opciones.esperaMaxima ?? 10_000;
    // La espera la hace el adaptador de forma asíncrona; una espera síncrona del driver bloquearía el hilo
    // y a la otra caja del mismo proceso que tiene el bloqueo.
    db.exec('PRAGMA busy_timeout = 0');
    if (opciones.wal ?? true) db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(ESQUEMA_SQLITE);
  }

  /** Una conexión ejecuta una transacción a la vez; las demás esperan su turno. */
  transaccion<T>(fn: (tx: TransaccionFiscal) => Promise<T>): Promise<T> {
    const ejecutar = () => this.ejecutar(fn);
    const resultado = this.cola.then(ejecutar, ejecutar);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  private async ejecutar<T>(fn: (tx: TransaccionFiscal) => Promise<T>): Promise<T> {
    const limite = Date.now() + this.esperaMaxima;
    for (let intento = 0; ; intento++) {
      try {
        this.db.exec('BEGIN IMMEDIATE');
        break;
      } catch (e) {
        if (!esOcupada(e) || Date.now() > limite) throw e;
        await pausa(Math.min(50, 1 + intento) + Math.random() * 3);
      }
    }
    try {
      const resultado = await fn(this.tx());
      this.db.exec('COMMIT');
      return resultado;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // La transacción ya estaba revertida por el propio SQLite.
      }
      throw e;
    }
  }

  private tx(): TransaccionFiscal {
    const db = this.db;
    return {
      async bloquearSerie(id: string): Promise<EstadoSerie> {
        db.prepare('INSERT OR IGNORE INTO fhn_series (identificador, ultimo, ultima_fecha) VALUES (?, NULL, NULL)').run(id);
        const fila = db.prepare('SELECT ultimo, ultima_fecha FROM fhn_series WHERE identificador = ?').get(id) as FilaSerie;
        return { ultimo: fila.ultimo ?? null, ultimaFecha: fila.ultima_fecha ?? null };
      },
      async autorizaciones(id: string): Promise<AutorizacionCAI[]> {
        const filas = db
          .prepare('SELECT datos FROM fhn_autorizaciones WHERE identificador = ? ORDER BY rango_inicial')
          .all(id) as FilaDatos[];
        return filas.map((f) => JSON.parse(f.datos) as AutorizacionCAI);
      },
      async guardarAutorizacion(a: AutorizacionCAI): Promise<void> {
        const id = identificadorDe(a);
        db.prepare('INSERT INTO fhn_autorizaciones (identificador, cai, rango_inicial, rango_final, datos) VALUES (?, ?, ?, ?, ?)')
          .run(id, a.cai, a.rangoInicial, a.rangoFinal, JSON.stringify(a));
      },
      async guardarDocumento(doc: DocumentoFiscal): Promise<void> {
        const id = identificadorDeNumero(doc.numero);
        db.prepare('INSERT INTO fhn_documentos (numero, identificador, correlativo, fecha_emision, estado, datos) VALUES (?, ?, ?, ?, ?, ?)')
          .run(doc.numero, id, doc.correlativo, doc.fechaEmision, doc.estado, JSON.stringify(doc));
        db.prepare(
          `INSERT INTO fhn_series (identificador, ultimo, ultima_fecha) VALUES (?, ?, ?)
           ON CONFLICT (identificador) DO UPDATE SET ultimo = excluded.ultimo, ultima_fecha = excluded.ultima_fecha`,
        ).run(id, doc.correlativo, doc.fechaEmision);
      },
      async guardarAnulacion(doc: DocumentoFiscal): Promise<void> {
        const r = db
          .prepare('UPDATE fhn_documentos SET estado = ?, datos = ? WHERE numero = ?')
          .run(doc.estado, JSON.stringify(doc), doc.numero) as { changes: number | bigint };
        if (Number(r.changes) !== 1) throw new Error(`No existe el documento ${doc.numero}`);
      },
      async buscarDocumento(numero: string): Promise<DocumentoFiscal | null> {
        const fila = db.prepare('SELECT datos FROM fhn_documentos WHERE numero = ?').get(numero) as FilaDatos | undefined;
        return fila ? (JSON.parse(fila.datos) as DocumentoFiscal) : null;
      },
      async documentos(filtro: FiltroDocumentos = {}): Promise<DocumentoFiscal[]> {
        const condiciones: string[] = [];
        const parametros: string[] = [];
        if (filtro.desde) (condiciones.push('fecha_emision >= ?'), parametros.push(filtro.desde));
        if (filtro.hasta) (condiciones.push('fecha_emision <= ?'), parametros.push(filtro.hasta));
        if (filtro.identificador) (condiciones.push('identificador = ?'), parametros.push(filtro.identificador));
        const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
        const filas = db.prepare(`SELECT datos FROM fhn_documentos ${donde} ORDER BY numero`).all(...parametros) as FilaDatos[];
        return filas.map((f) => JSON.parse(f.datos) as DocumentoFiscal);
      },
    };
  }
}
