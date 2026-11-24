/**
 * Copia congelada de `exportarTexto` tal como era cuando el archivo se armaba en memoria de una vez. Las pruebas
 * comparan la salida por partes con esta, byte por byte; no se usa fuera de las pruebas.
 */
import { centavosATexto, redondearDecimal, textoSeguroCSV } from '../src/dinero';
import { VERSION_EXPORTACION, type DocumentoFiscal, type FormatoExportacion } from '../src';

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

export function exportarTextoAnterior(docs: readonly DocumentoFiscal[], opciones: { formato: FormatoExportacion }): string {
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
