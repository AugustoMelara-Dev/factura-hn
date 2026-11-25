/**
 * Requisitos del documento: emisor, alícuota cero, crédito fiscal, exonerados y tipos no emitibles. Cada prueba
 * cita su artículo.
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  calcularDocumento,
  emitir,
  ErrorValidacion,
  filaLibroVentas,
  libroVentasCSV,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  resumenVentas,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoEntrada,
  type Emisor,
} from '../src';
import { construirDocumento } from '../src/documento';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
};
const EMISOR: Emisor = {
  rtn: '99990000000001', razonSocial: 'Inversiones Ejemplo S. de R.L.', nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001', correo: 'ventas@ejemplo.example',
};
const entrada = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: EMISOR,
  lineas: [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: '100' }],
  ...extra,
});
const codigos = (e: DocumentoEntrada, aut = AUT) => validarEntrada(e, aut).errores.map((p) => p.codigo);
const avisos = (e: DocumentoEntrada) => validarEntrada(e, AUT).advertencias.map((p) => p.codigo);

describe('datos completos del emisor (Art. 10 num. 1)', () => {
  const casos: Array<[keyof Emisor, string]> = [
    ['nombreComercial', 'EMISOR_NOMBRE_COMERCIAL'], // num. 1 c
    ['direccionEstablecimiento', 'EMISOR_DIRECCION_ESTABLECIMIENTO'], // num. 1 d
    ['direccionCasaMatriz', 'EMISOR_DIRECCION'], // num. 1 d
    ['telefono', 'EMISOR_TELEFONO'], // num. 1 e
    ['correo', 'EMISOR_CORREO'], // num. 1 f
    ['razonSocial', 'EMISOR_NOMBRE'], // num. 1 b
    ['rtn', 'EMISOR_RTN'], // num. 1 a
  ];
  for (const [campo, codigo] of casos) {
    it(`sin ${campo}: ${codigo}`, () => {
      expect(codigos(entrada({ emisor: { ...EMISOR, [campo]: ' ' } }))).toEqual([codigo]);
    });
  }
  it('correo con forma inválida: EMISOR_CORREO', () => {
    expect(codigos(entrada({ emisor: { ...EMISOR, correo: 'ventas-ejemplo.hn' } }))).toEqual(['EMISOR_CORREO']);
  });
  it('el emisor completo es válido y ya no hay aviso de contacto', () => {
    const v = validarEntrada(entrada(), AUT);
    expect(v.ok).toBe(true);
    expect(v.advertencias).toEqual([]);
  });
});

describe('gravado con alícuota cero (Arts. 11 num. 1 g y 12)', () => {
  const exportacion = entrada({
    cliente: { nombre: 'Importadora de Miami LLC', identificacion: { tipo: 'OTRO', numero: 'US-123' } },
    lineas: [
      { descripcion: 'Café oro, quintal', cantidad: 10, precioUnitario: '4500.00', isv: 'GRAVADO0' },
      { descripcion: 'Flete local (exento)', cantidad: 1, precioUnitario: '300.00', isv: 'EXENTO' },
    ],
  });

  it('ISV 0 y columna separada de lo exento y lo exonerado', () => {
    const { totales } = calcularDocumento(exportacion.lineas);
    expect(totales).toMatchObject({
      importeGravado0: 45_000, importeExento: 300, importeExonerado: 0,
      importeGravado15: 0, isv15: 0, isv18: 0, subtotal: 45_300, total: 45_300, baseCreditoFiscal: 0,
    });
  });

  it('el render lo discrimina cuando corresponde y no lo muestra si es cero', () => {
    const doc = construirDocumento(exportacion, AUT, 1);
    expect(renderizarHTML(doc)).toContain('Importe gravado 0%');
    expect(renderizarTexto(doc)).toContain('Importe gravado 0%');
    expect(renderizarHTML(construirDocumento(entrada(), AUT, 2))).not.toContain('gravado 0%');
  });

  it('el libro de ventas tiene la columna «Gravado 0%»', () => {
    const fila = filaLibroVentas(construirDocumento(exportacion, AUT, 1));
    expect(fila.importeGravado0).toBe(45_000);
    expect(resumenVentas([fila]).importeGravado0).toBe(45_000);
    expect(libroVentasCSV([fila])).toMatch(/Gravado 0%[\s\S]*,45000\.00,/);
  });

  it('GRAVADO0 no se convierte en exonerado cuando el adquirente está exonerado', () => {
    const { totales } = calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: '10', isv: 'GRAVADO0' }], { exonerado: true });
    expect(totales).toMatchObject({ importeGravado0: 10, importeExonerado: 0 });
  });
});

describe('base de crédito fiscal en ventas mixtas (Art. 11 num. 3)', () => {
  const mixta = (cliente: DocumentoEntrada['cliente']) =>
    entrada({
      cliente,
      lineas: [
        { descripcion: 'Clavos', cantidad: 1, precioUnitario: '100', isv: 'ISV15' },
        { descripcion: 'Cerveza', cantidad: 1, precioUnitario: '50', isv: 'ISV18' },
        { descripcion: 'Frijoles', cantidad: 1, precioUnitario: '30', isv: 'EXENTO' },
      ],
    });

  it('baseCreditoFiscal = gravado 15 % + gravado 18 %', () => {
    const { totales } = calcularDocumento(mixta(undefined).lineas);
    expect(totales.baseCreditoFiscal).toBe(150);
    expect(totales.subtotal).toBe(180);
  });

  it('aviso AVISO_VENTA_MIXTA si el comprador tiene RTN (crédito fiscal)', () => {
    const v = validarEntrada(mixta({ nombre: 'Ferretería Pérez', rtn: '99990000000002' }), AUT);
    expect(v.ok).toBe(true);
    expect(v.advertencias.map((p) => p.codigo)).toEqual(['AVISO_VENTA_MIXTA']);
    expect(v.advertencias[0]!.mensaje).toContain('L 150.00');
  });

  it('sin aviso para consumidor final o si todo es gravado', () => {
    expect(avisos(mixta(undefined))).toEqual([]);
    expect(avisos(entrada({ cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' } }))).toEqual([]);
  });
});

describe('adquirente exonerado: OCE + constancia, o registro SAG/RUPNSA (Art. 11 num. 4)', () => {
  const cliente = { nombre: 'Agroexportadora S.A.', rtn: '99990000000002' };
  it('camino 1: Orden de Compra Exenta y Constancia', () => {
    expect(codigos(entrada({ cliente, exoneracion: { ordenCompraExenta: 'OCE-1', constanciaRegistroExonerado: 'CRE-1' } }))).toEqual([]);
  });
  it('camino 2: solo el registro SAG/RUPNSA', () => {
    expect(codigos(entrada({ cliente, exoneracion: { registroSAG: 'RUPNSA-77' } }))).toEqual([]);
  });
  it('sin registro SAG faltan los dos documentos', () => {
    expect(codigos(entrada({ cliente, exoneracion: { ordenCompraExenta: 'OCE-1' } }))).toEqual(['EXONERACION_CONSTANCIA']);
    expect(codigos(entrada({ cliente, exoneracion: {} }))).toEqual(['EXONERACION_ORDEN', 'EXONERACION_CONSTANCIA']);
  });
  it('el render imprime el registro SAG/RUPNSA', () => {
    const html = renderizarHTML(construirDocumento(entrada({ cliente, exoneracion: { registroSAG: 'RUPNSA-77' } }), AUT, 1));
    expect(html).toContain('RUPNSA-77');
  });
  it('el texto térmico no imprime «undefined» cuando falta la OCE o la constancia', () => {
    const texto = renderizarTexto(construirDocumento(entrada({ cliente, exoneracion: { registroSAG: 'RUPNSA-77' } }), AUT, 1));
    expect(texto).toContain('Reg. SAG / RUPNSA: RUPNSA-77');
    expect(texto).toContain('OCE: -');
    expect(texto).not.toContain('undefined');
  });
});

describe('tipos que un sistema computarizado no puede emitir (Arts. 4 num. 43, 46 y 47)', () => {
  const casos: Array<[string, RegExp]> = [
    ['09', /máquinas registradoras \(Art\. 4 num\. 43\)/],
    ['04', /imprenta \(Art\. 46\)/],
    ['10', /imprenta \(Art\. 46\)/],
    ['12', /autoimpresor \(Art\. 47\)/],
  ];
  for (const [tipo, cita] of casos) {
    it(`${tipo}: validarEntrada, registrarAutorizacion y emitir lo rechazan citando la norma`, async () => {
      const e = entrada({ tipoDocumento: tipo as DocumentoEntrada['tipoDocumento'] });
      const v = validarEntrada(e, { ...AUT, tipoDocumento: tipo as AutorizacionCAI['tipoDocumento'] });
      expect(v.errores.map((p) => p.codigo)).toEqual(['TIPO_NO_EMITIBLE']);
      expect(v.errores[0]!.mensaje).toMatch(cita);

      const almacen = new AlmacenFiscalMemoria();
      await expect(registrarAutorizacion(almacen, { ...AUT, tipoDocumento: tipo as AutorizacionCAI['tipoDocumento'] }))
        .rejects.toMatchObject({ errores: [{ codigo: 'TIPO_NO_EMITIBLE' }] });
      await expect(emitir(e, { almacen, establecimiento: '000', puntoEmision: '001' }))
        .rejects.toMatchObject({ errores: [{ codigo: 'TIPO_NO_EMITIBLE' }] });
    });
  }
  it('05, 08 y 11 son emitibles por sistema pero esta versión aún no los soporta', () => {
    for (const tipo of ['05', '08', '11']) {
      const v = validarEntrada(entrada({ tipoDocumento: tipo as DocumentoEntrada['tipoDocumento'] }), { ...AUT, tipoDocumento: tipo as AutorizacionCAI['tipoDocumento'] });
      expect(v.errores.map((p) => p.codigo)).toEqual(['TIPO_NO_SOPORTADO']);
    }
  });
  it('emitir rechaza antes de tocar el almacén', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await expect(emitir(entrada({ tipoDocumento: '09' as DocumentoEntrada['tipoDocumento'] }), { almacen, establecimiento: '000', puntoEmision: '001' }))
      .rejects.toBeInstanceOf(ErrorValidacion);
    expect(await almacen.transaccion((tx) => tx.eventos())).toEqual([]);
  });
});
