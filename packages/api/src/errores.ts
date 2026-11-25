import { isIP } from 'node:net';
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

/**
 * Cómo se invoca la consola del operador fuera de Docker, desde la raíz del repositorio compilado: el paquete es
 * privado y `factura-hn-api` no queda en el PATH. En la imagen, `FHN_CONSOLA` dice
 * `docker compose exec api factura-hn-api`.
 */
export const CONSOLA_POR_DEFECTO = 'node packages/api/dist/cli.js';

export interface ContextoGuia {
  /** Forma de invocar la consola del operador en este despliegue (p. ej. `docker compose exec api factura-hn-api`). */
  consola: string;
  modo: 'local' | 'alojado';
  /** Si este despliegue tiene el tenant de demostración. */
  hayDemo?: boolean;
}

/**
 * Qué hacer ante los errores más frecuentes. Las respuestas sin autenticar (401, 429 de intentos) las lee
 * cualquiera: en modo alojado no nombran comandos ni tenants del operador, y el demo solo se menciona si existe.
 */
export function soluciones({ consola, modo, hayDemo = false }: ContextoGuia): Record<string, string> {
  const cabecera =
    'Envía la cabecera `Authorization: Bearer fhn_live_<prefijo>_<secreto>` (o `fhn_test_…` en un tenant de prueba) con una llave ' +
    'activa, sin espacios ni saltos de línea. Una llave fhn_test_ no sirve en un tenant de producción, ni una fhn_live_ en uno de prueba. ';
  return {
    NO_AUTENTICADO:
      modo === 'alojado'
        ? `${cabecera}Si no tienes una llave o la tuya fue revocada, pide una al operador de la API.`
        : cabecera +
          (hayDemo ? `Para la demostración, crea una llave de caja con \`${consola} demo llave\`; la` : 'La') +
          ` llave admin de tu negocio se crea con \`${consola} llave crear local --rol admin --nombre Administración\`.`,
    DEMASIADOS_INTENTOS:
      'Hubo demasiados intentos con llaves no válidas, desde tu dirección o con esta misma llave. Revisa que la llave ' +
      'esté completa y activa, y reintenta después de los segundos de la cabecera Retry-After.',
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
    AUTORIZACION_REAL_EN_DEMO:
      'Este tenant es de prueba (el «demo» o uno con llaves fhn_test_): no le registres CAI reales. Registra tu CAI en el tenant de ' +
      'producción de tu negocio, con su llave admin fhn_live_.',
    CAI_DE_PRUEBA:
      'Un tenant de producción no acepta CAI ficticios (DEMO00-NO-VALIDO-…). Si es tu CAI real, cópialo de la resolución del SAR. ' +
      'Para probar, usa un tenant de prueba: el «demo» (`demo llave` en la consola) o uno creado con `tenant crear --modo prueba`.',
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
 * Token bucket en memoria. Con varias réplicas el límite es por réplica; el límite mensual de documentos sí es
 * global (en la base).
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
    if (!this.cubetas.has(clave) && this.cubetas.size >= LimitadorSolicitudes.MAX_CUBETAS) this.desalojar(t);
    this.cubetas.set(clave, c);
    if (c.fichas >= 1) {
      c.fichas -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - c.fichas) / this.porSegundo));
  }
  /**
   * Como `tomar`, sin gastar ficha: 0 si queda al menos una además de las `reservadas` (intentos en curso que
   * aún pueden gastar la suya), o los segundos a esperar.
   */
  espera(clave: string, reservadas = 0): number {
    const c = this.cubetas.get(clave);
    const fichas = (c ? Math.min(this.rafaga, c.fichas + ((this.ahora() - c.t) / 1000) * this.porSegundo) : this.rafaga) - reservadas;
    return fichas >= 1 ? 0 : Math.max(1, Math.ceil((1 - fichas) / this.porSegundo));
  }
  /** Si la clave tiene cubeta (gastó alguna ficha y no se descartó). */
  tiene(clave: string): boolean {
    return this.cubetas.has(clave);
  }
  static readonly MAX_CUBETAS = 10_000;
  /**
   * Con demasiadas cubetas, descarta primero las llenas: no guardan nada que no se recupere al recrearlas. Mira
   * solo las `REVISAR_AL_DESALOJAR` más antiguas (el costo por clave nueva queda acotado); si ninguna está llena,
   * descarta la más antigua. Así, crear muchas claves nuevas no borra la cubeta vacía de quien ataca.
   */
  private desalojar(t: number): void {
    let vistas = 0;
    for (const [clave, c] of this.cubetas) {
      if (++vistas > LimitadorSolicitudes.REVISAR_AL_DESALOJAR) break;
      if (c.fichas + ((t - c.t) / 1000) * this.porSegundo >= this.rafaga) this.cubetas.delete(clave);
    }
    if (this.cubetas.size >= LimitadorSolicitudes.MAX_CUBETAS) this.cubetas.delete(this.cubetas.keys().next().value!);
  }
  static readonly REVISAR_AL_DESALOJAR = 64;
}

