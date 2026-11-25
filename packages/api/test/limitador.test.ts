/**
 * Límite de solicitudes (revisión de la 0.2.0, MEDIO): el límite por llave cuenta solo solicitudes con el secreto
 * correcto, y los intentos no autenticados tienen su propio límite, por dirección y global.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { ipDeSolicitud, LimitadorSolicitudes } from '../src/errores';
import { cerrarPool, cliente, crearCaja, poolPrueba, ROL, tenantListo, URL_PG } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const llaveFalsa = (prefijo = randomBytes(6).toString('hex')) => `fhn_${prefijo}_${randomBytes(32).toString('base64url')}`;

describe('LimitadorSolicitudes', () => {
  it('espera consulta sin gastar fichas', () => {
    let t = 0;
    const l = new LimitadorSolicitudes(1, 2, () => t);
    expect(l.espera('a')).toBe(0);
    expect(l.tomar('a')).toBe(0);
    expect(l.espera('a')).toBe(0);
    expect(l.espera('a')).toBe(0);
    expect(l.tomar('a')).toBe(0);
    expect(l.espera('a')).toBe(1);
    t = 1000;
    expect(l.espera('a')).toBe(0);
    expect(l.tomar('a')).toBe(0);
    expect(l.espera('a')).toBe(1);
  });
});

describe('ipDeSolicitud', () => {
  const sol = (remota: string | undefined, xff?: string) => ({
    env: remota ? { incoming: { socket: { remoteAddress: remota } } } : undefined,
    req: { header: (n: string) => (n === 'x-forwarded-for' ? xff : undefined) },
  });
  it('sin proxies de confianza ignora X-Forwarded-For', () => {
    expect(ipDeSolicitud(sol('10.0.0.5', '1.2.3.4'), 0)).toBe('10.0.0.5');
  });
  it('con N proxies toma la N-ésima dirección desde la derecha', () => {
    expect(ipDeSolicitud(sol('10.0.0.5', 'falsa, 1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(ipDeSolicitud(sol('10.0.0.5', 'falsa, 1.2.3.4, 10.0.0.9'), 2)).toBe('1.2.3.4');
    // Menos saltos que proxies declarados: la dirección del socket, no algo que mandó el cliente.
    expect(ipDeSolicitud(sol('10.0.0.5', '1.2.3.4'), 2)).toBe('10.0.0.5');
  });
  it('IPv6: agrupa por /64; sin socket: una sola cubeta', () => {
    expect(ipDeSolicitud(sol('2001:db8:1:2:aaaa::1'), 0)).toBe(ipDeSolicitud(sol('2001:db8:1:2:bbbb::9'), 0));
    expect(ipDeSolicitud(sol('::ffff:10.0.0.5'), 0)).toBe('10.0.0.5');
    expect(ipDeSolicitud(sol(undefined), 0)).toBe('desconocida');
  });
});

conBase('límite de solicitudes', () => {
  it('quien conoce el prefijo de una llave no la deja en 429', async () => {
    const { app, admin } = await tenantListo({ limiteSolicitudes: { porSegundo: 1, rafaga: 5 }, limiteIntentos: { porSegundo: 0.01, rafaga: 20 } });
    const caja = await crearCaja(admin, '001');
    const prefijo = caja.split('_')[1]!;
    const estados: number[] = [];
    for (let i = 0; i < 30; i++) estados.push((await cliente(app, llaveFalsa(prefijo), { ip: '198.51.100.7' })('GET', '/v1/autorizaciones')).status);
    // Quien ataca se queda sin intentos; la caja, desde su dirección, sigue emitiendo.
    expect(estados.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(estados.slice(20).every((s) => s === 429)).toBe(true);
    expect((await cliente(app, caja, { ip: '198.51.100.8' })('GET', '/v1/autorizaciones')).status).toBe(200);
  });

  it('el límite global de intentos frena prefijos aleatorios desde muchas direcciones', async () => {
    const p = await poolPrueba();
    const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { globalPorSegundo: 0.01, globalRafaga: 4 } });
    const estados: number[] = [];
    for (let i = 0; i < 8; i++) estados.push((await cliente(app, llaveFalsa(), { ip: `203.0.113.${i}` })('GET', '/v1/autorizaciones')).status);
    expect(estados).toEqual([401, 401, 401, 401, 429, 429, 429, 429]);
  });

  it('X-Forwarded-For se ignora salvo con proxiesDeConfianza', async () => {
    const p = await poolPrueba();
    const falsa = (app: ReturnType<typeof crearApp>, xff: string) =>
      cliente(app, llaveFalsa(), { ip: '10.0.0.1' })('GET', '/v1/autorizaciones', undefined, { 'x-forwarded-for': xff });
    const sinProxy = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { porSegundo: 0.01, rafaga: 2 } });
    // Cambiar la cabecera en cada intento no da intentos nuevos: cuenta la dirección del socket.
    const a = [];
    for (let i = 0; i < 3; i++) a.push((await falsa(sinProxy, `1.1.1.${i}`)).status);
    expect(a).toEqual([401, 401, 429]);
    // Detrás de un proxy de confianza, cada cliente (la dirección que anotó el proxy) tiene su cubeta.
    const conProxy = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { porSegundo: 0.01, rafaga: 2 }, proxiesDeConfianza: 1 });
    const b = [];
    for (let i = 0; i < 3; i++) b.push((await falsa(conProxy, `1.1.1.${i}`)).status);
    expect(b).toEqual([401, 401, 401]);
  });

  it('prefijos aleatorios terminan en 429 sin consultar la base cada vez', async () => {
    const p = await poolPrueba();
    const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { porSegundo: 0.01, rafaga: 5 } });
    const estados: number[] = [];
    for (let i = 0; i < 10; i++) estados.push((await cliente(app, llaveFalsa())('GET', '/v1/autorizaciones')).status);
    expect(estados.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(estados.slice(5).every((s) => s === 429)).toBe(true);
    const r = await cliente(app, llaveFalsa())('GET', '/v1/autorizaciones');
    expect(r.headers.get('retry-after')).toMatch(/^\d+$/);
    const cuerpo = (await r.json()) as { error: { codigo: string; solucion: string; documentacion: string } };
    expect(cuerpo.error.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(cuerpo.error.documentacion).toMatch(/docs\/errores\.md#demasiados_intentos$/);
  });

  it('una llave válida ya vista sigue entrando aunque su dirección agote los intentos', async () => {
    const { app, llaveAdmin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 3 } });
    // `tenantListo` ya autenticó la llave admin: queda reconocida.
    for (let i = 0; i < 10; i++) await cliente(app, llaveFalsa())('GET', '/v1/autorizaciones');
    expect((await cliente(app, llaveFalsa())('GET', '/v1/autorizaciones')).status).toBe(429);
    expect((await cliente(app, llaveAdmin)('GET', '/v1/autorizaciones')).status).toBe(200);
  });

  it('el límite por llave sigue aplicando a la llave válida', async () => {
    const { admin } = await tenantListo();
    const caja = await crearCaja(admin, '001');
    const app2 = crearApp({ pool: await poolPrueba(), modo: 'local', rol: ROL, registrar: () => undefined, limiteSolicitudes: { porSegundo: 0.01, rafaga: 2 } });
    const c = cliente(app2, caja);
    expect((await c('GET', '/v1/autorizaciones')).status).toBe(200);
    expect((await c('GET', '/v1/autorizaciones')).status).toBe(200);
    const r = await c('GET', '/v1/autorizaciones');
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { codigo: string } }).error.codigo).toBe('DEMASIADAS_SOLICITUDES');
  });
});
