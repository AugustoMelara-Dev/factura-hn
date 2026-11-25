/**
 * Modo de prueba: un documento emitido con una autorización de prueba lleva `modo: 'prueba'` y todo impreso
 * lleva esta leyenda. Es una marca del producto, no una regla fiscal: evita que un documento de demostración
 * pase por uno real. Una autorización es de prueba si tiene `prueba: true` o un CAI ficticio (`esCAIDemo`).
 */
import type { AutorizacionCAI, DocumentoFiscal } from './tipos';

/** Leyenda de todo impreso de un documento de prueba. Texto fijo: no se traduce ni se personaliza. */
export const LEYENDA_PRUEBA = 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL';

/** Prefijo que reconoce un CAI ficticio. Ningún CAI del SAR empieza así. */
const PREFIJO_CAI_FICTICIO = 'DEMO00-NO-VALIDO-';

/**
 * true si el CAI es ficticio: empieza con `DEMO00-NO-VALIDO-`, sin importar mayúsculas ni espacios en los
 * extremos. Es el CAI de `factura-hn/demo`, de la API y del MCP en modo demo.
 */
export function esCAIDemo(cai: string): boolean {
  return typeof cai === 'string' && cai.trim().toUpperCase().startsWith(PREFIJO_CAI_FICTICIO);
}

/** true si los documentos de esta autorización son de prueba: `prueba: true` o un CAI ficticio. */
export function esAutorizacionDePrueba(aut: Pick<AutorizacionCAI, 'cai' | 'prueba'>): boolean {
  return aut.prueba === true || esCAIDemo(aut.cai);
}

/**
 * true si el documento es de prueba: lleva `modo: 'prueba'`, o tiene un CAI ficticio (documentos emitidos por
 * la API o el MCP antes de que existiera el campo). Uno real no tiene ninguna de las dos cosas.
 */
export function esDocumentoDePrueba(doc: Pick<DocumentoFiscal, 'modo' | 'cai'>): boolean {
  return doc.modo === 'prueba' || esCAIDemo(doc.cai);
}
