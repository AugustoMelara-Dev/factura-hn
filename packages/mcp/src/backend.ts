/**
 * Dos formas de llegar a los datos fiscales, con las mismas herramientas MCP:
 * - `BackendApi`: la API REST de factura-hn (local o alojada) con una llave de API.
 * - `BackendLocal`: el SDK sobre un `AlmacenFiscal` (p. ej. SQLite en el equipo del negocio).
 */
import {
  esAutorizacionDePrueba,
  anular,
  buscarDocumento,
  emitir,
  ErrorValidacion,
  estadoAutorizacion,
  fechaHonduras,
  libroVentas as libroVentasNucleo,
  identificadorDe,
  renderizarTexto,
  registrarAutorizacion,
  validarAutorizacion,
  type AlmacenFiscal,
  type AutorizacionCAI,
  type DocumentoEntrada,
  type DocumentoFiscal,
  type Emisor,
  type Problema,
} from 'factura-hn';
import { createHash } from 'node:crypto';
import { crearCliente, ErrorFacturaHN, type ClienteFacturaHN } from '@factura-hn/cliente';
import { AlmacenSQLite, type BaseSQLite } from '@factura-hn/sqlite';
import { esCAIDemo } from './demo';

/** JSON con las claves ordenadas: la misma entrada da siempre el mismo texto. */
function jsonEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonEstable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Huella del contenido de una solicitud: la misma clave con otro contenido es un conflicto, no un reintento. */
export const huellaDe = (entrada: unknown) => createHash('sha256').update(jsonEstable(entrada)).digest('hex');

/** Lo que la herramienta envía: el documento sin emisor (el emisor es el del negocio configurado). */
export type EntradaSinEmisor = Omit<DocumentoEntrada, 'emisor'>;

export interface EstadoCAI {
  cai: string;
  tipoDocumento: string;
  serie: string;
  rango: string;
  fechaLimiteEmision: string;
  vigente: boolean;
  correlativosRestantes: number;
  diasRestantes: number;
  alertas: Problema[];
  /** Demo de un punto que ya tiene un CAI real: retirada, sin números (DEC-091). */
  retirada: boolean;
}

/**
 * Persona que opera: queda en la bitácora; con `imprimir`, también en el documento («Atendido por»).
 * Si la herramienta no lo indica, se usa el operador configurado del servidor (`FHN_OPERADOR`).
 */
export interface OpcionesOperador {
  operador?: string;
  imprimirOperador?: boolean;
}

/**
 * Resultado de emitir. `repetido` es true cuando la clave de idempotencia ya se había usado con esta misma venta:
 * se devuelve el documento ya emitido y no se emite otro.
 */
export interface ResultadoEmision {
  documento: DocumentoFiscal;
  repetido: boolean;
}

/** Autorización recién registrada, con las advertencias del núcleo (p. ej. vigencia mayor de un año). */
export interface ResultadoRegistroCAI {
  autorizacion: AutorizacionCAI;
  advertencias: Problema[];
}

export interface Backend {
  readonly nombre: string;
  /** Establecimiento y punto de emisión en que emite este servidor, si se conocen. */
  readonly punto?: { establecimiento?: string; puntoEmision?: string };
  emitir(entrada: EntradaSinEmisor, idempotencyKey: string, opciones?: OpcionesOperador): Promise<ResultadoEmision>;
  /** Registra una autorización del SAR (CAI, rango y fecha límite) con las validaciones del núcleo. */
  registrarCAI(autorizacion: AutorizacionCAI): Promise<ResultadoRegistroCAI>;
  consultar(numero: string): Promise<DocumentoFiscal | null>;
  anular(numero: string, motivo: string, opciones?: { operador?: string }): Promise<DocumentoFiscal>;
  estadoCAI(): Promise<EstadoCAI[]>;
  /** Libro de ventas sin los documentos de prueba; `excluidos` dice cuántos quedaron fuera. */
  libroVentas(desde: string, hasta: string): Promise<{ filas: unknown[]; resumen: unknown; excluidos: number }>;
}

/** Error con la lista de problemas fiscales, para mostrarla tal cual al usuario. */
export class ErrorBackend extends Error {
  constructor(
    public readonly codigo: string,
    mensaje: string,
    public readonly errores: Problema[] = [],
  ) {
    super(mensaje);
  }
}

const errorDe = (codigo: string, mensaje: string, campo?: string) => new ErrorBackend(codigo, mensaje, [{ codigo, mensaje, ...(campo ? { campo } : {}) }]);

/**
 * El CAI ficticio no entra por registrar-cai: vive solo en la base de demostración que crea `init --demo`, y
 * esa base no recibe CAI reales. Así un documento de prueba no se mezcla con la numeración fiscal del negocio.
 */
