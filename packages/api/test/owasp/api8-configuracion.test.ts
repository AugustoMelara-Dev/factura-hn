/**
 * OWASP API8:2023 · Security Misconfiguration.
 *
 * Cómo aplica: cabeceras de seguridad en toda respuesta, sin CORS (la llave va solo en el servidor del integrador),
 * errores sin detalles internos, representación HTML y `/docs` con CSP, y un arranque que falla cerrado ante una
 * configuración peligrosa (DEC-035, DEC-054, DEC-057).
 *
 * Ataque: recorrer respuestas de todo tipo buscando cabeceras que falten o sobren; una solicitud previa de CORS desde
 * otro origen; un error interno con datos sensibles en el mensaje; cabeceras inyectadas; variables de entorno mal
 * escritas.
 */
import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { arrancar } from '../../src/servidor';
import { cerrarPool, cliente, ROL, tenantListo, venta } from '../ayuda';
import { conBase, emitir, json, nombresCabeceras, PERIODO } from './comun';

afterAll(cerrarPool);

const COMUNES = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

/** Un pool que falla con un mensaje lleno de secretos, como un error real del controlador de Postgres. */
const poolRoto = {
  options: { max: 4 },
  query: async () => {
    throw new Error('connect ECONNREFUSED postgres://fhn_api:contraseña-secreta@db-interna:5432/factura_hn');
  },
} as unknown as pg.Pool;

