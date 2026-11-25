/**
 * Modo de prueba: un documento emitido con una autorización de prueba (`AutorizacionCAI.prueba`) lleva
 * `modo: 'prueba'` y todo impreso lleva esta leyenda. Es una marca del producto, no una regla fiscal: evita
 * que un documento de demostración pase por uno real.
 */
import type { DocumentoFiscal } from './tipos';

/** Leyenda de todo impreso de un documento de prueba. Texto fijo: no se traduce ni se personaliza. */
export const LEYENDA_PRUEBA = 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL';

/** true si el documento se emitió con una autorización de prueba. Uno sin `modo` es real. */
export function esDocumentoDePrueba(doc: Pick<DocumentoFiscal, 'modo'>): boolean {
  return doc.modo === 'prueba';
}
