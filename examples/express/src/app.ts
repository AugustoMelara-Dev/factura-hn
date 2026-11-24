/**
 * Una tienda en Express 5 que factura con la API de factura-hn:
 *
 * - `POST /pedidos/:id/factura` emite la factura del pedido. La clave de idempotencia es el id del pedido:
 *   si la respuesta se pierde y se reintenta, la API devuelve la misma factura en lugar de emitir otra.
 * - `GET /pedidos/:id/factura.pdf` entrega la representación impresa (Art. 38) del pedido, no de un número
 *   cualquiera: los números son consecutivos y servirlos por número dejaría bajar las facturas de todos.
 * - `POST /webhooks/factura-hn` recibe los avisos firmados (emitido, anulado, CAI por vencer o agotado).
 *
 * La llave de API vive solo en el servidor.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ErrorFacturaHN, verificarFirmaWebhook, type AvisoWebhook, type crearCliente } from '@factura-hn/cliente';

export interface Pedido {
  id: string;
  /** Número de la factura, cuando ya se emitió. */
  numeroFactura?: string;
  cliente?: { nombre?: string; rtn?: string };
  articulos: { descripcion: string; cantidad: number; precioConISV: string }[];
}

export interface OpcionesTienda {
  fhn: ReturnType<typeof crearCliente>;
  /**
   * Busca el pedido en tu base. Los precios vienen de ahí, no del navegador. En tu tienda, devuelve null
   * también si el pedido no es del usuario de la sesión.
   */
  buscarPedido: (id: string) => Promise<Pedido | null>;
  /** Guarda en el pedido el número de su factura. */
  guardarFactura: (pedidoId: string, numero: string) => Promise<void>;
  /**
   * Quién factura (DEC-031), p. ej. el usuario de la sesión que despacha el pedido. Queda en la bitácora de la
   * API junto a la llave. Sin esta función, la bitácora solo tiene la llave.
   */
  operadorDe?: (req: Request) => string | undefined;
  secretoWebhook: string;
  /** Qué hacer con cada aviso (ya verificado y sin repetidos). */
  alRecibirAviso?: (aviso: AvisoWebhook) => Promise<void>;
}

/** Si el content-type es `application/json` (con o sin parámetros). Se lee la cabecera: el cuerpo puede venir vacío. */
function esJSON(req: Request): boolean {
  return (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json';
}

/**
 * Crea la app de la tienda.
 *
 * **Las rutas `/pedidos` no tienen autenticación propia.** Móntalas detrás del middleware de sesión de tu
 * tienda, con la cookie de sesión en `SameSite=Lax` o `Strict` o con un token CSRF, y haz que `buscarPedido`
 * compruebe que el pedido es del usuario de la sesión (si no, que devuelva null: 404).
 *
 * `POST /pedidos/:id/factura` exige `content-type: application/json` (si no, 415). Un formulario de otro sitio
 * solo puede enviar `text/plain`, `application/x-www-form-urlencoded` o `multipart/form-data` sin preflight de
 * CORS; con JSON, el navegador pregunta antes y esta app no responde al preflight, así que no se envía.
 */
export function crearTienda(o: OpcionesTienda): Express {
  const app = express();
  app.disable('x-powered-by');
  // En producción guarda los ids procesados en tu base (con índice único), no en memoria. Se guarda la
  // promesa, no solo el id: una entrega repetida que llega mientras la primera se procesa espera a esa.
  const avisos = new Map<string, Promise<void>>();

  app.post('/pedidos/:id/factura', async (req, res) => {
    if (!esJSON(req)) return void res.status(415).json({ error: 'Envía la solicitud con content-type: application/json.' });
    const pedido = await o.buscarPedido(String(req.params.id));
    if (!pedido) return void res.status(404).json({ error: 'Pedido no encontrado.' });
    const operador = o.operadorDe?.(req);
    const { documento, repetida } = await o.fhn.emitir(
      {
        ...(operador && { operador }),
        documento: {
          cliente: pedido.cliente,
          preciosIncluyenISV: true,
          lineas: pedido.articulos.map((a) => ({ descripcion: a.descripcion, cantidad: a.cantidad, precioUnitario: a.precioConISV })),
        },
      },
      { idempotencyKey: `pedido-${pedido.id}` },
    );
    await o.guardarFactura(pedido.id, documento.numero);
    res.status(repetida ? 200 : 201).json({ numero: documento.numero, total: documento.totales.total, pdf: `/pedidos/${pedido.id}/factura.pdf` });
  });

  app.get('/pedidos/:id/factura.pdf', async (req, res) => {
    const pedido = await o.buscarPedido(String(req.params.id));
    if (!pedido?.numeroFactura) return void res.status(404).end();
    const pdf = await o.fhn.descargar(pedido.numeroFactura, 'pdf');
    res.type('application/pdf').set('cache-control', 'private, no-store').send(Buffer.from(pdf));
  });

  // Cuerpo crudo: la firma se calcula sobre los bytes recibidos, no sobre el JSON ya parseado.
  app.post('/webhooks/factura-hn', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!(await verificarFirmaWebhook(cuerpo, req.get('x-facturahn-firma'), o.secretoWebhook))) return void res.status(400).end();
    const aviso = JSON.parse(cuerpo) as AvisoWebhook;
    let proceso = avisos.get(aviso.id);
    if (!proceso) {
      proceso = Promise.resolve(o.alRecibirAviso?.(aviso));
      avisos.set(aviso.id, proceso);
      // Si falla, se olvida: la API reintenta y se vuelve a procesar.
      proceso.catch(() => avisos.delete(aviso.id));
    }
    await proceso;
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