function exigirCAIReal(a: AutorizacionCAI) {
  if (esCAIDemo(a.cai)) throw errorDe('CAI_DEMO', `El CAI ${a.cai} es el ficticio de prueba, no uno de una resolución del SAR.`, 'cai');
}

/** Advertencias de una autorización válida (el mismo criterio que `esAdvertencia` del núcleo). */
const advertenciasDe = (a: AutorizacionCAI) => validarAutorizacion(a).filter((p) => p.codigo.startsWith('AVISO_') || p.codigo.endsWith('_ADVERTENCIA'));

const resumirEstado = (a: AutorizacionCAI, ultimo: number | null, hoy: string, puntoConReal: boolean): EstadoCAI => {
  const consumido = Math.max(ultimo ?? 0, a.ultimoEmitidoAntes ?? 0);
  const u = consumido < a.rangoInicial ? null : Math.min(consumido, a.rangoFinal);
  const e = estadoAutorizacion(a, u, { hoy, puntoConReal });
  return {
    cai: a.cai,
    tipoDocumento: a.tipoDocumento,
    serie: identificadorDe(a),
    rango: `${a.rangoInicial}–${a.rangoFinal}`,
    fechaLimiteEmision: a.fechaLimiteEmision,
    vigente: e.vigente,
    correlativosRestantes: e.correlativosRestantes,
    diasRestantes: e.diasRestantes,
    alertas: e.alertas,
    retirada: e.retirada === true,
  };
};

/**
 * CAI de una base SQLite, en autorizaciones y en documentos: `ficticios` (de prueba) y `reales`. Una base con algún
 * CAI ficticio es de demostración (la crea `init --demo`).
 */
export function caisDeBase(db: Pick<BaseSQLite, 'prepare'>): { ficticios: string[]; reales: string[] } {
  const filas = db
    .prepare("SELECT cai FROM fhn_autorizaciones UNION SELECT json_extract(datos, '$.cai') AS cai FROM fhn_documentos")
    .all() as { cai: string | null }[];
  const cais = filas.map((f) => f.cai).filter((c): c is string => Boolean(c));
  return { ficticios: cais.filter((c) => esCAIDemo(c)), reales: cais.filter((c) => !esCAIDemo(c)) };
}

/**
 * Registra un CAI real en una base SQLite con `registrarAutorizacion` del núcleo (mismas validaciones). Rechaza el
 * CAI ficticio (`CAI_DEMO`) y toda base de demostración (`BASE_DEMO`), en cualquier serie: sus números ya se usaron
 * en documentos de prueba. La usan la herramienta `registrar_cai` y el comando `registrar-cai`.
 */
export async function registrarCAIEnAlmacen(
  almacen: AlmacenFiscal,
  db: Pick<BaseSQLite, 'prepare'>,
  a: AutorizacionCAI,
  opciones: { reloj?: () => Date; actor?: string; operador?: string } = {},
): Promise<ResultadoRegistroCAI> {
  exigirCAIReal(a);
  try {
    if (caisDeBase(db).ficticios.length) {
      throw errorDe('BASE_DEMO', 'Esta base es de demostración (tiene el CAI ficticio): no recibe CAI reales.', 'cai');
    }
    const autorizacion = await registrarAutorizacion(almacen, a, opciones);
    return { autorizacion, advertencias: advertenciasDe(autorizacion) };
  } catch (e) {
    throw traducir(e);
  }
}

/**
 * Dónde se guardan las claves de idempotencia. `guardar` corre **dentro** de la transacción de emisión
 * (`alEmitir`) y debe lanzar si la clave ya existe: así no hay documento sin clave ni clave sin documento, y
 * de dos reintentos simultáneos solo uno emite.
 */
export interface RegistroClaves {
  buscar(clave: string): { numero: string; huella: string } | null | Promise<{ numero: string; huella: string } | null>;
  guardar(clave: string, numero: string, huella: string): void | Promise<void>;
}

/**
 * Claves en la misma base SQLite que el almacén (tabla `mcp_claves`). Como la conexión es una sola, lo que
 * se escribe en `alEmitir` queda en la transacción de la emisión. Sobreviven a reinicios del servidor MCP.
 */
export function clavesSQLite(db: { exec(sql: string): unknown; prepare(sql: string): { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown } }): RegistroClaves {
  db.exec('CREATE TABLE IF NOT EXISTS mcp_claves (clave TEXT PRIMARY KEY, numero TEXT NOT NULL, huella TEXT NOT NULL)');
  return {
    buscar: (c) => (db.prepare('SELECT numero, huella FROM mcp_claves WHERE clave = ?').get(c) as { numero: string; huella: string } | undefined) ?? null,
    guardar: (c, n, h) => void db.prepare('INSERT INTO mcp_claves (clave, numero, huella) VALUES (?, ?, ?)').run(c, n, h),
  };
}

