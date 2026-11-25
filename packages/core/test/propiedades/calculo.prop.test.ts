/**
 * Propiedades del cálculo de líneas y totales (src/calculo.ts):
 * - Reglamento Art. 11 num. 1 g-i: el desglose (exonerado, exento, gravado 15 %, gravado 18 %, ISV 15 %, ISV 18 %)
 *   suma el total;
 * - Ley del ISV Art. 3: los descuentos reducen la base antes del ISV;
 * - Ley del ISV Art. 9: ISV = base × tasa, redondeado al centavo (≥ 0.005 sube); con ISV incluido el total nunca
 *   supera la suma de precios (cobrar de más «se considerará como hurto»);
 * - Reglamento Art. 12: lo gravado con alícuota cero no lleva ISV.
 *
 * Las propiedades de redondeo del ISV por grupo de tasa (no por línea) siguen la lectura documentada en
 * calculo.ts, pendiente de consulta al SAR; no la vuelven regla.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularCentavos,
  calcularDocumento,
  centavosEnLetras,
  escaladoATexto,
  impuestoArt9,
  MONTO_MAXIMO_CENTAVOS,
  validarLineas,
  type LineaEntrada,
  type TratamientoISV,
} from '../../src';
import { fc, TIEMPO } from './config';

const TRATAMIENTOS: TratamientoISV[] = ['ISV15', 'ISV18', 'GRAVADO0', 'EXENTO'];

/** Importe bruto en centavos según el comentario de calculo.ts: cantidad × precio, redondeado una vez (Art. 9). */
const brutoDe = (cant: bigint, precio: bigint) => (cant * precio * 2n + 1_000_000n) / 2_000_000n;

interface LineaGen {
  cant: bigint; // diezmilésimas
  precio: bigint; // diezmilésimas de lempira
  descuento: bigint; // centavos
  isv: TratamientoISV;
  comoNumero: boolean;
}

/** Una línea válida: cantidad de 0.0001 a 1,000, precio de 0 a L 100,000, descuento de 0 al bruto. */
const linea: fc.Arbitrary<LineaGen> = fc
  .record({
    cant: fc.bigInt({ min: 1n, max: 10_000_000n }),
    precio: fc.bigInt({ min: 0n, max: 1_000_000_000n }),
    fraccionDescuento: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1000 })),
    isv: fc.constantFrom(...TRATAMIENTOS),
    comoNumero: fc.boolean(),
  })
  .map(({ cant, precio, fraccionDescuento, isv, comoNumero }) => ({
    cant, precio, isv, comoNumero,
    descuento: (brutoDe(cant, precio) * BigInt(fraccionDescuento)) / 1000n,
  }));

const lineas = fc.array(linea, { minLength: 1, maxLength: 25 });

function entrada(l: LineaGen, i: number): LineaEntrada {
  const v = (x: bigint, e: number) => (l.comoNumero ? Number(escaladoATexto(x, e)) : escaladoATexto(x, e));
  return {
    descripcion: `Producto ${i + 1}`,
    cantidad: v(l.cant, 4),
    precioUnitario: v(l.precio, 4),
    ...(l.descuento > 0n || i % 2 ? { descuento: v(l.descuento, 2) } : {}),
    isv: l.isv,
  };
}
const aEntradas = (ls: LineaGen[]) => ls.map(entrada);

/** Suma de importes (bruto − descuento) por tratamiento, en centavos. */
function grupos(ls: LineaGen[]): Record<TratamientoISV, bigint> {
  const g: Record<TratamientoISV, bigint> = { ISV15: 0n, ISV18: 0n, GRAVADO0: 0n, EXENTO: 0n };
  for (const l of ls) g[l.isv] += brutoDe(l.cant, l.precio) - l.descuento;
  return g;
}

const opciones = fc.record({ preciosIncluyenISV: fc.boolean(), exonerado: fc.boolean() });
const cent = (n: number) => BigInt(Math.round(n * 100));

