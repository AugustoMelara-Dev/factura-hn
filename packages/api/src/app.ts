/**
 * API REST de factura-hn (Hono + OpenAPI). El mismo código sirve dos modos:
 * - `alojado`: multi-tenant; cada llave de API pertenece a un tenant y la base aísla los datos con RLS.
 * - `local`: un solo negocio con su propio servidor y base en el establecimiento (Art. 47).
 *
 * El tenant sale **solo** de la llave de API, nunca de la solicitud.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { CABECERAS_DOCS, HTML_DOCS } from './docs';
import { conCabecerasComunes, conErrorDeTipoDeContenido, SOLICITUD_ID } from './contrato';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type pg from 'pg';
import {
  acumuladorResumenVentas,
  autorizacionesActivas,
  anular,
  contarDocumentos,
  corregirFechaAdelantada,
  documentosPorPaginas,
  elegirAutorizacion,
  emitir,
  esAutorizacionDePrueba,
  esCAIDemo,
  esDocumentoDePrueba,
  LEYENDA_PRUEBA,
  ErrorValidacion,
  problemaDeOperador,
  estadoAutorizacion,
  fechaHonduras,
  filaLibroVentas,
  identificadorDeNumero,
  inicioExportacion,
  inicioLibroVentasCSV,
  lineaExportacion,
  lineaLibroVentasCSV,
  noUtilizadosDelAlmacen,
  normalizarCAI,
  registrarAutorizacionConAvisos,
  renderizarHTML,
  renderizarTexto,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoFiscal,
  type Emisor as EmisorCore,
  type LibroContable,
  type TransaccionFiscal,
} from 'factura-hn';
import { AlmacenPostgres, type TransaccionPostgres } from '@factura-hn/postgres';
import { renderizarPDF } from '@factura-hn/pdf';
import { ROL_POR_DEFECTO } from './esquema';
import {
  CONSOLA_POR_DEFECTO,
  conSolucion,
  ErrorApi,
  esBaseNoDisponible,
  ipDeSolicitud,
  LimitadorSolicitudes,
  REINTENTAR_BASE_SEGUNDOS,
  Semaforo,
  SemaforoSaturado,
  soluciones,
  type ProxiesDeConfianza,
  type CuerpoError,
  type ProblemaApi,
} from './errores';
import { TENANT_DEMO, TENANT_LOCAL } from './operador';
import { configDemo, ejemplosDemo, huellaOrigen, RUTA_ENTORNOS_DEMO, type ConfigDemo } from './demo';
import { autorizacionDemo, EMISOR_DEMO } from 'factura-hn/demo';
import { coincide, generarLlave, generarTokenMcp, leerLlave, type ModoTenant, type RolLlave } from './llaves';
import * as S from './esquemas';
import {
  CofreSecretos,
  comoTransaccionPostgres,
  encolarEvento,
  MAX_INTENTOS_PRUEBA,
  MAX_PRUEBAS_PENDIENTES,
  MAX_WEBHOOKS_ACTIVOS,
  problemaDeURL,
  type EventoWebhook,
} from './webhooks';
import {
  exigirPeriodoAcotado,
  maxDocumentosReporte,
  ReportesEnCurso,
  REPORTES_POR_LLAVE,
  REPORTES_SIMULTANEOS,
  reportesSimultaneosProceso,
  transmitir,
  type Escribir,
} from './reportes';

// La versión sale de packages/api/package.json (el empaquetador la incrusta; `pnpm run version` la sube con los
// paquetes publicados). Va en `FacturaHN-Version`, `/salud` y `info.version` de `/openapi.json`.
import { version as VERSION_PAQUETE } from '../package.json';
import { mensajeEnEspanol } from './mensajes-forma';
export const VERSION_API: string = VERSION_PAQUETE;

export interface ConfigApi {
  pool: pg.Pool;
  /**
   * - `local`: un solo negocio (Art. 47); `alojado`: varios negocios con RLS;
   * - `demo`: modo demo: solo entornos de prueba que crea cualquiera con `POST /v1/demo/entornos` y que
   *   se borran a las 24 h. Sin webhooks, sin cambiar el emisor ficticio y con límites estrictos (ver `demo`).
   */
  modo: 'local' | 'alojado' | 'demo';
  /** Configuración del modo demo. Por defecto `configDemo()` (valores estrictos). Solo con `modo: 'demo'`. */
  demo?: ConfigDemo;
  /**
   * Cabecera que el proxy de confianza pone con la dirección del cliente (p. ej. `fly-client-ip` en Fly.io). Si se
   * define, manda sobre `X-Forwarded-For`. Nunca se cree por defecto: sin proxy delante, la escribe el cliente.
   */
  cabeceraIpCliente?: string;
  /** Rol de base de datos sin BYPASSRLS con el que corre cada transacción. */
  rol?: string;
  cofre?: CofreSecretos;
  reloj?: () => Date;
  /** Solicitudes por segundo y ráfaga por llave, contadas solo con el secreto correcto. Por defecto 20 y 40. */
  limiteSolicitudes?: { porSegundo: number; rafaga: number };
  /**
   * Intentos de autenticación con llaves que este proceso aún no validó.
   * - `consultasSimultaneas` (por defecto 4): consultas a la base de llaves no validadas a la vez en el proceso;
   *   las demás esperan su turno en una cola de a lo sumo `maxEnCola` (por defecto 256) durante a lo sumo
   *   `esperaMaxMs` (por defecto 5000). Más allá, 429 `DEMASIADOS_INTENTOS` con `Retry-After`.
   * - `porSegundo`, `rafaga` (por defecto 2 y 20): fichas por dirección (IPv6 por su /64). Un prefijo inexistente
   *   gasta una; una llave válida no gasta nada. Sin fichas libres, una llave que el proceso no conoce recibe 429
   *   `DEMASIADOS_INTENTOS` sin consultar la base. Con el semáforo saturado, además, cada consulta en curso de la
   *   dirección reserva una ficha.
   * - Las mismas tasas, por prefijo, para los fallos de un prefijo que existe (secreto equivocado, llave revocada
   *   o tenant inactivo): una caja que reintenta con su llave revocada se frena solo a sí misma.
   * - `memoriaInactivaMs` (por defecto 15 000): cuánto recuerda el proceso que un prefijo existe sin llave activa
   *   (revocada o tenant inactivo). Mientras tanto responde 401 o 429 sin consultar la base; un tenant
   *   reactivado vuelve a entrar al pasar ese tiempo.
   */
  limiteIntentos?: {
    porSegundo?: number;
    rafaga?: number;
    consultasSimultaneas?: number;
    maxEnCola?: number;
    esperaMaxMs?: number;
    memoriaInactivaMs?: number;
  };
  /**
   * Proxies de confianza delante de la API (por defecto 0: la dirección del cliente es la del socket y
   * `X-Forwarded-For` se ignora). Ver `ProxiesDeConfianza`.
   */
  proxiesDeConfianza?: ProxiesDeConfianza;
  /** Cómo se invoca la consola del operador en este despliegue, para los mensajes. Por defecto `node packages/api/dist/cli.js`. */
  consola?: string;
  /** Si este despliegue tiene el tenant de demostración (modo local): solo entonces la guía de errores lo menciona. */
  hayDemo?: boolean;
  /**
   * Documentos como máximo en un reporte de período (libro de ventas, exportación); más allá, 422
   * `PERIODO_DEMASIADO_GRANDE`. Por defecto `FHN_MAX_DOCUMENTOS_REPORTE` o 50 000.
   */
  maxDocumentosReporte?: number;
  /** Reportes de período en curso a la vez por tenant en este proceso; más allá, 429. Por defecto 2. */
  reportesSimultaneos?: number;
  /**
   * Reportes de período en curso a la vez por llave; más allá, 429 `LIMITE_SOLICITUDES`. Por defecto 1: una llave
   * (p. ej. una caja que lee despacio) no ocupa todos los cupos de su tenant.
   */
  reportesPorLlave?: number;
  /**
   * Reportes de período en curso a la vez en todo el proceso, de cualquier tenant; más allá, 429. Cada reporte
   * transmitido retiene una conexión del pool mientras el cliente lee. Por defecto
   * `FHN_REPORTES_SIMULTANEOS_PROCESO` o un cuarto del tamaño del pool (al menos 1).
   */
  reportesSimultaneosProceso?: number;
  /** Tiempo máximo de una respuesta transmitida (libro de ventas, exportación). Por defecto 5 minutos. */
  duracionMaxReporteMs?: number;
  /**
   * Bytes de documentos como máximo en una página de `GET /v1/documentos` (por defecto 8 MiB). La página se corta
   * antes del documento que empieza pasado el tope, con `hayMas: true`; siempre trae al menos un documento.
   */
  maxBytesPagina?: number;
  /**
   * Con `modo: 'local'`, solo atiende llaves de los tenants `local` y `demo`; la de otro tenant recibe 403
   * `TENANT_FUERA_DEL_MODO_LOCAL`. Es la red de seguridad del modo local, de un solo negocio: `arrancar` (el servidor
   * de `factura-hn-api` y de la imagen de Docker) lo activa. Por defecto `false`, para quien monta la app con sus
   * propios tenants (p. ej. las pruebas). En modo alojado no hace nada.
   */
  soloTenantsLocales?: boolean;
  registrar?: (mensaje: string, error?: unknown) => void;
}

export interface Sesion {
  tenant: string;
  rol: RolLlave;
  prefijo: string;
  /** Id interno de la llave (estable; no es parte del secreto). */
  llaveId: string;
  /** Nombre que el admin le dio a la llave (p. ej. «Caja 1»). */
  llaveNombre: string;
  establecimiento: string | null;
  puntoEmision: string | null;
  limiteMensual: number | null;
  /** Modo del tenant: `prueba` (sandbox) o `produccion`. */
  modoTenant: ModoTenant;
}

/**
 * `solicitud`: el id de la solicitud (cabecera `Solicitud-Id`), en las respuestas y los errores. `idLog`: cómo se
 * nombra en el log, siempre con un id generado por el servidor (más el del cliente, si mandó uno).
 */
type Env = { Variables: { sesion: Sesion; solicitud: string; idLog: string } };

interface LlaveAutenticada {
  tenant: string;
  hash: Buffer;
  rol: RolLlave;
  establecimiento: string | null;
  punto_emision: string | null;
  limite_mensual: number | null;
  id: string;
  nombre: string;
  modo: ModoTenant;
}
/** La llave activa de un prefijo, si la hay, y si el prefijo existe aunque la llave esté revocada o su tenant inactivo. */
interface BusquedaLlave {
  fila?: LlaveAutenticada;
  registrado: boolean;
  /** Se resolvió con la llave en memoria, sin consultar la base. */
  sinConsultar?: boolean;
}

const IDENTIFICADOR = /^\d{3}-\d{3}-\d{2}$/;
const NUMERO = /^\d{3}-\d{3}-\d{2}-\d{8}$/;
const CLAVE_IDEMPOTENCIA = /^[\x21-\x7e]{1,255}$/;

/** JSON con las claves ordenadas: la huella de una solicitud no depende del orden de los campos. */
function jsonEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${jsonEstable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Tipo de todo cuerpo JSON de la API, con su codificación explícita (Windows PowerShell 5.1 la necesita). */
export const TIPO_JSON = 'application/json; charset=utf-8';

const conError = (description: string) => ({ description, content: { 'application/json': { schema: S.ErrorRespuesta } } });
/** Respuestas de error que puede dar una operación. Cada ruta declara solo las que su código devuelve. */
const CATALOGO_ERRORES = {
  400: conError('Solicitud mal formada: forma, parámetros, cabeceras o JSON'),
  401: conError('Falta la llave de API o no es válida'),
  403: conError('La llave no tiene permiso'),
  413: conError('El cuerpo supera 512 KB (CUERPO_DEMASIADO_GRANDE). Lo puede dar cualquier operación que no sea GET, aunque no espere cuerpo.'),
  422: conError('Reglas fiscales: lista de errores'),
  429: conError('Límite de solicitudes (con `Retry-After`)'),
  500: conError('Error interno (ERROR_INTERNO). Al reportarlo, cita `error.solicitud` o la cabecera `Solicitud-Id`.'),
  503: conError('La base de datos no está disponible por un momento (BASE_NO_DISPONIBLE), con `Retry-After`. Reintenta; al emitir, con la misma Idempotency-Key.'),
} as const;
/** Toda operación que puede dar 500 consulta la base: también puede dar 503 `BASE_NO_DISPONIBLE`. */
const respuestasDe = <K extends Exclude<keyof typeof CATALOGO_ERRORES, 503>>(...estados: K[]) =>
  Object.fromEntries(estados.flatMap((e) => (e === 500 ? [500, 503] : [e])).map((e) => [e, CATALOGO_ERRORES[e as keyof typeof CATALOGO_ERRORES]])) as Pick<
    typeof CATALOGO_ERRORES,
    K | (500 extends K ? 503 : never)
  >;
/** Las de una operación con cuerpo que valida reglas fiscales y exige rol admin. */
const respuestasError = respuestasDe(400, 401, 403, 413, 422, 429, 500);
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const seguridad = [{ llave: [] }];

/** Rutas de la representación impresa de un documento emitido. */
const conEnlaces = <R extends { documento: { numero: string } }>(r: R) => ({
  ...r,
  enlaces: {
    pdf: `/v1/documentos/${r.documento.numero}.pdf`,
    html: `/v1/documentos/${r.documento.numero}.html`,
    txt: `/v1/documentos/${r.documento.numero}.txt`,
  },
});

// --- Paginación ------------------------------------------------------------------------------------------
const LIMITE_POR_DEFECTO = 100;
/** Bytes de documentos por página de `GET /v1/documentos`, por defecto. Ver `ConfigApi.maxBytesPagina`. */
export const MAX_BYTES_PAGINA = 8 * 1024 * 1024;
/** Avisos de una nota de crédito que la API solo acepta con llave admin (política de seguridad de la API, no una regla fiscal: sin el original no se puede verificar el ajuste). */
const AVISOS_NOTA_SOLO_ADMIN = new Set(['AVISO_ORIGINAL_EXTERNO']);
const FECHA_CURSOR = /^\d{4}-\d{2}-\d{2}$/;
/** Validación de cursores antes de la base: un valor fuera de rango daría 500 en lugar de 400 `CURSOR_INVALIDO`. */
const BIGINT_MAXIMO = 9_223_372_036_854_775_807n;
/** Microsegundos de 9999-12-31T23:59:59.999999Z: un `creada` real nunca pasa de ahí. */
const MICROS_MAXIMOS = 253_402_300_799_999_999n;
/** Una fecha del calendario que Postgres acepta como `date` (2024-99-99 o el año 0 darían 500). */
const esFechaCursor = (s: string) =>
  FECHA_CURSOR.test(s) && s >= '0001-01-01' && new Date(`${s}T00:00:00Z`).toJSON()?.slice(0, 10) === s;
const UUID_ESTRICTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** El cursor es opaco para el cliente: la llave de orden del último elemento, en JSON y base64url. */
const escribirCursor = (llave: unknown) => Buffer.from(JSON.stringify(llave)).toString('base64url');
function leerCursor<T>(cursor: string, valido: (v: unknown) => v is T): T {
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    v = undefined;
  }
  if (!valido(v)) throw new ErrorApi(400, 'CURSOR_INVALIDO', 'El cursor no es válido: usa el valor `siguiente` de la página anterior, sin cambios.');
  return v;
}
/** De `limite + 1` filas, la página y el cursor de la siguiente si sobró una. */
function paginar<F>(filas: F[], limite: number, llave: (f: F) => unknown) {
  const hayMas = filas.length > limite;
  const elementos = hayMas ? filas.slice(0, limite) : filas;
  return { elementos, hayMas, siguiente: hayMas ? escribirCursor(llave(elementos[elementos.length - 1]!)) : null };
}

/**
 * Segundos desde `ahora` hasta el primer día del mes siguiente a `mes` (AAAA-MM), a las 00:00 de Honduras: cuando
 * el límite mensual de documentos vuelve a cero. Honduras está en UTC-6 todo el año (sin horario de verano desde
 * 2006): las 00:00 de allá son las 06:00 UTC.
 */
export function segundosHastaElMesSiguiente(mes: string, ahora: Date): number {
  const [anio, m] = mes.split('-').map(Number) as [number, number];
  // Date.UTC con el mes 1-based como índice 0-based ya es el mes siguiente (y pasa de diciembre a enero).
  return Math.max(1, Math.ceil((Date.UTC(anio, m, 1, 6) - ahora.getTime()) / 1000));
}

