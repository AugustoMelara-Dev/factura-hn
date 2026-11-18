/**
 * Construcción y validación de documentos fiscales (Factura, Nota de Crédito, Nota de Débito).
 */
import { calcularDocumento, validarLineas } from './calculo';
import { esAdvertencia, esFechaValida, fechaHonduras, validarAutorizacion } from './autorizacion';
import type { AlmacenCorrelativos } from './correlativos';
import { esDNIValido, esRTNValido, limpiarIdentificador, normalizarCAI } from './identificacion';
import { esNumeroValido, formatearRango, numeroDesdeAutorizacion, TIPOS_DOCUMENTO } from './numeracion';
import type {
  AutorizacionCAI,
  DocumentoEntrada,
  DocumentoFiscal,
  OpcionesDocumento,
  Problema,
  ResultadoValidacion,
  TipoDocumentoSoportado,
} from './tipos';

export const UMBRAL_CONSUMIDOR_FINAL = 10_000;
export const CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';
export const DESTINO_EJEMPLARES = 'Original: Cliente / Copia: Emisor';

const SOPORTADOS: TipoDocumentoSoportado[] = ['01', '07', '08'];

export class ErrorValidacion extends Error {
  constructor(public readonly errores: Problema[], public readonly advertencias: Problema[] = []) {
    super(`Documento inválido: ${errores.map((e) => `[${e.codigo}] ${e.mensaje}`).join(' ')}`);
    this.name = 'ErrorValidacion';
  }
}

/**
 * Valida la entrada contra la autorización, sin asignar número.
 * Llama a esto antes de reservar un correlativo.
 */
