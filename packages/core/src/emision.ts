/**
 * Emisión y anulación atómicas sobre un `AlmacenFiscal` (docs/investigacion.md, B-04 y B-18).
 */
import type { LibroContable } from './exportacion';
import { anularDocumento } from './anulacion';
import { diasEntre, esAdvertencia, esFechaValida, fechaHonduras, validarAutorizacion } from './autorizacion';
import {
  identificadorDe,
  identificadorDeNumero,
  type AlmacenFiscal,
  type EventoAuditoria,
  type FiltroEventos,
  type TipoEventoAuditoria,
  type TransaccionFiscal,
} from './almacen';
import { construirDocumento, ErrorValidacion, hoyHonduras, problemaDeTipo } from './documento';
import { limpiarIdentificador, normalizarCAI } from './identificacion';
import { congelar } from './inmutable';
import { esNumeroValido, formatearNumero, parsearNumero, TIPOS_DOCUMENTO } from './numeracion';
import type { AutorizacionCAI, DocumentoEntrada, DocumentoFiscal, OpcionesDocumento, Problema } from './tipos';

function error(codigo: string, mensaje: string, campo?: string): ErrorValidacion {
  return new ErrorValidacion([{ codigo, mensaje, ...(campo ? { campo } : {}) }]);
}

/** Días máximos entre la última emisión de una serie y hoy antes de sospechar del reloj. */
export const SALTO_MAXIMO_DIAS = 7;

const relojDe = (reloj?: () => Date) => reloj ?? (() => new Date());

function evento(
  tipo: TipoEventoAuditoria,
  ahora: Date,
  datos: { identificador?: string; numero?: string; actor?: string | undefined; detalle: Record<string, unknown> },
): EventoAuditoria {
  const e: EventoAuditoria = { tipo, instante: ahora.toISOString(), fecha: fechaHonduras(ahora), detalle: datos.detalle };
  if (datos.identificador) e.identificador = datos.identificador;
  if (datos.numero) e.numero = datos.numero;
  if (datos.actor) e.actor = datos.actor;
  return e;
}

/**
 * Problemas de registrar `nueva` junto a las autorizaciones ya registradas del mismo identificador.
 * Dos autorizaciones de un mismo identificador no pueden compartir números: cada número del rango
 * pertenece a un solo CAI (Arts. 10 num. 3-5 y 59).
 */
export function validarNuevaAutorizacion(existentes: AutorizacionCAI[], nueva: AutorizacionCAI): Problema[] {
  const problemas = validarAutorizacion(nueva).filter((p) => !esAdvertencia(p));
  // B-15: no se registran autorizaciones de documentos que un sistema no puede emitir (Arts. 4.43, 46 y 47).
  const tipo = problemaDeTipo(nueva.tipoDocumento);
  if (tipo?.codigo === 'TIPO_NO_EMITIBLE') problemas.push(tipo);
  if (nueva.ultimoEmitidoAntes !== undefined) {
    const u = nueva.ultimoEmitidoAntes;
    if (!Number.isInteger(u) || u < nueva.rangoInicial - 1 || u > nueva.rangoFinal) {
      problemas.push({
        codigo: 'ULTIMO_EMITIDO_ANTES',
        mensaje: `ultimoEmitidoAntes (${u}) debe estar entre ${nueva.rangoInicial - 1} y ${nueva.rangoFinal}.`,
        campo: 'ultimoEmitidoAntes',
      });
    }
  }
  const id = identificadorDe(nueva);
  for (const a of existentes) {
    if (identificadorDe(a) !== id) continue;
    if (a.cai.trim().toUpperCase() === nueva.cai.trim().toUpperCase()) {
      problemas.push({ codigo: 'AUTORIZACION_DUPLICADA', mensaje: `El CAI ${nueva.cai} ya está registrado para ${id}.`, campo: 'cai' });
    } else if (nueva.rangoInicial <= a.rangoFinal && a.rangoInicial <= nueva.rangoFinal) {
      problemas.push({
        codigo: 'RANGO_SOLAPADO',
        mensaje: `El rango ${nueva.rangoInicial}–${nueva.rangoFinal} se solapa con el del CAI ${a.cai} (${a.rangoInicial}–${a.rangoFinal}) en ${id}.`,
        campo: 'rangoInicial',
      });
    }
  }
  return problemas;
}

