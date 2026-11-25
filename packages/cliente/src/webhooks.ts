/**
 * Verificación de webhooks de factura-hn en el receptor, sin dependencias: Web Crypto (Node 20+, navegador,
 * Deno, Bun, Cloudflare Workers, Vercel Edge). Misma regla que `verificarFirmaWebhook` de `@factura-hn/api`.
 *
 * `X-FacturaHN-Firma: t=<segundos unix>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>`
 *
 * Durante la gracia de una rotación del secreto, la cabecera lleva dos `v1` (el del secreto anterior y el del
 * nuevo): basta con que uno verifique.
 */

/**
 * true si **alguna** firma `v1` de la cabecera es de `secreto` sobre el cuerpo **crudo** (el texto recibido,
 * antes de `JSON.parse`) y tiene a lo sumo `toleranciaSegundos` de antigüedad (por defecto 300; protege contra
 * repeticiones). Las entradas que no conoce (`v0=`, `v2=`…) y los `v1` mal formados se ignoran. Una cabecera
 * sin `t`, con más de un `t` o sin ningún `v1` bien formado no verifica.
 */
export async function verificarFirmaWebhook(
  cuerpo: string,
  cabecera: string | null | undefined,
  secreto: string,
  opciones: { toleranciaSegundos?: number; ahora?: () => number } = {},
): Promise<boolean> {
  if (!cabecera || !secreto) return false;
  const ts: string[] = [];
  const firmas: string[] = [];
  for (const parte of cabecera.split(',')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const clave = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (clave === 't') ts.push(valor);
    else if (clave === 'v1' && /^[0-9a-f]{64}$/.test(valor)) firmas.push(valor);
  }
  if (ts.length !== 1 || !/^\d{1,15}$/.test(ts[0]!) || !firmas.length) return false;
  const t = Number(ts[0]);
  const ahora = Math.floor((opciones.ahora ?? Date.now)() / 1000);
  if (Math.abs(ahora - t) > (opciones.toleranciaSegundos ?? 300)) return false;
  const texto = new TextEncoder();
  const clave = await crypto.subtle.importKey('raw', texto.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const datos = texto.encode(`${t}.${cuerpo}`);
  // `verify` compara en tiempo constante. Se revisan todas, sin cortar en la primera que coincide.
  const resultados = await Promise.all(
    firmas.map((v1) => crypto.subtle.verify('HMAC', clave, new Uint8Array(v1.match(/../g)!.map((h) => parseInt(h, 16))), datos)),
  );
  return resultados.some(Boolean);
}

/** Forma del cuerpo de cada entrega. Usa `id` (= cabecera `X-FacturaHN-Entrega`) para descartar repetidos. */
export interface AvisoWebhook<D = unknown> {
  /** UUID de la entrega: el mismo en cada reintento y en un reenvío manual. */
  id: string;
  /** `webhook.prueba` llega solo cuando lo pides con `POST /v1/webhooks/{id}/probar`. */
  evento: 'documento.emitido' | 'documento.anulado' | 'autorizacion.por_vencer' | 'autorizacion.agotada' | 'webhook.prueba';
  creado: string;
  datos: D;
}
