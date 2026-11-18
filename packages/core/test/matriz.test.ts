/**
 * Matriz de cumplimiento (docs/investigacion.md, sección 1): pruebas de las filas que no tienen un archivo
 * propio. Cada `describe` lleva el número de fila tal como aparece en la matriz.
 */
import { describe, expect, it } from 'vitest';
import * as api from '../src';
import {
  AlmacenFiscalMemoria,
  calcularDocumento,
  emitir,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  validarAutorizacion,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoEntrada,
} from '../src';
import { construirDocumento } from '../src/documento';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-06-30',
};
const EMISOR = {
  rtn: '08011999123456', razonSocial: 'Comercial Ejemplo S. de R.L.', nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Tocoa', direccionEstablecimiento: 'Colonia Aurora, Tocoa',
  telefono: '2444-0000', correo: 'ventas@ejemplo.hn',
};
const CLIENTE = { nombre: 'Ferretería Pérez', rtn: '08019005123456' };
const entrada = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: EMISOR,
  cliente: CLIENTE,
  lineas: [{ codigo: 'A-7', descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '100.00', descuento: '10.00' }],
  ...extra,
});
const doc = (extra: Partial<DocumentoEntrada> = {}, aut: AutorizacionCAI = AUT, n = 7) => construirDocumento(entrada(extra), aut, n);
const codigos = (e: DocumentoEntrada, aut: AutorizacionCAI = AUT) => validarEntrada(e, aut).errores.map((p) => p.codigo);
const AUT_NC: AutorizacionCAI = { ...AUT, tipoDocumento: '06' };
const AUT_ND: AutorizacionCAI = { ...AUT, tipoDocumento: '07' };
const nota = (tipo: '06' | '07', extra: Partial<DocumentoEntrada> = {}) => entrada({
  tipoDocumento: tipo, motivo: 'Devolución', referencia: { cai: AUT.cai, numero: '000-001-01-00000001', fecha: '2026-11-18' }, ...extra,
});

describe('Art. 9: en sistemas computarizados, un documento por venta (sin consolidación diaria)', () => {
  it('se emite documento aun por L 0.01 y a título gratuito (precio 0), sin exención de L 50', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, AUT);
    const caja = { almacen, establecimiento: '000', puntoEmision: '001' };
    const centavo = await emitir(entrada({ cliente: undefined, lineas: [{ descripcion: 'Dulce', cantidad: 1, precioUnitario: '0.01', isv: 'EXENTO' }] }), caja);
    const gratis = await emitir(entrada({ cliente: undefined, lineas: [{ descripcion: 'Muestra gratis', cantidad: 1, precioUnitario: '0' }] }), caja);
    expect([centavo.totales.total, gratis.totales.total]).toEqual([0.01, 0]);
    expect([centavo.correlativo, gratis.correlativo]).toEqual([1, 2]);
  });
  it('la API pública no ofrece consolidar ventas', () => {
    expect(Object.keys(api).filter((k) => /consolid|resumenDiario|ventasMenores/i.test(k))).toEqual([]);
  });
  it('cada emitir produce un documento con su propio número', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, AUT);
    const a = await emitir(entrada({ lineas: [{ descripcion: 'Dulce', cantidad: 1, precioUnitario: '2.00' }] }), { almacen, establecimiento: '000', puntoEmision: '001' });
    const b = await emitir(entrada({ lineas: [{ descripcion: 'Dulce', cantidad: 1, precioUnitario: '2.00' }] }), { almacen, establecimiento: '000', puntoEmision: '001' });
    expect([a.correlativo, b.correlativo]).toEqual([1, 2]);
  });
});

describe('Art. 10 num. 2-6: denominación, CAI, fecha límite, rango y destino impresos', () => {
  const d = doc();
  for (const [nombre, salida] of [['HTML', renderizarHTML(d)], ['texto', renderizarTexto(d, { ancho: 80 })]] as const) {
    it(nombre, () => {
      for (const t of [d.cai, d.rangoAutorizado, '30/06/2027', 'Original: Cliente / Copia: Emisor']) {
        expect(salida).toContain(t);
      }
      if (nombre === 'HTML') expect(salida).toMatch(/<h2>Factura<\/h2>/);
      else expect(salida).toMatch(/^\s+FACTURA$/m);
    });
  }
});

