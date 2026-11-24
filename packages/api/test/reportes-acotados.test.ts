/**
 * Reportes de período acotados en memoria (libro de ventas, exportación, no utilizados): cupos por tenant,
 * tope de documentos y la misma salida que antes de leer por páginas. Requiere FHN_PG_URL.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { AlmacenPostgres } from '@factura-hn/postgres';
import { fechaHonduras, filaLibroVentas, noUtilizadosDelAlmacen, resumenVentas, type AlmacenFiscal, type DocumentoFiscal, type FormatoExportacion } from 'factura-hn';
import { exportarTextoAnterior } from '../../core/test/exportacion-anterior';
import { cerrarPool, cliente, crearCaja, tenantListo, URL_PG, venta, type Cliente } from './ayuda';

afterAll(cerrarPool);

const sinLimite = { limiteSolicitudes: { porSegundo: 1000, rafaga: 1000 } };
const json = async (r: Response) => (await r.json()) as any;
const emitir = (c: Cliente, cuerpo: unknown, clave: string) => c('POST', '/v1/documentos', cuerpo, { 'idempotency-key': clave });
const HOY = fechaHonduras();
const PERIODO = `desde=${diasAntes(HOY, 300)}&hasta=${HOY}`;

describe.skipIf(!URL_PG)('reportes acotados en memoria', () => {
  it('una llave de caja no puede materializar el período completo muchas veces a la vez', async () => {
    const { app, admin } = await tenantListo(sinLimite, { rangoFinal: 5000 });
    const caja = cliente(app, await crearCaja(admin, '001'));
    // Documentos grandes: 200 líneas de 300 caracteres cada uno.
    const lineas = Array.from({ length: 200 }, (_, i) => ({ descripcion: `${i}`.padEnd(300, 'x'), cantidad: 1, precioUnitario: '1.00' }));
    const cuerpo = { establecimiento: '000', puntoEmision: '001', documento: { lineas } };
    for (let i = 0; i < 20; i++) expect((await emitir(caja, cuerpo, `rep-${i}`)).status).toBe(201);
    const rs = await Promise.all(Array.from({ length: 10 }, () => caja('GET', `/v1/libro-ventas?${PERIODO}`)));
    const textos = await Promise.all(rs.map((r) => r.text()));
    const estados = rs.map((r) => r.status);
    expect(estados.filter((s) => s === 200).length).toBeLessThan(10);
    expect(estados.filter((s) => s === 200).length).toBeGreaterThan(0);
    expect(estados.every((s) => s === 200 || s === 429)).toBe(true);
    const rechazada = rs.findIndex((r) => r.status === 429);
    expect(rs[rechazada]!.headers.get('retry-after')).toBe('1');
    expect(JSON.parse(textos[rechazada]!).error.codigo).toBe('LIMITE_SOLICITUDES');
    // Con las respuestas leídas, los cupos quedan libres.
    expect((await caja('GET', `/v1/libro-ventas?${PERIODO}`)).status).toBe(200);
  }, 60_000);

  it('429 mientras dos exportaciones transmitidas siguen abiertas; al leerlas, el cupo vuelve', async () => {
    const { admin } = await tenantListo(sinLimite);
    for (let i = 0; i < 3; i++) expect((await emitir(admin, venta(), `exp-${i}`)).status).toBe(201);
    const a = await admin('GET', `/v1/exportacion?${PERIODO}&formato=csv`);
    const b = await admin('GET', `/v1/exportacion?${PERIODO}&formato=txt`);
    expect([a.status, b.status]).toEqual([200, 200]);
    const tercera = await admin('GET', `/v1/series/000-001-01/no-utilizados`);
    expect(tercera.status).toBe(429);
    expect(tercera.headers.get('retry-after')).toBe('1');
    expect((await json(tercera)).error.codigo).toBe('LIMITE_SOLICITUDES');
    // Otro tenant no comparte los cupos.
    const otro = await tenantListo(sinLimite);
    expect((await otro.admin('GET', `/v1/libro-ventas?${PERIODO}`)).status).toBe(200);
    expect((await a.text()).split('\n')).toHaveLength(5); // encabezado, 3 filas y la línea vacía final
    await b.body!.cancel(); // el cliente corta: también libera
    expect((await admin('GET', `/v1/series/000-001-01/no-utilizados`)).status).toBe(200);
    expect((await admin('GET', `/v1/exportacion?${PERIODO}`)).status).toBe(200);
  }, 60_000);

  it('422 PERIODO_DEMASIADO_GRANDE por encima del tope, antes de leer documentos', async () => {
    const { admin } = await tenantListo({ ...sinLimite, maxDocumentosReporte: 3 });
    for (let i = 0; i < 3; i++) expect((await emitir(admin, venta(), `tope-${i}`)).status).toBe(201);
    for (const ruta of [`/v1/libro-ventas?${PERIODO}`, `/v1/exportacion?${PERIODO}`]) {
      const r = await admin('GET', ruta);
      expect(r.status).toBe(200);
      await r.text(); // leer la respuesta libera el cupo
    }
    expect((await emitir(admin, venta(), 'tope-3')).status).toBe(201);
    for (const ruta of [`/v1/libro-ventas?${PERIODO}`, `/v1/libro-ventas?${PERIODO}&formato=csv`, `/v1/exportacion?${PERIODO}&formato=txt`]) {
      const r = await admin('GET', ruta);
      expect(r.status, ruta).toBe(422);
      const cuerpo = await json(r);
      expect(cuerpo.error.codigo).toBe('PERIODO_DEMASIADO_GRANDE');
      expect(cuerpo.error.mensaje).toMatch(/4 documentos.*máximo por reporte es 3/);
      expect(cuerpo).toMatchObject({ documentos: 4, maximo: 3 });
    }
    // Un período más corto cabe.
    expect((await admin('GET', `/v1/libro-ventas?desde=${diasAntes(HOY, 30)}&hasta=${diasAntes(HOY, 1)}`)).status).toBe(200);
  }, 60_000);

  it('factura, nota de crédito y anulado en varias páginas: exportación idéntica byte por byte y libro con los mismos totales', async () => {
    const { admin, tenant, pool } = await tenantListo(sinLimite);
    const cliente1 = { nombre: 'Constructora "El Roble", S. de R.L. | Ciudad Ejemplo', rtn: '99990000000002' };
    // 55 facturas: más de una página de documentos completos (50).
    const facturas: DocumentoFiscal[] = [];
    for (let i = 0; i < 55; i++) {
      const r = await emitir(admin, venta(`${10 + i}.25`, { documento: { cliente: i % 2 ? cliente1 : undefined, lineas: [{ descripcion: 'Martillo', cantidad: 1 + (i % 3), precioUnitario: `${10 + i}.25` }] } }), `mix-${i}`);
      expect(r.status).toBe(201);
      facturas.push((await json(r)).documento);
    }
    const f = facturas[1]!;
    const nc = await emitir(admin, venta('10.00', {
      documento: {
        tipoDocumento: '06', motivo: 'Devolución', cliente: cliente1,
        referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision },
        lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '10.00' }],
      },
    }), 'mix-nc');
    expect(nc.status).toBe(201);
    expect((await admin('POST', `/v1/documentos/${facturas[2]!.numero}/anular`, { motivo: 'Error | de precio' })).status).toBe(200);

    const docs = await new AlmacenPostgres(pool, { tenant }).transaccion((tx) => tx.documentos({ desde: diasAntes(HOY, 300), hasta: HOY }));
    expect(docs).toHaveLength(56);
    expect(docs.filter((d) => d.estado === 'ANULADO')).toHaveLength(1);
    expect(docs.filter((d) => d.tipoDocumento === '06')).toHaveLength(1);
    for (const formato of ['jsonl', 'csv', 'txt'] as FormatoExportacion[]) {
      const r = await admin('GET', `/v1/exportacion?${PERIODO}&formato=${formato}`);
      expect(r.status).toBe(200);
      const bytes = Buffer.from(await r.arrayBuffer());
      expect(bytes.equals(Buffer.from(exportarTextoAnterior(docs, { formato }), 'utf8')), formato).toBe(true);
    }

    const filas = docs.map(filaLibroVentas);
    const libro = await json(await admin('GET', `/v1/libro-ventas?${PERIODO}`));
    expect(libro.filas).toEqual(JSON.parse(JSON.stringify(filas)));
    expect(libro.resumen).toEqual(resumenVentas(filas));
  }, 120_000);

  it('no utilizados: lee solo correlativos y da lo mismo que con los documentos completos', async () => {
    const { admin, tenant, pool } = await tenantListo(sinLimite);
    for (let i = 0; i < 3; i++) expect((await emitir(admin, venta(), `nu-${i}`)).status).toBe(201);
    expect((await admin('GET', '/v1/series/000-001-01/no-utilizados')).status).toBe(200);
    const almacen = new AlmacenPostgres(pool, { tenant });
    expect(await almacen.transaccion((tx) => tx.correlativos!('000-001-01'))).toEqual([1, 2, 3]);
    // Sin `correlativos` el núcleo recurre a los documentos completos: el resultado debe ser el mismo.
    const sinProyeccion: AlmacenFiscal = { transaccion: (fn) => almacen.transaccion((tx) => fn({ ...tx, correlativos: undefined })) };
    for (const hoy of ['2026-12-01', '2027-11-20']) {
      const proyectado = await noUtilizadosDelAlmacen(almacen, '000-001-01', { hoy, evento: hoy < '2027' ? { causal: 5, fecha: hoy } : undefined });
      const completo = await noUtilizadosDelAlmacen(sinProyeccion, '000-001-01', { hoy, evento: hoy < '2027' ? { causal: 5, fecha: hoy } : undefined });
      expect(proyectado).toEqual(completo);
      expect(proyectado.map((r) => [r.desde, r.hasta])).toEqual([[4, 1000]]);
    }
  }, 60_000);
});

/** `dias` días antes de `fecha` (YYYY-MM-DD). */
function diasAntes(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
