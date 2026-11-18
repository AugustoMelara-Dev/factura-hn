/**
 * Asignación de correlativos.
 *
 * Regla de oro: un correlativo asignado NO se reutiliza ni se salta. Si un documento falla
 * después de recibir número, se ANULA (se conserva con estado anulado), no se borra.
 * Por eso `crearDocumento` valida todo antes de pedir el número.
 *
 * En producción implementa `AlmacenCorrelativos` sobre tu base de datos con un incremento
 * atómico (ver docs/persistencia.md). `AlmacenMemoria` es solo para pruebas y demos.
 */
import type { AutorizacionCAI } from './tipos';

export class RangoAgotadoError extends Error {
  constructor(public readonly cai: string) {
    super(`El rango autorizado del CAI ${cai} está agotado. Solicita una nueva autorización al SAR.`);
    this.name = 'RangoAgotadoError';
  }
}

export interface AlmacenCorrelativos {
  /**
   * Reserva y devuelve el siguiente correlativo para la autorización, de forma atómica.
   * Debe lanzar `RangoAgotadoError` si ya no hay correlativos en el rango.
   */
  siguiente(autorizacion: AutorizacionCAI): Promise<number>;
}

/** Almacén en memoria. NO usar en producción: se pierde al reiniciar. */
export class AlmacenMemoria implements AlmacenCorrelativos {
  private readonly ultimos = new Map<string, number>();

  /** @param iniciales último correlativo emitido por CAI, para continuar una serie existente. */
  constructor(iniciales: Record<string, number> = {}) {
    for (const [cai, n] of Object.entries(iniciales)) this.ultimos.set(cai.toUpperCase(), n);
  }

  async siguiente(aut: AutorizacionCAI): Promise<number> {
    const clave = aut.cai.toUpperCase();
    const ultimo = this.ultimos.get(clave) ?? aut.rangoInicial - 1;
    const siguiente = ultimo + 1;
    if (siguiente > aut.rangoFinal) throw new RangoAgotadoError(aut.cai);
    this.ultimos.set(clave, siguiente);
    return siguiente;
  }

  ultimo(cai: string): number | null {
    return this.ultimos.get(cai.toUpperCase()) ?? null;
  }
}
