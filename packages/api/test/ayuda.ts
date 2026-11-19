import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { crearApp, type ConfigApi } from '../src/app';
import { migrarApi } from '../src/esquema';
import { crearTenant } from '../src/operador';

export const URL_PG = process.env.FHN_PG_URL;
export const ROL = 'fhn_app';

export const EMISOR = {
  rtn: '99990000000001',
  razonSocial: 'Ferretería Ejemplo S. de R.L.',
  nombreComercial: 'Ferretería Ejemplo',
  direccionCasaMatriz: 'Tegucigalpa, M.D.C.',
  direccionEstablecimiento: 'Tegucigalpa, M.D.C.',
  telefono: '0000-0003',
  correo: 'ventas@ejemplo.example',
};

const hex = (n: number) => randomBytes(n).toString('hex').toUpperCase();
export const caiAleatorio = () => `${hex(3)}-${hex(3)}-${hex(3)}-${hex(3)}-${hex(3)}-${hex(1)}`;
export const nombreTenant = (p = 't') => `${p}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

let pool: pg.Pool | null = null;
export async function poolPrueba(): Promise<pg.Pool> {
  if (!pool) {
    pool = new pg.Pool({ connectionString: URL_PG, max: 30 });
    await migrarApi(pool, ROL);
  }
  return pool;
}
export async function cerrarPool(): Promise<void> {
  await pool?.end();
  pool = null;
}

export type Cliente = (metodo: string, ruta: string, cuerpo?: unknown, cabeceras?: Record<string, string>) => Promise<Response>;

export function cliente(app: ReturnType<typeof crearApp>, llave: string | null): Cliente {
  return async (metodo, ruta, cuerpo, cabeceras = {}) =>
    app.request(ruta, {
      method: metodo,
      headers: {
        ...(llave ? { authorization: `Bearer ${llave}` } : {}),
        ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
        ...cabeceras,
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
}

/** Tenant listo para emitir: emisor y autorizaciones de factura y NC en las cajas indicadas. */
export async function tenantListo(
  config: Partial<ConfigApi> = {},
  o: { cajas?: string[]; limiteMensual?: number | null; rangoFinal?: number } = {},
) {
  const p = await poolPrueba();
  const tenant = nombreTenant();
  const { llaveAdmin } = await crearTenant(p, { tenant, nombre: tenant, limiteMensual: o.limiteMensual ?? null });
  const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, ...config });
  const admin = cliente(app, llaveAdmin);
  const r = await admin('POST', '/v1/emisores', EMISOR);
  if (r.status !== 201) throw new Error(`emisor: ${r.status} ${await r.text()}`);
  const { emisor } = (await r.json()) as { emisor: { id: string } };
  for (const punto of o.cajas ?? ['001']) {
    for (const tipoDocumento of ['01', '06'] as const) {
      const a = await admin('POST', '/v1/autorizaciones', {
        cai: caiAleatorio(), tipoDocumento, establecimiento: '000', puntoEmision: punto,
        rangoInicial: 1, rangoFinal: o.rangoFinal ?? 1000, fechaLimiteEmision: '2027-10-31',
      });
      if (a.status !== 201) throw new Error(`autorización: ${a.status} ${await a.text()}`);
    }
  }
  return { app, tenant, admin, llaveAdmin, emisorId: emisor.id, pool: p };
}

export const venta = (precio = '100.00', extra: Record<string, unknown> = {}) => ({
  establecimiento: '000',
  puntoEmision: '001',
  documento: { lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: precio }] },
  ...extra,
});

export async function crearCaja(admin: Cliente, punto: string | null, rol: 'caja' | 'admin' = 'caja'): Promise<string> {
  const r = await admin('POST', '/v1/llaves', { nombre: `caja ${punto}`, rol, ...(punto ? { establecimiento: '000', puntoEmision: punto } : {}) });
  if (r.status !== 201) throw new Error(`llave: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { secreto: string }).secreto;
}
