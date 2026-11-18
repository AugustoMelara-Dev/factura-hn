/**
 * Tipos del dominio de facturación SAR Honduras.
 * Base normativa: Acuerdo 481-2017 (Reglamento del Régimen de Facturación,
 * Otros Documentos Fiscales y Registro Fiscal de Imprentas) y sus reformas.
 */
import type { Monto } from './dinero';

/**
 * Códigos de tipo de documento fiscal (segmento TT del número de 16 dígitos), según el texto
 * consolidado del Acuerdo 481-2017 tras la reforma del Acuerdo 609-2017. El texto original de 2017
 * usaba otra tabla (07 = Nota de Crédito, 08 = Nota de Débito…): esa tabla ya NO está vigente.
 */
export type CodigoTipoDocumento =
  | '01' // Factura (Art. 10)
  | '04' // Recibo por Honorarios Profesionales (Art. 18)
  | '05' // Comprobante de Retención (Art. 33)
  | '06' // Nota de Crédito (Art. 25)
  | '07' // Nota de Débito (Art. 27)
  | '08' // Guía de Remisión (Art. 29)
  | '09' // Ticket (Art. 17)
  | '10' // Factura Prevalorada (Art. 15)
  | '11' // Boleta de Compra (Art. 20)
  | '12'; // Constancia de Donación (Art. 23)

/** Documentos que esta versión sabe construir, calcular y renderizar. */
export type TipoDocumentoSoportado = '01' | '06' | '07';

/**
 * Tratamiento fiscal de una línea.
 * - `GRAVADO0`: gravado con alícuota cero, p. ej. exportaciones (Reglamento Art. 12: «extender la Factura con
 *   tasa cero»). Se discrimina aparte de lo exento y lo exonerado (Art. 11 num. 1 g y num. 2 e).
 */
export type TratamientoISV = 'ISV15' | 'ISV18' | 'GRAVADO0' | 'EXENTO';

export type Moneda = 'HNL' | 'USD';

/**
 * Datos de identificación del emisor. Todos son obligatorios (Reglamento Art. 10 num. 1; Arts. 25 y 27
 * num. 1 para las notas).
 */
export interface Emisor {
  /** RTN de 14 dígitos (con o sin guiones). Art. 10 num. 1 a. */
  rtn: string;
  /**
   * Nombres y apellidos, o razón o denominación social. Art. 10 num. 1 b: el comerciante individual puede
   * usar aquí el nombre comercial registrado en el RTN.
   */
  razonSocial: string;
  /** Nombre comercial. Art. 10 num. 1 c. Si no tiene uno distinto, repite la razón social. */
  nombreComercial: string;
  /** Dirección de la casa matriz. Art. 10 num. 1 d. */
  direccionCasaMatriz: string;
  /** Dirección del establecimiento donde está el punto de emisión (puede ser la de casa matriz). Art. 10 num. 1 d. */
  direccionEstablecimiento: string;
  /** Número telefónico. Art. 10 num. 1 e. */
  telefono: string;
  /** Correo electrónico registrado en el contrato de adhesión. Art. 10 num. 1 f. */
  correo: string;
}

/**
 * Autorización otorgada por el SAR para un tipo de documento y punto de emisión.
 * El rango se expresa con el correlativo de 8 dígitos (la última parte del número).
 */
export interface AutorizacionCAI {
  /** Clave de Autorización de Impresión, p. ej. "A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4". */
  cai: string;
  tipoDocumento: CodigoTipoDocumento;
  /** Código de establecimiento (3 dígitos). Casa matriz = 000. */
  establecimiento: string | number;
  /** Código de punto de emisión (3 dígitos). */
  puntoEmision: string | number;
  /** Primer correlativo autorizado (1..99999999). */
  rangoInicial: number;
  /** Último correlativo autorizado (1..99999999). */
  rangoFinal: number;
  /** Fecha límite de emisión, formato YYYY-MM-DD. */
  fechaLimiteEmision: string;
}

export type TipoIdentificacion = 'DNI' | 'RTN' | 'PASAPORTE' | 'CARNET_RESIDENTE' | 'OTRO';

export interface Cliente {
  /** Nombre o razón social. Si se omite (y no hay RTN) se imprime "CONSUMIDOR FINAL". */
  nombre?: string;
  /** RTN del cliente. Obligatorio si el cliente necesita la factura como crédito fiscal, costo o gasto. */
  rtn?: string;
  /** Identificación de consumidor final (obligatoria cuando el total supera el umbral, L 10,000 por defecto). */
  identificacion?: { tipo: TipoIdentificacion; numero: string };
  direccion?: string;
}

/**
 * Datos del adquirente exonerado (Reglamento Art. 10 num. 8 y Art. 11 num. 4). Hay dos caminos, «según
 * corresponda» (Art. 11 num. 4):
 * - Orden de Compra Exenta **y** Constancia del Registro de Exonerados; **o**
 * - el número del Registro Único de Personas Naturales del Sector Agroindustrial (RUPNSA, registro de la SAG).
 */
export interface Exoneracion {
  /** Número correlativo de la Orden de Compra Exenta. */
  ordenCompraExenta?: string;
  /** Número correlativo de la Constancia del Registro de Exonerados. */
  constanciaRegistroExonerado?: string;
  /** Número identificativo del registro de la SAG / RUPNSA (sector agroindustrial). */
  registroSAG?: string;
}

