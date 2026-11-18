/**
 * Resúmenes para el libro de ventas y la declaración mensual del ISV.
 * Las notas de crédito restan y las notas de débito suman.
 */
import { centavosATexto, deCentavos, redondearDecimal, textoSeguroCSV } from './dinero';
import type { DocumentoFiscal } from './tipos';

export interface FilaLibroVentas {
  fecha: string;
  tipoDocumento: string;
  numero: string;
  cai: string;
  clienteNombre: string;
  clienteRTN: string;
  importeExonerado: number;
  importeExento: number;
  importeGravado0: number;
  importeGravado15: number;
  importeGravado18: number;
  isv15: number;
  isv18: number;
  total: number;
  anulado: boolean;
}

/**
 * Una fila por documento. Los anulados (Art. 41) se registran con su número y montos en cero, para que la
 * numeración del libro no tenga huecos. El estado se toma del propio documento.
 */
export function filaLibroVentas(doc: DocumentoFiscal): FilaLibroVentas {
  const anulado = doc.estado === 'ANULADO';
  const signo = doc.tipoDocumento === '06' ? -1 : 1;
  const m = (v: number) => (anulado ? 0 : signo * v);
  const t = doc.totales;
  return {
    fecha: doc.fechaEmision,
    tipoDocumento: doc.nombreDocumento,
    numero: doc.numero,
    cai: doc.cai,
    clienteNombre: doc.cliente.nombreImpreso,
    clienteRTN: doc.cliente.rtn ?? '',
    importeExonerado: m(t.importeExonerado),
    importeExento: m(t.importeExento),
    importeGravado0: m(t.importeGravado0),
    importeGravado15: m(t.importeGravado15),
    importeGravado18: m(t.importeGravado18),
    isv15: m(t.isv15),
    isv18: m(t.isv18),
    total: m(t.total),
    anulado,
  };
}

export type ResumenVentas = Omit<FilaLibroVentas, 'fecha' | 'tipoDocumento' | 'numero' | 'cai' | 'clienteNombre' | 'clienteRTN' | 'anulado'> & {
  documentos: number;
};

export function resumenVentas(filas: FilaLibroVentas[]): ResumenVentas {
  const campos = ['importeExonerado', 'importeExento', 'importeGravado0', 'importeGravado15', 'importeGravado18', 'isv15', 'isv18', 'total'] as const;
  const acc: Record<(typeof campos)[number], bigint> = {
    importeExonerado: 0n, importeExento: 0n, importeGravado0: 0n, importeGravado15: 0n, importeGravado18: 0n, isv15: 0n, isv18: 0n, total: 0n,
  };
  for (const f of filas) for (const c of campos) acc[c] += redondearDecimal(f[c], 2);
  const r = { documentos: filas.length } as ResumenVentas;
  for (const c of campos) r[c] = deCentavos(acc[c]);
  return r;
}

/** CSV con separador coma y BOM para que Excel lo abra con acentos. */
export function libroVentasCSV(filas: FilaLibroVentas[]): string {
  const enc = ['Fecha', 'Tipo', 'Número', 'CAI', 'Cliente', 'RTN cliente', 'Exonerado', 'Exento', 'Gravado 0%', 'Gravado 15%', 'Gravado 18%', 'ISV 15%', 'ISV 18%', 'Total', 'Anulado'];
  const q = (v: unknown) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const m = (v: number) => centavosATexto(redondearDecimal(v, 2));
  const filasCsv = filas.map((f) =>
    [f.fecha, f.tipoDocumento, f.numero, f.cai, textoSeguroCSV(f.clienteNombre), textoSeguroCSV(f.clienteRTN),
      m(f.importeExonerado), m(f.importeExento), m(f.importeGravado0), m(f.importeGravado15), m(f.importeGravado18),
      m(f.isv15), m(f.isv18), m(f.total), f.anulado ? 'SI' : 'NO'].map(q).join(','),
  );
  return '﻿' + [enc.join(','), ...filasCsv].join('\n') + '\n';
}