/** El semáforo no admite más espera: la cola está llena o se pasó el tiempo máximo en cola. */
export class SemaforoSaturado extends Error {
  constructor(readonly motivo: 'cola-llena' | 'espera-agotada') {
    super(motivo === 'cola-llena' ? 'La cola del semáforo está llena.' : 'Se agotó el tiempo de espera en la cola.');
  }
}

/**
 * Semáforo con cola: a lo sumo `maximo` tareas a la vez; las demás esperan su turno en orden. La cola tiene un
 * tope (`maxEnCola`) y un tiempo máximo de espera (`esperaMaxMs`): más allá, `con` falla con `SemaforoSaturado`
 * sin correr la tarea.
 */
export class Semaforo {
  private activas = 0;
  private readonly cola: Array<() => void> = [];
  constructor(
    private readonly maximo: number,
    private readonly maxEnCola = Number.POSITIVE_INFINITY,
    private readonly esperaMaxMs = Number.POSITIVE_INFINITY,
  ) {
    if (!Number.isSafeInteger(maximo) || maximo < 1) throw new Error('El semáforo necesita al menos un lugar.');
    if (!(maxEnCola >= 0) || !(esperaMaxMs > 0)) throw new Error('El tope de la cola y la espera máxima deben ser positivos.');
  }
  /** Si hay que esperar en cola para correr una tarea nueva. */
  get saturado(): boolean {
    return this.activas >= this.maximo;
  }
  async con<T>(tarea: () => Promise<T>): Promise<T> {
    if (this.activas >= this.maximo) {
      if (this.cola.length >= this.maxEnCola) throw new SemaforoSaturado('cola-llena');
      await new Promise<void>((resolver, rechazar) => {
        let reloj: ReturnType<typeof setTimeout> | undefined;
        const turno = () => {
          if (reloj) clearTimeout(reloj);
          resolver();
        };
        this.cola.push(turno);
        if (Number.isFinite(this.esperaMaxMs)) {
          reloj = setTimeout(() => {
            const i = this.cola.indexOf(turno);
            if (i >= 0) this.cola.splice(i, 1);
            rechazar(new SemaforoSaturado('espera-agotada'));
          }, this.esperaMaxMs);
          reloj.unref?.();
        }
      });
    } else this.activas++;
    try {
      return await tarea();
    } finally {
      const siguiente = this.cola.shift();
      if (siguiente) siguiente();
      else this.activas--;
    }
  }
  /** Tareas corriendo y en cola. */
  get ocupacion(): { activas: number; enCola: number } {
    return { activas: this.activas, enCola: this.cola.length };
  }
}

