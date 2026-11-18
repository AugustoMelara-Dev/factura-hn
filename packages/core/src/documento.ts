/**
 * Construcción y validación de documentos fiscales (Factura, Nota de Crédito, Nota de Débito).
 */
import { congelar } from './inmutable';
import { advertenciasDeCalculo, calcularCentavos, calcularDocumento, ESCALA_PRECIO, validarLineas } from './calculo';
import { centavosATexto, dividirRedondeando, escaladoATexto, ErrorMonto, formatearMonto, parsearDecimal, type Monto } from './dinero';
import { esAdvertencia, esFechaValida, fechaHonduras, validarAutorizacion } from './autorizacion';
import { esDNIValido, esRTNValido, limpiarIdentificador, normalizarCAI } from './identificacion';
import { esNumeroValido, formatearRango, numeroDesdeAutorizacion, parsearNumero, TIPOS_DOCUMENTO } from './numeracion';
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

/** El tipo de cambio se lee con 6 decimales. */
const ESCALA_TC = 1_000_000n;

function leerTipoCambio(valor: Monto | undefined): bigint | null {
  if (valor === undefined || valor === null || valor === '') return null;
  try {
    const tc = parsearDecimal(valor, 6, 'tipoCambio');
    return tc > 0n ? tc : null;
  } catch (e) {
    if (e instanceof ErrorMonto) return null;
    throw e;
  }
}

/**
 * DEC-018: una nota se emite en lempiras (Arts. 26 num. 9 y 28 num. 8). Si el documento original está en
 * moneda extranjera, las líneas de la nota se escriben en esa moneda y aquí se convierten a lempiras con el
 * tipo de cambio del original (precio a 4 decimales, descuento a 2, redondeo del Art. 9 de la Ley del ISV).
 * Si las líneas no se pueden leer, se devuelven sin convertir para que la validación reporte el error.
 */
export function notaEnLempiras(entrada: DocumentoEntrada): { entrada: DocumentoEntrada; problemas: Problema[] } {
  const r = entrada.referencia;
  const tipo = entrada.tipoDocumento ?? '01';
  if ((tipo !== '06' && tipo !== '07') || !r?.moneda || r.moneda === 'HNL') return { entrada, problemas: [] };
  if (r.moneda !== 'USD') {
    return { entrada, problemas: [{ codigo: 'REFERENCIA_MONEDA', mensaje: `Moneda del documento original desconocida: ${String(r.moneda)}.`, campo: 'referencia.moneda' }] };
  }
  const tc = leerTipoCambio(r.tipoCambio);
  if (tc === null) {
    return {
      entrada,
      problemas: [{
        codigo: 'REFERENCIA_TIPO_CAMBIO',
        mensaje: 'El documento original está en moneda extranjera: indica su tipo de cambio para convertir la nota a lempiras.',
        campo: 'referencia.tipoCambio',
      }],
    };
  }
  try {
    const lineas = entrada.lineas.map((l) => {
      const precio = parsearDecimal(l.precioUnitario, ESCALA_PRECIO, 'precioUnitario');
      const descuento = parsearDecimal(l.descuento ?? 0, 2, 'descuento');
      return {
        ...l,
        precioUnitario: escaladoATexto(dividirRedondeando(precio * tc, ESCALA_TC), ESCALA_PRECIO),
        ...(l.descuento !== undefined ? { descuento: escaladoATexto(dividirRedondeando(descuento * tc, ESCALA_TC), 2) } : {}),
      };
    });
    return {
      entrada: { ...entrada, lineas, referencia: { ...r, tipoCambio: Number(escaladoATexto(tc, 6)) } },
      problemas: [],
    };
  } catch (e) {
    if (e instanceof ErrorMonto) return { entrada, problemas: [] };
    throw e;
  }
}

/** Fecha de hoy en Honduras según el reloj de las opciones. */
export function hoyHonduras(opciones: Pick<OpcionesDocumento, 'reloj'> = {}): string {
  return fechaHonduras((opciones.reloj ?? (() => new Date()))());
}

const SOPORTADOS: TipoDocumentoSoportado[] = ['01', '06', '07'];

/**
 * Documentos que un autoimpresor por sistema computarizado no puede emitir (B-15):
 * - 09 Ticket: se emite «exclusivamente para consumidores finales a través de máquinas registradoras»
 *   (Reglamento Art. 4 num. 43, C L.448-450; Art. 17).
 * - 04 Recibo por Honorarios Profesionales y 10 Factura Prevalorada: «deben ser exclusivamente emitidos bajo
 *   la modalidad de imprenta» (Art. 46).
 * - 12 Constancia de Donación: excluida de la modalidad de autoimpresor (Art. 47, C L.2047-2080).
 */
