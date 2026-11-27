import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, anular, buscarDocumento, emitir, registrarAutorizacion, type DocumentoFiscal } from 'factura-hn';
import { aWinAnsi, lineasPDF, renderizarPDF } from '../src';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Ferretería Muñoz S. de R.L.', nombreComercial: 'Ferretería Muñoz',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001', correo: 'ventas@ejemplo.example',
};
const reloj = () => new Date('2026-11-18T16:30:00Z');
let almacen: AlmacenFiscalMemoria;
let factura: DocumentoFiscal;

beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, {
    cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
    rangoInicial: 1, rangoFinal: 500, fechaLimiteEmision: '2027-06-30',
  }, { reloj });
  factura = await emitir({
    emisor: EMISOR,
    cliente: { nombre: 'Constructora Peña 🏗️', rtn: '99990000000002' },
    lineas: [
      { descripcion: 'Clavos 2" (caja)', cantidad: 2, precioUnitario: '150.00' },
      { descripcion: 'Cemento ≈ 42.5 kg', cantidad: 1, precioUnitario: '245.50' },
    ],
  }, { almacen, establecimiento: '000', puntoEmision: '001', opciones: { reloj } });
});

describe('contenido (Arts. 10 y 11)', () => {
  it('lleva los datos fiscales del documento, con acentos y eñes', () => {
    const texto = lineasPDF(factura).join('\n');
    for (const dato of ['Ferretería Muñoz S. de R.L.', 'RTN: 9999-0000-000001', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01',
      '000-001-01-00000001', 'Fecha límite de emisión', 'Rango:', factura.totales.totalEnLetras, factura.destinoEjemplares]) {
      expect(texto).toContain(dato);
    }
  });
  it('lo que una fuente estándar no puede dibujar se reemplaza en lugar de fallar', () => {
    expect(aWinAnsi('Peña 🏗️ ≈ “ok” €')).toBe('Peña ?? ~ “ok” €');
    const texto = lineasPDF(factura).join('\n');
    expect(texto).toContain('Constructora Peña ??');
    expect(texto).toContain('Cemento ~ 42.5 kg');
  });
});

describe('formatos', () => {
  it('un formato desconocido da un error que dice cuáles hay', async () => {
    for (const formato of ['A4', 'a4', '', 5]) {
      const opciones = { formato } as unknown as Parameters<typeof renderizarPDF>[1];
      await expect(renderizarPDF(factura, opciones)).rejects.toThrow(/Formato de PDF desconocido: .*Usa 'carta' o 'ticket'\./);
      expect(() => lineasPDF(factura, opciones)).toThrow(RangeError);
    }
  });
  it('carta: una página de 612 × 792 pt con metadatos', async () => {
    const pdf = await PDFDocument.load(await renderizarPDF(factura));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(pdf.getTitle()).toBe('Factura 000-001-01-00000001');
    expect(pdf.getSubject()).toBe(`CAI ${factura.cai}`);
  });
  it('ticket: 80 mm de ancho y alto según el contenido', async () => {
    const pdf = await PDFDocument.load(await renderizarPDF(factura, { formato: 'ticket' }));
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(226.77, 1);
    expect(height).toBeGreaterThan(200);
    expect(lineasPDF(factura, { formato: 'ticket' }).every((l) => l.length <= 42)).toBe(true);
  });
  it('carta: un documento largo ocupa varias páginas', async () => {
    const largo = await emitir({
      emisor: EMISOR,
      lineas: Array.from({ length: 80 }, (_, i) => ({ descripcion: `Artículo ${i + 1}`, cantidad: 1, precioUnitario: '1.00' })),
    }, { almacen, establecimiento: '000', puntoEmision: '001', opciones: { reloj } });
    const pdf = await PDFDocument.load(await renderizarPDF(largo));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
  it('Art. 38: la copia reimpresa desde el almacén es idéntica al original, en carta y en ticket', async () => {
    const guardado = await buscarDocumento(almacen, factura.numero);
    for (const formato of ['carta', 'ticket'] as const) {
      const original = Buffer.from(await renderizarPDF(factura, { formato }));
      const copia = Buffer.from(await renderizarPDF(guardado!, { formato }));
      expect(copia.equals(original)).toBe(true);
    }
  });
  it('determinista: el mismo documento da los mismos bytes', async () => {
    expect(Buffer.from(await renderizarPDF(factura)).equals(Buffer.from(await renderizarPDF(factura)))).toBe(true);
  });
});

describe('Art. 41: anulación', () => {
  it('el PDF de un documento ANULADO lleva la leyenda al inicio y al final', async () => {
    const anulada = await anular(factura.numero, { almacen, motivo: 'Error en el RTN', reloj });
    const l = lineasPDF(anulada);
    expect(l[0]!.trim()).toBe('*** ANULADA ***');
    expect(l.filter((x) => x.includes('*** ANULADA ***'))).toHaveLength(2);
    expect(l.join('\n')).toContain('Error en el RTN');
    const pdf = await PDFDocument.load(await renderizarPDF(anulada));
    expect(pdf.getPageCount()).toBe(1);
  });
});