interface SolicitudConDireccion {
  env?: unknown;
  req: { header: (nombre: string) => string | undefined };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Los 8 grupos de una IPv6 (con la IPv4 final, si la trae, en los dos últimos), o null si no es válida. */
function gruposIpv6(v: string): number[] | null {
  let texto = v;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(texto);
  if (v4) {
    const o = IPV4.exec(v4[1]!)!.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    texto = `${texto.slice(0, -v4[1]!.length)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const partes = texto.split('::');
  if (partes.length > 2) return null;
  const leer = (s: string) => (s ? s.split(':') : []);
  const izq = leer(partes[0]!);
  const der = partes.length === 2 ? leer(partes[1]!) : [];
  const faltan = 8 - izq.length - der.length;
  if (partes.length === 2 ? faltan < 1 : faltan !== 0) return null;
  const hex = [...izq, ...Array<string>(partes.length === 2 ? faltan : 0).fill('0'), ...der];
  if (!hex.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return hex.map((g) => parseInt(g, 16));
}

/**
 * Forma única de una dirección: IPv4 en decimal (también la mapeada en IPv6, en cualquier notación) e IPv6 con
 * sus 8 grupos expandidos, en minúsculas y sin ceros a la izquierda. Lo que no es una dirección queda tal cual.
 */
export function normalizarIp(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = IPV4.exec(v);
  if (v4) return v4.slice(1).map(Number).some((n) => n > 255) ? v : v4.slice(1).map(Number).join('.');
  const g = gruposIpv6(v);
  if (!g) return v;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join('.');
  return g.map((n) => n.toString(16)).join(':');
}

/** Cubeta de una dirección: la IPv4 tal cual y la IPv6 por su /64 (quien tiene una /64 tiene todas sus direcciones). */
export function agrupar(ip: string): string {
  const n = normalizarIp(ip);
  const g = n.split(':');
  return g.length === 8 ? `${g.slice(0, 4).join(':')}::/64` : n;
}

/**
 * Proxies de confianza delante de la API: un número de saltos, o la lista de sus direcciones.
 * - Número N > 0: se toma la dirección que anotó el proxy más externo, la N-ésima de `X-Forwarded-For` desde la
 *   derecha. Solo es seguro si a la API se llega únicamente por esos proxies: una solicitud directa escribe la
 *   cabecera que quiera y elige su cubeta.
 * - Lista: la cabecera solo se cree si el socket es uno de esos proxies; se recorre desde la derecha saltando
 *   las direcciones de la lista y la primera que no está es la del cliente. Una solicitud directa no la elige.
 */
export type ProxiesDeConfianza = number | readonly string[];

/** Lee `FHN_PROXIES_DE_CONFIANZA`: vacío es 0; un número de saltos; o direcciones separadas por comas. */
export function leerProxiesDeConfianza(texto: string | undefined): ProxiesDeConfianza {
  const t = (texto ?? '').trim();
  if (!t) return 0;
  if (/^\d{1,2}$/.test(t)) return Number(t);
  const lista = t.split(',').map((s) => s.trim()).filter(Boolean);
  const malas = lista.filter((s) => isIP(s.replace(/^\[|\]$/g, '')) === 0);
  if (!lista.length || malas.length)
    throw new Error(`FHN_PROXIES_DE_CONFIANZA debe ser un número de proxies o una lista de direcciones IP separadas por comas (no "${t}").`);
  return lista;
}

/**
 * Dirección del cliente para el límite de intentos. Por defecto, la del socket: `X-Forwarded-For` lo escribe
 * el cliente y no se cree. Sin socket (p. ej. una prueba con `app.request`), todas las solicitudes comparten
 * una cubeta.
 */
export function ipDeSolicitud(c: SolicitudConDireccion, proxies: ProxiesDeConfianza): string {
  type Enlace = { incoming?: { socket?: { remoteAddress?: string } } };
  const env = c.env as (Enlace & { server?: Enlace }) | undefined;
  const socket = env?.incoming?.socket?.remoteAddress ?? env?.server?.incoming?.socket?.remoteAddress;
  const saltos = () => (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (typeof proxies === 'number') {
    if (proxies > 0) {
      const s = saltos();
      const ip = s.length >= proxies ? s[s.length - proxies] : undefined;
      if (ip) return agrupar(ip);
    }
  } else if (socket && proxies.length) {
    const confiables = new Set(proxies.map(normalizarIp));
    if (confiables.has(normalizarIp(socket))) {
      const s = saltos();
      for (let i = s.length - 1; i >= 0; i--) if (!confiables.has(normalizarIp(s[i]!))) return agrupar(s[i]!);
    }
  }
  return socket ? agrupar(socket) : 'desconocida';
}
