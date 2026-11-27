/**
 * Errores que orientan (400 en español, `solucion` y `documentacion`) y enlaces en la respuesta de emisión.
 */
import { randomUUID } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { conSolucion, documentacionDe, soluciones } from '../src/errores';
import { cerrarPool, cliente, crearCaja, EMISOR, nombreTenant, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';
import { crearTenant } from '../src/operador';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const emitir = (c: ReturnType<typeof cliente>, cuerpo: unknown, clave = randomUUID()) => c('POST', '/v1/documentos', cuerpo, { 'idempotency-key': clave });

describe('guía de errores', () => {
  it('el enlace sigue el esquema de docs/errores.md con el código en minúsculas', () => {
    expect(documentacionDe('SIN_AUTORIZACION')).toBe('https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#sin_autorizacion');
  });

  it('la solución de un 422 sale del primer problema que tenga una; la de la API reemplaza la del SDK en sus códigos', () => {
    const guia = soluciones({ consola: 'factura-hn-api', modo: 'local' });
    const r = conSolucion(
      {
        error: { codigo: 'VALIDACION', mensaje: 'x' },
        errores: [
          { codigo: 'CLIENTE_RTN', mensaje: 'a' },
          { codigo: 'RANGO_AGOTADO', mensaje: 'b', solucion: 'del SDK: registrarAutorizacion(almacen, …)' } as never,
          { codigo: 'FECHA_FUTURA', mensaje: 'c', solucion: 'propia' } as never,
        ],
      },
      guia,
    );
    expect(r.error.documentacion).toMatch(/#rango_agotado$/);
    expect(r.error.solucion).toBe(guia.RANGO_AGOTADO);
    expect(r.errores![0]).toEqual({ codigo: 'CLIENTE_RTN', mensaje: 'a', documentacion: documentacionDe('CLIENTE_RTN') });
    expect(r.errores![1]!.solucion).toBe(guia.RANGO_AGOTADO);
    // Un código que la API no tiene en su tabla conserva la solución que traiga.
    expect(r.errores![2]!.solucion).toBe('propia');
  });

  it('las soluciones mencionan la consola de este despliegue, y el demo solo si existe', () => {
    const conDemo = soluciones({ consola: 'docker compose exec api factura-hn-api', modo: 'local', hayDemo: true }).NO_AUTENTICADO!;
    expect(conDemo).toContain('`docker compose exec api factura-hn-api demo llave`');
    expect(conDemo).toContain('`docker compose exec api factura-hn-api llave crear local --rol admin');
    const sinDemo = soluciones({ consola: 'factura-hn-api', modo: 'local' }).NO_AUTENTICADO!;
    expect(sinDemo).not.toMatch(/demo/);
    expect(sinDemo).toContain('llave crear local');
  });

  it('en modo alojado, lo que ve quien no se autenticó no nombra comandos ni tenants del operador', () => {
    const g = soluciones({ consola: 'docker compose exec api factura-hn-api', modo: 'alojado', hayDemo: true });
    for (const codigo of ['NO_AUTENTICADO', 'DEMASIADOS_INTENTOS', 'CUERPO_NO_UTF8', 'CUERPO_DEMASIADO_GRANDE', 'SOLICITUD_INVALIDA']) {
      expect(g[codigo]).not.toMatch(/docker|compose|factura-hn-api|demo|\blocal\b/);
    }
    expect(g.NO_AUTENTICADO).toContain('pide una al operador de la API');
  });

  it('DEMASIADOS_INTENTOS no culpa solo a la dirección', () => {
    const g = soluciones({ consola: 'factura-hn-api', modo: 'local' });
    expect(g.DEMASIADOS_INTENTOS).not.toMatch(/desde esta dirección/);
    expect(g.DEMASIADOS_INTENTOS).toMatch(/dirección o con esta misma llave/);
  });
});

conBase('errores con solución', () => {
  it('el 401 de un despliegue alojado no revela comandos ni tenants', async () => {
    const p = await poolPrueba();
    const opciones = { pool: p, rol: ROL, registrar: () => undefined, consola: 'docker compose exec api factura-hn-api', hayDemo: true };
    const alojado = await json(await cliente(crearApp({ ...opciones, modo: 'alojado' }), null)('GET', '/v1/sesion'));
    expect(alojado.error.codigo).toBe('NO_AUTENTICADO');
    expect(alojado.error.solucion).toContain('pide una al operador de la API');
    expect(JSON.stringify(alojado)).not.toMatch(/docker|demo llave|llave crear/);
    const local = await json(await cliente(crearApp({ ...opciones, modo: 'local' }), null)('GET', '/v1/sesion'));
    expect(local.error.solucion).toContain('docker compose exec api factura-hn-api demo llave');
  });


  it('400 de forma en español, con el campo en error.campo', async () => {
    const { admin } = await tenantListo();
    const r = await emitir(admin, { lineas: [] });
    expect(r.status).toBe(400);
    const cuerpo = await json(r);
    expect(cuerpo.error).toMatchObject({
      codigo: 'SOLICITUD_INVALIDA',
      campo: 'documento',
      mensaje: 'La solicitud no tiene la forma esperada. documento: falta este dato (es obligatorio)',
      solucion: expect.stringContaining('error.campo'),
      documentacion: documentacionDe('SOLICITUD_INVALIDA'),
    });
    expect(cuerpo.errores[0]).toMatchObject({ codigo: 'SOLICITUD_INVALIDA', campo: 'documento' });

    const vacia = await json(await emitir(admin, { documento: { lineas: [] } }));
    expect(vacia.error.campo).toBe('documento.lineas');
    expect(vacia.error.mensaje).toBe('La solicitud no tiene la forma esperada. documento.lineas: debe tener al menos un elemento');
    expect(JSON.stringify(vacia)).not.toMatch(/Invalid input|Too small|expected/);

    // El tipo recibido sale de lo que se mandó, y un mensaje propio del esquema se respeta.
    const texto = await json(await emitir(admin, { documento: 'hola' }));
    expect(texto.error.mensaje).toBe('La solicitud no tiene la forma esperada. documento: debe ser un objeto (llegó texto)');
    // Formatos: en español natural, sin «Inválido UUID» ni el patrón de la expresión regular.
    const uuid = await json(await admin('PATCH', '/v1/emisores/x', { telefono: '0000-0000' }));
    expect(uuid.error).toMatchObject({ codigo: 'SOLICITUD_INVALIDA', campo: 'id', mensaje: 'La solicitud no tiene la forma esperada. id: UUID inválido' });
    const url = await json(await admin('POST', '/v1/webhooks', { url: 'notaurl', eventos: ['documento.emitido'] }));
    expect(url.error).toMatchObject({ codigo: 'SOLICITUD_INVALIDA', campo: 'url', mensaje: 'La solicitud no tiene la forma esperada. url: URL inválida' });
    const fecha = await json(await admin('GET', '/v1/documentos?desde=hoy&hasta=2026-01-31'));
    expect(fecha.error).toMatchObject({ codigo: 'SOLICITUD_INVALIDA', campo: 'desde', mensaje: 'La solicitud no tiene la forma esperada. desde: debe tener el formato AAAA-MM-DD' });
    const periodo = await json(await admin('GET', '/v1/libro-ventas?desde=2026-01-01&hasta=2027-06-01'));
    expect(JSON.stringify(periodo)).toContain('El período no puede pasar de 366 días.');
  });

  it('el español es solo de la API: no cambia la configuración global de Zod', () => {
    expect(z.string().safeParse(1).error!.issues[0]!.message).toBe('Invalid input: expected string, received number');
  });

  it('422 SIN_AUTORIZACION: solución y enlace en el error y en cada problema', async () => {
    const p = await poolPrueba();
    const tenant = nombreTenant();
    const { llaveAdmin } = await crearTenant(p, { tenant, nombre: tenant });
    const admin = cliente(crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined }), llaveAdmin);
    expect((await admin('POST', '/v1/emisores', EMISOR)).status).toBe(201);
    const r = await emitir(admin, venta());
    expect(r.status).toBe(422);
    const cuerpo = await json(r);
    expect(cuerpo.error).toMatchObject({
      codigo: 'VALIDACION',
      solucion: expect.stringContaining('POST /v1/autorizaciones'),
      documentacion: documentacionDe('SIN_AUTORIZACION'),
    });
    expect(cuerpo.errores[0]).toMatchObject({ codigo: 'SIN_AUTORIZACION', documentacion: documentacionDe('SIN_AUTORIZACION'), solucion: expect.stringContaining('POST /v1/autorizaciones') });
    // La solución de cada problema habla de la API, no de las funciones del SDK.
    expect(JSON.stringify(cuerpo)).not.toMatch(/registrarAutorizacion\(|crearFacturadorDemo/);
  });

  it('403 de rol, 409 sin emisor, 400 sin Idempotency-Key y 413: con solución', async () => {
    const { app, admin } = await tenantListo();
    const caja = cliente(app, await crearCaja(admin, '001'));
    const rol = await json(await caja('GET', '/v1/llaves'));
    expect(rol.error).toMatchObject({ codigo: 'SOLO_ADMIN', solucion: expect.stringContaining('GET /v1/sesion'), documentacion: documentacionDe('SOLO_ADMIN') });

    const sinClave = await json(await caja('POST', '/v1/documentos', venta(), { 'idempotency-key': ' ' }));
    expect(sinClave.error).toMatchObject({ codigo: 'IDEMPOTENCY_KEY', solucion: expect.any(String) });
    // Sin la cabecera: el mismo código y su solución propia, no SOLICITUD_INVALIDA.
    const sinCabecera = await caja('POST', '/v1/documentos', venta());
    expect(sinCabecera.status).toBe(400);
    const faltante = await json(sinCabecera);
    expect(faltante.error).toMatchObject({ codigo: 'IDEMPOTENCY_KEY', documentacion: documentacionDe('IDEMPOTENCY_KEY') });
    expect(faltante.error.solucion).toContain('Idempotency-Key` con un valor único por venta');
    // Windows PowerShell 5.1 borra de ErrorDetails.Message lo que parece una etiqueta («<…>»).
    expect(faltante.error.solucion).not.toMatch(/[<>]/);
    expect(faltante.error.solucion).toContain('reutiliza el mismo valor');

    const grande = await caja('POST', '/v1/documentos', { relleno: 'x'.repeat(600 * 1024) }, { 'idempotency-key': 'k' });
    expect(grande.status).toBe(413);
    expect((await json(grande)).error).toMatchObject({ codigo: 'CUERPO_DEMASIADO_GRANDE', documentacion: documentacionDe('CUERPO_DEMASIADO_GRANDE') });

    const p = await poolPrueba();
    const tenant = nombreTenant();
    const { llaveAdmin } = await crearTenant(p, { tenant, nombre: tenant });
    const sinEmisor = await json(await emitir(cliente(crearApp({ pool: p, modo: 'local', rol: ROL }), llaveAdmin), venta()));
    expect(sinEmisor.error).toMatchObject({ codigo: 'SIN_EMISOR', solucion: expect.stringContaining('POST /v1/emisores') });
  });

  it('un 422 fuera de la emisión no pide reintentar con la Idempotency-Key (corregir-fecha sin nada que corregir)', async () => {
    const { admin } = await tenantListo();
    const r = await admin('POST', '/v1/series/000-001-01/corregir-fecha', { motivo: 'Reloj revisado' });
    expect(r.status).toBe(422);
    const cuerpo = await json(r);
    expect(cuerpo.errores[0].codigo).toBe('SIN_DOCUMENTOS_ADELANTADOS');
    expect(cuerpo.error.solucion).toBe('Revisa `errores`: cada uno trae su código y su campo. Corrige y reintenta.');
    // En la emisión, sí: un 422 no consume número y la misma clave no emite dos veces.
    expect(soluciones({ consola: 'factura-hn-api', modo: 'local' }).VALIDACION).toContain('misma Idempotency-Key');
  });

  it('CUERPO_NO_UTF8 trae la solución con --data-binary', async () => {
    const { app, llaveAdmin } = await tenantListo();
    const r = await app.request('/v1/documentos', {
      method: 'POST',
      headers: { authorization: `Bearer ${llaveAdmin}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: new Uint8Array(Buffer.from('{"documento":{"lineas":[{"descripcion":"Café","cantidad":1,"precioUnitario":"1"}]}}', 'latin1')),
    });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatchObject({ codigo: 'CUERPO_NO_UTF8', solucion: expect.stringContaining('--data-binary @factura.json') });
  });
});

conBase('enlaces en la emisión', () => {
  it('201 y la repetición idempotente traen enlaces pdf, html y txt que funcionan', async () => {
    const { app, admin } = await tenantListo();
    const caja = cliente(app, await crearCaja(admin, '001'));
    const clave = randomUUID();
    const r = await emitir(caja, { documento: venta().documento }, clave);
    expect(r.status).toBe(201);
    const { documento, enlaces } = await json(r);
    expect(enlaces).toEqual({
      pdf: `/v1/documentos/${documento.numero}.pdf`,
      html: `/v1/documentos/${documento.numero}.html`,
      txt: `/v1/documentos/${documento.numero}.txt`,
    });
    const repetida = await emitir(caja, { documento: venta().documento }, clave);
    expect(repetida.headers.get('idempotency-replayed')).toBe('true');
    expect((await json(repetida)).enlaces).toEqual(enlaces);
    const pdf = await caja('GET', enlaces.pdf);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect((await caja('GET', enlaces.html)).status).toBe(200);
    expect(await (await caja('GET', enlaces.txt)).text()).toContain(documento.numero);
  });
});
