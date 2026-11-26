/**
 * `crearFacturador`: la configuración del negocio (almacén, emisor, caja) una sola vez, y en cada venta solo lo
 * que es de la venta.
 *
 * Es una fachada, no un segundo camino: cada método llama a `emitir`, `anular`, `registrarAutorizacion` o
 * `buscarDocumento`, con la misma transacción, las mismas validaciones y la misma bitácora.
 */
import { calcularDocumento } from './calculo';
import { congelar } from './inmutable';
import { ErrorValidacion, problemaDePreciosIncluyenISV, validarEmisor } from './documento';
import { conSolucion } from './errores';
import { anular, buscarDocumento, emitir, exigirAlmacen, registrarAutorizacion } from './emision';
import { esNumeroValido, formatearNumero, parsearNumero } from './numeracion';
import type { LibroContable } from './exportacion';
import type { AlmacenFiscal, FiltroDocumentos, TransaccionFiscal } from './almacen';
import type { Monto } from './dinero';
import type {
  AutorizacionCAI,
  Cliente,
  DocumentoEntrada,
  DocumentoFiscal,
  Emisor,
  LineaEntrada,
  ReferenciaDocumento,
} from './tipos';

export interface ConfigFacturador {
  /** Dónde se reservan los números y se guardan los documentos. */
  almacen: AlmacenFiscal;
  /** Los datos del emisor (Art. 10 num. 1). Se validan al crear el facturador. */
  emisor: Emisor;
  /** Código de establecimiento (casa matriz = 000). Por defecto '000'. */
  establecimiento?: string | number;
  /** Código del punto de emisión (la caja). Por defecto '001'. */
  puntoEmision?: string | number;
  /** Reloj; por defecto `() => new Date()`. Inyéctalo en pruebas. */
  reloj?: () => Date;
  /**
   * Si los precios de cada venta ya incluyen el ISV (típico en POS). Por defecto false, igual que `emitir`.
   * Cada venta puede indicarlo por su cuenta.
   */
  preciosIncluyenISV?: boolean;
  /** Quién emite (usuario, caja, llave), para la bitácora. */
  actor?: string;
  /** Integración contable o de inventarios (Art. 53 num. 1); corre dentro de la transacción. */
  libroContable?: LibroContable;
  /** Umbral para exigir identificación del consumidor final. Por defecto L 10,000 (Art. 11). */
  umbralIdentificacionConsumidorFinal?: Monto;
  /** Exigir la forma 6-6-6-6-6-2 del CAI. Por defecto false. */
  caiEstricto?: boolean;
  /** Días máximos desde la última emisión antes de sospechar del reloj. Por defecto 7. */
  saltoMaximoDias?: number;
}

/** Lo de la venta: todo menos el emisor, que pone el facturador. */
export type Venta = Omit<DocumentoEntrada, 'emisor'>;

/** Una nota de crédito o débito sobre un documento. */
export interface NotaEntrada {
  /**
   * Número del documento que modifica. Si está en el almacén, de él se toman el cliente, la referencia (CAI,
   * número, fecha, moneda y tipo de cambio) y `preciosIncluyenISV`. Si no está (talonario u otro sistema),
   * pasa `referencia` y `cliente` completos.
   */
  original: string;
  /** Motivo de la nota (Arts. 26 y 28). */
  motivo: string;
  lineas: LineaEntrada[];
  /** Reemplaza el cliente del original (p. ej. si el original no tiene RTN del adquirente). */
  cliente?: Cliente;
  /** Completa o reemplaza la referencia tomada del original. */
  referencia?: Partial<ReferenciaDocumento>;
  preciosIncluyenISV?: boolean;
  observaciones?: string;
}

/** Opciones de una operación. */
export interface OpcionesOperacion {
  /** Persona que opera (p. ej. el cajero), para la bitácora. */
  operador?: string;
  /** Reemplaza el actor de la configuración en esta operación. */
  actor?: string;
  /** El operador verificó la fecha del dispositivo y acepta un salto mayor que `saltoMaximoDias`. */
  confirmarSaltoDeFecha?: boolean;
  /** Corre dentro de la transacción después de guardar el documento. Si lanza, no se consume el número. */
  alEmitir?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
}

