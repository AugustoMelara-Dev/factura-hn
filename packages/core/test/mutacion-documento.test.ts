// Pruebas que matan mutantes de documento.ts (pnpm mutacion, docs/calidad/mutacion.md).
// Cada validación de la entrada con su código, mensaje y campo; la conversión de notas en moneda extranjera
// (Arts. 26 num. 9 y 28 num. 8); los textos con caracteres no permitidos; y lo que construirDocumento copia.
import { describe, expect, it } from 'vitest';
import {
  COMPROBANTES_FISCALES,
  construirDocumento,
  ErrorValidacion,
  esErrorValidacion,
  hoyHonduras,
  notaEnLempiras,
  problemaDeOperador,
  problemaDeTipo,
  problemasDeTexto,
  validarEmisor,
  validarEntrada,
} from '../src/documento';
import type { AutorizacionCAI, DocumentoEntrada, Emisor, OpcionesDocumento, Problema } from '../src/tipos';

const CAI = 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4';
const HOY = '2026-11-18';
const AUT: AutorizacionCAI = {
  cai: CAI,
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 100,
  fechaLimiteEmision: '2027-06-30',
};
const AUT_NC: AutorizacionCAI = { ...AUT, tipoDocumento: '06' };
const EMISOR: Emisor = {
  rtn: '99990000000001',
  razonSocial: 'Comercial Ejemplo S. de R.L.',
  nombreComercial: 'Pulpería Ejemplo',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};
const CLIENTE_RTN = { nombre: 'Cliente Ejemplo', rtn: '99990000000002' };
const REF = { cai: CAI, numero: '000-001-01-00000001', fecha: '2026-11-10' };

const entrada = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: EMISOR,
  lineas: [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: 100 }],
  ...extra,
});
const nota = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada =>
  entrada({ tipoDocumento: '06', referencia: REF, motivo: 'Devolución', cliente: CLIENTE_RTN, ...extra });

/** Código, mensaje y campo de cada error y aviso. */
const corto = (ps: Problema[]) => ps.map(({ codigo, mensaje, campo }) => ({ codigo, mensaje, campo }));
const errores = (e: DocumentoEntrada, a: AutorizacionCAI = AUT, o: OpcionesDocumento = {}) => corto(validarEntrada(e, a, o).errores);
const avisos = (e: DocumentoEntrada, a: AutorizacionCAI = AUT, o: OpcionesDocumento = {}) => corto(validarEntrada(e, a, o).advertencias);
const codigos = (e: DocumentoEntrada, a: AutorizacionCAI = AUT, o: OpcionesDocumento = {}) => errores(e, a, o).map((p) => p.codigo);

describe('punto de partida', () => {
  it('la entrada base es válida, sin avisos', () => {
    expect(validarEntrada(entrada(), AUT)).toEqual({ ok: true, errores: [], advertencias: [] });
    expect(validarEntrada(nota(), AUT_NC)).toEqual({ ok: true, errores: [], advertencias: [] });
  });
  it('ok es false si hay un error; los avisos no lo cambian y no se mezclan con los errores', () => {
    const r = validarEntrada(entrada({ exoneracion: { registroSAG: 'SAG-1' }, motivo: 'x' }), AUT);
    expect(r.ok).toBe(true);
    expect(r.advertencias.map((p) => p.codigo)).toEqual(['AVISO_EXONERADO_RTN']);
    const malo = validarEntrada(entrada({ exoneracion: { registroSAG: 'SAG-1' }, lineas: [] }), AUT);
    expect(malo.ok).toBe(false);
    expect(malo.errores.map((p) => p.codigo)).toEqual(['SIN_LINEAS']);
    expect(malo.advertencias.map((p) => p.codigo)).toEqual(['AVISO_EXONERADO_RTN']);
  });
  it('hoyHonduras usa el reloj de las opciones, y sin reloj la fecha actual', () => {
    expect(hoyHonduras({ reloj: () => new Date('2026-12-01T05:59:00Z') })).toBe('2026-11-30');
    expect(hoyHonduras()).toBe(HOY);
  });
});