describe('cálculo: el total es la suma de sus partes (Art. 11 num. 1 g-i)', () => {
  it('subtotal = exonerado + exento + gravado 0 + gravado 15 + gravado 18, y total = subtotal + ISV 15 + ISV 18', () => {
    fc.assert(
      fc.property(lineas, opciones, (ls, o) => {
        const t = calcularCentavos(aEntradas(ls), o).totales;
        expect(t.subtotal).toBe(t.importeExonerado + t.importeExento + t.importeGravado0 + t.importeGravado15 + t.importeGravado18);
        expect(t.total).toBe(t.subtotal + t.isv15 + t.isv18);
        expect(t.baseCreditoFiscal).toBe(t.importeGravado15 + t.importeGravado18);
      }),
    );
  }, TIEMPO);

  it('precios sin ISV: no se pierde un centavo, la suma de los importes de las líneas es el subtotal', () => {
    fc.assert(
      fc.property(lineas, fc.boolean(), (ls, exonerado) => {
        const r = calcularCentavos(aEntradas(ls), { exonerado });
        const suma = r.lineas.reduce((s, l) => s + l.importe, 0n);
        expect(r.totales.subtotal).toBe(suma);
        expect(r.totales.ajustePorRedondeo).toBe(0n);
        const g = grupos(ls);
        expect(r.totales.importeExento).toBe(g.EXENTO);
        expect(r.totales.importeGravado0).toBe(g.GRAVADO0);
        if (exonerado) expect(r.totales.importeExonerado).toBe(g.ISV15 + g.ISV18);
        else {
          expect(r.totales.importeGravado15).toBe(g.ISV15);
          expect(r.totales.importeGravado18).toBe(g.ISV18);
        }
      }),
    );
  }, TIEMPO);

  it('precios con ISV incluido: total + ajuste = suma de los importes, y el ajuste es de 0 a 1 centavo por tasa', () => {
    fc.assert(
      fc.property(lineas, (ls) => {
        const r = calcularCentavos(aEntradas(ls), { preciosIncluyenISV: true });
        const suma = r.lineas.reduce((s, l) => s + l.importe, 0n);
        const t = r.totales;
        expect(t.total + t.ajustePorRedondeo).toBe(suma);
        const g = grupos(ls);
        const maximo = (g.ISV15 > 0n ? 1n : 0n) + (g.ISV18 > 0n ? 1n : 0n);
        expect(t.ajustePorRedondeo >= 0n && t.ajustePorRedondeo <= maximo).toBe(true);
      }),
    );
  }, TIEMPO);

  it('Ley del ISV Art. 9: con ISV incluido el total nunca supera lo que suman los precios (no se cobra de más)', () => {
    fc.assert(
      fc.property(lineas, fc.boolean(), (ls, exonerado) => {
        const t = calcularCentavos(aEntradas(ls), { preciosIncluyenISV: true, exonerado }).totales;
        const g = grupos(ls);
        expect(t.total <= g.ISV15 + g.ISV18 + g.EXENTO + g.GRAVADO0).toBe(true);
      }),
    );
  }, TIEMPO);
});

describe('cálculo: ISV (Ley del ISV Art. 9; Reglamento Art. 12)', () => {
  it('el ISV impreso es la tasa × la base impresa, redondeada al centavo con la regla del Art. 9', () => {
    fc.assert(
      fc.property(lineas, opciones, (ls, o) => {
        const t = calcularCentavos(aEntradas(ls), o).totales;
        // ISV × 100 − base × tasa ∈ (−50, 50]: nunca más de medio centavo; la mitad exacta sube.
        for (const [base, isv, tasa] of [[t.importeGravado15, t.isv15, 15n], [t.importeGravado18, t.isv18, 18n]] as const) {
          const diferencia = isv * 100n - base * tasa;
          expect(diferencia > -50n && diferencia <= 50n).toBe(true);
          expect(isv).toBe(impuestoArt9(base, Number(tasa)));
        }
      }),
    );
  }, TIEMPO);

  it('exento, gravado con alícuota cero (Art. 12) y exonerado no llevan ISV', () => {
    fc.assert(
      fc.property(lineas, opciones, (ls, o) => {
        const soloSinIsv = ls.map((l) => ({ ...l, isv: l.isv === 'ISV15' || l.isv === 'ISV18' ? ('EXENTO' as const) : l.isv }));
        const t = calcularCentavos(aEntradas(soloSinIsv), o).totales;
        expect(t.isv15 + t.isv18).toBe(0n);
        const conIsv = calcularCentavos(aEntradas(ls), { ...o, exonerado: true }).totales;
        expect(conIsv.isv15 + conIsv.isv18).toBe(0n);
        expect(conIsv.importeGravado15 + conIsv.importeGravado18).toBe(0n);
      }),
    );
  }, TIEMPO);

  it('el ISV se calcula sobre la suma de cada grupo: juntar dos documentos cambia el ISV en a lo sumo 1 centavo por tasa', () => {
    fc.assert(
      fc.property(lineas, lineas, (a, b) => {
        const ta = calcularCentavos(aEntradas(a)).totales;
        const tb = calcularCentavos(aEntradas(b)).totales;
        const tab = calcularCentavos(aEntradas([...a, ...b])).totales;
        expect(tab.subtotal).toBe(ta.subtotal + tb.subtotal);
        for (const k of ['isv15', 'isv18'] as const) {
          const d = tab[k] - ta[k] - tb[k];
          expect(d >= -1n && d <= 1n).toBe(true);
        }
      }),
    );
  }, TIEMPO);
});