/** Una autorización para la caja del facturador: establecimiento y punto de emisión se toman de él si faltan. */
export type AutorizacionCaja = Omit<AutorizacionCAI, 'establecimiento' | 'puntoEmision'> &
  Partial<Pick<AutorizacionCAI, 'establecimiento' | 'puntoEmision'>>;

export interface Facturador {
  readonly almacen: AlmacenFiscal;
  readonly emisor: Readonly<Emisor>;
  readonly establecimiento: string;
  readonly puntoEmision: string;
  /** Registra una autorización del SAR (una vez por resolución) en esta caja. */
  registrarAutorizacion(autorizacion: AutorizacionCaja, opciones?: { operador?: string; actor?: string }): Promise<AutorizacionCAI>;
  /** Lo que se cobrará, sin emitir ni consumir número. */
  cotizar(venta: Pick<Venta, 'lineas' | 'preciosIncluyenISV' | 'exoneracion' | 'moneda'>): ReturnType<typeof calcularDocumento>;
  /** Emite un documento (factura por defecto) con `emitir`. */
  emitir(venta: Venta, opciones?: OpcionesOperacion): Promise<DocumentoFiscal>;
  /** Emite una nota de crédito (06) sobre un documento. */
  notaCredito(nota: NotaEntrada, opciones?: OpcionesOperacion): Promise<DocumentoFiscal>;
  /** Emite una nota de débito (07) sobre un documento. */
  notaDebito(nota: NotaEntrada, opciones?: OpcionesOperacion): Promise<DocumentoFiscal>;
  /** Anula un documento (Art. 41) con `anular`. El número sigue consumido. */
  anular(numero: string, motivo: string, opciones?: { operador?: string; actor?: string }): Promise<DocumentoFiscal>;
  /** El documento con ese número, o null. */
  documento(numero: string): Promise<DocumentoFiscal | null>;
  /** Los documentos del almacén que cumplen el filtro (todas las cajas), en orden de número. */
  documentos(filtro?: FiltroDocumentos): Promise<DocumentoFiscal[]>;
}

const tres = (v: string | number) => String(v).trim().padStart(3, '0');

/**
 * Crea un facturador para una caja (establecimiento y punto de emisión). Valida el almacén y el emisor al
 * crearlo: un error de configuración sale aquí, no en la primera venta.
 *
 * @throws ErrorValidacion `ALMACEN_REQUERIDO` o `EMISOR_*`.
 */