describe('tipos de documento', () => {
  it('Comprobantes Fiscales del Art. 6', () => {
    expect(COMPROBANTES_FISCALES).toEqual(['01', '10', '09', '04', '11', '12']);
  });
  it('no emitibles por sistema, no soportados y soportados', () => {
    expect(problemaDeTipo('09')).toEqual({
      codigo: 'TIPO_NO_EMITIBLE',
      mensaje: 'Un sistema computarizado no puede emitir el tipo 09: el Ticket se emite exclusivamente por máquinas registradoras (Art. 4 num. 43).',
      campo: 'tipoDocumento',
    });
    expect(problemaDeTipo('05')).toEqual({
      codigo: 'TIPO_NO_SOPORTADO',
      mensaje: 'Tipo de documento 05 no soportado en esta versión (01, 06, 07).',
      campo: 'tipoDocumento',
    });
    for (const t of ['01', '06', '07']) expect(problemaDeTipo(t)).toBeNull();
  });
  it('la autorización debe ser del mismo tipo que el documento', () => {
    expect(errores(entrada(), AUT_NC).filter((p) => p.codigo === 'AUTORIZACION_TIPO')).toEqual([
      { codigo: 'AUTORIZACION_TIPO', mensaje: 'La autorización es para Nota de Crédito, pero el documento es Factura.', campo: 'tipoDocumento' },
    ]);
    const desconocida = { ...AUT, tipoDocumento: '02' as never };
    expect(errores(entrada(), desconocida).find((p) => p.codigo === 'AUTORIZACION_TIPO')!.mensaje).toBe(
      'La autorización es para 02, pero el documento es Factura.',
    );
    expect(errores(entrada({ tipoDocumento: '99' as never }), AUT).find((p) => p.codigo === 'AUTORIZACION_TIPO')!.mensaje).toBe(
      'La autorización es para Factura, pero el documento es 99.',
    );
  });
});

describe('fecha de emisión (Arts. 14 y 43)', () => {
  it('formato, la de hoy y dentro de la vigencia', () => {
    expect(errores(entrada({ fechaEmision: '18/11/2026' }))).toEqual([
      { codigo: 'FECHA_EMISION', mensaje: 'fechaEmision debe ser YYYY-MM-DD.', campo: 'fechaEmision' },
    ]);
    expect(errores(entrada({ fechaEmision: '2026-11-17' }))).toEqual([
      {
        codigo: 'FECHA_EMISION_NO_ES_HOY',
        mensaje: 'La fecha de emisión (2026-11-17) debe ser la de hoy en Honduras (2026-11-18). No se puede retrofechar ni adelantar (Arts. 14 y 43).',
        campo: 'fechaEmision',
      },
    ]);
    expect(errores(entrada(), { ...AUT, fechaLimiteEmision: '2026-11-17' })).toEqual([
      { codigo: 'AUTORIZACION_VENCIDA', mensaje: 'La fecha de emisión 2026-11-18 es posterior a la fecha límite 2026-11-17.', campo: 'fechaEmision' },
    ]);
    expect(errores(entrada(), { ...AUT, fechaLimiteEmision: HOY })).toEqual([]);
  });
});

describe('emisor (Art. 10 num. 1)', () => {
  it('sin emisor', () => {
    expect(corto(validarEmisor(undefined))).toEqual([{ codigo: 'EMISOR', mensaje: 'Faltan los datos del emisor.', campo: 'emisor' }]);
  });
  it('cada dato que falta, aunque no venga el campo', () => {
    expect(corto(validarEmisor({} as Emisor))).toEqual([
      { codigo: 'EMISOR_RTN', mensaje: 'RTN del emisor inválido (14 dígitos).', campo: 'emisor.rtn' },
      { codigo: 'EMISOR_NOMBRE', mensaje: 'Falta el nombre o razón social del emisor.', campo: 'emisor.razonSocial' },
      {
        codigo: 'EMISOR_NOMBRE_COMERCIAL',
        mensaje: 'Falta el nombre comercial del emisor (Art. 10 num. 1 c). Si no tiene uno distinto, repite la razón social.',
        campo: 'emisor.nombreComercial',
      },
      { codigo: 'EMISOR_DIRECCION', mensaje: 'Falta la dirección de casa matriz (Art. 10 num. 1 d).', campo: 'emisor.direccionCasaMatriz' },
      {
        codigo: 'EMISOR_DIRECCION_ESTABLECIMIENTO',
        mensaje: 'Falta la dirección del establecimiento donde está el punto de emisión (Art. 10 num. 1 d).',
        campo: 'emisor.direccionEstablecimiento',
      },
      { codigo: 'EMISOR_TELEFONO', mensaje: 'Falta el número telefónico del emisor (Art. 10 num. 1 e).', campo: 'emisor.telefono' },
      { codigo: 'EMISOR_CORREO', mensaje: 'Falta el correo electrónico del emisor (Art. 10 num. 1 f).', campo: 'emisor.correo' },
    ]);
  });
  it('los datos con solo espacios cuentan como faltantes', () => {
    const vacio = { rtn: '99990000000001', razonSocial: ' ', nombreComercial: ' ', direccionCasaMatriz: ' ', direccionEstablecimiento: ' ', telefono: ' ', correo: ' ' };
    expect(validarEmisor(vacio).map((p) => p.codigo)).toEqual([
      'EMISOR_NOMBRE',
      'EMISOR_NOMBRE_COMERCIAL',
      'EMISOR_DIRECCION',
      'EMISOR_DIRECCION_ESTABLECIMIENTO',
      'EMISOR_TELEFONO',
      'EMISOR_CORREO',
    ]);
    expect(validarEmisor(vacio).at(-1)!.mensaje).toBe('Falta el correo electrónico del emisor (Art. 10 num. 1 f).');
  });
  it('correo: se recorta, una sola @ y un punto en el dominio, sin nada antes ni después', () => {
    expect(validarEmisor({ ...EMISOR, correo: '  ventas@ejemplo.example  ' })).toEqual([]);
    for (const malo of ['x', 'x@a@b.example', 'a@b.example@x', 'a b@c.example']) {
      expect(corto(validarEmisor({ ...EMISOR, correo: malo }))).toEqual([
        { codigo: 'EMISOR_CORREO', mensaje: `El correo del emisor no parece válido: "${malo}".`, campo: 'emisor.correo' },
      ]);
    }
  });
});

