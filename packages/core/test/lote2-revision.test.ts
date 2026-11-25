/**
 * Revisión del modo de prueba y del equivalente en lempiras: un CAI ficticio siempre sale con leyenda, un CAI
 * real nunca es de prueba, un punto de emisión no mezcla modos, las notas no cruzan de modo, la exportación y
 * el libro dejan fuera lo de prueba, y un documento en USD ya guardado se reimprime igual.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  crearFacturador,
  emitir,
  esAutorizacionDePrueba,
  esCAIDemo as esCAIDemoIndice,
  esDocumentoDePrueba,
  exportarTexto,
  libroVentas,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  separarDocumentosDePrueba,
  validarAutorizacion,
  type AutorizacionCAI,
} from '../src';
import { autorizacionDemo, caiDemo, crearFacturadorDemo, EMISOR_DEMO, esCAIDemo, LEYENDA_PRUEBA } from '../src/demo';
import { construirDocumento } from '../src/documento';
import { facturaUSDAntes } from './documentos-reales';

const EMISOR = { ...EMISOR_DEMO, rtn: '99990000000001', razonSocial: 'Comercial Ejemplo S. de R.L.' };
const CLIENTE = { nombre: 'Ferretería Pérez', rtn: '99990000000002' };
const real = (tipoDocumento: '01' | '06' | '07' = '01', puntoEmision = '001'): AutorizacionCAI => ({
  cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${tipoDocumento}`,
  tipoDocumento,
  establecimiento: '000',
  puntoEmision,
  rangoInicial: 1,
  rangoFinal: 500,
  fechaLimiteEmision: '2027-06-30',
});
const linea = (precio = '100.00') => [{ descripcion: 'Arroz 5 lb', cantidad: 1, precioUnitario: precio }];
const codigos = async (p: Promise<unknown>) => {
  try {
    await p;
    return [];
  } catch (e) {
    return (e as { errores?: Array<{ codigo: string }> }).errores?.map((x) => x.codigo) ?? [String(e)];
  }
};

describe('1. un CAI ficticio siempre es de prueba', () => {
  it('sin `prueba: true` (como lo registran la API y el MCP), el documento sale con modo y leyenda', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const { prueba: _sinMarca, ...aut } = autorizacionDemo();
    expect(esAutorizacionDePrueba(aut)).toBe(true);
    await registrarAutorizacion(almacen, aut);
    const doc = await emitir({ emisor: EMISOR_DEMO, lineas: linea() }, { almacen, establecimiento: '000', puntoEmision: '001' });
    expect(doc.modo).toBe('prueba');
    expect(renderizarTexto(doc)).toContain(LEYENDA_PRUEBA);
    expect(renderizarHTML(doc)).toContain(LEYENDA_PRUEBA);
  });

  it('un documento guardado sin `modo` pero con CAI ficticio se reconoce y se imprime como prueba', () => {
    const doc = construirDocumento({ emisor: EMISOR_DEMO, lineas: linea() }, autorizacionDemo(), 1);
    const { modo: _quitado, ...guardado } = doc;
    expect(esDocumentoDePrueba(guardado)).toBe(true);
    expect(renderizarTexto(guardado)).toContain(LEYENDA_PRUEBA);
  });

  it('`prueba` que no es booleano se rechaza (AUTORIZACION_PRUEBA_FORMATO)', async () => {
    const texto = { ...autorizacionDemo(), prueba: 'true' as unknown as boolean };
    expect(validarAutorizacion(texto).map((p) => p.codigo)).toContain('AUTORIZACION_PRUEBA_FORMATO');
    expect(await codigos(registrarAutorizacion(new AlmacenFiscalMemoria(), texto))).toContain('AUTORIZACION_PRUEBA_FORMATO');
    expect(validarAutorizacion({ ...autorizacionDemo(), prueba: false }).map((p) => p.codigo)).not.toContain('AUTORIZACION_PRUEBA_FORMATO');
  });

  it('esCAIDemo vive en modo.ts y se exporta igual desde el índice y desde factura-hn/demo', () => {
    expect(esCAIDemoIndice).toBe(esCAIDemo);
    expect(esCAIDemo('DEMO00-NO-VALIDO-EXTERNO')).toBe(true);
    expect(esCAIDemo(caiDemo('06', '2026-11-24'))).toBe(true);
  });
});

describe('2. un CAI real nunca es de prueba', () => {
  it('`prueba: true` con un CAI real: AUTORIZACION_PRUEBA_CAI_REAL al registrar y al construir', async () => {
    const aut = { ...real(), prueba: true };
    expect(await codigos(registrarAutorizacion(new AlmacenFiscalMemoria(), aut))).toContain('AUTORIZACION_PRUEBA_CAI_REAL');
    expect(() => construirDocumento({ emisor: EMISOR, lineas: linea() }, aut, 1)).toThrow(/AUTORIZACION_PRUEBA_CAI_REAL/);
  });
});

describe('3. un punto de emisión es entero de prueba o entero real', () => {
  it('AUTORIZACION_MODO_MEZCLADO entre tipos distintos del mismo punto; otro punto u otro almacén, sí', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, real('01'));
    expect(await codigos(registrarAutorizacion(almacen, autorizacionDemo({ tipoDocumento: '06' })))).toEqual(['AUTORIZACION_MODO_MEZCLADO']);
    // Y al revés: una demo 01 en el punto 002, luego una real 07 en el mismo punto.
    await registrarAutorizacion(almacen, autorizacionDemo({ puntoEmision: '002' }));
    expect(await codigos(registrarAutorizacion(almacen, real('07', '002')))).toEqual(['AUTORIZACION_MODO_MEZCLADO']);
    await registrarAutorizacion(almacen, real('06'));
  });

  it('REFERENCIA_MODO_MEZCLADO: una nota real no modifica una factura de prueba, ni al revés', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, real('01'));
    await registrarAutorizacion(almacen, real('06'));
    await registrarAutorizacion(almacen, autorizacionDemo({ puntoEmision: '002' }));
    await registrarAutorizacion(almacen, autorizacionDemo({ puntoEmision: '002', tipoDocumento: '06' }));
    const cajaReal = { almacen, establecimiento: '000', puntoEmision: '001' };
    const cajaDemo = { almacen, establecimiento: '000', puntoEmision: '002' };
    const facturaReal = await emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: linea() }, cajaReal);
    const facturaDemo = await emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: linea() }, cajaDemo);
    const nota = (f: typeof facturaReal) => ({
      tipoDocumento: '06' as const,
      emisor: EMISOR,
      cliente: CLIENTE,
      motivo: 'Devolución',
      referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision },
      lineas: linea('10.00'),
    });
    expect(await codigos(emitir(nota(facturaDemo), cajaReal))).toContain('REFERENCIA_MODO_MEZCLADO');
    expect(await codigos(emitir(nota(facturaReal), cajaDemo))).toContain('REFERENCIA_MODO_MEZCLADO');
    expect((await emitir(nota(facturaReal), cajaReal)).modo).toBeUndefined();
    expect((await emitir(nota(facturaDemo), cajaDemo)).modo).toBe('prueba');
  });

  it('el saldo de una factura real no descuenta notas de prueba guardadas antes de esta regla', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, real('01'));
    await registrarAutorizacion(almacen, real('06'));
    const caja = { almacen, establecimiento: '000', puntoEmision: '001' };
    const factura = await emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: linea() }, caja);
    const referencia = { cai: factura.cai, numero: factura.numero, fecha: factura.fechaEmision };
    // Una nota de prueba por el total, guardada directamente (como la habría dejado una versión anterior).
    const notaPrueba = construirDocumento(
      { tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Prueba', referencia, lineas: linea('100.00') },
      autorizacionDemo({ tipoDocumento: '06', puntoEmision: '009' }),
      1,
    );
    await almacen.transaccion((tx) => tx.guardarDocumento(notaPrueba));
    // La nota real por el total sigue cabiendo: la de prueba no cuenta para el saldo.
    const notaReal = await emitir({ tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Devolución', referencia, lineas: linea('100.00') }, caja);
    expect(notaReal.totales.total).toBe(factura.totales.total);
    // Y una segunda ya no.
    expect(
      await codigos(emitir({ tipoDocumento: '06', emisor: EMISOR, cliente: CLIENTE, motivo: 'Otra', referencia, lineas: linea('1.00') }, caja)),
    ).toContain('NOTA_SUPERA_ORIGINAL');
  });
});

describe('4. la exportación y el libro dejan fuera los documentos de prueba', () => {
  it('exportarTexto, libroVentas y separarDocumentosDePrueba', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, real('01'));
    const deReal = await emitir({ emisor: EMISOR, lineas: linea() }, { almacen, establecimiento: '000', puntoEmision: '001' });
    const demo = await crearFacturadorDemo();
    const dePrueba = await demo.emitir({ lineas: linea() });
    const sinModo = (() => {
      const { modo: _m, ...d } = construirDocumento({ emisor: EMISOR_DEMO, lineas: linea() }, autorizacionDemo(), 2);
      return d;
    })();
    const docs = [dePrueba, deReal, sinModo];

    expect(separarDocumentosDePrueba(docs)).toEqual({ reales: [deReal], excluidos: 2 });
    for (const formato of ['csv', 'txt', 'jsonl'] as const) {
      expect(exportarTexto(docs, { formato }), formato).toBe(exportarTexto([deReal], { formato }));
    }
    expect(exportarTexto(docs, { formato: 'txt' }).split('\n')[0]).toBe('#factura-hn|v1|1');
    const libro = libroVentas(docs);
    expect(libro.excluidos).toBe(2);
    expect(libro.filas.map((f) => f.numero)).toEqual([deReal.numero]);
    expect(libro.resumen.documentos).toBe(1);
    expect(libro.resumen.total).toBe(deReal.totales.total);
  });
});

describe('5. equivalente en lempiras guardado al emitir', () => {
  const huella = (s: string) => createHash('sha256').update(s).digest('hex');

  it('una factura en USD guardada sin el campo se reimprime con los mismos bytes que en main (Art. 38)', () => {
    const antes = facturaUSDAntes();
    expect(antes.equivalenteLempiras).toBeUndefined();
    // Huellas de renderizarHTML y renderizarTexto de main (0.2.0) para este mismo documento.
    expect(huella(renderizarHTML(antes))).toBe('fa74943ef6ee5ce1da0e384c0e3b70ade31ad8149a5e116e3545f7587c81800c');
    expect(huella(renderizarHTML(antes, { formato: 'ticket', leyenda: 'Gracias' }))).toBe('84d753a9a15a8d130f5bdf21cd57f9b853481b9efa0afdeb711ce7d5af7ac39a');
    expect(huella(renderizarTexto(antes))).toBe('48ef21af7e8e74f757aa3345e12312f150d9eaae0727056c07b121649729965a');
    expect(renderizarTexto(antes)).not.toContain('Equivalente en lempiras');
  });

  it('una factura en USD nueva guarda el equivalente (inmutable) y lo imprime; una en lempiras no lo lleva', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, real('01'));
    const caja = crearFacturador({ almacen, emisor: EMISOR });
    const usd = await caja.emitir({
      cliente: CLIENTE,
      moneda: 'USD',
      tipoCambio: '24.6517',
      lineas: [
        { descripcion: 'Servicio de consultoría', cantidad: 1, precioUnitario: '200.00' },
        { descripcion: 'Licencia anual', cantidad: 1, precioUnitario: '10.00', isv: 'ISV18' },
      ],
    });
    // 30.00 × 24.6517 = 739.551 → 739.55; 1.80 × 24.6517 = 44.37306 → 44.37; 241.80 × 24.6517 = 5,960.78106 → 5,960.78.
    expect(usd.equivalenteLempiras).toEqual({ isv15: 739.55, isv18: 44.37, total: 5960.78 });
    expect(() => {
      (usd.equivalenteLempiras as { total: number }).total = 0;
    }).toThrow();
    expect((await caja.documento(usd.numero))!.equivalenteLempiras).toEqual(usd.equivalenteLempiras);
    expect(renderizarTexto(usd)).toContain('Equivalente en lempiras:');
    const hnl = await caja.emitir({ lineas: linea() });
    expect('equivalenteLempiras' in hnl).toBe(false);
  });
});

describe('7 y 8. demo persistente y fecha de la demo', () => {
  it('crearFacturadorDemo sobre un almacén con la demo vencida registra otra demo, con otro CAI y el rango a continuación', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const dia1 = () => new Date('2026-11-18T18:00:00Z');
    const primera = await crearFacturadorDemo({ almacen, reloj: dia1 });
    const f1 = await primera.emitir({ lineas: linea() });
    // Mismo día: no registra otra.
    await crearFacturadorDemo({ almacen, reloj: dia1 });
    // 200 días después la demo (180 días) venció.
    const despues = () => new Date('2027-06-06T18:00:00Z');
    const segunda = await crearFacturadorDemo({ almacen, reloj: despues });
    const f2 = await segunda.emitir({ lineas: linea() }, { confirmarSaltoDeFecha: true });
    expect(f2.cai).toBe('DEMO00-NO-VALIDO-0000-0000-20270606-01');
    expect(esCAIDemo(f2.cai)).toBe(true);
    expect(f2.modo).toBe('prueba');
    expect(f1.correlativo).toBe(1);
    expect(f2.correlativo).toBe(1_000_001);
    const auts = await almacen.transaccion((tx) => tx.autorizaciones('000-001-01'));
    expect(auts.map((a) => [a.rangoInicial, a.rangoFinal])).toEqual([[1, 1_000_000], [1_000_001, 2_000_000]]);
    // Otra vez el mismo día: no la repite.
    await crearFacturadorDemo({ almacen, reloj: despues });
    expect(await almacen.transaccion((tx) => tx.autorizaciones('000-001-01'))).toHaveLength(2);
  });

  it('autorizacionDemo con una fecha que no es YYYY-MM-DD da ErrorValidacion FECHA_DEMO, no RangeError', () => {
    for (const hoy of ['24/11/2026', '2026-02-30', new Date('no es fecha')]) {
      let codigo = '';
      try {
        autorizacionDemo({ hoy });
      } catch (e) {
        expect(e).not.toBeInstanceOf(RangeError);
        codigo = (e as { errores: Array<{ codigo: string; solucion?: string }> }).errores[0]!.codigo;
      }
      expect(codigo, String(hoy)).toBe('FECHA_DEMO');
    }
    expect(autorizacionDemo({ hoy: '2026-11-24' }).fechaLimiteEmision).toBe('2027-05-23');
  });
});
