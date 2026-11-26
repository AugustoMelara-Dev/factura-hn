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

/**
 * Si el error dice que la base no está disponible por un momento: PostgreSQL se reinicia o se cae (57P01, 57P02,
 * 57P03), la conexión se cortó o se rechazó (08000, 08001, 08003, 08004, 08006, ECONNREFUSED, ECONNRESET…), no hay conexiones libres
 * (53300) o el pool no logró conectar a tiempo. La API responde 503 `BASE_NO_DISPONIBLE` en lugar de 500: el
 * cliente sabe que debe reintentar (al emitir, con la misma Idempotency-Key).
 */
export function esBaseNoDisponible(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const codigo = (e as { code?: unknown }).code;
  if (typeof codigo === 'string') {
    // Solo los códigos de conexión de la clase 08: 08P01 (protocol_violation) también lo produce un error del
    // código (p. ej. menos parámetros que los que pide la consulta) y debe quedar como 500 con su traza.
    if (/^(0800[0-46]|57P0[123]|53300)$/.test(codigo)) return true;
    if (/^E(CONNREFUSED|CONNRESET|TIMEDOUT|PIPE|AI_AGAIN|NOTFOUND|HOSTUNREACH|NETUNREACH)$/.test(codigo)) return true;
  }
  return /Connection terminated|timeout exceeded when trying to connect|is not queryable|the database system is (starting up|shutting down|in recovery mode|not yet accepting connections)/i.test(
    e.message,
  );
}

/** Segundos de `Retry-After` en un 503 `BASE_NO_DISPONIBLE`: lo que suele tardar PostgreSQL en volver de un reinicio. */
export const REINTENTAR_BASE_SEGUNDOS = 2;

/** Un problema con la solución y el enlace a la guía de errores, si se conocen. */
export type ProblemaApi = Problema & { solucion?: string; documentacion?: string };

export interface CuerpoError {
  error: { codigo: string; mensaje: string; campo?: string; solucion?: string; documentacion?: string; solicitud?: string };
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
  modo: 'local' | 'alojado' | 'demo';
  /** Si este despliegue tiene el tenant de demostración. */
  hayDemo?: boolean;
}

/**
 * Qué hacer ante los errores más frecuentes. Las respuestas sin autenticar (401, 429 de intentos) las lee
 * cualquiera: en modo alojado no nombran comandos ni tenants del operador, y el demo solo se menciona si existe.
 */