describe('cliente', () => {
  it('RTN vacío es como no tenerlo; uno mal escrito es error', () => {
    expect(errores(entrada({ cliente: { rtn: '' } }))).toEqual([]);
    expect(errores(entrada({ cliente: { nombre: 'X', rtn: '123' } }))).toEqual([
      { codigo: 'CLIENTE_RTN', mensaje: 'RTN del cliente inválido (14 dígitos).', campo: 'cliente.rtn' },
    ]);
  });
  it('con RTN se pide el nombre (solo espacios no cuenta)', () => {
    expect(errores(entrada({ cliente: { rtn: '99990000000002', nombre: '  ' } }))).toEqual([
      { codigo: 'CLIENTE_NOMBRE', mensaje: 'Si el cliente tiene RTN, se requiere su nombre o razón social.', campo: 'cliente.nombre' },
    ]);
  });
  it('identificación: número obligatorio y DNI o RTN con su forma', () => {
    expect(errores(entrada({ cliente: { identificacion: { tipo: 'DNI', numero: '  ' } } }))).toEqual([
      { codigo: 'CLIENTE_IDENTIFICACION', mensaje: 'Falta el número de identificación del cliente.', campo: 'cliente.identificacion' },
    ]);
    expect(codigos(entrada({ cliente: { identificacion: { tipo: 'DNI', numero: undefined as never } } }))).toEqual(['CLIENTE_IDENTIFICACION']);
    expect(errores(entrada({ cliente: { identificacion: { tipo: 'DNI', numero: '123' } } }))).toEqual([
      { codigo: 'CLIENTE_DNI', mensaje: 'DNI del cliente inválido (13 dígitos).', campo: 'cliente.identificacion' },
    ]);
    expect(errores(entrada({ cliente: { identificacion: { tipo: 'RTN', numero: '123' } } }))).toEqual([
      { codigo: 'CLIENTE_RTN', mensaje: 'RTN del cliente inválido (14 dígitos).', campo: 'cliente.identificacion' },
    ]);
    expect(errores(entrada({ cliente: { identificacion: { tipo: 'RTN', numero: '99990000000002' } } }))).toEqual([]);
    expect(errores(entrada({ cliente: { identificacion: { tipo: 'DNI', numero: '9999000000001' } } }))).toEqual([]);
    expect(errores(entrada({ cliente: { identificacion: { tipo: 'PASAPORTE', numero: 'X1' } } }))).toEqual([]);
  });
});

describe('exoneración (Art. 11 num. 4)', () => {
  const falta = ' (Art. 11 num. 4: Orden de Compra Exenta y Constancia, o el registro SAG/RUPNSA).';
  it('sin registro SAG hacen falta la orden y la constancia (solo espacios no cuenta)', () => {
    expect(errores(entrada({ cliente: CLIENTE_RTN, exoneracion: { registroSAG: ' ', ordenCompraExenta: ' ' } }))).toEqual([
      { codigo: 'EXONERACION_ORDEN', mensaje: `Falta el número de Orden de Compra Exenta${falta}`, campo: 'exoneracion.ordenCompraExenta' },
      {
        codigo: 'EXONERACION_CONSTANCIA',
        mensaje: `Falta el número de Constancia de Registro de Exonerados${falta}`,
        campo: 'exoneracion.constanciaRegistroExonerado',
      },
    ]);
    expect(codigos(entrada({ cliente: CLIENTE_RTN, exoneracion: { ordenCompraExenta: 'OCE-1', constanciaRegistroExonerado: '  ' } }))).toEqual([
      'EXONERACION_CONSTANCIA',
    ]);
    expect(errores(entrada({ cliente: CLIENTE_RTN, exoneracion: { ordenCompraExenta: 'OCE-1', constanciaRegistroExonerado: 'CRE-1' } }))).toEqual([]);
    expect(errores(entrada({ cliente: CLIENTE_RTN, exoneracion: { registroSAG: 'SAG-1' } }))).toEqual([]);
  });
  it('aviso si el exonerado no tiene RTN', () => {
    expect(avisos(entrada({ exoneracion: { registroSAG: 'SAG-1' } }))).toEqual([
      { codigo: 'AVISO_EXONERADO_RTN', mensaje: 'Un adquirente exonerado normalmente se identifica con RTN.', campo: 'cliente.rtn' },
    ]);
    expect(avisos(entrada({ cliente: CLIENTE_RTN, exoneracion: { registroSAG: 'SAG-1' } }))).toEqual([]);
  });
});

