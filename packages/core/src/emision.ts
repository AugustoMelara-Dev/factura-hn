/**
 * Emisión y anulación atómicas sobre un `AlmacenFiscal` (docs/investigacion.md, B-04 y B-18).
 */
import { anularDocumento } from './anulacion';
import { esAdvertencia, esFechaValida, validarAutorizacion } from './autorizacion';
import { identificadorDe, identificadorDeNumero, type AlmacenFiscal, type TransaccionFiscal } from './almacen';
import { construirDocumento, ErrorValidacion, hoyHonduras } from './documento';
import { congelar } from './inmutable';
import { TIPOS_DOCUMENTO } from './numeracion';
import type { AutorizacionCAI, DocumentoEntrada, DocumentoFiscal, OpcionesDocumento, Problema } from './tipos';

function error(codigo: string, mensaje: string, campo?: string): ErrorValidacion {
  return new ErrorValidacion([{ codigo, mensaje, ...(campo ? { campo } : {}) }]);
}

/**
 * Problemas de registrar `nueva` junto a las autorizaciones ya registradas del mismo identificador.
 * Dos autorizaciones de un mismo identificador no pueden compartir números: cada número del rango
 * pertenece a un solo CAI (Arts. 10 num. 3-5 y 59).
 */
export function validarNuevaAutorizacion(existentes: AutorizacionCAI[], nueva: AutorizacionCAI): Problema[] {
  const problemas = validarAutorizacion(nueva).filter((p) => !esAdvertencia(p));
  const id = identificadorDe(nueva);
  for (const a of existentes) {
    if (identificadorDe(a) !== id) continue;
    if (a.cai.trim().toUpperCase() === nueva.cai.trim().toUpperCase()) {
      problemas.push({ codigo: 'AUTORIZACION_DUPLICADA', mensaje: `El CAI ${nueva.cai} ya está registrado para ${id}.`, campo: 'cai' });
    } else if (nueva.rangoInicial <= a.rangoFinal && a.rangoInicial <= nueva.rangoFinal) {
      problemas.push({
        codigo: 'RANGO_SOLAPADO',
        mensaje: `El rango ${nueva.rangoInicial}–${nueva.rangoFinal} se solapa con el del CAI ${a.cai} (${a.rangoInicial}–${a.rangoFinal}) en ${id}.`,
        campo: 'rangoInicial',
      });
    }
  }
  return problemas;
}

/** Registra una autorización del SAR (CAI + rango + fecha límite) validando que no se solape. */
export async function registrarAutorizacion(almacen: AlmacenFiscal, autorizacion: AutorizacionCAI): Promise<AutorizacionCAI> {
  return almacen.transaccion(async (tx) => {
    const id = identificadorDe(autorizacion);
    await tx.bloquearSerie(id);
    const problemas = validarNuevaAutorizacion(await tx.autorizaciones(id), autorizacion);
    if (problemas.length) throw new ErrorValidacion(problemas);
    const normalizada: AutorizacionCAI = {
      ...autorizacion,
      cai: autorizacion.cai.trim().toUpperCase(),
      establecimiento: String(autorizacion.establecimiento).padStart(3, '0'),
      puntoEmision: String(autorizacion.puntoEmision).padStart(3, '0'),
    };
    await tx.guardarAutorizacion(normalizada);
    return normalizada;
  });
}

/**
 * Elige la autorización y el correlativo siguientes para una serie.
 *
 * - Siguiente número = último consumido + 1 (o el inicio de la primera autorización si la serie está vacía).
 * - Se usa la autorización **vigente** (fecha límite ≥ hoy, Art. 62) de menor inicio que todavía tenga
 *   números ≥ ese siguiente. Si su rango empieza más adelante, se salta hasta su inicio: los números
 *   saltados pertenecen a autorizaciones vencidas que se reportan como no utilizados (Art. 42); nunca se
 *   emiten.
 */
export function elegirAutorizacion(
  autorizaciones: AutorizacionCAI[],
  ultimo: number | null,
  hoy: string,
): { autorizacion: AutorizacionCAI; correlativo: number } | { error: Problema } {
  if (autorizaciones.length === 0) {
    return { error: { codigo: 'SIN_AUTORIZACION', mensaje: 'No hay autorización (CAI) registrada para este punto de emisión y tipo de documento (Arts. 59-61).' } };
  }
  const ordenadas = [...autorizaciones].sort((a, b) => a.rangoInicial - b.rangoInicial);
  const siguiente = ultimo === null ? ordenadas[0]!.rangoInicial : ultimo + 1;
  const vigentes = ordenadas.filter((a) => esFechaValida(a.fechaLimiteEmision) && a.fechaLimiteEmision >= hoy);
  const candidata = vigentes.find((a) => a.rangoFinal >= siguiente);
  if (candidata) return { autorizacion: candidata, correlativo: Math.max(siguiente, candidata.rangoInicial) };
  if (vigentes.length === 0) {
    return { error: { codigo: 'AUTORIZACION_VENCIDA', mensaje: 'Todas las autorizaciones de este punto de emisión y tipo están vencidas (Art. 62). Solicita un nuevo CAI.' } };
  }
  return { error: { codigo: 'RANGO_AGOTADO', mensaje: 'Se agotaron los rangos autorizados vigentes de este punto de emisión y tipo. Solicita un nuevo CAI.' } };
}

