import type { Problema } from 'factura-hn';

/** Error con estado HTTP y código estable. El mensaje se muestra al cliente: nunca lleva datos internos. */
export class ErrorApi extends Error {
  constructor(
    public readonly estado: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503,
    public readonly codigo: string,
    mensaje: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

export interface CuerpoError {
  error: { codigo: string; mensaje: string };
  errores?: Problema[];
  advertencias?: Problema[];
  [k: string]: unknown;
}

/**
 * Token bucket en memoria por llave. Con varias réplicas el límite es por réplica (DEC-030); el límite
 * mensual de documentos sí es global (en la base).
 */
export class LimitadorSolicitudes {
  private readonly cubetas = new Map<string, { fichas: number; t: number }>();
  constructor(
    private readonly porSegundo: number,
    private readonly rafaga: number,
    private readonly ahora: () => number = Date.now,
  ) {}
  /** Devuelve 0 si se permite, o los segundos a esperar. */
  tomar(clave: string): number {
    const t = this.ahora();
    const c = this.cubetas.get(clave) ?? { fichas: this.rafaga, t };
    c.fichas = Math.min(this.rafaga, c.fichas + ((t - c.t) / 1000) * this.porSegundo);
    c.t = t;
    this.cubetas.set(clave, c);
    if (this.cubetas.size > 10_000) this.cubetas.delete(this.cubetas.keys().next().value!);
    if (c.fichas >= 1) {
      c.fichas -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - c.fichas) / this.porSegundo));
  }
}
