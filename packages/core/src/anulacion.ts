/**
 * Anulación de documentos (Reglamento Art. 41, C L.1943-1955):
 *
 * «En el caso de emisión de Comprobantes Fiscales y/o Documentos Complementarios con errores, estos deben
 * ser anulados, consignando en los mismos la leyenda “ANULADA” de forma manuscrita, impresa o con sello.
 * Será responsabilidad de los Obligados Tributarios, el resguardo del original y copia de los … anulados,
 * de forma cronológica y ordenada, por el plazo de la prescripción …»
 *
 * Reglas que aplica el SDK:
 * - El documento emitido es inmutable. Anular devuelve un documento **nuevo** con `estado: 'ANULADO'`;
 *   el original no se modifica.
 * - El número y el correlativo se conservan: un número anulado nunca se reutiliza.
 * - El motivo es obligatorio (no lo exige el Art. 41 de forma literal; se exige por auditoría, Art. 53 num. 2).
 * - No se puede anular dos veces ni «reactivar» un documento anulado.
 * - La fecha de anulación la pone el reloj de Honduras (no es la fecha de emisión, que no cambia).
 */
import { hoyHonduras, ErrorValidacion, problemasDeTexto } from './documento';
import { horaHonduras } from './autorizacion';
import { congelar } from './inmutable';
import type { DocumentoFiscal } from './tipos';

/** Leyenda exigida por el Art. 41. Es texto legal: no se traduce ni se personaliza. */
export const LEYENDA_ANULADA = 'ANULADA';

export interface OpcionesAnulacion {
  /** Motivo de la anulación (obligatorio). */
  motivo: string;
  /** Reloj; por defecto `() => new Date()`. */
  reloj?: () => Date;
}

/**
 * Anula un documento emitido (Art. 41). Devuelve un documento nuevo e inmutable con la leyenda ANULADA;
 * el número queda consumido. Con un `AlmacenFiscal`, usa `anular(numero, …)`, que lo guarda en la misma
 * transacción; el registro nunca se borra.
 *
 * @throws ErrorValidacion `ANULACION_MOTIVO` si falta el motivo, `TEXTO_CARACTER_NO_PERMITIDO` si el motivo
 *   lleva caracteres de control, `YA_ANULADO` si ya estaba anulado.
 */
export function anularDocumento(doc: DocumentoFiscal, opciones: OpcionesAnulacion): DocumentoFiscal {
  if (doc.estado === 'ANULADO') {
    throw new ErrorValidacion([
      { codigo: 'YA_ANULADO', mensaje: `El documento ${doc.numero} ya está ANULADO (Art. 41). No se puede anular dos veces ni reactivar.`, campo: 'estado' },
    ]);
  }
  const motivo = opciones.motivo?.trim();
  if (!motivo) {
    throw new ErrorValidacion([
      { codigo: 'ANULACION_MOTIVO', mensaje: 'La anulación requiere un motivo.', campo: 'motivo' },
    ]);
  }
  // El motivo queda en el documento y en la bitácora: sin caracteres de control (TEXTO_CARACTER_NO_PERMITIDO).
  const texto = problemasDeTexto({ motivo });
  if (texto.length) throw new ErrorValidacion(texto);
  const reloj = opciones.reloj ?? (() => new Date());
  const ahora = reloj();
  const anulado: DocumentoFiscal = {
    ...structuredClone(doc),
    estado: 'ANULADO',
    anulacion: { motivo, fecha: hoyHonduras({ reloj: () => ahora }), hora: horaHonduras(ahora) },
  };
  return congelar(anulado);
}

export function estaAnulado(doc: Pick<DocumentoFiscal, 'estado'>): boolean {
  return doc.estado === 'ANULADO';
}
