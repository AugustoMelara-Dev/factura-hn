/**
 * Ley del ISV Art. 9 (ISV L.252-260): fracción < 0.005 baja, ≥ 0.005 puede subir; cobrar fuera de la
 * regla «se considerará como hurto». Para precios con ISV incluido, factura-hn
 * aplica su lectura del mismo artículo: el total puede quedar un centavo abajo del precio, nunca arriba.
 */
import { describe, expect, it } from 'vitest';
import {
  baseDesdePrecioConISV,
  calcularDocumento,
  impuestoArt9,
  renderizarHTML,
  sugerirPrecioSinAjuste,
  validarEntrada,
  type AutorizacionCAI,
} from '../src';
import { construirDocumento } from '../src/documento';

describe('regla del Art. 9', () => {
  it('fracción menor de 0.005 baja, igual o mayor sube', () => {
    expect(impuestoArt9(3n, 15)).toBe(0n); // 0.0045 → 0.00
    expect(impuestoArt9(10n, 15)).toBe(2n); // 0.015 → 0.02
    expect(impuestoArt9(23n, 15)).toBe(3n); // 0.0345 → 0.03
    expect(impuestoArt9(30n, 15)).toBe(5n); // 0.045 → 0.05
    expect(impuestoArt9(1250n, 18)).toBe(225n); // 2.25 exacto
  });

  it('precios sin ISV: ISV = tasa × base impresa', () => {
    const { totales } = calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: '0.23' }]);
    expect(totales.isv15).toBe(0.03);
    expect(totales.ajustePorRedondeo).toBe(0);
  });
});

describe('precios con ISV incluido (Ley del ISV, Art. 9)', () => {
  it('0.27 al 15 %: no existe base exacta → total 0.26, 1 centavo menos, con aviso', () => {
    const r = calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: '0.27' }], { preciosIncluyenISV: true });
    expect(r.totales).toMatchObject({ importeGravado15: 0.23, isv15: 0.03, total: 0.26, ajustePorRedondeo: 0.01 });
    expect(r.advertencias.map((a) => a.codigo)).toEqual(['AVISO_AJUSTE_CENTAVO']);
  });

  it('cuando hay base exacta, el total es el precio y no hay aviso', () => {
    const r = calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: '72.47' }], { preciosIncluyenISV: true });
    expect(r.totales).toMatchObject({ total: 72.47, ajustePorRedondeo: 0 });
    expect(r.advertencias).toEqual([]);
  });

  for (const [isv, tasa] of [['ISV15', 15], ['ISV18', 18]] as const) {
    it(`${isv}: de 0.01 a 1,000.00 el total nunca supera el precio, el ajuste es ≤ 1 centavo y el ISV es tasa × base`, () => {
      let conAjuste = 0;
      for (let c = 1; c <= 100_000; c++) {
        const precio = `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;
        const { totales } = calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: precio, isv }], { preciosIncluyenISV: true });
        const totalC = BigInt(precio.replace('.', ''));
        const base = isv === 'ISV15' ? totales.importeGravado15 : totales.importeGravado18;
        const impuesto = isv === 'ISV15' ? totales.isv15 : totales.isv18;
        const baseC = BigInt(Math.round(base * 100));
        expect(totales.total <= Number(precio)).toBe(true);
        expect(BigInt(Math.round(impuesto * 100))).toBe(impuestoArt9(baseC, tasa));
        const aj = Math.round(totales.ajustePorRedondeo * 100);
        expect(aj === 0 || aj === 1).toBe(true);
        expect(Math.round(totales.total * 100) + aj).toBe(Number(totalC));
        if (aj) conAjuste++;
      }
      // Proporción esperada de montos sin base exacta (Ley del ISV, Art. 9: el ISV impreso es la tasa por la base impresa).
      expect(conAjuste).toBe(isv === 'ISV15' ? 13_044 : 15_254);
    }, 120_000);
  }

  it('la base elegida es la mayor posible', () => {
    for (let t = 1n; t <= 5000n; t++) {
      const { base } = baseDesdePrecioConISV(t, 15);
      const siguiente = base + 1n;
      expect(siguiente + impuestoArt9(siguiente, 15) > t).toBe(true);
    }
  });

  it('dos tasas en el mismo documento: hasta 1 centavo por tasa', () => {
    const r = calcularDocumento(
      [
        { descripcion: 'a', cantidad: 1, precioUnitario: '0.27' },
        { descripcion: 'b', cantidad: 1, precioUnitario: '0.27', isv: 'ISV18' },
      ],
      { preciosIncluyenISV: true },
    );
    expect(r.totales.total + r.totales.ajustePorRedondeo).toBeCloseTo(0.54, 10);
    expect(r.totales.ajustePorRedondeo).toBeLessThanOrEqual(0.02);
  });

  it('el ajuste llega al documento, a sus avisos y al render', () => {
    const aut: AutorizacionCAI = {
      cai: 'X1', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-06-30',
    };
    const entrada = {
      fechaEmision: '2026-11-18',
      emisor: { rtn: '99990000000001', razonSocial: 'E', nombreComercial: 'E', direccionCasaMatriz: 'D', direccionEstablecimiento: 'D', telefono: '1', correo: 'a@ejemplo.example' },
      preciosIncluyenISV: true,
      lineas: [{ descripcion: 'Chicle', cantidad: 1, precioUnitario: '0.27' }],
    };
    expect(validarEntrada(entrada, aut).advertencias.map((a) => a.codigo)).toContain('AVISO_AJUSTE_CENTAVO');
    const doc = construirDocumento(entrada, aut, 1);
    expect(doc.totales.total).toBe(0.26);
    expect(doc.advertencias.map((a) => a.codigo)).toContain('AVISO_AJUSTE_CENTAVO');
    expect(renderizarHTML(doc)).toContain('Ajuste por redondeo del ISV');
  });
});

describe('sugerirPrecioSinAjuste', () => {
  it('propone el precio anterior y el siguiente que no requieren ajuste', () => {
    expect(sugerirPrecioSinAjuste('0.27')).toEqual({ requiereAjuste: true, anterior: 0.26, siguiente: 0.28 });
    expect(sugerirPrecioSinAjuste('72.47')).toEqual({ requiereAjuste: false, anterior: 72.47, siguiente: 72.47 });
  });

  it('las sugerencias realmente no requieren ajuste (15 % y 18 %, con cantidad)', () => {
    for (const isv of ['ISV15', 'ISV18'] as const) {
      for (let c = 1; c <= 3000; c += 7) {
        const p = (c / 100).toFixed(2);
        for (const cantidad of [1, 3]) {
          const s = sugerirPrecioSinAjuste(p, { isv, cantidad });
          for (const sugerido of [s.anterior, s.siguiente]) {
            if (sugerido === 0) continue;
            const r = calcularDocumento([{ descripcion: 'x', cantidad, precioUnitario: sugerido, isv }], { preciosIncluyenISV: true });
            expect(r.totales.ajustePorRedondeo).toBe(0);
          }
        }
      }
    }
  });
});
