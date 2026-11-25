/**
 * Reglas que las pruebas de mutación encontraron sin una prueba que fallara al romperlas. Cada prueba cita su
 * artículo.
 */
import { describe, expect, it } from 'vitest';
import { renderizarHTML, renderizarTexto, validarEntrada, type AutorizacionCAI, type DocumentoEntrada } from '../src';
import { construirDocumento } from '../src/documento';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2099-12-31',
};
const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Comercial Ejemplo S. de R.L.', nombreComercial: 'Tienda Ejemplo',
  direccionCasaMatriz: 'Barrio Centro, Tegucigalpa', direccionEstablecimiento: 'Colonia Palmira, local 7',
  telefono: '0000-0004', correo: 'ventas@ejemplo.example',
};
const base = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: EMISOR, lineas: [{ descripcion: 'Refrigeradora', cantidad: 1, precioUnitario: '20000.00' }], ...extra,
});
const codigos = (e: DocumentoEntrada) => validarEntrada(e, AUT).errores.map((p) => p.codigo);

describe('identificación del cliente (Art. 11)', () => {
  it('párrafo final: sobre el umbral, la identificación sin nombre no basta', () => {
    const sinNombre = base({ cliente: { identificacion: { tipo: 'DNI', numero: '9999000000001' } } });
    expect(codigos(sinNombre)).toContain('CONSUMIDOR_FINAL_IDENTIFICACION');
    const completo = base({ cliente: { nombre: 'Ana Ejemplo', identificacion: { tipo: 'DNI', numero: '9999000000001' } } });
    expect(codigos(completo)).not.toContain('CONSUMIDOR_FINAL_IDENTIFICACION');
  });

  it('num. 1 a: una factura con RTN del cliente exige su nombre o razón social', () => {
    expect(codigos(base({ cliente: { rtn: '99990000000002' } }))).toContain('CLIENTE_NOMBRE');
    expect(codigos(base({ cliente: { rtn: '99990000000002', nombre: 'Constructora Norte' } }))).not.toContain('CLIENTE_NOMBRE');
  });

  it('el DNI tiene 13 dígitos', () => {
    for (const numero of ['123', '08011999123', '99990000000011']) {
      expect(codigos(base({ cliente: { nombre: 'Ana', identificacion: { tipo: 'DNI', numero } } }))).toContain('CLIENTE_DNI');
    }
  });

  it('párrafo final: el tipo y número de identificación se imprimen en HTML y texto', () => {
    const doc = construirDocumento(base({ cliente: { nombre: 'Ana Ejemplo', identificacion: { tipo: 'DNI', numero: '9999000000001' } } }), AUT, 1);
    for (const salida of [renderizarHTML(doc), renderizarTexto(doc)]) {
      expect(salida).toContain('Ana Ejemplo');
      expect(salida).toMatch(/DNI: 9999-?0000-?00001/);
    }
  });
});

describe('datos impresos en el HTML', () => {
  const doc = construirDocumento(base({ cliente: { nombre: 'Ana Ejemplo', identificacion: { tipo: 'DNI', numero: '9999000000001' } } }), AUT, 1);
  const html = renderizarHTML(doc);

  it('Art. 10 num. 1 d-f: dirección del establecimiento, teléfono y correo del emisor', () => {
    expect(html).toContain('Colonia Palmira, local 7');
    expect(html).toContain('0000-0004');
    expect(html).toContain('ventas@ejemplo.example');
  });

  it('Art. 11 (párrafo): en moneda extranjera se imprime el tipo de cambio', () => {
    const usd = construirDocumento(base({ cliente: { nombre: 'Ana', rtn: '99990000000002' }, moneda: 'USD', tipoCambio: '24.70', lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1.00' }] }), AUT, 2);
    expect(renderizarHTML(usd)).toMatch(/Tipo de cambio: L 24\.7\d* por USD/);
    expect(renderizarTexto(usd)).toMatch(/24\.7/);
  });
});
