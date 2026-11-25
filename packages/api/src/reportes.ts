/**
 * Límites de los reportes de período (`libro-ventas`, `exportacion`, `no-utilizados`).
 *
 * Los reportes siguen completos por período, pero un período grande no puede tumbar el proceso ni dejar sin
 * conexiones a la base a los demás tenants:
 * - tope de documentos por reporte (`maxDocumentosReporte`, `FHN_MAX_DOCUMENTOS_REPORTE`, 50 000 por defecto):
 *   se cuenta antes de enviar nada y, si se pasa, 422 `PERIODO_DEMASIADO_GRANDE`;
 * - reportes en curso por llave (`reportesPorLlave`, 1), por tenant (`reportesSimultaneos`, 2) y en todo el proceso
 *   (`reportesSimultaneosProceso`, `FHN_REPORTES_SIMULTANEOS_PROCESO`, por defecto un cuarto del pool redondeado hacia
 *   arriba, nunca más que el pool menos 1): el siguiente recibe 429
 *   `LIMITE_SOLICITUDES` con `Retry-After`. Un reporte transmitido retiene una conexión del pool mientras el
 *   cliente lee; el límite del proceso deja siempre conexiones libres para el resto de la API;
 * - el libro y la exportación se transmiten por partes (de unos 64 KB), con un plazo por parte (30 s: un
 *   cliente que lee despacio pero avanza no se corta) y un plazo total (`duracionMaxReporteMs`, 5 minutos).
 *   Al vencer cualquiera, la respuesta se corta con error y se libera todo.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { ErrorApi } from './errores';

export const MAX_DOCUMENTOS_REPORTE = 50_000;
export const REPORTES_SIMULTANEOS = 2;
/**
 * Reportes en curso a la vez por llave. Con 1, una caja que lee despacio el libro de ventas ocupa a lo sumo uno de
 * los cupos del tenant: el otro queda para la exportación del admin.
 */
export const REPORTES_POR_LLAVE = 1;
/** Plazo para que el cliente reciba cada parte de una respuesta transmitida. */
export const ESPERA_ESCRITURA_MS = 30_000;
/** Plazo total de una respuesta transmitida. */
export const DURACION_MAX_REPORTE_MS = 5 * 60_000;
/** Tamaño de cada parte escrita al cliente. */
export const TAMANO_PARTE = 64 * 1024;

type Entorno = Record<string, string | undefined>;

/** Tope de documentos por reporte: la opción, o `FHN_MAX_DOCUMENTOS_REPORTE`, o 50 000. */
export function maxDocumentosReporte(opcion: number | undefined, env: Entorno = process.env): number {
  return desdeEntorno(opcion, 'maxDocumentosReporte', env, 'FHN_MAX_DOCUMENTOS_REPORTE', MAX_DOCUMENTOS_REPORTE);
}

/**
 * Reportes en curso en todo el proceso: la opción, o `FHN_REPORTES_SIMULTANEOS_PROCESO`, o un cuarto del pool
 * redondeado hacia arriba (al menos 1), para que los reportes nunca ocupen todas las conexiones. Con el pool por
 * omisión de `pg` (10) son 3: más que el cupo de un tenant (2), así que un solo tenant no llena el proceso.
 */
export function reportesSimultaneosProceso(opcion: number | undefined, tamanoPool: number, env: Entorno = process.env): number {
  const porDefecto = Math.max(1, Math.ceil(tamanoPool / 4));
  const n = desdeEntorno(opcion, 'reportesSimultaneosProceso', env, 'FHN_REPORTES_SIMULTANEOS_PROCESO', porDefecto);
  // Cada reporte transmitido retiene una conexión: siempre debe quedar al menos una para el resto de la API (con
  // un pool de 1, un solo reporte, y las demás solicitudes esperan a que termine).
  const maximo = Math.max(1, tamanoPool - 1);
  if (n > maximo) {
    throw new Error(`reportesSimultaneosProceso (${n}) no puede pasar de ${maximo}: el pool tiene ${tamanoPool} conexiones y cada reporte en curso retiene una.`);
  }
  return n;
}

