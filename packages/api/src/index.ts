/**
 * @factura-hn/api: API REST de factura-hn para montar en tu propio servidor.
 *
 * @example
 * import pg from 'pg';
 * import { crearApp, migrarApi } from '@factura-hn/api';
 * const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 * await migrarApi(pool); // o, si migra otro proceso: await exigirEsquemaApi(pool);
 * const app = crearApp({ pool, modo: 'local' });
 */
export { crearApp, VERSION_API } from './app';
export type { ConfigApi, Sesion } from './app';
export { exigirEsquemaApi, migrarApi, ESQUEMA_API, ROL_POR_DEFECTO, VERSION_ESQUEMA_API } from './esquema';
export { ErrorApi, LimitadorSolicitudes } from './errores';
export { generarLlave, prefijoDe } from './llaves';
export type { RolLlave } from './llaves';
export { crearTenant, crearLlaveOperador, crearLlaveDemo, iniciarLocal, TENANT_LOCAL, TENANT_DEMO, CAI_DEMO } from './operador';
export {
  CofreSecretos,
  despacharWebhooks,
  verificarFirmaWebhook,
  firmar,
  problemaDeURL,
  esperaReintento,
  esperaBase,
  leerFirma,
  EVENTOS_WEBHOOK,
  MAX_INTENTOS,
} from './webhooks';
export type { EventoEntrega, EventoWebhook } from './webhooks';
