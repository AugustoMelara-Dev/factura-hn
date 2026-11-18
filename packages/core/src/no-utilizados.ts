/**
 * Comprobantes y documentos complementarios no utilizados (Reglamento Art. 42, C L.1958-1985).
 *
 * «Los Obligados Tributarios deben comunicar mediante el sistema que la Administración Tributaria establezca,
 * la no utilización de Comprobantes Fiscales y Documentos Complementarios dentro de los primeros diez (10)
 * días hábiles del mes siguiente de haberse producido los siguientes acontecimientos: 1. Cuando se produzca el
 * vencimiento del plazo de vigencia de la autorización …; 5. Por baja del punto de emisión; …»
 *
 * Este módulo calcula **qué** números quedaron sin usar y **hasta cuándo** hay que avisar. El aviso se hace en
 * el sistema del SAR; el SDK no lo envía.
 */
import { diasEntre, esFechaValida, fechaHonduras } from './autorizacion';
import { identificadorDe, type AlmacenFiscal } from './almacen';
import type { AutorizacionCAI } from './tipos';

/** Causales del Art. 42 (numerales 1 a 12). */
export const CAUSALES_NO_UTILIZACION = {
  1: 'Vencimiento del plazo de vigencia de la autorización',
  2: 'Modificación de los datos del obligado tributario consignados en los documentos',
  3: 'Cese temporal o definitivo de operaciones de uno o más establecimientos',
  4: 'Cese de operaciones del obligado tributario',
  5: 'Baja del punto de emisión',
  6: 'Deterioro que impide su utilización',
  7: 'Robo o extravío, con denuncia acreditada',
  8: 'Errores de requisitos de la imprenta detectados después de la entrega',
  9: 'Facturas prevaloradas no utilizadas',
  10: 'Problemas o fallas técnicas en el sistema del obligado tributario',
  11: 'Documentos vencidos y no utilizados',
  12: 'Caso fortuito o fuerza mayor acreditado',
} as const;

export type CausalNoUtilizacion = keyof typeof CAUSALES_NO_UTILIZACION;

export interface RangoNoUtilizado {
  cai: string;
  /** `NNN-NNN-TT` */
  identificador: string;
  desde: number;
  hasta: number;
  cantidad: number;
  causal: CausalNoUtilizacion;
  descripcionCausal: string;
  /** Fecha (YYYY-MM-DD) del acontecimiento que obliga a avisar. */
  fechaEvento: string;
  /** Último día para avisar al SAR: décimo día hábil del mes siguiente al acontecimiento. */
  fechaLimiteAviso: string;
  /** true si `hoy` ya pasó la fecha límite del aviso. */
  avisoVencido: boolean;
}

export interface OpcionesNoUtilizados {
  /** YYYY-MM-DD; por defecto hoy en Honduras. */
  hoy?: string;
  /**
   * Feriados (YYYY-MM-DD) que no cuentan como días hábiles. El SDK no trae calendario de feriados: si no los
   * pasas, solo se descuentan sábados y domingos y la fecha calculada puede quedar uno o dos días después
   * de la real. Pásalos para un cálculo exacto.
   */
  feriados?: string[];
  /**
   * Un acontecimiento distinto del vencimiento (causales 2 a 12) que deja sin uso los números restantes de
   * todas las autorizaciones dadas, vigentes o no. P. ej. `{ causal: 5, fecha: '2026-11-18' }` al dar de
   * baja un punto de emisión.
   */
  evento?: { causal: Exclude<CausalNoUtilizacion, 1>; fecha: string };
}

const sumarDias = (fecha: string, dias: number): string => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Décimo día hábil (lunes a viernes, menos feriados) del mes siguiente a `fecha`. */
export function decimoDiaHabilDelMesSiguiente(fecha: string, feriados: string[] = []): string {
  const [a, m] = fecha.split('-').map(Number) as [number, number];
  const anio = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  let dia = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const libres = new Set(feriados);
  let habiles = 0;
  for (;;) {
    const semana = new Date(`${dia}T00:00:00Z`).getUTCDay();
    if (semana !== 0 && semana !== 6 && !libres.has(dia)) habiles += 1;
    if (habiles === 10) return dia;
    dia = sumarDias(dia, 1);
  }
}