/** Registra una autorización del SAR (CAI + rango + fecha límite) validando que no se solape. */
export async function registrarAutorizacion(
  almacen: AlmacenFiscal,
  autorizacion: AutorizacionCAI,
  opciones: { reloj?: () => Date; actor?: string } = {},
): Promise<AutorizacionCAI> {
  const ahora = relojDe(opciones.reloj)();
  return almacen.transaccion(async (tx) => {
    const id = identificadorDe(autorizacion);
    await tx.bloquearSerie(id);
    const problemas = validarNuevaAutorizacion(await tx.autorizaciones(id), autorizacion);
    if (problemas.length) throw new ErrorValidacion(problemas);
    const normalizada: AutorizacionCAI = {
      ...autorizacion,
      cai: autorizacion.cai.trim().toUpperCase(),
      establecimiento: String(autorizacion.establecimiento).padStart(3, '0'),
      puntoEmision: String(autorizacion.puntoEmision).padStart(3, '0'),
    };
    await tx.guardarAutorizacion(normalizada);
    await tx.registrarEvento(
      evento('AUTORIZACION_REGISTRADA', ahora, {
        identificador: id,
        actor: opciones.actor,
        detalle: {
          cai: normalizada.cai,
          rangoInicial: normalizada.rangoInicial,
          rangoFinal: normalizada.rangoFinal,
          fechaLimiteEmision: normalizada.fechaLimiteEmision,
        },
      }),
    );
    return normalizada;
  });
}

/**
 * Elige la autorización y el correlativo siguientes para una serie.
 *
 * - Siguiente número = último consumido + 1 (o el inicio de la primera autorización si la serie está vacía).
 * - Se usa la autorización **vigente** (fecha límite ≥ hoy, Art. 62) de menor inicio que todavía tenga
 *   números ≥ ese siguiente. Si su rango empieza más adelante, se salta hasta su inicio: los números
 *   saltados pertenecen a autorizaciones vencidas que se reportan como no utilizados (Art. 42); nunca se
 *   emiten.
 */
export function elegirAutorizacion(
  autorizaciones: AutorizacionCAI[],
  ultimo: number | null,
  hoy: string,
): { autorizacion: AutorizacionCAI; correlativo: number } | { error: Problema } {
  if (autorizaciones.length === 0) {
    return { error: { codigo: 'SIN_AUTORIZACION', mensaje: 'No hay autorización (CAI) registrada para este punto de emisión y tipo de documento (Arts. 59-61).' } };
  }
  const ordenadas = [...autorizaciones].sort((a, b) => a.rangoInicial - b.rangoInicial);
  // Una serie migrada continúa después de lo emitido fuera del sistema (`ultimoEmitidoAntes`).
  const consumido = Math.max(ultimo ?? 0, ...ordenadas.map((a) => a.ultimoEmitidoAntes ?? 0));
  const siguiente = consumido > 0 ? consumido + 1 : ordenadas[0]!.rangoInicial;
  const vigentes = ordenadas.filter((a) => esFechaValida(a.fechaLimiteEmision) && a.fechaLimiteEmision >= hoy);
  const candidata = vigentes.find((a) => a.rangoFinal >= siguiente);
  if (candidata) return { autorizacion: candidata, correlativo: Math.max(siguiente, candidata.rangoInicial) };
  if (vigentes.length === 0) {
    return { error: { codigo: 'AUTORIZACION_VENCIDA', mensaje: 'Todas las autorizaciones de este punto de emisión y tipo están vencidas (Art. 62). Solicita un nuevo CAI.' } };
  }
  return { error: { codigo: 'RANGO_AGOTADO', mensaje: 'Se agotaron los rangos autorizados vigentes de este punto de emisión y tipo. Solicita un nuevo CAI.' } };
}

