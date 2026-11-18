/**
 * Mini POS fuera de línea: emite con el SDK sobre SQLite en el equipo de la caja, sin internet.
 *
 * - Cada venta lleva una clave que genera el navegador. Si la respuesta se pierde y la caja reintenta con la
 *   misma clave, recibe el mismo documento. La clave se guarda **en la misma transacción** que el documento:
 *   no hay ventana en la que exista uno sin la otra.
 * - Lo emitido y lo anulado entra a una cola de salida (`pos_salida`), también en la transacción, para
 *   enviarlo a la contabilidad o a la oficina central cuando vuelva la conexión (`sincronizar`).
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  anular,
  emitir,
  ErrorValidacion,
  estadoAutorizacion,
  fechaHonduras,
  identificadorDe,
  renderizarTexto,
  type DocumentoFiscal,
  type Emisor,
  type LineaEntrada,
} from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';
import { PAGINA } from './pagina';

/** Lo mínimo de `node:sqlite` (DatabaseSync) o better-sqlite3 que usa el POS. */
export interface BaseSQLite {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
}

export interface OpcionesPOS {
  db: BaseSQLite;
  /** Puerto en el que escucha: solo se aceptan solicitudes dirigidas a 127.0.0.1 o localhost en ese puerto. */
  puerto?: number;
  emisor: Emisor;
  establecimiento: string;
  puntoEmision: string;
  reloj?: () => Date;
}

export interface Venta {
  cliente?: { nombre?: string; rtn?: string };
  lineas: LineaEntrada[];
  /** Quién cobra (DEC-031): queda en la bitácora. */
  cajero?: string;
  /** Imprime «Atendido por» con el cajero en el ticket. */
  imprimirCajero?: boolean;
}

const CLAVE = /^[A-Za-z0-9-]{8,64}$/;

/** Huella de la venta: la misma clave con otra venta es un conflicto, no un reintento. */
// El cajero solo cambia la venta si se imprime: otro cajero que reintenta la misma venta no es otra venta.
const huellaDe = (v: Venta) =>
  createHash('sha256')
    .update(JSON.stringify({ cliente: v.cliente ?? null, lineas: v.lineas, impreso: v.imprimirCajero ? (v.cajero ?? null) : null }))
    .digest('hex');

class ErrorSolicitud extends Error {}

