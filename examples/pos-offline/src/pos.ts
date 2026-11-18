/**
 * Mini POS fuera de línea: emite con el SDK sobre SQLite en el equipo de la caja, sin internet.
 *
 * - Cada venta lleva una clave que genera el navegador. Si la respuesta se pierde y la caja reintenta con la
 *   misma clave, recibe el mismo documento. La clave se guarda **en la misma transacción** que el documento:
 *   no hay ventana en la que exista uno sin la otra.
 * - Lo emitido y lo anulado entra a una cola de salida (`pos_salida`), también en la transacción, para
 *   enviarlo a la contabilidad o a la oficina central cuando vuelva la conexión (`sincronizar`).
 */
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
  emisor: Emisor;
  establecimiento: string;
  puntoEmision: string;
  reloj?: () => Date;
}

export interface Venta {
  cliente?: { nombre?: string; rtn?: string };
  lineas: LineaEntrada[];
}

const CLAVE = /^[A-Za-z0-9-]{8,64}$/;

export function crearPOS(o: OpcionesPOS) {
  const almacen = new AlmacenSQLite(o.db);
  o.db.exec(`
    CREATE TABLE IF NOT EXISTS pos_ventas (clave TEXT PRIMARY KEY, numero TEXT NOT NULL);
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
    const previa = o.db.prepare('SELECT numero FROM pos_ventas WHERE clave = ?').get(clave) as { numero: string } | undefined;
    if (previa) return { documento: (await documento(previa.numero))!, repetida: true };
    // La conexión de SQLite es una sola: lo que se ejecuta en `alEmitir` queda dentro de la transacción.
    const doc = await emitir(
      { emisor: o.emisor, cliente: venta.cliente, preciosIncluyenISV: true, lineas: venta.lineas },
      {
        ...config,
        alEmitir: async (d) => {
          o.db.prepare('INSERT INTO pos_ventas (clave, numero) VALUES (?, ?)').run(clave, d.numero);
          encolar('documento.emitido', d.numero);
        },
      },
    );
    return { documento: doc, repetida: false };
  }

  /** Anulación (Art. 41): el documento conserva su número y queda marcado ANULADO. */
  async function anularVenta(numero: string, motivo: string): Promise<DocumentoFiscal> {
    return anular(numero, { almacen, motivo, reloj: o.reloj, actor, alAnular: async (d) => void encolar('documento.anulado', d.numero) });
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
  async function sincronizar(enviar: (aviso: { id: number; evento: string; documento: DocumentoFiscal }) => Promise<void>): Promise<number> {
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
        const { motivo } = (await leerJSON(req)) as { motivo?: string };
        return responder(200, await anularVenta(m[1]!, String(motivo ?? '')));
      }
      return responder(404, { error: 'Ruta no encontrada.' });
    } catch (e) {
      if (e instanceof ErrorValidacion) return responder(422, { error: 'La venta no cumple las reglas fiscales.', errores: e.errores });
      if (e instanceof SyntaxError || (e as Error).message === 'CUERPO_GRANDE') return responder(400, { error: 'Solicitud inválida.' });
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
    if (cuerpo.length > 100_000) throw new Error('CUERPO_GRANDE');
  }
  return JSON.parse(cuerpo || '{}');
}
