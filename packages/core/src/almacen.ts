/**
 * Persistencia fiscal: series de correlativos, autorizaciones y documentos, con emisión atómica.
 *
 * Reglas (docs/investigacion.md, B-04 y B-18):
 * - El correlativo se lleva por **identificador del documento** (`NNN-NNN-TT`: establecimiento, punto de
 *   emisión y tipo; Reglamento Art. 10 num. 7, C L.630-633), no por CAI. Un identificador acumula varias
 *   autorizaciones con el tiempo (Art. 59: una por punto de emisión y tipo, renovable), y la numeración
 *   continúa de una a otra.
 * - Reservar el número, construir el documento y guardarlo ocurre en **una transacción**: si algo falla,
 *   no se consume el número. Un número consumido nunca se borra ni se reutiliza; si falla algo después
 *   de confirmar la transacción (p. ej. la impresión), el documento se **anula** (Art. 41).
 * - Los documentos guardados son inmutables: solo pueden pasar de EMITIDO a ANULADO.
 *
 * Un adaptador implementa `AlmacenFiscal` sobre su base de datos. La batería de
 * `factura-hn/pruebas` (`ejecutarContratoAlmacen`) verifica cualquier implementación, incluida la
 * concurrencia.
 */
import type { AutorizacionCAI, DocumentoFiscal } from './tipos';

/** Estado de la serie de un identificador, leído con bloqueo exclusivo hasta el fin de la transacción. */
export interface EstadoSerie {
  /** Último correlativo consumido (emitido o anulado), o null si la serie no ha emitido nada. */
  ultimo: number | null;
  /**
   * Fecha de emisión (YYYY-MM-DD) más reciente entre los documentos **EMITIDOS** (no anulados) de la serie,
   * o null. Es la referencia del orden cronológico (Art. 43): un documento anulado por fecha errónea deja
   * de contar (ver `corregirFechaAdelantada`).
   */
  ultimaFecha: string | null;
}

export type TipoEventoAuditoria =
  | 'AUTORIZACION_REGISTRADA'
  | 'DOCUMENTO_EMITIDO'
  | 'DOCUMENTO_ANULADO'
  | 'SALTO_DE_FECHA_CONFIRMADO'
  | 'FECHA_ADELANTADA_CORREGIDA';

/**
 * Evento de la bitácora de auditoría. Se guarda en la misma transacción que la operación que lo origina y
 * nunca se modifica ni se borra. Cada emisión deja un DOCUMENTO_EMITIDO con quién la hizo (`actor` y
 * `operador`); el contenido fiscal sigue estando en el documento.
 */
export interface EventoAuditoria {
  tipo: TipoEventoAuditoria;
  /** Instante ISO 8601 (UTC) según el reloj de la operación. */
  instante: string;
  /** Fecha en Honduras (YYYY-MM-DD) del mismo instante. */
  fecha: string;
  identificador?: string;
  numero?: string;
  /** Quién hizo la operación (usuario, caja, llave de API), si el integrador lo indica. */
  actor?: string;
  /** Persona que operó (p. ej. el cajero), si se indica. Complementa a `actor` cuando varias personas usan la misma caja o llave. */
  operador?: string;
  detalle: Record<string, unknown>;
}

export interface FiltroEventos {
  identificador?: string;
  tipo?: TipoEventoAuditoria;
}

export interface FiltroDocumentos {
  /** YYYY-MM-DD, inclusive. */
  desde?: string;
  /** YYYY-MM-DD, inclusive. */
  hasta?: string;
  /** `NNN-NNN-TT` */
  identificador?: string;
}

/**
 * Operaciones dentro de una transacción. Todo lo que se haga aquí se confirma junto o se revierte junto.
 */
export interface TransaccionFiscal {
  /**
   * Bloquea la serie del identificador hasta el fin de la transacción (en Postgres: `SELECT … FOR UPDATE`;
   * en SQLite: `BEGIN IMMEDIATE`) y devuelve su estado. Si la serie no existe, la crea vacía.
   */
  bloquearSerie(identificador: string): Promise<EstadoSerie>;
  /** Todas las autorizaciones del identificador, vencidas incluidas, ordenadas por `rangoInicial`. */
  autorizaciones(identificador: string): Promise<AutorizacionCAI[]>;
  /** Guarda una autorización nueva. Las validaciones (solapamiento, formato) las hace el core. */
  guardarAutorizacion(autorizacion: AutorizacionCAI): Promise<void>;
  /**
   * Inserta un documento EMITIDO y avanza la serie de su identificador a `doc.correlativo` y
   * `doc.fechaEmision`. Debe lanzar si ya existe un documento con ese número.
   */
  guardarDocumento(doc: DocumentoFiscal): Promise<void>;
  /**
   * Reemplaza un documento EMITIDO por su forma ANULADA (Art. 41) y recalcula `ultimaFecha` de la serie.
   * Debe lanzar si el número no existe.
   */
  guardarAnulacion(doc: DocumentoFiscal): Promise<void>;
  /** El documento con ese número (`NNN-NNN-NN-NNNNNNNN`), o null. */
  buscarDocumento(numero: string): Promise<DocumentoFiscal | null>;
  /** Documentos por fecha de emisión e identificador, en orden de número. */
  documentos(filtro?: FiltroDocumentos): Promise<DocumentoFiscal[]>;
  /** Agrega un evento a la bitácora (solo inserción). */
  registrarEvento(evento: EventoAuditoria): Promise<void>;
  /** Eventos en el orden en que se registraron. */
  eventos(filtro?: FiltroEventos): Promise<EventoAuditoria[]>;
}