describe('Art. 10 num. 1: datos del emisor impresos', () => {
  it('nombre comercial, razón social, RTN, direcciones, teléfono y correo', () => {
    const t = renderizarTexto(doc());
    for (const v of ['Pulpería La Bendición', 'Comercial Ejemplo S. de R.L.', '0801-1999-123456', 'Colonia Aurora, Tocoa', 'Casa matriz: Barrio El Centro, Tocoa', '2444-0000', 'ventas@ejemplo.hn']) {
      expect(t).toContain(v);
    }
  });
});

describe('Art. 10 num. 7: número NNN-NNN-TT-NNNNNNNN; sin reinicio tras 99999999 (D-07)', () => {
  it('el número lleva establecimiento, punto, tipo y correlativo de 8 dígitos', () => {
    expect(doc({}, AUT, 7).numero).toBe('000-001-01-00000007');
  });
  it('un rango que pase de 99999999 se rechaza', () => {
    expect(validarAutorizacion({ ...AUT, rangoInicial: 99999990, rangoFinal: 100000005 }).map((p) => p.codigo)).toContain('RANGO');
    expect(validarAutorizacion({ ...AUT, rangoInicial: 99999990, rangoFinal: 99999999 })).toEqual([]);
  });
});

describe('Art. 10 num. 10 (Acuerdo 725-2018): «Descuentos y rebajas otorgados» siempre impreso', () => {
  it('se imprime aunque sea 0.00', () => {
    const sin = doc({ lineas: [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: '10.00' }] });
    expect(sin.totales.descuentos).toBe(0);
    expect(renderizarTexto(sin)).toMatch(/Descuentos y rebajas otorgados\s+L 0\.00/);
    expect(renderizarHTML(sin)).toContain('Descuentos y rebajas otorgados');
  });
});

describe('Art. 11 num. 1 a-f, j-l: datos para crédito fiscal', () => {
  const d = doc();
  const t = renderizarTexto(d);
  it('a-c: nombre y RTN del cliente, fecha', () => {
    expect(t).toContain('Cliente: Ferretería Pérez');
    expect(t).toContain('RTN: 0801-9005-123456');
    expect(t).toContain('Fecha: 18/11/2026');
  });
  it('d-f: descripción, cantidad y valor unitario', () => {
    expect(t).toContain('Arroz 5 lb');
    expect(t).toContain('2 x 100.00');
  });
  it('j: moneda en lempiras (L); k: total en números y letras; l: descuentos discriminados', () => {
    expect(t).toMatch(/TOTAL A PAGAR\s+L 218\.50/); // (200 − 10) × 1.15
    expect(d.totales.totalEnLetras).toBe('DOSCIENTOS DIECIOCHO LEMPIRAS CON 50/100');
    expect(t).toContain(d.totales.totalEnLetras);
    expect(t).toMatch(/Descuento\s+-10\.00/);
    expect(t).toMatch(/Descuentos y rebajas otorgados\s+L 10\.00/);
  });
});

describe('Art. 11 num. 1 h-i / 2 e-f: subtotales e impuestos impresos por tarifa', () => {
  const d = doc({ lineas: [
    { descripcion: 'Arroz', cantidad: 1, precioUnitario: '100.00' },
    { descripcion: 'Cerveza', cantidad: 1, precioUnitario: '50.00', isv: 'ISV18' },
    { descripcion: 'Frijoles', cantidad: 1, precioUnitario: '30.00', isv: 'EXENTO' },
    { descripcion: 'Exportación', cantidad: 1, precioUnitario: '20.00', isv: 'GRAVADO0' },
  ] });
  for (const [nombre, salida] of [['texto', renderizarTexto(d)], ['HTML', renderizarHTML(d)]] as const) {
    it(nombre, () => {
      // El monto aparece poco después de la etiqueta (misma línea en texto, celda vecina en HTML).
      const montoTras = (etq: string) => {
        const i = salida.indexOf(etq);
        expect(i, etq).toBeGreaterThanOrEqual(0);
        return salida.slice(i + etq.length, i + etq.length + 120).match(/\d[\d,]*\.\d\d/)?.[0];
      };
      expect(montoTras('Importe exento')).toBe('30.00');
      expect(montoTras('Importe gravado 0%')).toBe('20.00');
      expect(montoTras('Importe gravado 15%')).toBe('100.00');
      expect(montoTras('Importe gravado 18%')).toBe('50.00');
      expect(montoTras('I.S.V. 15%')).toBe('15.00');
      expect(montoTras('I.S.V. 18%')).toBe('9.00');
    });
  }
});

