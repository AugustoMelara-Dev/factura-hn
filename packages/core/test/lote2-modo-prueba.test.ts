import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  esDocumentoDePrueba,
  exportarTexto,
  leerExportacionJSONL,
  lineaExportacion,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  type DocumentoFiscal,
} from '../src';
import { autorizacionDemo, caiDemo, crearFacturadorDemo, EMISOR_DEMO, esCAIDemo, LEYENDA_PRUEBA } from '../src/demo';
import { documentosReales } from './documentos-reales';

const caja = { establecimiento: '000', puntoEmision: '001' };
const venta = { lineas: [{ descripcion: 'Café 1 lb', cantidad: '2', precioUnitario: '120.00' }] };

describe('factura-hn/demo', () => {
  it('la leyenda es el texto aprobado, con raya U+2014', () => {
    expect(LEYENDA_PRUEBA).toBe('DOCUMENTO DE PRUEBA — SIN VALOR FISCAL');
  });

  it('autorizacionDemo: CAI ficticio de prueba, rango amplio y fecha límite a 180 días de hoy en Honduras', () => {
    const a = autorizacionDemo();
    expect(a).toEqual({
      cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 1_000_000, fechaLimiteEmision: '2027-05-17', prueba: true,
    });
    // El día lo da Honduras (UTC-6): a las 23:30 del 31-12 en Honduras ya es 1-1 en UTC.
    expect(autorizacionDemo({ hoy: new Date('2027-01-01T05:30:00Z') }).fechaLimiteEmision).toBe('2027-06-29');
    expect(autorizacionDemo({ hoy: '2028-02-01', tipoDocumento: '06', puntoEmision: 2 })).toMatchObject({
      cai: caiDemo('06'), tipoDocumento: '06', puntoEmision: '002', fechaLimiteEmision: '2028-07-30',
    });
  });

  it('esCAIDemo reconoce el CAI ficticio (prefijo DEMO00-NO-VALIDO-), sin importar mayúsculas ni espacios', () => {
    expect(autorizacionDemo().cai.startsWith('DEMO00-NO-VALIDO-')).toBe(true);
    for (const t of ['01', '06', '07'] as const) expect(esCAIDemo(caiDemo(t))).toBe(true);
    expect(esCAIDemo('DEMO00-NO-VALIDO-0000-0000-0000-00')).toBe(true); // el de la API
    expect(esCAIDemo('  demo00-no-valido-0000-0000-0000-01 ')).toBe(true);
    expect(esCAIDemo('A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4')).toBe(false);
    expect(esCAIDemo('X DEMO00-NO-VALIDO-0000')).toBe(false);
    expect(esCAIDemo('DEMO00-NO-VALID')).toBe(false);
    expect(esCAIDemo('DEMO00-NO-VALIDO-EXTERNO')).toBe(true); // basta el prefijo corto
    expect(esCAIDemo('')).toBe(false);
  });

  it('crearFacturadorDemo emite al instante documentos de prueba, y no repite los CAI en el mismo almacén', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const f = await crearFacturadorDemo({ almacen });
    const factura = await f.emitir(venta);
    expect(factura).toMatchObject({ numero: '000-001-01-00000001', cai: caiDemo('01'), modo: 'prueba', emisor: { razonSocial: EMISOR_DEMO.razonSocial } });
    expect(factura.advertencias).toEqual([]);
    const otra = await crearFacturadorDemo({ almacen });
    expect((await otra.emitir(venta)).numero).toBe('000-001-01-00000002');
    expect(await almacen.transaccion((tx) => tx.autorizaciones('000-001-01'))).toHaveLength(1);
    // Notas de crédito y de débito también, con CAI de prueba propios (la nota exige el RTN del adquirente).
    const conRTN = await f.emitir({ ...venta, cliente: { nombre: 'Cliente de prueba', rtn: '99990000000002' } });
    const nota = await f.notaCredito({ original: conRTN.numero, motivo: 'Devolución', lineas: [{ descripcion: 'Café 1 lb', cantidad: '1', precioUnitario: '120.00' }] });
    expect(nota).toMatchObject({ numero: '000-001-06-00000001', cai: caiDemo('06'), modo: 'prueba' });
  });
});

