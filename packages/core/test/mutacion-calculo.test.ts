// Pruebas que matan mutantes de calculo.ts (pnpm mutacion).
// Validación de cada campo de la línea con su mensaje, exonerado con las dos tasas, la línea calculada que se
// devuelve y los bordes de baseDesdePrecioConISV y sugerirPrecioSinAjuste (Ley del ISV Art. 9).
import { describe, expect, it } from 'vitest';
import {
  advertenciasDeCalculo,
  baseDesdePrecioConISV,
  calcularCentavos,
  calcularDocumento,
  ErrorCalculo,
  sugerirPrecioSinAjuste,
  TASAS_ISV,
  validarLineas,
} from '../src/calculo';
import type { LineaEntrada } from '../src/tipos';

const linea = (extra: Partial<LineaEntrada> = {}): LineaEntrada => ({ descripcion: 'Arroz', cantidad: 1, precioUnitario: 100, ...extra });

describe('validarLineas: un problema por campo, con su línea y su mensaje', () => {
  it('sin líneas', () => {
    const sin = [{ codigo: 'SIN_LINEAS', mensaje: 'El documento debe tener al menos una línea.', campo: 'lineas' }];
    expect(validarLineas([])).toEqual(sin);
    expect(validarLineas(null as never)).toEqual(sin);
  });
  it('descripción vacía o solo espacios, en la línea que corresponde', () => {
    expect(validarLineas([linea(), linea({ descripcion: '   ' })])).toEqual([
      { codigo: 'LINEA_DESCRIPCION', mensaje: 'Línea 2: falta la descripción.', campo: 'lineas[1]' },
    ]);
    expect(validarLineas([linea({ descripcion: undefined as never })])).toEqual([
      { codigo: 'LINEA_DESCRIPCION', mensaje: 'Línea 1: falta la descripción.', campo: 'lineas[0]' },
    ]);
  });
  it('tratamiento ISV desconocido', () => {
    expect(validarLineas([linea(), linea({ isv: 'ISV16' as never })])).toEqual([
      { codigo: 'LINEA_ISV', mensaje: 'Línea 2: tratamiento ISV inválido "ISV16".', campo: 'lineas[1]' },
    ]);
    for (const isv of ['ISV15', 'ISV18', 'GRAVADO0', 'EXENTO'] as const) expect(validarLineas([linea({ isv })])).toEqual([]);
  });
  it('cantidad: mayor que 0, legible y con hasta 4 decimales', () => {
    const problema = (mensaje: string) => [{ codigo: 'LINEA_CANTIDAD', mensaje, campo: 'lineas[0]' }];
    expect(validarLineas([linea({ cantidad: 0 })])).toEqual(problema('Línea 1: la cantidad debe ser mayor que 0.'));
    expect(validarLineas([linea({ cantidad: '-1' })])).toEqual(problema('Línea 1: la cantidad debe ser mayor que 0.'));
    expect(validarLineas([linea({ cantidad: 'dos' })])).toEqual(problema('Línea 1: Monto inválido: "dos"'));
    expect(validarLineas([linea({ cantidad: '1.00001' })])).toEqual(problema('Línea 1: La cantidad admite como máximo 4 decimales: "1.00001"'));
    expect(validarLineas([linea({ cantidad: '0.0001' })])).toEqual([]);
  });
  it('un objeto que no se puede convertir a texto es un problema de la línea, no un TypeError', () => {
    const problema = [{ codigo: 'LINEA_CANTIDAD', mensaje: 'Línea 1: Monto inválido: objeto', campo: 'lineas[0]' }];
    expect(validarLineas([linea({ cantidad: Object.create(null) })])).toEqual(problema);
    const toStringQueLanza = { toString: () => { throw new Error('no'); } };
    expect(validarLineas([linea({ cantidad: toStringQueLanza as never })])).toEqual(problema);
  });
  it('precio: no negativo (0 se acepta), legible y con hasta 4 decimales', () => {
    const problema = (mensaje: string) => [{ codigo: 'LINEA_PRECIO', mensaje, campo: 'lineas[0]' }];
    expect(validarLineas([linea({ precioUnitario: '-0.01' })])).toEqual(problema('Línea 1: el precio unitario no puede ser negativo.'));
    expect(validarLineas([linea({ precioUnitario: 'x' })])).toEqual(problema('Línea 1: Monto inválido: "x"'));
    expect(validarLineas([linea({ precioUnitario: '1.00001' })])).toEqual(
      problema('Línea 1: El precio unitario admite como máximo 4 decimales: "1.00001"'),
    );
    expect(validarLineas([linea({ precioUnitario: 0 })])).toEqual([]);
  });
  it('descuento: no negativo, con hasta 2 decimales y no mayor que el importe (igual sí)', () => {
    const problema = (mensaje: string) => [{ codigo: 'LINEA_DESCUENTO', mensaje, campo: 'lineas[0]' }];
    expect(validarLineas([linea({ descuento: '-1' })])).toEqual(problema('Línea 1: el descuento no puede ser negativo.'));
    expect(validarLineas([linea({ descuento: '1.001' })])).toEqual(problema('Línea 1: El descuento admite como máximo 2 decimales: "1.001"'));
    expect(validarLineas([linea({ descuento: 'x' })])).toEqual(problema('Línea 1: Monto inválido: "x"'));
    expect(validarLineas([linea({ descuento: '100.01' })])).toEqual(problema('Línea 1: el descuento supera el importe de la línea.'));
    expect(validarLineas([linea({ descuento: '100' })])).toEqual([]);
  });
  it('reporta los tres campos de una misma línea a la vez, sin lanzar', () => {
    expect(validarLineas([linea({ cantidad: 0, precioUnitario: -1, descuento: -1 })]).map((p) => p.codigo)).toEqual([
      'LINEA_CANTIDAD',
      'LINEA_PRECIO',
      'LINEA_DESCUENTO',
    ]);
  });
});