export interface OpcionesEmision {
  almacen: AlmacenFiscal;
  /** Código de establecimiento (casa matriz = 000). */
  establecimiento: string | number;
  /** Código del punto de emisión (caja, dispositivo o sistema). */
  puntoEmision: string | number;
  opciones?: OpcionesDocumento;
  /**
   * Se ejecuta dentro de la transacción después de guardar el documento: aquí va el asiento contable o de
   * inventario (Art. 53 num. 1) o la bitácora de auditoría. Si lanza, se revierte todo y el número no se
   * consume.
   */
  alEmitir?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
}

/**
 * Emite un documento de forma atómica: bloquea la serie, elige la autorización vigente, valida, construye
 * y guarda. Todo o nada.
 *
 * @throws ErrorValidacion con códigos como SIN_AUTORIZACION, RANGO_AGOTADO, AUTORIZACION_VENCIDA,
 *   FECHA_ANTERIOR_AL_ULTIMO o los de `validarEntrada`.
 */
export async function emitir(entrada: DocumentoEntrada, config: OpcionesEmision): Promise<DocumentoFiscal> {
  const tipo = entrada.tipoDocumento ?? '01';
  const id = identificadorDe({ establecimiento: config.establecimiento, puntoEmision: config.puntoEmision, tipoDocumento: tipo });
  // Un solo instante para toda la emisión: validación, elección de autorización y documento usan la misma fecha.
  const ahora = (config.opciones?.reloj ?? (() => new Date()))();
  const opciones: OpcionesDocumento = { ...config.opciones, reloj: () => ahora };
  const hoy = hoyHonduras(opciones);
  return config.almacen.transaccion(async (tx) => {
    const serie = await tx.bloquearSerie(id);
    // Art. 43: custodia en orden cronológico. Si el reloj quedó antes del último documento, no se emite.
    if (serie.ultimaFecha && serie.ultimaFecha > hoy) {
      throw error('FECHA_ANTERIOR_AL_ULTIMO', `El último documento de ${id} tiene fecha ${serie.ultimaFecha}, posterior a hoy (${hoy}). Revisa el reloj del sistema (Art. 43).`, 'fechaEmision');
    }
    const eleccion = elegirAutorizacion(await tx.autorizaciones(id), serie.ultimo, hoy);
    if ('error' in eleccion) throw new ErrorValidacion([eleccion.error]);
    const doc = construirDocumento(entrada, eleccion.autorizacion, eleccion.correlativo, opciones);
    await tx.guardarDocumento(doc);
    if (config.alEmitir) await config.alEmitir(doc, tx);
    return doc;
  });
}

/**
 * Anula un documento guardado (Art. 41): guarda su forma ANULADA en una transacción. El número sigue
 * consumido.
 */
export async function anular(
  numero: string,
  config: {
    almacen: AlmacenFiscal;
    motivo: string;
    reloj?: () => Date;
    alAnular?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
  },
): Promise<DocumentoFiscal> {
  return config.almacen.transaccion(async (tx) => {
    await tx.bloquearSerie(identificadorDeNumero(numero));
    const doc = await tx.buscarDocumento(numero);
    if (!doc) throw error('DOCUMENTO_NO_ENCONTRADO', `No existe el documento ${numero}.`, 'numero');
    const anulado = anularDocumento(doc, { motivo: config.motivo, ...(config.reloj ? { reloj: config.reloj } : {}) });
    await tx.guardarAnulacion(anulado);
    if (config.alAnular) await config.alAnular(anulado, tx);
    return anulado;
  });
}

/** Busca un documento guardado y lo devuelve inmutable. */
export async function buscarDocumento(almacen: AlmacenFiscal, numero: string): Promise<DocumentoFiscal | null> {
  const doc = await almacen.transaccion((tx) => tx.buscarDocumento(numero));
  return doc ? congelar(doc) : null;
}

/** Nombre del tipo de documento de un identificador `NNN-NNN-TT`. */
export function nombreDeIdentificador(id: string): string {
  return TIPOS_DOCUMENTO[id.slice(8, 10) as keyof typeof TIPOS_DOCUMENTO] ?? id;
}