describe('API8 · configuración (sin base)', () => {
  it('un error interno responde 500 genérico, con id de solicitud y sin el mensaje, la pila ni la conexión', async () => {
    const registros: unknown[] = [];
    const app = crearApp({ pool: poolRoto, modo: 'alojado', rol: ROL, registrar: (m, e) => registros.push(m, e) });
    const r = await app.request('/salud');
    expect(r.status).toBe(500);
    const texto = await r.text();
    expect(JSON.parse(texto).error).toMatchObject({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno. Se registró para revisión.' });
    for (const s of ['contraseña', 'db-interna', 'ECONNREFUSED', 'postgres://', ' at ', '.ts:']) expect(texto).not.toContain(s);
    // El detalle va al log del servidor, con el id de la solicitud.
    expect(String(registros[0])).toContain(r.headers.get('solicitud-id')!);
  });

  it('arranque fail-closed: FHN_MODO mal escrito, modo alojado sin clave de cifrado y retención no numérica no arrancan', async () => {
    const base = { DATABASE_URL: 'postgres://nadie@127.0.0.1:1/nada' };
    await expect(arrancar({ ...base, FHN_MODO: 'Alojado' })).rejects.toThrow(/FHN_MODO/);
    await expect(arrancar({ ...base, FHN_MODO: 'produccion' })).rejects.toThrow(/FHN_MODO/);
    await expect(arrancar({ ...base, FHN_MODO: 'alojado' })).rejects.toThrow(/FHN_CLAVE_CIFRADO/);
    await expect(arrancar({ ...base, FHN_MODO: 'alojado', FHN_CLAVE_CIFRADO: Buffer.alloc(16).toString('base64') })).rejects.toThrow(/32 bytes/);
    await expect(arrancar({ ...base, FHN_MODO: 'local', FHN_RETENCION_DIAS: '30d' })).rejects.toThrow(/FHN_RETENCION_DIAS/);
    await expect(arrancar({})).rejects.toThrow(/DATABASE_URL/);
  });
});

conBase('API8 · configuración', () => {
  it('cabeceras de seguridad en toda respuesta (éxito, error, 401, 404, transmitida, impresa, pública) y ninguna que revele la plataforma', async () => {
    const t = await tenantListo();
    const n = (await json(await emitir(t.admin, venta()))).documento.numero;
    const anonimo = cliente(t.app, null);
    const respuestas: [string, Response][] = [
      ['200 JSON', await t.admin('GET', '/v1/sesion')],
      ['201', await emitir(t.admin, venta())],
      ['400', await t.admin('GET', '/v1/documentos?desde=x')],
      ['401', await anonimo('GET', '/v1/sesion')],
      ['403', await cliente(t.app, (await json(await t.admin('POST', '/v1/llaves', { nombre: 'c', rol: 'caja', establecimiento: '000', puntoEmision: '001' }))).secreto)('GET', '/v1/llaves')],
      ['404 ruta', await anonimo('GET', '/no-existe')],
      ['404 /v2', await t.admin('GET', '/v2/documentos')],
      ['422', await emitir(t.admin, venta('-1'))],
      ['transmitida', await t.admin('GET', `/v1/libro-ventas?${PERIODO}&formato=csv`)],
      ['pdf', await t.admin('GET', `/v1/documentos/${n}.pdf`)],
      ['html', await t.admin('GET', `/v1/documentos/${n}.html`)],
      ['txt', await t.admin('GET', `/v1/documentos/${n}.txt`)],
      ['/salud', await anonimo('GET', '/salud')],
      ['/openapi.json', await anonimo('GET', '/openapi.json')],
      ['/docs', await anonimo('GET', '/docs')],
      ['/', await anonimo('GET', '/')],
    ];
    for (const [nombre, r] of respuestas) {
      for (const [k, v] of Object.entries(COMUNES)) expect(r.headers.get(k), `${nombre} ${k}`).toBe(v);
      expect(r.headers.get('solicitud-id'), nombre).toBeTruthy();
      expect(r.headers.get('facturahn-version'), nombre).toBeTruthy();
      for (const k of ['x-powered-by', 'server', 'access-control-allow-origin', 'access-control-allow-credentials']) expect(r.headers.get(k), `${nombre} ${k}`).toBeNull();
      await r.arrayBuffer();
    }
    expect(respuestas.find(([x]) => x === 'html')![1].headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    const docs = respuestas.find(([x]) => x === '/docs')![1];
    expect(docs.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(docs.headers.get('x-frame-options')).toBe('DENY');
  });

  it('sin CORS: una solicitud previa desde otro origen no recibe permiso, con o sin llave', async () => {
    const t = await tenantListo();
    const origen = { origin: 'https://atacante.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' };
    for (const c of [cliente(t.app, null), t.admin]) {
      for (const ruta of ['/v1/documentos', '/v1/sesion', '/salud', '/openapi.json']) {
        const r = await c('OPTIONS', ruta, undefined, origen);
        expect(r.status, ruta).toBeGreaterThanOrEqual(400);
        expect(nombresCabeceras(r).filter((k) => k.startsWith('access-control-')), ruta).toEqual([]);
      }
    }
    const conOrigen = await t.admin('GET', '/v1/sesion', undefined, { origin: 'https://atacante.example' });
    expect(conOrigen.status).toBe(200);
    expect(conOrigen.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('cabeceras de entrada que no se respetan: Solicitud-Id con saltos de línea, X-HTTP-Method-Override, X-Operador con control', async () => {
    const t = await tenantListo();
    const caja = (await json(await t.admin('POST', '/v1/llaves', { nombre: 'c', rol: 'caja', establecimiento: '000', puntoEmision: '001' }))).llave;
    for (const id of ['a\tb', 'x'.repeat(129), '-empieza-con-guion', 'con espacio']) {
      const r = await t.admin('GET', '/v1/sesion', undefined, { 'solicitud-id': id });
      expect(r.headers.get('solicitud-id'), id).toMatch(/^[0-9a-f-]{36}$/);
    }
    // Un POST con «X-HTTP-Method-Override: DELETE» no revoca nada.
    const override = await t.admin('POST', `/v1/llaves/${caja.prefijo}`, undefined, { 'x-http-method-override': 'DELETE' });
    expect(override.status).toBe(404);
    expect((await json(await t.admin('GET', '/v1/llaves'))).llaves.find((l: { prefijo: string }) => l.prefijo === caja.prefijo).revocada).toBeNull();
    // X-Operador con un retorno de carro codificado: 422 del núcleo, no llega a la bitácora.
    const op = await emitir(t.admin, venta(), undefined, { 'x-operador': encodeURIComponent('Ana\r\nX-Inyectada: 1') });
    expect(op.status).toBe(422);
  });
});