export function crearFacturador(config: ConfigFacturador): Facturador {
  exigirAlmacen(config?.almacen, 'crearFacturador');
  const problemas = validarEmisor(config.emisor);
  const problemaPrecios = problemaDePreciosIncluyenISV(config.preciosIncluyenISV);
  if (problemaPrecios) problemas.push(conSolucion(problemaPrecios));
  if (problemas.length) throw new ErrorValidacion(problemas);
  const almacen = config.almacen;
  const emisor = congelar(structuredClone(config.emisor));
  const establecimiento = tres(config.establecimiento ?? '000');
  const puntoEmision = tres(config.puntoEmision ?? '001');
  const opcionesDocumento = {
    ...(config.reloj ? { reloj: config.reloj } : {}),
    ...(config.umbralIdentificacionConsumidorFinal !== undefined ? { umbralIdentificacionConsumidorFinal: config.umbralIdentificacionConsumidorFinal } : {}),
    ...(config.caiEstricto !== undefined ? { caiEstricto: config.caiEstricto } : {}),
  };

  const emitirEntrada = (entrada: DocumentoEntrada, o: OpcionesOperacion = {}) =>
    emitir(entrada, {
      almacen,
      establecimiento,
      puntoEmision,
      opciones: opcionesDocumento,
      ...(config.saltoMaximoDias !== undefined ? { saltoMaximoDias: config.saltoMaximoDias } : {}),
      ...(o.confirmarSaltoDeFecha ? { confirmarSaltoDeFecha: true } : {}),
      ...(o.actor ?? config.actor ? { actor: o.actor ?? config.actor } : {}),
      ...(o.operador !== undefined ? { operador: o.operador } : {}),
      ...(o.alEmitir ? { alEmitir: o.alEmitir } : {}),
      ...(config.libroContable ? { libroContable: config.libroContable } : {}),
    });

  const nota = async (tipoDocumento: '06' | '07', n: NotaEntrada, o?: OpcionesOperacion) => {
    const numero = n.original && esNumeroValido(n.original) ? formatearNumero(parsearNumero(n.original)) : n.original;
    const original = numero ? await buscarDocumento(almacen, numero) : null;
    let cliente = n.cliente;
    let referencia: Partial<ReferenciaDocumento> = { ...n.referencia };
    let preciosIncluyenISV = n.preciosIncluyenISV;
    if (original) {
      // Lo que la nota repite del original (Arts. 26 y 28 num. 1-3). `emitir` lo vuelve a comparar con lo guardado.
      const { nombreImpreso: _impreso, ...delOriginal } = original.cliente;
      cliente ??= delOriginal;
      referencia = {
        cai: original.cai,
        numero: original.numero,
        fecha: original.fechaEmision,
        ...(original.moneda !== 'HNL' ? { moneda: original.moneda, tipoCambio: original.tipoCambio } : {}),
        ...n.referencia,
      };
      preciosIncluyenISV ??= original.preciosIncluyenISV;
    } else {
      referencia = { numero, ...n.referencia };
    }
    return emitirEntrada(
      {
        tipoDocumento,
        emisor,
        lineas: n.lineas,
        motivo: n.motivo,
        referencia: referencia as ReferenciaDocumento,
        ...(cliente ? { cliente } : {}),
        preciosIncluyenISV: preciosIncluyenISV ?? config.preciosIncluyenISV ?? false,
        ...(n.observaciones ? { observaciones: n.observaciones } : {}),
      },
      o,
    );
  };

  return {
    almacen,
    emisor,
    establecimiento,
    puntoEmision,
    registrarAutorizacion: (a, o = {}) =>
      registrarAutorizacion(
        almacen,
        { ...a, establecimiento: a.establecimiento ?? establecimiento, puntoEmision: a.puntoEmision ?? puntoEmision },
        {
          ...(config.reloj ? { reloj: config.reloj } : {}),
          ...(o.actor ?? config.actor ? { actor: o.actor ?? config.actor } : {}),
          ...(o.operador !== undefined ? { operador: o.operador } : {}),
        },
      ),
    cotizar: (venta) => {
      const problema = problemaDePreciosIncluyenISV(venta.preciosIncluyenISV);
      if (problema) throw new ErrorValidacion([problema]);
      return calcularDocumento(venta.lineas, {
        preciosIncluyenISV: venta.preciosIncluyenISV ?? config.preciosIncluyenISV ?? false,
        exonerado: Boolean(venta.exoneracion),
        moneda: venta.moneda ?? 'HNL',
      });
    },
    emitir: (venta, o) =>
      emitirEntrada({ ...venta, emisor, preciosIncluyenISV: venta.preciosIncluyenISV ?? config.preciosIncluyenISV ?? false }, o),
    notaCredito: (n, o) => nota('06', n, o),
    notaDebito: (n, o) => nota('07', n, o),
    anular: (numero, motivo, o = {}) =>
      anular(numero, {
        almacen,
        motivo,
        ...(config.reloj ? { reloj: config.reloj } : {}),
        ...(o.actor ?? config.actor ? { actor: o.actor ?? config.actor } : {}),
        ...(o.operador !== undefined ? { operador: o.operador } : {}),
        ...(config.libroContable ? { libroContable: config.libroContable } : {}),
      }),
    documento: (numero) => buscarDocumento(almacen, numero),
    documentos: async (filtro = {}) => (await almacen.transaccion((tx) => tx.documentos(filtro))).map((d) => congelar(d)),
  };
}
