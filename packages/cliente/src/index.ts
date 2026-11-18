/**
 * @factura-hn/cliente: cliente tipado de la API REST de factura-hn.
 *
 * Los tipos se generan desde `packages/api/openapi.json` con openapi-typescript (`pnpm generar`); una prueba
 * falla si quedan desactualizados. `cliente.api` da acceso tipado a todas las rutas; los métodos de
 * conveniencia lanzan `ErrorFacturaHN` con los `errores` fiscales tal como los devuelve la API.
 *
 * @example
 * const fhn = crearCliente({ url: 'http://127.0.0.1:8787', llave: process.env.FHN_LLAVE! });
 * const { documento } = await fhn.emitir(
 *   { documento: { lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '57.50' }], preciosIncluyenISV: true } },
 *   { idempotencyKey: venta.id },
 * );
 * const pdf = await fhn.descargar(documento.numero, 'pdf');
 */
import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './esquema';

export type { components, paths } from './esquema';
type Esquemas = components['schemas'];
export type DocumentoFiscal = Esquemas['DocumentoFiscal'];
export type DocumentoEntrada = Esquemas['DocumentoEntrada'];
export type SolicitudEmision = Esquemas['SolicitudEmision'];
export type Autorizacion = Esquemas['Autorizacion'];
export type EstadoAutorizacion = Esquemas['EstadoAutorizacion'];
export type Emisor = Esquemas['Emisor'];
export type Problema = Esquemas['Problema'];

export interface OpcionesCliente {
  /** URL base, p. ej. `http://127.0.0.1:8787`. */
  url: string;
  /** Llave de API `fhn_<prefijo>_<secreto>`. Nunca la pongas en código que llega al navegador. */
  llave: string;
  fetch?: typeof fetch;
}

/** Error de la API con su estado HTTP, código y, en 422, la lista de errores fiscales. */
export class ErrorFacturaHN extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly errores: Problema[] = [],
    public readonly advertencias: Problema[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorFacturaHN';
  }
}

interface Resultado<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function exigir<T>(r: Resultado<T>): T {
  if (r.error !== undefined || !r.response.ok) {
    const e = (r.error ?? {}) as { error?: { codigo?: string; mensaje?: string }; errores?: Problema[]; advertencias?: Problema[] };
    throw new ErrorFacturaHN(
      r.response.status,
      e.error?.codigo ?? `HTTP_${r.response.status}`,
      e.error?.mensaje ?? r.response.statusText,
      e.errores ?? [],
      e.advertencias ?? [],
    );
  }
  return r.data as T;
}

const enc = encodeURIComponent;

export function crearCliente(o: OpcionesCliente) {
  const api: Client<paths> = createClient<paths>({
    baseUrl: o.url.replace(/\/+$/, ''),
    headers: { authorization: `Bearer ${o.llave}` },
    fetch: o.fetch,
  });
  const archivo = async (ruta: string, tipo: 'pdf' | 'html' | 'txt' | 'csv' | 'jsonl') => {
    const resp = await (o.fetch ?? fetch)(`${o.url.replace(/\/+$/, '')}${ruta}`, { headers: { authorization: `Bearer ${o.llave}` } });
    if (!resp.ok) {
      const e = (await resp.json().catch(() => ({}))) as { error?: { codigo?: string; mensaje?: string } };
      throw new ErrorFacturaHN(resp.status, e.error?.codigo ?? `HTTP_${resp.status}`, e.error?.mensaje ?? resp.statusText);
    }
    return tipo === 'pdf' ? new Uint8Array(await resp.arrayBuffer()) : await resp.text();
  };

  return {
    /** Cliente tipado para cualquier ruta de la API. */
    api,

    /**
     * Emite una factura, NC o ND. `idempotencyKey` debe ser estable por venta (p. ej. el id de la venta en
     * tu POS): si la red falla, reintenta con la misma clave y obtendrás el mismo documento.
     */
    async emitir(cuerpo: SolicitudEmision, opciones: { idempotencyKey: string }) {
      const r = await api.POST('/v1/documentos', { body: cuerpo, params: { header: { 'idempotency-key': opciones.idempotencyKey } } });
      return { ...exigir(r), repetida: r.response.headers.get('idempotency-replayed') === 'true' };
    },
    async documento(numero: string): Promise<DocumentoFiscal> {
      return (exigir(await api.GET('/v1/documentos/{archivo}', { params: { path: { archivo: numero }, query: {} } })) as { documento: DocumentoFiscal }).documento;
    },
    /** Representación impresa: PDF (bytes), HTML o texto térmico. Idéntica al original (Art. 38). */
    async descargar<F extends 'pdf' | 'html' | 'txt'>(
      numero: string,
      formato: F,
      opciones: { papel?: 'carta' | 'ticket' } = {},
    ): Promise<F extends 'pdf' ? Uint8Array : string> {
      const q = formato === 'pdf' && opciones.papel ? `?formato=${opciones.papel}` : '';
      return (await archivo(`/v1/documentos/${enc(numero)}.${formato}${q}`, formato)) as F extends 'pdf' ? Uint8Array : string;
    },
    async anular(numero: string, motivo: string): Promise<DocumentoFiscal> {
      return exigir(await api.POST('/v1/documentos/{numero}/anular', { params: { path: { numero } }, body: { motivo } })).documento;
    },
    async documentos(desde: string, hasta: string): Promise<DocumentoFiscal[]> {
      return exigir(await api.GET('/v1/documentos', { params: { query: { desde, hasta } } })).documentos;
    },
    async registrarAutorizacion(a: Autorizacion): Promise<Autorizacion> {
      return exigir(await api.POST('/v1/autorizaciones', { body: a })).autorizacion;
    },
    async autorizaciones(): Promise<Autorizacion[]> {
      return exigir(await api.GET('/v1/autorizaciones')).autorizaciones;
    },
    async estadoAutorizacion(cai: string): Promise<EstadoAutorizacion> {
      return exigir(await api.GET('/v1/autorizaciones/{cai}/estado', { params: { path: { cai } } }));
    },
    async libroVentas(desde: string, hasta: string) {
      return exigir(await api.GET('/v1/libro-ventas', { params: { query: { desde, hasta, formato: 'json' } } })) as {
        filas: Record<string, unknown>[];
        resumen: Record<string, unknown>;
      };
    },
    async libroVentasCSV(desde: string, hasta: string): Promise<string> {
      return archivo(`/v1/libro-ventas?desde=${enc(desde)}&hasta=${enc(hasta)}&formato=csv`, 'csv') as Promise<string>;
    },
    /** Archivo de texto del período para el SAR (Art. 53 num. 5). Requiere llave admin. */
    async exportacion(desde: string, hasta: string, formato: 'jsonl' | 'csv' | 'txt' = 'jsonl'): Promise<string> {
      return archivo(`/v1/exportacion?desde=${enc(desde)}&hasta=${enc(hasta)}&formato=${formato}`, formato === 'txt' ? 'txt' : formato) as Promise<string>;
    },
  };
}

export type ClienteFacturaHN = ReturnType<typeof crearCliente>;

export { verificarFirmaWebhook } from './webhooks';
export type { AvisoWebhook } from './webhooks';
