/**
 * Una sola conversión a lempiras para los documentos en moneda extranjera (src/conversion.ts): el libro de ventas,
 * el equivalente impreso, el tope de las notas de crédito y los importes de la nota la usan todos. Por eso:
 * - cada fila del libro cuadra: total = exonerado + exento + gravados + ISV, al centavo;
 * - una nota de crédito con las mismas líneas del original lo acredita entero: saldo 0 y neto 0 en el libro;
 * - el equivalente impreso del original es el mismo que su fila del libro.
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  crearFacturador,
  esErrorValidacion,
  libroVentas,
  type FilaLibroVentas,
  type LineaEntrada,
  type TratamientoISV,
} from '../../src';
import { EMISOR_DEMO } from '../../src/demo';
import { corridas, fc, TIEMPO } from './config';

const CLIENTE = { nombre: 'Importadora Norte', rtn: '99990000000002' };
const COLUMNAS = ['importeExonerado', 'importeExento', 'importeGravado0', 'importeGravado15', 'importeGravado18', 'isv15', 'isv18'] as const;
const cuadra = (f: FilaLibroVentas) => Math.round(COLUMNAS.reduce((s, c) => s + f[c] * 100, 0)) === Math.round(f.total * 100);

async function caja() {
  const almacen = new AlmacenFiscalMemoria();
  const f = crearFacturador({ almacen, emisor: EMISOR_DEMO });
  for (const tipoDocumento of ['01', '06'] as const) {
    await f.registrarAutorizacion({ cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${tipoDocumento}`, tipoDocumento, rangoInicial: 1, rangoFinal: 99_999, fechaLimiteEmision: '2099-12-31' });
  }
  return f;
}

/** Devuelve todo y comprueba saldo 0, neto 0 y filas que cuadran. */
async function devolverTodo(lineas: LineaEntrada[], tipoCambio: string, preciosIncluyenISV = false) {
  const f = await caja();
  const factura = await f.emitir({ cliente: CLIENTE, moneda: 'USD', tipoCambio, lineas, preciosIncluyenISV });
  const nota = await f.notaCredito({ original: factura.numero, motivo: 'Devolución total', lineas });
  const { filas, resumen } = libroVentas([factura, nota]);
  return { f, factura, nota, filas, resumen };
}

describe('USD: una sola conversión a lempiras', () => {
  it('el caso del ron y el servicio: la nota por el total deja neto 0 y las filas cuadran', async () => {
    const lineas: LineaEntrada[] = [
      { descripcion: 'Servicio', cantidad: '3', precioUnitario: '33.3333' },
      { descripcion: 'Ron', cantidad: '1', precioUnitario: '19.99', isv: 'ISV18' },
    ];
    const { f, factura, filas, resumen } = await devolverTodo(lineas, '24.6789');
    expect(filas[0]).toMatchObject({ importeGravado15: 2467.89, importeGravado18: 493.33, isv15: 370.18, isv18: 88.84, total: 3420.24 });
    expect(filas.every(cuadra)).toBe(true);
    expect(resumen).toMatchObject({ documentos: 2, importeGravado15: 0, importeGravado18: 0, isv15: 0, isv18: 0, total: 0 });
    // El impreso dice lo mismo que el libro.
    expect(factura.equivalenteLempiras).toEqual({ isv15: 370.18, isv18: 88.84, total: 3420.24 });
    // Y no queda saldo que acreditar.
    const residuo = await f.notaCredito({ original: factura.numero, motivo: 'x', lineas: [{ descripcion: 'Ajuste', cantidad: '1', precioUnitario: '0.01' }] }).catch((e: unknown) => e);
    expect(esErrorValidacion(residuo) && residuo.errores[0]!.mensaje).toContain('saldo disponible L 0.00');
  });

  const linea = fc.record({
    descripcion: fc.constant('Producto'),
    cantidad: fc.integer({ min: 1, max: 5_000 }).map((n) => (n / 100).toFixed(2)),
    precioUnitario: fc.integer({ min: 1, max: 5_000_000 }).map((n) => (n / 10_000).toFixed(4)),
    isv: fc.constantFrom<TratamientoISV>('ISV15', 'ISV18', 'EXENTO', 'GRAVADO0'),
  });
  const tipoCambio = fc.tuple(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 999_999 }), fc.integer({ min: 4, max: 6 }))
    .map(([e, d, n]) => `${e}.${String(d).padStart(6, '0').slice(0, n)}`);

  it('propiedad: para cualquier factura USD (tipo de cambio de 4 a 6 decimales), devolverla entera deja neto 0', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(linea, { minLength: 1, maxLength: 6 }), tipoCambio, fc.boolean(), async (lineas, tc, incluye) => {
        const { factura, filas, resumen } = await devolverTodo(lineas, tc, incluye);
        expect(filas.every(cuadra)).toBe(true);
        for (const c of [...COLUMNAS, 'total'] as const) expect([c, resumen[c]]).toEqual([c, 0]);
        expect(factura.equivalenteLempiras!.total).toBe(filas[0]!.total);
      }),
      { numRuns: corridas(0.25) },
    );
  }, TIEMPO);
});
