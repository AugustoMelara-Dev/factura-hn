/**
 * Exportación a archivos de texto e integración contable (Reglamento Art. 53, C L.2161-2185).
 *
 * Art. 53 num. 5: «El Sistema debe tener la capacidad de generación de archivos tipo texto para su
 * almacenamiento y traslado hacia la Administración Tributaria a través de servicios web o intercambio de
 * protocolo.»
 * Art. 53 num. 1: «El sistema de facturación debe estar integrado al menos a un sistema contable o de
 * inventarios.»
 *
 * factura-hn ofrece tres formatos abiertos y documentados.
 * Todos los importes se escriben desde centavos enteros, sin punto flotante.
 */
import { centavosATexto, redondearDecimal, textoSeguroCSV } from './dinero';
import type { TransaccionFiscal } from './almacen';
import { esDocumentoDePrueba } from './modo';
import type { DocumentoFiscal, ResumenDocumento } from './tipos';

export type FormatoExportacion = 'jsonl' | 'csv' | 'txt';

/**
 * Versión del formato de exportación; cambia si cambian las columnas. La 2 agrega al final `tipoCambio` y
 * `fechaAnulacion`; las columnas de la 1 no cambian de nombre ni de orden, así que un lector de la 1 que lee por
 * nombre (o las primeras 21) sigue funcionando.
 */
export const VERSION_EXPORTACION = 2;

const COLUMNAS = [
  'numero', 'tipo', 'fecha', 'hora', 'cai', 'estado', 'emisorRTN', 'clienteRTN', 'clienteNombre', 'moneda',
  'exonerado', 'exento', 'gravado0', 'gravado15', 'gravado18', 'isv15', 'isv18', 'descuentos', 'total',
  'referencia', 'motivoAnulacion',
  // Versión 2: al final, para no mover las columnas de la 1.
  'tipoCambio', 'fechaAnulacion',
] as const;

const monto = (v: number) => centavosATexto(redondearDecimal(v, 2));

function fila(d: ResumenDocumento): Record<(typeof COLUMNAS)[number], string> {
  const t = d.totales;
  return {
    numero: d.numero,
    tipo: d.tipoDocumento,
    fecha: d.fechaEmision,
    hora: d.horaEmision ?? '',
    cai: d.cai,
    estado: d.estado,
    emisorRTN: d.emisor.rtn,
    clienteRTN: d.cliente.rtn ?? '',
    clienteNombre: d.cliente.nombreImpreso,
    moneda: d.moneda,
    exonerado: monto(t.importeExonerado),
    exento: monto(t.importeExento),
    gravado0: monto(t.importeGravado0),
    gravado15: monto(t.importeGravado15),
    gravado18: monto(t.importeGravado18),
    isv15: monto(t.isv15),
    isv18: monto(t.isv18),
    descuentos: monto(t.descuentos),
    total: monto(t.total),
    referencia: d.referencia?.numero ?? '',
    motivoAnulacion: d.anulacion?.motivo ?? '',
    tipoCambio: d.tipoCambio !== undefined ? String(d.tipoCambio) : '',
    fechaAnulacion: d.anulacion?.fecha ?? '',
  };
}

/**
 * Exporta documentos a texto.
 *
 * - `jsonl`: un documento completo por línea (JSON). Sirve para respaldo y traslado sin pérdida: se lee
 *   con `leerExportacionJSONL`.
 * - `csv`: una fila por documento (resumen fiscal), separador coma, UTF-8 con BOM para Excel.
 * - `txt`: lo mismo con separador `|`, sin BOM, con una línea de encabezado `#factura-hn|v2|…` (versión, `VERSION_EXPORTACION`).
 *
 * Los anulados se exportan con sus importes originales y `estado = ANULADO`: el archivo conserva lo que se
 * emitió; quien lo procese decide cómo contarlo (el libro de ventas los pone en cero).
 *
 * Los documentos de prueba (`esDocumentoDePrueba`) no se exportan: no tienen valor fiscal. El formato de las
 * filas no cambia; para saber cuántos quedaron fuera, usa `separarDocumentosDePrueba(docs).excluidos`.
 */
export function exportarTexto(docs: readonly DocumentoFiscal[], opciones: { formato: FormatoExportacion }): string {
  const ordenados = separarDocumentosDePrueba(docs).reales.sort((a, b) => (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0));
  return inicioExportacion(opciones.formato, ordenados.length) + ordenados.map((d) => lineaExportacion(d, opciones.formato)).join('');
}

/**
 * Encabezado del archivo de `exportarTexto` para `total` documentos. Con `lineaExportacion` permite escribir
 * el archivo por partes (p. ej. en una respuesta HTTP transmitida) con el mismo contenido byte por byte:
 * `inicioExportacion(f, docs.length) + docs.map((d) => lineaExportacion(d, f)).join('')`, con `docs` en
 * orden de número, es igual a `exportarTexto(docs, { formato: f })`.
 */
