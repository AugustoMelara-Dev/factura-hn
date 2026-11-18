/**
 * Exportación a archivos de texto e integración contable (Reglamento Art. 53, C L.2161-2185).
 *
 * Art. 53 num. 5: «El Sistema debe tener la capacidad de generación de archivos tipo texto para su
 * almacenamiento y traslado hacia la Administración Tributaria a través de servicios web o intercambio de
 * protocolo.»
 * Art. 53 num. 1: «El sistema de facturación debe estar integrado al menos a un sistema contable o de
 * inventarios.»
 *
 * En las fuentes revisadas el SAR no fija un formato de archivo para autoimpresores (P-14 en
 * docs/investigacion.md). Por eso
 * se ofrecen tres formatos abiertos y
 * documentados; cuando exista un formato oficial se agrega aquí.
 * Todos los importes se escriben desde centavos enteros, sin punto flotante.
 */
import { centavosATexto, redondearDecimal, textoSeguroCSV } from './dinero';
import type { TransaccionFiscal } from './almacen';
import type { DocumentoFiscal } from './tipos';

export type FormatoExportacion = 'jsonl' | 'csv' | 'txt';

/** Versión del formato de exportación; cambia si cambian las columnas. */
export const VERSION_EXPORTACION = 1;

const COLUMNAS = [
  'numero', 'tipo', 'fecha', 'hora', 'cai', 'estado', 'emisorRTN', 'clienteRTN', 'clienteNombre', 'moneda',
  'exonerado', 'exento', 'gravado0', 'gravado15', 'gravado18', 'isv15', 'isv18', 'descuentos', 'total',
  'referencia', 'motivoAnulacion',
] as const;

const monto = (v: number) => centavosATexto(redondearDecimal(v, 2));

function fila(d: DocumentoFiscal): Record<(typeof COLUMNAS)[number], string> {
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
  };
}

/**
 * Exporta documentos a texto.
 *
 * - `jsonl`: un documento completo por línea (JSON). Sirve para respaldo y traslado sin pérdida: se lee
 *   con `leerExportacionJSONL`.
 * - `csv`: una fila por documento (resumen fiscal), separador coma, UTF-8 con BOM para Excel.
 * - `txt`: lo mismo con separador `|`, sin BOM, con una línea de encabezado `#factura-hn|v1|…`.
 *
 * Los anulados se exportan con sus importes originales y `estado = ANULADO`: el archivo conserva lo que se
 * emitió; quien lo procese decide cómo contarlo (el libro de ventas los pone en cero).
 */
export function exportarTexto(docs: readonly DocumentoFiscal[], opciones: { formato: FormatoExportacion }): string {
  const ordenados = [...docs].sort((a, b) => (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0));
  switch (opciones.formato) {
    case 'jsonl':
      return ordenados.map((d) => JSON.stringify(d)).join('\n') + (ordenados.length ? '\n' : '');
    case 'csv': {
      const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
      const texto = new Set<string>(['clienteNombre', 'clienteRTN', 'motivoAnulacion', 'referencia']);
      const lineas = ordenados.map((d) => COLUMNAS.map((c) => q(texto.has(c) ? textoSeguroCSV(fila(d)[c]) : fila(d)[c])).join(','));
      return '﻿' + [COLUMNAS.join(','), ...lineas].join('\n') + '\n';
    }
    case 'txt': {
      const limpio = (s: string) => s.replace(/[|\r\n]+/g, ' ');
      const lineas = ordenados.map((d) => COLUMNAS.map((c) => limpio(fila(d)[c])).join('|'));
      return [`#factura-hn|v${VERSION_EXPORTACION}|${ordenados.length}`, COLUMNAS.join('|'), ...lineas].join('\n') + '\n';
    }
    default:
      throw new Error(`Formato de exportación desconocido: ${String((opciones as { formato: unknown }).formato)}`);
  }
}

/** Lee un archivo `jsonl` de `exportarTexto` y devuelve los documentos tal como se exportaron. */
export function leerExportacionJSONL(texto: string): DocumentoFiscal[] {
  return texto
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as DocumentoFiscal);
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