/**
 * Último correlativo consumido. Un número es el último de la serie (sirve si la serie nunca saltó de una
 * autorización vencida a la siguiente); una función da el último emitido **dentro** de cada autorización,
 * que es lo correcto cuando la serie continuó en otra (`noUtilizadosDelAlmacen` la calcula).
 */
export type UltimoConsumido = number | null | ((autorizacion: AutorizacionCAI) => number | null);

/**
 * Rangos sin usar de las autorizaciones de **un** identificador.
 *
 * - Causal 1 (vencimiento): cada autorización cuya fecha límite ya pasó deja sin uso los números
 *   posteriores al último consumido. El acontecimiento es la fecha límite misma (lectura conservadora: la
 *   otra lectura, el día siguiente, puede mover el aviso un mes más tarde).
 * - Con `evento`, los números restantes de las autorizaciones aún vigentes quedan con esa causal.
 */
export function documentosNoUtilizados(
  autorizaciones: AutorizacionCAI[],
  ultimoConsumido: UltimoConsumido,
  opciones: OpcionesNoUtilizados = {},
): RangoNoUtilizado[] {
  const hoy = opciones.hoy ?? fechaHonduras();
  const feriados = opciones.feriados ?? [];
  const resultado: RangoNoUtilizado[] = [];
  const ordenadas = [...autorizaciones].sort((a, b) => a.rangoInicial - b.rangoInicial);
  const global = typeof ultimoConsumido === 'function' ? null : Math.max(ultimoConsumido ?? 0, ...ordenadas.map((a) => a.ultimoEmitidoAntes ?? 0));
  for (const a of ordenadas) {
    const consumido = typeof ultimoConsumido === 'function'
      ? Math.max(ultimoConsumido(a) ?? 0, a.ultimoEmitidoAntes ?? 0)
      : global!;
    const desde = Math.max(a.rangoInicial, consumido + 1);
    if (desde > a.rangoFinal || !esFechaValida(a.fechaLimiteEmision)) continue;
    const vencida = a.fechaLimiteEmision < hoy;
    let causal: CausalNoUtilizacion;
    let fechaEvento: string;
    if (vencida && (!opciones.evento || a.fechaLimiteEmision <= opciones.evento.fecha)) {
      causal = 1;
      fechaEvento = a.fechaLimiteEmision;
    } else if (opciones.evento) {
      causal = opciones.evento.causal;
      fechaEvento = opciones.evento.fecha;
    } else {
      continue; // vigente y sin acontecimiento: todavía se puede usar
    }
    const fechaLimiteAviso = decimoDiaHabilDelMesSiguiente(fechaEvento, feriados);
    resultado.push({
      cai: a.cai,
      identificador: identificadorDe(a),
      desde,
      hasta: a.rangoFinal,
      cantidad: a.rangoFinal - desde + 1,
      causal,
      descripcionCausal: CAUSALES_NO_UTILIZACION[causal],
      fechaEvento,
      fechaLimiteAviso,
      avisoVencido: diasEntre(fechaLimiteAviso, hoy) > 0,
    });
  }
  return resultado;
}

/** `documentosNoUtilizados` leyendo las autorizaciones y la serie de un identificador desde el almacén. */
export async function noUtilizadosDelAlmacen(
  almacen: AlmacenFiscal,
  identificador: string,
  opciones: OpcionesNoUtilizados = {},
): Promise<RangoNoUtilizado[]> {
  return almacen.transaccion(async (tx) => {
    await tx.bloquearSerie(identificador);
    // Último emitido dentro de cada autorización: la serie puede haber saltado los números de una vencida
    // (Arts. 42 y 62) y seguir en la siguiente; esos números saltados son los que hay que reportar.
    const correlativos = (await tx.documentos({ identificador })).map((d) => d.correlativo);
    const ultimoEn = (a: AutorizacionCAI) => {
      let max: number | null = null;
      for (const c of correlativos) if (c >= a.rangoInicial && c <= a.rangoFinal && (max === null || c > max)) max = c;
      return max;
    };
    return documentosNoUtilizados(await tx.autorizaciones(identificador), ultimoEn, opciones);
  });
}
