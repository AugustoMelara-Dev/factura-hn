/**
 * Reportes de período acotados en memoria y en conexiones (libro de ventas, exportación, no utilizados): cupos
 * por tenant y por proceso, plazo total, tope de documentos y la misma salida, byte por byte, que cuando se
 * armaban en memoria. Requiere FHN_PG_URL.
 */
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AlmacenPostgres } from '@factura-hn/postgres';
import { fechaHonduras, filaLibroVentas, noUtilizadosDelAlmacen, type AlmacenFiscal, type DocumentoFiscal, type FormatoExportacion } from 'factura-hn';
import { crearApp } from '../src/app';
import { exportarTextoAnterior } from '../../core/test/exportacion-anterior';
import { libroVentasCSVAnterior, resumenVentasAnterior } from '../../core/test/libro-anterior';
import { cerrarPool, cliente, crearCaja, fechaEn, poolPrueba, ROL, tenantListo, URL_PG, venta, type Cliente } from './ayuda';

afterAll(cerrarPool);

const sinLimite = { limiteSolicitudes: { porSegundo: 1000, rafaga: 1000 } };
const json = async (r: Response) => (await r.json()) as any;
const emitir = (c: Cliente, cuerpo: unknown, clave: string) => c('POST', '/v1/documentos', cuerpo, { 'idempotency-key': clave });
const HOY = fechaHonduras();
const PERIODO = `desde=${diasAntes(HOY, 300)}&hasta=${HOY}`;
/** Repite la solicitud hasta obtener `estado` (los cupos se liberan cuando la transacción termina, un instante después). */
async function hastaEstado(pedir: () => Promise<Response>, estado: number): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await pedir();
    if (r.status === estado || i === 100) return r;
    await r.text();
    await new Promise((res) => setTimeout(res, 20));
  }
}
/** Documento grande: la exportación `jsonl` pasa de una parte de 64 KB y retiene la transacción hasta que se lee. */
const lineasGrandes = Array.from({ length: 200 }, (_, i) => ({ descripcion: `${i}`.padEnd(300, 'x'), cantidad: 1, precioUnitario: '1.00' }));

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
    expect((await hastaEstado(() => admin('GET', `/v1/series/000-001-01/no-utilizados`), 200)).status).toBe(200);
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

    // Libro: los mismos bytes que `c.json({ filas, resumen })` y que `libroVentasCSV(filas)` de antes.
    const filas = docs.map(filaLibroVentas);
    const libro = await admin('GET', `/v1/libro-ventas?${PERIODO}`);
    expect(libro.headers.get('content-type')).toBe('application/json');
    expect(await libro.text()).toBe(JSON.stringify({ filas, resumen: resumenVentasAnterior(filas) }));
    const csv = await admin('GET', `/v1/libro-ventas?${PERIODO}&formato=csv`);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(Buffer.from(await csv.arrayBuffer()).equals(Buffer.from(libroVentasCSVAnterior(filas), 'utf8'))).toBe(true);
    // Sin documentos también.
    const vacio = `desde=${diasAntes(HOY, 60)}&hasta=${diasAntes(HOY, 31)}`;
    expect(await (await admin('GET', `/v1/libro-ventas?${vacio}`)).text()).toBe(JSON.stringify({ filas: [], resumen: resumenVentasAnterior([]) }));
    const csvVacio = Buffer.from(await (await admin('GET', `/v1/libro-ventas?${vacio}&formato=csv`)).arrayBuffer());
    expect(csvVacio.equals(Buffer.from(libroVentasCSVAnterior([]), 'utf8'))).toBe(true);
  }, 120_000);

  it('no utilizados: lee solo correlativos y da lo mismo que con los documentos completos', async () => {
    const { admin, tenant, pool } = await tenantListo(sinLimite);
    for (let i = 0; i < 3; i++) expect((await emitir(admin, venta(), `nu-${i}`)).status).toBe(201);
    expect((await admin('GET', '/v1/series/000-001-01/no-utilizados')).status).toBe(200);
    const almacen = new AlmacenPostgres(pool, { tenant });
    expect(await almacen.transaccion((tx) => tx.correlativos!('000-001-01'))).toEqual([1, 2, 3]);
    // Sin `correlativos` el núcleo recurre a los documentos completos: el resultado debe ser el mismo.
    const sinProyeccion: AlmacenFiscal = { transaccion: (fn) => almacen.transaccion((tx) => fn({ ...tx, correlativos: undefined })) };
    // Antes de la fecha límite, con un evento (causal 5); después, por vencimiento.
    for (const [hoy, conEvento] of [[fechaEn(7), true], [fechaEn(320), false]] as const) {
      const proyectado = await noUtilizadosDelAlmacen(almacen, '000-001-01', { hoy, evento: conEvento ? { causal: 5, fecha: hoy } : undefined });
      const completo = await noUtilizadosDelAlmacen(sinProyeccion, '000-001-01', { hoy, evento: conEvento ? { causal: 5, fecha: hoy } : undefined });
      expect(proyectado).toEqual(completo);
      expect(proyectado.map((r) => [r.desde, r.hasta])).toEqual([[4, 1000]]);
    }
  }, 60_000);

  it('reportes sin leer de otros tenants no dejan sin conexiones al resto (pool de 4)', async () => {
    const chico = new pg.Pool({ connectionString: URL_PG, max: 4 });
    try {
      const a = await tenantListo(sinLimite);
      const b = await tenantListo(sinLimite);
      const c = await tenantListo(sinLimite);
      for (const t of [a, b]) for (let i = 0; i < 3; i++) {
        const r = await emitir(t.admin, venta('1.00', { documento: { lineas: lineasGrandes } }), `pool-${i}`);
        expect(r.status, await r.clone().text()).toBe(201);
      }
      expect((await emitir(c.admin, venta(), 'pool-c')).status).toBe(201);
      // Una sola API sobre el pool chico, como un proceso compartido por los tres tenants.
      const app = crearApp({ pool: chico, modo: 'local', rol: ROL, registrar: () => undefined, ...sinLimite });
      const [ka, kb, kc] = [cliente(app, a.llaveAdmin), cliente(app, b.llaveAdmin), cliente(app, c.llaveAdmin)];
      const abiertas = [
        await ka('GET', `/v1/exportacion?${PERIODO}`), await ka('GET', `/v1/exportacion?${PERIODO}&formato=csv`),
        await kb('GET', `/v1/exportacion?${PERIODO}`), await kb('GET', `/v1/libro-ventas?${PERIODO}`),
      ];
      // Un cuarto del pool: un solo reporte en curso en el proceso; los demás, 429.
      expect(abiertas.map((r) => r.status)).toEqual([200, 429, 429, 429]);
      expect((await json(abiertas[2]!)).error.codigo).toBe('LIMITE_SOLICITUDES');
      // El resto de la API sigue respondiendo a tiempo.
      const inicio = Date.now();
      for (let i = 0; i < 5; i++) expect((await kc('GET', '/v1/autorizaciones')).status).toBe(200);
      expect(Date.now() - inicio).toBeLessThan(3_000);
      // Al leer la exportación abierta, el cupo vuelve y la salida está completa.
      expect((await abiertas[0]!.text()).trim().split('\n')).toHaveLength(3);
      expect((await hastaEstado(() => kc('GET', `/v1/libro-ventas?${PERIODO}`), 200)).status).toBe(200);
    } finally {
      await chico.end();
    }
  }, 60_000);

  it('plazo total: una exportación que nadie lee se corta con error y libera la conexión y el cupo', async () => {
    const chico = new pg.Pool({ connectionString: URL_PG, max: 4 });
    try {
      const a = await tenantListo(sinLimite);
      for (let i = 0; i < 3; i++) expect((await emitir(a.admin, venta('1.00', { documento: { lineas: lineasGrandes } }), `plazo-${i}`)).status).toBe(201);
      const app = crearApp({ pool: chico, modo: 'local', rol: ROL, registrar: () => undefined, duracionMaxReporteMs: 300, ...sinLimite });
      const ka = cliente(app, a.llaveAdmin);
      const sinLeer = await ka('GET', `/v1/exportacion?${PERIODO}`);
      expect(sinLeer.status).toBe(200);
      expect((await ka('GET', `/v1/libro-ventas?${PERIODO}`)).status).toBe(429);
      await new Promise((r) => setTimeout(r, 500));
      expect(chico.totalCount - chico.idleCount).toBe(0); // ninguna conexión retenida
      await expect(sinLeer.text()).rejects.toThrow(); // cortada con error, no truncada en silencio
      const r = await hastaEstado(() => ka('GET', `/v1/exportacion?${PERIODO}&formato=txt`), 200);
      expect(r.status).toBe(200);
      expect((await r.text()).startsWith('#factura-hn|v1|3\n')).toBe(true);
    } finally {
      await chico.end();
    }
  }, 60_000);

  it('con un pool de 1 conexión los tres reportes terminan (ninguno pide una segunda conexión)', async () => {
    const uno = new pg.Pool({ connectionString: URL_PG, max: 1 });
    const aTiempo = <T>(p: Promise<T>, que: string) =>
      Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`colgado: ${que}`)), 10_000))]);
    try {
      const a = await tenantListo(sinLimite);
      for (let i = 0; i < 3; i++) expect((await emitir(a.admin, venta('1.00', { documento: { lineas: lineasGrandes } }), `uno-${i}`)).status).toBe(201);
      const app = crearApp({ pool: uno, modo: 'local', rol: ROL, registrar: () => undefined, ...sinLimite });
      const ka = cliente(app, a.llaveAdmin);
      for (const ruta of [
        `/v1/exportacion?${PERIODO}`, `/v1/exportacion?${PERIODO}&formato=csv`, `/v1/exportacion?${PERIODO}&formato=txt`,
        `/v1/libro-ventas?${PERIODO}`, `/v1/libro-ventas?${PERIODO}&formato=csv`, '/v1/series/000-001-01/no-utilizados',
      ]) {
        const texto = await aTiempo((async () => {
          const r = await ka('GET', ruta);
          expect(r.status, ruta).toBe(200);
          return r.text();
        })(), ruta);
        expect(texto.length, ruta).toBeGreaterThan(0);
      }
      // La bitácora registra cada exportación con el conteo de la misma lectura.
      const eventos = (await json(await aTiempo(ka('GET', '/v1/bitacora?origen=api'), 'bitácora'))).eventos as Array<{ accion: string; detalle: Record<string, unknown> }>;
      const exportaciones = eventos.filter((e) => e.accion === 'exportacion');
      expect(exportaciones.map((e) => [e.detalle.formato, e.detalle.documentos, e.detalle.completo])).toEqual([['txt', 3, undefined], ['csv', 3, undefined], ['jsonl', 3, undefined]]);
      // Más reportes por proceso que conexiones libres: se rechaza al crear la app.
      expect(() => crearApp({ pool: uno, modo: 'local', rol: ROL, reportesSimultaneosProceso: 2 })).toThrow(/no puede pasar de 1/);
    } finally {
      await uno.end();
    }
  }, 60_000);

  it('si la base corta la conexión de un reporte transmitido, el proceso sigue, la respuesta falla y todo se libera', async () => {
    const nombre = `fhn-corte-${Date.now().toString(36)}`;
    const propio = new pg.Pool({ connectionString: URL_PG, max: 4, application_name: nombre });
    const noCapturadas: unknown[] = [];
    const alNoCapturada = (e: unknown) => noCapturadas.push(e);
    process.on('uncaughtException', alNoCapturada);
    try {
      const a = await tenantListo(sinLimite);
      for (let i = 0; i < 3; i++) expect((await emitir(a.admin, venta('1.00', { documento: { lineas: lineasGrandes } }), `corte-${i}`)).status).toBe(201);
      const registros: string[] = [];
      const app = crearApp({ pool: propio, modo: 'local', rol: ROL, registrar: (m) => registros.push(m), ...sinLimite });
      const ka = cliente(app, a.llaveAdmin);
      const r = await ka('GET', `/v1/exportacion?${PERIODO}`);
      expect(r.status).toBe(200);
      // La transacción del reporte espera al cliente: está «idle in transaction».
      const admin = await poolPrueba();
      let pid: number | undefined;
      for (let i = 0; i < 100 && pid === undefined; i++) {
        pid = (await admin.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND state = 'idle in transaction'", [nombre],
        )).rows[0]?.pid;
        if (pid === undefined) await new Promise((res) => setTimeout(res, 20));
      }
      expect(pid).toBeDefined();
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      await new Promise((res) => setTimeout(res, 300));
      await expect(r.text()).rejects.toThrow(); // cortada con error, no truncada en silencio
      expect(registros).toContain('Error al transmitir un reporte');
      // Cupo y conexión liberados: la siguiente exportación sale completa.
      const otra = await hastaEstado(() => ka('GET', `/v1/exportacion?${PERIODO}&formato=txt`), 200);
      expect(otra.status).toBe(200);
      expect((await otra.text()).startsWith('#factura-hn|v1|3\n')).toBe(true);
      expect(noCapturadas).toEqual([]);
    } finally {
      process.off('uncaughtException', alNoCapturada);
      await propio.end();
    }
  }, 60_000);
});

/** `dias` días antes de `fecha` (YYYY-MM-DD). */
function diasAntes(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
