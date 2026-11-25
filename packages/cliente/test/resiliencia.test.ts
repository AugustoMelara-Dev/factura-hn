/**
 * El cliente a través de cortes. `@factura-hn/cliente` NO reintenta solo (DEC-RES-003): lanza el error y el
 * integrador reintenta `emitir` con la misma `idempotencyKey`. Estas pruebas fijan lo que el integrador ve en
 * cada corte y que ese reintento da un solo documento:
 * - la respuesta se pierde después de que la API emitió (corte de red a la vuelta): el reintento devuelve el
 *   mismo documento, marcado `repetida`;
 * - la API no se alcanza (corte de red a la ida): el error es el de `fetch`, no un `ErrorFacturaHN`;
 * - PostgreSQL se reinicia (solo con `pnpm resiliencia`): `ErrorFacturaHN` 503 `BASE_NO_DISPONIBLE`, con su
 *   solución, y el reintento emite una vez.
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp, crearTenant, migrarApi } from '@factura-hn/api';
import { crearPool } from '../../api/src/pool';
import { problemasDeIntegridad, revisarIntegridad } from '../../api/carga/integridad';
import { crearCliente, ErrorFacturaHN } from '../src';

const URL_PG = process.env.FHN_PG_URL;
const REINICIABLE = process.env.FHN_PG_REINICIABLE === '1' && !!URL_PG;

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Ejemplo', nombreComercial: 'Ejemplo', direccionCasaMatriz: 'Tegucigalpa',
  direccionEstablecimiento: 'Tegucigalpa', telefono: '0000-0003', correo: 'a@ejemplo.example',
};
const venta = { establecimiento: '000', puntoEmision: '001', documento: { lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '57.50' }] } };
const fechaLimite = () => new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
const caiAleatorio = () => {
  const h = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${h(3)}-${h(3)}-${h(3)}-${h(3)}-${h(3)}-${h(1)}`;
};

/** Reintenta como se le pide a un integrador: misma clave, solo ante errores transitorios. */
async function emitirReintentando(fhn: ReturnType<typeof crearCliente>, clave: string, vistos: unknown[], limiteMs = 30_000) {
  const limite = Date.now() + limiteMs;
  for (;;) {
    try {
      return await fhn.emitir(venta, { idempotencyKey: clave });
    } catch (e) {
      vistos.push(e);
      const transitorio = !(e instanceof ErrorFacturaHN) || e.estado >= 500 || e.estado === 429;
      if (!transitorio || Date.now() > limite) throw e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

describe.skipIf(!URL_PG)('el cliente a través de cortes', () => {
  const pool = crearPool(URL_PG!, 10, () => undefined);
  afterAll(() => pool.end());

  async function preparar() {
    await migrarApi(pool);
    const tenant = `cli-res-${randomUUID().slice(0, 8)}`;
    const { llaveAdmin } = await crearTenant(pool, { tenant, nombre: tenant });
    const app = crearApp({ pool, modo: 'local', registrar: () => undefined });
    const directo = ((e: RequestInfo | URL, init?: RequestInit) => app.fetch(e instanceof Request ? e : new Request(e, init))) as typeof fetch;
    const fhn = crearCliente({ url: 'http://api.local', llave: llaveAdmin, fetch: directo });
    await fhn.api.POST('/v1/emisores', { body: EMISOR });
    await fhn.registrarAutorizacion({ cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 1000, fechaLimiteEmision: fechaLimite() });
    return { tenant, llaveAdmin, directo, fhn };
  }

  it('la respuesta se pierde después de emitir: el reintento con la misma clave da el mismo documento', async () => {
    const { tenant, llaveAdmin, directo } = await preparar();
    // Las dos primeras respuestas de emisión se pierden en la red: la API emitió, el cliente no lo supo.
    let perdidas = 0;
    const cortaLaVuelta = (async (e: RequestInfo | URL, init?: RequestInit) => {
      const r = await directo(e, init);
      const req = e instanceof Request ? e : new Request(e, init);
      if (req.method === 'POST' && new URL(req.url).pathname === '/v1/documentos' && perdidas < 2) {
        perdidas++;
        await r.body?.cancel();
        throw new TypeError('fetch failed');
      }
      return r;
    }) as typeof fetch;
    const fhn = crearCliente({ url: 'http://api.local', llave: llaveAdmin, fetch: cortaLaVuelta });
    const vistos: unknown[] = [];
    const r = await emitirReintentando(fhn, 'venta-respuesta-perdida', vistos);
    expect(vistos).toHaveLength(2);
    expect(vistos.every((e) => e instanceof TypeError)).toBe(true);
    expect(r.repetida).toBe(true);
    expect(r.documento.numero).toBe('000-001-01-00000001');
    // La venta siguiente toma el número siguiente: los cortes no consumieron números.
    expect((await fhn.emitir(venta, { idempotencyKey: 'venta-siguiente' })).documento.numero).toBe('000-001-01-00000002');
    const integridad = await revisarIntegridad(pool, tenant);
    expect(problemasDeIntegridad(integridad)).toEqual([]);
    expect(integridad.documentos).toBe(2);
  });

  it('la API no se alcanza: el cliente no reintenta y lanza el error de red, no un ErrorFacturaHN', async () => {
    const { llaveAdmin } = await preparar();
    let llamadas = 0;
    const sinRed = (async () => {
      llamadas++;
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) });
    }) as typeof fetch;
    const fhn = crearCliente({ url: 'http://api.local', llave: llaveAdmin, fetch: sinRed });
    const e = await fhn.emitir(venta, { idempotencyKey: 'venta-sin-red' }).catch((x) => x);
    expect(e).toBeInstanceOf(TypeError);
    expect(e).not.toBeInstanceOf(ErrorFacturaHN);
    expect(llamadas).toBe(1);
  });

  it.skipIf(!REINICIABLE)('PostgreSQL se reinicia: ErrorFacturaHN 503 BASE_NO_DISPONIBLE con su solución y, al reintentar, un solo documento', async () => {
    const { tenant, fhn } = await preparar();
    await fhn.emitir(venta, { idempotencyKey: 'antes' });
    await pgTemporal('detener', 'fast');
    let e: unknown;
    try {
      e = await fhn.emitir(venta, { idempotencyKey: 'durante' }).catch((x) => x);
    } finally {
      await pgTemporal('arrancar');
    }
    expect(e).toBeInstanceOf(ErrorFacturaHN);
    expect(e).toMatchObject({ estado: 503, codigo: 'BASE_NO_DISPONIBLE' });
    expect((e as ErrorFacturaHN).solucion).toMatch(/misma Idempotency-Key/);
    expect((e as ErrorFacturaHN).documentacion).toMatch(/#base_no_disponible$/);
    const vistos: unknown[] = [];
    const r = await emitirReintentando(fhn, 'durante', vistos);
    expect(r.documento.numero).toBe('000-001-01-00000002');
    const integridad = await revisarIntegridad(pool, tenant);
    expect(problemasDeIntegridad(integridad)).toEqual([]);
    expect(integridad.documentos).toBe(2);
  });
});

const SCRIPT = fileURLToPath(new URL('../../../scripts/pg-temporal.mjs', import.meta.url));
function pgTemporal(...args: string[]): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (salida += d));
    p.once('error', rechazar);
    p.once('close', (c) => (c === 0 ? resolver() : rechazar(new Error(`pg-temporal ${args.join(' ')}: ${salida}`))));
  });
}
