/**
 * Validador de respuestas contra `packages/api/openapi.json` (el archivo publicado, no la especificación en memoria).
 *
 * Para cada respuesta de la API:
 * - la operación (método + ruta) existe en la especificación; fuera de ella solo valen `/openapi.json`, `/docs`, el
 *   404 `NO_ENCONTRADO` de una ruta que no existe (ver `FUERA_DE_LA_ESPECIFICACION`) y la lista explícita de
 *   operaciones no publicadas (`OPERACIONES_NO_PUBLICADAS`, las del modo demo), de las que se revisan las cabeceras
 *   comunes y la forma de error. Una ruta nueva que no esté en ninguna de las dos hace fallar la prueba;
 * - el estado está declarado en la operación;
 * - el tipo de contenido está declarado para ese estado y, si es JSON, el cuerpo cumple su esquema (ajv, JSON
 *   Schema 2020-12, el dialecto de OpenAPI 3.1);
 * - las cabeceras: `Solicitud-Id` y `FacturaHN-Version` siempre; cada cabecera propia de la API (`PROPIAS`) que
 *   llega debe estar declarada para ese estado y cumplir su esquema (p. ej. `Retry-After` entero).
 */
import { readFileSync } from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { OPERACIONES_NO_PUBLICADAS } from '../src/demo';

type Esquema = Record<string, unknown>;
interface RespuestaSpec { content?: Record<string, { schema?: Esquema }>; headers?: Record<string, { $ref?: string; schema?: Esquema; required?: boolean }> }
interface OperacionSpec { operationId: string; responses: Record<string, RespuestaSpec> }
interface Spec { paths: Record<string, Record<string, OperacionSpec>>; components: { headers: Record<string, { schema: Esquema; required?: boolean }> } }

export const SPEC: Spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
const ID = 'https://factura-hn.example/openapi.json';

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addFormat('binary', true);
ajv.addSchema({ ...SPEC, $id: ID });

/** Cabeceras que pone la API (no el transporte): si llegan, la especificación debe declararlas en ese estado. */
export const PROPIAS = ['solicitud-id', 'facturahn-version', 'facturahn-modo', 'ratelimit-policy', 'ratelimit', 'retry-after', 'documentos-prueba-excluidos', 'idempotency-replayed'];
const SIEMPRE = ['Solicitud-Id', 'FacturaHN-Version'];

/** Rutas que no son operaciones de la API: la especificación, su visor y `/` (redirige a `/docs`). Las `/prueba-*` las agregan las pruebas. */
export const FUERA_DE_LA_ESPECIFICACION = ['/openapi.json', '/docs', '/'];

const puntero = (...partes: string[]) => '#/' + partes.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
const compilados = new Map<string, ValidateFunction>();
function validador(ref: string): ValidateFunction {
  let v = compilados.get(ref);
  if (!v) {
    v = ajv.compile({ $ref: `${ID}${ref}` });
    compilados.set(ref, v);
  }
  return v;
}

