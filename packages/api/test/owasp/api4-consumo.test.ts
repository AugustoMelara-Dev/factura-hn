/**
 * OWASP API4:2023 · Unrestricted Resource Consumption.
 *
 * Cómo aplica: un solo proceso atiende a todos los tenants. Los topes que ya existían: cuerpo de 512 KB, 500 líneas,
 * largo de cada texto, `limite` de 1 a 500, período de 366 días, exponentes de los montos (DEC-052), solicitudes por
 * llave (DEC-070), reportes acotados (DEC-059), 20 webhooks activos (DEC-058) y 5 pruebas pendientes (DEC-116).
 *
 * Ataque: cuerpos grandes sin `Content-Length`, profundos o con montos extremos; páginas de documentos grandes; listas
 * repetidas que terminan en la bitácora.
 *
 * Hallazgo corregido: `GET /v1/documentos?limite=500` cargaba los 500 documentos completos de una vez. Con
 * documentos de 480 KB (500 líneas, el máximo que cabe en el cuerpo) eran unos 240 MB en una sola respuesta, en el
 * proceso compartido. Ahora cada página tiene un tope de bytes (`MAX_BYTES_PAGINA`, 8 MiB).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { MAX_BYTES_PAGINA } from '../../src/app';
import { cerrarPool, tenantListo, venta } from '../ayuda';
import { conBase, emitir, json, PERIODO } from './comun';

afterAll(cerrarPool);

/** Un cuerpo transmitido por partes, sin `Content-Length`. */
function transmitido(bytes: number): ReadableStream<Uint8Array> {
  const parte = new TextEncoder().encode(' '.repeat(64 * 1024));
  let enviados = 0;
  return new ReadableStream({
    pull(c) {
      if (enviados >= bytes) return c.close();
      c.enqueue(parte);
      enviados += parte.length;
    },
  });
}

