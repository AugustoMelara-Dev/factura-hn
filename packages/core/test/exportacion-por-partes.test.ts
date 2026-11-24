/**
 * Exportación por partes (`inicioExportacion` + `lineaExportacion`) y lectura por páginas: la API transmite el
 * archivo página por página y debe producir exactamente los mismos bytes que `exportarTexto` antes del cambio.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acumuladorResumenVentas,
  AlmacenFiscalMemoria,
  anular,
  inicioLibroVentasCSV,
  libroVentasCSV,
  lineaLibroVentasCSV,
  documentosPorPaginas,
  emitir,
  exportarTexto,
  filaLibroVentas,
  inicioExportacion,
  lineaExportacion,
  noUtilizadosDelAlmacen,
  registrarAutorizacion,
  resumenVentas,
  type DocumentoFiscal,
  type FormatoExportacion,
  type TransaccionFiscal,
} from '../src';
import { exportarTextoAnterior } from './exportacion-anterior';
import { libroVentasCSVAnterior, resumenVentasAnterior } from './libro-anterior';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Pulpería La Esquina', nombreComercial: 'La Esquina',
  direccionCasaMatriz: 'Ciudad Ejemplo', direccionEstablecimiento: 'Ciudad Ejemplo', telefono: '0000-0001', correo: 'p@ejemplo.example',
};
const aut = (tt: '01' | '06', cai: string, rangoFinal = 100) => ({
  cai, tipoDocumento: tt, establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal, fechaLimiteEmision: '2027-06-30',
});
const caja = { establecimiento: '000', puntoEmision: '001' };
const FORMATOS: FormatoExportacion[] = ['jsonl', 'csv', 'txt'];

let almacen: AlmacenFiscalMemoria;
let docs: DocumentoFiscal[];
beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01'));
  await registrarAutorizacion(almacen, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'));
  const cliente = { nombre: 'Constructora "El Roble", S. de R.L. | Ciudad Ejemplo\nSucursal', rtn: '99990000000002' };
  const f1 = await emitir({ emisor: EMISOR, cliente, lineas: [{ descripcion: 'Chicle', cantidad: 3, precioUnitario: '0.10', isv: 'EXENTO' }] }, { almacen, ...caja });
  const f2 = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'Soda', cantidad: 1, precioUnitario: '19.99' }] }, { almacen, ...caja });
  await emitir({ emisor: EMISOR, cliente: { nombre: '=SUMA(A1)' }, lineas: [{ descripcion: 'Cemento', cantidad: 2, precioUnitario: '245.00' }] }, { almacen, ...caja });
  await emitir({
    tipoDocumento: '06', emisor: EMISOR, cliente, motivo: 'Devolución',
    referencia: { cai: f1.cai, numero: f1.numero, fecha: f1.fechaEmision },
    lineas: [{ descripcion: 'Chicle', cantidad: 1, precioUnitario: '0.10', isv: 'EXENTO' }],
  }, { almacen, ...caja });
  await anular(f2.numero, { almacen, motivo: 'Error de precio | caja' });
  docs = await almacen.transaccion((tx) => tx.documentos());
});

/** Lo que hace la API: el inicio y luego cada página, en orden de número. */
async function porPartes(formato: FormatoExportacion, tamano: number): Promise<string> {
  return almacen.transaccion(async (tx) => {
    let texto = inicioExportacion(formato, (await tx.documentos()).length);
    if (formato === 'jsonl') {
      for await (const p of documentosPorPaginas(tx, {}, { tamano })) texto += p.map((d) => lineaExportacion(d, formato)).join('');
    } else {
      for await (const p of documentosPorPaginas(tx, {}, { tamano, sinLineas: true })) texto += p.map((d) => lineaExportacion(d, formato)).join('');
    }
    return texto;
  });
}