describe('moneda y tipo de cambio', () => {
  const sinTipoCambio = [
    {
      codigo: 'TIPO_CAMBIO',
      mensaje: 'En moneda extranjera se debe indicar el tipo de cambio de la fecha de emisión (mayor que 0, hasta 6 decimales).',
      campo: 'tipoCambio',
    },
  ];
  it('en dólares el tipo de cambio es obligatorio, mayor que 0 y con hasta 6 decimales', () => {
    for (const tc of [undefined, null, '', '0', '-1', 'abc', '24.1234567']) {
      expect(errores(entrada({ moneda: 'USD', tipoCambio: tc as never }))).toEqual(sinTipoCambio);
    }
    expect(errores(entrada({ moneda: 'USD', tipoCambio: '24.123456' }))).toEqual([]);
  });
  it('en lempiras se ignora un tipo de cambio que venga', () => {
    const grande = entrada({ lineas: [{ descripcion: 'Equipo', cantidad: 1, precioUnitario: '8000' }], tipoCambio: '1000' });
    expect(errores(grande)).toEqual([]);
  });
});

describe('consumidor final (Art. 11): umbral de identificación', () => {
  const grande = (cliente?: DocumentoEntrada['cliente'], extra: Partial<DocumentoEntrada> = {}) =>
    entrada({ lineas: [{ descripcion: 'Equipo', cantidad: 1, precioUnitario: '9000' }], cliente, ...extra });
  const identificacion = [
    {
      codigo: 'CONSUMIDOR_FINAL_IDENTIFICACION',
      mensaje: 'Ventas a consumidor final mayores de L 10,000.00 requieren nombre e identificación del cliente (Art. 11).',
      campo: 'cliente',
    },
  ];
  it('sobre el umbral pide nombre e identificación, o RTN', () => {
    expect(errores(grande())).toEqual(identificacion);
    expect(errores(grande({ nombre: '  ', identificacion: { tipo: 'DNI', numero: '9999000000001' } }))).toEqual(identificacion);
    expect(errores(grande({ nombre: 'Ana', identificacion: { tipo: 'PASAPORTE', numero: 'X1' } }))).toEqual([]);
    expect(codigos(grande({ nombre: 'Ana', identificacion: { tipo: 'PASAPORTE', numero: undefined as never } }))).toEqual([
      'CLIENTE_IDENTIFICACION',
      'CONSUMIDOR_FINAL_IDENTIFICACION',
    ]);
    expect(codigos(grande({ nombre: 'Ana', identificacion: { tipo: 'PASAPORTE', numero: '  ' } }))).toEqual([
      'CLIENTE_IDENTIFICACION',
      'CONSUMIDOR_FINAL_IDENTIFICACION',
    ]);
    expect(errores(grande(CLIENTE_RTN))).toEqual([]);
  });
  it('el umbral se compara exacto, también en dólares con su tipo de cambio', () => {
    expect(errores(entrada({ lineas: [{ descripcion: 'Equipo', cantidad: 1, precioUnitario: '10000' }], preciosIncluyenISV: true }))).toEqual([]);
    expect(codigos(entrada({ lineas: [{ descripcion: 'Equipo', cantidad: 1, precioUnitario: '10000.01' }], preciosIncluyenISV: true }))).toEqual([
      'CONSUMIDOR_FINAL_IDENTIFICACION',
    ]);
    expect(codigos(grande(undefined, { moneda: 'USD', tipoCambio: '1' }))).toEqual(['CONSUMIDOR_FINAL_IDENTIFICACION']);
    expect(errores(entrada({ moneda: 'USD', tipoCambio: '24.5', lineas: [{ descripcion: 'Equipo', cantidad: 1, precioUnitario: '300' }] }))).toEqual([]);
  });
  it('umbral propio en las opciones, y su mensaje si no se puede leer', () => {
    expect(errores(entrada(), AUT, { umbralIdentificacionConsumidorFinal: 100 })[0]!.mensaje).toBe(
      'Ventas a consumidor final mayores de L 100.00 requieren nombre e identificación del cliente (Art. 11).',
    );
    expect(() => validarEntrada(entrada(), AUT, { umbralIdentificacionConsumidorFinal: '1.001' })).toThrow(
      'umbralIdentificacionConsumidorFinal admite como máximo 2 decimales: "1.001"',
    );
  });
});