export function inicioExportacion(formato: FormatoExportacion, total: number): string {
  switch (formato) {
    case 'jsonl':
      return '';
    case 'csv':
      return '﻿' + COLUMNAS.join(',') + '\n';
    case 'txt':
      return `#factura-hn|v${VERSION_EXPORTACION}|${total}\n` + COLUMNAS.join('|') + '\n';
    default:
      throw new Error(`Formato de exportación desconocido: ${String(formato)}. Usa 'jsonl', 'csv' o 'txt'.`);
  }
}

/**
 * Separa los documentos reales de los de prueba (`esDocumentoDePrueba`: `modo: 'prueba'` o CAI ficticio).
 * `exportarTexto` y `libroVentas` lo usan para dejar fuera los de prueba; `excluidos` dice cuántos quedaron
 * fuera. Úsalo también antes de `lineaExportacion` o `filaLibroVentas` cuando armes el archivo por partes.
 */
export function separarDocumentosDePrueba<T extends Pick<DocumentoFiscal, 'modo' | 'cai'>>(docs: readonly T[]): { reales: T[]; excluidos: number } {
  const reales = docs.filter((d) => !esDocumentoDePrueba(d));
  return { reales, excluidos: docs.length - reales.length };
}

/**
 * Línea de un documento en el archivo de `exportarTexto`, con su salto de línea final. `jsonl` necesita el
 * documento completo. No filtra: si armas el archivo por partes, deja fuera los documentos de prueba
 * (`esDocumentoDePrueba`) y cuenta solo los reales en `inicioExportacion`.
 */
export function lineaExportacion(d: DocumentoFiscal, formato: FormatoExportacion): string;
export function lineaExportacion(d: ResumenDocumento, formato: 'csv' | 'txt'): string;
export function lineaExportacion(d: ResumenDocumento, formato: FormatoExportacion): string {
  switch (formato) {
    case 'jsonl':
      return JSON.stringify(d) + '\n';
    case 'csv': {
      const f = fila(d);
      return COLUMNAS.map((c) => comillasCSV(TEXTO_CSV.has(c) ? textoSeguroCSV(f[c]) : f[c])).join(',') + '\n';
    }
    case 'txt': {
      const f = fila(d);
      return COLUMNAS.map((c) => f[c].replace(/[|\r\n]+/g, ' ')).join('|') + '\n';
    }
    default:
      throw new Error(`Formato de exportación desconocido: ${String(formato)}. Usa 'jsonl', 'csv' o 'txt'.`);
  }
}

const TEXTO_CSV = new Set<string>(['clienteNombre', 'clienteRTN', 'motivoAnulacion', 'referencia']);
const comillasCSV = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Error al leer un archivo `jsonl`: dice en qué línea. Extiende `SyntaxError`, el error que se lanzaba antes, así
 * que un `catch` que lo buscaba sigue funcionando.
 */
export class ErrorExportacion extends SyntaxError {
  constructor(
    mensaje: string,
    /** Línea del archivo (desde 1). */
    readonly linea: number,
  ) {
    super(mensaje);
    this.name = 'ErrorExportacion';
  }
}

/**
 * Lee un archivo `jsonl` de `exportarTexto` y devuelve los documentos tal como se exportaron. Una línea que no es
 * JSON, o que no es un objeto, lanza `ErrorExportacion` con su número.
 */
export function leerExportacionJSONL(texto: string): DocumentoFiscal[] {
  const docs: DocumentoFiscal[] = [];
  texto.split(/\r?\n/).forEach((l, i) => {
    if (l.trim() === '') return;
    let valor: unknown;
    try {
      valor = JSON.parse(l);
    } catch (e) {
      throw new ErrorExportacion(`Línea ${i + 1} del archivo jsonl: no es JSON válido (${(e as Error).message}).`, i + 1);
    }
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
      throw new ErrorExportacion(`Línea ${i + 1} del archivo jsonl: se esperaba un documento (un objeto JSON).`, i + 1);
    }
    docs.push(valor as DocumentoFiscal);
  });
  return docs;
}

/**
 * Integración con el sistema contable o de inventarios (Art. 53 num. 1).
 *
 * Pásalo a `emitir`, `anular` y `corregirFechaAdelantada`: cada método corre **dentro** de la transacción
 * fiscal. Si lanza, la emisión o anulación se revierte (el número no se consume), así el libro contable y el
 * fiscal nunca quedan descuadrados. Si tu contabilidad está en otra base, registra aquí en una cola
 * (outbox) de la misma base y procésala aparte.
 */
export interface LibroContable {
  registrarEmision(doc: DocumentoFiscal, tx: TransaccionFiscal): Promise<void>;
  registrarAnulacion(doc: DocumentoFiscal, tx: TransaccionFiscal): Promise<void>;
}
