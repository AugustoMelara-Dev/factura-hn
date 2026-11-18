import { verificarFirmaWebhook, type AvisoWebhook } from '@factura-hn/cliente';

/**
 * Receptor de webhooks. La firma se verifica sobre el texto crudo (`req.text()`), antes de parsear.
 * Responde 2xx solo cuando el aviso quedó procesado; con 5xx, factura-hn reintenta.
 */
export async function POST(req: Request): Promise<Response> {
  const cuerpo = await req.text();
  const secreto = process.env.FHN_SECRETO_WEBHOOK ?? '';
  if (!(await verificarFirmaWebhook(cuerpo, req.headers.get('x-facturahn-firma'), secreto))) {
    return new Response(null, { status: 400 });
  }
  const aviso = JSON.parse(cuerpo) as AvisoWebhook;
  // Guarda `aviso.id` con un índice único en tu base para descartar repetidos antes de actuar.
  console.log('Aviso', aviso.evento, aviso.id);
  return new Response(null, { status: 204 });
}