describe('venta mixta (Art. 11 num. 3)', () => {
  const mixta = (extra: Partial<DocumentoEntrada> = {}) =>
    entrada({
      lineas: [
        { descripcion: 'Arroz', cantidad: 1, precioUnitario: 100 },
        { descripcion: 'Medicina', cantidad: 1, precioUnitario: 50, isv: 'EXENTO' },
      ],
      ...extra,
    });
  it('con RTN avisa cuánto cuenta para el crédito fiscal', () => {
    expect(avisos(mixta({ cliente: CLIENTE_RTN }))).toEqual([
      {
        codigo: 'AVISO_VENTA_MIXTA',
        mensaje: 'Venta mixta: para el crédito fiscal del comprador solo cuenta lo gravado (Art. 11 num. 3), L 100.00 de base.',
        campo: 'lineas',
      },
    ]);
    expect(avisos(mixta())).toEqual([]);
  });
  it('sin parte gravada no es venta mixta', () => {
    const exenta = entrada({ cliente: CLIENTE_RTN, lineas: [{ descripcion: 'Medicina', cantidad: 1, precioUnitario: 50, isv: 'EXENTO' }] });
    expect(avisos(exenta)).toEqual([]);
  });
});

describe('notas de crédito y débito (Arts. 26 y 28)', () => {
  it('sin referencia', () => {
    expect(errores(nota({ referencia: undefined }), AUT_NC)).toEqual([
      { codigo: 'REFERENCIA', mensaje: 'Las notas de crédito y débito deben referenciar el documento original (CAI, número y fecha).', campo: 'referencia' },
    ]);
  });
  it('CAI, número y fecha del documento referenciado', () => {
    expect(errores(nota({ referencia: { ...REF, cai: '  ' } }), AUT_NC)).toEqual([
      { codigo: 'REFERENCIA_CAI', mensaje: 'Falta el CAI del documento referenciado.', campo: 'referencia.cai' },
    ]);
    for (const numero of ['abc', '']) {
      expect(errores(nota({ referencia: { ...REF, numero } }), AUT_NC)).toEqual([
        { codigo: 'REFERENCIA_NUMERO', mensaje: 'Número del documento referenciado inválido.', campo: 'referencia.numero' },
      ]);
    }
    expect(errores(nota({ referencia: { ...REF, fecha: '10/11/2026' } }), AUT_NC)).toEqual([
      { codigo: 'REFERENCIA_FECHA', mensaje: 'Fecha del documento referenciado inválida.', campo: 'referencia.fecha' },
    ]);
    expect(errores(nota({ referencia: { ...REF, fecha: '2026-11-19' } }), AUT_NC)).toEqual([
      {
        codigo: 'REFERENCIA_FECHA_POSTERIOR',
        mensaje: 'El documento referenciado (2026-11-19) no puede tener fecha posterior a la nota (2026-11-18).',
        campo: 'referencia.fecha',
      },
    ]);
    expect(errores(nota({ referencia: { ...REF, fecha: HOY } }), AUT_NC)).toEqual([]);
  });
  it('una nota de crédito solo se aplica a un Comprobante Fiscal (Art. 4 num. 32); la de débito no se restringe', () => {
    expect(errores(nota({ referencia: { ...REF, numero: '000-001-07-00000001' } }), AUT_NC)).toEqual([
      {
        codigo: 'REFERENCIA_TIPO',
        mensaje: 'Una Nota de Crédito se aplica a un Comprobante Fiscal (Art. 6); el documento 000-001-07-00000001 es Nota de Débito.',
        campo: 'referencia.numero',
      },
    ]);
    const autND = { ...AUT, tipoDocumento: '07' as const };
    expect(errores(nota({ tipoDocumento: '07', referencia: { ...REF, numero: '000-001-06-00000001' } }), autND)).toEqual([]);
  });
  it('motivo, nombre y RTN del adquirente y moneda nacional', () => {
    expect(errores(nota({ motivo: '  ' }), AUT_NC)).toEqual([
      { codigo: 'MOTIVO', mensaje: 'Las notas de crédito y débito requieren el motivo.', campo: 'motivo' },
    ]);
    expect(errores(nota({ cliente: { nombre: '  ' } }), AUT_NC)).toEqual([
      { codigo: 'CLIENTE_NOMBRE', mensaje: 'Las notas de crédito y débito requieren el nombre del adquirente (Arts. 26 y 28).', campo: 'cliente.nombre' },
      { codigo: 'NOTA_CLIENTE_RTN', mensaje: 'Las notas de crédito y débito requieren el RTN del adquirente (Arts. 26 y 28).', campo: 'cliente.rtn' },
    ]);
    // Con RTN y sin nombre, CLIENTE_NOMBRE sale una sola vez.
    expect(codigos(nota({ cliente: { rtn: '99990000000002' } }), AUT_NC)).toEqual(['CLIENTE_NOMBRE']);
    // Sin nombre, CLIENTE_NOMBRE sale aunque haya otros errores.
    expect(codigos(nota({ motivo: '', cliente: { rtn: '99990000000002', nombre: undefined } }), AUT_NC)).toEqual(['CLIENTE_NOMBRE', 'MOTIVO']);
    expect(codigos(nota({ motivo: '', cliente: {} }), AUT_NC)).toEqual(['MOTIVO', 'CLIENTE_NOMBRE', 'NOTA_CLIENTE_RTN']);
    expect(errores(nota({ moneda: 'USD', tipoCambio: '24.5' }), AUT_NC)).toEqual([
      { codigo: 'NOTA_MONEDA', mensaje: 'Las notas de crédito y débito se emiten en Lempiras (Arts. 26 y 28).', campo: 'moneda' },
    ]);
  });
});