export interface OpcionesEmision {
  almacen: AlmacenFiscal;
  /** Código de establecimiento (casa matriz = 000). */
  establecimiento: string | number;
  /** Código del punto de emisión (caja, dispositivo o sistema). */
  puntoEmision: string | number;
  opciones?: OpcionesDocumento;
  /**
   * Días máximos desde la última emisión de la serie antes de rechazar por reloj sospechoso. Por defecto
   * `SALTO_MAXIMO_DIAS` (7).
   */
  saltoMaximoDias?: number;
  /**
   * El operador verificó que la fecha del dispositivo es correcta (p. ej. el negocio estuvo cerrado) y
   * acepta un salto mayor que `saltoMaximoDias`. Queda en la bitácora como SALTO_DE_FECHA_CONFIRMADO.
   */
  confirmarSaltoDeFecha?: boolean;
  /** Quién emite (usuario, caja, llave de API), para la bitácora. */
  actor?: string;
  /**
   * Se ejecuta dentro de la transacción después de guardar el documento: aquí va el asiento contable o de
   * inventario (Art. 53 num. 1) o la bitácora de auditoría. Si lanza, se revierte todo y el número no se
   * consume.
   */
  alEmitir?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
  /** Integración contable o de inventarios (Art. 53 num. 1); corre dentro de la transacción. */
  libroContable?: LibroContable;
}

/**
 * Emite un documento de forma atómica: bloquea la serie, elige la autorización vigente, valida, construye
 * y guarda. Todo o nada.
 *
 * @throws ErrorValidacion con códigos como SIN_AUTORIZACION, RANGO_AGOTADO, AUTORIZACION_VENCIDA,
 *   FECHA_ANTERIOR_AL_ULTIMO o los de `validarEntrada`.
 */
export async function emitir(entrada: DocumentoEntrada, config: OpcionesEmision): Promise<DocumentoFiscal> {
  const tipo = entrada.tipoDocumento ?? '01';
  const problemaTipo = problemaDeTipo(tipo);
  if (problemaTipo) throw new ErrorValidacion([problemaTipo]);
  const id = identificadorDe({ establecimiento: config.establecimiento, puntoEmision: config.puntoEmision, tipoDocumento: tipo });
  // Un solo instante para toda la emisión: validación, elección de autorización y documento usan la misma fecha.
  const ahora = (config.opciones?.reloj ?? (() => new Date()))();
  const opciones: OpcionesDocumento = { ...config.opciones, reloj: () => ahora };
  const hoy = hoyHonduras(opciones);
  return config.almacen.transaccion(async (tx) => {
    const serie = await tx.bloquearSerie(id);
    // Art. 43 (C L.1992-1996): los documentos se archivan «de forma ordenada, cronológica». Como el
    // correlativo ordena el archivo, la fecha de un documento válido no puede ser anterior a la del último
    // documento válido de la serie.
    if (serie.ultimaFecha && serie.ultimaFecha > hoy) {
      throw error(
        'FECHA_ANTERIOR_AL_ULTIMO',
        `El último documento válido de ${id} tiene fecha ${serie.ultimaFecha}, posterior a hoy (${hoy}). ` +
          'Si el reloj de este dispositivo está atrasado, corrígelo. Si aquel documento se emitió con el reloj ' +
          'adelantado, anúlalo con corregirFechaAdelantada (Arts. 41 y 43).',
        'fechaEmision',
      );
    }
    // Prevención: un salto grande desde la última emisión suele ser un reloj adelantado. Emitir con esa
    // fecha trabaría la serie hasta que llegue (regla anterior), así que se pide corregir o confirmar.
    const salto = serie.ultimaFecha ? diasEntre(serie.ultimaFecha, hoy) : 0;
    const maximo = config.saltoMaximoDias ?? SALTO_MAXIMO_DIAS;
    if (salto > maximo) {
      if (!config.confirmarSaltoDeFecha) {
        throw error(
          'RELOJ_ADELANTADO_SOSPECHOSO',
          `La fecha de este dispositivo (${hoy}) está ${salto} días después de la última emisión de ${id} ` +
            `(${serie.ultimaFecha}). Revisa el reloj del dispositivo. Si la fecha es correcta (por ejemplo, el ` +
            'negocio estuvo cerrado), confirma el salto de fecha y vuelve a emitir.',
          'fechaEmision',
        );
      }
      await tx.registrarEvento(
        evento('SALTO_DE_FECHA_CONFIRMADO', ahora, {
          identificador: id,
          actor: config.actor,
          detalle: { ultimaFecha: serie.ultimaFecha, hoy, dias: salto, maximo },
        }),
      );
    }
    const eleccion = elegirAutorizacion(await tx.autorizaciones(id), serie.ultimo, hoy);
    if ('error' in eleccion) throw new ErrorValidacion([eleccion.error]);
    const adicionales = tipo === '06' || tipo === '07' ? await problemasDeReferencia(tx, entrada) : [];
    const doc = construirDocumento(entrada, eleccion.autorizacion, eleccion.correlativo, opciones, adicionales);
    await tx.guardarDocumento(doc);
    if (config.libroContable) await config.libroContable.registrarEmision(doc, tx);
    if (config.alEmitir) await config.alEmitir(doc, tx);
    return doc;
  });
}

