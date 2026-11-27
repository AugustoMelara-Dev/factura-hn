/**
 * Notas vigentes y tope de la nota de crédito:
 * - Arts. 41 y 4 num. 32: un original con notas vigentes no se anula (`DOCUMENTO_CON_NOTAS`).
 * - Art. 4 num. 32: tope de la nota de crédito por tasa; original en USD por el mismo camino que la nota;
 *   `AVISO_NOTA_EXONERACION_DISTINTA`.
 * - Menores: `ANULACION_MOTIVO`, `estadoAutorizacion` con una serie que viene de otro CAI, `caiEstricto` en la demo,
 *   leyenda G0 en el HTML, columnas nuevas de la exportación.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  corregirFechaAdelantada,
  emitir,
  ErrorValidacion,
  estadoAutorizacion,
  exportarTexto,
  libroVentas,
  libroVentasCSV,
  registrarAutorizacion,
  renderizarHTML,
  VERSION_EXPORTACION,
  type DocumentoEntrada,
  type DocumentoFiscal,
} from '../src';
import { anularDocumento } from '../src/anulacion';
import { crearFacturadorDemo } from '../src/demo';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Ferretería Ejemplo', nombreComercial: 'Ferretería Ejemplo',
  direccionCasaMatriz: 'Tegucigalpa', direccionEstablecimiento: 'Tegucigalpa', telefono: '0000-0003', correo: 'f@ejemplo.example',
};
const CLIENTE = { nombre: 'Constructora Norte', rtn: '99990000000002' };
const caja = { establecimiento: '000', puntoEmision: '001' };

let almacen: AlmacenFiscalMemoria;
beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  for (const tt of ['01', '06', '07'] as const) {
    await registrarAutorizacion(almacen, {
      cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${tt}`, tipoDocumento: tt, establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2099-12-31',
    });
  }
});

const factura = (extra: Partial<DocumentoEntrada> = {}) =>
  emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }], ...extra }, { almacen, ...caja });
const nota = (original: DocumentoFiscal, lineas: DocumentoEntrada['lineas'], extra: Partial<DocumentoEntrada> = {}) =>
  emitir({
    tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución',
    referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision }, lineas, ...extra,
  }, { almacen, ...caja });
const errorDe = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => {
      if (!(e instanceof ErrorValidacion)) throw e;
      return e.errores;
    },
  );

describe('DOCUMENTO_CON_NOTAS: un original con notas vigentes no se anula (Arts. 41 y 4 num. 32)', () => {
  it('con una nota de crédito total vigente se rechaza, con la solución y sin tocar el libro; anulada la nota, se anula', async () => {
    const f = await factura(); // L 100 + ISV 15
    const nc = await nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }]);
    const errores = await errorDe(anular(f.numero, { almacen, motivo: 'Error de digitación' }));
    expect(errores).toEqual([
      {
        codigo: 'DOCUMENTO_CON_NOTAS',
        mensaje: `El documento ${f.numero} tiene 1 nota(s) de crédito o débito vigente(s) (${nc.numero}): anula primero las notas (Arts. 41 y 4 num. 32).`,
        campo: 'numero',
        solucion: expect.stringContaining('Anula primero las notas'),
        documentacion: expect.stringContaining('#documento_con_notas'),
      },
    ]);
    // Nada cambió: el libro sigue en cero (venta 115, nota −115), nunca en −115.
    const docs = await almacen.transaccion((tx) => tx.documentos());
    expect(docs.map((d) => d.estado)).toEqual(['EMITIDO', 'EMITIDO']);
    expect(libroVentas(docs).resumen.total).toBe(0);
    expect((await almacen.transaccion((tx) => tx.eventos({ tipo: 'DOCUMENTO_ANULADO' }))).length).toBe(0);
    await anular(nc.numero, { almacen, motivo: 'Nota con error' });
    expect((await anular(f.numero, { almacen, motivo: 'Error de digitación' })).estado).toBe('ANULADO');
  });

  it('una nota de débito vigente también lo impide; una nota se anula aunque tenga original', async () => {
    const f = await factura();
    const nd = await emitir({
      tipoDocumento: '07', emisor: EMISOR, cliente: CLIENTE, motivo: 'Intereses',
      referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision }, lineas: [{ descripcion: 'Intereses', cantidad: 1, precioUnitario: '5.00' }],
    }, { almacen, ...caja });
    expect((await errorDe(anular(f.numero, { almacen, motivo: 'Error' })))!.map((p) => p.codigo)).toEqual(['DOCUMENTO_CON_NOTAS']);
    expect((await anular(nd.numero, { almacen, motivo: 'Error' })).estado).toBe('ANULADO');
    expect((await anular(f.numero, { almacen, motivo: 'Error' })).estado).toBe('ANULADO');
  });

  it('las notas de otro documento no cuentan, y YA_ANULADO se reporta antes', async () => {
    const f = await factura();
    const g = await factura();
    await nota(g, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '10.00' }]);
    expect((await anular(f.numero, { almacen, motivo: 'Error' })).estado).toBe('ANULADO');
    expect((await errorDe(anular(f.numero, { almacen, motivo: 'Otra vez' })))!.map((p) => p.codigo)).toEqual(['YA_ANULADO']);
  });
});

describe('Art. 4 num. 32: tope de la nota de crédito por tasa', () => {
  const MIXTA = [
    { descripcion: 'Arroz', cantidad: 1, precioUnitario: '100.00', isv: 'EXENTO' as const },
    { descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' },
  ];

  it('L 180 al 15 % sobre L 100 exento + L 100 al 15 % no cabe al 15 %, aunque cabe en el total', async () => {
    const f = await factura({ lineas: MIXTA }); // total L 215.00
    const errores = await errorDe(nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '180.00' }])); // L 207.00
    expect(errores!.map((p) => p.codigo)).toEqual(['NOTA_SUPERA_ORIGINAL']);
    expect(errores![0]!.mensaje).toBe(
      `Al 15 %, la nota (gravado L 180.00, ISV L 27.00) supera el saldo del documento ${f.numero} a esa tasa: gravado L 100.00 e ` +
        'ISV L 15.00 en el original; saldo disponible: gravado L 100.00 e ISV L 15.00 (Art. 4 num. 32). Usa en cada línea la misma tasa que en el original.',
    );
  });

  it('el tope por tasa suma las notas previas; lo exento queda para otra nota', async () => {
    const f = await factura({ lineas: MIXTA });
    await nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '60.00' }]);
    const errores = await errorDe(nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '40.01' }]));
    expect(errores![0]!.mensaje).toContain('saldo disponible: gravado L 40.00 e ISV L 6.00');
    await nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '40.00' }]);
    expect((await nota(f, [MIXTA[0]!])).totales.total).toBe(100);
  });

  it('al 18 % también: el ISV de notas parciales no pasa del original por redondeo, aunque la base y el total quepan', async () => {
    const CERVEZA = { descripcion: 'Cerveza', cantidad: 1, precioUnitario: '0.03', isv: 'ISV18' as const }; // ISV 0.0054 → 0.01
    const f = await factura({ lineas: [{ ...CERVEZA, precioUnitario: '0.06' }, { descripcion: 'Arroz', cantidad: 1, precioUnitario: '1.00', isv: 'EXENTO' }] }); // ISV 0.0108 → 0.01
    await nota(f, [CERVEZA]);
    const errores = await errorDe(nota(f, [CERVEZA]));
    expect(errores![0]!.mensaje).toBe(
      `Al 18 %, la nota (gravado L 0.03, ISV L 0.01) supera el saldo del documento ${f.numero} a esa tasa: gravado L 0.06 e ` +
        'ISV L 0.01 en el original; saldo disponible: gravado L 0.03 e ISV L 0.00 (Art. 4 num. 32). Usa en cada línea la misma tasa que en el original.',
    );
  });
});

describe('Art. 4 num. 32: original en dólares con la misma conversión que la nota y el libro', () => {
  it('la devolución total de 7 × USD 0.07 a 24.5 acredita lo que el libro registró de la venta: L 13.73', async () => {
    const LINEA = [{ descripcion: 'Tornillo', cantidad: 7, precioUnitario: '0.07' }];
    const f = await factura({ moneda: 'USD', tipoCambio: '24.5', lineas: LINEA }); // USD 0.49 + ISV 0.07
    // 0.49 × 24.5 = 12.005 → 12.01 y 0.07 × 24.5 = 1.715 → 1.72: total 13.73, la suma de las columnas.
    expect(f.equivalenteLempiras).toEqual({ isv15: 1.72, total: 13.73 });
    const nc = await nota(f, LINEA);
    expect(nc.totales).toMatchObject({ importeGravado15: 12.01, isv15: 1.72, total: 13.73 });
    // Saldo agotado: otra nota, aunque sea mínima, ya no cabe.
    const errores = await errorDe(nota(f, [{ descripcion: 'Tornillo', cantidad: 1, precioUnitario: '0.01' }]));
    expect(errores![0]!.mensaje).toContain('total L 13.73, ya acreditado L 13.73 en 1 nota(s), saldo disponible L 0.00');
  });

  it('con precios con ISV incluido, descuento y exoneración, la nota idéntica agota el saldo', async () => {
    const LINEAS = [
      { descripcion: 'Taladro', cantidad: 3, precioUnitario: '12.3457', descuento: '1.11' },
      { descripcion: 'Broca', cantidad: 2, precioUnitario: '0.9999', isv: 'ISV18' as const },
      { descripcion: 'Semilla', cantidad: 1, precioUnitario: '3.33', isv: 'EXENTO' as const },
    ];
    for (const extra of [{ preciosIncluyenISV: true }, { exoneracion: { registroSAG: 'SAG-0001' } }]) {
      const f = await factura({ moneda: 'USD', tipoCambio: '24.6789', lineas: LINEAS, ...extra });
      const nc = await nota(f, LINEAS, extra);
      expect(nc.advertencias.filter((p) => !['AVISO_AJUSTE_CENTAVO', 'AVISO_VENTA_MIXTA'].includes(p.codigo))).toEqual([]);
      expect((await errorDe(nota(f, [{ descripcion: 'Semilla', cantidad: 1, precioUnitario: '0.01', isv: 'EXENTO' }], extra)))![0]!.codigo).toBe('NOTA_SUPERA_ORIGINAL');
    }
  });
});

describe('AVISO_NOTA_EXONERACION_DISTINTA', () => {
  it('original exonerado y nota sin exoneración: se emite con el aviso y su solución', async () => {
    const f = await factura({ exoneracion: { registroSAG: 'SAG-0001' } }); // L 100 exonerado
    const nc = await nota(f, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00', isv: 'EXENTO' }]);
    expect(nc.advertencias).toEqual([
      {
        codigo: 'AVISO_NOTA_EXONERACION_DISTINTA',
        mensaje: `El documento ${f.numero} es exonerado y la nota no: en el libro de ventas el crédito queda en otra columna que la venta.`,
        campo: 'exoneracion',
        solucion: 'Copia en la nota la `exoneracion` del documento original.',
      },
    ]);
  });

  it('nota exonerada sobre un original que no lo era: aviso; las dos exoneradas o ninguna: sin aviso', async () => {
    const f = await factura({ lineas: [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: '100.00', isv: 'EXENTO' }] });
    const nc = await nota(f, [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: '10.00', isv: 'EXENTO' }], { exoneracion: { registroSAG: 'SAG-0001' } });
    expect(nc.advertencias.map((p) => [p.codigo, p.mensaje, p.solucion])).toEqual([
      [
        'AVISO_NOTA_EXONERACION_DISTINTA',
        `La nota es exonerada y el documento ${f.numero} no lo era: en el libro de ventas el crédito queda en otra columna que la venta.`,
        'Quita `exoneracion` de la nota: el documento original no era exonerado.',
      ],
    ]);
    expect((await nota(f, [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: '10.00', isv: 'EXENTO' }])).advertencias).toEqual([]);
    const e = await factura({ exoneracion: { registroSAG: 'SAG-0001' } });
    expect((await nota(e, [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '10.00' }], { exoneracion: { registroSAG: 'SAG-0001' } })).advertencias).toEqual([]);
  });
});

describe('menores', () => {
  it('ANULACION_MOTIVO al anular sin motivo, y en corregirFechaAdelantada', async () => {
    const f = await factura();
    expect((await errorDe(anular(f.numero, { almacen, motivo: '   ' })))!).toEqual([
      expect.objectContaining({ codigo: 'ANULACION_MOTIVO', mensaje: 'La anulación requiere un motivo.', campo: 'motivo' }),
    ]);
    expect(() => anularDocumento(f, { motivo: '' })).toThrow(ErrorValidacion);
    const errores = await errorDe(corregirFechaAdelantada(almacen, { identificador: '000-001-01', motivo: ' ' }));
    expect(errores).toEqual([
      expect.objectContaining({
        codigo: 'ANULACION_MOTIVO',
        mensaje: 'La corrección requiere un motivo (por ejemplo, qué pasó con el reloj).',
        campo: 'motivo',
      }),
    ]);
  });

  it('estadoAutorizacion con el último número antes del rango (serie que viene de otro CAI)', () => {
    const aut = {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01' as const, establecimiento: '000', puntoEmision: '001',
      rangoInicial: 101, rangoFinal: 200, fechaLimiteEmision: '2099-12-31',
    };
    const e = estadoAutorizacion(aut, 50, { hoy: '2026-11-25' });
    expect([e.siguienteCorrelativo, e.correlativosRestantes, e.porcentajeUsado, e.vigente, e.alertas]).toEqual([101, 100, 0, true, []]);
    // Justo antes del rango, y ya dentro: sin cambios en lo que se calculaba bien.
    expect([estadoAutorizacion(aut, 100, { hoy: '2026-11-25' }).siguienteCorrelativo, estadoAutorizacion(aut, 100, { hoy: '2026-11-25' }).porcentajeUsado]).toEqual([101, 0]);
    expect([estadoAutorizacion(aut, 150, { hoy: '2026-11-25' }).correlativosRestantes, estadoAutorizacion(aut, 150, { hoy: '2026-11-25' }).porcentajeUsado]).toEqual([50, 50]);
  });

  it('crearFacturadorDemo({ caiEstricto: true }) emite con el CAI ficticio; un CAI real mal formado sigue siendo CAI_FORMATO', async () => {
    const demo = await crearFacturadorDemo({ caiEstricto: true });
    expect((await demo.emitir({ lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '10.00' }] })).modo).toBe('prueba');
    const otro = new AlmacenFiscalMemoria();
    await registrarAutorizacion(otro, {
      cai: 'ABC-123', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2099-12-31',
    });
    const errores = await errorDe(emitir({ emisor: EMISOR, lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '10.00' }] }, {
      almacen: otro, ...caja, opciones: { caiEstricto: true },
    }));
    expect(errores!.map((p) => p.codigo)).toContain('CAI_FORMATO');
  });

  it('el HTML explica G0 solo si hay líneas gravadas al 0 %', async () => {
    const con = await factura({ lineas: [{ descripcion: 'Café de exportación', cantidad: 1, precioUnitario: '100.00', isv: 'GRAVADO0' }] });
    expect(renderizarHTML(con)).toContain('<div class="desc">G = gravado 15%, G18 = gravado 18%, G0 = gravado 0%, E = exento.</div>');
    const incluye = await factura({ preciosIncluyenISV: true, lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '100.00', isv: 'GRAVADO0' }] });
    expect(renderizarHTML(incluye)).toContain('<div class="desc">Precios incluyen ISV. G = gravado 15%, G18 = gravado 18%, G0 = gravado 0%, E = exento.</div>');
    const sin = await factura();
    expect(renderizarHTML(sin)).toContain('<div class="desc">G = gravado 15%, G18 = gravado 18%, E = exento.</div>');
  });

  it('exportación v2: tipoCambio y fechaAnulacion al final, sin mover las columnas de la v1', async () => {
    const usd = await factura({ moneda: 'USD', tipoCambio: '24.5' });
    const hnl = await factura();
    await anular(hnl.numero, { almacen, motivo: 'Error', reloj: () => new Date('2026-11-25T12:00:00-06:00') });
    const docs = await almacen.transaccion((tx) => tx.documentos());
    expect(VERSION_EXPORTACION).toBe(2);
    const txt = exportarTexto(docs, { formato: 'txt' }).split('\n');
    expect(txt[0]).toBe('#factura-hn|v2|2');
    expect(txt[1]!.split('|').slice(-4)).toEqual(['referencia', 'motivoAnulacion', 'tipoCambio', 'fechaAnulacion']);
    expect(txt[2]!.split('|').slice(-2)).toEqual(['24.5', '']);
    expect(txt[3]!.split('|').slice(-3)).toEqual(['Error', '', '2026-11-25']);
    const csv = exportarTexto(docs, { formato: 'csv' }).split('\n');
    expect(csv[0]!.endsWith(',motivoAnulacion,tipoCambio,fechaAnulacion')).toBe(true);
    expect(csv[1]).toContain(usd.numero);
    expect(csv[1]!.endsWith(',24.5,')).toBe(true);
    expect(csv[2]!.endsWith(',Error,,2026-11-25')).toBe(true);
  });

  it('receta del libro de ventas de la guía: libroVentas deja fuera los documentos de prueba', async () => {
    const demo = await crearFacturadorDemo({ almacen, puntoEmision: '009' });
    await demo.emitir({ lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '10.00' }] });
    await factura();
    const docs = await almacen.transaccion((tx) => tx.documentos());
    expect(docs.length).toBe(2);
    const { filas } = libroVentas(docs);
    const csv = libroVentasCSV(filas);
    expect(csv.trim().split('\n').length).toBe(2); // encabezado + la factura real
  });
});