describe('notaEnLempiras (Arts. 26 num. 9 y 28 num. 8)', () => {
  const enDolares = (extra: Partial<DocumentoEntrada> = {}, ref: object = {}) =>
    nota({
      referencia: { ...REF, moneda: 'USD', tipoCambio: '24.5', ...ref },
      lineas: [
        { descripcion: 'Con descuento', cantidad: 1, precioUnitario: '10', descuento: '1' },
        { descripcion: 'Sin descuento', cantidad: 1, precioUnitario: '2.5' },
      ],
      ...extra,
    });
  it('convierte precio y descuento de las notas 06 y 07 con el tipo de cambio del original', () => {
    for (const tipoDocumento of ['06', '07'] as const) {
      const r = notaEnLempiras(enDolares({ tipoDocumento }));
      expect(r.problemas).toEqual([]);
      expect(r.entrada.lineas[0]).toMatchObject({ precioUnitario: '245', descuento: '24.5' });
      expect(r.entrada.lineas[1]!.precioUnitario).toBe('61.25');
      expect('descuento' in r.entrada.lineas[1]!).toBe(false);
      expect(r.entrada.referencia!.tipoCambio).toBe(24.5);
    }
  });
  it('no toca una factura, una nota en lempiras ni una sin moneda', () => {
    const factura = enDolares({ tipoDocumento: '01' });
    expect(notaEnLempiras(factura)).toEqual({ entrada: factura, problemas: [] });
    const enLempiras = enDolares({}, { moneda: 'HNL' });
    expect(notaEnLempiras(enLempiras)).toEqual({ entrada: enLempiras, problemas: [] });
    const sinMoneda = nota();
    expect(notaEnLempiras(sinMoneda)).toEqual({ entrada: sinMoneda, problemas: [] });
    expect(validarEntrada(enLempiras, AUT_NC).errores).toEqual([]);
  });
  it('moneda desconocida o sin tipo de cambio', () => {
    expect(notaEnLempiras(enDolares({}, { moneda: 'EUR' })).problemas).toEqual([
      { codigo: 'REFERENCIA_MONEDA', mensaje: 'Moneda del documento original desconocida: EUR.', campo: 'referencia.moneda' },
    ]);
    expect(notaEnLempiras(enDolares({}, { tipoCambio: undefined })).problemas).toEqual([
      {
        codigo: 'REFERENCIA_TIPO_CAMBIO',
        mensaje: 'El documento original está en moneda extranjera: indica su tipo de cambio para convertir la nota a lempiras.',
        campo: 'referencia.tipoCambio',
      },
    ]);
  });
  it('si las líneas no se pueden leer, las devuelve sin convertir y la validación reporta el error', () => {
    const mala = enDolares({ lineas: [{ descripcion: 'X', cantidad: 1, precioUnitario: 'abc' }] });
    expect(notaEnLempiras(mala)).toEqual({ entrada: mala, problemas: [] });
    expect(codigos(mala, AUT_NC)).toEqual(['LINEA_PRECIO']);
  });
});

