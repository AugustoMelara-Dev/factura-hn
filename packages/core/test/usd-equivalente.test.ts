import { describe, expect, it } from 'vitest';
import { renderizarHTML, renderizarTexto } from '../src';
import { construirDocumento } from '../src/documento';
import type { AutorizacionCAI } from '../src/tipos';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
};
const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Exportadora Ejemplo S.A.', nombreComercial: 'Exportadora Ejemplo',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001', correo: 'ventas@ejemplo.example',
};

// Información para el adquirente, decisión del producto: ningún artículo revisado exige imprimir el equivalente.
// Se calcula con el tipo de cambio del documento (el que pide el Art. 11, párrafo final) y se guarda al emitir.
describe('documento en USD: el impreso muestra el equivalente en lempiras guardado al emitir', () => {
  // 200.00 al 15 % (ISV 30.00) y 10.00 al 18 % (ISV 1.80): total 241.80 USD.
  // Con L 24.6517 por USD: ISV 15 % L 739.55 (739.551), ISV 18 % L 44.37 (44.37306), total L 5,960.78 (5960.78106).
  const doc = construirDocumento(
    {
      emisor: EMISOR,
      cliente: { nombre: 'Importadora Ejemplo', rtn: '99990000000002' },
      moneda: 'USD',
      tipoCambio: '24.6517',
      lineas: [
        { descripcion: 'Servicio', cantidad: 2, precioUnitario: '100.00' },
        { descripcion: 'Licor', cantidad: 1, precioUnitario: '10.00', isv: 'ISV18' },
      ],
    },
    AUT,
    1,
  );

  it('los importes del documento siguen en dólares', () => {
    expect(doc.totales).toMatchObject({ isv15: 30, isv18: 1.8, total: 241.8 });
  });

  it('HTML: tipo de cambio y equivalente en lempiras de los impuestos y el total', () => {
    const html = renderizarHTML(doc);
    expect(html).toContain('Tipo de cambio: L 24.6517 por USD');
    expect(html).toContain('Equivalente en lempiras: I.S.V. 15% L 739.55 · I.S.V. 18% L 44.37 · Total L 5,960.78');
    expect(html).toContain('TOTAL A PAGAR</td><td class="num">$ 241.80');
  });

  it('texto: las mismas cifras', () => {
    const texto = renderizarTexto(doc);
    expect(texto).toContain('Equivalente en lempiras:');
    expect(texto).toMatch(/ {2}I\.S\.V\. 15% +L 739\.55\n/);
    expect(texto).toMatch(/ {2}I\.S\.V\. 18% +L 44\.37\n/);
    expect(texto).toMatch(/ {2}Total +L 5,960\.78\n/);
  });

  it('sin ISV, solo el total', () => {
    const exenta = construirDocumento(
      { emisor: EMISOR, cliente: { nombre: 'Importadora Ejemplo', rtn: '99990000000002' }, moneda: 'USD', tipoCambio: '24.5', lineas: [{ descripcion: 'Exportación', cantidad: 1, precioUnitario: '1000.00', isv: 'GRAVADO0' }] },
      AUT,
      2,
    );
    expect(renderizarHTML(exenta)).toContain('Equivalente en lempiras: Total L 24,500.00</div>');
    expect(renderizarTexto(exenta).split('Equivalente en lempiras:\n')[1]!.split('\n')[0]).toMatch(/^ {2}Total +L 24,500\.00$/);
  });
});