export const TIPOS_NO_EMITIBLES_POR_SISTEMA: Readonly<Record<string, string>> = {
  '04': 'el Recibo por Honorarios Profesionales se emite exclusivamente bajo la modalidad de imprenta (Art. 46)',
  '09': 'el Ticket se emite exclusivamente por máquinas registradoras (Art. 4 num. 43)',
  '10': 'la Factura Prevalorada se emite exclusivamente bajo la modalidad de imprenta (Art. 46)',
  '12': 'la Constancia de Donación no se emite en la modalidad de autoimpresor (Art. 47)',
};

/** Comprobantes Fiscales (Reglamento Art. 6). Una Nota de Crédito solo se vincula a uno de ellos (Art. 4 num. 32). */
export const COMPROBANTES_FISCALES: readonly string[] = ['01', '10', '09', '04', '11', '12'];

/** Problema de tipo de documento, o null si el sistema puede emitirlo en esta versión. */
export function problemaDeTipo(tipo: string): Problema | null {
  const motivo = TIPOS_NO_EMITIBLES_POR_SISTEMA[tipo];
  if (motivo) {
    return { codigo: 'TIPO_NO_EMITIBLE', mensaje: `Un sistema computarizado no puede emitir el tipo ${tipo}: ${motivo}.`, campo: 'tipoDocumento' };
  }
  if (!SOPORTADOS.includes(tipo as TipoDocumentoSoportado)) {
    return { codigo: 'TIPO_NO_SOPORTADO', mensaje: `Tipo de documento ${tipo} no soportado en esta versión (01, 06, 07).`, campo: 'tipoDocumento' };
  }
  return null;
}

