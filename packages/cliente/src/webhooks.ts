/**
 * Verificación de webhooks de factura-hn en el receptor, sin dependencias: Web Crypto (Node 20+, navegador,
 * Deno, Bun, Cloudflare Workers, Vercel Edge). Misma regla que `verificarFirmaWebhook` de `@factura-hn/api`.
 *
 * `X-FacturaHN-Firma: t=<segundos unix>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>`
 */

/**
 * true si la firma es de `secreto` sobre el cuerpo **crudo** (el texto recibido, antes de `JSON.parse`) y
 * tiene a lo sumo `toleranciaSegundos` de antigüedad (por defecto 300; protege contra repeticiones).
 */
export async function verificarFirmaWebhook(
  cuerpo: string,
  cabecera: string | null | undefined,
  secreto: string,
  opciones: { toleranciaSegundos?: number; ahora?: () => number } = {},
): Promise<boolean> {
  if (!cabecera || !secreto) return false;
  const partes = new Map(cabecera.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(partes.get('t'));
  const v1 = partes.get('v1');
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return false;
  const ahora = Math.floor((opciones.ahora ?? Date.now)() / 1000);
  if (Math.abs(ahora - t) > (opciones.toleranciaSegundos ?? 300)) return false;
  const texto = new TextEncoder();
  const clave = await crypto.subtle.importKey('raw', texto.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const firma = new Uint8Array(v1.match(/../g)!.map((h) => parseInt(h, 16)));
  // `verify` compara en tiempo constante.
  return crypto.subtle.verify('HMAC', clave, firma, texto.encode(`${t}.${cuerpo}`));
}

/** Forma del cuerpo de cada entrega. Usa `id` (= cabecera `X-FacturaHN-Entrega`) para descartar repetidos. */
export interface AvisoWebhook<D = unknown> {
  /** UUID de la entrega: el mismo en cada reintento. */
  id: string;
  evento: 'documento.emitido' | 'documento.anulado' | 'autorizacion.por_vencer' | 'autorizacion.agotada';
  creado: string;
  datos: D;
}
