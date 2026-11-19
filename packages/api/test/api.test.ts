/**
 * Pruebas de punta a punta de la API contra PostgreSQL real (FHN_PG_URL). Sin base se omiten.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { cerrarPool, cliente, crearCaja, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const emitir = (c: ReturnType<typeof cliente>, cuerpo: unknown, clave = randomUUID()) => c('POST', '/v1/documentos', cuerpo, { 'idempotency-key': clave });

conBase('autenticación y roles', () => {
  it('sin llave, con formato inválido, con secreto equivocado o revocada: 401', async () => {
    const { app, llaveAdmin, admin } = await tenantListo();
    expect((await cliente(app, null)('GET', '/v1/autorizaciones')).status).toBe(401);
    expect((await cliente(app, 'abc')('GET', '/v1/autorizaciones')).status).toBe(401);
    const otraFirma = llaveAdmin.slice(0, -4) + (llaveAdmin.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const r = await cliente(app, otraFirma)('GET', '/v1/autorizaciones');
    expect(r.status).toBe(401);
    expect(await json(r)).toEqual({ error: { codigo: 'NO_AUTENTICADO', mensaje: 'Falta la llave de API o no es válida.' } });

    const caja = await crearCaja(admin, '001');
    const prefijo = caja.split('_')[1]!;
    expect((await cliente(app, caja)('GET', '/v1/autorizaciones')).status).toBe(200);
    expect((await admin('DELETE', `/v1/llaves/${prefijo}`)).status).toBe(200);
    expect((await cliente(app, caja)('GET', '/v1/autorizaciones')).status).toBe(401);
  });

  it('caja: emite y consulta; no registra CAI, no anula, no corrige fechas, no ve la bitácora ni las llaves', async () => {
    const { app, admin } = await tenantListo();
    const caja = cliente(app, await crearCaja(admin, '001'));
    const r = await emitir(caja, venta());
    expect(r.status).toBe(201);
    const { documento } = await json(r);
    expect((await caja('GET', `/v1/documentos/${documento.numero}`)).status).toBe(200);
    for (const [m, ruta, cuerpo] of [
      ['POST', '/v1/autorizaciones', { cai: 'X', tipoDocumento: '01', establecimiento: '000', puntoEmision: '009', rangoInicial: 1, rangoFinal: 2, fechaLimiteEmision: '2027-01-01' }],
      ['POST', `/v1/documentos/${documento.numero}/anular`, { motivo: 'x' }],
      ['POST', '/v1/series/000-001-01/corregir-fecha', { motivo: 'x' }],
      ['GET', '/v1/bitacora'],
      ['GET', '/v1/llaves'],
      ['POST', '/v1/llaves', { nombre: 'x', rol: 'admin' }],
      ['POST', '/v1/webhooks', { url: 'http://localhost:9/x', eventos: ['documento.emitido'] }],
      ['GET', '/v1/exportacion?desde=2026-01-01&hasta=2026-12-31'],
      ['PATCH', '/v1/emisores/00000000-0000-4000-8000-000000000000', { telefono: '1' }],
    ] as const) {
      const res = await caja(m, ruta, cuerpo);
      expect(res.status, `${m} ${ruta}`).toBe(403);
    }
    const salto = await emitir(caja, venta('1.00', { confirmarSaltoDeFecha: true }));
    expect(salto.status).toBe(403);
    expect((await json(salto)).error.codigo).toBe('SOLO_ADMIN');
  });

  it('una llave atada a una caja no emite en otra', async () => {
    const { app, admin } = await tenantListo({}, { cajas: ['001', '002'] });
    const caja1 = cliente(app, await crearCaja(admin, '001'));
    const r = await emitir(caja1, venta('1.00', { puntoEmision: '002' }));
    expect(r.status).toBe(403);
    expect((await json(r)).error.codigo).toBe('CAJA_NO_AUTORIZADA');
    // Sin indicar caja usa la suya.
    const ok = await emitir(caja1, { documento: venta().documento });
    expect((await json(ok)).documento.numero).toMatch(/^000-001-01-/);
  });

  it('no se puede revocar la única llave admin', async () => {
    const { admin, llaveAdmin } = await tenantListo();
    const r = await admin('DELETE', `/v1/llaves/${llaveAdmin.split('_')[1]}`);
    expect(r.status).toBe(409);
  });
});

conBase('flujo completo', () => {
  it('emite, consulta en JSON/PDF/HTML/TXT, anula, libro de ventas, exportación, estado del CAI y bitácora', async () => {
    const { admin, emisorId } = await tenantListo();
    const r = await emitir(admin, venta('115.00', { documento: { preciosIncluyenISV: true, lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '115.00' }] } }));
    expect(r.status).toBe(201);
    const doc = (await json(r)).documento;
    expect(doc).toMatchObject({ numero: '000-001-01-00000001', estado: 'EMITIDO', totales: { total: 115, isv15: 15 } });
    expect(doc.emisor.rtn).toBe('99990000000001');

    const pdf = await admin('GET', `/v1/documentos/${doc.numero}.pdf?formato=ticket`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    const html = await admin('GET', `/v1/documentos/${doc.numero}.html`);
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await html.text()).toContain(doc.cai);
    const txt = await (await admin('GET', `/v1/documentos/${doc.numero}.txt?ancho=60`)).text();
    expect(txt).toContain(doc.numero);
    expect((await admin('GET', '/v1/documentos/000-001-01-00000099')).status).toBe(404);

    const anulado = await admin('POST', `/v1/documentos/${doc.numero}/anular`, { motivo: 'Error en el precio' });
    expect(anulado.status).toBe(200);
    expect((await json(anulado)).documento).toMatchObject({ estado: 'ANULADO', numero: doc.numero, totales: { total: 115 } });
    expect(await (await admin('GET', `/v1/documentos/${doc.numero}.txt`)).text()).toContain('ANULADA');
    expect((await admin('POST', `/v1/documentos/${doc.numero}/anular`, { motivo: 'otra vez' })).status).toBe(422);

    const r2 = await emitir(admin, venta('50.00'));
    expect((await json(r2)).documento.numero).toBe('000-001-01-00000002');

    const hoy = doc.fechaEmision;
    const libro = await json(await admin('GET', `/v1/libro-ventas?desde=${hoy}&hasta=${hoy}`));
    expect(libro.filas.map((f: any) => [f.numero, f.anulado, f.total])).toEqual([
      ['000-001-01-00000001', true, 0],
      ['000-001-01-00000002', false, 57.5],
    ]);
    const csv = await admin('GET', `/v1/libro-ventas?desde=${hoy}&hasta=${hoy}&formato=csv`);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect((await csv.text()).split('\n').length).toBeGreaterThanOrEqual(3);

    const exp = await admin('GET', `/v1/exportacion?desde=${hoy}&hasta=${hoy}&formato=jsonl`);
    expect(exp.headers.get('content-disposition')).toContain('attachment');
    expect((await exp.text()).trim().split('\n')).toHaveLength(2); // un documento por línea

    const estado = await json(await admin('GET', `/v1/autorizaciones/${encodeURIComponent(` ${doc.cai.toLowerCase()} `)}/estado`));
    expect(estado.autorizacion.cai).toBe(doc.cai);
    expect(estado.estado).toMatchObject({ vigente: true, siguienteCorrelativo: 3, correlativosRestantes: 998 });

    // La bitácora va del evento más reciente al más antiguo.
    const fiscal = (await json(await admin('GET', '/v1/bitacora'))).eventos.reverse();
    expect(fiscal.map((e: any) => e.tipo)).toEqual(['AUTORIZACION_REGISTRADA', 'AUTORIZACION_REGISTRADA', 'DOCUMENTO_EMITIDO', 'DOCUMENTO_ANULADO', 'DOCUMENTO_EMITIDO']);
    expect(fiscal[3].actor).toMatch(/^llave:[0-9a-f-]{36} \(admin: admin inicial\)$/);
    const api = (await json(await admin('GET', '/v1/bitacora?origen=api'))).eventos.reverse();
    expect(api.map((e: any) => e.accion)).toEqual(['tenant.creado', 'emisor.creado', 'documento.emitido', 'documento.emitido', 'exportacion']);

    const { emisor } = await json(await admin('GET', `/v1/emisores/${emisorId}`));
    expect(emisor.rtn).toBe('99990000000001');
    expect((await admin('PATCH', `/v1/emisores/${emisorId}`, { rtn: '99990000000003' })).status).toBe(422);
    expect((await admin('PATCH', `/v1/emisores/${emisorId}`, { telefono: '0000-0005' })).status).toBe(200);
    // El documento ya emitido no cambia (inmutable).
    expect((await json(await admin('GET', `/v1/documentos/${doc.numero}`))).documento.emisor.telefono).toBe('0000-0003');
  });

  it('reglas fiscales: 422 con la lista de errores; forma inválida: 400; sin emisor: 409', async () => {
    const { admin } = await tenantListo();
    const r = await emitir(admin, venta('-5'));
    expect(r.status).toBe(422);
    const cuerpo = await json(r);
    expect(cuerpo.error.codigo).toBe('VALIDACION');
    expect(cuerpo.errores.length).toBeGreaterThan(0);
    // El número no se consumió.
    expect((await json(await emitir(admin, venta()))).documento.correlativo).toBe(1);

    const forma = await emitir(admin, { documento: { lineas: [] } });
    expect(forma.status).toBe(400);
    expect((await json(forma)).error.codigo).toBe('SOLICITUD_INVALIDA');
    expect((await admin('POST', '/v1/documentos', venta())).status).toBe(400); // sin Idempotency-Key

    const p = await poolPrueba();
    const { crearTenant } = await import('../src/operador');
    const t = await crearTenant(p, { tenant: `sin-emisor-${randomUUID().slice(0, 8)}`, nombre: 'x' });
    const app = crearApp({ pool: p, modo: 'local', rol: ROL });
    expect((await emitir(cliente(app, t.llaveAdmin), venta())).status).toBe(409);
  });

  it('el emisor se valida con las reglas del núcleo', async () => {
    const { admin, emisorId } = await tenantListo();
    const r = await admin('PATCH', `/v1/emisores/${emisorId}`, { correo: 'no-es-correo' });
    expect(r.status).toBe(422);
    expect((await json(r)).errores[0].codigo).toBe('EMISOR_CORREO');
  });

  it('NC sobre una factura del almacén y estado de la serie', async () => {
    const { admin } = await tenantListo();
    const f = (await json(await emitir(admin, venta('100.00', { documento: { cliente: { nombre: 'Cliente', rtn: '99990000000002' }, lineas: [{ descripcion: 'Martillo', cantidad: 2, precioUnitario: '100.00' }] } })))).documento;
    const nc = await emitir(admin, venta('100.00', {
      documento: {
        tipoDocumento: '06', motivo: 'Devolución', cliente: { nombre: 'Cliente', rtn: '99990000000002' },
        referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision },
        lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '100.00' }],
      },
    }));
    expect(nc.status).toBe(201);
    expect((await json(nc)).documento.numero).toBe('000-001-06-00000001');
  });
});

conBase('idempotencia', () => {
  it('reintento con la misma clave: el mismo documento, sin consumir otro número', async () => {
    const { admin } = await tenantListo();
    const clave = randomUUID();
    const a = await emitir(admin, venta(), clave);
    const b = await emitir(admin, venta(), clave);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotency-replayed')).toBe('true');
    expect((await json(b)).documento.numero).toBe((await json(a)).documento.numero);
    // El orden de los campos no cambia la huella.
    const reordenado = { documento: venta().documento, puntoEmision: '001', establecimiento: '000' };
    expect((await emitir(admin, reordenado, clave)).status).toBe(201);
    const otra = await emitir(admin, venta('99.00'), clave);
    expect(otra.status).toBe(422);
    expect((await json(otra)).error.codigo).toBe('IDEMPOTENCIA_CONFLICTO');
    expect((await json(await emitir(admin, venta()))).documento.correlativo).toBe(2);
  });

  it('reintentos concurrentes con la misma clave: un solo documento', async () => {
    const { admin, tenant, pool } = await tenantListo();
    const clave = randomUUID();
    const rs = await Promise.all(Array.from({ length: 12 }, () => emitir(admin, venta(), clave)));
    expect(rs.map((r) => r.status)).toEqual(Array(12).fill(201));
    const numeros = new Set(await Promise.all(rs.map(async (r) => (await json(r)).documento.numero)));
    expect([...numeros]).toEqual(['000-001-01-00000001']);
    const n = await pool.query('SELECT count(*)::int AS n FROM fhn_documentos WHERE tenant = $1', [tenant]);
    expect(n.rows[0].n).toBe(1);
    expect((await json(await emitir(admin, venta()))).documento.correlativo).toBe(2);
  });
});

conBase('emisión concurrente desde varias cajas', () => {
  it('3 cajas × 15 ventas en paralelo (y dos llaves en la misma caja): correlativos sin huecos ni repetidos', async () => {
    const { app, admin, tenant, pool } = await tenantListo({ limiteSolicitudes: { porSegundo: 1000, rafaga: 1000 } }, { cajas: ['001', '002', '003'] });
    const llaves = await Promise.all(['001', '002', '003', '001'].map((p) => crearCaja(admin, p)));
    const cajas = llaves.map((l) => cliente(app, l));
    const rs = await Promise.all(
      cajas.flatMap((caja, i) => Array.from({ length: i === 3 ? 10 : 15 }, () => emitir(caja, { documento: venta().documento }))),
    );
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const filas = await pool.query<{ identificador: string; correlativos: number[] }>(
      'SELECT identificador, array_agg(correlativo ORDER BY correlativo) AS correlativos FROM fhn_documentos WHERE tenant = $1 GROUP BY identificador ORDER BY identificador',
      [tenant],
    );
    const rango = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    expect(filas.rows).toEqual([
      { identificador: '000-001-01', correlativos: rango(25) },
      { identificador: '000-002-01', correlativos: rango(15) },
      { identificador: '000-003-01', correlativos: rango(15) },
    ]);
  });
});

conBase('límites', () => {
  it('límite mensual de documentos: 429 y el número no se consume', async () => {
    const { admin, tenant, pool } = await tenantListo({}, { limiteMensual: 2 });
    expect((await emitir(admin, venta())).status).toBe(201);
    expect((await emitir(admin, venta())).status).toBe(201);
    const r = await emitir(admin, venta());
    expect(r.status).toBe(429);
    expect((await json(r)).error.codigo).toBe('LIMITE_MENSUAL');
    const s = await pool.query("SELECT ultimo FROM fhn_series WHERE tenant = $1 AND identificador = '000-001-01'", [tenant]);
    expect(s.rows[0].ultimo).toBe(2);
  });

  it('límite de solicitudes por llave: 429 con Retry-After', async () => {
    const { llaveAdmin, pool } = await tenantListo();
    const app = crearApp({ pool, modo: 'local', rol: ROL, limiteSolicitudes: { porSegundo: 1, rafaga: 2 } });
    const c = cliente(app, llaveAdmin);
    const rs = await Promise.all([1, 2, 3].map(() => c('GET', '/v1/autorizaciones')));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 429]);
    const r429 = rs.find((r) => r.status === 429)!;
    expect(Number(r429.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  });

  it('cuerpo de más de 512 KB: 413', async () => {
    const { admin } = await tenantListo();
    const r = await emitir(admin, { documento: { lineas: [{ descripcion: 'x'.repeat(600_000), cantidad: 1, precioUnitario: '1' }] } });
    expect(r.status).toBe(413);
  });
});

conBase('inyección y entradas hostiles', () => {
  it('parámetros con SQL no se ejecutan: se rechazan por formato', async () => {
    const { admin } = await tenantListo();
    await emitir(admin, venta());
    for (const ruta of [
      `/v1/documentos/${encodeURIComponent("000-001-01-00000001' OR '1'='1")}`,
      `/v1/documentos?desde=${encodeURIComponent("2026-01-01' OR 1=1--")}&hasta=2026-12-31`,
      `/v1/autorizaciones/${encodeURIComponent("x' OR '1'='1")}/estado`,
      `/v1/series/${encodeURIComponent("000-001-01'; DROP TABLE fhn_documentos;--")}/no-utilizados`,
    ]) {
      const r = await admin('GET', ruta);
      expect([400, 404], ruta).toContain(r.status);
    }
    expect((await admin('GET', '/v1/documentos/000-001-01-00000001')).status).toBe(200);
  });

  it('textos con HTML se escapan en la representación impresa', async () => {
    const { admin } = await tenantListo();
    const d = (await json(await emitir(admin, venta('1.00', { documento: { lineas: [{ descripcion: '<script>alert(1)</script>', cantidad: 1, precioUnitario: '1.00' }] } })))).documento;
    const html = await (await admin('GET', `/v1/documentos/${d.numero}.html`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('un cuerpo que no es UTF-8 válido se rechaza con 400 y no se emite nada', async () => {
    const { app, llaveAdmin } = await tenantListo();
    const texto = JSON.stringify(venta('1.00', { documento: { lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '1.00' }] } }));
    const enviar = (cuerpo: Uint8Array<ArrayBuffer>) => app.request('/v1/documentos', {
      method: 'POST',
      headers: { authorization: `Bearer ${llaveAdmin}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: cuerpo,
    });
    // «é» en Latin-1 (0xE9), como la manda una consola que no usa UTF-8.
    const r = await enviar(new Uint8Array(Buffer.from(texto, 'latin1')));
    expect(r.status).toBe(400);
    expect((await json(r)).error.codigo).toBe('CUERPO_NO_UTF8');
    // El intento rechazado no tomó número: la siguiente emisión es la primera de la serie.
    const ok = await enviar(new TextEncoder().encode(texto));
    expect(ok.status).toBe(201);
    const { documento } = await json(ok);
    expect(documento.numero.endsWith('00000001')).toBe(true);
    expect(documento.lineas[0].descripcion).toBe('Café');
  });

  it('errores internos no filtran detalles', async () => {
    const { llaveAdmin, pool } = await tenantListo();
    const app = crearApp({ pool, modo: 'local', rol: 'rol_que_no_existe', registrar: () => undefined });
    const r = await cliente(app, llaveAdmin)('GET', '/v1/autorizaciones');
    expect(r.status).toBe(500);
    expect(await json(r)).toEqual({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno. Se registró para revisión.' } });
  });
});

conBase('documentación', () => {
  it('sirve /openapi.json, /docs y /salud sin llave', async () => {
    const { app } = await tenantListo();
    const c = cliente(app, null);
    const spec = await json(await c('GET', '/openapi.json'));
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toContain('/v1/documentos/{archivo}');
    expect(spec.components.securitySchemes.llave.scheme).toBe('bearer');
    expect((await c('GET', '/docs')).status).toBe(200);
    expect(await json(await c('GET', '/salud'))).toMatchObject({ ok: true, modo: 'local' });
  });
});

conBase('correcciones de la revisión de seguridad', () => {
  it('intentos con un prefijo conocido y secreto falso: 429 antes de tocar la base y sin marcar último uso', async () => {
    const { llaveAdmin, pool, tenant } = await tenantListo();
    const app = crearApp({ pool, modo: 'local', rol: ROL, limiteSolicitudes: { porSegundo: 1, rafaga: 2 } });
    const falsa = `${llaveAdmin.slice(0, 17)}${'A'.repeat(43)}`;
    const uso = async () => (await pool.query('SELECT ultimo_uso FROM api_llaves WHERE tenant = $1', [tenant])).rows[0].ultimo_uso;
    const antes = await uso();
    const rs = await Promise.all(Array.from({ length: 6 }, () => cliente(app, falsa)('GET', '/v1/autorizaciones')));
    expect(rs.map((r) => r.status).sort()).toEqual([401, 401, 429, 429, 429, 429]);
    // El secreto falso no actualiza el último uso de la llave verdadera.
    expect(await uso()).toEqual(antes);
  });

  it('el esquema Bearer no distingue mayúsculas', async () => {
    const { app, llaveAdmin } = await tenantListo();
    const r = await app.request('/v1/autorizaciones', { headers: { authorization: `bearer ${llaveAdmin}` } });
    expect(r.status).toBe(200);
  });

  it('GET /v1/emisores da el id; un segundo POST responde 409 con el id', async () => {
    const { admin, emisorId } = await tenantListo();
    expect(await json(await admin('GET', '/v1/emisores'))).toMatchObject({ emisores: [{ id: emisorId }], hayMas: false, siguiente: null });
    const r = await admin('POST', '/v1/emisores', { rtn: '99990000000001', razonSocial: 'x', nombreComercial: 'x', direccionCasaMatriz: 'x', direccionEstablecimiento: 'x', telefono: '1', correo: 'a@ejemplo.example' });
    expect(r.status).toBe(409);
    expect((await json(r)).id).toBe(emisorId);
  });

  it('una llave de caja siempre queda atada a un punto de emisión', async () => {
    const { admin } = await tenantListo();
    const r = await admin('POST', '/v1/llaves', { nombre: 'caja suelta', rol: 'caja' });
    expect(r.status).toBe(400);
    expect((await json(r)).error.codigo).toBe('CAJA_INCOMPLETA');
  });

  it('períodos de más de 366 días o invertidos y direcciones vacías se rechazan', async () => {
    const { admin, emisorId } = await tenantListo();
    expect((await admin('GET', '/v1/libro-ventas?desde=2020-01-01&hasta=2026-12-31')).status).toBe(400);
    expect((await admin('GET', '/v1/documentos?desde=2026-12-31&hasta=2026-01-01')).status).toBe(400);
    expect((await admin('PATCH', `/v1/emisores/${emisorId}`, { direccionesEstablecimiento: { '002': '  ' } })).status).toBe(400);
  });

  it('el CSV del libro de ventas no ejecuta fórmulas del nombre del cliente', async () => {
    const { admin } = await tenantListo();
    const cuerpo = venta('1.00', { documento: { cliente: { nombre: '=HYPERLINK("http://x")' }, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1.00' }] } });
    const d = (await json(await emitir(admin, cuerpo))).documento;
    const csv = await (await admin('GET', `/v1/libro-ventas?desde=${d.fechaEmision}&hasta=${d.fechaEmision}&formato=csv`)).text();
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

conBase('modo local', () => {
  it('la demostración va en su propio tenant; el tenant local queda limpio', async () => {
    const pool = await poolPrueba();
    const { iniciarLocal, TENANT_DEMO, TENANT_LOCAL } = await import('../src/operador');
    const yaHabia = (await pool.query('SELECT tenant FROM api_tenants WHERE tenant = ANY($1)', [[TENANT_LOCAL, TENANT_DEMO]])).rows.map((f) => f.tenant);
    const r = await iniciarLocal(pool, { demo: true, rol: ROL });
    expect(Boolean(r.llaveAdmin)).toBe(!yaHabia.includes(TENANT_LOCAL));
    expect(Boolean(r.demo)).toBe(!yaHabia.includes(TENANT_DEMO));
    expect(await iniciarLocal(pool, { demo: true, rol: ROL })).toEqual({});
    const auts = await pool.query('SELECT tenant, count(*)::int AS n FROM fhn_autorizaciones WHERE tenant = ANY($1) GROUP BY tenant', [[TENANT_LOCAL, TENANT_DEMO]]);
    // Si esta llamada creó el tenant local, no le puso datos de demostración.
    if (r.llaveAdmin) expect(auts.rows.find((f) => f.tenant === TENANT_LOCAL)).toBeUndefined();
    expect(auts.rows.find((f) => f.tenant === TENANT_DEMO)?.n).toBe(3);
  });
});

conBase('respuestas uniformes y paginación (DEC-047)', () => {
  it('GET /v1/documentos se recorre por páginas con el cursor, sin repetir ni saltar documentos', async () => {
    const { admin } = await tenantListo({}, { cajas: ['001', '002'] });
    const numeros: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cuerpo = { ...venta(`${i + 1}.00`), puntoEmision: i % 2 ? '002' : '001' };
      numeros.push((await json(await emitir(admin, cuerpo))).documento.numero);
    }
    const hoy = (await json(await admin('GET', `/v1/documentos/${numeros[0]}`))).documento.fechaEmision;
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const r = await admin('GET', `/v1/documentos?desde=${hoy}&hasta=${hoy}&limite=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(r.status).toBe(200);
      const p = await json(r);
      expect(p.documentos.length).toBeLessThanOrEqual(2);
      expect(p.hayMas).toBe(p.siguiente !== null);
      vistos.push(...p.documentos.map((d: any) => d.numero));
      cursor = p.siguiente;
      paginas++;
    } while (cursor);
    expect(paginas).toBe(3);
    expect(vistos).toEqual([...numeros].sort());

    // Sin limite: 100 por defecto, todo en una página.
    expect(await json(await admin('GET', `/v1/documentos?desde=${hoy}&hasta=${hoy}`))).toMatchObject({ hayMas: false, siguiente: null });
    for (const malo of ['no-es-un-cursor', Buffer.from('["x","y"]').toString('base64url'), Buffer.from('1').toString('base64url')]) {
      const r = await admin('GET', `/v1/documentos?desde=${hoy}&hasta=${hoy}&cursor=${malo}`);
      expect(r.status, malo).toBe(400);
      expect((await json(r)).error.codigo).toBe('CURSOR_INVALIDO');
    }
    expect((await admin('GET', `/v1/documentos?desde=${hoy}&hasta=${hoy}&limite=501`)).status).toBe(400);
  });

  it('la bitácora se pagina del evento más reciente al más antiguo', async () => {
    const { admin } = await tenantListo();
    for (let i = 0; i < 3; i++) await emitir(admin, venta());
    const todos = (await json(await admin('GET', '/v1/bitacora'))).eventos as any[];
    expect(todos.map((e) => e.tipo).slice(0, 3)).toEqual(['DOCUMENTO_EMITIDO', 'DOCUMENTO_EMITIDO', 'DOCUMENTO_EMITIDO']);
    const p1 = await json(await admin('GET', '/v1/bitacora?limite=2'));
    expect(p1.hayMas).toBe(true);
    const p2 = await json(await admin('GET', `/v1/bitacora?limite=2&cursor=${p1.siguiente}`));
    expect([...p1.eventos, ...p2.eventos]).toEqual(todos.slice(0, 4));
    const api = await json(await admin('GET', '/v1/bitacora?origen=api&limite=1'));
    expect(api.eventos[0]).toMatchObject({ accion: 'documento.emitido' });
    expect(api.hayMas).toBe(true);
  });

  it('cada recurso va envuelto con su nombre; las listas cortas dicen hayMas: false', async () => {
    const { admin } = await tenantListo();
    const nueva = await json(await admin('POST', '/v1/llaves', { nombre: 'caja 9', rol: 'caja', establecimiento: '000', puntoEmision: '009' }));
    expect(Object.keys(nueva).sort()).toEqual(['llave', 'secreto']);
    expect(nueva.secreto).toMatch(new RegExp(`^fhn_${nueva.llave.prefijo}_`));
    expect(Object.keys(await json(await admin('DELETE', `/v1/llaves/${nueva.llave.prefijo}`)))).toEqual(['llave']);
    const hook = await json(await admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/x', eventos: ['documento.emitido'] }));
    expect(Object.keys(hook).sort()).toEqual(['secreto', 'webhook']);
    expect(Object.keys(await json(await admin('DELETE', `/v1/webhooks/${hook.webhook.id}`)))).toEqual(['webhook']);
    for (const [ruta, nombre] of [['/v1/llaves', 'llaves'], ['/v1/webhooks', 'webhooks'], ['/v1/autorizaciones', 'autorizaciones'], ['/v1/emisores', 'emisores']]) {
      const lista = await json(await admin('GET', ruta!));
      expect(Object.keys(lista).sort(), ruta).toEqual([nombre!, 'hayMas', 'siguiente'].sort());
      expect(lista).toMatchObject({ hayMas: false, siguiente: null });
    }
  });
});