/**
 * Anula un documento guardado (Art. 41): guarda su forma ANULADA en una transacción. El número sigue
 * consumido.
 */
export async function anular(
  numero: string,
  config: {
    almacen: AlmacenFiscal;
    motivo: string;
    reloj?: () => Date;
    actor?: string;
    alAnular?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
    libroContable?: LibroContable;
  },
): Promise<DocumentoFiscal> {
  const ahora = relojDe(config.reloj)();
  return config.almacen.transaccion(async (tx) => {
    await tx.bloquearSerie(identificadorDeNumero(numero));
    const anulado = await anularEnTransaccion(tx, numero, config.motivo, ahora, config.actor);
    if (config.libroContable) await config.libroContable.registrarAnulacion(anulado, tx);
    if (config.alAnular) await config.alAnular(anulado, tx);
    return anulado;
  });
}

async function anularEnTransaccion(
  tx: TransaccionFiscal,
  numero: string,
  motivo: string,
  ahora: Date,
  actor: string | undefined,
  detalle: Record<string, unknown> = {},
): Promise<DocumentoFiscal> {
  const doc = await tx.buscarDocumento(numero);
  if (!doc) throw error('DOCUMENTO_NO_ENCONTRADO', `No existe el documento ${numero}.`, 'numero');
  const anulado = anularDocumento(doc, { motivo, reloj: () => ahora });
  await tx.guardarAnulacion(anulado);
  await tx.registrarEvento(
    evento('DOCUMENTO_ANULADO', ahora, {
      identificador: identificadorDeNumero(numero),
      numero,
      actor,
      detalle: { motivo: anulado.anulacion!.motivo, fechaEmision: doc.fechaEmision, total: doc.totales.total, ...detalle },
    }),
  );
  return anulado;
}

