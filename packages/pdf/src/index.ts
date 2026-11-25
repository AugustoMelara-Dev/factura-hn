/**
 * @factura-hn/pdf: PDF de un `DocumentoFiscal`, sin navegador ni dependencias nativas (pdf-lib).
 *
 * El contenido sale de `renderizarTexto` del núcleo, de modo que el PDF lleva exactamente los mismos datos
 * que el ticket térmico (Arts. 10 y 11 del Reglamento) y las copias son idénticas al original (Art. 38).
 * Un documento ANULADO lleva la leyenda al inicio y al final (Art. 41) y una marca de agua diagonal. Un documento
 * de prueba (`modo: 'prueba'`) lleva `LEYENDA_PRUEBA` al inicio y al final, en negrita, y la marca de agua PRUEBA.
 *
 * Papel térmico (Art. 38): imprimir en papel térmico exige presentar antes al SAR la certificación del
 * proveedor de que la impresión se conserva al menos 5 años.
 */
import { esDocumentoDePrueba, LEYENDA_PRUEBA, renderizarTexto, type DocumentoFiscal } from 'factura-hn';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib';

export interface OpcionesPDF {
  /** 'carta' (8.5 × 11 pulgadas, por defecto) o 'ticket' (80 mm de ancho, alto según el contenido). */
  formato?: 'carta' | 'ticket';
  /** Leyenda al pie (no la exige el reglamento). */
  leyenda?: string | null;
}

const MM = 72 / 25.4;

interface Formato {
  columnas: number;
  tamano: number;
  ancho: number;
  /** Alto fijo de página; null = una sola página con el alto del contenido. */
  alto: number | null;
  margen: number;
}

const FORMATOS: Record<'carta' | 'ticket', Formato> = {
  carta: { columnas: 90, tamano: 9, ancho: 612, alto: 792, margen: 40 },
  ticket: { columnas: 42, tamano: 8, ancho: 80 * MM, alto: null, margen: 4 * MM },
};

// Caracteres fuera de la tabla ASCII que las fuentes estándar de PDF (WinAnsi) sí pueden dibujar.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Reemplaza lo que una fuente estándar de PDF no puede dibujar (WinAnsi) por un equivalente o «?». */
export function aWinAnsi(texto: string): string {
  let out = '';
  for (const c of texto.normalize('NFC')) {
    const cp = c.codePointAt(0)!;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(c)) out += c;
    else if (c === '\t') out += ' ';
    else if (c === '≈') out += '~';
    else if (c === '−') out += '-';
    else out += '?';
  }
  return out;
}

/** Las líneas que se dibujan en el PDF (útil para pruebas y vistas previas). */
export function lineasPDF(doc: DocumentoFiscal, opciones: OpcionesPDF = {}): string[] {
  const f = FORMATOS[opciones.formato ?? 'carta'];
  return renderizarTexto(doc, { ancho: f.columnas, leyenda: opciones.leyenda ?? null })
    .replace(/\n$/, '')
    .split('\n')
    .map(aWinAnsi);
}

/**
 * Genera el PDF. La salida es determinista: el mismo documento produce los mismos bytes (las fechas de
 * los metadatos son las de emisión), lo que permite guardar su huella.
 */
export async function renderizarPDF(doc: DocumentoFiscal, opciones: OpcionesPDF = {}): Promise<Uint8Array> {
  const f = FORMATOS[opciones.formato ?? 'carta'];
  const lineas = lineasPDF(doc, opciones);
  const interlineado = f.tamano * 1.25;

  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Courier);
  const negrita = await pdf.embedFont(StandardFonts.CourierBold);
  const emision = new Date(`${doc.fechaEmision}T${doc.horaEmision ?? '00:00'}:00-06:00`);
  pdf.setTitle(aWinAnsi(`${doc.nombreDocumento} ${doc.numero}`));
  pdf.setAuthor(aWinAnsi(doc.emisor.razonSocial));
  pdf.setSubject(aWinAnsi(`CAI ${doc.cai}`));
  pdf.setProducer('factura-hn');
  pdf.setCreator('factura-hn');
  pdf.setCreationDate(emision);
  pdf.setModificationDate(emision);

  const altoContenido = lineas.length * interlineado + 2 * f.margen;
  const alto = f.alto ?? altoContenido;
  const porPagina = f.alto ? Math.floor((f.alto - 2 * f.margen) / interlineado) : lineas.length;
  const anchoTexto = normal.widthOfTextAtSize('M', f.tamano) * f.columnas;
  const x = Math.max(f.margen, (f.ancho - anchoTexto) / 2);
  const anulada = doc.estado === 'ANULADO';
  const prueba = esDocumentoDePrueba(doc);
  const leyendaPrueba = aWinAnsi(LEYENDA_PRUEBA);
  const resaltar = (l: string) =>
    /\*\*\* ANULADA \*\*\*|^\s*N° /.test(l) ||
    l.trim() === doc.nombreDocumento.toUpperCase() ||
    (prueba && (/^\*+$/.test(l) || l.trim() === leyendaPrueba));

  for (let i = 0; i < lineas.length; i += porPagina) {
    const pagina = pdf.addPage([f.ancho, alto]);
    let y = alto - f.margen - f.tamano;
    for (const l of lineas.slice(i, i + porPagina)) {
      const fuente: PDFFont = resaltar(l) ? negrita : normal;
      if (l.trim()) pagina.drawText(l, { x, y, size: f.tamano, font: fuente, color: rgb(0, 0, 0) });
      y -= interlineado;
    }
    if (anulada) {
      const tam = f.ancho / 6;
      const w = negrita.widthOfTextAtSize('ANULADA', tam);
      pagina.drawText('ANULADA', {
        x: f.ancho / 2 - (w / 2) * Math.cos(Math.PI / 4),
        y: alto / 2 - (w / 2) * Math.sin(Math.PI / 4),
        size: tam,
        font: negrita,
        color: rgb(0.8, 0, 0),
        opacity: 0.25,
        rotate: degrees(45),
      });
    } else if (prueba) {
      const tam = f.ancho / 6;
      const w = negrita.widthOfTextAtSize('PRUEBA', tam);
      pagina.drawText('PRUEBA', {
        x: f.ancho / 2 - (w / 2) * Math.cos(Math.PI / 4),
        y: alto / 2 - (w / 2) * Math.sin(Math.PI / 4),
        size: tam,
        font: negrita,
        color: rgb(0.8, 0, 0),
        opacity: 0.2,
        rotate: degrees(45),
      });
    }
  }
  return pdf.save({ useObjectStreams: false });
}
