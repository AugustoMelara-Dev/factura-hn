/**
 * Documentos de prueba fuera de los reportes fiscales: la exportación (CSV, TXT, JSONL) y el libro de ventas
 * (JSON y CSV) de la API no los incluyen. El tope, el encabezado de `txt` y la bitácora cuentan solo los
 * reales. El tenant demo, todo de prueba, exporta archivos vacíos con el aviso. Requiere FHN_PG_URL.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { exportarTexto, libroVentas, libroVentasCSV, LEYENDA_PRUEBA, type DocumentoFiscal } from 'factura-hn';
import { caiDemo } from 'factura-hn/demo';
import { crearApp } from '../src/app';
import { crearLlaveDemo, iniciarLocal, TENANT_DEMO } from '../src/operador';
import { cerrarPool, cliente, FECHA_LIMITE, poolPrueba, ROL, tenantListo, URL_PG, venta } from './ayuda';

afterAll(cerrarPool);

const sinLimite = { limiteSolicitudes: { porSegundo: 1000, rafaga: 1000 } };
const json = async (r: Response) => (await r.json()) as any;
/** El cuerpo con el BOM del CSV (Response.text() lo quita). */
const bytes = async (r: Response) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());

describe.skipIf(!URL_PG)('documentos de prueba fuera de los reportes', () => {
  /** Tenant con una caja real (000-001) y una de prueba (000-002, CAI ficticio): 2 documentos reales y 1 de prueba. */
  async function conPrueba(config = {}) {
    const t = await tenantListo({ ...sinLimite, ...config });
    const a = await t.admin('POST', '/v1/autorizaciones', {
      cai: caiDemo('01'), tipoDocumento: '01', establecimiento: '000', puntoEmision: '002',
      rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: FECHA_LIMITE, prueba: true,
    });
    expect(a.status).toBe(201);
    const docs: DocumentoFiscal[] = [];
    for (const [clave, cuerpo] of [['r1', venta('100.00')], ['p1', venta('50.00', { puntoEmision: '002' })], ['r2', venta('200.00')]] as const) {
      const r = await t.admin('POST', '/v1/documentos', cuerpo, { 'idempotency-key': `${clave}-${Date.now()}` });
      expect(r.status).toBe(201);
      docs.push((await json(r)).documento);
    }
    const prueba = docs[1]!;
    expect(prueba.modo).toBe('prueba');
    const dia = docs[0]!.fechaEmision;
    return { ...t, docs, prueba, periodo: `desde=${dia}&hasta=${dia}` };
  }

  it('la exportación no lleva los documentos de prueba y el txt cuenta solo los reales', async () => {
    const { admin, docs, prueba, periodo } = await conPrueba();
    for (const formato of ['jsonl', 'csv', 'txt'] as const) {
      const r = await admin('GET', `/v1/exportacion?${periodo}&formato=${formato}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('documentos-prueba-excluidos')).toBe('1');
      const texto = await bytes(r);
      // Igual a exportarTexto del núcleo con todos los documentos: el núcleo también deja fuera los de prueba.
      expect(texto).toBe(exportarTexto(docs, { formato }));
      expect(texto).not.toContain(prueba.numero);
      if (formato === 'txt') expect(texto.split('\n')[0]).toMatch(/\|2$/);
    }
    const eventos = (await json(await admin('GET', '/v1/bitacora?origen=api'))).eventos.filter((e: any) => e.accion === 'exportacion');
    expect(eventos.length).toBe(3);
    expect(eventos.every((e: any) => e.detalle.documentos === 2 && e.detalle.pruebaExcluidos === 1)).toBe(true);
  });

  it('el libro de ventas (JSON y CSV) no lleva los documentos de prueba y dice cuántos quedaron fuera', async () => {
    const { admin, docs, prueba, periodo } = await conPrueba();
    const esperado = libroVentas(docs);
    expect(esperado.excluidos).toBe(1);
    const r = await admin('GET', `/v1/libro-ventas?${periodo}`);
    expect(r.headers.get('documentos-prueba-excluidos')).toBe('1');
    const libro = await json(r);
    expect(libro.filas).toEqual(JSON.parse(JSON.stringify(esperado.filas)));
    expect(libro.resumen).toEqual(JSON.parse(JSON.stringify(esperado.resumen)));
    expect(libro.excluidos).toBe(1);
    expect(libro.aviso).toContain(LEYENDA_PRUEBA);
    const csv = await admin('GET', `/v1/libro-ventas?${periodo}&formato=csv`);
    expect(csv.headers.get('documentos-prueba-excluidos')).toBe('1');
    const texto = await bytes(csv);
    expect(texto).toBe(libroVentasCSV(esperado.filas));
    expect(texto).not.toContain(prueba.numero);
  });

  it('el tope cuenta solo los documentos reales', async () => {
    const { admin, periodo } = await conPrueba({ maxDocumentosReporte: 2 });
    for (const ruta of [`/v1/libro-ventas?${periodo}`, `/v1/exportacion?${periodo}&formato=txt`]) {
      const r = await admin('GET', ruta);
      expect(r.status).toBe(200);
      await r.text();
    }
    // Un tercer documento real sí pasa el tope.
    expect((await admin('POST', '/v1/documentos', venta('10.00'), { 'idempotency-key': `r3-${Date.now()}` })).status).toBe(201);
    const r = await admin('GET', `/v1/libro-ventas?${periodo}`);
    expect(r.status).toBe(422);
    expect((await json(r)).error.codigo).toBe('PERIODO_DEMASIADO_GRANDE');
  });

  it('sin documentos de prueba, la cabecera dice 0 y el libro no lleva aviso', async () => {
    const { admin } = await tenantListo(sinLimite);
    const d = (await json(await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': `s-${Date.now()}` }))).documento;
    const r = await admin('GET', `/v1/libro-ventas?desde=${d.fechaEmision}&hasta=${d.fechaEmision}`);
    expect(r.headers.get('documentos-prueba-excluidos')).toBe('0');
    const libro = await json(r);
    expect(libro).toMatchObject({ excluidos: 0 });
    expect(libro.aviso).toBeUndefined();
  });

  it('el tenant demo, todo de prueba, exporta vacío con el aviso; sus CAI ficticios llevan prueba: true', async () => {
    const pool = await poolPrueba();
    const creado = await iniciarLocal(pool, { demo: true, rol: ROL });
    if (creado.demo) {
      const auts = await pool.query("SELECT datos->>'prueba' AS prueba FROM fhn_autorizaciones WHERE tenant = $1", [TENANT_DEMO]);
      expect(auts.rows.map((f) => f.prueba)).toEqual(['true', 'true', 'true']);
    }
    const app = crearApp({ pool, modo: 'local', rol: ROL, registrar: () => undefined, ...sinLimite });
    const caja = cliente(app, await crearLlaveDemo(pool));
    const admin = cliente(app, await crearLlaveDemo(pool, { rol: 'admin' }));
    const e = await caja('POST', '/v1/documentos', venta('25.00'), { 'idempotency-key': `demo-${Date.now()}` });
    expect(e.status).toBe(201);
    const doc = (await json(e)).documento;
    expect(doc.modo).toBe('prueba');
    const periodo = `desde=${doc.fechaEmision}&hasta=${doc.fechaEmision}`;
    const txt = await admin('GET', `/v1/exportacion?${periodo}&formato=txt`);
    expect(Number(txt.headers.get('documentos-prueba-excluidos'))).toBeGreaterThanOrEqual(1);
    expect((await txt.text()).split('\n')[0]).toMatch(/\|0$/);
    const jsonl = await admin('GET', `/v1/exportacion?${periodo}`);
    expect(await jsonl.text()).toBe('');
    const libro = await json(await admin('GET', `/v1/libro-ventas?${periodo}`));
    expect(libro.filas).toEqual([]);
    expect(libro.excluidos).toBeGreaterThanOrEqual(1);
    expect(libro.aviso).toContain(LEYENDA_PRUEBA);
  });

  it('no utilizados: una serie de prueba no tiene rangos por reportar al SAR y lo avisa', async () => {
    const { admin } = await conPrueba();
    const prueba = await json(await admin('GET', '/v1/series/000-002-01/no-utilizados'));
    expect(prueba.rangos).toEqual([]);
    expect(prueba.aviso).toContain('no se reporta al SAR');
    const real = await json(await admin('GET', '/v1/series/000-001-01/no-utilizados'));
    expect(real.aviso).toBeUndefined();
  });

  it('POST /v1/autorizaciones: de demo a real en el mismo punto se acepta y retira la demo; de real a demo, no', async () => {
    const { admin } = await tenantListo(sinLimite);
    const punto = { tipoDocumento: '01', establecimiento: '000', puntoEmision: '004', fechaLimiteEmision: FECHA_LIMITE };
    expect((await admin('POST', '/v1/autorizaciones', { ...punto, cai: caiDemo('01'), rangoInicial: 1, rangoFinal: 100, prueba: true })).status).toBe(201);
    const real = await admin('POST', '/v1/autorizaciones', { ...punto, cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-04', rangoInicial: 1, rangoFinal: 500 });
    expect(real.status).toBe(201);
    const e = await admin('POST', '/v1/documentos', venta('10.00', { puntoEmision: '004' }), { 'idempotency-key': `dr-${Date.now()}` });
    expect(e.status).toBe(201);
    const doc = (await json(e)).documento;
    expect(doc).toMatchObject({ cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-04', correlativo: 1 });
    expect(doc.modo).toBeUndefined();
    const otra = await admin('POST', '/v1/autorizaciones', { ...punto, tipoDocumento: '06', cai: caiDemo('06'), rangoInicial: 1, rangoFinal: 100, prueba: true });
    expect(otra.status).toBe(422);
    expect((await json(otra)).errores).toMatchObject([{ codigo: 'AUTORIZACION_MODO_MEZCLADO' }]);
  });

  it('POST /v1/autorizaciones: un CAI ficticio necesita prueba: true; el tenant demo no acepta CAI reales', async () => {
    const { admin } = await tenantListo(sinLimite);
    const aut = { cai: caiDemo('01'), tipoDocumento: '01', establecimiento: '000', puntoEmision: '003', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: FECHA_LIMITE };
    const sin = await admin('POST', '/v1/autorizaciones', aut);
    expect(sin.status).toBe(422);
    const e = await json(sin);
    expect(e.error).toMatchObject({ codigo: 'AUTORIZACION_DEMO_SIN_PRUEBA', solucion: expect.stringContaining('"prueba": true') });
    expect(e.error.documentacion).toMatch(/errores\.md#autorizacion_demo_sin_prueba$/);
    expect(e.errores).toMatchObject([{ codigo: 'AUTORIZACION_DEMO_SIN_PRUEBA', campo: 'prueba' }]);
    const con = await admin('POST', '/v1/autorizaciones', { ...aut, prueba: true });
    expect(con.status).toBe(201);
    expect((await json(con)).autorizacion.prueba).toBe(true);

    const pool = await poolPrueba();
    await iniciarLocal(pool, { demo: true, rol: ROL });
    const app = crearApp({ pool, modo: 'local', rol: ROL, registrar: () => undefined, ...sinLimite });
    const demo = cliente(app, await crearLlaveDemo(pool, { rol: 'admin' }));
    const real = await demo('POST', '/v1/autorizaciones', { ...aut, cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', puntoEmision: '009' });
    expect(real.status).toBe(422);
    expect((await json(real)).error).toMatchObject({ codigo: 'AUTORIZACION_REAL_EN_DEMO', documentacion: expect.stringMatching(/#autorizacion_real_en_demo$/) });
  });
});
