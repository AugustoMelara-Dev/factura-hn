/**
 * Ayudas de las pruebas OWASP API Security Top 10 (2023): un tenant con un recurso de cada tipo y el catálogo de
 * todas las operaciones de la API con una solicitud de ejemplo para cada una.
 *
 * El catálogo es la fuente de las pruebas que recorren todas las operaciones (API1, API2, API5 y API9). La prueba de
 * inventario (API9) falla si la especificación tiene una operación que no está aquí: una ruta nueva no queda sin
 * probar por olvido.
 */
import { randomUUID } from 'node:crypto';
import { describe } from 'vitest';
import type pg from 'pg';
import { leerLlave } from '../../src/llaves';
import { caiAleatorio, crearCaja, fechaEn, FECHA_LIMITE, poolPrueba, tenantListo, URL_PG, venta, type Cliente } from '../ayuda';

// Sin FHN_PG_URL se omiten, como las demás pruebas con base.
export const conBase: typeof describe = describe.skipIf(!URL_PG) as typeof describe;
export const json = async (r: Response) => (await r.json()) as Record<string, any>;
export const emitir = (c: Cliente, cuerpo: unknown, clave: string = randomUUID(), cabeceras: Record<string, string> = {}) =>
  c('POST', '/v1/documentos', cuerpo, { 'idempotency-key': clave, ...cabeceras });

/** Un período que contiene hoy en Honduras (UTC-6) aunque el reloj de la prueba esté en UTC. */
export const PERIODO = `desde=${fechaEn(-30)}&hasta=${fechaEn(1)}`;

/** Un tenant con un recurso de cada tipo: emisor, CAI, documento, llave de caja, webhook y una entrega. */
export async function tenantConRecursos(o: { cajas?: string[] } = {}) {
  const t = await tenantListo({}, { cajas: o.cajas ?? ['001', '002'] });
  const urlHook = `http://127.0.0.1:9/owasp-${randomUUID()}`;
  const w = await json(await t.admin('POST', '/v1/webhooks', { url: urlHook, eventos: ['documento.emitido', 'documento.anulado'] }));
  const doc = (await json(await emitir(t.admin, venta('100.00', { documento: { cliente: { nombre: `Cliente de ${t.tenant}` }, lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }] } })))).documento;
  const caja = await crearCaja(t.admin, '001');
  const caja2 = await crearCaja(t.admin, '002');
  const prefijoCaja = leerLlave(caja)!.prefijo;
  const entregas = await json(await t.admin('GET', `/v1/webhooks/${w.webhook.id}/entregas`));
  const cai = (await json(await t.admin('GET', '/v1/autorizaciones'))).autorizaciones[0].cai as string;
  return {
    ...t,
    pool: await poolPrueba(),
    caja,
    caja2,
    prefijoCaja,
    numero: doc.numero as string,
    webhookId: w.webhook.id as string,
    secretoWebhook: w.secreto as string,
    entregaId: entregas.entregas[0].id as string,
    cai,
  };
}
export type TenantConRecursos = Awaited<ReturnType<typeof tenantConRecursos>>;

export interface Operacion {
  operationId: string;
  metodo: string;
  /** Ruta de la especificación, con `{param}`. */
  plantilla: string;
  /** Ruta con los ids del tenant de la prueba. */
  ruta: string;
  cuerpo?: unknown;
  cabeceras?: Record<string, string>;
  /** Solo una llave admin la puede usar (403 `SOLO_ADMIN` con una de caja). */
  soloAdmin: boolean;
}