describe('cálculo: descuentos (Ley del ISV Art. 3)', () => {
  it('los descuentos reducen la base: base del grupo = Σ brutos − Σ descuentos, y «descuentos» es su suma', () => {
    fc.assert(
      fc.property(lineas, (ls) => {
        const t = calcularCentavos(aEntradas(ls)).totales;
        expect(t.descuentos).toBe(ls.reduce((s, l) => s + l.descuento, 0n));
        const brutos = ls.reduce((s, l) => s + brutoDe(l.cant, l.precio), 0n);
        expect(t.subtotal).toBe(brutos - t.descuentos);
      }),
    );
  }, TIEMPO);

  it('un descuento mayor que el importe de la línea se rechaza con LINEA_DESCUENTO', () => {
    fc.assert(
      fc.property(linea, fc.bigInt({ min: 1n, max: 10_000n }), (l, exceso) => {
        const bruto = brutoDe(l.cant, l.precio);
        const p = validarLineas([entrada({ ...l, descuento: bruto + exceso }, 0)]);
        expect(p.map((x) => x.codigo)).toContain('LINEA_DESCUENTO');
      }),
    );
  }, TIEMPO);
});

describe('cálculo: el resultado no depende del orden de las líneas', () => {
  it('cualquier permutación de las líneas da los mismos totales', () => {
    fc.assert(
      fc.property(
        lineas.chain((ls) => fc.tuple(fc.constant(ls), fc.shuffledSubarray(ls, { minLength: ls.length, maxLength: ls.length }))),
        opciones,
        ([ls, permutadas], o) => {
          expect(calcularCentavos(aEntradas(permutadas), o).totales).toEqual(calcularCentavos(aEntradas(ls), o).totales);
        },
      ),
    );
  }, TIEMPO);

  it('texto o number para el mismo monto dan el mismo cálculo', () => {
    fc.assert(
      fc.property(lineas, opciones, (ls, o) => {
        const texto = calcularCentavos(aEntradas(ls.map((l) => ({ ...l, comoNumero: false }))), o).totales;
        const numero = calcularCentavos(aEntradas(ls.map((l) => ({ ...l, comoNumero: true }))), o).totales;
        expect(numero).toEqual(texto);
      }),
    );
  }, TIEMPO);
});

describe('cálculo: la salida en lempiras es exacta', () => {
  it('calcularDocumento expone los mismos centavos que calcularCentavos y el total en letras (Art. 11 num. 1 k)', () => {
    fc.assert(
      fc.property(lineas, opciones, (ls, o) => {
        const e = aEntradas(ls);
        const c = calcularCentavos(e, o);
        const d = calcularDocumento(e, o);
        for (const k of ['descuentos', 'subtotal', 'importeExonerado', 'importeExento', 'importeGravado0', 'importeGravado15', 'importeGravado18', 'isv15', 'isv18', 'total', 'ajustePorRedondeo'] as const) {
          expect(cent(d.totales[k]), k).toBe(c.totales[k]);
        }
        expect(d.totales.totalEnLetras).toBe(centavosEnLetras(c.totales.total));
        d.lineas.forEach((l, i) => expect(cent(l.importe)).toBe(c.lineas[i]!.importe));
        expect(d.advertencias.length > 0).toBe(c.totales.ajustePorRedondeo > 0n);
      }),
    );
  }, TIEMPO);

  it('un total por encima de MONTO_MAXIMO_CENTAVOS se rechaza con MONTO_FUERA_DE_RANGO, nunca con un RangeError', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 10n ** 13n, max: 10n ** 20n }), fc.constantFrom(...TRATAMIENTOS), (lempiras, isv) => {
        const l: LineaEntrada = { descripcion: 'x', cantidad: '1', precioUnitario: lempiras.toString(), isv };
        const problemas = validarLineas([l]);
        const cabe = (lempiras * 100n * 118n) / 100n + 1n <= MONTO_MAXIMO_CENTAVOS;
        expect(problemas.map((p) => p.codigo)).toEqual(cabe ? [] : ['MONTO_FUERA_DE_RANGO']);
        if (cabe) {
          const d = calcularDocumento([l]);
          expect(cent(d.totales.total) <= MONTO_MAXIMO_CENTAVOS).toBe(true);
        }
      }),
    );
  }, TIEMPO);
});
