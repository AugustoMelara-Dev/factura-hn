/**
 * Modo demo (`FHN_MODO=demo`): la demostración pública. Cada visitante crea con `POST /v1/demo/entornos` su propio
 * entorno de prueba: un tenant de prueba con emisor y CAI ficticios, una llave `fhn_test_` y una URL personal del MCP
 * remoto. Nada se comparte entre visitantes, todo lo emitido es DOCUMENTO DE PRUEBA y a las 24 h el entorno se
 * borra con todos sus datos.
 *
 * Aquí está la configuración (variables de entorno, con valores estrictos por defecto) y los textos de la respuesta.
 */
import { createHmac, randomBytes } from 'node:crypto';

export interface ConfigDemo {
  /** Horas que dura un entorno antes de borrarse. Por defecto 24 (`FHN_DEMO_HORAS`, de 1 a 72). */
  horas: number;
  /** Entornos que una dirección puede crear en 24 h. Por defecto 3 (`FHN_DEMO_ENTORNOS_POR_IP`). */
  entornosPorIp: number;
  /** Entornos vigentes a la vez en todo el servicio. Por defecto 200 (`FHN_DEMO_MAX_ENTORNOS`). */
  maxEntornos: number;
  /** Entornos nuevos por minuto en todo el servicio. Por defecto 10 (`FHN_DEMO_CREACIONES_POR_MINUTO`). */
  creacionesPorMinuto: number;
  /** Documentos que puede emitir un entorno. Por defecto 50 (`FHN_DEMO_DOCUMENTOS`). */
  documentos: number;
  /** Solicitudes por minuto de un entorno (su llave y su MCP juntos). Por defecto 30 (`FHN_DEMO_SOLICITUDES_POR_MINUTO`). */
  solicitudesPorMinuto: number;
  /** Solicitudes en toda la vida de un entorno, en este proceso. Por defecto 1500 (`FHN_DEMO_SOLICITUDES_POR_ENTORNO`). */
  solicitudesPorEntorno: number;
  /** Solicitudes por minuto de todos los entornos juntos. Por defecto 300 (`FHN_DEMO_SOLICITUDES_POR_MINUTO_GLOBAL`). */
  solicitudesPorMinutoGlobal: number;
  /** Bytes de un cuerpo de solicitud. Por defecto 32 KiB (`FHN_DEMO_MAX_CUERPO`). */
  maxCuerpo: number;
  /** Bytes de documentos en una página de `GET /v1/documentos`. Por defecto 256 KiB (`FHN_DEMO_MAX_BYTES_PAGINA`). */
  maxBytesPagina: number;
  /** Interruptor global al arrancar (`FHN_DEMO_PAUSADO=1`). La consola lo cambia en caliente (`demo pausar`). */
  pausado: boolean;
  /** URL pública de esta API, para los ejemplos (`FHN_DEMO_URL_API`). Sin ella, la de la solicitud. */
  urlApi?: string;
  /** URL pública del MCP remoto, sin el token (`FHN_DEMO_URL_MCP`, p. ej. `https://mcp.ejemplo.example/mcp`). */
  urlMcp?: string;
  /** Orígenes del navegador que pueden llamar a `POST /v1/demo/entornos` (CORS, `FHN_DEMO_ORIGENES`). */
  origenes: readonly string[];
  /** Clave de la huella de la dirección que se guarda para el cupo por dirección (`FHN_DEMO_SECRETO`). */
  secreto: Buffer;
}

/** Origen por defecto de CORS: el sitio de la documentación, donde vive la página «Pruébalo ahora». */
export const ORIGENES_DEMO_POR_DEFECTO = ['https://augustomelara-dev.github.io'] as const;

export const RUTA_ENTORNOS_DEMO = '/v1/demo/entornos';

const entero = (env: NodeJS.ProcessEnv, nombre: string, defecto: number, min: number, max: number): number => {
  const t = env[nombre]?.trim();
  if (!t) return defecto;
  if (!/^\d{1,9}$/.test(t) || Number(t) < min || Number(t) > max) {
    throw new Error(`${nombre} debe ser un número entero entre ${min} y ${max} (no "${t}").`);
  }
  return Number(t);
};

const url = (env: NodeJS.ProcessEnv, nombre: string): string | undefined => {
  const t = env[nombre]?.trim();
  if (!t) return undefined;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error(`${nombre} debe ser una URL completa, p. ej. https://api.ejemplo.example (no "${t}").`);
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error(`${nombre} debe usar https (no "${t}"): la llave y el token viajan en ella.`);
  }
  if (u.search || u.hash) throw new Error(`${nombre} no lleva ? ni #: ${t}`);
  return t.replace(/\/+$/, '');
};