describe('exportación por partes', () => {
  it('factura, nota de crédito y anulado: igual byte por byte a la implementación anterior', async () => {
    expect(docs.map((d) => [d.tipoDocumento, d.estado])).toEqual([['01', 'EMITIDO'], ['01', 'ANULADO'], ['01', 'EMITIDO'], ['06', 'EMITIDO']]);
    for (const formato of FORMATOS) {
      const anterior = exportarTextoAnterior([...docs].reverse(), { formato });
      expect(exportarTexto([...docs].reverse(), { formato })).toBe(anterior);
      for (const tamano of [1, 3, 200]) expect(await porPartes(formato, tamano)).toBe(anterior);
    }
  });

  it('sin documentos: igual a la implementación anterior', () => {
    for (const formato of FORMATOS) expect(inicioExportacion(formato, 0)).toBe(exportarTextoAnterior([], { formato }));
  });

  it('libro de ventas desde páginas sin líneas: mismas filas y totales', async () => {
    const esperado = docs.map(filaLibroVentas);
    const filas = await almacen.transaccion(async (tx) => {
      const r = [];
      for await (const p of documentosPorPaginas(tx, {}, { tamano: 2, sinLineas: true })) r.push(...p.map(filaLibroVentas));
      return r;
    });
    expect(filas).toEqual(esperado);
    expect(resumenVentas(filas)).toEqual(resumenVentas(esperado));
  });
});

describe('libro de ventas por partes', () => {
  it('CSV y resumen incremental: iguales byte por byte a la implementación anterior', () => {
    const filas = docs.map(filaLibroVentas);
    const anterior = libroVentasCSVAnterior(filas);
    expect(libroVentasCSV(filas)).toBe(anterior);
    expect(inicioLibroVentasCSV() + filas.map(lineaLibroVentasCSV).join('')).toBe(anterior);
    expect(inicioLibroVentasCSV()).toBe(libroVentasCSVAnterior([]));
    const acc = acumuladorResumenVentas();
    filas.forEach((f) => acc.agregar(f));
    expect(JSON.stringify(acc.resumen())).toBe(JSON.stringify(resumenVentasAnterior(filas)));
    expect(JSON.stringify(acumuladorResumenVentas().resumen())).toBe(JSON.stringify(resumenVentasAnterior([])));
  });
});

describe('páginas de un adaptador que devuelve menos que el límite', () => {
  it('se sigue hasta una página vacía: no se pierde ningún documento', async () => {
    const todos = await almacen.transaccion((tx) => tx.documentos());
    const leidos = await almacen.transaccion(async (tx) => {
      const corto: TransaccionFiscal = {
        ...tx,
        // Nunca más de uno, aunque se pidan tres.
        paginaDocumentos: async (filtro, p) => (await tx.documentos(filtro)).filter((d) => !p.despuesDe || d.numero > p.despuesDe).slice(0, 1),
      };
      const r: string[] = [];
      for await (const p of documentosPorPaginas(corto, {}, { tamano: 3 })) r.push(...p.map((d) => d.numero));
      return r;
    });
    expect(leidos).toEqual(todos.map((d) => d.numero));
  });
});

describe('páginas de un adaptador que ignora despuesDe', () => {
  it('lanza en vez de repetir la misma página para siempre', async () => {
    await almacen.transaccion(async (tx) => {
      const roto: TransaccionFiscal = { ...tx, paginaDocumentos: async (filtro, p) => (await tx.documentos(filtro)).slice(0, p.limite) };
      await expect((async () => {
        for await (const _p of documentosPorPaginas(roto, {}, { tamano: 2 })) { /* recorrer */ }
      })()).rejects.toThrow(/no avanzó/);
    });
  });
});

describe('no utilizados sin cargar documentos', () => {
  it('usa los correlativos del adaptador y da el mismo resultado', async () => {
    const hoy = '2027-07-15';
    const esperado = await noUtilizadosDelAlmacen(almacen, '000-001-01', { hoy });
    expect(esperado.map((r) => [r.desde, r.hasta])).toEqual([[4, 100]]);
    // Un almacén que solo sabe dar correlativos: si el núcleo pidiera los documentos, fallaría.
    const soloCorrelativos = {
      transaccion: <T>(fn: (tx: TransaccionFiscal) => Promise<T>) => almacen.transaccion((tx) => fn({
        ...tx,
        documentos: async () => { throw new Error('no debe cargar documentos'); },
        correlativos: async (id: string) => (await tx.documentos({ identificador: id })).map((d) => d.correlativo),
      })),
    };
    expect(await noUtilizadosDelAlmacen(soloCorrelativos, '000-001-01', { hoy })).toEqual(esperado);
  });
});
