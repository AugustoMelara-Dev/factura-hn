/**
 * Copia congelada de `resumenVentas` y `libroVentasCSV` tal como eran cuando el libro se armaba en memoria de una
 * vez. Las pruebas comparan la salida por partes con esta, byte por byte; no se usa fuera de las pruebas.
 */
import { centavosATexto, deCentavos, escaladoATexto, parsearDecimal, redondearDecimal, textoSeguroCSV } from '../src/dinero';
import type { FilaLibroVentas, ResumenVentas } from '../src';

export function resumenVentasAnterior(filas: FilaLibroVentas[]): ResumenVentas {
  const campos = ['importeExonerado', 'importeExento', 'importeGravado0', 'importeGravado15', 'importeGravado18', 'isv15', 'isv18', 'total'] as const;
  const acc: Record<(typeof campos)[number], bigint> = {
    importeExonerado: 0n, importeExento: 0n, importeGravado0: 0n, importeGravado15: 0n, importeGravado18: 0n, isv15: 0n, isv18: 0n, total: 0n,
  };
  for (const f of filas) for (const c of campos) acc[c] += redondearDecimal(f[c], 2);
  const r = { documentos: filas.length } as ResumenVentas;
  for (const c of campos) r[c] = deCentavos(acc[c]);
  return r;
}

export function libroVentasCSVAnterior(filas: FilaLibroVentas[]): string {
  const enc = ['Fecha', 'Tipo', 'Número', 'CAI', 'Cliente', 'RTN cliente', 'Exonerado', 'Exento', 'Gravado 0%', 'Gravado 15%', 'Gravado 18%', 'ISV 15%', 'ISV 18%', 'Total', 'Anulado', 'Moneda', 'Tipo de cambio', 'Total en moneda original'];
  const q = (v: unknown) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const m = (v: number) => centavosATexto(redondearDecimal(v, 2));
  const filasCsv = filas.map((f) =>
    [f.fecha, f.tipoDocumento, f.numero, f.cai, textoSeguroCSV(f.clienteNombre), textoSeguroCSV(f.clienteRTN),
      m(f.importeExonerado), m(f.importeExento), m(f.importeGravado0), m(f.importeGravado15), m(f.importeGravado18),
      m(f.isv15), m(f.isv18), m(f.total), f.anulado ? 'SI' : 'NO',
      f.moneda, f.tipoCambio === null ? '' : escaladoATexto(parsearDecimal(f.tipoCambio, 6), 6), m(f.totalMonedaOriginal)].map(q).join(','),
  );
  return '﻿' + [enc.join(','), ...filasCsv].join('\n') + '\n';
}
