/**
 * Dos formas de llegar a los datos fiscales, con las mismas herramientas MCP:
 * - `BackendApi`: la API REST de factura-hn (local o alojada) con una llave de API.
 * - `BackendLocal`: el SDK sobre un `AlmacenFiscal` (p. ej. SQLite en el equipo del negocio).
 */
import {
  anular,
  buscarDocumento,
  emitir,
  ErrorValidacion,
  estadoAutorizacion,
  fechaHonduras,
  filaLibroVentas,
  identificadorDe,
  renderizarTexto,
  resumenVentas,
  type AlmacenFiscal,
  type AutorizacionCAI,
  type DocumentoEntrada,
  type DocumentoFiscal,
  type Emisor,
  type Problema,
} from 'factura-hn';
import { crearCliente, ErrorFacturaHN, type ClienteFacturaHN } from '@factura-hn/cliente';

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
}

export interface Backend {
  readonly nombre: string;
  emitir(entrada: EntradaSinEmisor, idempotencyKey: string): Promise<DocumentoFiscal>;
  consultar(numero: string): Promise<DocumentoFiscal | null>;
  anular(numero: string, motivo: string): Promise<DocumentoFiscal>;
  estadoCAI(): Promise<EstadoCAI[]>;
  libroVentas(desde: string, hasta: string): Promise<{ filas: unknown[]; resumen: unknown }>;
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

const resumirEstado = (a: AutorizacionCAI, ultimo: number | null, hoy: string): EstadoCAI => {
  const consumido = Math.max(ultimo ?? 0, a.ultimoEmitidoAntes ?? 0);
  const u = consumido < a.rangoInicial ? null : Math.min(consumido, a.rangoFinal);
  const e = estadoAutorizacion(a, u, { hoy });
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
  };
};

export class BackendLocal implements Backend {
  readonly nombre = 'sdk-local';
  private readonly emisiones = new Map<string, string>();
  constructor(
    private readonly o: {
      almacen: AlmacenFiscal;
      emisor: Emisor;
      establecimiento: string;
      puntoEmision: string;
      reloj?: () => Date;
      actor?: string;
    },
  ) {}

  async emitir(entrada: EntradaSinEmisor, idempotencyKey: string): Promise<DocumentoFiscal> {
    // Idempotencia en memoria del proceso: un reintento del agente en la misma sesión no emite dos veces.
    const previo = this.emisiones.get(idempotencyKey);
    if (previo) {
      const doc = await this.consultar(previo);
      if (doc) return doc;
    }
    try {
      const doc = await emitir({ ...entrada, emisor: this.o.emisor } as DocumentoEntrada, {
        almacen: this.o.almacen,
        establecimiento: this.o.establecimiento,
        puntoEmision: this.o.puntoEmision,
        opciones: { reloj: this.o.reloj },
        actor: this.o.actor ?? 'mcp',
      });
      this.emisiones.set(idempotencyKey, doc.numero);
      return doc;
    } catch (e) {
      throw traducir(e);
    }
  }
  consultar(numero: string) {
    return buscarDocumento(this.o.almacen, numero);
  }
  async anular(numero: string, motivo: string) {
    try {
      return await anular(numero, { almacen: this.o.almacen, motivo, reloj: this.o.reloj, actor: this.o.actor ?? 'mcp' });
    } catch (e) {
      throw traducir(e);
    }
  }
  async estadoCAI(): Promise<EstadoCAI[]> {
    const hoy = fechaHonduras((this.o.reloj ?? (() => new Date()))());
    return this.o.almacen.transaccion(async (tx) => {
      const r: EstadoCAI[] = [];
      for (const tipoDocumento of ['01', '06', '07'] as const) {
        const id = identificadorDe({ establecimiento: this.o.establecimiento, puntoEmision: this.o.puntoEmision, tipoDocumento });
        const auts = await tx.autorizaciones(id);
        if (!auts.length) continue;
        const { ultimo } = await tx.bloquearSerie(id);
        r.push(...auts.map((a) => resumirEstado(a, ultimo, hoy)));
      }
      return r;
    });
  }
  async libroVentas(desde: string, hasta: string) {
    const docs = await this.o.almacen.transaccion((tx) => tx.documentos({ desde, hasta }));
    const filas = docs.map(filaLibroVentas);
    return { filas, resumen: resumenVentas(filas) };
  }
}

export class BackendApi implements Backend {
  readonly nombre = 'api';
  private readonly c: ClienteFacturaHN;
  constructor(o: { url: string; llave: string; establecimiento?: string; puntoEmision?: string; fetch?: typeof fetch }) {
    this.c = crearCliente(o);
    this.punto = { establecimiento: o.establecimiento, puntoEmision: o.puntoEmision };
  }
  private readonly punto: { establecimiento?: string; puntoEmision?: string };

  async emitir(entrada: EntradaSinEmisor, idempotencyKey: string) {
    try {
      const { documento } = await this.c.emitir({ ...this.punto, documento: entrada as never }, { idempotencyKey });
      return documento as unknown as DocumentoFiscal;
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
  async anular(numero: string, motivo: string) {
    try {
      return (await this.c.anular(numero, motivo)) as unknown as DocumentoFiscal;
    } catch (e) {
      throw traducir(e);
    }
  }
  async estadoCAI() {
    const auts = await this.c.autorizaciones();
    return Promise.all(
      auts.map(async (a) => {
        const e = await this.c.estadoAutorizacion(a.cai);
        return {
          cai: a.cai, tipoDocumento: a.tipoDocumento, serie: `${a.establecimiento}-${a.puntoEmision}-${a.tipoDocumento}`,
          rango: `${a.rangoInicial}–${a.rangoFinal}`, fechaLimiteEmision: a.fechaLimiteEmision, vigente: e.vigente,
          correlativosRestantes: e.correlativosRestantes, diasRestantes: e.diasRestantes, alertas: e.alertas,
        };
      }),
    );
  }
  libroVentas(desde: string, hasta: string) {
    return this.c.libroVentas(desde, hasta);
  }
}

function traducir(e: unknown): unknown {
  if (e instanceof ErrorValidacion) return new ErrorBackend('VALIDACION', e.message, e.errores);
  if (e instanceof ErrorFacturaHN) return new ErrorBackend(e.codigo, e.message, e.errores);
  return e;
}

export { renderizarTexto };