describe('ErrorValidacion y esErrorValidacion', () => {
  it('el mensaje une código, mensaje (con punto final si no lo trae), solución y enlace', () => {
    const e = new ErrorValidacion([
      { codigo: 'X_LIBRE', mensaje: '  sin punto  ' },
      { codigo: 'X_OTRO', mensaje: '¿con signo?' },
      { codigo: 'X_CITA', mensaje: 'termina en cita»' },
      { codigo: 'X_PAR', mensaje: 'termina en paréntesis)' },
      { codigo: 'X_EXCL', mensaje: 'termina en exclamación!' },
      { codigo: 'X_MEDIO', mensaje: 'Línea 1. sin punto final' },
    ]);
    expect(e.name).toBe('ErrorValidacion');
    expect(e.message).toBe(
      'Documento inválido: [X_LIBRE] sin punto. [X_OTRO] ¿con signo? [X_CITA] termina en cita» [X_PAR] termina en paréntesis) [X_EXCL] termina en exclamación! [X_MEDIO] Línea 1. sin punto final.',
    );
    expect(e.advertencias).toEqual([]);
    const conocido = new ErrorValidacion([{ codigo: 'CAI_REQUERIDO', mensaje: 'La autorización no tiene CAI.' }], [{ codigo: 'AVISO_X', mensaje: 'a' }]);
    expect(conocido.message).toBe(
      'Documento inválido: [CAI_REQUERIDO] La autorización no tiene CAI. Solución: Indica el CAI de la autorización. ' +
        'Cópialo tal como viene en la resolución del SAR. Más información: ' +
        'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#cai_requerido',
    );
    expect(conocido.errores[0]!.solucion).toMatch(/^Indica el CAI/);
    expect(conocido.advertencias).toEqual([{ codigo: 'AVISO_X', mensaje: 'a' }]);
  });
  it('reconoce un ErrorValidacion de otra copia del paquete por nombre y lista de errores', () => {
    expect(esErrorValidacion(new ErrorValidacion([]))).toBe(true);
    const deOtraCopia = Object.assign(new Error('x'), { name: 'ErrorValidacion', errores: [] });
    expect(esErrorValidacion(deOtraCopia)).toBe(true);
    expect(esErrorValidacion(Object.assign(new Error('x'), { name: 'ErrorValidacion' }))).toBe(false);
    expect(esErrorValidacion(Object.assign(new Error('x'), { name: 'Otro', errores: [] }))).toBe(false);
    expect(esErrorValidacion({ name: 'ErrorValidacion', errores: [] })).toBe(false);
    expect(esErrorValidacion(null)).toBe(false);
  });
});

describe('operador', () => {
  const malo = { codigo: 'OPERADOR', mensaje: 'El operador debe ser un nombre de 1 a 80 caracteres, sin caracteres de control.', campo: 'operador' };
  it('de 1 a 80 caracteres sin contar los espacios de los extremos, sin caracteres de control', () => {
    expect(problemaDeOperador(undefined)).toBeNull();
    expect(problemaDeOperador('a'.repeat(80))).toBeNull();
    expect(problemaDeOperador(`  ${'a'.repeat(80)}  `)).toBeNull();
    expect(problemaDeOperador('a'.repeat(81))).toEqual(malo);
    expect(problemaDeOperador('   ')).toEqual(malo);
    expect(problemaDeOperador('Ana\nPérez')).toEqual(malo);
    expect(problemaDeOperador(7)).toEqual(malo);
    expect(problemaDeOperador('a'.repeat(81), 'venta.operador')).toEqual({ ...malo, campo: 'venta.operador' });
  });
  it('validarEntrada lo revisa', () => {
    expect(codigos(entrada({ operador: '   ' }))).toEqual(['OPERADOR']);
  });
});

describe('problemasDeTexto (DEC-060)', () => {
  it('mensaje distinto para un valor y para un nombre de campo, con la posición y el punto de código en mayúsculas', () => {
    expect(problemasDeTexto({ cliente: { nombre: 'Ana\u001b' } })).toEqual([
      {
        codigo: 'TEXTO_CARACTER_NO_PERMITIDO',
        mensaje:
          'El texto de «cliente.nombre» tiene un carácter de control (U+001B) en la posición 4. De los caracteres de control solo se permiten el tabulador y los saltos de línea.',
        campo: 'cliente.nombre',
      },
    ]);
    expect(problemasDeTexto({ 'k\u0000x\u0001': 'v' })).toEqual([
      {
        codigo: 'TEXTO_CARACTER_NO_PERMITIDO',
        mensaje:
          'El nombre del campo «k<U+0000>x<U+0001>» tiene un carácter de control (U+0000) en la posición 2. De los caracteres de control solo se permiten el tabulador y los saltos de línea.',
        campo: 'k<U+0000>x<U+0001>',
      },
    ]);
    expect(problemasDeTexto({ a: 'x\ud800' })[0]!.mensaje).toMatch(/^El texto de «a» tiene una mitad suelta de un par sustituto UTF-16 \(U\+D800\) en la posición 2\./);
  });
  it('los problemas del emisor (objeto, texto o lista) traen la solución de la configuración; los demás no', () => {
    const conSolucion = (v: unknown) => problemasDeTexto(v).map((p) => [p.campo, Boolean(p.solucion)]);
    expect(conSolucion({ emisor: 'x\u0000' })).toEqual([['emisor', true]]);
    expect(conSolucion({ emisor: { telefono: 'x\u0000' } })).toEqual([['emisor.telefono', true]]);
    expect(conSolucion({ emisor: ['x\u0000'] })).toEqual([['emisor[0]', true]]);
    expect(conSolucion({ emisorX: 'x\u0000' })).toEqual([['emisorX', false]]);
    expect(conSolucion({ cliente: { emisor: 'x\u0000' } })).toEqual([['cliente.emisor', false]]);
    expect(problemasDeTexto({ emisor: 'x\u0000' })[0]!.solucion).toMatch(/^El carácter está en la configuración del emisor/);
  });
  it('solo se omite el operador de la raíz; uno anidado o dentro de una lista se revisa', () => {
    expect(problemasDeTexto({ operador: 'x\u0000' })).toEqual([]);
    expect(problemasDeTexto({ cliente: { operador: 'x\u0000' } }).map((p) => p.campo)).toEqual(['cliente.operador']);
    expect(problemasDeTexto({ lineas: [{ operador: 'x\u0000' }] }).map((p) => p.campo)).toEqual(['lineas[0].operador']);
    expect(problemasDeTexto([{ operador: 'x\u0000' }]).map((p) => p.campo)).toEqual(['[0].operador']);
  });
  it('salta null, números y ciclos', () => {
    const ciclo: Record<string, unknown> = { a: null, b: 5, c: true, d: 'ok' };
    ciclo.yo = ciclo;
    expect(problemasDeTexto(ciclo)).toEqual([]);
    expect(problemasDeTexto(null)).toEqual([]);
  });
});