function desdeEntorno(opcion: number | undefined, nombre: string, env: Entorno, variable: string, porDefecto: number): number {
  if (opcion !== undefined) return entero(opcion, nombre);
  const texto = env[variable];
  return texto === undefined || texto.trim() === '' ? porDefecto : entero(Number(texto), variable);
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

/** Cupos de reportes en curso por clave. */
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

const muchos = () => new ErrorApi(429, 'LIMITE_SOLICITUDES', 'Ya hay demasiados reportes en curso. Espera a que terminen y reintenta.', { reintentarEn: 1 });

const muchosDeLaLlave = () =>
  new ErrorApi(429, 'LIMITE_SOLICITUDES', 'Esta llave ya tiene un reporte en curso. Espera a que termine y reintenta.', { reintentarEn: 1 });

/**
 * Cupos de los reportes: por llave, por tenant y en todo el proceso. El middleware los toma antes de la ruta y
 * los libera al terminar; una ruta que transmite su respuesta los reclama (`reclamar`) y los libera cuando
 * termina la transmisión.
 */
export class ReportesEnCurso {
  readonly porLlave: CuposSimultaneos;
  readonly porTenant: CuposSimultaneos;
  readonly proceso: CuposSimultaneos;
  private readonly cupos = new WeakMap<Request, { liberar: () => void; reclamado: boolean }>();

  constructor(limites: { porTenant: number; proceso: number; porLlave?: number }) {
    this.porLlave = new CuposSimultaneos(limites.porLlave ?? REPORTES_POR_LLAVE);
    this.porTenant = new CuposSimultaneos(limites.porTenant);
    this.proceso = new CuposSimultaneos(limites.proceso);
  }

  /**
   * Middleware de las rutas de reportes. Va después de la autenticación: `clave` lee el tenant de la sesión y
   * `llave`, el prefijo de la llave (sin `llave`, no hay cupo por llave). HEAD no se atiende (405): su cuerpo se
   * descarta sin leerse.
   */
  middleware(clave: (c: Context) => string, llave?: (c: Context) => string): MiddlewareHandler {
    return async (c, next) => {
      if (c.req.method === 'HEAD') {
        return c.json({ error: { codigo: 'METODO_NO_PERMITIDO', mensaje: 'Usa GET para pedir este reporte.' } }, 405, { Allow: 'GET' });
      }
      // La llave primero: la que ya tiene un reporte en curso no toma (ni devuelve) cupos del tenant.
      const deLaLlave = llave ? this.porLlave.tomar(`${clave(c)}:${llave(c)}`) : () => undefined;
      if (!deLaLlave) throw muchosDeLaLlave();
      const delTenant = this.porTenant.tomar(clave(c));
      if (!delTenant) {
        deLaLlave();
        throw muchos();
      }
      const delProceso = this.proceso.tomar('');
      if (!delProceso) {
        delTenant();
        deLaLlave();
        throw muchos();
      }
      const cupo = {
        liberar: () => {
          deLaLlave();
          delTenant();
          delProceso();
        },
        reclamado: false,
      };
      this.cupos.set(c.req.raw, cupo);
      try {
        await next();
      } finally {
        if (!cupo.reclamado) cupo.liberar();
      }
    };
  }

  /** La ruta se hace cargo del cupo de la solicitud: devuelve con qué liberarlo. */
  reclamar(solicitud: Request): () => void {
    const cupo = this.cupos.get(solicitud);
    if (!cupo) return () => undefined;
    cupo.reclamado = true;
    return cupo.liberar;
  }
}

/** Escribe texto en la respuesta transmitida. Devuelve false si hay que parar (cliente cortó o venció un plazo). */
export type Escribir = (texto: string) => Promise<boolean>;

export interface OpcionesTransmision<X, P> {
  /** Corre `fn` en una transacción (de solo lectura): conteo y páginas salen de la misma instantánea. */
  ejecutar: (fn: (tx: X) => Promise<void>) => Promise<void>;
  /** Antes de enviar nada: contar, aplicar el tope (puede lanzar 422), registrar. */
  preparar: (tx: X) => Promise<P>;
  /** Escribe la respuesta. Debe parar si `escribir` devuelve false. */
  producir: (tx: X, preparado: P, escribir: Escribir) => Promise<void>;
  /**
   * Después de cerrar la transacción y antes de enviar la última parte: p. ej. registrar en la bitácora. No
   * corre si `preparar` falló. `completo` es false si la respuesta se cortó o `producir` falló. Si lanza con
   * `completo`, la respuesta se corta con error: el cliente no recibe el archivo completo sin ese registro.
   */
  alTerminar?: (preparado: P, completo: boolean) => Promise<void>;
  /** Se llama una vez, cuando todo terminó (bien, con error o cortado). */
  liberar: () => void;
  registrar: (mensaje: string, error?: unknown) => void;
  esperaEscrituraMs?: number;
  duracionMaxMs?: number;
}

/**
 * Respuesta transmitida desde una transacción. `preparar` corre primero: si lanza, la promesa se rechaza y la
 * ruta puede responder el error (422) porque todavía no se envió nada. Si no, se resuelve con el cuerpo y
 * `producir` sigue en la misma transacción mientras el cliente lee.
 *
 * Lo escrito se junta en partes de `TAMANO_PARTE`; cada parte debe llegar al cliente en `esperaEscrituraMs` y la
 * respuesta entera en `duracionMaxMs`. Si un plazo vence o `producir` falla, la respuesta se corta con error:
 * el cliente nunca recibe un archivo truncado que parezca completo.
 *
 * `ejecutar` usa una sola conexión: ni `preparar` ni `producir` deben pedir otra al pool mientras la transacción
 * está abierta (con un pool chico se bloquearía para siempre). Lo que necesite escribir va en `alTerminar`.
 */
export function transmitir<X, P>(o: OpcionesTransmision<X, P>): Promise<{ preparado: P; cuerpo: ReadableStream<Uint8Array> }> {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const escritor = writable.getWriter();
  const codificador = new TextEncoder();
  const esperaMs = o.esperaEscrituraMs ?? ESPERA_ESCRITURA_MS;
  let cortado = false;
  let pendiente = '';
  let plazoTotal: ReturnType<typeof setTimeout> | undefined;
  // Se resuelve al cortar: una escritura pendiente no espera a que el abort de la corriente la desbloquee.
  let avisarCorte!: () => void;
  const corte = new Promise<'cortado'>((r) => {
    avisarCorte = () => r('cortado');
  });

  const cortar = (motivo: unknown) => {
    if (cortado) return;
    cortado = true;
    avisarCorte();
    // Siempre con un error: un motivo vacío terminaría la respuesta como si estuviera completa.
    escritor.abort(motivo ?? new Error('Reporte cortado.')).catch(() => undefined);
  };
  const enviar = async (bytes: Uint8Array): Promise<boolean> => {
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const vencido = new Promise<'vencido'>((r) => {
      reloj = setTimeout(() => r('vencido'), esperaMs);
    });
    try {
      const r = await Promise.race([escritor.write(bytes).then(() => 'ok' as const), vencido, corte]);
      if (r === 'vencido') cortar(new Error('El cliente no recibió la respuesta a tiempo.'));
    } catch {
      cortado = true; // el cliente canceló
    } finally {
      clearTimeout(reloj);
    }
    return !cortado;
  };
  const vaciar = async (): Promise<boolean> => {
    if (cortado) return false;
    const bytes = codificador.encode(pendiente);
    pendiente = '';
    for (let i = 0; i < bytes.length; i += TAMANO_PARTE) {
      if (!(await enviar(bytes.subarray(i, i + TAMANO_PARTE)))) return false;
    }
    return true;
  };
  const escribir: Escribir = async (texto) => {
    if (cortado) return false;
    pendiente += texto;
    return pendiente.length >= TAMANO_PARTE ? vaciar() : true;
  };

  return new Promise((resolve, reject) => {
    let iniciado = false;
    let preparado: P;
    // `Promise.resolve().then`: si `ejecutar` lanza sin devolver una promesa, igual se rechaza y se libera.
    Promise.resolve()
      .then(() => o.ejecutar(async (tx) => {
        preparado = await o.preparar(tx);
        iniciado = true;
        plazoTotal = setTimeout(() => cortar(new Error('La respuesta superó el tiempo máximo.')), o.duracionMaxMs ?? DURACION_MAX_REPORTE_MS);
        resolve({ preparado, cuerpo: readable });
        await o.producir(tx, preparado, escribir);
      }))
      // La transacción ya terminó (conexión devuelta): `alTerminar` y lo que queda pendiente (menos de una parte).
      .then(async () => {
        const completo = !cortado;
        if (o.alTerminar) {
          try {
            await o.alTerminar(preparado, completo);
          } catch (e) {
            o.registrar('Error al cerrar un reporte transmitido', e);
            cortar(e);
          }
        }
        if (await vaciar()) escritor.close().catch(() => undefined);
      }, async (e: unknown) => {
        if (!iniciado) return reject(e);
        if (!cortado) o.registrar('Error al transmitir un reporte', e);
        cortar(e);
        await o.alTerminar?.(preparado, false).catch((e2: unknown) => o.registrar('Error al cerrar un reporte transmitido', e2));
      })
      .catch((e: unknown) => cortar(e))
      .finally(() => {
        clearTimeout(plazoTotal);
        o.liberar();
      });
  });
}
