import { describe, expect, it } from 'vitest';
import {
  calcularDocumento,
  enteroALetras,
  ErrorValidacion,
  esCAIValido,
  esRTNValido,
  estadoAutorizacion,
  filaLibroVentas,
  formatearNumero,
  formatearRango,
  libroVentasCSV,
  montoEnLetras,
  parsearNumero,
  perteneceAAutorizacion,
  renderizarHTML,
  renderizarTexto,
  resumenVentas,
  validarEntrada,
  TIPOS_DOCUMENTO,
  type AutorizacionCAI,
  type DocumentoEntrada,
} from '../src';
import { construirDocumento } from '../src/documento';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: 1,
  rangoInicial: 1,
  rangoFinal: 3,
  fechaLimiteEmision: '2027-06-30',
};

const EMISOR = {
  rtn: '0801-1999-123456',
  razonSocial: 'Comercial Ejemplo S. de R.L.',
  nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Tocoa, Colón',
  telefono: '2444-0000',
  correo: 'ventas@ejemplo.hn',
};

const base = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: EMISOR,
  fechaEmision: '2026-11-18',
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: 100 }],
  ...extra,
});

describe('numeración', () => {
  it('usa la tabla de códigos vigente (Acuerdo 609-2017)', () => {
    expect(TIPOS_DOCUMENTO['06']).toBe('Nota de Crédito');
    expect(TIPOS_DOCUMENTO['07']).toBe('Nota de Débito');
    expect(TIPOS_DOCUMENTO['05']).toBe('Comprobante de Retención');
    expect(() => parsearNumero('000-001-02-00000001')).toThrow();
  });
  it('formatea y parsea 16 dígitos', () => {
    expect(formatearNumero({ establecimiento: 0, puntoEmision: 1, tipoDocumento: '01', correlativo: 25 })).toBe('000-001-01-00000025');
    expect(parsearNumero('0000010100000025')).toEqual({ establecimiento: '000', puntoEmision: '001', tipoDocumento: '01', correlativo: 25 });
  });
  it('rechaza formatos inválidos', () => {
    expect(() => parsearNumero('000-001-01-0000002')).toThrow();
    expect(() => parsearNumero('000-001-99-00000002')).toThrow();
    expect(() => parsearNumero('000-001-03-00000002')).toThrow();
    expect(() => formatearNumero({ establecimiento: 1000, puntoEmision: 1, tipoDocumento: '01', correlativo: 1 })).toThrow();
    expect(() => formatearNumero({ establecimiento: 0, puntoEmision: 1, tipoDocumento: '01', correlativo: 0 })).toThrow();
  });
  it('rango y pertenencia', () => {
    expect(formatearRango(AUT)).toBe('000-001-01-00000001 al 000-001-01-00000003');
    expect(perteneceAAutorizacion('000-001-01-00000003', AUT)).toBe(true);
    expect(perteneceAAutorizacion('000-001-01-00000004', AUT)).toBe(false);
    expect(perteneceAAutorizacion('000-002-01-00000001', AUT)).toBe(false);
  });
});

describe('identificación', () => {
  it('RTN y CAI', () => {
    expect(esRTNValido('0801-1999-123456')).toBe(true);
    expect(esRTNValido('0801199912345')).toBe(false);
    expect(esCAIValido(AUT.cai)).toBe(true);
    expect(esCAIValido('a1b2c3-d4e5f6-a1b2c3-d4e5f6-a1b2c3-d4')).toBe(true);
    expect(esCAIValido('XYZ')).toBe(false);
  });
});

describe('montos en letras', () => {
  it.each([
    [0, 'CERO LEMPIRAS CON 00/100'],
    [1, 'UN LEMPIRA CON 00/100'],
    [21, 'VEINTIÚN LEMPIRAS CON 00/100'],
    [100, 'CIEN LEMPIRAS CON 00/100'],
    [101.5, 'CIENTO UN LEMPIRAS CON 50/100'],
    [1000, 'MIL LEMPIRAS CON 00/100'],
    [1234.56, 'MIL DOSCIENTOS TREINTA Y CUATRO LEMPIRAS CON 56/100'],
    [21000, 'VEINTIÚN MIL LEMPIRAS CON 00/100'],
    [31001, 'TREINTA Y UN MIL UN LEMPIRAS CON 00/100'],
    [100000, 'CIEN MIL LEMPIRAS CON 00/100'],
    [1000000, 'UN MILLÓN DE LEMPIRAS CON 00/100'],
    [2500000.1, 'DOS MILLONES QUINIENTOS MIL LEMPIRAS CON 10/100'],
  ])('%s', (n, esperado) => {
    expect(montoEnLetras(n)).toBe(esperado);
  });
  it('dólares', () => {
    expect(montoEnLetras(1, 'USD')).toBe('UN DÓLAR CON 00/100');
  });
  it('enteros grandes', () => {
    expect(enteroALetras(999_999_999)).toBe(
      'NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE',
    );
  });
});