/** Lee la configuración del modo demo de las variables de entorno. Falla con un mensaje claro si un valor no sirve. */
export function leerConfigDemo(env: NodeJS.ProcessEnv, avisar: (m: string) => void = (m) => console.warn(m)): ConfigDemo {
  const origenes = (env.FHN_DEMO_ORIGENES ?? ORIGENES_DEMO_POR_DEFECTO.join(','))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const o of origenes) {
    // Un origen es esquema + host (+ puerto), sin ruta. Nunca «*»: la respuesta lleva una llave.
    if (!/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)) {
      throw new Error(`FHN_DEMO_ORIGENES: cada origen va como https://sitio.ejemplo, sin ruta ni «*» (no "${o}").`);
    }
  }
  let secreto: Buffer;
  const s = env.FHN_DEMO_SECRETO?.trim();
  if (s) {
    secreto = Buffer.from(s, 'utf8');
    if (secreto.length < 32) throw new Error('FHN_DEMO_SECRETO debe tener al menos 32 caracteres (p. ej. openssl rand -base64 32).');
  } else {
    secreto = randomBytes(32);
    avisar(
      'AVISO: modo demo sin FHN_DEMO_SECRETO. La huella de las direcciones cambia en cada arranque, así que el cupo de ' +
        'entornos por dirección vuelve a cero al reiniciar. Define FHN_DEMO_SECRETO (al menos 32 caracteres).',
    );
  }
  return {
    horas: entero(env, 'FHN_DEMO_HORAS', 24, 1, 72),
    entornosPorIp: entero(env, 'FHN_DEMO_ENTORNOS_POR_IP', 3, 1, 100),
    maxEntornos: entero(env, 'FHN_DEMO_MAX_ENTORNOS', 200, 1, 100_000),
    creacionesPorMinuto: entero(env, 'FHN_DEMO_CREACIONES_POR_MINUTO', 10, 1, 10_000),
    documentos: entero(env, 'FHN_DEMO_DOCUMENTOS', 50, 1, 10_000),
    solicitudesPorMinuto: entero(env, 'FHN_DEMO_SOLICITUDES_POR_MINUTO', 30, 1, 10_000),
    solicitudesPorEntorno: entero(env, 'FHN_DEMO_SOLICITUDES_POR_ENTORNO', 1500, 1, 1_000_000),
    solicitudesPorMinutoGlobal: entero(env, 'FHN_DEMO_SOLICITUDES_POR_MINUTO_GLOBAL', 300, 1, 1_000_000),
    maxCuerpo: entero(env, 'FHN_DEMO_MAX_CUERPO', 32 * 1024, 1024, 512 * 1024),
    maxBytesPagina: entero(env, 'FHN_DEMO_MAX_BYTES_PAGINA', 256 * 1024, 16 * 1024, 8 * 1024 * 1024),
    pausado: env.FHN_DEMO_PAUSADO === '1',
    urlApi: url(env, 'FHN_DEMO_URL_API'),
    urlMcp: url(env, 'FHN_DEMO_URL_MCP'),
    origenes,
    secreto,
  };
}

/** Configuración del modo demo con los valores por defecto (para pruebas y para quien monta la app a mano). */
export function configDemo(cambios: Partial<ConfigDemo> = {}): ConfigDemo {
  return { ...leerConfigDemo({ FHN_DEMO_SECRETO: randomBytes(32).toString('base64') }), ...cambios };
}

/**
 * Huella de la dirección de quien crea un entorno: HMAC-SHA256 con `FHN_DEMO_SECRETO`, recortada a 128 bits. La
 * base guarda solo esto (no la dirección) y lo borra con el entorno.
 */
export const huellaOrigen = (secreto: Buffer, ip: string): string => createHmac('sha256', secreto).update(ip).digest('hex').slice(0, 32);

/** Ejemplos listos para copiar, con la llave, el punto de emisión y las URL del entorno. */
export function ejemplosDemo(o: { urlApi: string; llave: string; urlMcp: string | null }): { curl: string; sdk: string; mcp: string } {
  const cuerpo = JSON.stringify({
    establecimiento: '000',
    puntoEmision: '001',
    documento: { tipoDocumento: '01', lineas: [{ descripcion: 'Café molido 400 g', cantidad: 2, precioUnitario: '57.50' }] },
  });
  const curl = [
    `curl -sS -X POST ${o.urlApi}/v1/documentos \\`,
    `  -H "Authorization: Bearer ${o.llave}" \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "Idempotency-Key: venta-0001" \\',
    `  -d '${cuerpo}'`,
  ].join('\n');
  const sdk = [
    "import { crearCliente } from '@factura-hn/cliente';",
    '',
    `const api = crearCliente({ url: '${o.urlApi}', llave: '${o.llave}' });`,
    'const { documento } = await api.emitir(',
    "  { establecimiento: '000', puntoEmision: '001', documento: { tipoDocumento: '01', lineas: [{ descripcion: 'Café molido 400 g', cantidad: 2, precioUnitario: '57.50' }] } },",
    "  { idempotencyKey: 'venta-0001' },",
    ');',
    'console.log(documento.numero, documento.totales.total);',
  ].join('\n');
  const mcp = o.urlMcp
    ? [
        `URL del conector: ${o.urlMcp}`,
        '',
        'Claude (web o escritorio): Customize > Connectors > + > Add custom connector; pega la URL y deja la',
        'autenticación vacía. El conector queda también en la app móvil. ChatGPT: agrega un servidor MCP personalizado',
        'con la URL y sin autenticación. Después pide: «Emite una factura de prueba por 2 cafés de L 57.50».',
        'Guía completa: https://augustomelara-dev.github.io/factura-hn/ia/mcp-remoto/',
      ].join('\n')
    : 'Este servidor no tiene MCP remoto configurado. Con el MCP local: FHN_API_URL=' + o.urlApi + ' FHN_LLAVE=' + o.llave + ' npx -y @factura-hn/mcp';
  return { curl, sdk, mcp };
}
