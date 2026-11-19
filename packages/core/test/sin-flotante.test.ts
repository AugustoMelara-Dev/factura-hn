/**
 * Ley del ISV Art. 9: cobrar un ISV redondeado fuera de la regla «se considerará como hurto».
 * Un `number` binario no representa los centavos exactamente, así que la ruta de cálculo del dinero
 * no puede usar punto flotante. Esta prueba lo vigila de forma estructural (como test_no_float de
 * invoicehn) y con casos que un flotante resolvería mal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aCentavos,
  calcularDocumento,
  formatearMonto,
  libroVentasCSV,
  montoEnLetras,
  parsearDecimal,
  resumenVentas,
  type FilaLibroVentas,
} from '../src';

const RUTA_DEL_DINERO = ['dinero.ts', 'calculo.ts', 'reportes.ts', 'letras.ts'];
const PROHIBIDO = [
  /\bparseFloat\b/,
  /\.toFixed\(/,
  /\.toPrecision\(/,
  /\bMath\.(round|ceil|fround)\b/,
  /\bNumber\.EPSILON\b/,
];
// En el cálculo propiamente dicho tampoco se trunca ni se divide entre 100 en flotante.
const PROHIBIDO_EN_CALCULO = [/\bMath\.(floor|trunc)\b/, /\/\s*100\b(?!n)/];

describe('ruta del dinero sin punto flotante', () => {
  for (const archivo of RUTA_DEL_DINERO) {
    it(`${archivo} no usa operaciones de punto flotante`, () => {
      const fuente = readFileSync(join(__dirname, '..', 'src', archivo), 'utf8');
      fuente.split('\n').forEach((linea, i) => {
        const codigo = linea.replace(/\/\/.*$/, '').trim();
        if (codigo.startsWith('*') || codigo.startsWith('/*')) return;
        if (linea.includes('permitido: salida')) return;
        const reglas = archivo === 'letras.ts' ? PROHIBIDO : [...PROHIBIDO, ...PROHIBIDO_EN_CALCULO];
        for (const r of reglas) {
          expect(codigo, `${archivo}:${i + 1} usa ${r}: ${linea.trim()}`).not.toMatch(r);
        }
      });
    });
  }
});

describe('casos que un flotante resolvería mal', () => {
  it('0.1 + 0.2 como importes de línea suma 0.30 exacto', () => {
    const { totales } = calcularDocumento(
      [
        { descripcion: 'a', cantidad: 1, precioUnitario: 0.1, isv: 'EXENTO' },
        { descripcion: 'b', cantidad: 1, precioUnitario: '0.2', isv: 'EXENTO' },
      ],
    );
    expect(totales.importeExento).toBe(0.3);
    expect(totales.total).toBe(0.3);
  });

  it('un number con ruido binario se rechaza en lugar de redondearse en silencio', () => {
    expect(() => calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: 0.1 + 0.2 }])).toThrow(/4 decimales/);
    expect(() => parsearDecimal(0.1 + 0.2, 2)).toThrow(/2 decimales/);
  });

  it('1.005 redondea a 1.01 (mitad hacia arriba sobre el decimal, no sobre el binario)', () => {
    expect(aCentavos(1.005)).toBe(101);
    expect(formatearMonto(1.005)).toBe('1.01');
    expect(montoEnLetras('1.005')).toBe('UN LEMPIRA CON 01/100');
  });

  it('1.5 × 33.33 = 49.995 → 50.00 (el redondeo de la línea ocurre una sola vez)', () => {
    const { lineas } = calcularDocumento([{ descripcion: 'Queso', cantidad: '1.5', precioUnitario: '33.33', isv: 'EXENTO' }]);
    expect(lineas[0]!.importe).toBe(50);
  });

  it('acepta texto con separador de miles y exponentes', () => {
    expect(parsearDecimal('1,234.56', 2)).toBe(123456n);
    expect(parsearDecimal('12,345,678.9', 2)).toBe(1234567890n);
    expect(parsearDecimal('-1,000', 2)).toBe(-100000n);
    expect(parsearDecimal(1e-2, 2)).toBe(1n);
    expect(parsearDecimal('2.5e3', 2)).toBe(250000n);
  });

  it('una coma que no separa miles es un error, no un monto 100 veces mayor', () => {
    for (const malo of ['89,50', '8,9,5', '1,2345.00', ',50', '1,23', '1,234,5', '89,']) {
      expect(() => parsearDecimal(malo, 2), malo).toThrow(/La coma solo separa miles/);
    }
    expect(() => calcularDocumento([{ descripcion: 'Café', cantidad: 1, precioUnitario: '89,50' }])).toThrow(/89,50/);
  });

  it('montos grandes sin pérdida: 99,999,999.99 × 3', () => {
    const { totales } = calcularDocumento([{ descripcion: 'x', cantidad: 3, precioUnitario: '99999999.99', isv: 'EXENTO' }]);
    expect(formatearMonto(totales.total)).toBe('299,999,999.97');
  });

  it('el resumen y el CSV suman en centavos exactos', () => {
    const fila = (total: number): FilaLibroVentas => ({
      fecha: '2026-11-18', tipoDocumento: 'Factura', numero: '000-001-01-00000001', cai: 'X', clienteNombre: 'C',
      clienteRTN: '', moneda: 'HNL', tipoCambio: null, totalMonedaOriginal: total, importeExonerado: 0, importeExento: total, importeGravado0: 0, importeGravado15: 0, importeGravado18: 0,
      isv15: 0, isv18: 0, total, anulado: false,
    });
    const filas = Array.from({ length: 10 }, () => fila(0.1));
    expect(resumenVentas(filas).total).toBe(1);
    expect(libroVentasCSV([fila(0.1)])).toContain(',0.10,');
  });
});
