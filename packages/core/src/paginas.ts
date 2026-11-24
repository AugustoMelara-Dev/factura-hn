/**
 * Lectura acotada de documentos para reportes de período (libro de ventas, exportación, no utilizados).
 *
 * Un período puede tener decenas de miles de documentos. Leerlos todos de una vez con `tx.documentos` carga en
 * memoria cada documento completo (con sus líneas) al mismo tiempo. Estas funciones leen por páginas de tamaño
 * fijo, en el mismo orden de número que `tx.documentos`, y usan los métodos opcionales del adaptador
 * (`paginaDocumentos`, `contarDocumentos`, `correlativos`) si los tiene. Si no, recurren a `tx.documentos`: el
 * resultado es el mismo, solo que sin el ahorro de memoria.
 */
import type { FiltroDocumentos, TransaccionFiscal } from './almacen';
import type { DocumentoFiscal, ResumenDocumento } from './tipos';

/** Documentos por página cuando se leen sin líneas. */
export const TAMANO_PAGINA = 200;
/** Documentos por página cuando se leen completos (las líneas pueden pesar cientos de KB por documento). */
export const TAMANO_PAGINA_COMPLETOS = 50;

export interface OpcionesPaginas {
  /** Documentos por página. Por defecto `TAMANO_PAGINA` sin líneas y `TAMANO_PAGINA_COMPLETOS` completos. */
  tamano?: number;
  /** true: cada documento sin `lineas` (los resúmenes y el libro no las usan). */
  sinLineas?: boolean;
}

/**
 * Recorre los documentos del filtro por páginas, en orden de número. Cada página se pide al adaptador con
 * una consulta acotada (`numero > último de la página anterior … LIMIT tamaño`), dentro de la misma
 * transacción.
 */
export function documentosPorPaginas(
  tx: TransaccionFiscal,
  filtro: FiltroDocumentos,
  opciones: OpcionesPaginas & { sinLineas: true },
): AsyncGenerator<ResumenDocumento[]>;
export function documentosPorPaginas(
  tx: TransaccionFiscal,
  filtro?: FiltroDocumentos,
  opciones?: OpcionesPaginas & { sinLineas?: false },
): AsyncGenerator<DocumentoFiscal[]>;
export async function* documentosPorPaginas(
  tx: TransaccionFiscal,
  filtro: FiltroDocumentos = {},
  opciones: OpcionesPaginas = {},
): AsyncGenerator<ResumenDocumento[]> {
  const sinLineas = opciones.sinLineas ?? false;
  const tamano = Math.max(1, Math.floor(opciones.tamano ?? (sinLineas ? TAMANO_PAGINA : TAMANO_PAGINA_COMPLETOS)));
  if (!tx.paginaDocumentos) {
    const todos = await tx.documentos(filtro);
    for (let i = 0; i < todos.length; i += tamano) {
      const pagina = todos.slice(i, i + tamano);
      yield sinLineas ? pagina.map(({ lineas: _l, ...resto }) => resto) : pagina;
    }
    return;
  }
  let despuesDe: string | undefined;
  for (;;) {
    // `limite` es un máximo: un adaptador puede devolver menos sin haber terminado. Se sigue hasta una página vacía.
    const pagina = await tx.paginaDocumentos(filtro, { despuesDe, limite: tamano, sinLineas });
    if (!pagina.length) return;
    yield pagina;
    despuesDe = pagina[pagina.length - 1]!.numero;
  }
}

/** Cuántos documentos cumplen el filtro, sin cargarlos si el adaptador sabe contar. */
export async function contarDocumentos(tx: TransaccionFiscal, filtro: FiltroDocumentos = {}): Promise<number> {
  if (tx.contarDocumentos) return tx.contarDocumentos(filtro);
  return (await tx.documentos(filtro)).length;
}

/** Correlativos (emitidos y anulados) de un identificador, en orden de número, sin cargar los documentos. */
export async function correlativosDe(tx: TransaccionFiscal, identificador: string): Promise<number[]> {
  if (tx.correlativos) return tx.correlativos(identificador);
  return (await tx.documentos({ identificador })).map((d) => d.correlativo);
}