/**
 * Procedimiento para salir del bloqueo por reloj adelantado (Arts. 41 y 43), sin borrar ni editar nada.
 *
 * Si una caja emitió con el reloj adelantado, sus documentos llevan una fecha futura y la serie rechaza los
 * documentos de hoy (`FECHA_ANTERIOR_AL_ULTIMO`). Con el reloj ya corregido, esta función, en una sola
 * transacción:
 * 1. bloquea la serie y busca los documentos EMITIDOS con fecha de emisión posterior a hoy;
 * 2. los anula (Art. 41: emisión con errores; la fecha es un dato del documento), conservando número y
 *    contenido, con un motivo que deja constancia de la fecha errónea;
 * 3. registra en la bitácora un DOCUMENTO_ANULADO por cada uno y un FECHA_ADELANTADA_CORREGIDA con el resumen.
 *
 * Desde ahí la referencia cronológica de la serie es el último documento válido y se puede emitir con la
 * fecha real. Si la venta fue real, emite un documento nuevo con la fecha correcta y recupera el original
 * del documento anulado si es posible (Art. 41: resguardo de original y copia).
 *
 * @throws ErrorValidacion `SIN_DOCUMENTOS_ADELANTADOS` si no hay documentos con fecha futura.
 */
export async function corregirFechaAdelantada(
  almacen: AlmacenFiscal,
  config: { identificador: string; motivo: string; reloj?: () => Date; actor?: string; libroContable?: LibroContable },
): Promise<DocumentoFiscal[]> {
  const motivo = config.motivo?.trim();
  if (!motivo) {
    throw error('ANULACION_MOTIVO', 'La corrección requiere un motivo (por ejemplo, qué pasó con el reloj).', 'motivo');
  }
  const ahora = relojDe(config.reloj)();
  const hoy = fechaHonduras(ahora);
  const id = config.identificador;
  return almacen.transaccion(async (tx) => {
    await tx.bloquearSerie(id);
    const adelantados = (await tx.documentos({ identificador: id, desde: hoy })).filter(
      (d) => d.estado === 'EMITIDO' && d.fechaEmision > hoy,
    );
    if (adelantados.length === 0) {
      throw error(
        'SIN_DOCUMENTOS_ADELANTADOS',
        `${id} no tiene documentos emitidos con fecha posterior a hoy (${hoy}).`,
        'identificador',
      );
    }
    const anulados: DocumentoFiscal[] = [];
    for (const d of adelantados) {
      const anulado = await anularEnTransaccion(
        tx,
        d.numero,
        `Fecha de emisión errónea (${d.fechaEmision}) por reloj adelantado; fecha real ${hoy}. ${motivo}`,
        ahora,
        config.actor,
        { causa: 'FECHA_ADELANTADA' },
      );
      if (config.libroContable) await config.libroContable.registrarAnulacion(anulado, tx);
      anulados.push(anulado);
    }
    await tx.registrarEvento(
      evento('FECHA_ADELANTADA_CORREGIDA', ahora, {
        identificador: id,
        actor: config.actor,
        detalle: {
          hoy,
          motivo,
          numeros: adelantados.map((d) => d.numero),
          fechasErroneas: adelantados.map((d) => d.fechaEmision),
        },
      }),
    );
    return anulados;
  });
}

/** La bitácora de auditoría, en orden de registro. */
export async function eventosAuditoria(almacen: AlmacenFiscal, filtro: FiltroEventos = {}): Promise<EventoAuditoria[]> {
  return almacen.transaccion((tx) => tx.eventos(filtro));
}

/**
 * Coherencia de una nota 06/07 con el documento que modifica, contra lo guardado en el almacén (B-13).
 *
 * - Si el original está en el almacén: no puede estar ANULADO (Art. 41: un anulado no respalda operación
 *   que ajustar) y su CAI, fecha y RTN del adquirente deben coincidir con los de la nota (Arts. 26 y 28
 *   num. 1-3: la nota identifica al adquirente y los datos del comprobante al que se aplica).
 * - Si no está: `AVISO_ORIGINAL_EXTERNO` (DEC-004), salvo que el número pertenezca a una autorización que
 *   este sistema administra y no se haya consumido (`REFERENCIA_NO_EXISTE`).
 */
