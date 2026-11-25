/**
 * OWASP API1:2023 · Broken Object Level Authorization.
 *
 * Cómo aplica: cada recurso tiene un identificador que viaja en la ruta (número de documento, id del emisor y del
 * webhook, id de la entrega, prefijo de la llave, CAI, serie). El tenant sale solo de la llave y la base aísla cada
 * tenant con RLS. Dentro de un tenant, una llave de caja está atada a su punto de emisión.
 *
 * Ataque: la llave admin del tenant B usa los identificadores del tenant A en todas las operaciones que los reciben, y
 * una caja intenta trabajar sobre otro punto de emisión.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { cerrarPool, cliente, tenantListo, venta } from '../ayuda';
import { conBase, ejecutar, emitir, huella, json, operaciones, PERIODO, tenantConRecursos } from './comun';

afterAll(cerrarPool);

conBase('API1 · autorización a nivel de objeto', () => {
  it('B no ve ni cambia ningún recurso de A con sus identificadores: 404 o una lista sin ellos, y A queda igual', async () => {
    const a = await tenantConRecursos();
    const b = await tenantListo(); // con emisor y CAI propios, sin documentos
    const antes = await huella(a);

    const conId = operaciones(a).filter((o) => o.plantilla.includes('{'));
    expect(conId.map((o) => o.operationId).sort()).toEqual([
      'actualizarEmisor', 'anularDocumento', 'corregirFechaSerie', 'desactivarWebhook', 'listarEntregasWebhook', 'listarNoUtilizados',
      'obtenerDocumento', 'obtenerEmisor', 'obtenerEstadoAutorizacion', 'probarWebhook', 'reenviarEntregaWebhook', 'revocarLlave',
      'rotarSecretoWebhook',
    ]);
    for (const o of conId) {
      const r = await ejecutar(b.admin, o);
      const cuerpo = await r.text();
      // Nunca un 2xx con datos de A. Las series no son objetos con dueño: B consulta o corrige *su* serie con ese
      // nombre, que está vacía (200 o 422 de la regla fiscal, sin nada de A).
      if (o.operationId === 'listarNoUtilizados' || o.operationId === 'corregirFechaSerie') {
        expect([200, 422], `${o.operationId}: ${cuerpo}`).toContain(r.status);
        expect(cuerpo, o.operationId).not.toContain(a.numero);
        expect(cuerpo, o.operationId).not.toContain(a.cai);
      } else {
        expect(r.status, `${o.operationId}: ${cuerpo}`).toBe(404);
        expect(JSON.parse(cuerpo).error.codigo, o.operationId).toBe('NO_ENCONTRADO');
      }
    }
    expect(await huella(a)).toEqual(antes);
  });

  it('las listas de B no traen nada de A', async () => {
    const a = await tenantConRecursos();
    const b = await tenantListo();
    const secretoA = [a.numero, a.cai, a.webhookId, a.entregaId, a.prefijoCaja, a.emisorId, a.tenant];
    for (const ruta of ['/v1/emisores', '/v1/autorizaciones', `/v1/documentos?${PERIODO}`, '/v1/llaves', '/v1/webhooks', '/v1/bitacora', '/v1/bitacora?origen=api', '/v1/sesion', `/v1/libro-ventas?${PERIODO}`, `/v1/exportacion?${PERIODO}`]) {
      const r = await b.admin('GET', ruta);
      const texto = await r.text();
      // Una lectura de admin responde 200: un cuerpo de error no cuenta como «no trae nada de A».
      expect(r.status, `${ruta}: ${texto.slice(0, 200)}`).toBe(200);
      // El número no se busca en la sesión: el siguiente número de B puede ser el mismo que el de A.
      for (const s of secretoA) if (!(ruta === '/v1/sesion' && s === a.numero)) expect(texto, `${ruta} trae ${s}`).not.toContain(s);
    }
  });

  it('la misma Idempotency-Key en B no repite el documento de A: cada tenant tiene sus claves', async () => {
    const a = await tenantListo();
    const b = await tenantListo();
    const clave = randomUUID();
    const cuerpo = venta('55.00');
    const docA = (await json(await emitir(a.admin, cuerpo, clave))).documento;
    const r = await emitir(b.admin, cuerpo, clave);
    expect(r.status).toBe(201);
    expect(r.headers.get('idempotency-replayed')).toBeNull();
    const docB = (await json(r)).documento;
    expect(docB.cai).not.toBe(docA.cai); // el CAI de B, no el de A
    const caisB = (await json(await b.admin('GET', '/v1/autorizaciones'))).autorizaciones.map((x: { cai: string }) => x.cai);
    expect(caisB).toContain(docB.cai);
  });

  it('una caja no emite en otro punto, y su sesión y su libro de ventas son solo de su punto', async () => {
    const t = await tenantConRecursos();
    const caja1 = cliente(t.app, t.caja);
    const caja2 = cliente(t.app, t.caja2);
    // Otro punto en el cuerpo: 403, sin consumir número.
    const r = await emitir(caja1, venta('10.00', { puntoEmision: '002' }));
    expect(r.status).toBe(403);
    expect((await json(r)).error.codigo).toBe('CAJA_NO_AUTORIZADA');
    const otro = await emitir(caja1, venta('10.00', { establecimiento: '001' }));
    expect(otro.status).toBe(403);
    // El documento de la caja 001 (el del fixture) no aparece en el libro de la caja 002.
    const r2 = await caja2('GET', `/v1/libro-ventas?${PERIODO}`);
    expect(r2.status).toBe(200);
    const libro2 = await json(r2);
    expect(libro2.filas).toEqual([]);
    expect(JSON.stringify(libro2)).not.toContain(t.numero);
    const sesion2 = (await json(await caja2('GET', '/v1/sesion'))).sesion;
    expect(sesion2.puntos.map((p: { puntoEmision: string }) => p.puntoEmision)).toEqual(['002']);
    expect(sesion2.documentosDelMes).toBeNull();
    // La serie siguiente de la caja 002 sigue en su primer número: nada se emitió ahí.
    const d = (await json(await emitir(caja2, venta('1.00', { puntoEmision: '002' })))).documento;
    expect(d.numero).toBe('000-002-01-00000001');
  });

  it('límite conocido (DEC-122): una caja lee los documentos de otro punto de su mismo tenant, nunca los de otro tenant', async () => {
    // Documentado en docs/api.md y en DEC-122: la lectura de documentos con llave de caja es de todo el tenant. Si
    // se decide acotarla al punto (propuesta abierta), esta prueba cambia de expectativa.
    const t = await tenantConRecursos();
    const caja2 = cliente(t.app, t.caja2);
    expect((await caja2('GET', `/v1/documentos/${t.numero}`)).status).toBe(200);
    const otro = await tenantConRecursos();
    const ajeno = await emitir(otro.admin, venta('3.00'));
    const numeroAjeno = (await json(ajeno)).documento.numero as string;
    expect(numeroAjeno).toBe('000-001-01-00000002');
    // El tenant de t tiene un solo documento en 000-001-01: el 2 de «otro» no existe para t.
    expect((await caja2('GET', `/v1/documentos/${numeroAjeno}`)).status).toBe(404);
  });
});
