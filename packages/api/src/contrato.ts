/**
 * Partes del contrato HTTP que no salen de cada ruta: el id de la solicitud y las cabeceras que la API pone en
 * todas las respuestas, que se agregan a la especificación OpenAPI.
 */

/** Id de solicitud que manda el cliente en `Solicitud-Id`: se respeta si tiene esta forma; si no, se genera uno. */
export const SOLICITUD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type Cabecera = { description: string; required?: boolean; schema: { type: 'string' | 'integer'; example?: string | number } };

/** Cabeceras de respuesta comunes, como componentes reutilizables de la especificación. */
export const CABECERAS_RESPUESTA: Record<string, Cabecera> = {
  'Solicitud-Id': {
    description:
      'Id de la solicitud. Si mandaste una cabecera `Solicitud-Id` válida (1 a 128 letras, dígitos, `.`, `_`, `:` o `-`, ' +
      'empezando por letra o dígito), es la tuya; si no, la API genera un UUID. Va también en `error.solicitud`. El log de un 500 lleva siempre un id generado por el servidor y, si mandaste el tuyo, también el tuyo.',
    required: true,
    schema: { type: 'string', example: '0b6f9c3e-6a1d-4f7e-9a51-2f3c8d7e1a42' },
  },
  'FacturaHN-Version': {
    description: 'Versión de la API que respondió (la misma de `/salud` y de `info.version`).',
    required: true,
    schema: { type: 'string', example: '0.2.0' },
  },
  'FacturaHN-Modo': {
    description:
      'Modo del tenant de la llave: `prueba` (llaves `fhn_test_`, solo CAI ficticios) o `produccion` (llaves `fhn_live_`). ' +
      'Solo después de validar la llave: nunca en un 401, un 413 ni un 429 `DEMASIADOS_INTENTOS` o `DEMASIADAS_SOLICITUDES`; ' +
      'sí en los 429 que llegan con la llave ya validada (`LIMITE_MENSUAL`, `DEMASIADOS_REPORTES`).',
    schema: { type: 'string', example: 'prueba' },
  },
  'RateLimit-Policy': {
    description:
      'Política del límite de la llave (borrador IETF draft-ietf-httpapi-ratelimit-headers): `q` solicitudes de ráfaga que se ' +
      'recuperan enteras en `w` segundos. Solo después de validar la llave: nunca en un 401, un 413 ni un 429 `DEMASIADOS_INTENTOS`.',
    schema: { type: 'string', example: '"llave";q=40;w=2' },
  },
  RateLimit: {
    description:
      'Lo que le queda a la llave: `r` solicitudes y `t` segundos hasta recuperar la ráfaga completa. Solo después de validar la llave: ' +
      'nunca en un 401, un 413 ni un 429 `DEMASIADOS_INTENTOS`.',
    schema: { type: 'string', example: '"llave";r=39;t=1' },
  },
  'Retry-After': {
    description:
      'Segundos que conviene esperar antes de reintentar. En `LIMITE_MENSUAL`, hasta el primer día del mes siguiente (00:00 en Honduras). ' +
      'En un 503 `BASE_NO_DISPONIBLE`, lo que suele tardar la base en volver de un reinicio.',
    required: true,
    schema: { type: 'integer', example: 1 },
  },
};

/** Estados que se responden antes de validar la llave (límite del cuerpo y autenticación): sin cabeceras RateLimit. */
const ESTADOS_ANTES_DE_LA_LLAVE = new Set(['401', '413']);

const METODOS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

type Respuesta = { headers?: Record<string, unknown>; $ref?: string };
type Especificacion = {
  paths?: Record<string, Partial<Record<(typeof METODOS)[number], { responses?: Record<string, Respuesta> }>>>;
  components?: { headers?: Record<string, unknown> } & Record<string, unknown>;
};

/**
 * Agrega el 415 `TIPO_DE_CONTENIDO` a cada operación con cuerpo JSON: el validador lo da si la solicitud no trae
 * `Content-Type: application/json`. Va antes de `conCabecerasComunes`, que le pone las cabeceras.
 */
export function conErrorDeTipoDeContenido<T>(doc: T): T {
  const d = doc as Especificacion & { paths?: Record<string, Partial<Record<(typeof METODOS)[number], { requestBody?: unknown }>>> };
  for (const item of Object.values(d.paths ?? {})) {
    for (const metodo of METODOS) {
      const op = item[metodo] as { requestBody?: unknown; responses?: Record<string, Respuesta> } | undefined;
      if (!op?.requestBody || !op.responses || op.responses['415']) continue;
      op.responses['415'] = {
        description: 'El cuerpo no viene como JSON: falta `Content-Type: application/json` (TIPO_DE_CONTENIDO).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      } as Respuesta;
    }
  }
  return doc;
}

/**
 * Agrega a cada respuesta de la especificación las cabeceras que la API siempre envía: `Solicitud-Id` y
 * `FacturaHN-Version` en todas; `RateLimit-Policy` y `RateLimit` en las de `/v1` que pueden llegar después de
 * validar la llave (no en 401 ni 413, que se responden antes); `Retry-After` en los 429 y los 503.
 * Las cabeceras propias de una respuesta se conservan.
 */
export function conCabecerasComunes<T>(doc: T): T {
  const d = doc as Especificacion;
  d.components = { ...d.components, headers: { ...d.components?.headers, ...CABECERAS_RESPUESTA } };
  for (const [ruta, item] of Object.entries(d.paths ?? {})) {
    for (const metodo of METODOS) {
      const op = item[metodo];
      if (!op?.responses) continue;
      for (const [estado, r] of Object.entries(op.responses)) {
        if (r.$ref) continue;
        const nombres = [
          'Solicitud-Id',
          'FacturaHN-Version',
          ...(ruta.startsWith('/v1/') && !ESTADOS_ANTES_DE_LA_LLAVE.has(estado) ? ['RateLimit-Policy', 'RateLimit'] : []),
          ...(ruta.startsWith('/v1/') && !ESTADOS_ANTES_DE_LA_LLAVE.has(estado) ? ['FacturaHN-Modo'] : []),
          ...(estado === '429' || estado === '503' ? ['Retry-After'] : []),
        ];
        r.headers = { ...Object.fromEntries(nombres.map((n) => [n, { $ref: `#/components/headers/${n}` }])), ...r.headers };
      }
    }
  }
  return doc;
}
