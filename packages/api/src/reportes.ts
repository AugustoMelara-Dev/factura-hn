/**
 * Límites de los reportes de período (`libro-ventas`, `exportacion`, `no-utilizados`).
 *
 * Los reportes siguen completos por período, pero un período grande no puede tumbar el proceso, que comparten
 * todos los tenants:
 * - tope de documentos por reporte (`maxDocumentosReporte`, `FHN_MAX_DOCUMENTOS_REPORTE`, 50 000 por defecto):
 *   se cuenta antes de leer nada y, si se pasa, 422 `PERIODO_DEMASIADO_GRANDE`;
 * - reportes simultáneos por tenant en cada proceso (`reportesSimultaneos`, 2 por defecto): el siguiente
 *   recibe 429 `LIMITE_SOLICITUDES` con `Retry-After`. El cupo se libera cuando la respuesta termina de
 *   enviarse o el cliente la corta;
 * - la exportación se transmite por partes, página por página, con un plazo por escritura para que un cliente
 *   que deja de leer no retenga la conexión a la base.
 */
import type { MiddlewareHandler } from 'hono';
import { ErrorApi } from './errores';

export const MAX_DOCUMENTOS_REPORTE = 50_000;
export const REPORTES_SIMULTANEOS = 2;
/** Plazo para que el cliente reciba cada parte de una respuesta transmitida. */
export const ESPERA_ESCRITURA_MS = 30_000;

/** Tope de documentos por reporte: la opción, o `FHN_MAX_DOCUMENTOS_REPORTE`, o 50 000. */
export function maxDocumentosReporte(opcion: number | undefined, env: Record<string, string | undefined> = process.env): number {
  if (opcion !== undefined) return entero(opcion, 'maxDocumentosReporte');
  const texto = env.FHN_MAX_DOCUMENTOS_REPORTE;
  return texto === undefined || texto.trim() === '' ? MAX_DOCUMENTOS_REPORTE : entero(Number(texto), 'FHN_MAX_DOCUMENTOS_REPORTE');
}

function entero(v: number, nombre: string): number {
  if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${nombre} debe ser un entero positivo.`);
  return v;
}

/** 422 si el período tiene más documentos que el tope. */
export function exigirPeriodoAcotado(total: number, maximo: number): void {
  if (total > maximo) {
    throw new ErrorApi(
      422,
      'PERIODO_DEMASIADO_GRANDE',
      `El período tiene ${total} documentos y el máximo por reporte es ${maximo}. Divídelo en períodos más cortos (p. ej. un mes) y pide cada uno por separado.`,
      { documentos: total, maximo },
    );
  }
}

/** Cupos de reportes en curso por clave (tenant). */
export class CuposSimultaneos {
  private readonly enCurso = new Map<string, number>();
  constructor(private readonly maximo: number) {
    entero(maximo, 'reportesSimultaneos');
  }
  /** Toma un cupo y devuelve con qué liberarlo (se puede llamar varias veces), o null si no hay. */
  tomar(clave: string): (() => void) | null {
    const n = this.enCurso.get(clave) ?? 0;
    if (n >= this.maximo) return null;
    this.enCurso.set(clave, n + 1);
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      const m = (this.enCurso.get(clave) ?? 1) - 1;
      if (m <= 0) this.enCurso.delete(clave);
      else this.enCurso.set(clave, m);
    };
  }
  /** Reportes en curso de la clave (para pruebas y métricas). */
  enUso(clave: string): number {
    return this.enCurso.get(clave) ?? 0;
  }
}

/** Un cuerpo que llama a `liberar` cuando termina de leerse, falla o el cliente lo cancela. */
function liberarAlTerminar(cuerpo: ReadableStream<Uint8Array>, liberar: () => void): ReadableStream<Uint8Array> {
  const lector = cuerpo.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(control) {
      try {
        const { done, value } = await lector.read();
        if (done) {
          liberar();
          control.close();
        } else {
          control.enqueue(value);
        }
      } catch (e) {
        liberar();
        control.error(e);
      }
    },
    async cancel(motivo) {
      liberar();
      await lector.cancel(motivo);
    },
  });
}

/**
 * Middleware de cupos para las rutas de reportes. Va después de la autenticación: `clave` lee el tenant de la
 * sesión. HEAD no se atiende (405): su cuerpo se descarta sin leerse y el cupo no se liberaría.
 */
export function limitarReportes(cupos: CuposSimultaneos, clave: (c: Parameters<MiddlewareHandler>[0]) => string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'HEAD') return c.body(null, 405, { Allow: 'GET' });
    const liberar = cupos.tomar(clave(c));
    if (!liberar) {
      throw new ErrorApi(429, 'LIMITE_SOLICITUDES', 'Ya hay reportes en curso para este negocio. Espera a que terminen y reintenta.', { reintentarEn: 1 });
    }
    try {
      await next();
    } catch (e) {
      liberar();
      throw e;
    }
    const cuerpo = c.res.body;
    if (!cuerpo || c.res.status !== 200) {
      liberar();
      return;
    }
    c.res = new Response(liberarAlTerminar(cuerpo, liberar), c.res);
  };
}

/**
 * Cuerpo transmitido: `producir` escribe las partes y cada `escribir` espera a que el cliente las reciba
 * (contrapresión). `escribir` devuelve false si el cliente cortó o no leyó en `esperaMs`: el productor debe
 * parar. Si `producir` falla, la respuesta se corta con error (el cliente no recibe un archivo truncado que
 * parezca completo).
 */
export function cuerpoTransmitido(
  producir: (escribir: (texto: string) => Promise<boolean>) => Promise<void>,
  opciones: { registrar: (mensaje: string, error?: unknown) => void; esperaMs?: number },
): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  const codificador = new TextEncoder();
  const esperaMs = opciones.esperaMs ?? ESPERA_ESCRITURA_MS;
  let cortado = false;
  const cortar = (motivo: unknown) => {
    cortado = true;
    escritor.abort(motivo).catch(() => undefined);
  };
  const escribir = async (texto: string): Promise<boolean> => {
    if (cortado) return false;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const vencido = new Promise<'vencido'>((r) => {
      reloj = setTimeout(() => r('vencido'), esperaMs);
    });
    try {
      const r = await Promise.race([escritor.write(codificador.encode(texto)).then(() => 'ok' as const), vencido]);
      if (r === 'vencido') cortar(new Error('El cliente no recibió la respuesta a tiempo.'));
    } catch {
      cortado = true; // el cliente canceló
    } finally {
      clearTimeout(reloj);
    }
    return !cortado;
  };
  void (async () => {
    try {
      await producir(escribir);
      if (!cortado) await escritor.close().catch(() => undefined);
    } catch (e) {
      if (!cortado) {
        opciones.registrar('Error al transmitir un reporte', e);
        cortar(e);
      }
    }
  })();
  return readable;
}

/** El texto de cada página: `linea` de cada documento, concatenadas. */
export async function* textoPorPagina<D>(paginas: AsyncIterable<D[]>, linea: (d: D) => string): AsyncGenerator<string> {
  for await (const pagina of paginas) yield pagina.map(linea).join('');
}
