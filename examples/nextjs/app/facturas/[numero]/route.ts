import { firmaValida } from '../../../lib/enlaces';
import { fhn } from '../../../lib/fhn';

const NUMERO = /^\d{3}-\d{3}-\d{2}-\d{8}$/;

/** Representación impresa (Art. 38) servida desde tu dominio, sin exponer la llave y solo con enlace firmado. */
export async function GET(req: Request, ctx: { params: Promise<{ numero: string }> }): Promise<Response> {
  const { numero } = await ctx.params;
  if (!NUMERO.test(numero) || !firmaValida(numero, new URL(req.url).searchParams.get('firma'))) return new Response(null, { status: 404 });
  const pdf = await fhn().descargar(numero, 'pdf');
  return new Response(pdf as BodyInit, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${numero}.pdf"`, 'cache-control': 'private, no-store' },
  });
}
