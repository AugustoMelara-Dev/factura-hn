/**
 * Token del MCP remoto: `fhnmcp_<test|live>_<prefijo>_<secreto>`. Va en la ruta de la URL personal
 * (`https://…/mcp/<token>`), porque un conector personalizado de Claude se agrega solo con la URL. De él se deriva la
 * llave de API con que este servidor habla con la API: `fhn_<marca>_<prefijo>_<HMAC-SHA256(secreto, ETIQUETA)>`.
 * La API crea esa llave (y guarda solo su hash) al crear el token; revocarla (`DELETE /v1/llaves/{prefijo}`) apaga
 * el token. La misma derivación está en la API (`packages/api/src/llaves.ts`); una prueba comprueba que coinciden.
 */
import { createHmac } from 'node:crypto';

const FORMATO_TOKEN_MCP = /^fhnmcp_(live|test)_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;
const ETIQUETA_TOKEN_MCP = 'factura-hn/mcp/llave/v1';
/** Una llave de API de factura-hn (con o sin marca de modo). */
const FORMATO_LLAVE = /^fhn_(?:(?:live|test)_)?[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/;

/** La llave de API que corresponde a un token del MCP remoto, o null si el token no tiene la forma. */
export function llaveDeTokenMcp(token: string): string | null {
  const m = FORMATO_TOKEN_MCP.exec(token);
  if (!m) return null;
  return `fhn_${m[1]}_${m[2]}_${createHmac('sha256', m[3]!).update(ETIQUETA_TOKEN_MCP).digest('base64url')}`;
}

/** Si el texto tiene la forma de una llave de API (no dice si es válida). */
export const esLlaveApi = (llave: string): boolean => FORMATO_LLAVE.test(llave);
