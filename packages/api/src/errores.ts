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

/** Un problema con la solución y el enlace a la guía de errores, si se conocen. */
export type ProblemaApi = Problema & { solucion?: string; documentacion?: string };

export interface CuerpoError {
  error: { codigo: string; mensaje: string; campo?: string; solucion?: string; documentacion?: string };
  errores?: ProblemaApi[];
  advertencias?: Problema[];
  [k: string]: unknown;
}

/** Guía de errores: un encabezado `### CODIGO` por código. */
export const URL_ERRORES = 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md';
export const documentacionDe = (codigo: string): string => `${URL_ERRORES}#${codigo.toLowerCase()}`;

/** Cómo se invoca la consola del operador fuera de Docker. En la imagen, `FHN_CONSOLA` le antepone `docker compose exec api`. */
export const CONSOLA_POR_DEFECTO = 'factura-hn-api';

/**
 * Qué hacer ante los errores más frecuentes. `consola` es la forma de invocar la consola del operador en este
 * despliegue (p. ej. `docker compose exec api factura-hn-api`).
 */
export function soluciones(consola: string): Record<string, string> {
  return {
    NO_AUTENTICADO:
      'Envía la cabecera `Authorization: Bearer fhn_<prefijo>_<secreto>` con una llave activa, sin espacios ni saltos de línea. ' +
      `Para la demostración, crea una llave de caja con \`${consola} demo llave\`; la llave admin de tu negocio se crea con ` +
      `\`${consola} llave crear local --rol admin --nombre Administración\`.`,
    DEMASIADOS_INTENTOS:
      'Hubo demasiados intentos con llaves no válidas desde esta dirección. Revisa que la llave esté completa y activa, ' +
      'y reintenta después de los segundos de la cabecera Retry-After.',
    DEMASIADAS_SOLICITUDES:
      'Espera los segundos de la cabecera Retry-After y reintenta (al emitir, con la misma Idempotency-Key). ' +
      'Si pasa seguido, reparte las solicitudes en el tiempo.',
    LIMITE_SOLICITUDES: 'Ya hay reportes en curso: espera a que terminen y reintenta después de Retry-After. Si un período tarda, divídelo.',
    LIMITE_MENSUAL: 'Se alcanzó el límite de documentos del mes del tenant. Se reinicia el primer día del mes siguiente; pide al operador que lo suba.',
    SOLO_ADMIN: 'Esta operación requiere una llave con rol admin. Las llaves de caja solo emiten y consultan; `GET /v1/sesion` dice el rol de tu llave.',
    CAJA_SIN_PUNTO:
      'Crea una llave de caja atada a su punto de emisión (`POST /v1/llaves` con `rol: "caja"`, `establecimiento` y `puntoEmision`) y revoca esta.',
    CAJA_NO_AUTORIZADA: 'Quita `establecimiento` y `puntoEmision` del cuerpo (la llave usa su caja) o usa la llave de la otra caja.',
    PUNTO_EMISION_REQUERIDO: 'Indica `establecimiento` y `puntoEmision` en el cuerpo, o emite con una llave de caja, que ya trae su punto.',
    SIN_EMISOR: 'Registra el emisor con una llave admin: `POST /v1/emisores` con los datos del obligado tributario.',
    SIN_AUTORIZACION:
      'Registra con una llave admin el CAI de este punto de emisión y tipo de documento: `POST /v1/autorizaciones` con el CAI, ' +
      'el rango y la fecha límite de la resolución del SAR. `GET /v1/sesion` dice qué falta para emitir.',
    AUTORIZACION_VENCIDA:
      'La fecha límite de emisión de todas las autorizaciones de este punto y tipo ya pasó. Registra la nueva autorización del SAR ' +
      'con `POST /v1/autorizaciones`.',
    RANGO_AGOTADO:
      'Se usaron todos los números autorizados de este punto y tipo. Registra la nueva autorización del SAR con `POST /v1/autorizaciones`; ' +
      '`GET /v1/autorizaciones/{cai}/estado` avisa antes de que se agote.',
    CUERPO_NO_UTF8: 'Guarda el JSON en un archivo UTF-8 y envíalo tal cual: con curl, `--data-binary @factura.json`.',
    CUERPO_DEMASIADO_GRANDE: 'El cuerpo admite hasta 512 KB: divide la venta en varios documentos o acorta los textos.',
    SOLICITUD_INVALIDA: 'Corrige el campo de `error.campo` (la lista completa está en `errores`). La forma de cada ruta está en /docs.',
    IDEMPOTENCY_KEY: 'Envía la cabecera `Idempotency-Key` con un identificador estable de la venta (p. ej. el id del pedido), igual en cada reintento.',
    IDEMPOTENCIA_CONFLICTO: 'Esa clave ya emitió otra venta. Usa una clave nueva para una venta distinta; para reintentar la misma venta, manda el mismo cuerpo.',
    VALIDACION: 'Revisa `errores`: cada uno trae su código y su campo. Corrige y reintenta con la misma Idempotency-Key: un 422 no consume número.',
  };
}