const PATRON_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  const conversion = notaEnLempiras(entrada);
  problemas.push(...conversion.problemas);
  entrada = conversion.entrada;
  const tipo = entrada.tipoDocumento ?? '01';
  const hoy = hoyHonduras(opciones);
  const fecha = entrada.fechaEmision ?? hoy;

  const problemaTipo = problemaDeTipo(tipo);
  if (problemaTipo) problemas.push(problemaTipo);

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
  } else if (fecha !== hoy) {
    // Reglamento Art. 14 (momento de emisión) y Art. 43 (custodia en orden cronológico): el documento se
    // emite con la fecha en que ocurre la operación. Retrofechar o adelantar no se permite; la contingencia
    // del Art. 55 se cubre con talonarios preimpresos, no con fechas pasadas.
    problemas.push({
      codigo: 'FECHA_EMISION_NO_ES_HOY',
      mensaje: `La fecha de emisión (${fecha}) debe ser la de hoy en Honduras (${hoy}). No se puede retrofechar ni adelantar (Arts. 14 y 43).`,
      campo: 'fechaEmision',
    });
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
    // Art. 10 num. 1 (y Arts. 25 y 27 num. 1 para las notas): todos los datos de identificación del emisor.
    if (!e.nombreComercial?.trim())
      problemas.push({ codigo: 'EMISOR_NOMBRE_COMERCIAL', mensaje: 'Falta el nombre comercial del emisor (Art. 10 num. 1 c). Si no tiene uno distinto, repite la razón social.', campo: 'emisor.nombreComercial' });
    if (!e.direccionCasaMatriz?.trim()) problemas.push({ codigo: 'EMISOR_DIRECCION', mensaje: 'Falta la dirección de casa matriz (Art. 10 num. 1 d).', campo: 'emisor.direccionCasaMatriz' });
    if (!e.direccionEstablecimiento?.trim())
      problemas.push({ codigo: 'EMISOR_DIRECCION_ESTABLECIMIENTO', mensaje: 'Falta la dirección del establecimiento donde está el punto de emisión (Art. 10 num. 1 d).', campo: 'emisor.direccionEstablecimiento' });
    if (!e.telefono?.trim()) problemas.push({ codigo: 'EMISOR_TELEFONO', mensaje: 'Falta el número telefónico del emisor (Art. 10 num. 1 e).', campo: 'emisor.telefono' });
    if (!e.correo?.trim()) problemas.push({ codigo: 'EMISOR_CORREO', mensaje: 'Falta el correo electrónico del emisor (Art. 10 num. 1 f).', campo: 'emisor.correo' });
    else if (!PATRON_CORREO.test(e.correo.trim()))
      problemas.push({ codigo: 'EMISOR_CORREO', mensaje: `El correo del emisor no parece válido: "${e.correo}".`, campo: 'emisor.correo' });
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
    // Art. 11 num. 4: OCE y Constancia del Registro de Exonerados «o» el registro RUPNSA de la SAG, «según
    // corresponda». Con el registro SAG basta; sin él, hacen falta los dos documentos.
    if (!x.registroSAG?.trim()) {
      const falta = ' (Art. 11 num. 4: Orden de Compra Exenta y Constancia, o el registro SAG/RUPNSA).';
      if (!x.ordenCompraExenta?.trim())
        problemas.push({ codigo: 'EXONERACION_ORDEN', mensaje: `Falta el número de Orden de Compra Exenta${falta}`, campo: 'exoneracion.ordenCompraExenta' });
      if (!x.constanciaRegistroExonerado?.trim())
        problemas.push({ codigo: 'EXONERACION_CONSTANCIA', mensaje: `Falta el número de Constancia de Registro de Exonerados${falta}`, campo: 'exoneracion.constanciaRegistroExonerado' });
    }
    if (!c.rtn)
      problemas.push({ codigo: 'AVISO_EXONERADO_RTN', mensaje: 'Un adquirente exonerado normalmente se identifica con RTN.', campo: 'cliente.rtn' });
  }

  // Moneda
  const moneda = entrada.moneda ?? 'HNL';
  const tipoCambio = moneda === 'HNL' ? null : leerTipoCambio(entrada.tipoCambio);
  if (moneda !== 'HNL' && tipoCambio === null) {
    problemas.push({ codigo: 'TIPO_CAMBIO', mensaje: 'En moneda extranjera se debe indicar el tipo de cambio de la fecha de emisión (mayor que 0, hasta 6 decimales).', campo: 'tipoCambio' });
  }

  // Notas de crédito / débito
  if (tipo === '06' || tipo === '07') {
    const r = entrada.referencia;
    if (!r) problemas.push({ codigo: 'REFERENCIA', mensaje: 'Las notas de crédito y débito deben referenciar el documento original (CAI, número y fecha).', campo: 'referencia' });
    else {
      if (!r.cai?.trim()) problemas.push({ codigo: 'REFERENCIA_CAI', mensaje: 'Falta el CAI del documento referenciado.', campo: 'referencia.cai' });
      if (!r.numero || !esNumeroValido(r.numero)) problemas.push({ codigo: 'REFERENCIA_NUMERO', mensaje: 'Número del documento referenciado inválido.', campo: 'referencia.numero' });
      if (!r.fecha || !esFechaValida(r.fecha)) problemas.push({ codigo: 'REFERENCIA_FECHA', mensaje: 'Fecha del documento referenciado inválida.', campo: 'referencia.fecha' });
      else if (esFechaValida(fecha) && r.fecha > fecha) {
        // Arts. 26 num. 3 c y 28 num. 3 c: la nota consigna los datos de un documento ya emitido; la NC respalda
        // ajustes «efectuados con posterioridad a la emisión del correspondiente Comprobante Fiscal» (Art. 4 num. 32).
        problemas.push({ codigo: 'REFERENCIA_FECHA_POSTERIOR', mensaje: `El documento referenciado (${r.fecha}) no puede tener fecha posterior a la nota (${fecha}).`, campo: 'referencia.fecha' });
      }
      if (r.numero && esNumeroValido(r.numero) && tipo === '06') {
        const tipoRef = parsearNumero(r.numero).tipoDocumento;
        // Art. 4 num. 32: la Nota de Crédito está «vinculada a un Comprobante Fiscal» (los del Art. 6). La Nota de
        // Débito admite «el Comprobante Fiscal o el documento» (Art. 28 num. 3 b), así que no se restringe.
        if (!COMPROBANTES_FISCALES.includes(tipoRef)) {
          problemas.push({
            codigo: 'REFERENCIA_TIPO',
            mensaje: `Una Nota de Crédito se aplica a un Comprobante Fiscal (Art. 6); el documento ${r.numero} es ${TIPOS_DOCUMENTO[tipoRef]}.`,
            campo: 'referencia.numero',
          });
        }
      }
    }
    if (!entrada.motivo?.trim()) problemas.push({ codigo: 'MOTIVO', mensaje: 'Las notas de crédito y débito requieren el motivo.', campo: 'motivo' });
    // Arts. 26 y 28 num. 1 (una sola vez aunque el cliente traiga RTN sin nombre).
    if (!c.nombre?.trim() && !problemas.some((p) => p.codigo === 'CLIENTE_NOMBRE'))
      problemas.push({ codigo: 'CLIENTE_NOMBRE', mensaje: 'Las notas de crédito y débito requieren el nombre del adquirente (Arts. 26 y 28).', campo: 'cliente.nombre' });
    // Arts. 26 y 28 num. 1-2: piden el RTN del adquirente, sin alternativa de CONSUMIDOR FINAL.
    if (!c.rtn) problemas.push({ codigo: 'NOTA_CLIENTE_RTN', mensaje: 'Las notas de crédito y débito requieren el RTN del adquirente (Arts. 26 y 28).', campo: 'cliente.rtn' });
    // Arts. 26 num. 9 y 28 num. 8: moneda nacional Lempira.
    if (moneda !== 'HNL') problemas.push({ codigo: 'NOTA_MONEDA', mensaje: 'Las notas de crédito y débito se emiten en Lempiras (Arts. 26 y 28).', campo: 'moneda' });
  }

  // Líneas y umbral de consumidor final
  const problemasLineas = validarLineas(entrada.lineas);
  problemas.push(...problemasLineas);
  if (problemasLineas.length === 0) {
    const { totales } = calcularCentavos(entrada.lineas, {
      preciosIncluyenISV: entrada.preciosIncluyenISV ?? false,
      exonerado: Boolean(entrada.exoneracion),
      moneda,
    });
    // Comparación exacta: total (centavos) × tipo de cambio (10^-6) contra umbral (centavos × 10^6).
    const totalLempiras6 = totales.total * (tipoCambio ?? ESCALA_TC);
    const umbral = opciones.umbralIdentificacionConsumidorFinal ?? UMBRAL_CONSUMIDOR_FINAL;
    const umbral6 = parsearDecimal(umbral, 2, 'umbralIdentificacionConsumidorFinal') * ESCALA_TC;
    problemas.push(...advertenciasDeCalculo(totales));
    // Art. 11 num. 3: si la factura mezcla ventas exentas (o exoneradas) y gravadas, para el crédito fiscal del
    // comprador solo cuentan las gravadas. Se avisa cuando el comprador se identifica con RTN.
    const noGravado = totales.importeExento + totales.importeExonerado;
    if (c.rtn && noGravado > 0n && totales.baseCreditoFiscal > 0n) {
      problemas.push({
        codigo: 'AVISO_VENTA_MIXTA',
        mensaje: 'Venta mixta: para el crédito fiscal del comprador solo cuenta lo gravado (Art. 11 num. 3), ' +
          `L ${centavosATexto(totales.baseCreditoFiscal)} de base.`,
        campo: 'lineas',
      });
    }
    const identificado = Boolean(c.rtn) || (Boolean(c.nombre?.trim()) && Boolean(c.identificacion?.numero?.trim()));
    if (totalLempiras6 > umbral6 && !identificado) {
      problemas.push({
        codigo: 'CONSUMIDOR_FINAL_IDENTIFICACION',
        mensaje: `Ventas a consumidor final mayores de L ${formatearMonto(umbral)} requieren nombre e identificación del cliente (Art. 11).`,
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
  /** Problemas que el flujo de emisión detectó fuera de la entrada (p. ej. contra el almacén). */
  adicionales: Problema[] = [],
): DocumentoFiscal {
  entrada = { ...entrada, fechaEmision: entrada.fechaEmision ?? hoyHonduras(opciones) };
  const v = validarEntrada(entrada, autorizacion, opciones);
  const errores = [...v.errores, ...adicionales.filter((p) => !esAdvertencia(p))];
  const advertencias = [...v.advertencias, ...adicionales.filter(esAdvertencia)];
  if (!Number.isInteger(correlativo) || correlativo < autorizacion.rangoInicial || correlativo > autorizacion.rangoFinal) {
    errores.push({
      codigo: 'CORRELATIVO_FUERA_DE_RANGO',
      mensaje: `El correlativo ${correlativo} está fuera del rango autorizado ${autorizacion.rangoInicial}–${autorizacion.rangoFinal}.`,
      campo: 'correlativo',
    });
  }
  if (errores.length) throw new ErrorValidacion(errores, advertencias);
  entrada = notaEnLempiras(entrada).entrada;

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
    fechaEmision: entrada.fechaEmision!,
    emisor: { ...entrada.emisor, rtn: limpiarIdentificador(entrada.emisor.rtn) },
    cliente,
    moneda,
    preciosIncluyenISV,
    lineas,
    totales,
    destinoEjemplares: DESTINO_EJEMPLARES,
    advertencias,
    estado: 'EMITIDO',
  };
  if (entrada.horaEmision) doc.horaEmision = entrada.horaEmision;
  if (entrada.exoneracion) doc.exoneracion = entrada.exoneracion;
  if (moneda !== 'HNL') doc.tipoCambio = Number(escaladoATexto(leerTipoCambio(entrada.tipoCambio)!, 6));
  if (entrada.referencia) doc.referencia = entrada.referencia;
  if (entrada.motivo) doc.motivo = entrada.motivo;
  if (entrada.condicionPago) doc.condicionPago = entrada.condicionPago;
  if (entrada.observaciones) doc.observaciones = entrada.observaciones;
  // Documento emitido = inmutable. Corregir es anular (Art. 41) o emitir una nota 06/07.
  return congelar(doc);
}
