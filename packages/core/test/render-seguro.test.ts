/**
 * Defensa en profundidad del render: un documento leído de un archivo exportado (o de una base ajena) puede
 * traer cualquier texto en cualquier campo. El HTML escapa todo lo interpolado y el texto ESC/POS no deja
 * pasar caracteres de control.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  exportarTexto,
  leerExportacionJSONL,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  type DocumentoFiscal,
} from '../src';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Pulpería La Esquina', nombreComercial: 'La Esquina',
  direccionCasaMatriz: 'Ciudad Ejemplo', direccionEstablecimiento: 'Ciudad Ejemplo', telefono: '0000-0001', correo: 'p@ejemplo.example',
};
const caja = { establecimiento: '000', puntoEmision: '001' };

let almacen: AlmacenFiscalMemoria;
beforeEach(async () => {
  almacen = new AlmacenFiscalMemoria();
  for (const tt of ['01', '06'] as const) {
    await registrarAutorizacion(almacen, {
      cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${tt}`, tipoDocumento: tt, establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
    });
  }
});

const SCRIPT = '<script>alert(1)</script>';
const IMG = '<img src=x onerror=alert(1)>';

/** Exporta a JSONL, altera el JSON y lo vuelve a leer, como haría quien manipula un archivo exportado. */
function manipular(doc: DocumentoFiscal, cambio: (d: Record<string, any>) => void): DocumentoFiscal {
  const linea = JSON.parse(exportarTexto([doc], { formato: 'jsonl' }).trim());
  cambio(linea);
  const [leido] = leerExportacionJSONL(JSON.stringify(linea) + '\n');
  return leido!;
}

function sinMarcado(html: string) {
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img src=x');
  expect(html).not.toContain('</script>');
  expect(html).toContain('&lt;script&gt;');
}

describe('renderizarHTML escapa todo valor interpolado', () => {
  it('moneda, fechas y RTN del emisor manipulados en un JSONL no producen marcado', async () => {
    const f = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'Soda', cantidad: 1, precioUnitario: '20.00' }] }, { almacen, ...caja });
    const doc = manipular(f, (d) => {
      d.moneda = SCRIPT;
      d.tipoCambio = 24.5;
      d.fechaEmision = IMG;
      d.fechaLimiteEmision = SCRIPT;
      d.emisor.rtn = SCRIPT;
    });
    const html = renderizarHTML(doc);
    sinMarcado(html);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('fechas de la referencia y de la anulación tampoco', async () => {
    const f = await emitir({ emisor: EMISOR, lineas: [{ descripcion: 'Soda', cantidad: 1, precioUnitario: '20.00' }] }, { almacen, ...caja });
    const nc = await emitir({
      tipoDocumento: '06', emisor: EMISOR, cliente: { nombre: 'Cliente Ejemplo', rtn: '99990000000002' }, motivo: 'Devolución',
      referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision },
      lineas: [{ descripcion: 'Soda', cantidad: 1, precioUnitario: '20.00' }],
    }, { almacen, ...caja });
    const anulada = await anular(nc.numero, { almacen, motivo: 'Error de precio' });
    const doc = manipular(anulada, (d) => {
      d.referencia.fecha = SCRIPT;
      d.anulacion.fecha = IMG;
      d.cliente.rtn = SCRIPT;
    });
    sinMarcado(renderizarHTML(doc));
  });
});

describe('renderizarTexto no deja pasar caracteres de control a la impresora', () => {
  it('ESC, GS y NUL en el cliente y en una línea se cambian por «?»', async () => {
    const f = await emitir({
      emisor: EMISOR,
      cliente: { nombre: 'Cliente\u001b@Ejemplo\u001dV\u0000' },
      lineas: [{ descripcion: 'Soda\u001bd\u0005 fría\u009b', cantidad: 1, precioUnitario: '20.00' }],
      observaciones: 'Nota\u001b',
    }, { almacen, ...caja });
    const doc = manipular(f, (d) => {
      d.emisor.razonSocial = 'Pulpería\u001bE\u0001';
      d.motivo = 'x\r\u001b';
    });
    const texto = renderizarTexto(doc);
    expect(texto).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(texto).toContain('Cliente?@Ejemplo?V?');
    expect(texto).toContain('Soda?d? fría?');
    expect(texto).toContain('Pulpería?E?');
    expect(texto.split('\n').length).toBeGreaterThan(10);
  });

  it('tabulador y fin de línea de Windows son espacio, no «?»', async () => {
    const f = await emitir({
      emisor: EMISOR,
      cliente: { nombre: 'Cliente\tEjemplo' },
      lineas: [{ descripcion: 'Cemento gris\r\nsaco 42.5 kg\tmarca X', cantidad: 1, precioUnitario: '20.00' }],
    }, { almacen, ...caja });
    const texto = renderizarTexto(f);
    expect(texto).toContain('Cliente Ejemplo');
    expect(texto).toContain('Cemento gris saco 42.5 kg marca X');
    expect(texto).not.toContain('?');
  });
});