describe('cálculo', () => {
  it('precios sin ISV, tasas mixtas y descuento', () => {
    const { totales } = calcularDocumento([
      { descripcion: 'Arroz', cantidad: 2, precioUnitario: 100, descuento: 20 }, // 180 gravado 15
      { descripcion: 'Cerveza', cantidad: 1, precioUnitario: 50, isv: 'ISV18' }, // 50 gravado 18
      { descripcion: 'Medicamento', cantidad: 1, precioUnitario: 75.5, isv: 'EXENTO' },
    ]);
    expect(totales).toMatchObject({
      descuentos: 20,
      importeGravado15: 180,
      importeGravado18: 50,
      importeExento: 75.5,
      isv15: 27,
      isv18: 9,
      subtotal: 305.5,
      total: 341.5,
    });
  });
  it('precios con ISV: el total es lo cobrado', () => {
    const { totales } = calcularDocumento(
      [
        { descripcion: 'Refresco', cantidad: 3, precioUnitario: 19.99 }, // 59.97
        { descripcion: 'Galletas', cantidad: 1, precioUnitario: 12.5 }, // 12.50
      ],
      { preciosIncluyenISV: true },
    );
    expect(totales.total).toBe(72.47);
    expect(totales.importeGravado15).toBe(63.02);
    expect(totales.isv15).toBe(9.45);
    expect(totales.importeGravado15 + totales.isv15).toBeCloseTo(72.47, 10);
  });
  it('exonerado: sin ISV y todo en importe exonerado', () => {
    const { totales } = calcularDocumento([{ descripcion: 'Cemento', cantidad: 10, precioUnitario: 230 }], { exonerado: true });
    expect(totales).toMatchObject({ importeExonerado: 2300, isv15: 0, total: 2300 });
  });
  it('cantidades decimales y redondeo', () => {
    const { totales } = calcularDocumento([{ descripcion: 'Queso', cantidad: 1.5, precioUnitario: 33.33 }]);
    expect(totales.importeGravado15).toBe(50); // 49.995 → 50.00
    expect(totales.isv15).toBe(7.5);
  });
  it('rechaza líneas inválidas', () => {
    expect(() => calcularDocumento([])).toThrow();
    expect(() => calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: 10, descuento: 11 }])).toThrow();
  });
});

