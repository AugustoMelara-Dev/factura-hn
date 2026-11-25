/**
 * Emisión y anulación atómicas sobre un `AlmacenFiscal`.
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
import { deCentavos, formatearMonto, redondearDecimal } from './dinero';
import { calcularCentavos, type TotalesCentavos } from './calculo';
import { construirDocumento, ErrorValidacion, hoyHonduras, notaEnLempiras, problemaDeOperador, problemaDeTipo } from './documento';
import { limpiarIdentificador, normalizarCAI } from './identificacion';
import { congelar } from './inmutable';
import { esAutorizacionDePrueba, esDocumentoDePrueba } from './modo';
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
  datos: { identificador?: string; numero?: string; actor?: string | undefined; operador?: string | undefined; detalle: Record<string, unknown> },
): EventoAuditoria {
  const e: EventoAuditoria = { tipo, instante: ahora.toISOString(), fecha: fechaHonduras(ahora), detalle: datos.detalle };
  if (datos.identificador) e.identificador = datos.identificador;
  if (datos.numero) e.numero = datos.numero;
  if (datos.actor) e.actor = datos.actor;
  const operador = datos.operador?.trim();
  if (operador) e.operador = operador;
  return e;
}

function exigirOperador(operador: string | undefined) {
  const p = problemaDeOperador(operador);
  if (p) throw new ErrorValidacion([p]);
}

/**
 * Sin almacén no hay dónde reservar el número ni guardar el documento. Se avisa con un error del SDK en lugar
 * del `TypeError` que daría leer `transaccion` de `undefined`.
 */
export function exigirAlmacen(almacen: unknown, operacion: string): asserts almacen is AlmacenFiscal {
  if (!almacen || typeof (almacen as AlmacenFiscal).transaccion !== 'function') {
    throw error(
      'ALMACEN_REQUERIDO',
      `${operacion}: falta el almacén fiscal («almacen»), donde se reservan los números y se guardan los documentos.`,
      'almacen',
    );
  }
}

/** Establecimiento y punto de emisión de una autorización, p. ej. `000-001`. */
function puntoDe(a: Pick<AutorizacionCAI, 'establecimiento' | 'puntoEmision'>): string {
  return `${String(a.establecimiento).padStart(3, '0')}-${String(a.puntoEmision).padStart(3, '0')}`;
}

/** Último correlativo consumido por serie (`NNN-NNN-TT`), o null si no ha emitido. */
export interface EstadoPunto {
  ultimo: (identificador: string) => number | null;
}

/**
 * Las autorizaciones de una serie que todavía pueden emitir: sin las de prueba si el punto de emisión ya tiene
 * alguna autorización real (en cualquier tipo). Desde que el punto pasa a real, su demo queda retirada para
 * siempre; los documentos de prueba ya emitidos no cambian.
 */
export function autorizacionesActivas(deSerie: AutorizacionCAI[], puntoConReal: boolean): AutorizacionCAI[] {
  return puntoConReal ? deSerie.filter((a) => !esAutorizacionDePrueba(a)) : deSerie;
}

/**
 * Problemas de registrar `nueva` junto a las autorizaciones ya registradas. `existentes` trae las del mismo
 * punto de emisión (todos los tipos): las de otro identificador solo cuentan para el modo de prueba.
 *
 * - Una autorización de prueba no entra en un punto que tiene o tuvo una real (`AUTORIZACION_MODO_MEZCLADO`).
 * - Una real sí entra en un punto con autorizaciones de prueba: las retira (`autorizacionesActivas`). Las de
 *   prueba no cuentan para duplicados ni solapes, pero los números que ya usaron documentos de prueba no se
 *   repiten: con `estado`, el rango real debe empezar después del último consumido de su serie
 *   (`RANGO_USADO_EN_PRUEBA`).
 *
 * Dos autorizaciones reales de un mismo identificador no pueden compartir números: cada número del rango
 * pertenece a un solo CAI (Arts. 10 num. 3-5 y 59).
 */