export interface AlmacenFiscal {
  /**
   * Ejecuta `fn` en una transacción. Si `fn` lanza, se revierte todo y la excepción se propaga.
   * Dos transacciones que bloquean la misma serie se serializan.
   */
  transaccion<T>(fn: (tx: TransaccionFiscal) => Promise<T>): Promise<T>;
}

/** `NNN-NNN-TT` a partir de una autorización o de sus partes. */
export function identificadorDe(partes: Pick<AutorizacionCAI, 'establecimiento' | 'puntoEmision' | 'tipoDocumento'>): string {
  const tres = (v: string | number) => String(v).trim().padStart(3, '0');
  return `${tres(partes.establecimiento)}-${tres(partes.puntoEmision)}-${partes.tipoDocumento}`;
}

/** `NNN-NNN-TT` de un número de documento con guiones. */
export function identificadorDeNumero(numero: string): string {
  return numero.slice(0, 10);
}

/**
 * Almacén en memoria con transacciones reales (serializadas y con reversión). Úsalo en pruebas, demos y
 * como modelo de la implementación más corta del contrato. Se pierde al reiniciar el proceso.
 */
export class AlmacenFiscalMemoria implements AlmacenFiscal {
  private estado = {
    series: new Map<string, EstadoSerie>(),
    autorizaciones: [] as AutorizacionCAI[],
    documentos: new Map<string, DocumentoFiscal>(),
    eventos: [] as EventoAuditoria[],
  };
  private cola: Promise<unknown> = Promise.resolve();

  async transaccion<T>(fn: (tx: TransaccionFiscal) => Promise<T>): Promise<T> {
    const ejecutar = async () => {
      const respaldo = {
        series: new Map([...this.estado.series].map(([k, v]) => [k, { ...v }])),
        autorizaciones: [...this.estado.autorizaciones],
        documentos: new Map(this.estado.documentos),
        eventos: [...this.estado.eventos],
      };
      try {
        return await fn(this.tx());
      } catch (e) {
        this.estado = respaldo;
        throw e;
      }
    };
    const resultado = this.cola.then(ejecutar, ejecutar);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  private tx(): TransaccionFiscal {
    const s = () => this.estado;
    return {
      async bloquearSerie(id) {
        if (!s().series.has(id)) s().series.set(id, { ultimo: null, ultimaFecha: null });
        return { ...s().series.get(id)! };
      },
      async autorizaciones(id) {
        return s().autorizaciones
          .filter((a) => identificadorDe(a) === id)
          .sort((a, b) => a.rangoInicial - b.rangoInicial)
          .map((a) => ({ ...a }));
      },
      async guardarAutorizacion(aut) {
        s().autorizaciones.push({ ...aut });
      },
      async guardarDocumento(doc) {
        if (s().documentos.has(doc.numero)) throw new Error(`Ya existe el documento ${doc.numero}`);
        s().documentos.set(doc.numero, structuredClone(doc));
        s().series.set(identificadorDeNumero(doc.numero), { ultimo: doc.correlativo, ultimaFecha: doc.fechaEmision });
      },
      async guardarAnulacion(doc) {
        if (!s().documentos.has(doc.numero)) throw new Error(`No existe el documento ${doc.numero}`);
        s().documentos.set(doc.numero, structuredClone(doc));
        const id = identificadorDeNumero(doc.numero);
        const fechas = [...s().documentos.values()]
          .filter((d) => identificadorDeNumero(d.numero) === id && d.estado === 'EMITIDO')
          .map((d) => d.fechaEmision)
          .sort();
        s().series.set(id, { ultimo: s().series.get(id)?.ultimo ?? doc.correlativo, ultimaFecha: fechas[fechas.length - 1] ?? null });
      },
      async buscarDocumento(numero) {
        const d = s().documentos.get(numero);
        return d ? structuredClone(d) : null;
      },
      async documentos(filtro = {}) {
        return [...s().documentos.values()]
          .filter((d) => (!filtro.desde || d.fechaEmision >= filtro.desde) && (!filtro.hasta || d.fechaEmision <= filtro.hasta))
          .filter((d) => !filtro.identificador || identificadorDeNumero(d.numero) === filtro.identificador)
          .sort((a, b) => (a.numero < b.numero ? -1 : 1))
          .map((d) => structuredClone(d));
      },
      async registrarEvento(evento) {
        s().eventos.push(structuredClone(evento));
      },
      async eventos(filtro = {}) {
        return s().eventos
          .filter((e) => (!filtro.identificador || e.identificador === filtro.identificador) && (!filtro.tipo || e.tipo === filtro.tipo))
          .map((e) => structuredClone(e));
      },
    };
  }
}