const rutas = Object.keys(SPEC.paths).map((plantilla) => ({
  plantilla,
  patron: new RegExp('^' + plantilla.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '$'),
  // Una plantilla sin parámetros gana sobre una con parámetros (p. ej. /v1/documentos/x frente a /v1/documentos/{archivo}).
  parametros: (plantilla.match(/\{/g) ?? []).length,
})).sort((a, b) => a.parametros - b.parametros);

export interface Resultado {
  /** `METODO plantilla estado`, o `fuera` si no es una operación. */
  clave: string;
  operacion: string | null;
  violaciones: string[];
}

/** Valida una respuesta. Lee una copia del cuerpo: la respuesta original queda intacta. */
export async function validarRespuesta(metodo: string, url: string, r: Response): Promise<Resultado> {
  const ruta = new URL(url, 'http://localhost').pathname;
  const m = metodo.toLowerCase() === 'head' ? 'get' : metodo.toLowerCase();
  const violaciones: string[] = [];
  const cabeceras = (r.headers as Headers);
  for (const h of SIEMPRE) if (!cabeceras.has(h)) violaciones.push(`falta la cabecera ${h}`);
  // Todo JSON declara su codificación: sin ella, Windows PowerShell 5.1 lo lee como Latin-1.
  const tipoCompleto = cabeceras.get('content-type') ?? '';
  if (/^application\/json(?:\s*;|\s*$)/i.test(tipoCompleto) && !/;\s*charset=utf-8\s*$/i.test(tipoCompleto)) violaciones.push(`${metodo} ${ruta}: JSON sin charset=utf-8 («${tipoCompleto}»)`);

  const hallada = rutas.find((x) => x.patron.test(ruta) && SPEC.paths[x.plantilla]![m]);
  if (!hallada && OPERACIONES_NO_PUBLICADAS.includes(`${m.toUpperCase()} ${ruta}`)) {
    // No publicadas: sin esquema de éxito en la especificación (sus pruebas revisan el cuerpo); los errores, con la
    // forma de error de la API, y el preflight sin cuerpo.
    if (r.status >= 400) {
      const cuerpo = await leerJSON(r, violaciones);
      const v = validador(puntero('components', 'schemas', 'Error'));
      if (cuerpo !== undefined && !v(cuerpo)) violaciones.push(`${metodo} ${ruta} ${r.status}: ${ajv.errorsText(v.errors)}`);
    } else if (m === 'options' ? r.status !== 204 : r.status !== 201) violaciones.push(`${metodo} ${ruta}: respondió ${r.status}`);
    if (r.status === 429 && cabeceras.get('retry-after') === null) violaciones.push(`${metodo} ${ruta}: un 429 sin Retry-After`);
    return { clave: `no publicada ${m.toUpperCase()} ${ruta} ${r.status}`, operacion: null, violaciones };
  }
  if (!hallada) {
    if (FUERA_DE_LA_ESPECIFICACION.includes(ruta) && m === 'get') return { clave: `fuera ${ruta}`, operacion: null, violaciones };
    // Rutas que una prueba agrega a la app para provocar un error (p. ej. `/prueba-otro-400` en contrato.test.ts).
    if (ruta.startsWith('/prueba-')) return { clave: 'fuera prueba', operacion: null, violaciones };
    // Ruta u método inexistente: el 404 NO_ENCONTRADO o, en /v1, lo que responden los middlewares de /v1/* antes de
    // buscar la ruta, también en /v1 a secas (401 de la llave, 413 del tamaño, 400 CUERPO_NO_UTF8, 429 de los límites). Siempre con la forma
    // de error de la API.
    // En modo demo, la autenticación también responde por el entorno (vencido, no es de la demo, operación cerrada,
    // límites) y por el interruptor global.
    const ANTES_DE_LA_RUTA: Record<number, string[]> = {
      400: ['CUERPO_NO_UTF8'],
      401: ['NO_AUTENTICADO', 'ENTORNO_VENCIDO'],
      403: ['DEMO_SOLO_PRUEBA', 'DEMO_NO_DISPONIBLE'],
      413: ['CUERPO_DEMASIADO_GRANDE'],
      429: ['DEMASIADOS_INTENTOS', 'DEMASIADAS_SOLICITUDES', 'DEMO_LIMITE_SOLICITUDES'],
      503: ['DEMO_PAUSADO'],
    };
    const codigos = r.status === 404 ? ['NO_ENCONTRADO'] : ruta === '/v1' || ruta.startsWith('/v1/') ? ANTES_DE_LA_RUTA[r.status] : undefined;
    if (!codigos) violaciones.push(`${metodo} ${ruta}: no está en la especificación y respondió ${r.status}`);
    else {
      const cuerpo = await leerJSON(r, violaciones);
      if (cuerpo !== undefined) {
        const v = validador(puntero('components', 'schemas', 'Error'));
        if (!v(cuerpo)) violaciones.push(`${r.status} fuera de la especificación: ${ajv.errorsText(v.errors)}`);
        else if (!codigos.includes((cuerpo as { error: { codigo: string } }).error.codigo)) violaciones.push(`${r.status} fuera de la especificación con el código ${(cuerpo as { error: { codigo: string } }).error.codigo}`);
      }
    }
    return { clave: `fuera ${r.status}`, operacion: null, violaciones };
  }

  const op = SPEC.paths[hallada.plantilla]![m]!;
  const nombre = `${m.toUpperCase()} ${hallada.plantilla}`;
  const clave = `${nombre} ${r.status}`;
  const estado = String(r.status);
  const resp = op.responses[estado] ?? op.responses.default;
  if (!resp) {
    violaciones.push(`${nombre}: el estado ${r.status} no está declarado (${Object.keys(op.responses).join(', ')})`);
    return { clave, operacion: op.operationId, violaciones };
  }

  // Cabeceras
  const declaradas = new Map(Object.entries(resp.headers ?? {}).map(([k, v]) => [k.toLowerCase(), { nombre: k, def: v }]));
  for (const h of SIEMPRE) if (!declaradas.has(h.toLowerCase())) violaciones.push(`${clave}: la especificación no declara ${h}`);
  // Las cabeceras que la especificación marca como obligatorias (`required`) deben llegar; y todo 429, con Retry-After.
  for (const [h, d] of declaradas) {
    const def = d.def.$ref ? SPEC.components.headers[d.def.$ref.split('/').pop()!] : d.def;
    if (def?.required && cabeceras.get(h) === null) violaciones.push(`${clave}: falta la cabecera obligatoria ${d.nombre}`);
  }
  if (r.status === 429 && cabeceras.get('retry-after') === null) violaciones.push(`${clave}: un 429 sin Retry-After`);
  for (const h of PROPIAS) {
    const valor = cabeceras.get(h);
    if (valor === null) continue;
    const d = declaradas.get(h);
    if (!d) {
      violaciones.push(`${clave}: llega la cabecera ${h} y la especificación no la declara en esta respuesta`);
      continue;
    }
    const esquema = d.def.$ref ? SPEC.components.headers[d.def.$ref.split('/').pop()!]?.schema : d.def.schema;
    if (esquema?.type === 'integer' && !/^-?\d+$/.test(valor)) violaciones.push(`${clave}: ${d.nombre} debe ser entero y es «${valor}»`);
  }

  // Cuerpo
  const contenido = resp.content ?? {};
  const tipo = (cabeceras.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  // Los reportes en texto se transmiten (y algunas pruebas los dejan sin leer a propósito): de ellos se valida el
  // estado, el tipo y las cabeceras, no el cuerpo. Los JSON son pequeños y se leen de una copia.
  // Sin contenido declarado, el cuerpo se lee siempre, sea cual sea su tipo: debe llegar vacío.
  const sinContenido = Object.keys(contenido).length === 0;
  const leerCuerpo = metodo.toLowerCase() !== 'head' && (sinContenido || tipo === 'application/json' || tipo === '');
  const texto = leerCuerpo ? await r.clone().text() : '';
  if (sinContenido) {
    if (texto !== '') violaciones.push(`${clave}: la especificación no declara cuerpo y llegó «${texto.slice(0, 80)}»`);
    return { clave, operacion: op.operationId, violaciones };
  }
  if (metodo.toLowerCase() === 'head') return { clave, operacion: op.operationId, violaciones };
  if (!(tipo in contenido)) {
    violaciones.push(`${clave}: tipo de contenido «${tipo}» no declarado (${Object.keys(contenido).join(', ')})`);
    return { clave, operacion: op.operationId, violaciones };
  }
  if (tipo === 'application/json') {
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      violaciones.push(`${clave}: el cuerpo no es JSON`);
      return { clave, operacion: op.operationId, violaciones };
    }
    const v = validador(puntero('paths', hallada.plantilla, m, 'responses', op.responses[estado] ? estado : 'default', 'content', tipo, 'schema'));
    if (!v(cuerpo)) violaciones.push(`${clave}: el cuerpo no cumple el esquema: ${ajv.errorsText(v.errors, { separator: '; ' })}`);
  }
  return { clave, operacion: op.operationId, violaciones };
}

async function leerJSON(r: Response, violaciones: string[]): Promise<unknown> {
  try {
    return JSON.parse(await r.clone().text());
  } catch {
    violaciones.push(`${r.status}: el cuerpo no es JSON`);
    return undefined;
  }
}

/** Todas las combinaciones operación + estado de la especificación (para medir cobertura). */
export function combinacionesDeLaEspecificacion(): string[] {
  return Object.entries(SPEC.paths).flatMap(([p, item]) => Object.entries(item).flatMap(([m, op]) => Object.keys(op.responses).map((e) => `${m.toUpperCase()} ${p} ${e}`)));
}
