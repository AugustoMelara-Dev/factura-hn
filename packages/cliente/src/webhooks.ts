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
    // A lo sumo 8 firmas: la API manda una o dos; una cabecera con cientos no multiplica el trabajo.
    else if (clave === 'v1' && /^[0-9a-f]{64}$/.test(valor) && firmas.length < 8) firmas.push(valor);
  }
  if (ts.length !== 1 || !/^\d{1,15}$/.test(ts[0]!) || !firmas.length) return false;
  const t = Number(ts[0]);
  const ahora = Math.floor((opciones.ahora ?? Date.now)() / 1000);
  if (Math.abs(ahora - t) > (opciones.toleranciaSegundos ?? 300)) return false;
  const texto = new TextEncoder();
  const clave = await crypto.subtle.importKey('raw', texto.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // Un solo HMAC; cada `v1` se compara con él en tiempo constante, sin cortar en la primera que coincide.
  const esperado = new Uint8Array(await crypto.subtle.sign('HMAC', clave, texto.encode(`${t}.${cuerpo}`)));
  let valida = false;
  for (const v1 of firmas) valida = igualesEnTiempoConstante(esperado, v1) || valida;
  return valida;
}

/** Compara los 32 bytes del HMAC con una firma en hex (64 caracteres ya validados) sin salir antes de tiempo. */
function igualesEnTiempoConstante(esperado: Uint8Array, hex: string): boolean {
  let diferencia = 0;
  for (let i = 0; i < esperado.length; i++) diferencia |= esperado[i]! ^ parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return diferencia === 0;
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