/**
 * Agrega `solucion` y `documentacion` al error y a cada uno de `errores`. En 422 (`VALIDACION`), el error
 * principal toma la solución del primer problema que tenga una. No reemplaza lo que ya traiga un problema.
 */
export function conSolucion(cuerpo: CuerpoError, tabla: Record<string, string>): CuerpoError {
  const errores = cuerpo.errores?.map((p): ProblemaApi => {
    const solucion = p.solucion ?? tabla[p.codigo];
    return { ...p, ...(solucion ? { solucion } : {}), documentacion: p.documentacion ?? documentacionDe(p.codigo) };
  });
  let codigoGuia = cuerpo.error.codigo;
  if (codigoGuia === 'VALIDACION') {
    const conocido = errores?.find((p) => tabla[p.codigo]);
    if (conocido) codigoGuia = conocido.codigo;
  }
  const solucion = tabla[codigoGuia];
  const error = solucion ? { ...cuerpo.error, solucion, documentacion: documentacionDe(codigoGuia) } : cuerpo.error;
  return { ...cuerpo, error, ...(errores ? { errores } : {}) };
}

/**
 * Token bucket en memoria. Con varias réplicas el límite es por réplica (DEC-030); el límite mensual de
 * documentos sí es global (en la base).
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
  /** Como `tomar`, sin gastar ficha: 0 si queda al menos una, o los segundos a esperar. */
  espera(clave: string): number {
    const c = this.cubetas.get(clave);
    if (!c) return 0;
    const fichas = Math.min(this.rafaga, c.fichas + ((this.ahora() - c.t) / 1000) * this.porSegundo);
    return fichas >= 1 ? 0 : Math.max(1, Math.ceil((1 - fichas) / this.porSegundo));
  }
}

interface SolicitudConDireccion {
  env?: unknown;
  req: { header: (nombre: string) => string | undefined };
}

/** Agrupa una dirección para el límite: IPv4 tal cual (también la mapeada en IPv6) e IPv6 por su /64. */
function agrupar(ip: string): string {
  const v = ip.trim().toLowerCase();
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapeada) return mapeada[1]!;
  if (!v.includes(':')) return v;
  const [izq, der] = v.split('::') as [string, string | undefined];
  const a = izq ? izq.split(':') : [];
  const b = der ? der.split(':') : [];
  const grupos = der === undefined ? a : [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${grupos.slice(0, 4).map((g) => g || '0').join(':')}::/64`;
}

/**
 * Dirección del cliente para el límite de intentos. Por defecto, la del socket: `X-Forwarded-For` lo escribe
 * el cliente y no se cree. Con `proxies` > 0 (la API detrás de ese número de proxies de confianza), se toma la
 * dirección que anotó el proxy más externo: la `proxies`-ésima desde la derecha. Sin socket (p. ej. una prueba
 * con `app.request`), todas las solicitudes comparten una cubeta.
 */
export function ipDeSolicitud(c: SolicitudConDireccion, proxies: number): string {
  type Enlace = { incoming?: { socket?: { remoteAddress?: string } } };
  const env = c.env as (Enlace & { server?: Enlace }) | undefined;
  const socket = env?.incoming?.socket?.remoteAddress ?? env?.server?.incoming?.socket?.remoteAddress;
  if (proxies > 0) {
    const saltos = (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ip = saltos.length >= proxies ? saltos[saltos.length - proxies] : undefined;
    if (ip) return agrupar(ip);
  }
  return socket ? agrupar(socket) : 'desconocida';
}