export function crearPOS(o: OpcionesPOS) {
  const almacen = new AlmacenSQLite(o.db);
  o.db.exec(`
    CREATE TABLE IF NOT EXISTS pos_ventas (clave TEXT PRIMARY KEY, numero TEXT NOT NULL, huella TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pos_salida (
      id INTEGER PRIMARY KEY AUTOINCREMENT, evento TEXT NOT NULL, numero TEXT NOT NULL, enviado INTEGER NOT NULL DEFAULT 0
    );`);
  const encolar = (evento: string, numero: string) => o.db.prepare('INSERT INTO pos_salida (evento, numero) VALUES (?, ?)').run(evento, numero);
  const actor = `caja:${o.establecimiento}-${o.puntoEmision}`;
  const config = { almacen, establecimiento: o.establecimiento, puntoEmision: o.puntoEmision, opciones: { reloj: o.reloj }, actor };

  async function documento(numero: string): Promise<DocumentoFiscal | null> {
    return almacen.transaccion((tx) => tx.buscarDocumento(numero));
  }

  /** Emite una factura. Con una clave ya usada devuelve el documento de entonces (`repetida: true`). */
  async function vender(clave: string, venta: Venta): Promise<{ documento: DocumentoFiscal; repetida: boolean }> {
    if (!CLAVE.test(clave)) throw new ErrorValidacion([{ codigo: 'CLAVE_VENTA', mensaje: 'Clave de venta inválida (8 a 64 letras, dígitos o guiones).', campo: 'clave' }]);
    const huella = huellaDe(venta);
    const previa = o.db.prepare('SELECT numero, huella FROM pos_ventas WHERE clave = ?').get(clave) as { numero: string; huella: string } | undefined;
    if (previa) {
      if (previa.huella !== huella) {
        throw new ErrorValidacion([{ codigo: 'CLAVE_VENTA_USADA', mensaje: 'Esa clave ya se usó con otra venta: recarga la página para empezar una venta nueva.', campo: 'clave' }]);
      }
      return { documento: (await documento(previa.numero))!, repetida: true };
    }
    // La conexión de SQLite es una sola: lo que se ejecuta en `alEmitir` queda dentro de la transacción.
    const cajero = venta.cajero?.trim() || undefined;
    if (venta.imprimirCajero && !cajero) {
      throw new ErrorValidacion([{ codigo: 'CAJERO', mensaje: 'Escribe el nombre del cajero para imprimirlo en el ticket.', campo: 'cajero' }]);
    }
    const doc = await emitir(
      { emisor: o.emisor, cliente: venta.cliente, preciosIncluyenISV: true, lineas: venta.lineas, ...(venta.imprimirCajero && { operador: cajero }) },
      {
        ...config,
        operador: cajero,
        alEmitir: async (d) => {
          o.db.prepare('INSERT INTO pos_ventas (clave, numero, huella) VALUES (?, ?, ?)').run(clave, d.numero, huella);
          encolar('documento.emitido', d.numero);
        },
      },
    );
    return { documento: doc, repetida: false };
  }

  /** Anulación (Art. 41): el documento conserva su número y queda marcado ANULADO. */
  async function anularVenta(numero: string, motivo: string, cajero?: string): Promise<DocumentoFiscal> {
    return anular(numero, {
      almacen, motivo, reloj: o.reloj, actor, operador: cajero?.trim() || undefined, alAnular: async (d) => void encolar('documento.anulado', d.numero),
    });
  }

  /** Correlativos y vigencia de la autorización de facturas en uso, con las alertas (Arts. 59 y 62). */
  async function estado() {
    const hoy = fechaHonduras((o.reloj ?? (() => new Date()))());
    const id = identificadorDe({ establecimiento: o.establecimiento, puntoEmision: o.puntoEmision, tipoDocumento: '01' });
    return almacen.transaccion(async (tx) => {
      const { ultimo } = await tx.bloquearSerie(id);
      const auts = await tx.autorizaciones(id);
      const actual = auts.find((a) => (ultimo ?? 0) < a.rangoFinal) ?? auts.at(-1);
      if (!actual) return { serie: id, autorizacion: null };
      const u = ultimo === null || ultimo < actual.rangoInicial ? null : ultimo;
      return { serie: id, autorizacion: { cai: actual.cai, fechaLimiteEmision: actual.fechaLimiteEmision, ...estadoAutorizacion(actual, u, { hoy }) } };
    });
  }

  /**
   * Envía lo pendiente de la cola, en orden. Para en el primer fallo (sin conexión): lo demás queda para la
   * próxima vuelta. Devuelve cuántos se enviaron. El destino debe tolerar repetidos (usa `id`).
   */
  let sincronizando = false;
  async function sincronizar(enviar: (aviso: { id: number; evento: string; documento: DocumentoFiscal }) => Promise<void>): Promise<number> {
    // Una vuelta a la vez: si la anterior sigue enviando, esta no hace nada.
    if (sincronizando) return 0;
    sincronizando = true;
    try {
      return await sincronizarUnaVez(enviar);
    } finally {
      sincronizando = false;
    }
  }

  async function sincronizarUnaVez(enviar: (aviso: { id: number; evento: string; documento: DocumentoFiscal }) => Promise<void>): Promise<number> {
    const pendientes = o.db.prepare('SELECT id, evento, numero FROM pos_salida WHERE enviado = 0 ORDER BY id').all() as { id: number; evento: string; numero: string }[];
    let n = 0;
    for (const p of pendientes) {
      try {
        await enviar({ id: p.id, evento: p.evento, documento: (await documento(p.numero))! });
      } catch {
        break;
      }
      o.db.prepare('UPDATE pos_salida SET enviado = 1 WHERE id = ?').run(p.id);
      n++;
    }
    return n;
  }

  const pendientesDeEnviar = () => (o.db.prepare('SELECT count(*) AS n FROM pos_salida WHERE enviado = 0').get() as { n: number }).n;

  /** Manejador para `node:http`: la página de la caja y una API JSON pequeña. */
  async function manejador(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const responder = (estadoHttp: number, cuerpo: unknown, tipo = 'application/json; charset=utf-8') => {
      res.writeHead(estadoHttp, { 'content-type': tipo, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
    };
    try {
      // Solo la caja de este equipo. Otra página abierta en el navegador no puede emitir ni anular:
      // - Host fijo: un nombre de otro sitio que resuelva a 127.0.0.1 (DNS rebinding) no pasa.
      // - Origin, si viene, debe ser este mismo POS.
      // - Los POST exigen application/json, que obliga al navegador a una verificación previa (CORS) que no se concede.
      const anfitriones = o.puerto ? [`127.0.0.1:${o.puerto}`, `localhost:${o.puerto}`] : null;
      if (anfitriones && !anfitriones.includes(req.headers.host ?? '')) return responder(421, { error: 'Anfitrión no permitido.' });
      const origen = req.headers.origin;
      if (origen && (!anfitriones || !anfitriones.some((a) => origen === `http://${a}`))) return responder(403, { error: 'Origen no permitido.' });
      if (req.method === 'POST' && !/^application\/json(;|$)/i.test(req.headers['content-type'] ?? '')) return responder(415, { error: 'Se espera application/json.' });
      const url = new URL(req.url ?? '/', 'http://pos');
      const m = /^\/api\/documentos\/(\d{3}-\d{3}-\d{2}-\d{8})(\.txt|\/anular)?$/.exec(url.pathname);
      if (req.method === 'GET' && url.pathname === '/') {
        res.setHeader('content-security-policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
        return responder(200, PAGINA, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/estado') return responder(200, { ...(await estado()), pendientesDeEnviar: pendientesDeEnviar() });
      if (req.method === 'POST' && url.pathname === '/api/ventas') {
        const { clave, ...venta } = (await leerJSON(req)) as Venta & { clave: string };
        const r = await vender(String(clave ?? ''), venta);
        return responder(r.repetida ? 200 : 201, { ...r, ticket: renderizarTexto(r.documento, { ancho: 42 }) });
      }
      if (m && req.method === 'GET') {
        const d = await documento(m[1]!);
        if (!d) return responder(404, { error: 'No existe ese documento.' });
        return m[2] === '.txt' ? responder(200, renderizarTexto(d, { ancho: 42 }), 'text/plain; charset=utf-8') : responder(200, d);
      }
      if (m && m[2] === '/anular' && req.method === 'POST') {
        const { motivo, cajero } = (await leerJSON(req)) as { motivo?: string; cajero?: string };
        return responder(200, await anularVenta(m[1]!, String(motivo ?? ''), typeof cajero === 'string' ? cajero : undefined));
      }
      return responder(404, { error: 'Ruta no encontrada.' });
    } catch (e) {
      if (e instanceof ErrorValidacion) return responder(422, { error: 'La venta no cumple las reglas fiscales.', errores: e.errores });
      if (e instanceof SyntaxError || e instanceof ErrorSolicitud) return responder(400, { error: 'Solicitud inválida.' });
      console.error(e);
      return responder(500, { error: 'Error interno.' });
    }
  }

  return { almacen, vender, anular: anularVenta, documento, estado, sincronizar, pendientesDeEnviar, manejador };
}

async function leerJSON(req: IncomingMessage): Promise<unknown> {
  let cuerpo = '';
  for await (const parte of req) {
    cuerpo += parte;
    if (cuerpo.length > 100_000) throw new ErrorSolicitud('Cuerpo demasiado grande.');
  }
  return JSON.parse(cuerpo || '{}');
}
