/**
 * Control de vigencia y consumo de una autorización (CAI + rango + fecha límite).
 */
import type { AutorizacionCAI, Problema } from './tipos';
import { CORRELATIVO_MAXIMO, TIPOS_DOCUMENTO } from './numeracion';
import { esCAIValido, normalizarCAI, PATRON_CAI_BASICO } from './identificacion';

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaValida(fecha: string): boolean {
  if (!PATRON_FECHA.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/** Fecha actual en Honduras (America/Tegucigalpa) como YYYY-MM-DD. */
export function fechaHonduras(fecha: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
  return partes; // en-CA ya produce YYYY-MM-DD
}

/** Hora actual en Honduras como HH:mm. */
export function horaHonduras(fecha: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Tegucigalpa',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

/** Días calendario de `desde` a `hasta` (fechas YYYY-MM-DD). */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Problemas estructurales de una autorización (independientes de la fecha y del consumo). */
export function validarAutorizacion(aut: AutorizacionCAI, opciones: { caiEstricto?: boolean } = {}): Problema[] {
  const problemas: Problema[] = [];
  if (!aut.cai || !aut.cai.trim()) {
    problemas.push({ codigo: 'CAI_REQUERIDO', mensaje: 'La autorización no tiene CAI.', campo: 'cai' });
  } else if (!PATRON_CAI_BASICO.test(normalizarCAI(aut.cai))) {
    // B-09: sin fuente para el formato, por defecto solo se rechaza lo que no puede ser un código
    // (espacios internos, signos), que suele ser un error de digitación.
    problemas.push({
      codigo: 'CAI_FORMATO',
      mensaje: `El CAI "${aut.cai}" solo puede tener letras, dígitos y guiones entre grupos. Cópialo tal como viene en la resolución del SAR.`,
      campo: 'cai',
    });
  } else if (opciones.caiEstricto && !esCAIValido(aut.cai)) {
    problemas.push({
      codigo: 'CAI_FORMATO',
      mensaje: `El CAI "${aut.cai}" no tiene la forma 6-6-6-6-6-2 hexadecimal exigida con caiEstricto.`,
      campo: 'cai',
    });
  }
  if (!(aut.tipoDocumento in TIPOS_DOCUMENTO)) {
    problemas.push({ codigo: 'TIPO_DOCUMENTO', mensaje: `Tipo de documento desconocido: ${aut.tipoDocumento}`, campo: 'tipoDocumento' });
  }
  if (!/^\d{1,3}$/.test(String(aut.establecimiento))) {
    problemas.push({ codigo: 'ESTABLECIMIENTO', mensaje: 'Establecimiento debe tener hasta 3 dígitos.', campo: 'establecimiento' });
  }
  if (!/^\d{1,3}$/.test(String(aut.puntoEmision))) {
    problemas.push({ codigo: 'PUNTO_EMISION', mensaje: 'Punto de emisión debe tener hasta 3 dígitos.', campo: 'puntoEmision' });
  }
  const enRango = (n: number) => Number.isInteger(n) && n >= 1 && n <= CORRELATIVO_MAXIMO;
  if (!enRango(aut.rangoInicial) || !enRango(aut.rangoFinal) || aut.rangoInicial > aut.rangoFinal) {
    problemas.push({ codigo: 'RANGO', mensaje: 'Rango autorizado inválido.', campo: 'rangoInicial' });
  }
  if (!esFechaValida(aut.fechaLimiteEmision)) {
    problemas.push({ codigo: 'FECHA_LIMITE', mensaje: 'fechaLimiteEmision debe ser YYYY-MM-DD.', campo: 'fechaLimiteEmision' });
  }
  if (aut.fechaAutorizacion !== undefined) {
    if (!esFechaValida(aut.fechaAutorizacion)) {
      problemas.push({ codigo: 'FECHA_AUTORIZACION', mensaje: 'fechaAutorizacion debe ser YYYY-MM-DD.', campo: 'fechaAutorizacion' });
    } else if (esFechaValida(aut.fechaLimiteEmision)) {
      // Art. 62 (C L.2297-2303): la vigencia de la autorización es de hasta un (1) año. Si la fecha límite
      // capturada pasa de un año desde la resolución, lo más probable es un error de digitación: aviso.
      const [a, m, d] = aut.fechaAutorizacion.split('-');
      const unAnio = `${Number(a) + 1}-${m}-${d}`;
      if (aut.fechaLimiteEmision > unAnio) {
        problemas.push({
          codigo: 'AVISO_VIGENCIA_MAYOR_1_ANIO',
          mensaje: `La fecha límite (${aut.fechaLimiteEmision}) está a más de un año de la autorización (${aut.fechaAutorizacion}); el Art. 62 fija una vigencia máxima de 1 año. Verifícala contra la resolución.`,
          campo: 'fechaLimiteEmision',
        });
      }
    }
  }
  return problemas;
}

/** Separa errores bloqueantes de advertencias. */
export function esAdvertencia(p: Problema): boolean {
  return p.codigo.endsWith('_ADVERTENCIA') || p.codigo.startsWith('AVISO_');
}

export interface EstadoAutorizacion {
  vigente: boolean;
  /** Días hasta la fecha límite (negativo si venció). */
  diasRestantes: number;
  /** Correlativos que quedan disponibles. */
  correlativosRestantes: number;
  /** Siguiente correlativo a usar, o null si el rango se agotó. */
  siguienteCorrelativo: number | null;
  porcentajeUsado: number;
  alertas: Problema[];
}

/**
 * Estado operativo de una autorización. Úsalo en el POS para avisar antes de quedarse sin rango
 * o sin vigencia (la solicitud de un nuevo CAI toma tiempo).
 *
 * @param ultimoCorrelativoEmitido último correlativo usado, o null si no se ha emitido ninguno.
 */
export function estadoAutorizacion(
  aut: AutorizacionCAI,
  ultimoCorrelativoEmitido: number | null,
  opciones: { hoy?: string; diasAviso?: number; porcentajeAviso?: number } = {},
): EstadoAutorizacion {
  const hoy = opciones.hoy ?? fechaHonduras();
  // Art. 59 (C L.2245-2266): la nueva autorización se solicita «dentro de los dos (2) meses previos» a la
  // fecha límite de emisión. Avisar a 60 días deja la ventana completa para tramitarla.
  const diasAviso = opciones.diasAviso ?? 60;
  const porcentajeAviso = opciones.porcentajeAviso ?? 90;

  const total = aut.rangoFinal - aut.rangoInicial + 1;
  const siguiente = ultimoCorrelativoEmitido === null ? aut.rangoInicial : ultimoCorrelativoEmitido + 1;
  const restantes = Math.max(0, aut.rangoFinal - siguiente + 1);
  const usados = total - restantes;
  const porcentajeUsado = Math.round((usados / total) * 10000) / 100;
  const diasRestantes = diasEntre(hoy, aut.fechaLimiteEmision);

  const alertas: Problema[] = [];
  const vencida = diasRestantes < 0;
  const agotada = restantes === 0;
  if (vencida) alertas.push({ codigo: 'AUTORIZACION_VENCIDA', mensaje: `La fecha límite de emisión (${aut.fechaLimiteEmision}) ya pasó.` });
  else if (diasRestantes <= diasAviso)
    alertas.push({ codigo: 'AVISO_VENCIMIENTO', mensaje: `Faltan ${diasRestantes} días para la fecha límite de emisión.` });
  if (agotada) alertas.push({ codigo: 'RANGO_AGOTADO', mensaje: 'Se agotó el rango autorizado.' });
  else if (porcentajeUsado >= porcentajeAviso)
    alertas.push({ codigo: 'AVISO_RANGO', mensaje: `Se ha usado el ${porcentajeUsado}% del rango (${restantes} disponibles).` });

  return {
    vigente: !vencida && !agotada,
    diasRestantes,
    correlativosRestantes: restantes,
    siguienteCorrelativo: agotada ? null : siguiente,
    porcentajeUsado,
    alertas,
  };
}