describe('validación', () => {
  it('documento válido', () => {
    const v = validarEntrada(base(), AUT);
    expect(v.errores).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it('autorización vencida', () => {
    const reloj = () => new Date('2027-07-01T12:00:00-06:00');
    const v = validarEntrada(base({ fechaEmision: undefined }), AUT, { reloj });
    expect(v.errores.map((e) => e.codigo)).toEqual(['AUTORIZACION_VENCIDA']);
  });
  it('consumidor final sobre el umbral requiere identificación', () => {
    const grande = base({ lineas: [{ descripcion: 'Laptop', cantidad: 1, precioUnitario: 20000 }] });
    expect(validarEntrada(grande, AUT).errores.map((e) => e.codigo)).toContain('CONSUMIDOR_FINAL_IDENTIFICACION');
    const conId = { ...grande, cliente: { nombre: 'Juan Pérez', identificacion: { tipo: 'DNI' as const, numero: '0801199912345' } } };
    expect(validarEntrada(conId, AUT).ok).toBe(true);
  });
  it('RTN de cliente inválido', () => {
    const v = validarEntrada(base({ cliente: { nombre: 'X', rtn: '123' } }), AUT);
    expect(v.errores.map((e) => e.codigo)).toContain('CLIENTE_RTN');
  });
  it('tipo de autorización distinto al documento', () => {
    const v = validarEntrada(base({ tipoDocumento: '07' }), AUT);
    expect(v.errores.map((e) => e.codigo)).toContain('AUTORIZACION_TIPO');
  });
  it('nota de crédito exige referencia y motivo', () => {
    const autNC = { ...AUT, tipoDocumento: '06' as const };
    const v = validarEntrada(base({ tipoDocumento: '06', cliente: { nombre: 'Cliente' } }), autNC);
    expect(v.errores.map((e) => e.codigo)).toEqual(expect.arrayContaining(['REFERENCIA', 'MOTIVO', 'NOTA_CLIENTE_RTN']));
  });
  it('notas solo en lempiras', () => {
    const autND = { ...AUT, tipoDocumento: '07' as const };
    const v = validarEntrada(
      base({ tipoDocumento: '07', moneda: 'USD', tipoCambio: 24.7, cliente: { nombre: 'X', rtn: '08019005123456' },
        referencia: { cai: AUT.cai, numero: '000-001-01-00000001', fecha: '2026-11-01' }, motivo: 'Flete' }),
      autND,
    );
    expect(v.errores.map((e) => e.codigo)).toEqual(['NOTA_MONEDA']);
  });
  it('CAI con formato extraño es advertencia, no error', () => {
    const v = validarEntrada(base(), { ...AUT, cai: 'RARO-123' });
    expect(v.ok).toBe(true);
    expect(v.advertencias.map((a) => a.codigo)).toContain('CAI_FORMATO_ADVERTENCIA');
    expect(validarEntrada(base(), { ...AUT, cai: 'RARO-123' }, { caiEstricto: true }).ok).toBe(false);
  });
  it('moneda extranjera exige tipo de cambio', () => {
    expect(validarEntrada(base({ moneda: 'USD' }), AUT).errores.map((e) => e.codigo)).toContain('TIPO_CAMBIO');
  });
});

describe('construcción del documento', () => {
  it('construirDocumento rechaza correlativo fuera de rango', () => {
    expect(() => construirDocumento(base(), AUT, 4)).toThrow(ErrorValidacion);
  });
  it('documento completo', () => {
    const doc = construirDocumento(base(), AUT, 1);
    expect(doc).toMatchObject({
      nombreDocumento: 'Factura',
      numero: '000-001-01-00000001',
      rangoAutorizado: '000-001-01-00000001 al 000-001-01-00000003',
      cliente: { nombreImpreso: 'CONSUMIDOR FINAL' },
      totales: { total: 230, totalEnLetras: 'DOSCIENTOS TREINTA LEMPIRAS CON 00/100' },
      destinoEjemplares: 'Original: Cliente / Copia: Emisor',
    });
    expect(doc.emisor.rtn).toBe('08011999123456');
  });
});

describe('estado de la autorización', () => {
  it('avisa por vencimiento y consumo', () => {
    const e = estadoAutorizacion({ ...AUT, rangoFinal: 100 }, 95, { hoy: '2027-06-15' });
    expect(e.vigente).toBe(true);
    expect(e.correlativosRestantes).toBe(5);
    expect(e.siguienteCorrelativo).toBe(96);
    expect(e.alertas.map((a) => a.codigo)).toEqual(['AVISO_VENCIMIENTO', 'AVISO_RANGO']);
  });
  it('agotada y vencida', () => {
    const e = estadoAutorizacion(AUT, 3, { hoy: '2027-07-01' });
    expect(e.vigente).toBe(false);
    expect(e.siguienteCorrelativo).toBeNull();
    expect(e.alertas.map((a) => a.codigo)).toEqual(['AUTORIZACION_VENCIDA', 'RANGO_AGOTADO']);
  });
});

describe('render y reportes', () => {
  const doc = construirDocumento(
    base({
      cliente: { nombre: 'Ferretería <Script> & Hijos', rtn: '08019005123456' },
      lineas: [
        { codigo: 'A-1', descripcion: 'Clavos', cantidad: 2, precioUnitario: 50, descuento: 10 },
        { descripcion: 'Libro', cantidad: 1, precioUnitario: 300, isv: 'EXENTO' },
      ],
    }),
    AUT,
    2,
  );
  it('HTML con campos obligatorios y escapado', () => {
    const html = renderizarHTML(doc);
    for (const t of ['Factura', doc.numero, doc.cai, doc.rangoAutorizado, '30/06/2027', '0801-1999-123456', 'Importe exento', 'I.S.V. 15%', doc.totales.totalEnLetras, 'Original: Cliente / Copia: Emisor']) {
      expect(html).toContain(t);
    }
    expect(html).toContain('Ferretería &lt;Script&gt; &amp; Hijos');
    expect(html).not.toContain('<Script>');
    expect(renderizarHTML(doc, { formato: 'ticket' })).toContain('80mm');
    expect(html).not.toContain('exíjala');
    expect(renderizarHTML(doc, { leyenda: 'La factura es beneficio de todos, exíjala.' })).toContain('exíjala');
  });
  it('texto térmico respeta el ancho', () => {
    const txt = renderizarTexto(doc, { ancho: 32 });
    expect(txt.split('\n').every((l) => l.length <= 32)).toBe(true);
    expect(txt).toContain('TOTAL A PAGAR');
  });
  it('libro de ventas: NC resta y anulados en cero', () => {
    const autNC = { ...AUT, tipoDocumento: '06' as const };
    const nc = construirDocumento(
      base({
        tipoDocumento: '06',
        cliente: { nombre: 'Ferretería', rtn: '08019005123456' },
        referencia: { cai: AUT.cai, numero: doc.numero, fecha: '2026-11-18' },
        motivo: 'Devolución de clavos',
        lineas: [{ descripcion: 'Clavos', cantidad: 1, precioUnitario: 50 }],
      }),
      autNC,
      1,
    );
    const filas = [filaLibroVentas(doc), filaLibroVentas(nc), filaLibroVentas(doc, { anulado: true })];
    const r = resumenVentas(filas);
    expect(r.documentos).toBe(3);
    expect(r.importeGravado15).toBe(90 - 50);
    expect(r.isv15).toBe(13.5 - 7.5);
    expect(libroVentasCSV(filas)).toContain('Nota de Crédito');
    expect(nc.numero).toBe('000-001-06-00000001');
    expect(renderizarHTML(nc)).toContain('Recibido por');
  });
});