export function soluciones({ consola, modo, hayDemo = false }: ContextoGuia): Record<string, string> {
  const cabecera =
    'Envía la cabecera `Authorization: Bearer` seguida de la llave completa (`fhn_live_…`, o `fhn_test_…` en un tenant de prueba), ' +
    'activa, sin espacios ni saltos de línea. Una llave fhn_test_ no sirve en un tenant de producción, ni una fhn_live_ en uno de prueba. ';
  return {
    NO_AUTENTICADO:
      modo === 'demo'
        ? `${cabecera}Si tu entorno de prueba venció o perdiste su llave, crea otro con \`POST /v1/demo/entornos\`.`
        : modo === 'alojado'
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
    TENANT_FUERA_DEL_MODO_LOCAL:
      'Usa una llave del tenant «local» (tu negocio) o del «demo». Si este servidor sirve a varios negocios, el operador debe ' +
      'arrancarlo con FHN_MODO=alojado (y FHN_CLAVE_CIFRADO).',
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
    TIPO_DE_CONTENIDO: 'Envía la cabecera `Content-Type: application/json` con el cuerpo en JSON; con curl, `-H "Content-Type: application/json"`.',
    CUERPO_NO_UTF8: 'Guarda el JSON en un archivo UTF-8 y envíalo tal cual: con curl, `--data-binary @factura.json`.',
    CUERPO_DEMASIADO_GRANDE: 'El cuerpo admite hasta 512 KB: divide la venta en varios documentos o acorta los textos.',
    SOLICITUD_INVALIDA: 'Corrige el campo de `error.campo` (la lista completa está en `errores`). La forma de cada ruta está en /docs.',
    IDEMPOTENCY_KEY:
      'Envía la cabecera `Idempotency-Key` con un valor único por venta (p. ej. el id del pedido o de la venta) y, si reintentas ' +
      'esa misma venta, reutiliza el mismo valor: así nunca se emite dos veces.',
    IDEMPOTENCIA_CONFLICTO: 'Esa clave ya emitió otra venta. Usa una clave nueva para una venta distinta; para reintentar la misma venta, manda el mismo cuerpo.',
    BASE_NO_DISPONIBLE:
      'La base de datos se está reiniciando o no responde. Reintenta después de los segundos de Retry-After; al emitir, con la ' +
      'misma Idempotency-Key: si el documento alcanzó a emitirse recibes el mismo, y si no, se emite una sola vez.',
    DEMO_PAUSADO: 'La demostración está en pausa por mantenimiento o por abuso. Vuelve a intentarlo más tarde (cabecera Retry-After).',
    DEMO_NO_DISPONIBLE:
      'Esta operación no está disponible en la demostración pública (webhooks, cambiar el emisor ficticio o crear llaves). ' +
      'Pruébala en tu propia instalación: docs/autoalojamiento.md.',
    DEMO_SOLO_PRUEBA: 'Este servidor de demostración solo atiende entornos de prueba creados con `POST /v1/demo/entornos`.',
    ENTORNO_VENCIDO: 'Los entornos de prueba duran 24 horas y luego se borran con todos sus datos. Crea otro con `POST /v1/demo/entornos`.',
    DEMO_LIMITE_ENTORNOS:
      'Se alcanzó el límite de entornos de prueba (por dirección por día, o en todo el servicio). Usa el que ya creaste o ' +
      'reintenta después de los segundos de Retry-After.',
    DEMO_LIMITE_SOLICITUDES: 'Este entorno de prueba ya usó todas sus solicitudes. Crea otro entorno con `POST /v1/demo/entornos`.',
    ORIGEN_NO_PERMITIDO: 'Esta página no está entre los orígenes que el servidor acepta (FHN_DEMO_ORIGENES). Crea el entorno desde un origen permitido o sin cabecera Origin (p. ej. con curl).',
    DEMO_LIMITE_DOCUMENTOS: 'Este entorno de prueba ya emitió todos los documentos que permite. Crea otro entorno con `POST /v1/demo/entornos`.',
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
    readonly porSegundo: number,
    readonly rafaga: number,
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
  /**
   * Fichas enteras que le quedan a la clave y segundos hasta que su cubeta vuelva a estar llena, sin gastar
   * nada. Una clave sin cubeta la tiene llena. Para las cabeceras `RateLimit` (ver «Límites de solicitudes» en docs/api.md).
   */
  estado(clave: string): { restantes: number; lleno: number } {
    const c = this.cubetas.get(clave);
    const fichas = c ? Math.min(this.rafaga, c.fichas + ((this.ahora() - c.t) / 1000) * this.porSegundo) : this.rafaga;
    return { restantes: Math.max(0, Math.floor(fichas)), lleno: Math.max(0, Math.ceil((this.rafaga - fichas) / this.porSegundo)) };
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
 *   Cada elemento es una dirección o un rango en notación CIDR (`fdaa:0:1a2b::/48`, `10.0.0.0/8`): un rango
 *   sirve cuando la dirección del proxy cambia, p. ej. la red privada de una organización en Fly.io.
 */
export type ProxiesDeConfianza = number | readonly string[];

/** Valor numérico de una dirección (IPv4 de 32 bits, IPv6 de 128), o null si no es una dirección. */
function valorIp(ip: string): { bits: 32 | 128; valor: bigint } | null {
  const n = normalizarIp(ip);
  const v4 = IPV4.exec(n);
  if (v4) {
    const o = v4.slice(1).map(Number);
    return o.some((x) => x > 255) ? null : { bits: 32, valor: o.reduce((a, x) => (a << 8n) | BigInt(x), 0n) };
  }
  const g = gruposIpv6(n);
  return g ? { bits: 128, valor: g.reduce((a, x) => (a << 16n) | BigInt(x), 0n) } : null;
}

/** Un rango CIDR (`dirección/prefijo`) válido, o null. Un prefijo 0 (todas las direcciones) no se admite. */
function leerRango(texto: string): { bits: 32 | 128; red: bigint; prefijo: number } | null {
  const m = /^\[?([^\]/]+)\]?\/(\d{1,3})$/.exec(texto.trim());
  if (!m || isIP(m[1]!) === 0) return null;
  const ip = valorIp(m[1]!);
  const prefijo = Number(m[2]);
  if (!ip || prefijo < 1 || prefijo > ip.bits) return null;
  const mascara = ((1n << BigInt(prefijo)) - 1n) << BigInt(ip.bits - prefijo);
  return { bits: ip.bits, red: ip.valor & mascara, prefijo };
}

const esRango = (s: string) => s.includes('/');

/** Lee `FHN_PROXIES_DE_CONFIANZA`: vacío es 0; un número de saltos; o direcciones y rangos CIDR separados por comas. */
export function leerProxiesDeConfianza(texto: string | undefined): ProxiesDeConfianza {
  const t = (texto ?? '').trim();
  if (!t) return 0;
  if (/^\d{1,2}$/.test(t)) return Number(t);
  const lista = t.split(',').map((s) => s.trim()).filter(Boolean);
  const malas = lista.filter((s) => (esRango(s) ? leerRango(s) === null : isIP(s.replace(/^\[|\]$/g, '')) === 0));
  if (!lista.length || malas.length)
    throw new Error(
      'FHN_PROXIES_DE_CONFIANZA debe ser un número de proxies o una lista de direcciones IP o rangos CIDR (p. ej. ' +
        `fdaa:0:1a2b::/48, con prefijo de 1 o más) separados por comas (no "${t}").`,
    );
  return lista;
}

const comprobadores = new WeakMap<readonly string[], (ip: string) => boolean>();

/** ¿La dirección es una de la lista o cae en uno de sus rangos? Se prepara una vez por lista. */
export function esDeConfianza(lista: readonly string[], ip: string): boolean {
  let f = comprobadores.get(lista);
  if (!f) {
    const exactas = new Set(lista.filter((s) => !esRango(s)).map(normalizarIp));
    const rangos = lista.filter(esRango).map(leerRango).filter((r) => r !== null);
    f = (dir: string) => {
      if (exactas.has(normalizarIp(dir))) return true;
      if (!rangos.length) return false;
      const v = valorIp(dir);
      return !!v && rangos.some((r) => r.bits === v.bits && v.valor >> BigInt(r.bits - r.prefijo) === r.red >> BigInt(r.bits - r.prefijo));
    };
    comprobadores.set(lista, f);
  }
  return f(ip);
}

/**
 * Lee `FHN_IP_CLIENTE_CABECERA`: el nombre de una cabecera que el proxy de confianza pone con la dirección del
 * cliente (p. ej. `Fly-Client-IP`), o undefined. Sin definir, ninguna cabecera así se cree.
 */
export function leerCabeceraIpCliente(texto: string | undefined): string | undefined {
  const t = (texto ?? '').trim().toLowerCase();
  if (!t) return undefined;
  if (!/^[a-z0-9-]{1,64}$/.test(t)) throw new Error(`FHN_IP_CLIENTE_CABECERA debe ser el nombre de una cabecera HTTP, p. ej. Fly-Client-IP (no "${texto}").`);
  return t;
}

/**
 * Dirección del cliente para el límite de intentos. Por defecto, la del socket: `X-Forwarded-For` lo escribe
 * el cliente y no se cree. Sin socket (p. ej. una prueba con `app.request`), todas las solicitudes comparten
 * una cubeta.
 */
export function ipDeSolicitud(c: SolicitudConDireccion, proxies: ProxiesDeConfianza, cabeceraCliente?: string): string {
  type Enlace = { incoming?: { socket?: { remoteAddress?: string } } };
  const env = c.env as (Enlace & { server?: Enlace }) | undefined;
  const socket = env?.incoming?.socket?.remoteAddress ?? env?.server?.incoming?.socket?.remoteAddress;
  // Una cabecera que pone el proxy del proveedor con la dirección del cliente (p. ej. Fly-Client-IP en Fly.io). Solo
  // si se configuró: sin proxy delante, la escribe el cliente. Con un valor que no es una dirección, se ignora.
  if (cabeceraCliente) {
    const v = c.req.header(cabeceraCliente)?.trim();
    if (v && isIP(v.replace(/^\[|\]$/g, '')) !== 0) return agrupar(v);
  }
  const saltos = () => (c.req.header('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (typeof proxies === 'number') {
    if (proxies > 0) {
      const s = saltos();
      const ip = s.length >= proxies ? s[s.length - proxies] : undefined;
      if (ip) return agrupar(ip);
    }
  } else if (socket && proxies.length) {
    if (esDeConfianza(proxies, socket)) {
      const s = saltos();
      for (let i = s.length - 1; i >= 0; i--) if (!esDeConfianza(proxies, s[i]!)) return agrupar(s[i]!);
    }
  }
  return socket ? agrupar(socket) : 'desconocida';
}