describe('modo de prueba (documento)', () => {
  it('todo documento emitido con una autorización de prueba lleva modo «prueba»; uno real no lleva el campo', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, autorizacionDemo());
    await registrarAutorizacion(almacen, { ...autorizacionDemo(), prueba: undefined, cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', puntoEmision: '002' });
    const prueba = await emitir({ emisor: EMISOR_DEMO, ...venta }, { almacen, ...caja });
    const real = await emitir({ emisor: EMISOR_DEMO, ...venta }, { almacen, establecimiento: '000', puntoEmision: '002' });
    expect(prueba.modo).toBe('prueba');
    expect(esDocumentoDePrueba(prueba)).toBe(true);
    expect('modo' in real).toBe(false);
    expect(esDocumentoDePrueba(real)).toBe(false);
  });

  it('es inmutable, sobrevive a la anulación y viaja en la línea JSONL', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const f = await crearFacturadorDemo({ almacen });
    const doc = await f.emitir(venta);
    expect(() => {
      (doc as { modo?: string }).modo = undefined;
    }).toThrow();
    const anulado = await anular(doc.numero, { almacen, motivo: 'Prueba' });
    expect(anulado).toMatchObject({ estado: 'ANULADO', modo: 'prueba' });
    const [leido] = leerExportacionJSONL(lineaExportacion(anulado, 'jsonl'));
    expect(leido!.modo).toBe('prueba');
    // exportarTexto deja fuera los documentos de prueba.
    expect(exportarTexto([anulado], { formato: 'jsonl' })).toBe('');
    // Lo anulado y de prueba lleva las dos leyendas.
    const texto = renderizarTexto(anulado);
    expect(texto).toContain('*** ANULADA ***');
    expect(texto).toContain(LEYENDA_PRUEBA);
  });

  it('una serie pasa de prueba a real, nunca al revés', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, autorizacionDemo({ rangoFinal: 100 }));
    const real = { ...autorizacionDemo({ rangoInicial: 101, rangoFinal: 200 }), prueba: undefined, cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01' };
    await registrarAutorizacion(almacen, real);
    await expect(registrarAutorizacion(almacen, autorizacionDemo({ rangoInicial: 300, rangoFinal: 400, renovacion: true })))
      .rejects.toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }] });
    const otra = new AlmacenFiscalMemoria();
    await registrarAutorizacion(otra, { ...real, rangoInicial: 1 });
    await expect(registrarAutorizacion(otra, autorizacionDemo({ rangoInicial: 500, rangoFinal: 600 })))
      .rejects.toMatchObject({ errores: [{ codigo: 'AUTORIZACION_MODO_MEZCLADO', solucion: expect.stringContaining('otro almacén') }] });
  });
});

describe('modo de prueba (impreso)', () => {
  let doc: DocumentoFiscal;
  const emitirPrueba = async () => (await crearFacturadorDemo()).emitir(venta);

  it('HTML (carta y ticket): leyenda destacada al inicio y al final, y en el título', async () => {
    doc = await emitirPrueba();
    for (const formato of ['carta', 'ticket'] as const) {
      const html = renderizarHTML(doc, { formato });
      const apariciones = html.split(`>${LEYENDA_PRUEBA}</div>`).length - 1;
      expect(apariciones, formato).toBe(2);
      expect(html.indexOf(LEYENDA_PRUEBA)).toBeLessThan(html.indexOf('<header>'));
      expect(html.lastIndexOf(LEYENDA_PRUEBA)).toBeGreaterThan(html.indexOf('</footer>'));
      expect(html).toMatch(/<title>PRUEBA · Factura 000-001-01-00000001<\/title>/);
    }
  });

  it('texto: leyenda enmarcada en la primera y en la última línea, en cualquier ancho', async () => {
    doc = await emitirPrueba();
    for (const ancho of [32, 42, 48]) {
      const lineas = renderizarTexto(doc, { ancho, leyenda: 'Gracias por su compra' }).trimEnd().split('\n');
      expect(lineas[0]).toBe('*'.repeat(ancho));
      expect(lineas.slice(0, 5).join(' ').replace(/\s+/g, ' ')).toContain(LEYENDA_PRUEBA);
      expect(lineas.slice(-6).join(' ').replace(/\s+/g, ' ')).toContain(LEYENDA_PRUEBA);
      expect(lineas.every((l) => l.length <= ancho)).toBe(true);
    }
  });
});