describe('ErrorCalculo', () => {
  it('junta los mensajes y conserva los problemas', () => {
    let error: unknown;
    try {
      calcularDocumento([linea({ cantidad: 0 }), linea({ descripcion: '' })]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorCalculo);
    const e = error as ErrorCalculo;
    expect(e.name).toBe('ErrorCalculo');
    expect(e.message).toBe('Línea 1: la cantidad debe ser mayor que 0. Línea 2: falta la descripción.');
    expect(e.problemas.map((p) => p.codigo)).toEqual(['LINEA_CANTIDAD', 'LINEA_DESCRIPCION']);
  });
});

describe('totales', () => {
  it('exonerado: la base de las dos tasas pasa a importe exonerado, sin ISV', () => {
    const { totales } = calcularCentavos([linea({ precioUnitario: 100 }), linea({ precioUnitario: 50, isv: 'ISV18' })], { exonerado: true });
    expect(totales.importeExonerado).toBe(15000n);
    expect(totales.importeGravado15).toBe(0n);
    expect(totales.importeGravado18).toBe(0n);
    expect(totales.isv15 + totales.isv18).toBe(0n);
    expect(totales.total).toBe(15000n);
  });
  it('exonerado con precios con ISV incluido: se quita el ISV de cada tasa', () => {
    const { totales } = calcularCentavos([linea({ precioUnitario: 115 }), linea({ precioUnitario: 118, isv: 'ISV18' })], {
      exonerado: true,
      preciosIncluyenISV: true,
    });
    expect(totales.importeExonerado).toBe(20000n);
    expect(totales.ajustePorRedondeo).toBe(0n);
  });
  it('tasas del ISV', () => {
    expect(TASAS_ISV).toEqual({ ISV15: 15, ISV18: 18 });
  });
});

describe('la línea calculada', () => {
  it('recorta la descripción y copia código y unidad solo si vienen', () => {
    const sin = calcularDocumento([linea({ descripcion: '  Arroz 5 lb  ' })]).lineas[0]!;
    expect(sin.descripcion).toBe('Arroz 5 lb');
    expect('codigo' in sin).toBe(false);
    expect('unidad' in sin).toBe(false);
    const con = calcularDocumento([linea({ codigo: 'A-1', unidad: 'lb' })]).lineas[0]!;
    expect(con.codigo).toBe('A-1');
    expect(con.unidad).toBe('lb');
  });
});

describe('aviso de ajuste por redondeo (Ley del ISV Art. 9)', () => {
  it('trae código, mensaje y campo; sin ajuste no hay aviso', () => {
    const r = calcularDocumento([linea({ precioUnitario: '0.27' })], { preciosIncluyenISV: true });
    expect(r.totales.ajustePorRedondeo).toBe(0.01);
    expect(r.advertencias).toEqual([
      {
        codigo: 'AVISO_AJUSTE_CENTAVO',
        mensaje:
          'El total se redujo L 0.01 para que el ISV impreso sea exactamente la tasa × la base (Ley del ISV Art. 9). Cobra el total del documento, no la suma de precios.',
        campo: 'lineas',
      },
    ]);
    expect(calcularDocumento([linea({ precioUnitario: '1.15' })], { preciosIncluyenISV: true }).advertencias).toEqual([]);
    expect(advertenciasDeCalculo(calcularCentavos([linea()]).totales)).toEqual([]);
  });
});

describe('baseDesdePrecioConISV', () => {
  it('un total 0 o negativo da base, ISV y ajuste 0', () => {
    expect(baseDesdePrecioConISV(0n, 15)).toEqual({ base: 0n, isv: 0n, ajuste: 0n });
    expect(baseDesdePrecioConISV(-100n, 15)).toEqual({ base: 0n, isv: 0n, ajuste: 0n });
  });
  it('un total exacto se respeta y uno sin base exacta queda 1 centavo abajo', () => {
    expect(baseDesdePrecioConISV(115n, 15)).toEqual({ base: 100n, isv: 15n, ajuste: 0n });
    expect(baseDesdePrecioConISV(27n, 15)).toEqual({ base: 23n, isv: 3n, ajuste: 1n });
    expect(baseDesdePrecioConISV(1n, 18)).toEqual({ base: 1n, isv: 0n, ajuste: 0n });
  });
});

describe('sugerirPrecioSinAjuste', () => {
  it('el precio 0 no requiere ajuste', () => {
    expect(sugerirPrecioSinAjuste('0')).toEqual({ requiereAjuste: false, anterior: 0, siguiente: 0 });
  });
  it('un precio negativo nunca es exacto: el siguiente exacto es 0', () => {
    const r = sugerirPrecioSinAjuste('-0.05');
    expect(r.requiereAjuste).toBe(true);
    expect(r.siguiente).toBe(0);
  });
  it('sugiere el anterior y el siguiente exactos, también al 18 % y con cantidad', () => {
    expect(sugerirPrecioSinAjuste('0.27')).toEqual({ requiereAjuste: true, anterior: 0.26, siguiente: 0.28 });
    expect(sugerirPrecioSinAjuste('1.15')).toEqual({ requiereAjuste: false, anterior: 1.15, siguiente: 1.15 });
    const r18 = sugerirPrecioSinAjuste('0.27', { isv: 'ISV18' });
    expect(baseDesdePrecioConISV(BigInt(Math.round(r18.siguiente * 100)), 18).ajuste).toBe(0n);
    const r2 = sugerirPrecioSinAjuste('0.27', { cantidad: 3 });
    expect(baseDesdePrecioConISV(BigInt(Math.round(r2.siguiente * 300)), 15).ajuste).toBe(0n);
  });
  it('mensajes de entrada inválida', () => {
    expect(() => sugerirPrecioSinAjuste('1.001')).toThrow('El precio admite como máximo 2 decimales: "1.001"');
    expect(() => sugerirPrecioSinAjuste('1', { cantidad: '1.00001' })).toThrow('La cantidad admite como máximo 4 decimales: "1.00001"');
  });
});

describe('validarLineas: tope técnico del total (MONTO_FUERA_DE_RANGO) por grupo de tasa', () => {
  // 869,565,217,391,300 centavos al 15 %: total 999,999,999,999,995, justo bajo el máximo (10^15 − 1).
  const CERCA_15 = '8695652173913.00';
  // 862,068,965,517,241 centavos: cabe al 15 % (991,379,310,344,827) y no al 18 % (1,017,241,379,310,344).
  const CABE_15_NO_18 = '8620689655172.41';
  const codigos = (lineas: LineaEntrada[]) => validarLineas(lineas).map((p) => p.codigo);

  it('mensaje y campo exactos', () => {
    expect(validarLineas([{ descripcion: 'x', cantidad: '1', precioUnitario: '8695652173914.00' }])).toEqual([
      {
        codigo: 'MONTO_FUERA_DE_RANGO',
        mensaje: 'El total de las líneas con su ISV sería L 10000000000001.10: supera el máximo que se puede emitir, L 9999999999999.99.',
        campo: 'lineas',
      },
    ]);
  });

  it('sin tasa o con ISV15 cuenta al 15 %, no al 18 %; con ISV18, al 18 %', () => {
    expect(codigos([{ descripcion: 'x', cantidad: '1', precioUnitario: CABE_15_NO_18 }])).toEqual([]);
    expect(codigos([{ descripcion: 'x', cantidad: '1', precioUnitario: CABE_15_NO_18, isv: 'ISV15' }])).toEqual([]);
    expect(codigos([{ descripcion: 'x', cantidad: '1', precioUnitario: CABE_15_NO_18, isv: 'ISV18' }])).toEqual(['MONTO_FUERA_DE_RANGO']);
  });

  it('el descuento resta del importe antes del tope', () => {
    expect(codigos([{ descripcion: 'x', cantidad: '1', precioUnitario: CERCA_15, descuento: '1.00' }])).toEqual([]);
    expect(codigos([{ descripcion: 'x', cantidad: '1', precioUnitario: '8695652173914.00', descuento: '1.00' }])).toEqual([]);
  });

  it('con una línea ilegible no se mide el tope (ya hay un error de esa línea)', () => {
    const lineas: LineaEntrada[] = [
      { descripcion: 'x', cantidad: '1', precioUnitario: '9999999999999.00' },
      { descripcion: 'y', cantidad: '1', precioUnitario: 'abc' },
    ];
    expect(codigos(lineas)).toEqual(['LINEA_PRECIO']);
  });
});