export interface LineaEntrada {
  codigo?: string;
  descripcion: string;
  cantidad: Monto;
  /**
   * Precio unitario, hasta 4 decimales. Incluye o no el ISV según `preciosIncluyenISV` del documento.
   * Se recomienda pasarlo como texto ("19.99"); un `number` con más decimales de los permitidos se rechaza.
   */
  precioUnitario: Monto;
  /** Tratamiento fiscal. Por defecto ISV15. */
  isv?: TratamientoISV;
  /** Descuento total de la línea (monto, no porcentaje). */
  descuento?: Monto;
  unidad?: string;
}

/** Referencia al documento que modifica una nota de crédito o débito. */
export interface ReferenciaDocumento {
  cai: string;
  numero: string;
  /** YYYY-MM-DD */
  fecha: string;
}

export interface DocumentoEntrada {
  tipoDocumento?: TipoDocumentoSoportado;
  emisor: Emisor;
  cliente?: Cliente;
  lineas: LineaEntrada[];
  /**
   * YYYY-MM-DD. Se toma del reloj (fecha de hoy en Honduras). Si se envía, debe ser la de hoy:
   * cualquier otra es el error `FECHA_EMISION_NO_ES_HOY` (no se permite retrofechar ni adelantar).
   */
  fechaEmision?: string;
  /** HH:mm opcional. */
  horaEmision?: string;
  /** true si los precios unitarios ya incluyen ISV (típico en POS). Por defecto false. */
  preciosIncluyenISV?: boolean;
  exoneracion?: Exoneracion;
  moneda?: Moneda;
  /** Obligatorio si la moneda no es HNL: lempiras por unidad de moneda extranjera en la fecha de emisión. */
  tipoCambio?: Monto;
  /** Obligatorio para notas de crédito y débito. */
  referencia?: ReferenciaDocumento;
  /** Motivo, obligatorio para notas de crédito y débito. */
  motivo?: string;
  condicionPago?: 'CONTADO' | 'CREDITO';
  observaciones?: string;
}

export interface OpcionesDocumento {
  /** Umbral para exigir identificación del consumidor final. Por defecto 10,000 (Art. 11.2). */
  umbralIdentificacionConsumidorFinal?: Monto;
  /** Validar el formato del CAI de forma estricta (error en lugar de advertencia). Por defecto false. */
  caiEstricto?: boolean;
  /**
   * Reloj del sistema. La fecha de emisión es siempre la de hoy en Honduras (America/Tegucigalpa) según
   * este reloj; no se puede retrofechar (Reglamento Arts. 14 y 43). Inyéctalo en pruebas.
   * Por defecto `() => new Date()`.
   */
  reloj?: () => Date;
}

export interface LineaCalculada {
  codigo?: string;
  descripcion: string;
  cantidad: number;
  unidad?: string;
  precioUnitario: number;
  isv: TratamientoISV;
  descuento: number;
  /** cantidad × precio − descuento, en la misma base que el precio (con o sin ISV). */
  importe: number;
}

export interface Totales {
  /** Descuentos y rebajas otorgados. */
  descuentos: number;
  /** Suma de importes antes de ISV y después de descuentos. */
  subtotal: number;
  importeExonerado: number;
  importeExento: number;
  /** Gravado con alícuota cero (exportaciones, Art. 12). */
  importeGravado0: number;
  importeGravado15: number;
  importeGravado18: number;
  /**
   * Base que respalda crédito fiscal: solo lo gravado al 15 % y al 18 % (Reglamento Art. 11 num. 3: «se
   * reconocerán únicamente las ventas gravadas»). Lo gravado al 0 % no genera ISV que acreditar.
   */
  baseCreditoFiscal: number;
  isv15: number;
  isv18: number;
  total: number;
  /**
   * Con precios con ISV incluido: lo que el total quedó por debajo de la suma de precios para que el ISV
   * sea exactamente la tasa × la base (Ley del ISV Art. 9, decisión D-01). 0 si no hubo ajuste.
   * El POS debe cobrar `total`, que ya lo descuenta.
   */
  ajustePorRedondeo: number;
  /** Total en letras, p. ej. "MIL CIENTO CINCUENTA LEMPIRAS CON 00/100". */
  totalEnLetras: string;
}

export interface DocumentoFiscal {
  tipoDocumento: TipoDocumentoSoportado;
  nombreDocumento: string;
  /** Número de 16 dígitos con formato NNN-NNN-NN-NNNNNNNN. */
  numero: string;
  correlativo: number;
  cai: string;
  /** Rango autorizado formateado, p. ej. "000-001-01-00000001 al 000-001-01-00001000". */
  rangoAutorizado: string;
  fechaLimiteEmision: string;
  fechaEmision: string;
  horaEmision?: string;
  emisor: Emisor;
  cliente: Cliente & { nombreImpreso: string };
  exoneracion?: Exoneracion;
  moneda: Moneda;
  tipoCambio?: number;
  preciosIncluyenISV: boolean;
  lineas: LineaCalculada[];
  totales: Totales;
  referencia?: ReferenciaDocumento;
  motivo?: string;
  condicionPago?: 'CONTADO' | 'CREDITO';
  observaciones?: string;
  destinoEjemplares: string;
  advertencias: Problema[];
  /** EMITIDO al construirse; ANULADO solo mediante `anularDocumento` (Art. 41). */
  estado: EstadoDocumento;
  /** Datos de la anulación, presentes solo si `estado` es ANULADO. */
  anulacion?: { motivo: string; fecha: string; hora: string };
}

export type EstadoDocumento = 'EMITIDO' | 'ANULADO';

export interface Problema {
  codigo: string;
  mensaje: string;
  campo?: string;
}

export interface ResultadoValidacion {
  ok: boolean;
  errores: Problema[];
  advertencias: Problema[];
}
