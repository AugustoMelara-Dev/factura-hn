/**
 * Control de vigencia y consumo de una autorización (CAI + rango + fecha límite).
 */
import type { AutorizacionCAI, Problema } from './tipos';
import { CORRELATIVO_MAXIMO, TIPOS_DOCUMENTO } from './numeracion';
import { esCAIValido, normalizarCAI, PATRON_CAI_BASICO } from './identificacion';
import { conSolucion } from './errores';
import { esAutorizacionDePrueba, esCAIDemo } from './modo';

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

/** `fecha` menos `meses` de calendario (YYYY-MM-DD); si el día no existe en el mes destino, el último. */
export function restarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) - meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Problemas estructurales de una autorización (independientes de la fecha y del consumo). */
export function validarAutorizacion(aut: AutorizacionCAI, opciones: { caiEstricto?: boolean } = {}): Problema[] {
  const problemas: Problema[] = [];
  if (!aut.cai || !aut.cai.trim()) {
    problemas.push({ codigo: 'CAI_REQUERIDO', mensaje: 'La autorización no tiene CAI.', campo: 'cai' });
  } else if (!PATRON_CAI_BASICO.test(normalizarCAI(aut.cai))) {
    // B-09 / DEC-013: sin fuente para el formato, por defecto solo se rechaza un carácter que no sea letra,
    // dígito o guion (espacios internos, signos): suele ser un error de digitación. Los espacios del inicio y
    // del final se recortan sin error.
    problemas.push({
      codigo: 'CAI_FORMATO',
      mensaje: `El CAI "${aut.cai}" solo puede tener letras, dígitos y guiones. Cópialo tal como viene en la resolución del SAR.`,
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
  if (!enRango(aut.rangoInicial) || !enRango(aut.rangoFinal)) {
    const malo = !enRango(aut.rangoInicial) ? 'rangoInicial' : 'rangoFinal';
    problemas.push({
      codigo: 'RANGO',
      mensaje: `Rango autorizado inválido: ${malo} (${String(aut[malo])}) debe ser un entero entre 1 y ${CORRELATIVO_MAXIMO}.`,
      campo: malo,
    });
  } else if (aut.rangoInicial > aut.rangoFinal) {
    problemas.push({
      codigo: 'RANGO',
      mensaje: `Rango autorizado inválido: el inicial (${aut.rangoInicial}) es mayor que el final (${aut.rangoFinal}).`,
      campo: 'rangoInicial',
    });
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
  // Producto, no regla fiscal: `prueba` es booleano, y solo un CAI ficticio puede ser de prueba. Así un CAI
  // con forma real nunca gasta correlativos en documentos «sin valor fiscal».
  if (aut.prueba !== undefined && typeof aut.prueba !== 'boolean') {
    problemas.push({
      codigo: 'AUTORIZACION_PRUEBA_FORMATO',
      mensaje: `«prueba» debe ser true o false (booleano), no ${JSON.stringify(aut.prueba)}.`,
      campo: 'prueba',
    });
  } else if (aut.prueba === true && aut.cai && !esCAIDemo(aut.cai)) {
    problemas.push({
      codigo: 'AUTORIZACION_PRUEBA_CAI_REAL',
      mensaje: `El CAI ${aut.cai} no es ficticio: una autorización de prueba usa un CAI que empieza con DEMO00-NO-VALIDO-.`,
      campo: 'prueba',
    });
  }
  return problemas.map((p) => (esAdvertencia(p) ? p : conSolucion(p)));
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
  /**
   * Autorización de prueba de un punto que ya tiene una real: está retirada, no se emite con ella y no le quedan
   * números. Solo aparece en ese caso.
   */
  retirada?: true;
}

/**
 * Estado operativo de una autorización. Úsalo en el POS para avisar antes de quedarse sin rango
 * o sin vigencia (la solicitud de un nuevo CAI toma tiempo).
 *
 * @param ultimoCorrelativoEmitido último correlativo usado, o null si no se ha emitido ninguno.
 * @param opciones.puntoConReal el punto de emisión tiene alguna autorización real (de cualquier tipo). Con eso,
 *   una autorización de prueba sale `retirada`, no vigente y sin números restantes.
 */
export function estadoAutorizacion(
  aut: AutorizacionCAI,
  ultimoCorrelativoEmitido: number | null,
  opciones: { hoy?: string; diasAviso?: number; porcentajeAviso?: number; puntoConReal?: boolean } = {},
): EstadoAutorizacion {
  const hoy = opciones.hoy ?? fechaHonduras();
  // Art. 59 (C L.2245-2266): la nueva autorización se solicita «dentro de los dos (2) meses previos» a la
  // fecha límite de emisión. Por defecto se avisa desde que se abre esa ventana: la misma fecha dos meses
  // de calendario antes (si ese día no existe, el último del mes). `diasAviso` la reemplaza por días.
  const inicioVentana = opciones.diasAviso === undefined ? restarMeses(aut.fechaLimiteEmision, 2) : null;
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
  else if (inicioVentana !== null ? hoy >= inicioVentana : diasRestantes <= opciones.diasAviso!)
    alertas.push({ codigo: 'AVISO_VENCIMIENTO', mensaje: `Faltan ${diasRestantes} días para la fecha límite de emisión.` });
  if (agotada) alertas.push({ codigo: 'RANGO_AGOTADO', mensaje: 'Se agotó el rango autorizado.' });
  else if (porcentajeUsado >= porcentajeAviso)
    alertas.push({ codigo: 'AVISO_RANGO', mensaje: `Se ha usado el ${porcentajeUsado}% del rango (${restantes} disponibles).` });

  if (opciones.puntoConReal && esAutorizacionDePrueba(aut)) {
    return { vigente: false, diasRestantes, correlativosRestantes: 0, siguienteCorrelativo: null, porcentajeUsado, alertas: [], retirada: true };
  }
  return {
    vigente: !vencida && !agotada,
    diasRestantes,
    correlativosRestantes: restantes,
    siguienteCorrelativo: agotada ? null : siguiente,
    porcentajeUsado,
    alertas,
  };
}