async function problemasDeReferencia(tx: TransaccionFiscal, entrada: DocumentoEntrada): Promise<Problema[]> {
  const r = entrada.referencia;
  if (!r?.numero || !esNumeroValido(r.numero)) return []; // validarEntrada ya lo reporta
  const partes = parsearNumero(r.numero);
  const numero = formatearNumero(partes);
  const original = await tx.buscarDocumento(numero);
  const problemas: Problema[] = [];
  if (!original) {
    // DEC-004: un original que no está en el almacén (talonario de imprenta, otro sistema, emisiones
    // anteriores a la migración) se acepta con la referencia completa y un aviso. La única excepción es un
    // número que este sistema administra y todavía no ha consumido: ese documento no puede existir.
    const auts = await tx.autorizaciones(identificadorDeNumero(numero));
    const propia = auts.find((a) => partes.correlativo >= a.rangoInicial && partes.correlativo <= a.rangoFinal);
    if (propia && partes.correlativo > (propia.ultimoEmitidoAntes ?? propia.rangoInicial - 1)) {
      problemas.push({
        codigo: 'REFERENCIA_NO_EXISTE',
        mensaje: `El documento ${numero} no existe: su número pertenece a una autorización que administra este sistema y no se ha emitido.`,
        campo: 'referencia.numero',
      });
    } else {
      problemas.push({
        codigo: 'AVISO_ORIGINAL_EXTERNO',
        mensaje: `El documento ${numero} no está en este sistema (talonario, otro sistema o emisión anterior a la migración); no se pudo verificar contra el original.`,
        campo: 'referencia.numero',
      });
    }
    return problemas;
  }
  if (original.estado === 'ANULADO') {
    problemas.push({ codigo: 'REFERENCIA_ANULADA', mensaje: `El documento ${numero} está ANULADO (Art. 41); no se le puede aplicar una nota.`, campo: 'referencia.numero' });
  }
  if (r.cai && normalizarCAI(r.cai) !== original.cai) {
    problemas.push({ codigo: 'REFERENCIA_CAI_NO_COINCIDE', mensaje: `El CAI de la referencia no es el del documento ${numero} (${original.cai}).`, campo: 'referencia.cai' });
  }
  if (r.fecha && r.fecha !== original.fechaEmision) {
    problemas.push({ codigo: 'REFERENCIA_FECHA_NO_COINCIDE', mensaje: `La fecha de la referencia (${r.fecha}) no es la del documento ${numero} (${original.fechaEmision}).`, campo: 'referencia.fecha' });
  }
  const rtnNota = entrada.cliente?.rtn ? limpiarIdentificador(entrada.cliente.rtn) : '';
  if (original.cliente.rtn && rtnNota && rtnNota !== original.cliente.rtn) {
    problemas.push({ codigo: 'REFERENCIA_RTN_NO_COINCIDE', mensaje: `El RTN del adquirente no es el del documento ${numero} (${original.cliente.rtn}).`, campo: 'cliente.rtn' });
  }
  if (!original.cliente.rtn) {
    problemas.push({ codigo: 'AVISO_ORIGINAL_SIN_RTN', mensaje: `El documento ${numero} se emitió sin RTN del adquirente; verifica que la nota corresponde al mismo cliente.`, campo: 'cliente.rtn' });
  }
  return problemas;
}

/** Busca un documento guardado y lo devuelve inmutable. */
export async function buscarDocumento(almacen: AlmacenFiscal, numero: string): Promise<DocumentoFiscal | null> {
  const doc = await almacen.transaccion((tx) => tx.buscarDocumento(numero));
  return doc ? congelar(doc) : null;
}

/** Nombre del tipo de documento de un identificador `NNN-NNN-TT`. */
export function nombreDeIdentificador(id: string): string {
  return TIPOS_DOCUMENTO[id.slice(8, 10) as keyof typeof TIPOS_DOCUMENTO] ?? id;
}