export function validarEntrada(
  entrada: DocumentoEntrada,
  autorizacion: AutorizacionCAI,
  opciones: OpcionesDocumento = {},
): ResultadoValidacion {
  const problemas: Problema[] = [];
  const tipo = entrada.tipoDocumento ?? '01';
  const fecha = entrada.fechaEmision ?? fechaHonduras();

  if (!SOPORTADOS.includes(tipo)) {
    problemas.push({ codigo: 'TIPO_NO_SOPORTADO', mensaje: `Tipo de documento ${tipo} no soportado en esta versión (01, 07, 08).`, campo: 'tipoDocumento' });
  }

  // Autorización
  problemas.push(...validarAutorizacion(autorizacion, { caiEstricto: opciones.caiEstricto ?? false }));
  if (autorizacion.tipoDocumento !== tipo) {
    problemas.push({
      codigo: 'AUTORIZACION_TIPO',
      mensaje: `La autorización es para ${TIPOS_DOCUMENTO[autorizacion.tipoDocumento] ?? autorizacion.tipoDocumento}, pero el documento es ${TIPOS_DOCUMENTO[tipo] ?? tipo}.`,
      campo: 'tipoDocumento',
    });
  }

  // Fecha
  if (!esFechaValida(fecha)) {
    problemas.push({ codigo: 'FECHA_EMISION', mensaje: 'fechaEmision debe ser YYYY-MM-DD.', campo: 'fechaEmision' });
  } else if (esFechaValida(autorizacion.fechaLimiteEmision) && fecha > autorizacion.fechaLimiteEmision) {
    problemas.push({
      codigo: 'AUTORIZACION_VENCIDA',
      mensaje: `La fecha de emisión ${fecha} es posterior a la fecha límite ${autorizacion.fechaLimiteEmision}.`,
      campo: 'fechaEmision',
    });
  }

  // Emisor
  const e = entrada.emisor;
  if (!e) problemas.push({ codigo: 'EMISOR', mensaje: 'Faltan los datos del emisor.', campo: 'emisor' });
  else {
    if (!e.rtn || !esRTNValido(e.rtn)) problemas.push({ codigo: 'EMISOR_RTN', mensaje: 'RTN del emisor inválido (14 dígitos).', campo: 'emisor.rtn' });
    if (!e.razonSocial?.trim()) problemas.push({ codigo: 'EMISOR_NOMBRE', mensaje: 'Falta el nombre o razón social del emisor.', campo: 'emisor.razonSocial' });
    if (!e.direccionCasaMatriz?.trim()) problemas.push({ codigo: 'EMISOR_DIRECCION', mensaje: 'Falta la dirección de casa matriz.', campo: 'emisor.direccionCasaMatriz' });
    if (!e.telefono && !e.correo) problemas.push({ codigo: 'AVISO_EMISOR_CONTACTO', mensaje: 'Se recomienda incluir teléfono y correo del emisor (Art. 10).', campo: 'emisor' });
  }

  // Cliente
  const c = entrada.cliente ?? {};
  if (c.rtn !== undefined && c.rtn !== '' && !esRTNValido(c.rtn)) {
    problemas.push({ codigo: 'CLIENTE_RTN', mensaje: 'RTN del cliente inválido (14 dígitos).', campo: 'cliente.rtn' });
  }
  if (c.rtn && !c.nombre?.trim()) {
    problemas.push({ codigo: 'CLIENTE_NOMBRE', mensaje: 'Si el cliente tiene RTN, se requiere su nombre o razón social.', campo: 'cliente.nombre' });
  }
  if (c.identificacion) {
    if (!c.identificacion.numero?.trim())
      problemas.push({ codigo: 'CLIENTE_IDENTIFICACION', mensaje: 'Falta el número de identificación del cliente.', campo: 'cliente.identificacion' });
    else if (c.identificacion.tipo === 'DNI' && !esDNIValido(c.identificacion.numero))
      problemas.push({ codigo: 'CLIENTE_DNI', mensaje: 'DNI del cliente inválido (13 dígitos).', campo: 'cliente.identificacion' });
    else if (c.identificacion.tipo === 'RTN' && !esRTNValido(c.identificacion.numero))
      problemas.push({ codigo: 'CLIENTE_RTN', mensaje: 'RTN del cliente inválido (14 dígitos).', campo: 'cliente.identificacion' });
  }

  // Exoneración
  if (entrada.exoneracion) {
    const x = entrada.exoneracion;
    if (!x.ordenCompraExenta?.trim())
      problemas.push({ codigo: 'EXONERACION_ORDEN', mensaje: 'Falta el número de Orden de Compra Exenta.', campo: 'exoneracion.ordenCompraExenta' });
    if (!x.constanciaRegistroExonerado?.trim())
      problemas.push({ codigo: 'EXONERACION_CONSTANCIA', mensaje: 'Falta el número de Constancia de Registro de Exonerados.', campo: 'exoneracion.constanciaRegistroExonerado' });
    if (!c.rtn)
      problemas.push({ codigo: 'AVISO_EXONERADO_RTN', mensaje: 'Un adquirente exonerado normalmente se identifica con RTN.', campo: 'cliente.rtn' });
  }

  // Moneda
  const moneda = entrada.moneda ?? 'HNL';
  if (moneda !== 'HNL' && !(Number.isFinite(entrada.tipoCambio) && (entrada.tipoCambio ?? 0) > 0)) {
    problemas.push({ codigo: 'TIPO_CAMBIO', mensaje: 'En moneda extranjera se debe indicar el tipo de cambio de la fecha de emisión.', campo: 'tipoCambio' });
  }

  // Notas de crédito / débito
  if (tipo === '07' || tipo === '08') {
    const r = entrada.referencia;
    if (!r) problemas.push({ codigo: 'REFERENCIA', mensaje: 'Las notas de crédito y débito deben referenciar el documento original (CAI, número y fecha).', campo: 'referencia' });
    else {
      if (!r.cai?.trim()) problemas.push({ codigo: 'REFERENCIA_CAI', mensaje: 'Falta el CAI del documento referenciado.', campo: 'referencia.cai' });
      if (!r.numero || !esNumeroValido(r.numero)) problemas.push({ codigo: 'REFERENCIA_NUMERO', mensaje: 'Número del documento referenciado inválido.', campo: 'referencia.numero' });
      if (!r.fecha || !esFechaValida(r.fecha)) problemas.push({ codigo: 'REFERENCIA_FECHA', mensaje: 'Fecha del documento referenciado inválida.', campo: 'referencia.fecha' });
    }
    if (!entrada.motivo?.trim()) problemas.push({ codigo: 'MOTIVO', mensaje: 'Las notas de crédito y débito requieren el motivo.', campo: 'motivo' });
    if (!c.nombre?.trim()) problemas.push({ codigo: 'CLIENTE_NOMBRE', mensaje: 'Las notas de crédito y débito requieren el nombre del adquirente.', campo: 'cliente.nombre' });
  }

  // Líneas y umbral de consumidor final
  const problemasLineas = validarLineas(entrada.lineas);
  problemas.push(...problemasLineas);
  if (problemasLineas.length === 0) {
    const { totales } = calcularDocumento(entrada.lineas, {
      preciosIncluyenISV: entrada.preciosIncluyenISV ?? false,
      exonerado: Boolean(entrada.exoneracion),
      moneda,
    });
    const totalLempiras = moneda === 'HNL' ? totales.total : totales.total * (entrada.tipoCambio ?? 0);
    const umbral = opciones.umbralIdentificacionConsumidorFinal ?? UMBRAL_CONSUMIDOR_FINAL;
    const identificado = Boolean(c.rtn) || (Boolean(c.nombre?.trim()) && Boolean(c.identificacion?.numero?.trim()));
    if (totalLempiras > umbral && !identificado) {
      problemas.push({
        codigo: 'CONSUMIDOR_FINAL_IDENTIFICACION',
        mensaje: `Ventas a consumidor final mayores de L ${umbral.toLocaleString('en-US')} requieren nombre e identificación del cliente (Art. 11).`,
        campo: 'cliente',
      });
    }
  }

  const errores = problemas.filter((p) => !esAdvertencia(p));
  const advertencias = problemas.filter(esAdvertencia);
  return { ok: errores.length === 0, errores, advertencias };
}

