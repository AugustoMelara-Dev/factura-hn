/**
 * Una API de verdad (el `arrancar` de producción, con su pool, sus migraciones y su rol `fhn_api`) escuchando en
 * un puerto local, y un tenant listo para emitir por HTTP en varias cajas. Para las pruebas de resiliencia.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { crearTenant } from '../../src/operador';
import { arrancar, type ServidorEnMarcha } from '../../src/servidor';
import { caiAleatorio, EMISOR, FECHA_LIMITE, nombreTenant } from '../ayuda';
import { puertoLibre } from './pg-temporal';

export interface ApiEnMarcha {
  url: string;
  servidor: ServidorEnMarcha;
  /** Pool del dueño de las tablas, para preparar y revisar (no lo usa la API). */
  dueno: pg.Pool;
  registros: string[];
  cerrar: () => Promise<void>;
}

/** Arranca la API como en producción: DATABASE_URL con el rol `fhn_api` y FHN_MIGRAR_URL con el dueño. */
export async function arrancarApi(urlDueno: string, env: Record<string, string> = {}): Promise<ApiEnMarcha> {
  const puerto = await puertoLibre();
  const u = new URL(urlDueno);
  const urlApi = `postgres://fhn_api@${u.host}${u.pathname}`;
  const registros: string[] = [];
  const original = { error: console.error, warn: console.warn, log: console.log };
  // El servidor escribe en la consola: se guarda para revisarlo y no ensucia la salida de la prueba.
  console.error = (...a: unknown[]) => void registros.push(a.map(String).join(' '));
  console.warn = console.error;
  console.log = console.error;
  const servidor = await arrancar({
    DATABASE_URL: urlApi,
    FHN_MIGRAR_URL: urlDueno,
    FHN_MODO: 'alojado',
    FHN_CLAVE_CIFRADO: randomBytes(32).toString('base64'),
    FHN_PROXIES_DE_CONFIANZA: '0',
    FHN_HOST: '127.0.0.1',
    PUERTO: String(puerto),
    ...env,
  });
  const dueno = new pg.Pool({ connectionString: urlDueno, max: 4 });
  dueno.on('error', () => undefined);
  return {
    url: `http://127.0.0.1:${puerto}`,
    servidor,
    dueno,
    registros,
    async cerrar() {
      await servidor.cerrar().catch(() => undefined);
      await dueno.end().catch(() => undefined);
      Object.assign(console, original);
    },
  };
}

export type Http = (metodo: string, ruta: string, cuerpo?: unknown, cabeceras?: Record<string, string>) => Promise<Response>;

export const http = (url: string, llave: string): Http => (metodo, ruta, cuerpo, cabeceras = {}) =>
  fetch(`${url}${ruta}`, {
    method: metodo,
    headers: { authorization: `Bearer ${llave}`, ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...cabeceras },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

/** Tenant con emisor, una autorización de factura por caja y una llave por caja. */
export async function tenantPorHttp(api: ApiEnMarcha, cajas: string[], rangoFinal = 1_000_000) {
  const tenant = nombreTenant('res');
  const { llaveAdmin } = await crearTenant(api.dueno, { tenant, nombre: tenant });
  const admin = http(api.url, llaveAdmin);
  const exigir = async (r: Response, estado: number, que: string) => {
    if (r.status !== estado) throw new Error(`${que}: ${r.status} ${await r.text()}`);
    return (await r.json()) as Record<string, any>;
  };
  await exigir(await admin('POST', '/v1/emisores', EMISOR), 201, 'emisor');
  const llaves: Record<string, string> = {};
  for (const punto of cajas) {
    await exigir(
      await admin('POST', '/v1/autorizaciones', {
        cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: punto,
        rangoInicial: 1, rangoFinal, fechaLimiteEmision: FECHA_LIMITE,
      }),
      201,
      'autorización',
    );
    llaves[punto] = (await exigir(await admin('POST', '/v1/llaves', { nombre: `caja ${punto}`, rol: 'caja', establecimiento: '000', puntoEmision: punto }), 201, 'llave')).secreto;
  }
  return { tenant, llaveAdmin, admin, llaves };
}

export const ventaCaja = (precio = '100.00') => ({ documento: { lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: precio }] } });

/** Lo que vio el cliente en cada intento de una emisión. */
export interface Intento {
  clave: string;
  estado: number | 'red';
  codigo?: string;
  numero?: string;
  repetida?: boolean;
  retryAfter?: string | null;
  instante: number;
}

/**
 * Emite una venta con su clave y reintenta con la MISMA clave mientras el error sea transitorio (red, 5xx o 429),
 * como se le pide a un POS. Devuelve el número emitido. `alIntentar` recibe cada intento.
 */
export async function emitirConReintentos(
  enviar: Http,
  alIntentar: (i: Intento) => void,
  o: { clave?: string; cuerpo?: unknown; limiteMs?: number; pausaMs?: number } = {},
): Promise<string> {
  const clave = o.clave ?? randomUUID();
  const limite = Date.now() + (o.limiteMs ?? 60_000);
  for (;;) {
    let intento: Intento;
    try {
      const r = await enviar('POST', '/v1/documentos', o.cuerpo ?? ventaCaja(), { 'idempotency-key': clave });
      const cuerpo = (await r.json().catch(() => ({}))) as Record<string, any>;
      intento = {
        clave, estado: r.status, codigo: cuerpo.error?.codigo, numero: cuerpo.documento?.numero,
        repetida: r.headers.get('idempotency-replayed') === 'true', retryAfter: r.headers.get('retry-after'), instante: Date.now(),
      };
    } catch {
      intento = { clave, estado: 'red', instante: Date.now() };
    }
    alIntentar(intento);
    if (intento.estado === 201) return intento.numero!;
    const transitorio = intento.estado === 'red' || intento.estado === 429 || (typeof intento.estado === 'number' && intento.estado >= 500);
    if (!transitorio) throw new Error(`Error no transitorio al emitir: ${intento.estado} ${intento.codigo}`);
    if (Date.now() > limite) throw new Error(`La emisión con la clave ${clave} no se recuperó a tiempo (último: ${intento.estado} ${intento.codigo}).`);
    await new Promise((r) => setTimeout(r, o.pausaMs ?? 150));
  }
}
