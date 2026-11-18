/**
 * Una tienda en Express 5 que factura con la API de factura-hn:
 *
 * - `POST /pedidos/:id/factura` emite la factura del pedido. La clave de idempotencia es el id del pedido:
 *   si la respuesta se pierde y se reintenta, la API devuelve la misma factura en lugar de emitir otra.
 * - `GET /facturas/:numero.pdf` entrega la representación impresa (Art. 38).
 * - `POST /webhooks/factura-hn` recibe los avisos firmados (emitido, anulado, CAI por vencer o agotado).
 *
 * La llave de API vive solo en el servidor.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ErrorFacturaHN, verificarFirmaWebhook, type AvisoWebhook, type crearCliente } from '@factura-hn/cliente';

export interface Pedido {
  id: string;
  cliente?: { nombre?: string; rtn?: string };
  articulos: { descripcion: string; cantidad: number; precioConISV: string }[];
}

export interface OpcionesTienda {
  fhn: ReturnType<typeof crearCliente>;
  /** Busca el pedido en tu base. Los precios vienen de ahí, no del navegador. */
  buscarPedido: (id: string) => Promise<Pedido | null>;
  secretoWebhook: string;
  /** Qué hacer con cada aviso (ya verificado y sin repetidos). */
  alRecibirAviso?: (aviso: AvisoWebhook) => Promise<void>;
}

const NUMERO = /^\d{3}-\d{3}-\d{2}-\d{8}$/;

export function crearTienda(o: OpcionesTienda): Express {
  const app = express();
  app.disable('x-powered-by');
  // En producción guarda los ids procesados en tu base (con índice único), no en memoria.
  const avisosVistos = new Set<string>();

  app.post('/pedidos/:id/factura', async (req, res) => {
    const pedido = await o.buscarPedido(String(req.params.id));
    if (!pedido) return void res.status(404).json({ error: 'Pedido no encontrado.' });
    const { documento, repetida } = await o.fhn.emitir(
      {
        documento: {
          cliente: pedido.cliente,
          preciosIncluyenISV: true,
          lineas: pedido.articulos.map((a) => ({ descripcion: a.descripcion, cantidad: a.cantidad, precioUnitario: a.precioConISV })),
        },
      },
      { idempotencyKey: `pedido-${pedido.id}` },
    );
    res.status(repetida ? 200 : 201).json({ numero: documento.numero, total: documento.totales.total, pdf: `/facturas/${documento.numero}.pdf` });
  });

  app.get('/facturas/:archivo', async (req, res) => {
    const numero = String(req.params.archivo).replace(/\.pdf$/, '');
    if (!NUMERO.test(numero)) return void res.status(404).end();
    const pdf = await o.fhn.descargar(numero, 'pdf');
    res.type('application/pdf').send(Buffer.from(pdf));
  });

  // Cuerpo crudo: la firma se calcula sobre los bytes recibidos, no sobre el JSON ya parseado.
  app.post('/webhooks/factura-hn', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!(await verificarFirmaWebhook(cuerpo, req.get('x-facturahn-firma'), o.secretoWebhook))) return void res.status(400).end();
    const aviso = JSON.parse(cuerpo) as AvisoWebhook;
    if (!avisosVistos.has(aviso.id)) {
      await o.alRecibirAviso?.(aviso);
      avisosVistos.add(aviso.id);
    }
    // 2xx para que no se reintente; si `alRecibirAviso` lanza, Express responde 500 y llega de nuevo.
    res.status(204).end();
  });

  // Errores de la API: los fiscales (422) se devuelven tal cual para mostrarlos al usuario.
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (e instanceof ErrorFacturaHN) {
      const estado = e.estado === 422 || e.estado === 404 || e.estado === 409 ? e.estado : 502;
      return void res.status(estado).json({ error: e.message, codigo: e.codigo, errores: e.errores });
    }
    console.error(e);
    res.status(500).json({ error: 'Error interno.' });
  });

  return app;
}