/**
 * Construye el documento con un correlativo ya asignado. Función pura.
 * Lanza `ErrorValidacion` si la entrada no es válida o el correlativo está fuera del rango.
 */
export function construirDocumento(
  entrada: DocumentoEntrada,
  autorizacion: AutorizacionCAI,
  correlativo: number,
  opciones: OpcionesDocumento = {},
): DocumentoFiscal {
  entrada = { ...entrada, fechaEmision: entrada.fechaEmision ?? fechaHonduras() };
  const v = validarEntrada(entrada, autorizacion, opciones);
  const errores = [...v.errores];
  if (!Number.isInteger(correlativo) || correlativo < autorizacion.rangoInicial || correlativo > autorizacion.rangoFinal) {
    errores.push({
      codigo: 'CORRELATIVO_FUERA_DE_RANGO',
      mensaje: `El correlativo ${correlativo} está fuera del rango autorizado ${autorizacion.rangoInicial}–${autorizacion.rangoFinal}.`,
      campo: 'correlativo',
    });
  }
  if (errores.length) throw new ErrorValidacion(errores, v.advertencias);

  const tipo = entrada.tipoDocumento ?? '01';
  const moneda = entrada.moneda ?? 'HNL';
  const preciosIncluyenISV = entrada.preciosIncluyenISV ?? false;
  const { lineas, totales } = calcularDocumento(entrada.lineas, {
    preciosIncluyenISV,
    exonerado: Boolean(entrada.exoneracion),
    moneda,
  });

  const c = entrada.cliente ?? {};
  const cliente: DocumentoFiscal['cliente'] = {
    ...c,
    ...(c.rtn ? { rtn: limpiarIdentificador(c.rtn) } : {}),
    nombreImpreso: c.nombre?.trim() || CONSUMIDOR_FINAL,
  };

  const doc: DocumentoFiscal = {
    tipoDocumento: tipo,
    nombreDocumento: TIPOS_DOCUMENTO[tipo],
    numero: numeroDesdeAutorizacion(autorizacion, correlativo),
    correlativo,
    cai: normalizarCAI(autorizacion.cai),
    rangoAutorizado: formatearRango(autorizacion),
    fechaLimiteEmision: autorizacion.fechaLimiteEmision,
    fechaEmision: entrada.fechaEmision ?? fechaHonduras(),
    emisor: { ...entrada.emisor, rtn: limpiarIdentificador(entrada.emisor.rtn) },
    cliente,
    moneda,
    preciosIncluyenISV,
    lineas,
    totales,
    destinoEjemplares: DESTINO_EJEMPLARES,
    advertencias: v.advertencias,
  };
  if (entrada.horaEmision) doc.horaEmision = entrada.horaEmision;
  if (entrada.exoneracion) doc.exoneracion = entrada.exoneracion;
  if (moneda !== 'HNL') doc.tipoCambio = entrada.tipoCambio;
  if (entrada.referencia) doc.referencia = entrada.referencia;
  if (entrada.motivo) doc.motivo = entrada.motivo;
  if (entrada.condicionPago) doc.condicionPago = entrada.condicionPago;
  if (entrada.observaciones) doc.observaciones = entrada.observaciones;
  return doc;
}

/**
 * Flujo completo: valida, reserva el siguiente correlativo y construye el documento.
 * El correlativo solo se reserva si la validación pasa, para no dejar huecos en la numeración.
 */
export async function crearDocumento(
  entrada: DocumentoEntrada,
  config: { autorizacion: AutorizacionCAI; almacen: AlmacenCorrelativos; opciones?: OpcionesDocumento },
): Promise<DocumentoFiscal> {
  // Fijar la fecha una sola vez para que validación y documento usen la misma.
  const e: DocumentoEntrada = { ...entrada, fechaEmision: entrada.fechaEmision ?? fechaHonduras() };
  const v = validarEntrada(e, config.autorizacion, config.opciones);
  if (!v.ok) throw new ErrorValidacion(v.errores, v.advertencias);
  const correlativo = await config.almacen.siguiente(config.autorizacion);
  return construirDocumento(e, config.autorizacion, correlativo, config.opciones);
}
