/**
 * El libro de ventas va en lempiras (lectura de factura-hn). Un documento en moneda extranjera se convierte con el tipo de
 * cambio que imprime (Art. 11, párrafo final), campo por campo y redondeando a centavos (Art. 9, Ley del ISV).
 */
import { describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, emitir, filaLibroVentas, libroVentasCSV, registrarAutorizacion, resumenVentas } from '../src';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Exportadora Ejemplo', nombreComercial: 'Exportadora Ejemplo',
  direccionCasaMatriz: 'San Pedro Sula', direccionEstablecimiento: 'San Pedro Sula', telefono: '0000-0002', correo: 'e@ejemplo.example',
};
const CLIENTE = { nombre: 'Importadora Norte', rtn: '99990000000002' };

describe('libro de ventas con documentos en moneda extranjera', () => {
  it('suma en lempiras: L 100 + USD 100 a 24.70 dan ISV 15 % de 385.50, no 30', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2099-12-31',
    });
    const caja = { almacen, establecimiento: '000', puntoEmision: '001' };
    const lempiras = await emitir({ emisor: EMISOR, cliente: CLIENTE, lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '100.00' }] }, caja);
    const dolares = await emitir(
      { emisor: EMISOR, cliente: CLIENTE, moneda: 'USD', tipoCambio: '24.70', lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '100.00' }] },
      caja,
    );
    expect(dolares.totales.isv15).toBe(15); // el documento mismo está en dólares

    const filas = [lempiras, dolares].map((d) => filaLibroVentas(d));
    expect(filas[1]).toMatchObject({
      moneda: 'USD', tipoCambio: 24.7, totalMonedaOriginal: 115,
      importeGravado15: 2470, isv15: 370.5, total: 2840.5,
    });
    expect(filas[0]).toMatchObject({ moneda: 'HNL', tipoCambio: null, totalMonedaOriginal: 115, isv15: 15, total: 115 });
    expect(resumenVentas(filas)).toMatchObject({ documentos: 2, importeGravado15: 2570, isv15: 385.5, total: 2955.5 });

    const csv = libroVentasCSV(filas).split('\n');
    expect(csv[0]).toContain('Moneda,Tipo de cambio,Total en moneda original');
    expect(csv[2]).toContain(',2840.50,NO,USD,24.7,115.00');
  });

  it('el redondeo de la conversión es a centavos, mitad hacia arriba (Art. 9)', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2099-12-31',
    });
    // 0.10 USD × 24.655 = 2.4655 → 2.47 ; ISV 0.02 × 24.655 = 0.4931 → 0.49
    const d = await emitir(
      { emisor: EMISOR, cliente: CLIENTE, moneda: 'USD', tipoCambio: '24.655', lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '0.10', isv: 'EXENTO' }] },
      { almacen, establecimiento: '000', puntoEmision: '001' },
    );
    expect(filaLibroVentas(d)).toMatchObject({ importeExento: 2.47, total: 2.47, totalMonedaOriginal: 0.1 });
  });

  it('un texto con retorno de carro va entre comillas en el CSV', () => {
    const csv = libroVentasCSV([{
      fecha: '2026-11-19', tipoDocumento: 'Factura', numero: '000-001-01-00000001', cai: 'X', clienteNombre: 'a\r=1+1', clienteRTN: '',
      moneda: 'HNL', tipoCambio: null, totalMonedaOriginal: 1, importeExonerado: 0, importeExento: 1, importeGravado0: 0,
      importeGravado15: 0, importeGravado18: 0, isv15: 0, isv18: 0, total: 1, anulado: false,
    }]);
    expect(csv).toContain('"a\r=1+1"');
  });
});