describe('Art. 11 num. 2 a: consumidor final', () => {
  it('sin cliente se imprime «CONSUMIDOR FINAL»', () => {
    const d = doc({ cliente: undefined });
    expect(d.cliente.nombreImpreso).toBe('CONSUMIDOR FINAL');
    expect(renderizarTexto(d)).toContain('CONSUMIDOR FINAL');
  });
  it('párrafo final: más de L 10,000 exige identificación (L 10,000.00 exactos no)', () => {
    const conTotal = (precio: string) => entrada({ cliente: undefined, preciosIncluyenISV: true, lineas: [{ descripcion: 'Refrigeradora', cantidad: 1, precioUnitario: precio, isv: 'EXENTO' }] });
    expect(codigos(conTotal('10000.01'))).toContain('CONSUMIDOR_FINAL_IDENTIFICACION');
    expect(codigos(conTotal('10000.00'))).not.toContain('CONSUMIDOR_FINAL_IDENTIFICACION');
  });
});

describe('Art. 11 (párrafo): moneda extranjera con tipo de cambio', () => {
  it('se exige y se imprime', () => {
    expect(codigos(entrada({ moneda: 'USD' }))).toContain('TIPO_CAMBIO');
    const d = doc({ moneda: 'USD', tipoCambio: 24.7 });
    expect(renderizarTexto(d)).toContain('Tipo de cambio: L 24.7');
  });
});