/** Todas las operaciones autenticadas de la API (todas menos `obtenerSalud`), con los ids de `r`. */
export function operaciones(r: Pick<TenantConRecursos, 'emisorId' | 'numero' | 'cai' | 'webhookId' | 'entregaId' | 'prefijoCaja'>): Operacion[] {
  const op = (operationId: string, metodo: string, plantilla: string, ruta: string, soloAdmin: boolean, extra: Partial<Operacion> = {}): Operacion => ({
    operationId, metodo, plantilla, ruta, soloAdmin, ...extra,
  });
  const serie = r.numero.slice(0, 10);
  return [
    op('crearEmisor', 'POST', '/v1/emisores', '/v1/emisores', true, { cuerpo: { rtn: '99990000000009', razonSocial: 'Otra S. A.', nombreComercial: 'Otra', direccionCasaMatriz: 'Tegucigalpa', direccionEstablecimiento: 'Tegucigalpa', telefono: '0000-0000', correo: 'otra@ejemplo.example' } }),
    op('listarEmisores', 'GET', '/v1/emisores', '/v1/emisores', false),
    op('obtenerEmisor', 'GET', '/v1/emisores/{id}', `/v1/emisores/${r.emisorId}`, false),
    op('actualizarEmisor', 'PATCH', '/v1/emisores/{id}', `/v1/emisores/${r.emisorId}`, true, { cuerpo: { telefono: '0000-9999' } }),
    op('registrarAutorizacion', 'POST', '/v1/autorizaciones', '/v1/autorizaciones', true, {
      cuerpo: { cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '009', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: FECHA_LIMITE },
    }),
    op('listarAutorizaciones', 'GET', '/v1/autorizaciones', '/v1/autorizaciones', false),
    op('obtenerEstadoAutorizacion', 'GET', '/v1/autorizaciones/{cai}/estado', `/v1/autorizaciones/${r.cai}/estado`, false),
    op('obtenerSesion', 'GET', '/v1/sesion', '/v1/sesion', false),
    op('emitirDocumento', 'POST', '/v1/documentos', '/v1/documentos', false, { cuerpo: venta(), cabeceras: { 'idempotency-key': randomUUID() } }),
    op('listarDocumentos', 'GET', '/v1/documentos', `/v1/documentos?${PERIODO}`, false),
    op('obtenerDocumento', 'GET', '/v1/documentos/{archivo}', `/v1/documentos/${r.numero}`, false),
    op('anularDocumento', 'POST', '/v1/documentos/{numero}/anular', `/v1/documentos/${r.numero}/anular`, true, { cuerpo: { motivo: 'Prueba OWASP' } }),
    op('corregirFechaSerie', 'POST', '/v1/series/{identificador}/corregir-fecha', `/v1/series/${serie}/corregir-fecha`, true, { cuerpo: { motivo: 'Prueba OWASP' } }),
    op('listarNoUtilizados', 'GET', '/v1/series/{identificador}/no-utilizados', `/v1/series/${serie}/no-utilizados`, true),
    op('obtenerLibroVentas', 'GET', '/v1/libro-ventas', `/v1/libro-ventas?${PERIODO}`, false),
    op('exportarPeriodo', 'GET', '/v1/exportacion', `/v1/exportacion?${PERIODO}`, true),
    op('listarBitacora', 'GET', '/v1/bitacora', '/v1/bitacora', true),
    op('crearLlave', 'POST', '/v1/llaves', '/v1/llaves', true, { cuerpo: { nombre: 'Intrusa', rol: 'admin' } }),
    op('listarLlaves', 'GET', '/v1/llaves', '/v1/llaves', true),
    op('revocarLlave', 'DELETE', '/v1/llaves/{prefijo}', `/v1/llaves/${r.prefijoCaja}`, true),
    op('crearWebhook', 'POST', '/v1/webhooks', '/v1/webhooks', true, { cuerpo: { url: 'http://127.0.0.1:9/intruso', eventos: ['documento.emitido'] } }),
    op('listarWebhooks', 'GET', '/v1/webhooks', '/v1/webhooks', true),
    op('desactivarWebhook', 'DELETE', '/v1/webhooks/{id}', `/v1/webhooks/${r.webhookId}`, true),
    op('listarEntregasWebhook', 'GET', '/v1/webhooks/{id}/entregas', `/v1/webhooks/${r.webhookId}/entregas`, true),
    op('reenviarEntregaWebhook', 'POST', '/v1/webhooks/{id}/entregas/{entrega}/reenviar', `/v1/webhooks/${r.webhookId}/entregas/${r.entregaId}/reenviar`, true),
    op('probarWebhook', 'POST', '/v1/webhooks/{id}/probar', `/v1/webhooks/${r.webhookId}/probar`, true),
    op('rotarSecretoWebhook', 'POST', '/v1/webhooks/{id}/rotar-secreto', `/v1/webhooks/${r.webhookId}/rotar-secreto`, true, { cuerpo: { graciaHoras: 0 } }),
  ];
}

/** Ejecuta una operación del catálogo con el cliente dado. */
export const ejecutar = (c: Cliente, o: Operacion) => c(o.metodo, o.ruta, o.cuerpo, o.cabeceras);

/**
 * Lo que un atacante podría haber cambiado en el tenant: se toma antes y después de cada ataque y debe ser igual.
 * Se lee con la llave admin del propio tenant.
 */
export async function huella(t: TenantConRecursos) {
  const a = t.admin;
  const doc = (await json(await a('GET', `/v1/documentos/${t.numero}`))).documento;
  const emisor = (await json(await a('GET', '/v1/emisores'))).emisores;
  const llaves = (await json(await a('GET', '/v1/llaves'))).llaves.map((l: Record<string, unknown>) => `${l.prefijo}:${l.rol}:${l.revocada}`);
  const webhooks = (await json(await a('GET', '/v1/webhooks'))).webhooks.map((w: Record<string, unknown>) => `${w.id}:${w.activo}:${w.graciaHasta}`);
  const entregas = (await json(await a('GET', `/v1/webhooks/${t.webhookId}/entregas`))).entregas.map((e: Record<string, unknown>) => `${e.id}:${e.estado}:${e.intentos}`);
  const autorizaciones = (await json(await a('GET', '/v1/autorizaciones'))).autorizaciones.map((x: Record<string, unknown>) => x.cai);
  const documentos = (await json(await a('GET', `/v1/documentos?${PERIODO}`))).documentos.map((d: Record<string, unknown>) => `${d.numero}:${d.estado}`);
  const secreto = await comoDueno(t.pool, t.tenant, 'SELECT secreto FROM api_webhooks WHERE id = $1', [t.webhookId]);
  return { estado: doc.estado, emisor, llaves, webhooks, entregas, autorizaciones, documentos, secreto: secreto.rows[0]?.secreto };
}

/** Una consulta como el dueño de las tablas, con el tenant fijado (las tablas `api_*` fuerzan RLS también al dueño). */
export async function comoDueno<T extends pg.QueryResultRow = Record<string, unknown>>(pool: pg.Pool, tenant: string, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
    const r = await c.query<T>(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/** Los nombres de las cabeceras de una respuesta (en minúsculas). */
export function nombresCabeceras(r: Response): string[] {
  const nombres: string[] = [];
  r.headers.forEach((_, k) => nombres.push(k));
  return nombres;
}