export function validarNuevaAutorizacion(existentes: AutorizacionCAI[], nueva: AutorizacionCAI, estado?: EstadoPunto): Problema[] {
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
  // Producto, no regla fiscal: un punto de emisión pasa de prueba a real, nunca al revés. Así los documentos de
  // prueba no consumen números de una serie real, ni una nota real cita una factura de prueba.
  const punto = puntoDe(nueva);
  const dePrueba = esAutorizacionDePrueba(nueva);
  const real = dePrueba ? existentes.find((a) => puntoDe(a) === punto && !esAutorizacionDePrueba(a)) : undefined;
  if (real) {
    problemas.push({
      codigo: 'AUTORIZACION_MODO_MEZCLADO',
      mensaje: `El punto de emisión ${punto} tiene o tuvo autorizaciones reales (CAI ${real.cai}): no se le puede registrar una de prueba.`,
      campo: 'prueba',
    });
  }
  if (!dePrueba && estado && existentes.some((a) => identificadorDe(a) === id && esAutorizacionDePrueba(a))) {
    const ultimo = estado.ultimo(id);
    if (ultimo !== null && ultimo >= nueva.rangoInicial) {
      problemas.push({
        codigo: 'RANGO_USADO_EN_PRUEBA',
        mensaje:
          `Los correlativos hasta el ${ultimo} de ${id} ya los usaron documentos de prueba y un número no se repite: ` +
          `el rango ${nueva.rangoInicial}–${nueva.rangoFinal} del CAI ${nueva.cai} no se puede registrar en este almacén.`,
        campo: 'rangoInicial',
      });
    }
  }
  for (const a of existentes) {
    if (identificadorDe(a) !== id) continue;
    // La demo que una autorización real retira no le reserva números.
    if (!dePrueba && esAutorizacionDePrueba(a)) continue;
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

/** Opciones de `registrarAutorizacion` y `registrarAutorizacionConAvisos`. */
export interface OpcionesRegistroAutorizacion {
  reloj?: () => Date;
  /** Quién registra (usuario, llave de API), para la bitácora. */
  actor?: string;
  /** Persona que opera, para la bitácora. */
  operador?: string;
}

/** Resultado de `registrarAutorizacionConAvisos`: la autorización guardada y sus avisos. */
export interface RegistroAutorizacion {
  autorizacion: AutorizacionCAI;
  /**
   * Avisos de la autorización (`AVISO_*` de `validarAutorizacion`), p. ej. `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62).
   * No impiden el registro. Sus códigos quedan también en el evento `AUTORIZACION_REGISTRADA` de la bitácora.
   */
  advertencias: Problema[];
}

/**
 * Registra una autorización del SAR (CAI + rango + fecha límite) validando que no se solape. Devuelve la
 * autorización guardada; para recibir también sus avisos, usa `registrarAutorizacionConAvisos`.
 */
export async function registrarAutorizacion(
  almacen: AlmacenFiscal,
  autorizacion: AutorizacionCAI,
  opciones: OpcionesRegistroAutorizacion = {},
): Promise<AutorizacionCAI> {
  exigirAlmacen(almacen, 'registrarAutorizacion');
  return (await registrarAutorizacionConAvisos(almacen, autorizacion, opciones)).autorizacion;
}

/**
 * Igual que `registrarAutorizacion`, y además devuelve los avisos que no impiden el registro, como
 * `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62: vigencia de hasta un año). Muéstralos a quien registra: suelen ser
 * un error al copiar la fecha de la resolución.
 */
export async function registrarAutorizacionConAvisos(
  almacen: AlmacenFiscal,
  autorizacion: AutorizacionCAI,
  opciones: OpcionesRegistroAutorizacion = {},
): Promise<RegistroAutorizacion> {
  exigirAlmacen(almacen, 'registrarAutorizacionConAvisos');
  exigirOperador(opciones.operador);
  const ahora = relojDe(opciones.reloj)();
  return almacen.transaccion(async (tx) => {
    const id = identificadorDe(autorizacion);
    // Todas las series del punto de emisión, en orden fijo: el modo de prueba se decide por punto, no por tipo,
    // y dos registros simultáneos de tipos distintos en el mismo punto no deben validarse a la vez.
    // Orden: primero las notas (06, 07) y después los demás tipos. Una nota de crédito bloquea su serie 06 y
    // luego la del original (problemasDeNotaCredito); si aquí la 01 fuera antes que la 06, una nota y un
    // registro simultáneos se esperarían el uno al otro (deadlock en Postgres).
    const delPunto: AutorizacionCAI[] = [];
    const ultimos = new Map<string, number | null>();
    for (const tipo of ORDEN_DE_BLOQUEO) {
      const serie = identificadorDe({ ...autorizacion, tipoDocumento: tipo });
      ultimos.set(serie, (await tx.bloquearSerie(serie)).ultimo);
      delPunto.push(...(await tx.autorizaciones(serie)));
    }
    const problemas = validarNuevaAutorizacion(delPunto, autorizacion, { ultimo: (serie) => ultimos.get(serie) ?? null });
    if (problemas.length) throw new ErrorValidacion(problemas);
    const normalizada: AutorizacionCAI = {
      ...autorizacion,
      cai: autorizacion.cai.trim().toUpperCase(),
      establecimiento: String(autorizacion.establecimiento).padStart(3, '0'),
      puntoEmision: String(autorizacion.puntoEmision).padStart(3, '0'),
    };
    await tx.guardarAutorizacion(normalizada);
    const advertencias = validarAutorizacion(normalizada).filter(esAdvertencia);
    await tx.registrarEvento(
      evento('AUTORIZACION_REGISTRADA', ahora, {
        identificador: id,
        actor: opciones.actor,
        operador: opciones.operador,
        detalle: {
          cai: normalizada.cai,
          rangoInicial: normalizada.rangoInicial,
          rangoFinal: normalizada.rangoFinal,
          fechaLimiteEmision: normalizada.fechaLimiteEmision,
          advertencias: advertencias.map((p) => p.codigo),
        },
      }),
    );
    return { autorizacion: normalizada, advertencias };
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
 *
 * @param identificador serie `NNN-NNN-TT`, si se conoce: los mensajes la nombran y dicen cómo resolver.
 */
export function elegirAutorizacion(
  autorizaciones: AutorizacionCAI[],
  ultimo: number | null,
  hoy: string,
  identificador?: string,
): { autorizacion: AutorizacionCAI; correlativo: number } | { error: Problema } {
  const serie = identificador ? ` (${nombreDeIdentificador(identificador)}, serie ${identificador})` : '';
  if (autorizaciones.length === 0) {
    const problema: Problema = {
      codigo: 'SIN_AUTORIZACION',
      mensaje: `No hay autorización (CAI) registrada para este punto de emisión y tipo de documento${serie} (Arts. 59-61).`,
    };
    if (identificador) {
      const [est, pto, tipo] = identificador.split('-');
      problema.solucion =
        `Registra el CAI de esa serie una vez: registrarAutorizacion(almacen, { cai, tipoDocumento: '${tipo}', ` +
        `establecimiento: '${est}', puntoEmision: '${pto}', rangoInicial, rangoFinal, fechaLimiteEmision }), con los datos ` +
        'de la resolución del SAR. Para probar sin un CAI real, usa crearFacturadorDemo() de factura-hn/demo.';
    }
    return { error: problema };
  }
  const ordenadas = [...autorizaciones].sort((a, b) => a.rangoInicial - b.rangoInicial);
  // Una serie migrada continúa después de lo emitido fuera del sistema (`ultimoEmitidoAntes`).
  const consumido = Math.max(ultimo ?? 0, ...ordenadas.map((a) => a.ultimoEmitidoAntes ?? 0));
  const siguiente = consumido > 0 ? consumido + 1 : ordenadas[0]!.rangoInicial;
  const vigentes = ordenadas.filter((a) => esFechaValida(a.fechaLimiteEmision) && a.fechaLimiteEmision >= hoy);
  const candidata = vigentes.find((a) => a.rangoFinal >= siguiente);
  if (candidata) return { autorizacion: candidata, correlativo: Math.max(siguiente, candidata.rangoInicial) };
  if (vigentes.length === 0) {
    const ultimaFecha = ordenadas.map((a) => a.fechaLimiteEmision).filter(esFechaValida).sort().pop();
    return {
      error: {
        codigo: 'AUTORIZACION_VENCIDA',
        mensaje: `Todas las autorizaciones de este punto de emisión y tipo${serie} están vencidas` +
          `${ultimaFecha ? ` (la última venció el ${ultimaFecha})` : ''} (Art. 62). Solicita un nuevo CAI.`,
      },
    };
  }
  const ultimaVigente = vigentes[vigentes.length - 1]!;
  return {
    error: {
      codigo: 'RANGO_AGOTADO',
      mensaje: `Se agotaron los rangos autorizados vigentes de este punto de emisión y tipo${serie}: el último número ` +
        `autorizado es el ${ultimaVigente.rangoFinal} (CAI ${ultimaVigente.cai}). Solicita un nuevo CAI.`,
    },
  };
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
   * Persona que opera (p. ej. el cajero), para la bitácora. Para imprimirlo en el documento usa
   * `DocumentoEntrada.operador`.
   */
  operador?: string;
  /**
   * Se ejecuta dentro de la transacción después de guardar el documento: aquí va el asiento contable o de
   * inventario (Art. 53 num. 1) o la bitácora de auditoría. Si lanza, se revierte todo y el número no se
   * consume.
   */
  alEmitir?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
  /** Integración contable o de inventarios (Art. 53 num. 1); corre dentro de la transacción. */
  libroContable?: LibroContable;
}

/** Orden en que `registrarAutorizacion` bloquea las series de un punto: notas primero (ver allí). */
const ORDEN_DE_BLOQUEO = (Object.keys(TIPOS_DOCUMENTO) as Array<AutorizacionCAI['tipoDocumento']>).sort(
  (x, y) => Number(!esNota(x)) - Number(!esNota(y)) || x.localeCompare(y),
);
function esNota(tipo: string): boolean {
  return tipo === '06' || tipo === '07';
}

/**
 * Emite un documento de forma atómica: bloquea la serie, elige la autorización vigente, valida, construye
 * y guarda. Todo o nada.
 *
 * @throws ErrorValidacion con códigos como SIN_AUTORIZACION, RANGO_AGOTADO, AUTORIZACION_VENCIDA,
 *   FECHA_ANTERIOR_AL_ULTIMO o los de `validarEntrada`.
 */
export async function emitir(entrada: DocumentoEntrada, config: OpcionesEmision): Promise<DocumentoFiscal> {
  exigirAlmacen(config?.almacen, 'emitir');
  const tipo = entrada.tipoDocumento ?? '01';
  const problemaTipo = problemaDeTipo(tipo);
  if (problemaTipo) throw new ErrorValidacion([problemaTipo]);
  exigirOperador(config.operador);
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
          operador: config.operador,
          detalle: { ultimaFecha: serie.ultimaFecha, hoy, dias: salto, maximo },
        }),
      );
    }
    let deSerie = await tx.autorizaciones(id);
    // Si la serie tiene demo, se mira si el punto ya pasó a real (en cualquier tipo): entonces la demo está retirada.
    if (deSerie.some((a) => esAutorizacionDePrueba(a))) {
      let puntoConReal = deSerie.some((a) => !esAutorizacionDePrueba(a));
      for (const otro of Object.keys(TIPOS_DOCUMENTO) as Array<AutorizacionCAI['tipoDocumento']>) {
        if (puntoConReal || otro === tipo) continue;
        const otras = await tx.autorizaciones(`${id.slice(0, 7)}-${otro}`);
        puntoConReal = otras.some((a) => !esAutorizacionDePrueba(a));
      }
      deSerie = autorizacionesActivas(deSerie, puntoConReal);
    }
    const eleccion = elegirAutorizacion(deSerie, serie.ultimo, hoy, id);
    if ('error' in eleccion) throw new ErrorValidacion([eleccion.error]);
    if (tipo === '06' || tipo === '07') {
      // La serie del original se bloquea antes de leerlo: una anulación concurrente no lo deja ANULADO con una nota viva
      // (REFERENCIA_ANULADA y DOCUMENTO_CON_NOTAS se deciden bajo el mismo bloqueo). Orden de bloqueo global: la serie de
      // la nota antes que la del original, que nunca es una nota (REFERENCIA_TIPO), así que no hay ciclos.
      await bloquearSerieDelOriginal(tx, entrada);
      entrada = await monedaDelOriginal(tx, entrada);
    }
    const adicionales =
      tipo === '06' || tipo === '07' ? await problemasDeReferencia(tx, entrada, esAutorizacionDePrueba(eleccion.autorizacion)) : [];
    let doc = construirDocumento(entrada, eleccion.autorizacion, eleccion.correlativo, opciones, adicionales);
    if (tipo === '06') {
      // DEC-051: el importe y la tasa se comparan con los totales ya calculados de la nota. Con errores,
      // construirDocumento lanza ErrorValidacion y la transacción se revierte sin consumir número.
      const errores = await problemasDeNotaCredito(tx, entrada, doc);
      if (errores.length) doc = construirDocumento(entrada, eleccion.autorizacion, eleccion.correlativo, opciones, [...adicionales, ...errores]);
    }
    await tx.guardarDocumento(doc);
    await tx.registrarEvento(
      evento('DOCUMENTO_EMITIDO', ahora, {
        identificador: id,
        numero: doc.numero,
        actor: config.actor,
        operador: config.operador,
        detalle: { tipoDocumento: doc.tipoDocumento, cai: doc.cai, total: doc.totales.total },
      }),
    );
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
    /** Persona que opera (p. ej. el cajero), para la bitácora. */
    operador?: string;
    alAnular?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
    libroContable?: LibroContable;
  },
): Promise<DocumentoFiscal> {
  exigirAlmacen(config?.almacen, 'anular');
  exigirOperador(config.operador);
  const ahora = relojDe(config.reloj)();
  return config.almacen.transaccion(async (tx) => {
    await tx.bloquearSerie(identificadorDeNumero(numero));
    const anulado = await anularEnTransaccion(tx, numero, config.motivo, ahora, config.actor, {}, config.operador);
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
  operador?: string,
): Promise<DocumentoFiscal> {
  const doc = await tx.buscarDocumento(numero);
  if (!doc) throw error('DOCUMENTO_NO_ENCONTRADO', `No existe el documento ${numero}.`, 'numero');
  const anulado = anularDocumento(doc, { motivo, reloj: () => ahora });
  if (doc.tipoDocumento !== '06' && doc.tipoDocumento !== '07') {
    // DEC-XXX [REVISAR] (Reglamento Arts. 41 y 4 num. 32): un documento con notas vigentes no se anula; primero se
    // anulan las notas. Es la regla inversa de REFERENCIA_ANULADA (DEC-004). La serie del documento ya está bloqueada,
    // y una nota la bloquea antes de leer el original (`bloquearSerieDelOriginal`): las dos no se cruzan.
    const notas = await notasVigentes(tx, doc);
    if (notas.length) {
      throw error(
        'DOCUMENTO_CON_NOTAS',
        `El documento ${numero} tiene ${notas.length} nota(s) de crédito o débito vigente(s) (${notas.join(', ')}): ` +
          'anula primero las notas (Arts. 41 y 4 num. 32).',
        'numero',
      );
    }
  }
  await tx.guardarAnulacion(anulado);
  await tx.registrarEvento(
    evento('DOCUMENTO_ANULADO', ahora, {
      identificador: identificadorDeNumero(numero),
      numero,
      actor,
      operador,
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
  config: { identificador: string; motivo: string; reloj?: () => Date; actor?: string; operador?: string; libroContable?: LibroContable },
): Promise<DocumentoFiscal[]> {
  exigirAlmacen(almacen, 'corregirFechaAdelantada');
  exigirOperador(config.operador);
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
        config.operador,
      );
      if (config.libroContable) await config.libroContable.registrarAnulacion(anulado, tx);
      anulados.push(anulado);
    }
    await tx.registrarEvento(
      evento('FECHA_ADELANTADA_CORREGIDA', ahora, {
        identificador: id,
        actor: config.actor,
        operador: config.operador,
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
  exigirAlmacen(almacen, 'eventosAuditoria');
  return almacen.transaccion((tx) => tx.eventos(filtro));
}

/** Números de las notas 06/07 no anuladas que modifican `doc`, en orden de número. */
async function notasVigentes(tx: TransaccionFiscal, doc: DocumentoFiscal): Promise<string[]> {
  // El filtro `referencia` es opcional para el adaptador: se vuelve a filtrar aquí.
  const notas = await tx.documentos({ desde: doc.fechaEmision, referencia: doc.numero });
  return notas
    .filter((d) => (d.tipoDocumento === '06' || d.tipoDocumento === '07') && d.estado !== 'ANULADO' && d.referencia?.numero === doc.numero)
    .map((d) => d.numero);
}

/** Bloquea la serie del documento que modifica una nota, si está en el almacén. */
async function bloquearSerieDelOriginal(tx: TransaccionFiscal, entrada: DocumentoEntrada): Promise<void> {
  const r = entrada.referencia;
  if (!r?.numero || !esNumeroValido(r.numero)) return;
  const numero = formatearNumero(parsearNumero(r.numero));
  if (await tx.buscarDocumento(numero)) await tx.bloquearSerie(identificadorDeNumero(numero));
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
async function problemasDeReferencia(tx: TransaccionFiscal, entrada: DocumentoEntrada, notaDePrueba: boolean): Promise<Problema[]> {
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
  // Producto, no regla fiscal: una nota de prueba no modifica un documento real, ni al revés.
  if (esDocumentoDePrueba(original) !== notaDePrueba) {
    problemas.push({
      codigo: 'REFERENCIA_MODO_MEZCLADO',
      mensaje: notaDePrueba
        ? `El documento ${numero} es real: una nota de prueba no lo puede modificar.`
        : `El documento ${numero} es de prueba (sin valor fiscal): una nota real no lo puede modificar.`,
      campo: 'referencia.numero',
    });
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
  // DEC-018: la conversión a lempiras usa la moneda y el tipo de cambio del original.
  const monedaRef = r.moneda ?? 'HNL';
  if (monedaRef !== original.moneda) {
    problemas.push({ codigo: 'REFERENCIA_MONEDA_NO_COINCIDE', mensaje: `El documento ${numero} está en ${original.moneda}, no en ${monedaRef}.`, campo: 'referencia.moneda' });
  } else if (original.moneda !== 'HNL' && original.tipoCambio !== undefined && Number(r.tipoCambio) !== original.tipoCambio) {
    problemas.push({ codigo: 'REFERENCIA_TIPO_CAMBIO_NO_COINCIDE', mensaje: `El tipo de cambio de la referencia no es el del documento ${numero} (L ${original.tipoCambio}).`, campo: 'referencia.tipoCambio' });
  }
  if (!original.cliente.rtn) {
    problemas.push({ codigo: 'AVISO_ORIGINAL_SIN_RTN', mensaje: `El documento ${numero} se emitió sin RTN del adquirente; verifica que la nota corresponde al mismo cliente.`, campo: 'cliente.rtn' });
  }
  return problemas;
}

/**
 * Totales en centavos de lempira del original, por el mismo camino que una nota sobre él: si está en moneda
 * extranjera, sus propias líneas pasan por `notaEnLempiras` (precio × tipo de cambio) y `calcularCentavos`. Así una
 * nota idéntica al original da exactamente sus totales (DEC-XXX). En lempiras son los totales guardados.
 */
function totalesEnLempiras(original: DocumentoFiscal): TotalesCentavos {
  const t = original.totales;
  const c = (v: number) => redondearDecimal(v, 2);
  if (original.moneda === 'HNL' || original.tipoCambio === undefined) {
    return {
      descuentos: c(t.descuentos), subtotal: c(t.subtotal), importeExonerado: c(t.importeExonerado),
      importeExento: c(t.importeExento), importeGravado15: c(t.importeGravado15), importeGravado18: c(t.importeGravado18),
      importeGravado0: c(t.importeGravado0), baseCreditoFiscal: c(t.baseCreditoFiscal), isv15: c(t.isv15), isv18: c(t.isv18),
      total: c(t.total), ajustePorRedondeo: c(t.ajustePorRedondeo),
    };
  }
  const { entrada } = notaEnLempiras({
    tipoDocumento: '06',
    emisor: original.emisor,
    referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision, moneda: original.moneda, tipoCambio: original.tipoCambio },
    lineas: original.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: String(l.cantidad),
      precioUnitario: String(l.precioUnitario),
      isv: l.isv,
      ...(l.descuento ? { descuento: String(l.descuento) } : {}),
    })),
  });
  return calcularCentavos(entrada.lineas, { preciosIncluyenISV: original.preciosIncluyenISV, exonerado: Boolean(original.exoneracion) }).totales;
}

/**
 * DEC-051 [REVISAR], ampliada en DEC-XXX: coherencia de importe y tasa de una nota de crédito con el original guardado
 * en el almacén. El Art. 4 num. 32 (C L.381-385) dice que la nota respalda un ajuste, devolución o descuento sobre el
 * «correspondiente» comprobante: no puede devolver más de lo que se vendió ni a otra tasa. Son errores:
 * - `NOTA_SUPERA_ORIGINAL`: la suma de las notas de crédito vigentes sobre el original, más esta, supera su total o,
 *   en una tasa (15 % o 18 %), su importe gravado o su ISV. Todo en lempiras: un original en moneda extranjera se
 *   convierte por el mismo camino que la nota (`totalesEnLempiras`). El mensaje da el saldo.
 * - `NOTA_TASA_DISTINTA`: la nota lleva ISV a una tasa que el original no tenía, o ISV sobre un original exonerado.
 * Y un aviso, `AVISO_NOTA_EXONERACION_DISTINTA`, si el original es exonerado y la nota no, o al revés.
 * Con un original externo no hay con qué comparar: queda `AVISO_ORIGINAL_EXTERNO` (DEC-004).
 * La serie del original ya está bloqueada (`bloquearSerieDelOriginal`): dos cajas no emiten a la vez notas que
 * juntas lo superen.
 */
async function problemasDeNotaCredito(tx: TransaccionFiscal, entrada: DocumentoEntrada, nota: DocumentoFiscal): Promise<Problema[]> {
  const r = entrada.referencia;
  if (!r?.numero || !esNumeroValido(r.numero)) return [];
  const numero = formatearNumero(parsearNumero(r.numero));
  const original = await tx.buscarDocumento(numero);
  if (!original || original.estado === 'ANULADO') return []; // externo: aviso; anulado: REFERENCIA_ANULADA
  const problemas: Problema[] = [];
  const o = totalesEnLempiras(original);
  const previas = (await tx.documentos({ desde: original.fechaEmision, tipoDocumento: '06', referencia: numero })).filter(
    (d) =>
      d.tipoDocumento === '06' &&
      d.estado !== 'ANULADO' &&
      d.numero !== nota.numero &&
      d.referencia?.numero === numero &&
      // Las notas del otro modo (prueba o real) no cuentan para el saldo.
      esDocumentoDePrueba(d) === esDocumentoDePrueba(nota),
  );
  const suma = (campo: 'total' | 'importeGravado15' | 'importeGravado18' | 'isv15' | 'isv18') =>
    previas.reduce((s, d) => s + redondearDecimal(d.totales[campo], 2), 0n);
  const L = (c: bigint) => `L ${formatearMonto(deCentavos(c < 0n ? 0n : c))}`;
  const acreditado = suma('total');
  const saldo = o.total - acreditado;
  const estaNota = redondearDecimal(nota.totales.total, 2);
  const n = nota.totales;
  const tasaNueva = (n.isv15 > 0 && o.importeGravado15 === 0n) || (n.isv18 > 0 && o.importeGravado18 === 0n);
  const sobreExonerado = o.importeExonerado > 0n && n.isv15 + n.isv18 > 0;
  if (estaNota > saldo) {
    problemas.push({
      codigo: 'NOTA_SUPERA_ORIGINAL',
      mensaje:
        `La nota (${L(estaNota)}) supera el saldo disponible del documento ${numero}: total ${L(o.total)}, ` +
        `ya acreditado ${L(acreditado)} en ${previas.length} nota(s), saldo disponible ${L(saldo)} (Art. 4 num. 32).`,
      campo: 'lineas',
    });
  } else if (!tasaNueva && !sobreExonerado) {
    // DEC-XXX: tope por tasa. La nota no acredita más gravado ni más ISV a una tasa que los que el original tuvo a esa tasa.
    for (const [tasa, base, isv] of [['15', 'importeGravado15', 'isv15'], ['18', 'importeGravado18', 'isv18']] as const) {
      const baseSaldo = o[base] - suma(base);
      const isvSaldo = o[isv] - suma(isv);
      const baseNota = redondearDecimal(n[base], 2);
      const isvNota = redondearDecimal(n[isv], 2);
      if (baseNota > baseSaldo || isvNota > isvSaldo) {
        problemas.push({
          codigo: 'NOTA_SUPERA_ORIGINAL',
          mensaje:
            `Al ${tasa} %, la nota (gravado ${L(baseNota)}, ISV ${L(isvNota)}) supera el saldo del documento ${numero} a esa tasa: ` +
            `gravado ${L(o[base])} e ISV ${L(o[isv])} en el original; saldo disponible: gravado ${L(baseSaldo)} e ISV ${L(isvSaldo)} ` +
            '(Art. 4 num. 32). Usa en cada línea la misma tasa que en el original.',
          campo: 'lineas',
        });
        break;
      }
    }
  }
  if (tasaNueva || sobreExonerado) {
    problemas.push({
      codigo: 'NOTA_TASA_DISTINTA',
      mensaje: sobreExonerado
        ? `El documento ${numero} es exonerado: la nota no puede llevar ISV. Usa en cada línea el mismo tratamiento que en el original.`
        : `La nota lleva ISV a una tasa que el documento ${numero} no tenía. Usa en cada línea la misma tasa que en el original.`,
      campo: 'lineas',
    });
  }
  // DEC-XXX: aviso, no error. Una nota sin exoneración sobre un original exonerado (o al revés) pone el crédito en otra
  // columna del libro de ventas que la venta (exento contra exonerado).
  const originalExonerado = Boolean(original.exoneracion);
  if (originalExonerado !== Boolean(entrada.exoneracion)) {
    problemas.push({
      codigo: 'AVISO_NOTA_EXONERACION_DISTINTA',
      mensaje: originalExonerado
        ? `El documento ${numero} es exonerado y la nota no: en el libro de ventas el crédito queda en otra columna que la venta.`
        : `La nota es exonerada y el documento ${numero} no lo era: en el libro de ventas el crédito queda en otra columna que la venta.`,
      campo: 'exoneracion',
      solucion: originalExonerado
        ? 'Copia en la nota la `exoneracion` del documento original.'
        : 'Quita `exoneracion` de la nota: el documento original no era exonerado.',
    });
  }
  return problemas;
}

/** DEC-018: si el original está en el almacén y en moneda extranjera, completa su moneda y tipo de cambio. */
async function monedaDelOriginal(tx: TransaccionFiscal, entrada: DocumentoEntrada): Promise<DocumentoEntrada> {
  const r = entrada.referencia;
  if (!r?.numero || !esNumeroValido(r.numero) || r.moneda !== undefined) return entrada;
  const original = await tx.buscarDocumento(formatearNumero(parsearNumero(r.numero)));
  if (!original || original.moneda === 'HNL') return entrada;
  return { ...entrada, referencia: { ...r, moneda: original.moneda, tipoCambio: original.tipoCambio } };
}

/** Busca un documento guardado y lo devuelve inmutable. */
export async function buscarDocumento(almacen: AlmacenFiscal, numero: string): Promise<DocumentoFiscal | null> {
  exigirAlmacen(almacen, 'buscarDocumento');
  const doc = await almacen.transaccion((tx) => tx.buscarDocumento(numero));
  return doc ? congelar(doc) : null;
}

/** Nombre del tipo de documento de un identificador `NNN-NNN-TT`. */
export function nombreDeIdentificador(id: string): string {
  return TIPOS_DOCUMENTO[id.slice(8, 10) as keyof typeof TIPOS_DOCUMENTO] ?? id;
}