describe('un documento real no cambia en nada', () => {
  // Huellas del render de la 0.2.0, antes del modo de prueba (las mismas que comprueba @factura-hn/pdf).
  const BASE: Record<string, string> = {
    'simple.html': '6e83b3979780f10c6a56903f86b6a47d011159092cecda80dd76a4feaca0e36f',
    'simple.ticket': '5fab7c08059ecffc27ac3c515350ea6190eecb1f28145091cb1a19a0756cd3c9',
    'simple.texto': 'f8d9c326ea4050c9d30d2ceca73e4357a34baaf9863ae97e02a64e59869f8f52',
    'mixta.html': 'fa6b4f15ea1c9e0f7e7fbfb92156e7e0ea94b22811da28af6f313eafe32603a5',
    'mixta.ticket': '508f733444ace4c1a9b81f04374b065ce7ab8211a49736fa5bb9af14175d5411',
    'mixta.texto': '4cefbd60c420b87411f2326c12ae4bc8f6ba49a04a67a2fa987250c8a8c31ab2',
    'anulada.html': 'd61f102f47e5ea3abad1c47f45453d80e808e58a614392cc7df82975e990d068',
    'anulada.ticket': '06c6262955f2559951ce0d630647c24b230e3fac730bb2c38ef7e43a168dca85',
    'anulada.texto': '185437cf049a744b595c41cc01a13acab907626091fe107baf5923cc090daf5f',
    'nota.html': 'cbe85f5bed65ebb43e84b5a096792ba86190ec08b75314369e5246b5b36e2cbc',
    'nota.ticket': '045d4cc476aa2d53ec5ae3a5d199ca8ce37bb0c5fd9dc65d39a882e106021e4b',
    'nota.texto': 'e01fa35029305a4d110b61b1926eebf2d4b618e7c0de2bcf45010acdcee51e61',
  };
  const huella = (s: string) => createHash('sha256').update(s).digest('hex');

  it('HTML y texto, byte por byte, igual que antes del modo de prueba', () => {
    for (const [nombre, doc] of Object.entries(documentosReales())) {
      expect('modo' in doc).toBe(false);
      expect(huella(renderizarHTML(doc)), `${nombre}.html`).toBe(BASE[`${nombre}.html`]);
      expect(huella(renderizarHTML(doc, { formato: 'ticket', leyenda: 'Gracias' })), `${nombre}.ticket`).toBe(BASE[`${nombre}.ticket`]);
      expect(huella(renderizarTexto(doc)), `${nombre}.texto`).toBe(BASE[`${nombre}.texto`]);
    }
  });

  it('un documento guardado antes de existir el campo (JSON sin «modo») es real', () => {
    const { simple } = documentosReales();
    const guardado = JSON.parse(JSON.stringify(simple)) as DocumentoFiscal;
    expect(esDocumentoDePrueba(guardado)).toBe(false);
    expect(renderizarHTML(guardado)).toBe(renderizarHTML(simple));
    expect(renderizarTexto(guardado)).not.toContain(LEYENDA_PRUEBA);
  });
});