describe('Arts. 25-28: notas de crédito y débito', () => {
  it('25.2 / 27.2: denominación impresa; 25.5 / 27.5: códigos 06 y 07 en el número', () => {
    const nc = doc({ ...nota('06') }, AUT_NC, 1);
    const nd = doc({ ...nota('07') }, AUT_ND, 1);
    expect(renderizarTexto(nc)).toContain('NOTA DE CRÉDITO');
    expect(renderizarTexto(nd)).toContain('NOTA DE DÉBITO');
    expect(nc.numero).toBe('000-001-06-00000001');
    expect(nd.numero).toBe('000-001-07-00000001');
  });
  it('26.1-2 / 28.1-2: nombre y RTN del adquirente obligatorios', () => {
    expect(codigos(nota('06', { cliente: undefined }), AUT_NC)).toEqual(expect.arrayContaining(['CLIENTE_NOMBRE', 'NOTA_CLIENTE_RTN']));
    expect(codigos(nota('07', { cliente: { nombre: 'Sin RTN' } }), AUT_ND)).toContain('NOTA_CLIENTE_RTN');
    // Con RTN y sin nombre, el error de nombre sale una sola vez.
    expect(codigos(nota('06', { cliente: { nombre: '', rtn: '08019005123456' } }), AUT_NC)).toEqual(['CLIENTE_NOMBRE']);
  });
  it('25.1-7 / 27.1-7: formato de la nota (emisor, CAI, fecha límite, rango, destino)', () => {
    for (const [tipo, aut] of [['06', AUT_NC], ['07', AUT_ND]] as const) {
      const d = doc(nota(tipo), aut, 1);
      const t = renderizarTexto(d, { ancho: 80 });
      for (const v of ['Pulpería La Bendición', 'Comercial Ejemplo S. de R.L.', '0801-1999-123456', 'Colonia Aurora, Tocoa',
        'Casa matriz: Barrio El Centro, Tocoa', '2444-0000', 'ventas@ejemplo.hn', `CAI: ${aut.cai}`, '30/06/2027', d.rangoAutorizado,
        'Original: Cliente / Copia: Emisor']) expect(t).toContain(v);
    }
  });
  it('26.5-6, 26.8, 26.10 / 28.5-7, 28.9: importe en letras y números, impuestos por tarifa, fecha, unidades y descripción', () => {
    for (const [tipo, aut] of [['06', AUT_NC], ['07', AUT_ND]] as const) {
      const d = doc(nota(tipo), aut, 1);
      const t = renderizarTexto(d, { ancho: 80 });
      expect(t).toContain(d.totales.totalEnLetras);
      expect(t).toMatch(/TOTAL A PAGAR\s+L 218\.50/);
      expect(t).toMatch(/I\.S\.V\. 15%\s+L 28\.50/);
      expect(t).toContain('Fecha: 18/11/2026');
      expect(t).toContain('Arroz 5 lb');
      expect(t).toContain('2 x 100.00');
    }
  });
  it('26.3 / 28.3: CAI, número y fecha del documento que se modifica, impresos', () => {
    expect(codigos(nota('06', { referencia: undefined }), AUT_NC).some((c) => c.startsWith('REFERENCIA'))).toBe(true);
    const t = renderizarTexto(doc(nota('06'), AUT_NC, 1), { ancho: 80 });
    expect(t).toContain('Modifica: 000-001-01-00000001 (18/11/2026)');
    expect(t).toContain(`CAI ref.: ${AUT.cai}`);
  });
  it('26.4 / 28.4: motivo obligatorio e impreso', () => {
    expect(codigos(nota('06', { motivo: '' }), AUT_NC)).toContain('MOTIVO');
    expect(renderizarTexto(doc(nota('07'), AUT_ND, 1))).toContain('Motivo: Devolución');
  });
  it('26.7: espacio para nombre, identidad y firma de quien recibe la NC', () => {
    const t = renderizarTexto(doc(nota('06'), AUT_NC, 1));
    for (const c of ['Recibido por:', 'Nombre:', 'Identidad:', 'Firma:']) expect(t).toContain(c);
    expect(renderizarTexto(doc(nota('07'), AUT_ND, 1))).not.toContain('Firma:');
  });
  it('26.9 / 28.8: en moneda nacional', () => {
    expect(codigos(nota('06', { moneda: 'USD', tipoCambio: 24.7 }), AUT_NC)).toContain('NOTA_MONEDA');
  });
});

describe('Art. 62: vigencia máxima de un año', () => {
  it('aviso si la fecha límite pasa de un año desde la resolución', () => {
    const c = (fechaAutorizacion: string) => validarAutorizacion({ ...AUT, fechaAutorizacion }).map((p) => p.codigo);
    expect(c('2026-06-30')).toEqual([]); // exactamente un año
    expect(c('2026-06-29')).toEqual(['AVISO_VIGENCIA_MAYOR_1_ANIO']);
    expect(c('30/06/2026')).toEqual(['FECHA_AUTORIZACION']);
  });
  it('el aviso no impide registrar y queda en la bitácora', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, { ...AUT, fechaAutorizacion: '2026-01-02' });
    const [ev] = await almacen.transaccion((tx) => tx.eventos({ tipo: 'AUTORIZACION_REGISTRADA' }));
    expect(ev!.detalle.advertencias).toEqual(['AVISO_VIGENCIA_MAYOR_1_ANIO']);
  });
});

describe('Ley del ISV Art. 3: los descuentos no forman parte de la base gravable', () => {
  it('el ISV se calcula sobre el importe neto del descuento', () => {
    const c = calcularDocumento([{ descripcion: 'x', cantidad: 1, precioUnitario: '100.00', descuento: '20.00' }]);
    expect(c.totales.importeGravado15).toBe(80);
    expect(c.totales.isv15).toBe(12);
  });
});

describe('Ley del ISV Art. 9: el ISV se calcula por grupo de tasa, no por línea', () => {
  it('tres líneas de 0.03 al 15 %: ISV sobre 0.09 (0.01), no 3 × 0.00', () => {
    const c = calcularDocumento(Array.from({ length: 3 }, () => ({ descripcion: 'x', cantidad: 1, precioUnitario: '0.03' })));
    expect(c.totales.isv15).toBe(0.01);
  });
});
