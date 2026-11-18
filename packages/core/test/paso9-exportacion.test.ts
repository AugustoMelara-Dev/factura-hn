/**
 * Paso 9 · B-10: exportación a texto (Reglamento Art. 53 num. 5) e integración contable (Art. 53 num. 1).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  exportarTexto,
  leerExportacionJSONL,
  registrarAutorizacion,
  type DocumentoFiscal,
  type LibroContable,
} from '../src';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Pulpería La Esquina', nombreComercial: 'La Esquina',
  direccionCasaMatriz: 'Ciudad Ejemplo', direccionEstablecimiento: 'Ciudad Ejemplo', telefono: '0000-0001', correo: 'p@ejemplo.example',
};
const aut = (tt: '01' | '06', cai: string) => ({
  cai, tipoDocumento: tt, establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
});
const caja = { establecimiento: '000', puntoEmision: '001' };

let almacen: AlmacenFiscalMemoria;
let docs: DocumentoFiscal[];
beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01'));
  await registrarAutorizacion(almacen, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'));
  const cliente = { nombre: 'Constructora "El Roble", S. de R.L. | Ciudad Ejemplo', rtn: '99990000000002' };
  const f1 = await emitir({ emisor: EMISOR, cliente, lineas: [{ descripcion: 'Chicle', cantidad: 3, precioUnitario: '0.10', isv: 'EXENTO' }] }, { almacen, ...caja });
  const f2 = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'Soda', cantidad: 1, precioUnitario: '19.99' }] }, { almacen, ...caja });
  const nc = await emitir({
    tipoDocumento: '06', emisor: EMISOR, cliente, motivo: 'Devolución',
    referencia: { cai: f1.cai, numero: f1.numero, fecha: f1.fechaEmision },
    lineas: [{ descripcion: 'Chicle', cantidad: 1, precioUnitario: '0.10', isv: 'EXENTO' }],
  }, { almacen, ...caja });
  const f2anulada = await anular(f2.numero, { almacen, motivo: 'Error de precio' });
  docs = [nc, f2anulada, f1];
});

describe('B-10 · Art. 53 num. 5: archivos tipo texto', () => {
  it('jsonl: ida y vuelta sin pérdida, ordenado por número', () => {
    const texto = exportarTexto(docs, { formato: 'jsonl' });
    expect(texto.trim().split('\n')).toHaveLength(3);
    const leidos = leerExportacionJSONL(texto);
    expect(leidos.map((d) => d.numero)).toEqual(['000-001-01-00000001', '000-001-01-00000002', '000-001-06-00000001']);
    expect(leidos).toEqual([docs[2], docs[1], docs[0]]);
  });

  it('csv: importes con dos decimales exactos, comillas y BOM', () => {
    const csv = exportarTexto(docs, { formato: 'csv' });
    expect(csv.startsWith('﻿numero,tipo,fecha,')).toBe(true);
    const [, f1, f2, nc] = csv.slice(1).trim().split('\n');
    expect(f1).toContain('"Constructora ""El Roble"", S. de R.L. | Ciudad Ejemplo"');
    expect(f1).toContain(',0.30,'); // 3 × 0.10, sin error de punto flotante
    expect(f1!.endsWith(',0.30,,')).toBe(true); // total, sin referencia ni anulación
    expect(f2).toContain(',ANULADO,');
    expect(f2!.endsWith(',19.99,0.00,3.00,0.00,0.00,22.99,,Error de precio')).toBe(true); // conserva lo emitido y el motivo
    expect(nc).toContain(',06,');
    expect(nc!.endsWith(',0.10,000-001-01-00000001,')).toBe(true);
  });

  it('txt: separador |, encabezado con versión y conteo; el | de los datos se limpia', () => {
    const lineas = exportarTexto(docs, { formato: 'txt' }).trim().split('\n');
    expect(lineas[0]).toBe('#factura-hn|v1|3');
    expect(lineas[1]!.split('|')).toHaveLength(21);
    for (const l of lineas.slice(2)) expect(l.split('|')).toHaveLength(21);
    expect(lineas[2]).toContain('S. de R.L.   Ciudad Ejemplo');
  });

  it('sin documentos: archivos válidos y vacíos', () => {
    expect(exportarTexto([], { formato: 'jsonl' })).toBe('');
    expect(exportarTexto([], { formato: 'txt' }).split('\n')[0]).toBe('#factura-hn|v1|0');
  });

  it('el módulo no usa toFixed ni parseFloat (importes desde centavos enteros)', () => {
    const fuente = readFileSync(new URL('../src/exportacion.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/toFixed|parseFloat/);
  });
});

describe('B-10 · Art. 53 num. 1: integración con el sistema contable', () => {
  const libro = () => {
    const asientos: string[] = [];
    const l: LibroContable = {
      registrarEmision: async (d) => { asientos.push(`+${d.numero}`); },
      registrarAnulacion: async (d) => { asientos.push(`-${d.numero}`); },
    };
    return { l, asientos };
  };

  it('emitir y anular registran el asiento dentro de la transacción', async () => {
    const { l, asientos } = libro();
    const f = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, { almacen, ...caja, libroContable: l });
    await anular(f.numero, { almacen, motivo: 'Prueba', libroContable: l });
    expect(asientos).toEqual([`+${f.numero}`, `-${f.numero}`]);
  });

  it('si el libro contable falla, la emisión se revierte y el número no se consume', async () => {
    const falla: LibroContable = {
      registrarEmision: async () => { throw new Error('contabilidad caída'); },
      registrarAnulacion: async () => {},
    };
    await expect(emitir({ emisor: EMISOR, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, { almacen, ...caja, libroContable: falla }))
      .rejects.toThrow('contabilidad caída');
    const siguiente = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, { almacen, ...caja });
    expect(siguiente.correlativo).toBe(3);
  });
});