/** Mensaje del `HTTPException(400)` del validador de Hono (`hono/validator`) cuando el cuerpo JSON no se puede leer. */
const MENSAJE_JSON_MAL_FORMADO = 'Malformed JSON in request body';

/** El cuerpo de error con el id de la solicitud (`error.solicitud`), el mismo de la cabecera `Solicitud-Id`. */
const conSolicitud = (c: Context<Env>, cuerpo: CuerpoError): CuerpoError => ({ ...cuerpo, error: { ...cuerpo.error, solicitud: c.get('solicitud') } });

export function crearApp(cfg: ConfigApi): OpenAPIHono<Env> {
  const rolBd = cfg.rol ?? ROL_POR_DEFECTO;
  const base = new AlmacenPostgres(cfg.pool, { rol: rolBd });
  const cofre = cfg.cofre ?? new CofreSecretos(null);
  const reloj = cfg.reloj ?? (() => new Date());
  const limitador = new LimitadorSolicitudes(cfg.limiteSolicitudes?.porSegundo ?? 20, cfg.limiteSolicitudes?.rafaga ?? 40);
  /** La cubeta de la llave como política del borrador: `q` fichas que se recuperan enteras en `w` segundos. */
  const politicaLimite = `"llave";q=${limitador.rafaga};w=${Math.max(1, Math.ceil(limitador.rafaga / limitador.porSegundo))}`;
  const li = cfg.limiteIntentos ?? {};
  const rafagaIntentos = li.rafaga ?? 20;
  const intentosPorIp = new LimitadorSolicitudes(li.porSegundo ?? 2, rafagaIntentos);
  const fallosPorPrefijo = new LimitadorSolicitudes(li.porSegundo ?? 2, li.rafaga ?? 20);
  const consultasNuevas = new Semaforo(li.consultasSimultaneas ?? 4, li.maxEnCola ?? 256, li.esperaMaxMs ?? 5000);
  const memoriaInactivaMs = li.memoriaInactivaMs ?? 15_000;
  /** Prefijos registrados sin llave activa (revocada o tenant inactivo), con el instante hasta el que se recuerdan. */
  const inactivos = new Map<string, number>();
  /** Consultas en curso de llaves no validadas, por dirección: cada una reserva una ficha de su cubeta. */
  const enVueloPorIp = new Map<string, number>();
  /** Una sola consulta en curso por prefijo: las solicitudes con el mismo prefijo esperan su resultado. */
  const enVueloPorPrefijo = new Map<string, Promise<BusquedaLlave>>();
  const proxies = cfg.proxiesDeConfianza ?? 0;
  if (typeof proxies === 'number' && (!Number.isSafeInteger(proxies) || proxies < 0))
    throw new Error('proxiesDeConfianza debe ser un entero mayor o igual que 0 o una lista de direcciones.');
  /** Hash de las llaves que este proceso ya validó, por prefijo: quien presenta el secreto correcto no gasta intentos. */
  const verificadas = new Map<string, Buffer>();
  const guia = soluciones({ consola: cfg.consola ?? CONSOLA_POR_DEFECTO, modo: cfg.modo, hayDemo: cfg.hayDemo });
  /** La guía de un 422 fuera de `POST /v1/documentos`: sin reintentar con una Idempotency-Key que la ruta no lleva. */
  const guiaSinEmision = { ...guia, VALIDACION: 'Revisa `errores`: cada uno trae su código y su campo. Corrige y reintenta.' };
  const conGuia = (p: ProblemaApi): ProblemaApi => conSolucion({ error: { codigo: '_', mensaje: '' }, errores: [p] }, guia).errores![0]!;
  const buscarLlave = (prefijo: string): Promise<BusquedaLlave> =>
    base.transaccion(async (t) => {
      const tx = comoTransaccionPostgres(t);
      const fila = (await tx.consulta<LlaveAutenticada>('SELECT * FROM fhn_api_autenticar($1)', [prefijo])).rows[0];
      if (fila) return { fila, registrado: true };
      const r = await tx.consulta<{ registrado: boolean }>('SELECT fhn_api_prefijo_registrado($1) AS registrado', [prefijo]);
      return { registrado: r.rows[0]?.registrado === true };
    });
  const registrar = cfg.registrar ?? ((m: string, e?: unknown) => console.error(m, e));
  // --- Modo demo: estado en memoria de este proceso (una sola réplica) ---
  const demo = cfg.modo === 'demo' ? (cfg.demo ?? configDemo()) : null;
  const ipDe = (c: Context<Env>) => ipDeSolicitud(c, proxies, cfg.cabeceraIpCliente);
  const maxCuerpo = demo?.maxCuerpo ?? 512 * 1024;
  const porMinuto = (n: number) => new LimitadorSolicitudes(n / 60, n);
  const demoGlobal = demo ? porMinuto(demo.solicitudesPorMinutoGlobal) : null;
  const demoPorEntorno = demo ? porMinuto(demo.solicitudesPorMinuto) : null;
  const demoCreaciones = demo ? porMinuto(demo.creacionesPorMinuto) : null;
  /** Freno en memoria por dirección antes de ir a la base: a lo sumo 3 intentos seguidos y luego uno cada 20 s. */
  const demoCreacionesPorIp = demo ? new LimitadorSolicitudes(1 / 20, 3) : null;
  /** Solicitudes de cada entorno en este proceso, para `solicitudesPorEntorno`. */
  const demoUsadas = new Map<string, number>();
  /** Vencimiento de cada entorno (no cambia), por tenant. */
  const demoExpira = new Map<string, number>();
  const demoPausa = { valor: false, hasta: 0 };
  const demoPausado = async (): Promise<boolean> => {
    if (!demo) return false;
    if (demo.pausado) return true;
    const ahora = Date.now();
    if (demoPausa.hasta > ahora) return demoPausa.valor;
    const r = await base.transaccion((t) => comoTransaccionPostgres(t).consulta<{ pausado: boolean }>('SELECT pausado FROM api_demo_control WHERE id'));
    demoPausa.valor = r.rows[0]?.pausado === true;
    demoPausa.hasta = ahora + 5000;
    return demoPausa.valor;
  };
  const errorPausa = () => new ErrorApi(503, 'DEMO_PAUSADO', 'El modo demo está en pausa. Vuelve a intentarlo más tarde.', { reintentarEn: 600 });
  const expiraDe = async (tenant: string): Promise<number | null> => {
    const ya = demoExpira.get(tenant);
    if (ya !== undefined) return ya;
    const r = await base.paraTenant(tenant).transaccion((t) =>
      comoTransaccionPostgres(t).consulta<{ expira: Date }>('SELECT expira FROM api_demo_entornos WHERE tenant = $1', [tenant]),
    );
    const e = r.rows[0]?.expira;
    if (!e) return null;
    if (demoExpira.size >= 50_000) demoExpira.delete(demoExpira.keys().next().value!);
    demoExpira.set(tenant, e.getTime());
    return e.getTime();
  };
  const segundosHasta = (ms: number) => Math.max(1, Math.ceil((ms - reloj().getTime()) / 1000));

  const maxBytesPagina = cfg.maxBytesPagina ?? demo?.maxBytesPagina ?? MAX_BYTES_PAGINA;
  if (!Number.isSafeInteger(maxBytesPagina) || maxBytesPagina < 1) throw new Error('maxBytesPagina debe ser un entero mayor que 0.');
  const ultimoUso = new Map<string, number>();

  const app = new OpenAPIHono<Env>({
    defaultHook: (r, c) => {
      if (!r.success) {
        const datos = (r as { data?: unknown }).data;
        const detalles = r.error.issues.map((i) => ({ codigo: 'SOLICITUD_INVALIDA', mensaje: mensajeEnEspanol(i, datos), campo: i.path.join('.') }));
        const primero = detalles[0];
        const cuerpo: CuerpoError = {
          error: {
            codigo: 'SOLICITUD_INVALIDA',
            mensaje: primero ? `La solicitud no tiene la forma esperada. ${primero.campo ? `${primero.campo}: ` : ''}${primero.mensaje}` : 'La solicitud no tiene la forma esperada.',
            ...(primero?.campo ? { campo: primero.campo } : {}),
          },
          errores: detalles,
        };
        return c.json<CuerpoError>(conSolicitud(c, conSolucion(cuerpo, guia)), 400);
      }
      return undefined;
    },
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'llave', {
    type: 'http',
    scheme: 'bearer',
    description:
      'Llave de API `fhn_live_<prefijo>_<secreto>` (tenant de producción) o `fhn_test_<prefijo>_<secreto>` (tenant de prueba). ' +
      'Las llaves anteriores, `fhn_<prefijo>_<secreto>`, siguen valiendo en su tenant. Rol `caja`: emite y consulta. Rol `admin`: todo.',
  });

  // --- Infraestructura -------------------------------------------------------------------------------------
  // Id de la solicitud y versión de la API en todas las respuestas, también en los errores y en /docs.
  app.use('*', async (c, next) => {
    const delCliente = c.req.header('solicitud-id');
    const interno = randomUUID();
    const propio = delCliente !== undefined && SOLICITUD_ID.test(delCliente);
    const id = propio ? delCliente : interno;
    c.set('solicitud', id);
    // El id del cliente no es único ni confiable: el log lleva siempre el del servidor y, aparte, el del cliente.
    c.set('idLog', propio ? `${interno} (cliente ${delCliente})` : interno);
    await next();
    c.header('Solicitud-Id', id);
    c.header('FacturaHN-Version', VERSION_API);
  });
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    // Todo JSON sale con `charset=utf-8`, también los errores, el 404, /salud y /openapi.json. Sin él, Windows
    // PowerShell 5.1 (Invoke-RestMethod) lee el cuerpo como Latin-1 y «Café» llega como «CafÃ©».
    if (/^application\/json\s*$/i.test(c.res.headers.get('content-type') ?? '')) c.header('Content-Type', TIPO_JSON);
  });
  // CORS solo para lo que llama el navegador (una página de un origen permitido): `POST /v1/demo/entornos`, sin credenciales.
  // Solo los orígenes de FHN_DEMO_ORIGENES; nunca «*». También en los errores (429, 503), que pasan por aquí.
  app.use('/v1/demo/*', async (c, next) => {
    const origen = c.req.header('origin');
    const permitido = demo !== null && origen !== undefined && demo.origenes.includes(origen);
    const cabeceras = () => {
      c.header('Vary', 'Origin');
      if (!permitido) return;
      c.header('Access-Control-Allow-Origin', origen!);
      c.header('Access-Control-Expose-Headers', 'Retry-After, RateLimit, RateLimit-Policy, Solicitud-Id');
    };
    await next();
    cabeceras();
    if (permitido && c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      c.header('Access-Control-Max-Age', '600');
    }
  });
  app.use('/v1/*', bodyLimit({
    maxSize: maxCuerpo,
    onError: () => {
      throw new ErrorApi(413, 'CUERPO_DEMASIADO_GRANDE', `El cuerpo supera ${Math.floor(maxCuerpo / 1024)} KB.`);
    },
  }));

  app.onError((error, c) => {
    let e = error;
    // La base se reinicia o se cayó: un 503 reintentable, no un 500. La transacción se revirtió o su resultado
    // es incierto; la misma Idempotency-Key lo resuelve sin emitir dos veces.
    if (!(e instanceof ErrorApi) && esBaseNoDisponible(e)) {
      registrar(`Base de datos no disponible (solicitud ${c.get('idLog')}): ${e.message}`);
      e = new ErrorApi(503, 'BASE_NO_DISPONIBLE', 'La base de datos no está disponible en este momento. Reintenta en unos segundos.', {
        reintentarEn: REINTENTAR_BASE_SEGUNDOS,
      });
    }
    if (e instanceof ErrorApi) {
      if ((e.estado === 429 || e.estado === 503) && typeof e.extra.reintentarEn === 'number') c.header('Retry-After', String(e.extra.reintentarEn));
      const { reintentarEn: _r, ...extra } = e.extra;
      return c.json<CuerpoError>(conSolicitud(c, conSolucion({ error: { codigo: e.codigo, mensaje: e.message }, ...extra }, guia)), e.estado);
    }
    if (e instanceof ErrorValidacion) {
      const noEncontrado = e.errores.some((p) => p.codigo === 'DOCUMENTO_NO_ENCONTRADO');
      return c.json<CuerpoError>(
        conSolicitud(c, conSolucion(
          { error: { codigo: noEncontrado ? 'NO_ENCONTRADO' : 'VALIDACION', mensaje: e.errores.map((p) => p.mensaje).join(' ') }, errores: e.errores, advertencias: e.advertencias },
          // Reintentar con la misma Idempotency-Key solo aplica a la emisión: las demás rutas no la llevan.
          c.req.method === 'POST' && c.req.path === '/v1/documentos' ? guia : guiaSinEmision,
        )),
        noEncontrado ? 404 : 422,
      );
    }
    if (e instanceof HTTPException) {
      // El validador de Hono rechaza en texto plano un cuerpo que no es JSON: se responde con la forma de error de la API.
      // Solo ese caso; cualquier otro HTTPException sigue con su respuesta.
      if (e.status === 400 && e.message === MENSAJE_JSON_MAL_FORMADO) {
        const cuerpo: CuerpoError = { error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido: revisa comillas, comas y llaves.' } };
        return c.json<CuerpoError>(conSolicitud(c, conSolucion(cuerpo, guia)), 400);
      }
      // El validador de Hono responde 415 en texto plano a un cuerpo sin `Content-Type: application/json`: también con
      // la forma de error de la API.
      if (e.status === 415) {
        const cuerpo: CuerpoError = { error: { codigo: 'TIPO_DE_CONTENIDO', mensaje: 'El cuerpo debe ser JSON: envía la cabecera Content-Type: application/json.' } };
        return c.json<CuerpoError>(conSolicitud(c, conSolucion(cuerpo, guia)), 415);
      }
      return e.getResponse();
    }
    // Red de seguridad: un texto que Postgres no admite (U+0000 en text o jsonb: 22021 y 22P05) es un error de la
    // solicitud, no del servidor. Los esquemas ya rechazan los caracteres de control donde el texto va directo a la base.
    const sqlstate = (e as { code?: unknown }).code;
    if (sqlstate === '22021' || sqlstate === '22P05') {
      const cuerpo: CuerpoError = { error: { codigo: 'SOLICITUD_INVALIDA', mensaje: 'Un texto de la solicitud tiene un carácter que no se puede guardar (p. ej. U+0000).' } };
      return c.json<CuerpoError>(conSolicitud(c, conSolucion(cuerpo, guia)), 400);
    }
    registrar(`Error interno (solicitud ${c.get('idLog')})`, e);
    return c.json<CuerpoError>(conSolicitud(c, { error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno. Se registró para revisión.' } }), 500);
  });
  app.notFound((c) => c.json<CuerpoError>(conSolicitud(c, { error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada.' } }), 404));

  // --- Demo pública: crear un entorno de prueba (sin llave) ------------------------------------------------------
  // Se registra antes de la autenticación: su manejador responde sin pasar por ella. Fuera del modo demo, 404.
  app.openapi(
    createRoute({
      method: 'post', path: RUTA_ENTORNOS_DEMO, operationId: 'crearEntornoDemo', tags: ['Demostración'], security: [],
      summary: 'Crea un entorno de prueba propio (solo con el modo demo activo)',
      description:
        'Solo con `FHN_MODO=demo`; en los demás modos responde 404. Sin llave y sin cuerpo. Crea un entorno aislado para ' +
        'quien llama: un tenant de prueba con emisor y CAI ficticios (`DEMO00-NO-VALIDO-…`), una llave admin `fhn_test_` y, si el ' +
        'servidor lo tiene, la URL del MCP remoto del entorno. Todo lo emitido es DOCUMENTO DE PRUEBA — SIN VALOR FISCAL. El ' +
        'entorno y todos sus datos se borran al vencer (24 h por defecto). Límites: entornos por dirección por día y en todo ' +
        'el servicio (429 `DEMO_LIMITE_ENTORNOS` con `Retry-After`); en pausa, 503 `DEMO_PAUSADO`. CORS solo para los ' +
        'orígenes de `FHN_DEMO_ORIGENES`; una solicitud con otro `Origin` recibe 403 `ORIGEN_NO_PERMITIDO` (sin `Origin`, p. ej. ' +
        'curl, se atiende).',
      responses: {
        201: json(S.RespuestaEntornoDemo, 'Entorno creado. La llave y la URL del MCP se muestran solo esta vez.'),
        403: json(S.ErrorRespuesta, 'La solicitud viene de una página de otro sitio (ORIGEN_NO_PERMITIDO)'),
        404: json(S.ErrorRespuesta, 'Este servidor no está en modo demo (NO_ENCONTRADO)'),
        ...respuestasDe(413, 429, 500),
      },
    }),
    async (c) => {
      if (!demo) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Ruta no encontrada.');
      // Todo entorno del modo demo es de prueba: lo dice también en los errores (403, 429, 503).
      c.header('FacturaHN-Modo', 'prueba');
      // CORS no frena un POST sin cuerpo (es una solicitud «simple»): una página de otro sitio podría crear entornos con
      // la dirección de sus visitantes. Con Origin, solo los de FHN_DEMO_ORIGENES; sin Origin (curl, el SDK), se atiende.
      const origen = c.req.header('origin');
      if (origen !== undefined && !demo.origenes.includes(origen)) {
        throw new ErrorApi(403, 'ORIGEN_NO_PERMITIDO', 'Esta página no puede crear entornos de prueba: su origen no está en FHN_DEMO_ORIGENES. Usa un origen permitido o curl.');
      }
      if (await demoPausado()) throw errorPausa();
      const ip = ipDe(c);
      const limite = (espera: number) => {
        if (espera > 0) throw new ErrorApi(429, 'DEMO_LIMITE_ENTORNOS', 'Se crearon demasiados entornos de prueba. Espera y reintenta.', { reintentarEn: espera });
      };
      limite(demoCreacionesPorIp!.tomar(ip));
      // El cupo global por minuto se mira aquí y se gasta solo si el entorno se crea: los intentos que la base rechaza
      // (dirección sin cupo) no lo consumen, así unas pocas direcciones no bloquean a todos.
      limite(demoCreaciones!.espera('global'));
      const creado = reloj();
      const expira = new Date(creado.getTime() + demo.horas * 3_600_000);
      const tenant = `demo-${randomBytes(8).toString('hex')}`;
      const llave = generarLlave('prueba');
      const mcp = demo.urlMcp ? generarTokenMcp('prueba') : null;
      const r = await base.paraTenant(tenant).transaccion(async (t) => {
        const tx = comoTransaccionPostgres(t);
        const cupo = (await tx.consulta<{ estado: string; reintentar_en: number }>(
          'SELECT estado, reintentar_en FROM fhn_api_crear_entorno_demo($1, $2, $3, $4, $5, $6, $7, $8)',
          [tenant, 'Entorno de prueba', creado, expira, huellaOrigen(demo.secreto, ip), demo.entornosPorIp, demo.maxEntornos, demo.documentos],
        )).rows[0]!;
        if (cupo.estado !== 'ok') return cupo;
        await tx.consulta('INSERT INTO api_emisores (tenant, datos) VALUES ($1, $2)', [tenant, JSON.stringify(EMISOR_DEMO)]);
        const insertarLlave = (k: { prefijo: string; hash: Buffer }, nombre: string) =>
          tx.consulta("INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre) VALUES ($1, $2, $3, 'admin', $4)", [k.prefijo, tenant, k.hash, nombre]);
        await insertarLlave(llave, 'Visitante (demo)');
        if (mcp) await insertarLlave(mcp, 'MCP remoto (demo)');
        // Los CAI ficticios, en la misma transacción: un entorno nunca queda a medias.
        const enEstaTx = { transaccion: <T>(fn: (x: TransaccionFiscal) => Promise<T>) => fn(t) } as unknown as AlmacenPostgres;
        for (const tipoDocumento of ['01', '06', '07'] as const) {
          await registrarAutorizacionConAvisos(enEstaTx, autorizacionDemo({ hoy: creado, tipoDocumento, rangoFinal: 5000 }), { reloj, actor: 'demo' });
        }
        await bitacora(tx, 'demo', 'llave.creada', { prefijo: llave.prefijo, rol: 'admin', modo: 'prueba', ...(mcp ? { mcp: mcp.prefijo } : {}) });
        return cupo;
      });
      if (r.estado === 'pausado') throw errorPausa();
      if (r.estado !== 'ok') {
        throw new ErrorApi(429, 'DEMO_LIMITE_ENTORNOS', r.estado === 'por_origen'
          ? `Ya creaste ${demo.entornosPorIp} entornos de prueba en las últimas 24 horas. Usa uno de ellos o espera.`
          : 'Hay demasiados entornos de prueba abiertos en este momento. Reintenta más tarde.', { reintentarEn: r.reintentar_en });
      }
      demoCreaciones!.tomar('global');
      demoExpira.set(tenant, expira.getTime());
      const urlApi = demo.urlApi ?? new URL(c.req.url).origin;
      const urlMcp = mcp ? `${demo.urlMcp}/${mcp.token}` : null;
      return c.json({
        entorno: {
          id: tenant, creado: creado.toISOString(), expira: expira.toISOString(), modo: 'prueba' as const, leyenda: LEYENDA_PRUEBA,
          establecimiento: '000', puntoEmision: '001',
          emisor: { rtn: EMISOR_DEMO.rtn, razonSocial: EMISOR_DEMO.razonSocial, nombreComercial: EMISOR_DEMO.nombreComercial },
          limites: { documentos: demo.documentos, solicitudesPorMinuto: demo.solicitudesPorMinuto, solicitudesTotales: demo.solicitudesPorEntorno, maxCuerpoBytes: demo.maxCuerpo },
        },
        llave: llave.llave,
        mcp: mcp && urlMcp ? { url: urlMcp, prefijo: mcp.prefijo } : null,
        api: { url: urlApi },
        ejemplos: ejemplosDemo({ urlApi, llave: llave.llave, urlMcp }),
        aviso:
          `Entorno de prueba: emisor y CAI ficticios. Todo lo que emitas lleva «${LEYENDA_PRUEBA}». Se borra con todos sus datos el ` +
          `${expira.toISOString()}. La llave y la URL del MCP se muestran solo ahora: guárdalas. No pongas datos reales de personas.`,
      }, 201);
    },
  );

  /**
   * Modo demo, dentro de la autenticación (antes de las cabeceras de la llave): solo entornos de prueba vigentes,
   * interruptor global, límites por entorno y globales, y fuera lo que no tiene sentido en modo demo
   * (webhooks: la red interna del proveedor; cambiar el emisor ficticio; crear llaves). Revocar una llave sí se
   * puede: así se apaga la URL del MCP.
   */
  const exigirDemo = async (c: Context<Env>, tenant: string, modoTenant: ModoTenant) => {
    if (!demo) return;
    if (await demoPausado()) throw errorPausa();
    const soloPrueba = () => new ErrorApi(403, 'DEMO_SOLO_PRUEBA', 'Este servidor está en modo demo: solo atiende entornos de prueba.');
    if (modoTenant !== 'prueba') throw soloPrueba();
    const expira = await expiraDe(tenant);
    if (expira === null) throw soloPrueba();
    if (expira <= reloj().getTime()) throw new ErrorApi(401, 'ENTORNO_VENCIDO', 'Este entorno de prueba venció y se borra con todos sus datos.');
    const m = c.req.method;
    const ruta = c.req.path;
    if (ruta.startsWith('/v1/webhooks') || (ruta.startsWith('/v1/emisores') && m !== 'GET') || (ruta === '/v1/llaves' && m === 'POST')) {
      throw new ErrorApi(403, 'DEMO_NO_DISPONIBLE', 'Esta operación no está disponible en modo demo.');
    }
    const lleno = (espera: number) => {
      if (espera > 0) throw new ErrorApi(429, 'DEMASIADAS_SOLICITUDES', 'Demasiadas solicitudes en modo demo. Espera y reintenta.', { reintentarEn: espera });
    };
    // Primero los límites del entorno y al final el global: un entorno que se pasa de los suyos no gasta el cupo de
    // todos (con sus dos llaves admin podría agotarlo y dejar en 429 a los demás visitantes).
    const usadas = (demoUsadas.get(tenant) ?? 0) + 1;
    if (usadas > demo.solicitudesPorEntorno) {
      throw new ErrorApi(429, 'DEMO_LIMITE_SOLICITUDES', `Este entorno de prueba ya hizo sus ${demo.solicitudesPorEntorno} solicitudes.`, { reintentarEn: segundosHasta(expira) });
    }
    lleno(demoPorEntorno!.tomar(tenant));
    lleno(demoGlobal!.tomar('global'));
    if (!demoUsadas.has(tenant) && demoUsadas.size >= 50_000) demoUsadas.delete(demoUsadas.keys().next().value!);
    demoUsadas.set(tenant, usadas);
  };

  app.openapi(
    createRoute({
      method: 'options', path: RUTA_ENTORNOS_DEMO, operationId: 'preflightEntornoDemo', tags: ['Demostración'], security: [],
      summary: 'Preflight CORS de la creación de entornos',
      description: 'Con `FHN_MODO=demo` y un `Origin` de `FHN_DEMO_ORIGENES`, lleva las cabeceras `Access-Control-*`; si no, ninguna.',
      responses: { 204: { description: 'Sin cuerpo' }, ...respuestasDe(413, 500) },
    }),
    (c) => c.body(null, 204),
  );

  // Autenticación: Authorization: Bearer fhn_live_<prefijo>_<secreto>, fhn_test_<prefijo>_<secreto> o fhn_<prefijo>_<secreto>
  app.use('/v1/*', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    const llave = /^bearer +(\S+)$/i.exec(auth.trim())?.[1] ?? '';
    const forma = leerLlave(llave);
    const noValida = new ErrorApi(401, 'NO_AUTENTICADO', 'Falta la llave de API o no es válida.');
    if (!forma) throw noValida;
    const { prefijo } = forma;
    // Cabeceras del borrador IETF de RateLimit (draft-ietf-httpapi-ratelimit-headers): cuota de la llave y lo que
    // le queda. Solo con el secreto correcto: en el 429 de la llave y en las respuestas autenticadas, no en un 401.
    const cabecerasLimite = () => {
      const { restantes, lleno } = limitador.estado(prefijo);
      c.header('RateLimit-Policy', politicaLimite);
      c.header('RateLimit', `"llave";r=${restantes};t=${lleno}`);
    };
    const limitarLlave = () => {
      const espera = limitador.tomar(prefijo);
      if (espera > 0) cabecerasLimite();
      if (espera > 0) throw new ErrorApi(429, 'DEMASIADAS_SOLICITUDES', 'Demasiadas solicitudes con esta llave. Espera y reintenta.', { reintentarEn: espera });
    };
    // El límite de la llave cuenta solo solicitudes con su secreto correcto: conocer un prefijo no basta para
    // dejarla en 429. Una llave que este proceso ya validó (mismo hash, en memoria) no pasa por el límite de
    // intentos. Las demás: (1) una sola consulta por prefijo a la vez y a lo sumo `consultasSimultaneas` en el
    // proceso; las demás esperan en una cola acotada en tamaño y tiempo; (2) un prefijo desconocido necesita una
    // ficha libre de su dirección (si hay que hacer cola, además de las reservadas por sus consultas en curso), o
    // recibe 429 sin consultar la base; (3) el fallo de un prefijo que existe se cobra a ese prefijo y el de un prefijo
    // inexistente, a la dirección; (4) un prefijo registrado sin llave activa se recuerda `memoriaInactivaMs`.
    // Una llave válida no gasta fichas.
    const hashVisto = verificadas.get(prefijo);
    const conocida = hashVisto !== undefined && coincide(llave, hashVisto);
    const ip = ipDe(c);
    // Un prefijo que ya se sabe registrado no gasta fichas de la dirección.
    const registradoConocido = fallosPorPrefijo.tiene(prefijo);
    let reservada = false;
    let busqueda: BusquedaLlave;
    try {
      if (conocida) {
        limitarLlave();
        busqueda = await buscarLlave(prefijo);
      } else if (hashVisto !== undefined) {
        // Prefijo ya validado con otro secreto: el hash de un prefijo no cambia, así que este secreto es
        // equivocado y no hace falta consultar la base.
        busqueda = { registrado: true, sinConsultar: true };
      } else if ((inactivos.get(prefijo) ?? 0) > Date.now()) {
        // Registrado sin llave activa hace menos de `memoriaInactivaMs`: no se vuelve a consultar.
        busqueda = { registrado: true, sinConsultar: true };
      } else {
        inactivos.delete(prefijo);
        // Quien llega mientras ya se consulta su prefijo espera ese resultado: no consulta la base ni reserva.
        let enCurso = enVueloPorPrefijo.get(prefijo);
        if (!enCurso) {
          // Un prefijo desconocido necesita una ficha libre de su dirección, también sin cola: así se frenan los
          // intentos seguidos, uno tras otro, que nunca llenan la cola. Con cola, además de las reservadas por sus
          // consultas en curso. Uno ya conocido no gasta fichas, pero con cola la dirección no puede tener más de
          // `rafaga` consultas en curso: si no, quien conoce muchos prefijos (p. ej. un admin con muchas llaves)
          // llena la cola para todos.
          const saturado = consultasNuevas.saturado;
          const enVuelo = enVueloPorIp.get(ip) ?? 0;
          const espera = registradoConocido
            ? (saturado && enVuelo >= rafagaIntentos ? 1 : 0)
            : intentosPorIp.espera(ip, saturado ? enVuelo : 0);
          if (espera > 0) throw new ErrorApi(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos con llaves no válidas. Espera y reintenta.', { reintentarEn: espera });
          enVueloPorIp.set(ip, (enVueloPorIp.get(ip) ?? 0) + 1);
          reservada = true;
          enCurso = consultasNuevas.con(() => buscarLlave(prefijo)).finally(() => enVueloPorPrefijo.delete(prefijo));
          enVueloPorPrefijo.set(prefijo, enCurso);
        }
        try {
          busqueda = await enCurso;
        } catch (e) {
          if (e instanceof SemaforoSaturado) {
            throw new ErrorApi(429, 'DEMASIADOS_INTENTOS', 'Demasiadas llaves por validar a la vez. Espera y reintenta.', {
              reintentarEn: Math.max(1, Math.ceil((li.esperaMaxMs ?? 5000) / 1000)),
            });
          }
          throw e;
        }
      }
      const { fila: hallada, registrado } = busqueda;
      if (!hallada && registrado && !busqueda.sinConsultar) {
        if (inactivos.size >= 10_000) inactivos.delete(inactivos.keys().next().value!);
        inactivos.set(prefijo, Date.now() + memoriaInactivaMs);
      }
      if (!hallada || !coincide(llave, hallada.hash)) {
        // La llave en memoria se descarta solo si ya no está activa o cambió: un secreto equivocado no la saca.
        if (hashVisto !== undefined && !busqueda.sinConsultar && (!hallada || !hallada.hash.equals(hashVisto))) verificadas.delete(prefijo);
        if (hallada || registrado) {
          const espera = fallosPorPrefijo.tomar(prefijo);
          if (espera > 0) throw new ErrorApi(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos con llaves no válidas. Espera y reintenta.', { reintentarEn: espera });
        } else intentosPorIp.tomar(ip);
        throw noValida;
      }
    } finally {
      if (reservada) {
        const n = (enVueloPorIp.get(ip) ?? 1) - 1;
        if (n > 0) enVueloPorIp.set(ip, n);
        else enVueloPorIp.delete(ip);
      }
    }
    const fila = busqueda.fila!;
    // La fuente de verdad es el modo del tenant: una llave fhn_test_ solo entra a un tenant de prueba y una
    // fhn_live_, solo a uno de producción. Como el hash cubre la marca, esto solo pasa si el operador cambió el modo
    // del tenant en la base. Una llave sin marca vale en su tenant, sea del modo que sea.
    // Se cobra como un secreto equivocado (al prefijo) y el 401 es el mismo.
    if (forma.modo !== null && forma.modo !== fila.modo) {
      verificadas.delete(prefijo);
      const espera = fallosPorPrefijo.tomar(prefijo);
      if (espera > 0) throw new ErrorApi(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos con llaves no válidas. Espera y reintenta.', { reintentarEn: espera });
      throw noValida;
    }
    // Red de seguridad del modo local (un solo negocio): una llave de otro tenant no entra. El arranque se niega con
    // tenants ajenos y `tenant crear` también, pero un tenant creado por otra vía mientras corre tendría webhooks
    // sin el filtro de la red interna hasta el próximo arranque.
    if (cfg.modo === 'local' && cfg.soloTenantsLocales && fila.tenant !== TENANT_LOCAL && fila.tenant !== TENANT_DEMO) {
      throw new ErrorApi(403, 'TENANT_FUERA_DEL_MODO_LOCAL', 'Este servidor corre en modo local, para un solo negocio, y la llave es de otro tenant.');
    }
    await exigirDemo(c, fila.tenant, fila.modo);
    if (!conocida) {
      verificadas.set(prefijo, fila.hash);
      if (verificadas.size > 10_000) verificadas.delete(verificadas.keys().next().value!);
      limitarLlave();
    }
    cabecerasLimite();
    // Último uso: solo con el secreto correcto y a lo sumo una vez por minuto por llave.
    const ahoraMs = Date.now();
    if ((ultimoUso.get(prefijo) ?? 0) < ahoraMs - 60_000) {
      ultimoUso.set(prefijo, ahoraMs);
      if (ultimoUso.size > 10_000) ultimoUso.delete(ultimoUso.keys().next().value!);
      await base.transaccion((t) => comoTransaccionPostgres(t).consulta('SELECT fhn_api_marcar_uso($1, $2)', [prefijo, fila.hash]));
    }
    c.set('sesion', {
      tenant: fila.tenant,
      rol: fila.rol,
      prefijo,
      llaveId: fila.id,
      llaveNombre: fila.nombre,
      establecimiento: fila.establecimiento,
      puntoEmision: fila.punto_emision,
      limiteMensual: fila.limite_mensual,
      modoTenant: fila.modo,
    });
    await next();
    c.header('FacturaHN-Modo', fila.modo);
  });

  // El cuerpo debe ser UTF-8 válido. Sin esto, un byte en otra codificación (p. ej. «é» en Latin-1 desde una
  // consola de Windows) se convierte en U+FFFD y queda guardado en un documento que ya no se puede corregir.
  const utf8Estricto = new TextDecoder('utf-8', { fatal: true });
  app.use('/v1/*', async (c, next) => {
    if (c.req.raw.body) {
      try {
        utf8Estricto.decode(await c.req.arrayBuffer());
      } catch {
        throw new ErrorApi(
          400,
          'CUERPO_NO_UTF8',
          'El cuerpo no es UTF-8 válido. Envía el JSON en UTF-8; con curl, guárdalo en un archivo y usa --data-binary @archivo.json.',
        );
      }
    }
    await next();
  });

  const sesion = (c: Context<Env>) => c.get('sesion');
  const almacenDe = (c: Context<Env>) => base.paraTenant(sesion(c).tenant);
  // La bitácora apoya los controles de auditoría del Art. 53 num. 2; el operador es opcional y no lo exige el
  // Reglamento. El actor es el id interno de la llave, con su rol y nombre al momento de la operación.
  const actor = (c: Context<Env>) => {
    const s = sesion(c);
    return `llave:${s.llaveId} (${s.rol}: ${s.llaveNombre})`;
  };
  /**
   * Operador (p. ej. el cajero) del cuerpo o de la cabecera X-Operador (codificada con encodeURIComponent si
   * lleva caracteres fuera de ASCII). Si llegan ambos, deben coincidir. Lo valida el núcleo (`OPERADOR`, 422).
   */
  const operadorDe = (c: Context<Env>, delCuerpo: string | undefined): string | undefined => {
    const cabecera = c.req.header('x-operador');
    let deCabecera: string | undefined;
    if (cabecera !== undefined) {
      try {
        deCabecera = decodeURIComponent(cabecera);
      } catch {
        throw new ErrorApi(400, 'OPERADOR_CABECERA', 'La cabecera X-Operador no es válida: codifícala con encodeURIComponent.');
      }
    }
    if (deCabecera !== undefined && delCuerpo !== undefined && deCabecera.trim() !== delCuerpo.trim()) {
      throw new ErrorApi(400, 'OPERADOR_CONFLICTO', 'El operador del cuerpo y el de la cabecera X-Operador no coinciden.');
    }
    const op = delCuerpo ?? deCabecera;
    const p = problemaDeOperador(op);
    if (p) throw new ErrorValidacion([p]);
    return op?.trim();
  };
  const exigirAdmin = (c: Context<Env>) => {
    if (sesion(c).rol !== 'admin') throw new ErrorApi(403, 'SOLO_ADMIN', 'Esta operación requiere una llave con rol admin.');
  };
  /** Una transacción del tenant de la sesión con acceso SQL a las tablas de la API. */
  const enTenant = <T>(c: Context<Env>, fn: (tx: TransaccionPostgres) => Promise<T>) =>
    almacenDe(c).transaccion((t) => fn(comoTransaccionPostgres(t)));
  const bitacora = (tx: TransaccionPostgres, quien: string, accion: string, detalle: Record<string, unknown> = {}, operador?: string) =>
    tx.consulta('INSERT INTO api_bitacora (tenant, actor, accion, detalle, operador) VALUES ($1, $2, $3, $4, $5)', [tx.tenant, quien, accion, JSON.stringify(detalle), operador ?? null]);
  const libroWebhooks: LibroContable = {
    async registrarEmision() {},
    async registrarAnulacion(doc: DocumentoFiscal, tx: TransaccionFiscal) {
      await encolarEvento(comoTransaccionPostgres(tx), 'documento.anulado', `documento.anulado:${doc.numero}`, doc, reloj());
    },
  };

  // --- Público ---------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({ method: 'get', path: '/salud', operationId: 'obtenerSalud', tags: ['Sistema'], security: [], summary: 'Estado del servicio', responses: { 200: json(z.object({ ok: z.boolean(), version: z.string(), modo: z.string() }), 'En servicio'), ...respuestasDe(500) } }),
    async (c) => {
      await cfg.pool.query('SELECT 1');
      return c.json({ ok: true, version: VERSION_API, modo: cfg.modo }, 200);
    },
  );

  // --- Emisores --------------------------------------------------------------------------------------------
  type EmisorGuardado = z.infer<typeof S.Emisor>;
  const problemasEmisor = (e: EmisorGuardado) => {
    const { errores } = validarEntrada(
      { emisor: e as EmisorCore, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] },
      { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 1, fechaLimiteEmision: '2999-12-31' },
    );
    const delEmisor = errores.filter((p) => p.campo?.startsWith('emisor'));
    if (delEmisor.length) throw new ErrorValidacion(delEmisor);
  };
  const leerEmisor = async (tx: TransaccionPostgres) => {
    const r = await tx.consulta<{ id: string; datos: EmisorGuardado }>('SELECT id, datos FROM api_emisores WHERE tenant = $1', [tx.tenant]);
    return r.rows[0] ?? null;
  };

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/emisores', operationId: 'crearEmisor', tags: ['Emisor'], security: seguridad,
      summary: 'Registra los datos del obligado tributario (uno por tenant)',
      request: { body: { content: { 'application/json': { schema: S.Emisor } }, required: true } },
      responses: { 201: json(S.RespuestaEmisor, 'Registrado'), 409: json(S.ErrorRespuesta, 'Ya existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const e = c.req.valid('json');
      problemasEmisor(e);
      const id = await enTenant(c, async (tx) => {
        const r = await tx.consulta<{ id: string }>('INSERT INTO api_emisores (tenant, datos) VALUES ($1, $2) ON CONFLICT (tenant) DO NOTHING RETURNING id', [tx.tenant, JSON.stringify(e)]);
        if (!r.rows[0]) {
          const actual = await leerEmisor(tx);
          throw new ErrorApi(409, 'EMISOR_EXISTE', `Este tenant ya tiene emisor (id ${actual?.id}): usa PATCH /v1/emisores/${actual?.id}.`, { id: actual?.id });
        }
        await bitacora(tx, actor(c), 'emisor.creado', { rtn: e.rtn });
        return r.rows[0].id;
      });
      return c.json({ emisor: { id, ...e } }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/emisores', operationId: 'listarEmisores', tags: ['Emisor'], security: seguridad, summary: 'El emisor del tenant (lista de 0 o 1)',
      responses: { 200: json(S.pagina('emisores', S.EmisorGuardado), 'Lista'), ...respuestasDe(401, 403, 429, 500) },
    }),
    async (c) => {
      const e = await enTenant(c, leerEmisor);
      return c.json({ emisores: e ? [{ id: e.id, ...e.datos }] : [], hayMas: false, siguiente: null }, 200);
    },
  );

  const rutaEmisorId = z.object({ id: z.string().uuid() });
  app.openapi(
    createRoute({
      method: 'get', path: '/v1/emisores/{id}', operationId: 'obtenerEmisor', tags: ['Emisor'], security: seguridad, summary: 'Datos del emisor',
      request: { params: rutaEmisorId },
      responses: { 200: json(S.RespuestaEmisor, 'Emisor'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasDe(400, 401, 403, 429, 500) },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const e = await enTenant(c, leerEmisor);
      if (!e || e.id !== id) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Emisor no encontrado.');
      return c.json({ emisor: { id: e.id, ...e.datos } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch', path: '/v1/emisores/{id}', operationId: 'actualizarEmisor', tags: ['Emisor'], security: seguridad,
      summary: 'Actualiza el emisor (solo afecta a los documentos futuros; el RTN no cambia)',
      request: { params: rutaEmisorId, body: { content: { 'application/json': { schema: S.EmisorCambios } }, required: true } },
      responses: { 200: json(S.RespuestaEmisor, 'Actualizado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      const cambios = c.req.valid('json');
      const nuevo = await enTenant(c, async (tx) => {
        const e = await leerEmisor(tx);
        if (!e || e.id !== id) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Emisor no encontrado.');
        if (cambios.rtn !== undefined && cambios.rtn !== e.datos.rtn) {
          throw new ErrorApi(422, 'EMISOR_RTN_INMUTABLE', 'El RTN identifica al obligado tributario y sus autorizaciones: no se cambia. Crea otro tenant.');
        }
        const datos = { ...e.datos, ...cambios };
        problemasEmisor(datos);
        await tx.consulta('UPDATE api_emisores SET datos = $2, actualizado = now() WHERE tenant = $1', [tx.tenant, JSON.stringify(datos)]);
        await bitacora(tx, actor(c), 'emisor.actualizado', { campos: Object.keys(cambios) });
        return datos;
      });
      return c.json({ emisor: { id, ...nuevo } }, 200);
    },
  );

  // --- Autorizaciones (CAI) --------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/autorizaciones', operationId: 'registrarAutorizacion', tags: ['Autorizaciones'], security: seguridad,
      summary: 'Registra una autorización del SAR (CAI, rango y fecha límite)',
      description:
        'Un tenant de prueba solo acepta CAI ficticios (`DEMO00-NO-VALIDO-…`; si no, `AUTORIZACION_REAL_EN_DEMO`). Uno de ' +
        'producción no los acepta (`CAI_DE_PRUEBA`).',
      request: { body: { content: { 'application/json': { schema: S.Autorizacion } }, required: true } },
      responses: { 201: json(S.RespuestaAutorizacionNueva, 'Registrada, con sus avisos'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const cuerpo = c.req.valid('json') as AutorizacionCAI;
      const caiDemo = esCAIDemo(cuerpo.cai);
      const { tenant, modoTenant } = sesion(c);
      // Modo de prueba visible, según el modo del tenant: un tenant de prueba (sandbox) solo registra CAI ficticios y uno
      // de producción ninguno. Un CAI real en el sandbox emitiría documentos con apariencia válida fuera de la serie
      // real; un DEMO00 pegado por error en producción convertiría en «de prueba» un punto de emisión real.
      if (modoTenant === 'prueba' && !caiDemo) {
        const mensaje = `El tenant «${tenant}» es de prueba: solo acepta CAI ficticios (DEMO00-NO-VALIDO-…). Registra tu CAI real en un tenant de producción, con su llave fhn_live_.`;
        throw new ErrorApi(422, 'AUTORIZACION_REAL_EN_DEMO', mensaje, { errores: [{ codigo: 'AUTORIZACION_REAL_EN_DEMO', mensaje, campo: 'cai' }] });
      }
      if (modoTenant === 'produccion' && caiDemo) {
        const mensaje = `El CAI ${cuerpo.cai} es ficticio y el tenant «${tenant}» es de producción: no acepta CAI ficticios. Para probar, usa un tenant de prueba (llave fhn_test_).`;
        throw new ErrorApi(422, 'CAI_DE_PRUEBA', mensaje, { errores: [{ codigo: 'CAI_DE_PRUEBA', mensaje, campo: 'cai' }] });
      }
      const { autorizacion: a, advertencias } = await registrarAutorizacionConAvisos(almacenDe(c), cuerpo, { reloj, actor: actor(c), operador: operadorDe(c, undefined) });
      return c.json({ autorizacion: a as unknown as z.infer<typeof S.Autorizacion>, advertencias }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/autorizaciones', operationId: 'listarAutorizaciones', tags: ['Autorizaciones'], security: seguridad, summary: 'Autorizaciones registradas',
      responses: { 200: json(S.pagina('autorizaciones', S.Autorizacion), 'Lista'), ...respuestasDe(401, 403, 429, 500) },
    }),
    async (c) => {
      const lista = await enTenant(c, async (tx) =>
        (await tx.consulta<{ datos: AutorizacionCAI }>('SELECT datos FROM fhn_autorizaciones WHERE tenant = $1 ORDER BY identificador, rango_inicial', [tx.tenant])).rows.map((f) => f.datos),
      );
      return c.json({ autorizaciones: lista as unknown as z.infer<typeof S.Autorizacion>[], hayMas: false, siguiente: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/autorizaciones/{cai}/estado', operationId: 'obtenerEstadoAutorizacion', tags: ['Autorizaciones'], security: seguridad,
      summary: 'Vigencia y rango restante de una autorización (Arts. 59 y 62)',
      request: { params: z.object({ cai: z.string().min(1).max(60) }) },
      responses: { 200: json(S.RespuestaEstado, 'Estado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasDe(400, 401, 403, 429, 500) },
    }),
    async (c) => {
      const cai = normalizarCAI(c.req.valid('param').cai);
      // Un NUL no cabe en un texto de Postgres (la consulta fallaría con 500): ese CAI no puede estar registrado.
      if (cai.includes('\u0000')) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Autorización no encontrada.');
      const r = await enTenant(c, async (tx) => {
        const a = (await tx.consulta<{ datos: AutorizacionCAI; identificador: string }>('SELECT datos, identificador FROM fhn_autorizaciones WHERE tenant = $1 AND cai = $2', [tx.tenant, cai])).rows[0];
        if (!a) return null;
        const s = (await tx.consulta<{ ultimo: number | null }>('SELECT ultimo FROM fhn_series WHERE tenant = $1 AND identificador = $2', [tx.tenant, a.identificador])).rows[0];
        // Una demo de un punto que ya tiene una autorización real (de cualquier tipo) está retirada: un punto pasa de prueba a real, nunca al revés.
        let puntoConReal = false;
        if (esAutorizacionDePrueba(a.datos)) {
          const delPunto = await tx.consulta<{ datos: AutorizacionCAI }>(
            'SELECT datos FROM fhn_autorizaciones WHERE tenant = $1 AND left(identificador, 7) = $2',
            [tx.tenant, a.identificador.slice(0, 7)],
          );
          puntoConReal = delPunto.rows.some((f) => !esAutorizacionDePrueba(f.datos));
        }
        return { aut: a.datos, ultimo: s?.ultimo ?? null, puntoConReal };
      });
      if (!r) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Autorización no encontrada.');
      const consumido = Math.max(r.ultimo ?? 0, r.aut.ultimoEmitidoAntes ?? 0);
      const ultimo = consumido < r.aut.rangoInicial ? null : Math.min(consumido, r.aut.rangoFinal);
      const estado = estadoAutorizacion(r.aut, ultimo, { hoy: fechaHonduras(reloj()), puntoConReal: r.puntoConReal });
      return c.json({ autorizacion: r.aut as unknown as z.infer<typeof S.Autorizacion>, estado: { ...estado, retirada: estado.retirada === true } }, 200);
    },
  );

  // --- Sesión ---------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get', path: '/v1/sesion', operationId: 'obtenerSesion', tags: ['Sesión'], security: seguridad,
      summary: 'Con qué llave hablas y qué falta para emitir',
      description:
        'Tenant, rol, nombre y caja de la llave, modo del servidor, autorizaciones vigentes por punto de emisión y tipo, y si ya ' +
        'se puede emitir una factura. Si no, `pendientes` dice qué falta, con `solucion` y `documentacion`. Cualquier rol puede ' +
        'llamarla; no devuelve secretos. Una llave de caja ve solo su punto de emisión; una admin, todos los que tienen autorizaciones.',
      responses: { 200: json(S.RespuestaSesion, 'Sesión'), ...respuestasDe(401, 403, 429, 500) },
    }),
    async (c) => {
      const s = sesion(c);
      const hoy = fechaHonduras(reloj());
      const cajaCompleta = s.establecimiento && s.puntoEmision ? `${s.establecimiento}-${s.puntoEmision}` : null;
      const { emisor, filas, documentosDelMes } = await enTenant(c, async (tx) => {
        const emisor = await leerEmisor(tx);
        const params: unknown[] = [tx.tenant];
        let sql = `SELECT a.identificador, a.datos, s.ultimo FROM fhn_autorizaciones a
                    LEFT JOIN fhn_series s ON s.tenant = a.tenant AND s.identificador = a.identificador
                   WHERE a.tenant = $1`;
        if (cajaCompleta) sql += ` AND a.identificador LIKE $${params.push(`${cajaCompleta}-%`)}`;
        else if (s.rol === 'caja') sql += ' AND false';
        const filas = (await tx.consulta<{ identificador: string; datos: AutorizacionCAI; ultimo: number | null }>(`${sql} ORDER BY a.identificador, a.rango_inicial`, params)).rows;
        const uso = await tx.consulta<{ documentos: number }>('SELECT documentos FROM api_uso WHERE tenant = $1 AND mes = $2', [tx.tenant, hoy.slice(0, 7)]);
        return { emisor, filas, documentosDelMes: uso.rows[0]?.documentos ?? 0 };
      });

      const porSerie = new Map<string, { auts: AutorizacionCAI[]; ultimo: number | null }>();
      for (const f of filas) {
        const serie = porSerie.get(f.identificador) ?? { auts: [], ultimo: f.ultimo };
        serie.auts.push(typeof f.datos === 'string' ? JSON.parse(f.datos) : f.datos);
        porSerie.set(f.identificador, serie);
      }
      const puntosConCai = [...new Set([...porSerie.keys()].map((id) => id.slice(0, 7)))].sort();
      const puntos = (cajaCompleta ? [cajaCompleta] : s.rol === 'caja' ? [] : puntosConCai).map((punto) => {
        const puntoConReal = (['01', '06', '07'] as const).some((t) => porSerie.get(`${punto}-${t}`)?.auts.some((a) => !esAutorizacionDePrueba(a)));
        const tipos = (['01', '06', '07'] as const).map((tipoDocumento) => {
          const original = porSerie.get(`${punto}-${tipoDocumento}`) ?? { auts: [], ultimo: null };
          // La demo de un punto que ya pasó a real está retirada: no cuenta para emitir.
          const serie = { ...original, auts: autorizacionesActivas(original.auts, puntoConReal) };
          const eleccion = elegirAutorizacion(serie.auts, serie.ultimo, hoy);
          const vigentes = serie.auts.flatMap((a) => {
            const consumido = Math.max(serie.ultimo ?? 0, a.ultimoEmitidoAntes ?? 0);
            const ultimo = consumido < a.rangoInicial ? null : Math.min(consumido, a.rangoFinal);
            const estado = estadoAutorizacion(a, ultimo, { hoy });
            if (!estado.vigente) return [];
            return [{
              cai: a.cai, rangoInicial: a.rangoInicial, rangoFinal: a.rangoFinal, fechaLimiteEmision: a.fechaLimiteEmision,
              diasRestantes: estado.diasRestantes, correlativosRestantes: estado.correlativosRestantes, alertas: estado.alertas,
            }];
          });
          const listo = !('error' in eleccion);
          return {
            tipoDocumento,
            listo,
            siguienteNumero: 'error' in eleccion ? null : `${punto}-${tipoDocumento}-${String(eleccion.correlativo).padStart(8, '0')}`,
            autorizaciones: vigentes,
            problema: 'error' in eleccion ? conGuia({ ...eleccion.error, mensaje: `${punto}, tipo ${tipoDocumento}: ${eleccion.error.mensaje}` }) : null,
          };
        });
        const [establecimiento, puntoEmision] = punto.split('-') as [string, string];
        return { establecimiento, puntoEmision, tipos };
      });

      const pendientes: ProblemaApi[] = [];
      if (!emisor) pendientes.push(conGuia({ codigo: 'SIN_EMISOR', mensaje: 'Falta registrar el emisor (POST /v1/emisores).' }));
      if (s.rol === 'caja' && !cajaCompleta) {
        pendientes.push(conGuia({ codigo: 'CAJA_SIN_PUNTO', mensaje: 'Esta llave de caja no está atada a un punto de emisión.' }));
      }
      const facturas = puntos.map((p) => p.tipos[0]!);
      if (!facturas.some((t) => t.listo)) {
        if (facturas.length) pendientes.push(...facturas.map((t) => t.problema!));
        else if (s.rol === 'admin') {
          pendientes.push(conGuia({ codigo: 'SIN_AUTORIZACION', mensaje: 'No hay ninguna autorización (CAI) registrada (Arts. 59-61).' }));
        }
      }
      if (s.limiteMensual !== null && documentosDelMes >= s.limiteMensual) {
        pendientes.push(conGuia({ codigo: 'LIMITE_MENSUAL', mensaje: `Se alcanzó el límite de ${s.limiteMensual} documentos del mes.` }));
      }

      return c.json({
        sesion: {
          tenant: s.tenant,
          modoTenant: s.modoTenant,
          modo: cfg.modo,
          demo: cfg.modo === 'local' && s.tenant === TENANT_DEMO && s.modoTenant === 'prueba',
          llave: { id: s.llaveId, prefijo: s.prefijo, nombre: s.llaveNombre, rol: s.rol, establecimiento: s.establecimiento, puntoEmision: s.puntoEmision },
          emisor: emisor ? { registrado: true, rtn: emisor.datos.rtn, razonSocial: emisor.datos.razonSocial } : { registrado: false, rtn: null, razonSocial: null },
          puntos,
          // El uso del mes es de todo el tenant: solo lo ve una llave admin.
          documentosDelMes: s.rol === 'admin' ? documentosDelMes : null,
          limiteMensual: s.limiteMensual,
          puedeEmitir: pendientes.length === 0,
          pendientes,
        },
      } as z.infer<typeof S.RespuestaSesion>, 200);
    },
  );

  // --- Documentos ------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/documentos', operationId: 'emitirDocumento', tags: ['Documentos'], security: seguridad,
      summary: 'Emite una factura, nota de crédito o nota de débito',
      description:
        'Reserva el correlativo, guarda el documento y registra la auditoría en una sola transacción. ' +
        'La cabecera `Idempotency-Key` es obligatoria: repetir la solicitud con la misma clave devuelve el mismo documento ' +
        '(cabecera `Idempotency-Replayed: true`) sin consumir otro número; la misma clave con otro cuerpo es 422. ' +
        'La clave no caduca; pasada la retención, la respuesta repetida trae el documento con su estado actual. ' +
        '`enlaces` trae las rutas de la representación impresa (PDF, HTML y texto), con la misma llave.',
      request: {
        // Opcional en el esquema solo para que su falta llegue al código y responda 400 `IDEMPOTENCY_KEY` con su
        // solución, no `SOLICITUD_INVALIDA`: la ruta la exige siempre.
        headers: z.object({
          'idempotency-key': z.string().optional().openapi({
            param: { required: true },
            description: 'Obligatoria. Clave única por venta (p. ej. el id del pedido o un UUID generado por el POS), la misma en cada reintento de esa venta.',
          }),
        }),
        body: { content: { 'application/json': { schema: S.SolicitudEmision } }, required: true },
      },
      responses: {
        201: {
          ...json(S.RespuestaEmision, 'Emitido'),
          headers: z.object({
            'Idempotency-Replayed': z.string().optional().openapi({ description: '`true` si la respuesta repite la de una solicitud anterior con la misma `Idempotency-Key` (no se emitió otro documento).', example: 'true' }),
          }),
        },
        409: json(S.ErrorRespuesta, 'Falta registrar el emisor'),
        ...respuestasError,
      },
    }),
    async (c) => {
      const s = sesion(c);
      const clave = c.req.header('idempotency-key') ?? '';
      if (!CLAVE_IDEMPOTENCIA.test(clave)) {
        throw new ErrorApi(400, 'IDEMPOTENCY_KEY', 'La cabecera Idempotency-Key es obligatoria (1 a 255 caracteres visibles).');
      }
      const cuerpo = c.req.valid('json');
      if (cuerpo.confirmarSaltoDeFecha && s.rol !== 'admin') {
        throw new ErrorApi(403, 'SOLO_ADMIN', 'Confirmar un salto de fecha requiere una llave admin (Art. 43).');
      }
      let establecimiento = cuerpo.establecimiento;
      let puntoEmision = cuerpo.puntoEmision;
      // Falla cerrado: una llave de caja sin punto de emisión completo (creada a mano o con la consola sin
      // --caja) no emite en la caja que pida el cuerpo.
      if (s.rol === 'caja' && !(s.establecimiento && s.puntoEmision)) {
        throw new ErrorApi(403, 'CAJA_SIN_PUNTO', 'Esta llave de caja no está atada a un punto de emisión; crea otra con establecimiento y punto de emisión.');
      }
      if (s.establecimiento && s.puntoEmision) {
        if ((establecimiento && establecimiento !== s.establecimiento) || (puntoEmision && puntoEmision !== s.puntoEmision)) {
          throw new ErrorApi(403, 'CAJA_NO_AUTORIZADA', `Esta llave emite solo en ${s.establecimiento}-${s.puntoEmision}.`);
        }
        establecimiento = s.establecimiento;
        puntoEmision = s.puntoEmision;
      }
      if (!establecimiento || !puntoEmision) {
        throw new ErrorApi(400, 'PUNTO_EMISION_REQUERIDO', 'Indica establecimiento y puntoEmision (o usa una llave atada a una caja).');
      }
      const { operador: _delCuerpo, imprimirOperador, ...solicitud } = cuerpo;
      const operador = operadorDe(c, cuerpo.operador);
      if (imprimirOperador && !operador) {
        throw new ErrorApi(400, 'OPERADOR_REQUERIDO', 'imprimirOperador requiere un operador (campo operador o cabecera X-Operador).');
      }
      const documento = imprimirOperador ? { ...cuerpo.documento, operador } : cuerpo.documento;
      // El operador solo cambia el documento si se imprime: un reintento de otro cajero con la misma clave no es
      // otra venta.
      const huella = createHash('sha256')
        .update(jsonEstable({ ...solicitud, documento, establecimiento, puntoEmision }))
        .digest('hex');
      const almacen = almacenDe(c);

      const repetir = async (previa: { huella: string; codigo: number; respuesta: unknown }) => {
        if (previa.huella !== huella) {
          throw new ErrorApi(422, 'IDEMPOTENCIA_CONFLICTO', 'Esta Idempotency-Key ya se usó con otra solicitud. Usa una clave nueva por venta.');
        }
        let respuestaPrevia = previa.respuesta as { documento?: unknown; numero?: string };
        // Pasada la retención, la copia de la respuesta se compacta a `{ numero }` (la clave y su huella se
        // quedan): el documento se lee del almacén fiscal, con su estado actual.
        if (!respuestaPrevia.documento && respuestaPrevia.numero) {
          const numero = respuestaPrevia.numero;
          const doc = await almacen.transaccion((tx) => tx.buscarDocumento(numero));
          if (!doc) throw new Error(`Idempotencia: el documento ${numero} de una clave compactada no está en el almacén.`);
          respuestaPrevia = { documento: doc };
        }
        c.header('Idempotency-Replayed', 'true');
        return c.json(conEnlaces(respuestaPrevia as { documento: { numero: string } }) as unknown as z.infer<typeof S.RespuestaEmision>, 201);
      };
      const buscarPrevia = () =>
        enTenant(c, async (tx) => (await tx.consulta<{ huella: string; codigo: number; respuesta: unknown }>(
          'SELECT huella, codigo, respuesta FROM api_idempotencia WHERE tenant = $1 AND clave = $2', [tx.tenant, clave],
        )).rows[0]);

      const previa = await buscarPrevia();
      if (previa) return repetir(previa);

      const emisor = await enTenant(c, leerEmisor);
      if (!emisor) throw new ErrorApi(409, 'SIN_EMISOR', 'Registra primero el emisor (POST /v1/emisores).');
      const { direccionesEstablecimiento, ...datosEmisor } = emisor.datos;
      const emisorDoc: EmisorCore = {
        ...datosEmisor,
        direccionEstablecimiento: direccionesEstablecimiento?.[establecimiento] ?? datosEmisor.direccionEstablecimiento,
      };

      const CONFLICTO = Symbol('conflicto');
      let respuesta: { documento: DocumentoFiscal } | null = null;
      try {
        await emitir({ ...documento, emisor: emisorDoc }, {
          almacen,
          establecimiento,
          puntoEmision,
          actor: actor(c),
          operador,
          confirmarSaltoDeFecha: cuerpo.confirmarSaltoDeFecha,
          opciones: { reloj },
          alEmitir: async (doc, t) => {
            // Política de seguridad de la API, no una regla fiscal: una nota de crédito sobre un original que no está en el sistema no se
            // pudo verificar (importe ni tasa) y reduce el débito fiscal del tenant; solo una llave admin la emite.
            // Con el original en el sistema, superarlo o cambiar la tasa ya es error del núcleo (422) para todos.
            // Se lanza dentro de la transacción, así que el número no se consume.
            const avisoNota = doc.tipoDocumento === '06' && doc.advertencias.find((p) => AVISOS_NOTA_SOLO_ADMIN.has(p.codigo));
            if (avisoNota && s.rol !== 'admin') {
              throw new ErrorApi(403, 'SOLO_ADMIN', `${avisoNota.mensaje} Una nota de crédito así requiere una llave admin.`, { advertencias: doc.advertencias });
            }
            const tx = comoTransaccionPostgres(t);
            respuesta = { documento: doc };
            const r = await tx.consulta(
              'INSERT INTO api_idempotencia (tenant, clave, huella, codigo, respuesta) VALUES ($1, $2, $3, 201, $4) ON CONFLICT DO NOTHING',
              [tx.tenant, clave, huella, JSON.stringify(respuesta)],
            );
            // Otra solicitud con la misma clave ganó la carrera: se revierte esta emisión (el número no se consume).
            if (r.rowCount === 0) throw CONFLICTO;
            const mes = doc.fechaEmision.slice(0, 7);
            const uso = await tx.consulta<{ documentos: number }>(
              `INSERT INTO api_uso (tenant, mes, documentos) VALUES ($1, $2, 1)
               ON CONFLICT (tenant, mes) DO UPDATE SET documentos = api_uso.documentos + 1 RETURNING documentos`,
              [tx.tenant, mes],
            );
            if (demo && s.limiteMensual !== null && uso.rows[0]!.documentos > s.limiteMensual) {
              throw new ErrorApi(429, 'DEMO_LIMITE_DOCUMENTOS', `Este entorno de prueba ya emitió sus ${s.limiteMensual} documentos.`, {
                reintentarEn: segundosHasta((await expiraDe(s.tenant)) ?? reloj().getTime() + 3_600_000),
              });
            }
            if (s.limiteMensual !== null && uso.rows[0]!.documentos > s.limiteMensual) {
              throw new ErrorApi(429, 'LIMITE_MENSUAL', `Se alcanzó el límite de ${s.limiteMensual} documentos del mes.`, {
                reintentarEn: segundosHastaElMesSiguiente(mes, reloj()),
              });
            }
            const instante = reloj();
            await encolarEvento(tx, 'documento.emitido', `documento.emitido:${doc.numero}`, doc, instante);
            const aut = (await tx.autorizaciones(identificadorDeNumero(doc.numero))).find((a) => a.cai === doc.cai);
            if (aut) {
              const est = estadoAutorizacion(aut, doc.correlativo, { hoy: doc.fechaEmision });
              const codigos = est.alertas.map((a) => a.codigo);
              const ev: EventoWebhook | null = codigos.includes('RANGO_AGOTADO')
                ? 'autorizacion.agotada'
                : codigos.some((k) => k === 'AVISO_RANGO' || k === 'AVISO_VENCIMIENTO') ? 'autorizacion.por_vencer' : null;
              if (ev) await encolarEvento(tx, ev, `${ev}:${aut.cai}`, { autorizacion: aut, ...est }, instante);
            }
            await bitacora(tx, actor(c), 'documento.emitido', { numero: doc.numero, total: doc.totales.total, idempotencia: clave }, operador);
          },
        });
      } catch (e) {
        if (e !== CONFLICTO) throw e;
        const ganadora = await buscarPrevia();
        if (!ganadora) throw e;
        return repetir(ganadora);
      }
      return c.json(conEnlaces(respuesta!) as unknown as z.infer<typeof S.RespuestaEmision>, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/documentos', operationId: 'listarDocumentos', tags: ['Documentos'], security: seguridad, summary: 'Documentos de un período, por fecha de emisión y número (paginado)',
      description:
        'Cada página trae a lo sumo `limite` documentos y además se corta en unos 8 MiB: puede traer menos de `limite` con ' +
        '`hayMas: true`. Sigue pidiendo con `cursor=<siguiente>` mientras `hayMas` sea `true`; no te detengas al recibir menos de `limite`.',
      request: { query: S.periodo({ identificador: z.string().regex(IDENTIFICADOR).optional(), ...S.Paginacion }) },
      responses: { 200: json(S.pagina('documentos', S.DocumentoFiscal), 'Una página'), ...respuestasDe(400, 401, 403, 429, 500) },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const limite = q.limite ?? LIMITE_POR_DEFECTO;
      const despues = q.cursor ? leerCursor(q.cursor, (v): v is [string, string] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && esFechaCursor(v[0]) && typeof v[1] === 'string' && v[1].length <= 40) : null;
      const { filas, traidas } = await enTenant(c, async (tx) => {
        const params: unknown[] = [tx.tenant, q.desde, q.hasta];
        let sql = 'SELECT fecha_emision::text AS fecha, numero, datos, octet_length(datos::text) AS bytes FROM fhn_documentos WHERE tenant = $1 AND fecha_emision >= $2 AND fecha_emision <= $3';
        if (q.identificador) sql += ` AND identificador = $${params.push(q.identificador)}`;
        if (despues) sql += ` AND (fecha_emision, numero) > ($${params.push(despues[0])}::date, $${params.push(despues[1])})`;
        sql += ` ORDER BY fecha_emision, numero LIMIT $${params.push(limite + 1)}`;
        // Tope de bytes por página (API4): la página corta antes del documento que empieza pasado `maxBytesPagina`
        // (siempre trae al menos uno), así que 500 documentos de 500 KB no llegan juntos a la memoria del proceso.
        // Los documentos que no entran no salen de la base; `traidas` dice si hubo corte.
        const r = await tx.consulta<{ datos: unknown; fecha: string; numero: string; traidas: number }>(
          `SELECT fecha, numero, datos, traidas FROM (
             SELECT fecha, numero, datos, count(*) OVER ()::int AS traidas,
                    sum(bytes) OVER (ORDER BY fecha, numero ROWS UNBOUNDED PRECEDING) - bytes AS antes
               FROM (${sql}) d
           ) s WHERE antes < $${params.push(maxBytesPagina)} ORDER BY fecha, numero`,
          params,
        );
        return { filas: r.rows, traidas: r.rows[0]?.traidas ?? 0 };
      });
      // Con corte por bytes hay más documentos aunque la página tenga menos de `limite`.
      const { elementos, hayMas, siguiente } = filas.length < traidas
        ? { elementos: filas, hayMas: true, siguiente: escribirCursor([filas[filas.length - 1]!.fecha, filas[filas.length - 1]!.numero]) }
        : paginar(filas, limite, (f) => [f.fecha, f.numero]);
      const documentos = elementos.map((f) => (typeof f.datos === 'string' ? JSON.parse(f.datos) : f.datos));
      return c.json({ documentos: documentos as z.infer<typeof S.DocumentoFiscal>[], hayMas, siguiente }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/documentos/{archivo}', operationId: 'obtenerDocumento', tags: ['Documentos'], security: seguridad,
      summary: 'Un documento: JSON, o la representación impresa con .pdf, .html o .txt',
      description: 'La copia impresa es idéntica al original (Art. 38). Un documento anulado lleva la leyenda ANULADA (Art. 41).',
      request: {
        params: z.object({ archivo: z.string().openapi({ example: '000-001-01-00000001.pdf' }) }),
        query: z.object({ formato: z.enum(['carta', 'ticket']).optional(), ancho: S.Entero(32, 120, { texto: true }).optional() }),
      },
      responses: {
        200: {
          description: 'Documento',
          content: {
            'application/json': { schema: S.RespuestaDocumento },
            'application/pdf': { schema: z.string().openapi({ format: 'binary' }) },
            'text/html': { schema: z.string() },
            'text/plain': { schema: z.string() },
          },
        },
        404: json(S.ErrorRespuesta, 'No existe'),
        ...respuestasDe(400, 401, 403, 429, 500),
      },
    }),
    async (c) => {
      const m = /^(\d{3}-\d{3}-\d{2}-\d{8})(?:\.(pdf|html|txt))?$/.exec(c.req.valid('param').archivo);
      if (!m) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Número de documento inválido (NNN-NNN-TT-NNNNNNNN).');
      const doc = await almacenDe(c).transaccion((tx) => tx.buscarDocumento(m[1]!));
      if (!doc) throw new ErrorApi(404, 'NO_ENCONTRADO', `No existe el documento ${m[1]}.`);
      const q = c.req.valid('query');
      switch (m[2]) {
        case 'pdf': {
          const pdf = await renderizarPDF(doc, { formato: q.formato });
          return c.body(pdf as unknown as ArrayBuffer, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${doc.numero}.pdf"` });
        }
        case 'html':
          return c.body(renderizarHTML(doc), 200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          });
        case 'txt':
          return c.body(renderizarTexto(doc, q.ancho ? { ancho: q.ancho } : {}), 200, { 'Content-Type': 'text/plain; charset=utf-8' });
        default:
          return c.json({ documento: doc as unknown as z.infer<typeof S.DocumentoFiscal> }, 200);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/documentos/{numero}/anular', operationId: 'anularDocumento', tags: ['Documentos'], security: seguridad,
      summary: 'Anula un documento (Art. 41): conserva número y contenido, cambia el estado',
      request: { params: z.object({ numero: z.string().regex(NUMERO) }), body: { content: { 'application/json': { schema: S.Motivo } }, required: true } },
      responses: { 200: json(S.RespuestaDocumento, 'Anulado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const cuerpo = c.req.valid('json');
      const doc = await anular(c.req.valid('param').numero, {
        almacen: almacenDe(c),
        motivo: cuerpo.motivo,
        reloj,
        actor: actor(c),
        operador: operadorDe(c, cuerpo.operador),
        libroContable: libroWebhooks,
      });
      return c.json({ documento: doc as unknown as z.infer<typeof S.DocumentoFiscal> }, 200);
    },
  );

  // --- Reportes de período: límites ------------------------------------------------------------------------
  // Los reportes (libro de ventas, exportación, no utilizados) son completos por período, pero acotados en
  // memoria y en conexiones: se cuentan antes de enviar nada (tope), se leen por páginas y se transmiten, con
  // cupos por tenant y por proceso (ver ./reportes). Los cupos se registran antes que las rutas.
  const maxDocumentos = maxDocumentosReporte(cfg.maxDocumentosReporte);
  const reportes = new ReportesEnCurso({
    porLlave: cfg.reportesPorLlave ?? REPORTES_POR_LLAVE,
    porTenant: cfg.reportesSimultaneos ?? REPORTES_SIMULTANEOS,
    proceso: reportesSimultaneosProceso(cfg.reportesSimultaneosProceso, cfg.pool.options?.max ?? 10),
  });
  const limiteReportes = reportes.middleware(
    (c) => (c.get('sesion') as Sesion).tenant,
    (c) => (c.get('sesion') as Sesion).prefijo,
  );
  /**
   * Responde un reporte transmitido desde una transacción de solo lectura del tenant: `preparar` cuenta y aplica
   * el tope antes de enviar nada (un 422 todavía es posible) y `producir` escribe en la misma instantánea.
   */
  const reporteTransmitido = async <P>(
    c: Context<Env>,
    preparar: (tx: TransaccionFiscal) => Promise<P>,
    producir: (tx: TransaccionFiscal, preparado: P, escribir: Escribir) => Promise<void>,
    alTerminar?: (preparado: P, completo: boolean) => Promise<void>,
  ) => {
    const almacen = almacenDe(c);
    return transmitir({
      ejecutar: (fn) => almacen.transaccion(fn, { soloLectura: true }),
      preparar,
      producir,
      alTerminar,
      liberar: reportes.reclamar(c.req.raw),
      registrar,
      duracionMaxMs: cfg.duracionMaxReporteMs,
    });
  };
  /**
   * Documentos del período, reales y de prueba, en la instantánea del reporte. Los de prueba (`modo: 'prueba'` o
   * CAI ficticio, como `esDocumentoDePrueba`) no entran en el libro ni en la exportación: no tienen valor fiscal.
   * El tope y el encabezado de `txt` cuentan solo los reales.
   */
  const contarPeriodo = async (tx: TransaccionFiscal, filtro: { desde: string; hasta: string }) => {
    const total = await contarDocumentos(tx, filtro);
    return contarExcluidos(tx, filtro, total);
  };
  /**
   * Como `contarPeriodo`, solo con los documentos de un punto de emisión (`NNN-NNN`), y las series del punto que
   * tienen documentos en el período, en orden.
   */
  const contarPeriodoDePunto = async (tx: TransaccionFiscal, filtro: { desde: string; hasta: string }, punto: string) => {
    const ptx = comoTransaccionPostgres(tx);
    const f = (await ptx.consulta<{ total: number; identificadores: string[] }>(
      `SELECT count(*)::int AS total, coalesce(array_agg(DISTINCT identificador ORDER BY identificador), '{}') AS identificadores
         FROM fhn_documentos
        WHERE tenant = $1 AND fecha_emision >= $2 AND fecha_emision <= $3 AND left(identificador, 7) = $4`,
      [ptx.tenant, filtro.desde, filtro.hasta, punto],
    )).rows[0]!;
    return { ...(await contarExcluidos(tx, filtro, f.total, punto)), identificadores: f.identificadores };
  };
  const contarExcluidos = async (tx: TransaccionFiscal, filtro: { desde: string; hasta: string }, total: number, punto?: string) => {
    const excluidos = total === 0 ? 0 : (await comoTransaccionPostgres(tx).consulta<{ n: number }>(
      `SELECT count(*)::int AS n FROM fhn_documentos
        WHERE tenant = $1 AND fecha_emision >= $2 AND fecha_emision <= $3
          AND (datos->>'modo' = 'prueba' OR starts_with(upper(btrim(datos->>'cai')), 'DEMO00-NO-VALIDO-'))
          ${punto ? 'AND left(identificador, 7) = $4' : ''}`,
      [comoTransaccionPostgres(tx).tenant, filtro.desde, filtro.hasta, ...(punto ? [punto] : [])],
    )).rows[0]!.n;
    const reales = total - excluidos;
    exigirPeriodoAcotado(reales, maxDocumentos);
    return { reales, excluidos };
  };
  /** Cabecera con los documentos de prueba que no entraron en el reporte. */
  const cabeceraExcluidos = (excluidos: number): Record<string, string> => ({ 'Documentos-Prueba-Excluidos': String(excluidos) });
  const avisoExcluidos = (excluidos: number) =>
    `${excluidos === 1 ? 'Un documento de prueba quedó fuera' : `${excluidos} documentos de prueba quedaron fuera`} (${LEYENDA_PRUEBA}).`;
  app.use('/v1/libro-ventas', limiteReportes);
  app.use('/v1/exportacion', limiteReportes);
  app.use('/v1/series/:identificador/no-utilizados', limiteReportes);

  // --- Series ----------------------------------------------------------------------------------------------
  const rutaSerie = z.object({ identificador: z.string().regex(IDENTIFICADOR).openapi({ example: '000-001-01' }) });
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/series/{identificador}/corregir-fecha', operationId: 'corregirFechaSerie', tags: ['Series'], security: seguridad,
      summary: 'Anula los documentos emitidos con el reloj adelantado (Arts. 41 y 43)',
      request: { params: rutaSerie, body: { content: { 'application/json': { schema: S.Motivo } }, required: true } },
      responses: { 200: json(z.object({ anulados: z.array(S.DocumentoFiscal) }), 'Anulados'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const cuerpo = c.req.valid('json');
      const anulados = await corregirFechaAdelantada(almacenDe(c), {
        identificador: c.req.valid('param').identificador,
        motivo: cuerpo.motivo,
        reloj,
        actor: actor(c),
        operador: operadorDe(c, cuerpo.operador),
        libroContable: libroWebhooks,
      });
      return c.json({ anulados: anulados as unknown as z.infer<typeof S.DocumentoFiscal>[] }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/series/{identificador}/no-utilizados', operationId: 'listarNoUtilizados', tags: ['Series'], security: seguridad,
      summary: 'Números que hay que reportar al SAR como no utilizados (Art. 42)',
      description: 'Las autorizaciones de prueba (CAI ficticio) no se reportan al SAR: sus números no aparecen y `aviso` lo dice.',
      request: { params: rutaSerie },
      responses: {
        200: json(
          z.object({
            rangos: z.array(z.looseObject({ desde: z.number(), hasta: z.number(), cantidad: z.number(), fechaLimiteAviso: z.string() })),
            aviso: z.string().optional().openapi({ description: 'Solo si la serie tiene autorizaciones de prueba, que no se reportan.' }),
          }),
          'Rangos',
        ),
        ...respuestasDe(400, 401, 403, 429, 500),
      },
    }),
    async (c) => {
      exigirAdmin(c);
      const identificador = c.req.valid('param').identificador;
      const rangos = await noUtilizadosDelAlmacen(almacenDe(c), identificador, { hoy: fechaHonduras(reloj()) });
      const deSerie = await almacenDe(c).transaccion((tx) => tx.autorizaciones(identificador));
      const prueba = deSerie.filter((a) => esAutorizacionDePrueba(a)).length;
      const aviso = prueba
        ? `${prueba === 1 ? 'Una autorización' : `${prueba} autorizaciones`} de prueba (CAI ficticio) de esta serie no se ` +
          `reporta${prueba === 1 ? '' : 'n'} al SAR: sus números no aparecen aquí. ${LEYENDA_PRUEBA}.`
        : undefined;
      return c.json({ rangos, ...(aviso ? { aviso } : {}) } as never, 200);
    },
  );

  // --- Reportes --------------------------------------------------------------------------------------------
  const cabecerasExcluidos = z.object({
    'Documentos-Prueba-Excluidos': z.string().openapi({ description: 'Documentos de prueba del período que no entran en el reporte (no tienen valor fiscal).', example: '0' }),
  });
  app.openapi(
    createRoute({
      method: 'get', path: '/v1/libro-ventas', operationId: 'obtenerLibroVentas', tags: ['Reportes'], security: seguridad,
      summary: 'Libro de ventas de un período (las NC restan, las ND suman; anulados en cero)',
      description:
        'Con una llave admin, el libro de todo el tenant. Con una llave de caja, solo el de su punto de emisión (todos sus tipos ' +
        'de documento); el CSV se llama `libro-ventas_<establecimiento>-<punto>_<desde>_<hasta>.csv`. Una llave de caja sin ' +
        'punto de emisión recibe 403 `CAJA_SIN_PUNTO`.',
      request: { query: S.periodo({ formato: z.enum(['json', 'csv']).optional() }) },
      responses: {
        200: {
          description: 'Libro. Sin los documentos de prueba: `excluidos` (y la cabecera `Documentos-Prueba-Excluidos`) dice cuántos quedaron fuera.',
          headers: cabecerasExcluidos,
          content: {
            'application/json': {
              schema: z.object({
                filas: z.array(z.looseObject({})),
                resumen: z.looseObject({}),
                excluidos: z.number().int().openapi({ description: 'Documentos de prueba del período que no entran en el libro.' }),
                aviso: z.string().optional(),
              }),
            },
            'text/csv': { schema: z.string() },
          },
        },
        // 403 `CAJA_SIN_PUNTO`: una llave de caja sin punto de emisión.
        ...respuestasDe(400, 401, 403, 422, 429, 500),
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const filtro = { desde: q.desde, hasta: q.hasta };
      const csv = q.formato === 'csv';
      // Una caja ve solo el libro de su punto de emisión, como en GET /v1/sesion. Los números llevan el punto al
      // inicio y las páginas van por número: recorrer las series del punto en orden da las mismas filas, en el mismo
      // orden, que el libro del tenant filtrado a ese punto.
      const s = sesion(c);
      let punto: string | null = null;
      if (s.rol === 'caja') {
        if (!s.establecimiento || !s.puntoEmision) {
          throw new ErrorApi(403, 'CAJA_SIN_PUNTO', 'Esta llave de caja no está atada a un punto de emisión; crea otra con establecimiento y punto de emisión.');
        }
        punto = `${s.establecimiento}-${s.puntoEmision}`;
      }
      // Fila por fila, sin las líneas de cada documento (el libro solo usa encabezado y totales). Mismos bytes
      // que `libroVentasCSV(filas)` o que `JSON.stringify({ filas, resumen, excluidos })` con `libroVentas(docs)`,
      // sin tener todas las filas a la vez. Los documentos de prueba no entran: se cuentan en `excluidos`.
      const { preparado, cuerpo } = await reporteTransmitido(
        c,
        (tx): Promise<{ reales: number; excluidos: number; identificadores?: string[] }> =>
          punto ? contarPeriodoDePunto(tx, filtro, punto) : contarPeriodo(tx, filtro),
        async (tx, { reales, excluidos, identificadores }, escribir) => {
          const resumen = acumuladorResumenVentas();
          if (!(await escribir(csv ? inicioLibroVentasCSV() : '{"filas":['))) return;
          let primera = true;
          const paginas = async function* () {
            if (!identificadores) yield* documentosPorPaginas(tx, filtro, { sinLineas: true });
            else for (const identificador of identificadores) yield* documentosPorPaginas(tx, { ...filtro, identificador }, { sinLineas: true });
          };
          if (reales > 0) {
            for await (const pagina of paginas()) {
              for (const d of pagina) {
                if (esDocumentoDePrueba(d)) continue;
                const fila = filaLibroVentas(d);
                resumen.agregar(fila);
                const texto = csv ? lineaLibroVentasCSV(fila) : (primera ? '' : ',') + JSON.stringify(fila);
                primera = false;
                if (!(await escribir(texto))) return;
              }
            }
          }
          if (!csv) await escribir(`],"resumen":${JSON.stringify(resumen.resumen())},"excluidos":${excluidos}${excluidos ? `,"aviso":${JSON.stringify(avisoExcluidos(excluidos))}` : ''}}`);
        },
      );
      return c.body(cuerpo, 200, {
        ...cabeceraExcluidos(preparado.excluidos),
        ...(csv
          ? { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="libro-ventas_${punto ? `${punto}_` : ''}${q.desde}_${q.hasta}.csv"` }
          : { 'Content-Type': TIPO_JSON }),
      }) as never;
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/exportacion', operationId: 'exportarPeriodo', tags: ['Reportes'], security: seguridad,
      summary: 'Archivo de texto de un período para el SAR (Art. 53 num. 5)',
      request: { query: S.periodo({ formato: z.enum(['jsonl', 'csv', 'txt']).optional() }) },
      responses: {
        200: {
          description: 'Archivo, sin los documentos de prueba (ver la cabecera `Documentos-Prueba-Excluidos`). `jsonl` en `application/x-ndjson`, `csv` en `text/csv` y `txt` en `text/plain`.',
          headers: cabecerasExcluidos,
          content: { 'application/x-ndjson': { schema: z.string() }, 'text/csv': { schema: z.string() }, 'text/plain': { schema: z.string() } },
        },
        ...respuestasDe(400, 401, 403, 422, 429, 500),
      },
    }),
    async (c) => {
      exigirAdmin(c);
      const q = c.req.valid('query');
      const formato = q.formato ?? 'jsonl';
      const filtro = { desde: q.desde, hasta: q.hasta };
      const tipos = { jsonl: 'application/x-ndjson', csv: 'text/csv', txt: 'text/plain' } as const;
      // Mismo contenido que `exportarTexto` (sin los documentos de prueba), transmitido documento por documento.
      // El tope, el encabezado de `txt` y la bitácora usan el mismo conteo de reales, de la misma instantánea
      // que las páginas. La bitácora se escribe al cerrar la transacción de solo lectura (no se pide otra conexión
      // con ella abierta) y antes de la última parte: la exportación no llega completa sin su registro; una
      // cortada queda con `completo: false`.
      const { preparado, cuerpo } = await reporteTransmitido(
        c,
        (tx) => contarPeriodo(tx, filtro),
        async (tx, { reales }, escribir) => {
          if (!(await escribir(inicioExportacion(formato, reales)))) return;
          if (reales === 0) return;
          // `jsonl` lleva el documento completo; `csv` y `txt`, solo encabezado y totales.
          const paginas = formato === 'jsonl' ? documentosPorPaginas(tx, filtro) : documentosPorPaginas(tx, filtro, { sinLineas: true });
          for await (const p of paginas) {
            for (const d of p) {
              if (esDocumentoDePrueba(d)) continue;
              if (!(await escribir(lineaExportacion(d as DocumentoFiscal, formato)))) return;
            }
          }
        },
        async ({ reales, excluidos }, completo) => {
          await enTenant(c, (t) => bitacora(t, actor(c), 'exportacion', {
            desde: q.desde, hasta: q.hasta, formato, documentos: reales, ...(excluidos ? { pruebaExcluidos: excluidos } : {}), ...(completo ? {} : { completo: false }),
          }));
        },
      );
      return c.body(cuerpo, 200, {
        ...cabeceraExcluidos(preparado.excluidos),
        'Content-Type': `${tipos[formato]}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="factura-hn_${q.desde}_${q.hasta}.${formato}"`,
      }) as never;
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/bitacora', operationId: 'listarBitacora', tags: ['Auditoría'], security: seguridad,
      summary: 'Bitácora fiscal (Art. 53 num. 2) o de la API, del evento más reciente al más antiguo (paginada)',
      request: {
        query: z.object({
          origen: z.enum(['fiscal', 'api']).optional().openapi({ description: '`fiscal` (por defecto): emisiones, anulaciones y autorizaciones. `api`: llaves, emisor y webhooks.' }),
          ...S.Paginacion,
        }),
      },
      responses: { 200: json(S.pagina('eventos', z.looseObject({})), 'Una página'), ...respuestasDe(400, 401, 403, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const q = c.req.valid('query');
      const limite = q.limite ?? LIMITE_POR_DEFECTO;
      const antesDe = q.cursor ? leerCursor(q.cursor, (v): v is string => typeof v === 'string' && /^\d{1,19}$/.test(v) && BigInt(v) <= BIGINT_MAXIMO) : null;
      const sql = q.origen === 'api'
        ? "SELECT id::text AS id, json_build_object('id', id, 'instante', instante, 'actor', actor, 'operador', operador, 'accion', accion, 'detalle', detalle) AS evento FROM api_bitacora"
        : 'SELECT id::text AS id, datos AS evento FROM fhn_eventos';
      const filas = await enTenant(c, async (tx) =>
        (await tx.consulta<{ id: string; evento: unknown }>(
          `${sql} WHERE tenant = $1 AND ($2::bigint IS NULL OR id < $2::bigint) ORDER BY id DESC LIMIT $3`, [tx.tenant, antesDe, limite + 1],
        )).rows,
      );
      const { elementos, hayMas, siguiente } = paginar(filas, limite, (f) => f.id);
      const eventos = elementos.map((f) => (typeof f.evento === 'string' ? JSON.parse(f.evento) : f.evento));
      return c.json({ eventos, hayMas, siguiente } as never, 200);
    },
  );

  // --- Llaves ----------------------------------------------------------------------------------------------
  type FilaLlave = { id: string; prefijo: string; nombre: string; rol: RolLlave; establecimiento: string | null; punto_emision: string | null; creada: Date; revocada: Date | null; ultimo_uso: Date | null };
  const aLlave = (f: FilaLlave) => ({
    id: f.id, prefijo: f.prefijo, nombre: f.nombre, rol: f.rol, establecimiento: f.establecimiento, puntoEmision: f.punto_emision,
    creada: f.creada.toISOString(), revocada: f.revocada?.toISOString() ?? null, ultimoUso: f.ultimo_uso?.toISOString() ?? null,
  });
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/llaves', operationId: 'crearLlave', tags: ['Llaves'], security: seguridad,
      summary: 'Crea una llave (la llave completa se muestra solo esta vez)',
      request: { body: { content: { 'application/json': { schema: S.LlaveNueva } }, required: true } },
      responses: { 201: json(S.RespuestaLlaveNueva, 'Creada'), ...respuestasDe(400, 401, 403, 413, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const b = c.req.valid('json');
      if (Boolean(b.establecimiento) !== Boolean(b.puntoEmision) || (b.rol === 'caja' && !b.establecimiento)) {
        throw new ErrorApi(400, 'CAJA_INCOMPLETA', 'Una llave de caja se ata a un establecimiento y punto de emisión: indica ambos.');
      }
      const { llave, prefijo, hash } = generarLlave(sesion(c).modoTenant);
      const fila = await enTenant(c, async (tx) => {
        const r = await tx.consulta<FilaLlave>(
          `INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre, establecimiento, punto_emision) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, prefijo, nombre, rol, establecimiento, punto_emision, creada, revocada, ultimo_uso`,
          [prefijo, tx.tenant, hash, b.rol, b.nombre, b.establecimiento ?? null, b.puntoEmision ?? null],
        );
        await bitacora(tx, actor(c), 'llave.creada', { prefijo, rol: b.rol, nombre: b.nombre });
        return r.rows[0]!;
      });
      return c.json({ llave: aLlave(fila), secreto: llave }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/llaves', operationId: 'listarLlaves', tags: ['Llaves'], security: seguridad, summary: 'Llaves del tenant (sin secretos)',
      responses: { 200: json(S.pagina('llaves', S.Llave), 'Lista'), ...respuestasDe(401, 403, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const filas = await enTenant(c, async (tx) =>
        (await tx.consulta<FilaLlave>('SELECT id, prefijo, nombre, rol, establecimiento, punto_emision, creada, revocada, ultimo_uso FROM api_llaves WHERE tenant = $1 ORDER BY creada', [tx.tenant])).rows,
      );
      return c.json({ llaves: filas.map(aLlave), hayMas: false, siguiente: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete', path: '/v1/llaves/{prefijo}', operationId: 'revocarLlave', tags: ['Llaves'], security: seguridad, summary: 'Revoca una llave',
      request: { params: z.object({ prefijo: z.string().regex(/^[0-9a-f]{12}$/) }) },
      responses: { 200: json(S.RespuestaLlave, 'Revocada'), 404: json(S.ErrorRespuesta, 'No existe'), 409: json(S.ErrorRespuesta, 'Última llave admin'), ...respuestasDe(400, 401, 403, 413, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const { prefijo } = c.req.valid('param');
      const fila = await enTenant(c, async (tx) => {
        const objetivo = (await tx.consulta<{ rol: RolLlave }>('SELECT rol FROM api_llaves WHERE tenant = $1 AND prefijo = $2 AND revocada IS NULL FOR UPDATE', [tx.tenant, prefijo])).rows[0];
        if (!objetivo) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Llave no encontrada o ya revocada.');
        if (objetivo.rol === 'admin') {
          const admins = await tx.consulta("SELECT 1 FROM api_llaves WHERE tenant = $1 AND rol = 'admin' AND revocada IS NULL FOR UPDATE", [tx.tenant]);
          if ((admins.rowCount ?? 0) <= 1) throw new ErrorApi(409, 'ULTIMA_LLAVE_ADMIN', 'No se puede revocar la única llave admin activa.');
        }
        const r = await tx.consulta<FilaLlave>(
          'UPDATE api_llaves SET revocada = now() WHERE tenant = $1 AND prefijo = $2 RETURNING id, prefijo, nombre, rol, establecimiento, punto_emision, creada, revocada, ultimo_uso',
          [tx.tenant, prefijo],
        );
        await bitacora(tx, actor(c), 'llave.revocada', { prefijo });
        return r.rows[0]!;
      });
      return c.json({ llave: aLlave(fila) }, 200);
    },
  );

  // --- Webhooks --------------------------------------------------------------------------------------------
  type FilaWebhook = { id: string; url: string; eventos: string[]; activo: boolean; creado: Date; gracia_hasta: Date | null };
  /** Columnas de un webhook: el secreto nunca sale; `gracia_hasta`, solo si la gracia de una rotación sigue vigente. */
  const COLUMNAS_WEBHOOK = 'id, url, eventos, activo, creado, CASE WHEN anterior_hasta > now() THEN anterior_hasta END AS gracia_hasta';
  const aWebhook = (f: FilaWebhook) => ({
    id: f.id, url: f.url, eventos: f.eventos, activo: f.activo, creado: f.creado.toISOString(), graciaHasta: f.gracia_hasta?.toISOString() ?? null,
  });
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/webhooks', operationId: 'crearWebhook', tags: ['Webhooks'], security: seguridad,
      summary: 'Suscribe una URL a eventos (el secreto de firma se muestra solo esta vez)',
      description: `Hasta ${MAX_WEBHOOKS_ACTIVOS} webhooks activos por tenant: con ${MAX_WEBHOOKS_ACTIVOS} activos, crear otro es 409 \`LIMITE_WEBHOOKS\`.`,
      request: { body: { content: { 'application/json': { schema: S.WebhookNuevo } }, required: true } },
      responses: { 201: json(S.RespuestaWebhookNuevo, 'Creado'), 409: json(S.ErrorRespuesta, `Límite de ${MAX_WEBHOOKS_ACTIVOS} webhooks activos por tenant (LIMITE_WEBHOOKS)`), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const b = c.req.valid('json');
      const problema = problemaDeURL(b.url, cfg.modo === 'local');
      if (problema) throw new ErrorApi(422, 'WEBHOOK_URL', problema);
      const secreto = `whsec_${randomBytes(24).toString('base64url')}`;
      const fila = await enTenant(c, async (tx) => {
        // Candado por tenant antes de contar: dos altas a la vez no pasan juntas del límite.
        await tx.consulta("SELECT pg_advisory_xact_lock(4823191, hashtext('api_webhooks:' || $1))", [tx.tenant]);
        const activos = await tx.consulta<{ n: number }>('SELECT count(*)::int AS n FROM api_webhooks WHERE tenant = $1 AND activo', [tx.tenant]);
        if (activos.rows[0]!.n >= MAX_WEBHOOKS_ACTIVOS) {
          throw new ErrorApi(409, 'LIMITE_WEBHOOKS', `Este tenant ya tiene ${MAX_WEBHOOKS_ACTIVOS} webhooks activos: desactiva uno (DELETE /v1/webhooks/{id}) antes de crear otro.`);
        }
        const r = await tx.consulta<FilaWebhook>(
          `INSERT INTO api_webhooks (tenant, url, secreto, eventos) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS_WEBHOOK}`,
          [tx.tenant, b.url, cofre.guardar(secreto), [...new Set(b.eventos)]],
        );
        // Los eventos sin repetir, como en la fila: una lista de 512 KB con el mismo evento no llega a la bitácora.
        await bitacora(tx, actor(c), 'webhook.creado', { id: r.rows[0]!.id, url: b.url, eventos: r.rows[0]!.eventos });
        return r.rows[0]!;
      });
      return c.json({ webhook: aWebhook(fila), secreto }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/webhooks', operationId: 'listarWebhooks', tags: ['Webhooks'], security: seguridad, summary: 'Webhooks del tenant',
      responses: { 200: json(S.pagina('webhooks', S.Webhook), 'Lista'), ...respuestasDe(401, 403, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const filas = await enTenant(c, async (tx) =>
        (await tx.consulta<FilaWebhook>(`SELECT ${COLUMNAS_WEBHOOK} FROM api_webhooks WHERE tenant = $1 ORDER BY creado`, [tx.tenant])).rows,
      );
      return c.json({ webhooks: filas.map(aWebhook), hayMas: false, siguiente: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete', path: '/v1/webhooks/{id}', operationId: 'desactivarWebhook', tags: ['Webhooks'], security: seguridad, summary: 'Desactiva un webhook',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: json(S.RespuestaWebhook, 'Desactivado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasDe(400, 401, 403, 413, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      const fila = await enTenant(c, async (tx) => {
        const r = await tx.consulta<FilaWebhook>(`UPDATE api_webhooks SET activo = false WHERE tenant = $1 AND id = $2 RETURNING ${COLUMNAS_WEBHOOK}`, [tx.tenant, id]);
        if (!r.rows[0]) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Webhook no encontrado.');
        await bitacora(tx, actor(c), 'webhook.desactivado', { id });
        return r.rows[0];
      });
      return c.json({ webhook: aWebhook(fila) }, 200);
    },
  );

  // --- Entregas, prueba y rotación del secreto ------------------------------------------------------------
  // Estas rutas no validan reglas fiscales: no devuelven 422.
  type FilaEntrega = {
    entrega: string; webhook_id: string; evento: string; estado: 'PENDIENTE' | 'ENTREGADA' | 'FALLIDA'; intentos: number; proximo: Date;
    ultimo_codigo: number | null; ultimo_error: string | null; creada: Date; micros: string;
  };
  /** `micros`: `creada` en microsegundos desde 1970, exacto, para el cursor (un Date solo guarda milisegundos). */
  const COLUMNAS_ENTREGA =
    'entrega::text AS entrega, webhook_id::text AS webhook_id, evento, estado, intentos, proximo, ultimo_codigo, ultimo_error, creada, ' +
    '(extract(epoch FROM creada) * 1000000)::bigint::text AS micros';
  const aEntrega = (f: FilaEntrega) => ({
    id: f.entrega, webhookId: f.webhook_id, evento: f.evento, estado: f.estado, intentos: f.intentos,
    proximoIntento: f.estado === 'PENDIENTE' ? f.proximo.toISOString() : null,
    ultimoCodigo: f.ultimo_codigo, ultimoError: f.ultimo_error, creada: f.creada.toISOString(),
  });
  /**
   * El webhook del tenant; 404 si no existe. Con `bloquear`, la fila queda bloqueada hasta el fin de la transacción
   * con FOR NO KEY UPDATE (no estorba a las entregas que la referencian); la lista no bloquea nada.
   */
  const webhookDelTenant = async (tx: TransaccionPostgres, id: string, bloquear = true) => {
    const w = (await tx.consulta<{ activo: boolean }>(
      `SELECT activo FROM api_webhooks WHERE tenant = $1 AND id = $2${bloquear ? ' FOR NO KEY UPDATE' : ''}`, [tx.tenant, id],
    )).rows[0];
    if (!w) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Webhook no encontrado.');
    return w;
  };
  const exigirActivo = (w: { activo: boolean }, accion: string) => {
    if (!w.activo) throw new ErrorApi(409, 'WEBHOOK_INACTIVO', `El webhook está desactivado: no se puede ${accion}. Crea otro con POST /v1/webhooks.`);
  };
  /** 409 `LIMITE_PRUEBAS` si el webhook ya tiene el máximo de pruebas pendientes. Corre con el webhook bloqueado. */
  const exigirCupoPruebas = async (tx: TransaccionPostgres, id: string) => {
    const n = (await tx.consulta<{ n: number }>(
      "SELECT count(*)::int AS n FROM api_entregas WHERE tenant = $1 AND webhook_id = $2 AND evento = 'webhook.prueba' AND estado = 'PENDIENTE'",
      [tx.tenant, id],
    )).rows[0]!.n;
    if (n >= MAX_PRUEBAS_PENDIENTES) {
      throw new ErrorApi(409, 'LIMITE_PRUEBAS', `Este webhook ya tiene ${MAX_PRUEBAS_PENDIENTES} pruebas pendientes: espera a que se entreguen o fallen (GET /v1/webhooks/{id}/entregas).`);
    }
  };
  const IdWebhook = z.object({ id: z.string().uuid() });

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/webhooks/{id}/entregas', tags: ['Webhooks'], security: seguridad, operationId: 'listarEntregasWebhook',
      summary: 'Entregas de un webhook, de la más reciente a la más antigua (paginada)',
      description:
        'Estado de cada aviso: `PENDIENTE` (en cola o esperando un reintento), `ENTREGADA` (el receptor respondió 2xx) o `FALLIDA` ' +
        '(se agotaron los intentos o el webhook se desactivó). Pasados `FHN_RETENCION_DIAS` días, las terminadas de `documento.*` y ' +
        '`webhook.prueba` se borran; las de `autorizacion.*` se quedan con el cuerpo vacío.',
      request: {
        params: IdWebhook,
        query: z.object({
          estado: z.enum(['PENDIENTE', 'ENTREGADA', 'FALLIDA']).optional().openapi({ description: 'Solo las entregas en este estado.' }),
          ...S.Paginacion,
        }),
      },
      responses: { 200: json(S.pagina('entregas', S.EntregaWebhook), 'Una página'), 404: json(S.ErrorRespuesta, 'El webhook no existe'), ...respuestasDe(400, 401, 403, 429, 500) },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      const q = c.req.valid('query');
      const limite = q.limite ?? LIMITE_POR_DEFECTO;
      // Un cursor armado a mano no llega a la base: microsegundos dentro del rango de timestamptz y un UUID estricto.
      const antesDe = q.cursor
        ? leerCursor(q.cursor, (v): v is [string, string] =>
            Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && /^\d{1,18}$/.test(v[0]) && BigInt(v[0]) <= MICROS_MAXIMOS &&
            typeof v[1] === 'string' && UUID_ESTRICTO.test(v[1]))
        : null;
      const filas = await enTenant(c, async (tx) => {
        await webhookDelTenant(tx, id, false);
        const params: unknown[] = [tx.tenant, id];
        let sql = `SELECT ${COLUMNAS_ENTREGA} FROM api_entregas WHERE tenant = $1 AND webhook_id = $2`;
        if (q.estado) sql += ` AND estado = $${params.push(q.estado)}`;
        if (antesDe) {
          sql += ` AND (creada, entrega) < (timestamptz 'epoch' + $${params.push(antesDe[0])}::bigint * interval '1 microsecond', $${params.push(antesDe[1])}::uuid)`;
        }
        sql += ` ORDER BY creada DESC, entrega DESC LIMIT $${params.push(limite + 1)}`;
        return (await tx.consulta<FilaEntrega>(sql, params)).rows;
      });
      const { elementos, hayMas, siguiente } = paginar(filas, limite, (f) => [f.micros, f.entrega]);
      return c.json({ entregas: elementos.map(aEntrega), hayMas, siguiente }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/webhooks/{id}/entregas/{entrega}/reenviar', tags: ['Webhooks'], security: seguridad, operationId: 'reenviarEntregaWebhook',
      summary: 'Vuelve a poner una entrega en la cola',
      description:
        'Una entrega `FALLIDA` o `ENTREGADA` vuelve a `PENDIENTE` con el calendario de reintentos completo (unos 3 días) y sale en ' +
        'segundos, con el mismo `id`: el receptor la descarta si ya la procesó. Una `PENDIENTE` se adelanta a ahora y conserva sus intentos. ' +
        '409 `WEBHOOK_INACTIVO` si el webhook está desactivado; 409 `ENTREGA_VENCIDA` si es una de `autorizacion.*` cuyo cuerpo ya se ' +
        'vació por retención (las de `documento.*` y `webhook.prueba` se borran: 404); 409 `LIMITE_PRUEBAS` si es una prueba y el ' +
        `webhook ya tiene ${MAX_PRUEBAS_PENDIENTES} pendientes.`,
      request: { params: IdWebhook.extend({ entrega: z.string().uuid() }) },
      responses: {
        202: json(S.RespuestaEntregaWebhook, 'En la cola'),
        404: json(S.ErrorRespuesta, 'El webhook o la entrega no existen'),
        409: json(S.ErrorRespuesta, 'Webhook desactivado (WEBHOOK_INACTIVO), cuerpo vaciado por retención (ENTREGA_VENCIDA) o demasiadas pruebas pendientes (LIMITE_PRUEBAS)'),
        ...respuestasDe(400, 401, 403, 413, 429, 500),
      },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id, entrega } = c.req.valid('param');
      const fila = await enTenant(c, async (tx) => {
        exigirActivo(await webhookDelTenant(tx, id), 'reenviar una entrega');
        const e = (await tx.consulta<{ vacia: boolean; evento: string; estado: string }>(
          "SELECT cuerpo = '{}'::jsonb AS vacia, evento, estado FROM api_entregas WHERE tenant = $1 AND webhook_id = $2 AND entrega = $3 FOR NO KEY UPDATE",
          [tx.tenant, id, entrega],
        )).rows[0];
        if (!e) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Entrega no encontrada.');
        if (e.vacia) throw new ErrorApi(409, 'ENTREGA_VENCIDA', 'El cuerpo de esta entrega ya se borró por retención (FHN_RETENCION_DIAS): no se puede reenviar.');
        if (e.evento === 'webhook.prueba' && e.estado !== 'PENDIENTE') await exigirCupoPruebas(tx, id);
        // En el lado derecho de SET, `estado` es el valor anterior.
        const r = await tx.consulta<FilaEntrega>(
          `UPDATE api_entregas SET estado = 'PENDIENTE', intentos = CASE WHEN estado = 'PENDIENTE' THEN intentos ELSE 0 END, proximo = now()
            WHERE tenant = $1 AND webhook_id = $2 AND entrega = $3 RETURNING ${COLUMNAS_ENTREGA}`,
          [tx.tenant, id, entrega],
        );
        await bitacora(tx, actor(c), 'webhook.entrega_reenviada', { id, entrega });
        return r.rows[0]!;
      });
      return c.json({ entrega: aEntrega(fila) }, 202);
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/webhooks/{id}/probar', tags: ['Webhooks'], security: seguridad, operationId: 'probarWebhook',
      summary: 'Encola un evento de prueba (`webhook.prueba`) para este webhook',
      description:
        `Llega solo a este webhook, aunque no esté suscrito a ningún evento con ese nombre, firmado. Se intenta a lo sumo ${MAX_INTENTOS_PRUEBA} ` +
        'veces (no los 3 días de los demás avisos). `datos` lleva `webhookId` y un mensaje. Sigue su estado en `GET /v1/webhooks/{id}/entregas`. ' +
        `A lo sumo ${MAX_PRUEBAS_PENDIENTES} pruebas pendientes por webhook: más allá, 409 \`LIMITE_PRUEBAS\`.`,
      request: { params: IdWebhook },
      responses: {
        202: json(S.RespuestaEntregaWebhook, 'En la cola'),
        404: json(S.ErrorRespuesta, 'El webhook no existe'),
        409: json(S.ErrorRespuesta, 'Webhook desactivado (WEBHOOK_INACTIVO) o demasiadas pruebas pendientes (LIMITE_PRUEBAS)'),
        ...respuestasDe(400, 401, 403, 413, 429, 500),
      },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      const cuerpo = { evento: 'webhook.prueba', creado: reloj().toISOString(), datos: { webhookId: id, mensaje: 'Evento de prueba de factura-hn. No representa ningún documento.' } };
      const fila = await enTenant(c, async (tx) => {
        exigirActivo(await webhookDelTenant(tx, id), 'enviar un evento de prueba');
        await exigirCupoPruebas(tx, id);
        const r = await tx.consulta<FilaEntrega>(
          `INSERT INTO api_entregas (tenant, webhook_id, evento, clave, cuerpo)
           VALUES ($1, $2, 'webhook.prueba', 'webhook.prueba:' || gen_random_uuid(), $3::jsonb) RETURNING ${COLUMNAS_ENTREGA}`,
          [tx.tenant, id, JSON.stringify(cuerpo)],
        );
        await bitacora(tx, actor(c), 'webhook.prueba', { id, entrega: r.rows[0]!.entrega });
        return r.rows[0]!;
      });
      return c.json({ entrega: aEntrega(fila) }, 202);
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/webhooks/{id}/rotar-secreto', tags: ['Webhooks'], security: seguridad, operationId: 'rotarSecretoWebhook',
      summary: 'Cambia el secreto de firma, con gracia (el secreto nuevo se muestra solo esta vez)',
      description:
        'Durante la gracia (`graciaHoras`, 24 por defecto, de 0 a 168) cada entrega lleva dos `v1` en `X-FacturaHN-Firma`: primero el del ' +
        'secreto anterior y después el del nuevo. Al terminar, solo el del nuevo. Cambia el secreto del receptor durante la gracia. ' +
        'Rotar otra vez durante una gracia conserva el secreto más viejo (el que el receptor puede seguir usando), descarta el intermedio ' +
        'y alarga la gracia si la nueva termina después. Con `graciaHoras: 0` la gracia termina en el acto.',
      request: { params: IdWebhook, body: { content: { 'application/json': { schema: S.RotacionSecreto } }, required: false } },
      responses: {
        200: json(S.RespuestaSecretoRotado, 'Rotado'),
        404: json(S.ErrorRespuesta, 'El webhook no existe'),
        409: json(S.ErrorRespuesta, 'Webhook desactivado (WEBHOOK_INACTIVO)'),
        ...respuestasDe(400, 401, 403, 413, 429, 500),
      },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      // Cuerpo opcional: sin cuerpo (o vacío), 24 h de gracia.
      const graciaHoras = (c.req.valid('json') as { graciaHoras?: number } | undefined)?.graciaHoras ?? 24;
      const secreto = `whsec_${randomBytes(24).toString('base64url')}`;
      const fila = await enTenant(c, async (tx) => {
        exigirActivo(await webhookDelTenant(tx, id), 'rotar su secreto');
        // En el lado derecho de SET, las columnas tienen su valor anterior (los secretos, ya guardados por el cofre).
        // Con una gracia en curso se conserva el secreto más viejo: una rotación repetida (un reintento, un doble
        // clic) no deja sin firma válida al receptor que aún usa el secreto de antes de la primera rotación. El
        // intermedio se descarta y la gracia dura hasta la más tardía de las dos.
        const r = await tx.consulta<FilaWebhook>(
          `UPDATE api_webhooks SET
             secreto_anterior = CASE WHEN $3::int = 0 THEN NULL
                                     WHEN anterior_hasta > now() THEN secreto_anterior ELSE secreto END,
             anterior_hasta = CASE WHEN $3::int = 0 THEN NULL
                                   WHEN anterior_hasta > now() THEN greatest(anterior_hasta, now() + make_interval(hours => $3::int))
                                   ELSE now() + make_interval(hours => $3::int) END,
             secreto = $4
           WHERE tenant = $1 AND id = $2 RETURNING ${COLUMNAS_WEBHOOK}`,
          [tx.tenant, id, graciaHoras, cofre.guardar(secreto)],
        );
        await bitacora(tx, actor(c), 'webhook.secreto_rotado', { id, graciaHoras, graciaHasta: r.rows[0]!.gracia_hasta?.toISOString() ?? null });
        return r.rows[0]!;
      });
      return c.json({ webhook: aWebhook(fila), secreto }, 200);
    },
  );

  // --- Documentación ---------------------------------------------------------------------------------------
  const especificacion = {
    openapi: '3.1.0',
    info: {
      title: 'factura-hn API',
      version: VERSION_API,
      license: { name: 'MIT', identifier: 'MIT' },
      description: [
        'Facturación para Honduras según el Reglamento del Régimen de Facturación del SAR (Acuerdo 481-2017). Proyecto independiente, no afiliado al SAR. Fechas en America/Tegucigalpa.',
        '',
        'Montos: en la entrada, texto decimal (`"57.50"`, recomendado) o número. En la salida, número en lempiras con a lo sumo 2 decimales, calculado en centavos enteros: `Math.round(monto * 100)` da los centavos exactos. Para sumar montos, pásalos antes a centavos.',
        '',
        'Respuestas: cada recurso va envuelto con su nombre (`{ documento }`, `{ emisor }`, `{ llave, secreto }`…). Cada lista es `{ <plural>, hayMas, siguiente }`: si `hayMas`, pide la página siguiente con `?cursor=<siguiente>` (`limite` de 1 a 500, 100 por defecto).',
        '',
        'Reglas para integrar (también en AGENTS.md, sección «Con la API REST»):',
        '1. La llave va solo en el servidor. Usa una llave de caja, atada a su punto de emisión.',
        '2. `POST /v1/documentos` lleva una Idempotency-Key estable por venta (el id del pedido o de la venta, nunca un valor nuevo por intento): un reintento devuelve la misma factura.',
        '3. 422 = reglas fiscales: muestra `errores[].mensaje` tal cual. Un 422 no consume número ni la clave: corrige y reintenta con la misma.',
        '4. Guarda el número y reimprime desde `/v1/documentos/{numero}.pdf|.html|.txt`; no recalcules.',
        '5. Webhooks: verifica `X-FacturaHN-Firma` (t=<unix>,v1=hex HMAC-SHA256(secreto, "<t>.<cuerpo crudo>"), 5 min de tolerancia; puede traer varios `v1` y basta con que uno verifique), descarta repetidos por `id` y responde 2xx solo cuando procesaste el aviso.',
      ].join('\n'),
    },
  };
  // Como `app.doc31`, más las cabeceras que la API pone en todas las respuestas (./contrato).
  app.get('/openapi.json', (c) => c.json(conCabecerasComunes(conErrorDeTipoDeContenido(app.getOpenAPI31Document(especificacion)))));
  app.get('/docs', (c) => {
    for (const [k, v] of Object.entries(CABECERAS_DOCS)) c.header(k, v);
    return c.html(HTML_DOCS);
  });
  app.get('/', (c) => c.redirect('/docs'));

  return app;
}
