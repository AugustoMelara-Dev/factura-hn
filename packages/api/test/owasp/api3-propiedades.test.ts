/**
 * OWASP API3:2023 · Broken Object Property Level Authorization (asignación masiva y exposición de propiedades).
 *
 * Cómo aplica: los cuerpos de entrada se validan con esquemas Zod que descartan los campos que no declaran. Los campos
 * que calcula o decide el servidor (número, CAI, totales, estado, `modo`, el emisor, el tenant, el rol efectivo de una
 * llave, el secreto de un webhook) no deben poder venir del cliente. En la salida, ningún secreto (hash de llave,
 * secreto de webhook, cuerpo de una entrega) sale después de su creación.
 *
 * Ataque: cuerpos con esos campos de más; buscar los secretos en todas las respuestas de lectura.
 */
import { afterAll, expect, it } from 'vitest';
import { leerLlave } from '../../src/llaves';
import { caiAleatorio, cerrarPool, cliente, EMISOR, FECHA_LIMITE, tenantListo, venta } from '../ayuda';
import { comoDueno, conBase, emitir, json, PERIODO, tenantConRecursos } from './comun';

afterAll(cerrarPool);

conBase('API3 · propiedades de los objetos', () => {
  it('emitir: los campos calculados por el servidor que manda el cliente se descartan (número, CAI, totales, estado, modo, emisor)', async () => {
    const t = await tenantListo();
    const r = await emitir(t.admin, {
      ...venta('100.00'),
      tenant: 'otro-tenant',
      documento: {
        lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00', importe: 0.01, isv: 'ISV15' }],
        numero: '000-001-01-99999999', correlativo: 99999999, cai: 'DEMO00-NO-VALIDO-000000-000000-00',
        totales: { subtotal: 0.01, isv15: 0, isv18: 0, total: 0.01, totalEnLetras: 'UN CENTAVO' },
        estado: 'ANULADO', modo: 'prueba', advertencias: [],
        emisor: { ...EMISOR, rtn: '99990000000099', razonSocial: 'Suplantada S. A.' },
        rangoAutorizado: '1 a 99999999', fechaLimiteEmision: '2999-12-31',
      },
    });
    expect(r.status).toBe(201);
    const d = (await json(r)).documento;
    expect(d.numero).toBe('000-001-01-00000001');
    expect(d.correlativo).toBe(1);
    expect(d.cai).not.toContain('DEMO00');
    expect(d.totales.total).toBe(115);
    expect(d.estado).toBe('EMITIDO');
    expect(d.modo).toBeUndefined();
    expect(d.emisor.rtn).toBe(EMISOR.rtn);
    expect(d.emisor.razonSocial).toBe(EMISOR.razonSocial);
    expect(d.fechaLimiteEmision).toBe(FECHA_LIMITE);
    // `modo: 'prueba'` no lo saca del libro de ventas: entra con su total.
    const libro = await json(await t.admin('GET', `/v1/libro-ventas?${PERIODO}`));
    expect(libro.filas).toHaveLength(1);
    expect(libro.excluidos).toBe(0);
  });

  it('una autorización real no se puede marcar de prueba para sacar sus ventas del libro y de la exportación', async () => {
    const t = await tenantListo();
    const r = await t.admin('POST', '/v1/autorizaciones', {
      cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '005', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: FECHA_LIMITE, prueba: true,
    });
    expect(r.status).toBe(422);
    expect((await json(r)).errores.map((p: { codigo: string }) => p.codigo)).toContain('AUTORIZACION_PRUEBA_CAI_REAL');
  });

  it('crear una llave: el tenant, el hash, el prefijo y la revocación no vienen del cuerpo', async () => {
    const a = await tenantListo();
    const b = await tenantListo();
    const r = await a.admin('POST', '/v1/llaves', {
      nombre: 'Caja', rol: 'caja', establecimiento: '000', puntoEmision: '001',
      tenant: b.tenant, prefijo: '000000000000', hash: '00', revocada: null, modo: 'prueba', limiteMensual: null,
    });
    expect(r.status).toBe(201);
    const { llave, secreto } = await json(r);
    expect(llave.prefijo).not.toBe('000000000000');
    expect(leerLlave(secreto)!.prefijo).toBe(llave.prefijo);
    expect(secreto.startsWith('fhn_live_')).toBe(true); // la marca sale del modo del tenant, no del cuerpo
    const sesion = (await json(await cliente(a.app, secreto)('GET', '/v1/sesion'))).sesion;
    expect(sesion.tenant).toBe(a.tenant);
    expect(sesion.llave.rol).toBe('caja');
  });

  it('crear y rotar un webhook: el secreto, el estado y el tenant no vienen del cuerpo', async () => {
    const a = await tenantListo();
    const b = await tenantListo();
    const r = await a.admin('POST', '/v1/webhooks', {
      url: 'http://127.0.0.1:9/hook', eventos: ['documento.emitido'], secreto: 'whsec_elegido', activo: false, tenant: b.tenant, id: '00000000-0000-0000-0000-000000000000',
    });
    expect(r.status).toBe(201);
    const { webhook, secreto } = await json(r);
    expect(secreto).not.toBe('whsec_elegido');
    expect(webhook.activo).toBe(true);
    expect(webhook.id).not.toBe('00000000-0000-0000-0000-000000000000');
    expect((await json(await b.admin('GET', '/v1/webhooks'))).webhooks).toEqual([]);
    const rot = await json(await a.admin('POST', `/v1/webhooks/${webhook.id}/rotar-secreto`, { graciaHoras: 0, secreto: 'whsec_elegido' }));
    expect(rot.secreto).not.toBe('whsec_elegido');
  });

  it('el emisor: el RTN no cambia, el id no se elige y los campos de más se descartan', async () => {
    const t = await tenantListo();
    const r = await t.admin('PATCH', `/v1/emisores/${t.emisorId}`, { rtn: '99990000000077' });
    expect(r.status).toBe(422);
    expect((await json(r)).error.codigo).toBe('EMISOR_RTN_INMUTABLE');
    const p = await json(await t.admin('PATCH', `/v1/emisores/${t.emisorId}`, { telefono: '0000-1111', id: '00000000-0000-0000-0000-000000000000', tenant: 'otro', cai: 'X' }));
    expect(p.emisor.id).toBe(t.emisorId);
    expect(p.emisor).not.toHaveProperty('tenant');
    expect(p.emisor).not.toHaveProperty('cai');
    const guardado = (await comoDueno(t.pool, t.tenant, 'SELECT datos FROM api_emisores WHERE tenant = $1', [t.tenant])).rows[0]!.datos as Record<string, unknown>;
    expect(Object.keys(guardado).sort()).toEqual(Object.keys({ ...EMISOR }).sort());
  });

  it('ninguna lectura devuelve secretos: ni el hash de una llave, ni el secreto de un webhook (vigente o anterior), ni el cuerpo de una entrega', async () => {
    const t = await tenantConRecursos();
    const { secreto: nuevo } = await json(await t.admin('POST', `/v1/webhooks/${t.webhookId}/rotar-secreto`, { graciaHoras: 24 }));
    const hashes = (await comoDueno<{ hash: Buffer }>(t.pool, t.tenant, 'SELECT hash FROM api_llaves WHERE tenant = $1', [t.tenant])).rows.map((f) => f.hash.toString('hex'));
    const prohibidos = [t.secretoWebhook, nuevo, t.caja, t.caja2, t.llaveAdmin, ...hashes, 'whsec_', 'plano:', 'gcm:'];
    const lecturas = [
      '/v1/sesion', '/v1/llaves', '/v1/webhooks', `/v1/webhooks/${t.webhookId}/entregas`, '/v1/bitacora', '/v1/bitacora?origen=api',
      '/v1/emisores', '/v1/autorizaciones', `/v1/documentos?${PERIODO}`, `/v1/documentos/${t.numero}`,
    ];
    // Las de admin: una caja recibe 403 (y se revisa igual que su cuerpo no traiga nada).
    const deAdmin = new Set(['/v1/llaves', '/v1/webhooks', `/v1/webhooks/${t.webhookId}/entregas`, '/v1/bitacora', '/v1/bitacora?origen=api']);
    for (const ruta of lecturas) {
      for (const llave of [t.llaveAdmin, t.caja]) {
        const r = await cliente(t.app, llave)('GET', ruta);
        const texto = await r.text();
        // Un cuerpo de error no cuenta como «no trae secretos»: cada lectura responde lo que debe.
        const esperado = llave === t.caja && deAdmin.has(ruta) ? 403 : 200;
        expect(r.status, `${ruta} con ${llave === t.caja ? 'caja' : 'admin'}: ${texto.slice(0, 200)}`).toBe(esperado);
        for (const p of prohibidos) expect(texto.includes(p), `${ruta} trae ${p.slice(0, 12)}…`).toBe(false);
      }
    }
    // Las entregas dicen el estado, no el contenido del aviso.
    const e = (await json(await t.admin('GET', `/v1/webhooks/${t.webhookId}/entregas`))).entregas[0];
    expect(Object.keys(e).sort()).toEqual(['creada', 'estado', 'evento', 'id', 'intentos', 'proximoIntento', 'ultimoCodigo', 'ultimoError', 'webhookId']);
  });

  it('la sesión de una caja no expone el uso de todo el tenant ni los puntos de las otras cajas', async () => {
    const t = await tenantConRecursos();
    const s = (await json(await cliente(t.app, t.caja2)('GET', '/v1/sesion'))).sesion;
    expect(s.documentosDelMes).toBeNull();
    expect(s.puntos).toHaveLength(1);
    expect(JSON.stringify(s)).not.toContain('000-001-01');
  });
});