/** Base SQLite abierta (`node:sqlite` o `better-sqlite3`). Para `node:sqlite`, `location()` es null en memoria. */
export type BaseSQLiteMCP = BaseSQLite & { location?: () => string | null };

/**
 * Backend con el SDK sobre una base SQLite en archivo de este equipo. Documentos, bitácora y claves de
 * idempotencia van en la misma base y la misma transacción. No hay modo en memoria: una caja que pierde sus
 * documentos al reiniciar pierde números consumidos (Art. 41) y la clave de un reintento.
 */
export class BackendLocal implements Backend {
  readonly nombre = 'sdk-local';
  private readonly claves: RegistroClaves;
  private readonly almacen: AlmacenFiscal;
  constructor(
    private readonly o: {
      db: BaseSQLiteMCP;
      emisor: Emisor;
      establecimiento: string;
      puntoEmision: string;
      reloj?: () => Date;
      /** Quién opera el servidor MCP, para la bitácora. Por defecto `mcp`. */
      actor?: string;
      /** Persona por defecto, p. ej. de `FHN_OPERADOR`. */
      operador?: string;
    },
  ) {
    if (o.db.location?.() === null) {
      throw new Error('El MCP local necesita una base SQLite en archivo (FHN_SQLITE=./factura.db), no en memoria.');
    }
    this.almacen = new AlmacenSQLite(o.db);
    this.claves = clavesSQLite(o.db);
  }

  /** El almacén fiscal de esta base (para registrar CAI o consultar con el SDK). */
  get almacenFiscal(): AlmacenFiscal {
    return this.almacen;
  }

  get punto() {
    return { establecimiento: this.o.establecimiento, puntoEmision: this.o.puntoEmision };
  }

  async emitir(entrada: EntradaSinEmisor, idempotencyKey: string, opciones: OpcionesOperador = {}): Promise<ResultadoEmision> {
    const operador = opciones.operador ?? this.o.operador;
    if (opciones.imprimirOperador) {
      if (!operador) throw new ErrorBackend('OPERADOR_REQUERIDO', 'Para imprimir el operador, indica quién atiende.', [{ codigo: 'OPERADOR_REQUERIDO', mensaje: 'Para imprimir el operador, indica quién atiende.', campo: 'operador' }]);
      entrada = { ...entrada, operador };
    }
    // El operador solo cambia la venta si se imprime (ya está en `entrada`).
    const huella = huellaDe(entrada);
    const repetido = async () => {
      const r = await this.claves.buscar(idempotencyKey);
      if (!r) return null;
      if (r.huella !== huella) {
        const m = 'Esta clave de idempotencia ya se usó con otra venta. Usa una clave nueva para una venta nueva.';
        throw new ErrorBackend('IDEMPOTENCIA_CONFLICTO', m, [{ codigo: 'IDEMPOTENCIA_CONFLICTO', mensaje: m }]);
      }
      const doc = await this.consultar(r.numero);
      return doc ? { documento: doc, repetido: true } : null;
    };
    const previo = await repetido();
    if (previo) return previo;
    try {
      const documento = await emitir({ ...entrada, emisor: this.o.emisor } as DocumentoEntrada, {
        almacen: this.almacen,
        establecimiento: this.o.establecimiento,
        puntoEmision: this.o.puntoEmision,
        opciones: { reloj: this.o.reloj },
        actor: this.o.actor ?? 'mcp',
        operador,
        alEmitir: async (doc) => this.claves.guardar(idempotencyKey, doc.numero, huella),
      });
      return { documento, repetido: false };
    } catch (e) {
      // Otro intento con la misma clave ganó la carrera: esta emisión se revirtió y se devuelve aquella.
      const ganador = await repetido();
      if (ganador) return ganador;
      throw traducir(e);
    }
  }
  consultar(numero: string) {
    return buscarDocumento(this.almacen, numero);
  }
  registrarCAI(a: AutorizacionCAI): Promise<ResultadoRegistroCAI> {
    return registrarCAIEnAlmacen(this.almacen, this.o.db, a, { reloj: this.o.reloj, actor: this.o.actor ?? 'mcp', operador: this.o.operador });
  }
  async anular(numero: string, motivo: string, opciones: { operador?: string } = {}) {
    try {
      return await anular(numero, {
        almacen: this.almacen, motivo, reloj: this.o.reloj, actor: this.o.actor ?? 'mcp', operador: opciones.operador ?? this.o.operador,
      });
    } catch (e) {
      throw traducir(e);
    }
  }
  async estadoCAI(): Promise<EstadoCAI[]> {
    const hoy = fechaHonduras((this.o.reloj ?? (() => new Date()))());
    return this.almacen.transaccion(async (tx) => {
      // Notas antes que facturas: el mismo orden de bloqueo que registrarAutorizacion (DEC-092).
      const series: Array<{ auts: AutorizacionCAI[]; ultimo: number | null }> = [];
      for (const tipoDocumento of ['06', '07', '01'] as const) {
        const id = identificadorDe({ establecimiento: this.o.establecimiento, puntoEmision: this.o.puntoEmision, tipoDocumento });
        const auts = await tx.autorizaciones(id);
        if (!auts.length) continue;
        const { ultimo } = await tx.bloquearSerie(id);
        series.push({ auts, ultimo });
      }
      const puntoConReal = series.some((s) => s.auts.some((a) => !esAutorizacionDePrueba(a)));
      return series
        .flatMap((s) => s.auts.map((a) => resumirEstado(a, s.ultimo, hoy, puntoConReal)))
        .sort((x, y) => x.serie.localeCompare(y.serie));
    });
  }
  async libroVentas(desde: string, hasta: string) {
    const docs = await this.almacen.transaccion((tx) => tx.documentos({ desde, hasta }));
    return libroVentasNucleo(docs);
  }
}

