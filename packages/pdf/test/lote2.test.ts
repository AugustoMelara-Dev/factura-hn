import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LEYENDA_PRUEBA, renderizarHTML, renderizarTexto, type DocumentoFiscal } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';
import { lineasPDF, renderizarPDF } from '../src';
import { documentosReales } from '../../core/test/documentos-reales';

const huella = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const reloj = () => new Date('2026-11-18T16:30:00Z');

/** Texto de las páginas del PDF: los flujos de contenido, descomprimidos si vienen con Flate. */
function contenido(pdf: Uint8Array): string {
  const bin = Buffer.from(pdf).toString('latin1');
  let texto = '';
  for (const m of bin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const datos = Buffer.from(m[1]!, 'latin1');
    try {
      texto += inflateSync(datos).toString('latin1');
    } catch {
      texto += m[1];
    }
  }
  return texto;
}

describe('un documento real no cambia en nada (byte por byte)', () => {
  // Huellas de la 0.2.0, antes del modo de prueba y del equivalente en lempiras.
  const BASE: Record<string, string> = {
    'simple.html': '6e83b3979780f10c6a56903f86b6a47d011159092cecda80dd76a4feaca0e36f',
    'simple.ticket': '5fab7c08059ecffc27ac3c515350ea6190eecb1f28145091cb1a19a0756cd3c9',
    'simple.texto': 'f8d9c326ea4050c9d30d2ceca73e4357a34baaf9863ae97e02a64e59869f8f52',
    'simple.pdf': '42c292ff71c964fb2c397c0919760765647aa4fe23316ec6bdad32c8c91e7c2a',
    'simple.pdfticket': 'beff56444b61589776646b74b2a4f9757b6f2598996276e04cfd3fb3b03c7cca',
    'mixta.html': 'fa6b4f15ea1c9e0f7e7fbfb92156e7e0ea94b22811da28af6f313eafe32603a5',
    'mixta.ticket': '508f733444ace4c1a9b81f04374b065ce7ab8211a49736fa5bb9af14175d5411',
    'mixta.texto': '4cefbd60c420b87411f2326c12ae4bc8f6ba49a04a67a2fa987250c8a8c31ab2',
    'mixta.pdf': '5ca3bf45a054c6a141166e86dbb743688542ecc52587766ce934c50a05fe47e2',
    'mixta.pdfticket': 'a2ac3b89068b85f8969ee80be39900e90b20114de9ebdd61f5f04e42a9cfda68',
    'anulada.html': 'd61f102f47e5ea3abad1c47f45453d80e808e58a614392cc7df82975e990d068',
    'anulada.ticket': '06c6262955f2559951ce0d630647c24b230e3fac730bb2c38ef7e43a168dca85',
    'anulada.texto': '185437cf049a744b595c41cc01a13acab907626091fe107baf5923cc090daf5f',
    'anulada.pdf': 'd5f39b7dc18164f1e3f0e00ef94a007adfcbb090661934fac2127f1fce78e669',
    'anulada.pdfticket': '848615267a987448f708dc76695008967708ea2725762de89557c5c474ce4a1d',
    'nota.html': 'cbe85f5bed65ebb43e84b5a096792ba86190ec08b75314369e5246b5b36e2cbc',
    'nota.ticket': '045d4cc476aa2d53ec5ae3a5d199ca8ce37bb0c5fd9dc65d39a882e106021e4b',
    'nota.texto': 'e01fa35029305a4d110b61b1926eebf2d4b618e7c0de2bcf45010acdcee51e61',
    'nota.pdf': 'e8a980ea4b711ebcbef21f65597cfca66aed43f00a83a0a16adf0532a42a8b0b',
    'nota.pdfticket': '204d9170a2c05cca6453d4a0395242ae9eaa6b99f18e48864a76e135e5d3f6e4',
  };

  it('HTML, texto y PDF (carta y ticket) dan los mismos bytes que antes', async () => {
    for (const [n, d] of Object.entries(documentosReales())) {
      expect(huella(renderizarHTML(d)), `${n}.html`).toBe(BASE[`${n}.html`]);
      expect(huella(renderizarHTML(d, { formato: 'ticket', leyenda: 'Gracias' })), `${n}.ticket`).toBe(BASE[`${n}.ticket`]);
      expect(huella(renderizarTexto(d)), `${n}.texto`).toBe(BASE[`${n}.texto`]);
      expect(huella(await renderizarPDF(d)), `${n}.pdf`).toBe(BASE[`${n}.pdf`]);
      expect(huella(await renderizarPDF(d, { formato: 'ticket' })), `${n}.pdfticket`).toBe(BASE[`${n}.pdfticket`]);
    }
  });
});

describe('documento de prueba', () => {
  let doc: DocumentoFiscal;
  const emitirPrueba = async () =>
    (await crearFacturadorDemo({ reloj })).emitir({ lineas: [{ descripcion: 'Café 1 lb', cantidad: '2', precioUnitario: '120.00' }] });

  it('lleva la leyenda al inicio y al final, en carta y en ticket', async () => {
    doc = await emitirPrueba();
    for (const formato of ['carta', 'ticket'] as const) {
      const l = lineasPDF(doc, { formato });
      expect(l[0]!).toMatch(/^\*+$/);
      expect(l[1]!.trim()).toBe(LEYENDA_PRUEBA);
      expect(l.filter((x) => x.trim() === LEYENDA_PRUEBA)).toHaveLength(2);
    }
  });

  it('la leyenda va en negrita y la página lleva la marca de agua PRUEBA', async () => {
    doc = await emitirPrueba();
    const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex').toUpperCase();
    const prueba = contenido(await renderizarPDF(doc));
    // pdf-lib escribe el texto en hexadecimal (WinAnsi: la raya «—» es 0x97).
    expect(prueba).toContain(`<${hex('PRUEBA')}> Tj`);
    const leyenda = hex('DOCUMENTO DE PRUEBA  SIN VALOR FISCAL');
    const bloques = prueba.split('BT').filter((b) => b.includes(leyenda));
    expect(bloques).toHaveLength(2);
    for (const b of bloques) expect(b).toMatch(/\/Courier-Bold-\d+ \d+ Tf/);
    const real = contenido(await renderizarPDF(documentosReales().simple));
    expect(real).not.toContain(hex('PRUEBA'));
  });

  it('en USD, el PDF también da el equivalente en lempiras', async () => {
    const f = await crearFacturadorDemo({ reloj });
    const usd = await f.emitir({
      cliente: { nombre: 'Importadora Ejemplo', rtn: '99990000000002' },
      moneda: 'USD',
      tipoCambio: '24.5',
      lineas: [{ descripcion: 'Servicio', cantidad: '1', precioUnitario: '100.00' }],
    });
    const lineas = lineasPDF(usd).join('\n');
    expect(lineas).toContain('Equivalente en lempiras:');
    expect(lineas).toMatch(/I\.S\.V\. 15% +L 367\.50/);
    expect(lineas).toMatch(/Total +L 2,817\.50/);
  });
});