conBase('API4 · consumo de recursos', () => {
  it('un cuerpo de más de 512 KB por partes (sin Content-Length) es 413 y no emite nada', async () => {
    const t = await tenantListo();
    const r = await t.app.request(
      new Request('http://x/v1/documentos', {
        method: 'POST',
        headers: { authorization: `Bearer ${t.llaveAdmin}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: transmitido(2 * 1024 * 1024),
        duplex: 'half',
      } as RequestInit),
    );
    expect(r.status).toBe(413);
    expect((await json(r)).error.codigo).toBe('CUERPO_DEMASIADO_GRANDE');
    expect((await json(await t.admin('GET', `/v1/documentos?${PERIODO}`))).documentos).toEqual([]);
  });

  it('topes de forma: líneas, textos, montos, claves, operador, página y cursor (400 o 422, nunca 500)', async () => {
    const t = await tenantListo();
    const linea = { descripcion: 'x', cantidad: 1, precioUnitario: '1.00' };
    const casos: [string, () => Promise<Response>, number][] = [
      ['501 líneas', () => emitir(t.admin, venta('1', { documento: { lineas: Array(501).fill(linea) } })), 400],
      ['descripción de 501', () => emitir(t.admin, venta('1', { documento: { lineas: [{ ...linea, descripcion: 'x'.repeat(501) }] } })), 400],
      ['monto de 33 caracteres', () => emitir(t.admin, venta('1'.repeat(33))), 400],
      ['exponente enorme (DEC-052)', () => emitir(t.admin, venta('1e10000000')), 422],
      ['número 1e308', () => emitir(t.admin, { ...venta(), documento: { lineas: [{ ...linea, precioUnitario: 1e308 }] } }), 422],
      ['cantidad 1e21', () => emitir(t.admin, { ...venta(), documento: { lineas: [{ ...linea, cantidad: 1e21 }] } }), 422],
      ['Idempotency-Key de 256', () => emitir(t.admin, venta(), 'k'.repeat(256)), 400],
      ['operador de 81', () => emitir(t.admin, venta('1', { operador: 'o'.repeat(81) })), 400],
      ['limite 501', () => t.admin('GET', `/v1/documentos?${PERIODO}&limite=501`), 400],
      ['limite 0', () => t.admin('GET', `/v1/documentos?${PERIODO}&limite=0`), 400],
      ['cursor de 201', () => t.admin('GET', `/v1/documentos?${PERIODO}&cursor=${'a'.repeat(201)}`), 400],
      ['período de 367 días', () => t.admin('GET', '/v1/libro-ventas?desde=2025-01-01&hasta=2026-01-03'), 400],
      ['ancho de 121', () => t.admin('GET', '/v1/documentos/000-001-01-00000001.txt?ancho=121'), 400],
    ];
    for (const [nombre, hacer, estado] of casos) {
      const inicio = Date.now();
      const r = await hacer();
      expect(r.status, `${nombre}: ${await r.clone().text()}`).toBe(estado);
      expect(Date.now() - inicio, nombre).toBeLessThan(2000);
    }
    // Nada de lo anterior consumió un número.
    expect((await json(await emitir(t.admin, venta()))).documento.numero).toBe('000-001-01-00000001');
  });

  it('JSON con 150 000 niveles en un campo de más: no tumba el proceso ni da 500', async () => {
    const t = await tenantListo();
    const profundo = `${'['.repeat(150_000)}${']'.repeat(150_000)}`;
    const cuerpo = JSON.stringify(venta()).replace(/}$/, `,"extra":${profundo}}`);
    const r = await t.app.request('/v1/documentos', {
      method: 'POST', body: cuerpo,
      headers: { authorization: `Bearer ${t.llaveAdmin}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
    });
    expect([201, 400]).toContain(r.status);
  });

  it('límite de solicitudes por llave: 429 con Retry-After y las cabeceras RateLimit (DEC-070, DEC-108)', async () => {
    const t = await tenantListo({ limiteSolicitudes: { porSegundo: 0.001, rafaga: 3 } });
    // tenantListo ya gastó la ráfaga al preparar el emisor y los CAI: la siguiente es 429.
    const r = await t.admin('GET', '/v1/sesion');
    expect(r.status).toBe(429);
    expect((await json(r)).error.codigo).toBe('DEMASIADAS_SOLICITUDES');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(r.headers.get('ratelimit-policy')).toBe('"llave";q=3;w=3000');
  });

  it(`GET /v1/documentos corta la página por bytes (por defecto ${MAX_BYTES_PAGINA} bytes) y el cursor sigue sin repetir ni saltar`, async () => {
    expect(MAX_BYTES_PAGINA).toBe(8 * 1024 * 1024);
    // Documentos de unos 40 KB y un tope de 50 000 bytes: dos por página (el segundo empieza antes del tope).
    const t = await tenantListo({ maxBytesPagina: 50_000 });
    const lineas = Array.from({ length: 70 }, (_, i) => ({ descripcion: `${i} ${'d'.repeat(490)}`, cantidad: 1, precioUnitario: '1.00' }));
    const numeros: string[] = [];
    for (let i = 0; i < 5; i++) numeros.push((await json(await emitir(t.admin, venta('1', { documento: { lineas } })))).documento.numero);
    const bytes = Buffer.byteLength(JSON.stringify((await json(await t.admin('GET', `/v1/documentos/${numeros[0]}`))).documento));
    expect(bytes).toBeGreaterThan(30_000);
    expect(bytes).toBeLessThan(50_000);

    const vistos: string[] = [];
    const tamanos: number[] = [];
    let cursor: string | null = null;
    do {
      const p = await json(await t.admin('GET', `/v1/documentos?${PERIODO}&limite=500${cursor ? `&cursor=${cursor}` : ''}`));
      tamanos.push(p.documentos.length);
      vistos.push(...p.documentos.map((d: { numero: string }) => d.numero));
      expect(p.hayMas).toBe(p.siguiente !== null);
      cursor = p.siguiente;
    } while (cursor);
    expect(tamanos).toEqual([2, 2, 1]);
    expect(vistos).toEqual(numeros);

    // Un documento más grande que el tope sale solo, en su propia página.
    const chico = await tenantListo({ maxBytesPagina: 1 });
    for (let i = 0; i < 2; i++) await emitir(chico.admin, venta());
    const p1 = await json(await chico.admin('GET', `/v1/documentos?${PERIODO}`));
    expect(p1.documentos).toHaveLength(1);
    expect(p1.hayMas).toBe(true);
    const p2 = await json(await chico.admin('GET', `/v1/documentos?${PERIODO}&cursor=${p1.siguiente}`));
    expect(p2.documentos).toHaveLength(1);
    expect(p2.hayMas).toBe(false);
    expect(p2.documentos[0].numero).not.toBe(p1.documentos[0].numero);
  });

  it('crear un webhook con la misma suscripción repetida miles de veces: la bitácora guarda la lista sin repetir', async () => {
    const t = await tenantListo();
    const eventos = Array<string>(20_000).fill('documento.emitido');
    const r = await t.admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/repetido', eventos });
    expect(r.status).toBe(201);
    expect((await json(r)).webhook.eventos).toEqual(['documento.emitido']);
    const evento = (await json(await t.admin('GET', '/v1/bitacora?origen=api&limite=1'))).eventos[0];
    expect(evento.accion).toBe('webhook.creado');
    expect(evento.detalle.eventos).toEqual(['documento.emitido']);
  });
});