describe('construirDocumento', () => {
  it('correlativo entero dentro del rango, extremos incluidos', () => {
    const aut = { ...AUT, rangoInicial: 10, rangoFinal: 20 };
    expect(construirDocumento(entrada(), aut, 10).numero).toBe('000-001-01-00000010');
    expect(construirDocumento(entrada(), aut, 20).correlativo).toBe(20);
    for (const malo of [9, 21, 10.5]) {
      let error: ErrorValidacion | undefined;
      try {
        construirDocumento(entrada(), aut, malo);
      } catch (e) {
        error = e as ErrorValidacion;
      }
      expect(corto(error!.errores)).toEqual([
        { codigo: 'CORRELATIVO_FUERA_DE_RANGO', mensaje: `El correlativo ${malo} está fuera del rango autorizado 10–20.`, campo: 'correlativo' },
      ]);
    }
  });
  it('los problemas adicionales: los avisos pasan al documento y los errores lo detienen', () => {
    const aviso = { codigo: 'AVISO_EXTERNO', mensaje: 'un aviso' };
    const doc = construirDocumento(entrada(), AUT, 1, {}, [aviso]);
    expect(doc.advertencias).toEqual([aviso]);
    let error: ErrorValidacion | undefined;
    try {
      construirDocumento(entrada(), AUT, 1, {}, [{ codigo: 'ERROR_EXTERNO', mensaje: 'un error' }, aviso]);
    } catch (e) {
      error = e as ErrorValidacion;
    }
    expect(error!.message).toBe('Documento inválido: [ERROR_EXTERNO] un error.');
    expect(error!.errores).toEqual([{ codigo: 'ERROR_EXTERNO', mensaje: 'un error' }]);
    expect(error!.advertencias).toEqual([aviso]);
  });
  it('sin nombre (o con solo espacios) se imprime CONSUMIDOR FINAL', () => {
    expect(construirDocumento(entrada({ cliente: { nombre: '   ' } }), AUT, 1).cliente.nombreImpreso).toBe('CONSUMIDOR FINAL');
    expect(construirDocumento(entrada({ cliente: { nombre: ' Ana ' } }), AUT, 1).cliente.nombreImpreso).toBe('Ana');
  });
  it('los campos opcionales solo aparecen si vienen; el operador se recorta', () => {
    const minimo = construirDocumento(entrada(), AUT, 1);
    for (const campo of ['horaEmision', 'exoneracion', 'tipoCambio', 'referencia', 'motivo', 'condicionPago', 'observaciones', 'operador', 'modo', 'equivalenteLempiras']) {
      expect(campo in minimo).toBe(false);
    }
    const completo = construirDocumento(
      entrada({ horaEmision: '10:30', motivo: 'm', condicionPago: 'CONTADO', observaciones: 'o', operador: '  Ana  ' }),
      AUT,
      1,
    );
    expect(completo).toMatchObject({ horaEmision: '10:30', motivo: 'm', condicionPago: 'CONTADO', observaciones: 'o', operador: 'Ana' });
  });
  it('en dólares guarda el tipo de cambio y el equivalente en lempiras', () => {
    const doc = construirDocumento(entrada({ moneda: 'USD', tipoCambio: '24.5' }), AUT, 1);
    expect(doc.tipoCambio).toBe(24.5);
    expect(doc.equivalenteLempiras).toEqual({ isv15: 367.5, total: 2817.5 });
  });
});