export class BackendApi implements Backend {
  readonly nombre = 'api';
  private readonly c: ClienteFacturaHN;
  /** `operador`: persona por defecto; va en la cabecera X-Operador de cada solicitud. */
  constructor(o: { url: string; llave: string; establecimiento?: string; puntoEmision?: string; operador?: string; fetch?: typeof fetch }) {
    this.c = crearCliente(o);
    this.punto = { establecimiento: o.establecimiento, puntoEmision: o.puntoEmision };
  }
  readonly punto: { establecimiento?: string; puntoEmision?: string };

  async emitir(entrada: EntradaSinEmisor, idempotencyKey: string, opciones: OpcionesOperador = {}): Promise<ResultadoEmision> {
    try {
      const extra = {
        ...(opciones.operador !== undefined ? { operador: opciones.operador } : {}),
        ...(opciones.imprimirOperador ? { imprimirOperador: true } : {}),
      };
      const { documento, repetida } = await this.c.emitir({ ...this.punto, ...extra, documento: entrada as never }, { idempotencyKey });
      return { documento: documento as unknown as DocumentoFiscal, repetido: repetida };
    } catch (e) {
      throw traducir(e);
    }
  }
  async consultar(numero: string) {
    try {
      return (await this.c.documento(numero)) as unknown as DocumentoFiscal;
    } catch (e) {
      if (e instanceof ErrorFacturaHN && e.estado === 404) return null;
      throw traducir(e);
    }
  }
  async anular(numero: string, motivo: string, opciones: { operador?: string } = {}) {
    try {
      return (await this.c.anular(numero, motivo, opciones)) as unknown as DocumentoFiscal;
    } catch (e) {
      throw traducir(e);
    }
  }
  async registrarCAI(a: AutorizacionCAI): Promise<ResultadoRegistroCAI> {
    exigirCAIReal(a);
    try {
      const autorizacion = (await this.c.registrarAutorizacion(a as never)) as unknown as AutorizacionCAI;
      return { autorizacion, advertencias: advertenciasDe(autorizacion) };
    } catch (e) {
      throw traducir(e);
    }
  }
  async estadoCAI() {
    try {
      return await this.estadoCAISinTraducir();
    } catch (e) {
      throw traducir(e);
    }
  }
  private async estadoCAISinTraducir(): Promise<EstadoCAI[]> {
    const auts = await this.c.autorizaciones();
    return Promise.all(
      auts.map(async (a) => {
        const e = await this.c.estadoAutorizacion(a.cai);
        return {
          cai: a.cai, tipoDocumento: a.tipoDocumento, serie: `${a.establecimiento}-${a.puntoEmision}-${a.tipoDocumento}`,
          rango: `${a.rangoInicial}–${a.rangoFinal}`, fechaLimiteEmision: a.fechaLimiteEmision, vigente: e.vigente,
          correlativosRestantes: e.correlativosRestantes, diasRestantes: e.diasRestantes, alertas: e.alertas,
          retirada: e.retirada,
        };
      }),
    );
  }
  async libroVentas(desde: string, hasta: string) {
    try {
      return await this.c.libroVentas(desde, hasta);
    } catch (e) {
      throw traducir(e);
    }
  }
}

function traducir(e: unknown): unknown {
  if (e instanceof ErrorBackend) return e;
  if (e instanceof ErrorValidacion) return new ErrorBackend('VALIDACION', e.message, e.errores);
  if (e instanceof ErrorFacturaHN) return new ErrorBackend(e.codigo, e.message, e.errores);
  // fetch rechaza con TypeError cuando no hay conexión (API apagada, URL mal escrita).
  if (e instanceof TypeError && /fetch/i.test(e.message)) {
    return errorDe('API_INACCESIBLE', `No se pudo conectar con la API de factura-hn: ${e.message}.`);
  }
  return e;
}

export { renderizarTexto };
