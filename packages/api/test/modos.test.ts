/**
 * Modos de tenant y llaves `fhn_live_` / `fhn_test_` (api-rest.md §4.3), y el libro de ventas con llave de caja.
 * Las pruebas de formato no usan la base; las demás requieren FHN_PG_URL.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { libroVentas, libroVentasCSV, registrarAutorizacion, type AutorizacionCAI, type DocumentoFiscal } from 'factura-hn';
import { AlmacenPostgres } from '@factura-hn/postgres';
import { caiDemo, EMISOR_DEMO } from 'factura-hn/demo';
import { crearApp } from '../src/app';
import { ejecutarConsola } from '../src/consola';
import { migrarApi, VERSION_ESQUEMA_API } from '../src/esquema';
import { coincide, generarLlave, hashLlave, leerLlave, prefijoDe } from '../src/llaves';
import { crearLlaveOperador, crearTenant, iniciarLocal, crearLlaveDemo, modoDeTenant, TENANT_DEMO } from '../src/operador';
import { caiAleatorio, cerrarPool, cliente, crearCaja, EMISOR, FECHA_LIMITE, fijarModo, nombreTenant, poolPrueba, ROL, tenantListo, URL_PG, venta, type Cliente } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const json = async (r: Response) => (await r.json()) as any;
const bytes = async (r: Response) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
const sinLimite = { limiteSolicitudes: { porSegundo: 1000, rafaga: 1000 } };
const emitir = (c: Cliente, cuerpo: unknown) => c('POST', '/v1/documentos', cuerpo, { 'idempotency-key': `m-${randomBytes(8).toString('hex')}` });
/** Llave sin marca de modo, como las que se crearon antes de `fhn_live_` y `fhn_test_`. */
const llaveSinMarca = () => {
  const prefijo = randomBytes(6).toString('hex');
  const llave = `fhn_${prefijo}_${randomBytes(32).toString('base64url')}`;
  return { llave, prefijo, hash: hashLlave(llave) };
};
/** Inserta una llave como el dueño de las tablas, con el tenant fijado (api_llaves tiene RLS). */
async function insertarLlave(pool: pg.Pool, tenant: string, l: { prefijo: string; hash: Buffer }, rol: 'admin' | 'caja' = 'admin') {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
    await c.query(
      'INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre, establecimiento, punto_emision) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [l.prefijo, tenant, l.hash, rol, 'sin marca', rol === 'caja' ? '000' : null, rol === 'caja' ? '001' : null],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

describe('formato de las llaves', () => {
  it('las nuevas llevan la marca del modo; las tres formas dan su prefijo de 12 hexadecimales', () => {
    const live = generarLlave('produccion');
    const test = generarLlave('prueba');
    expect(live.llave).toMatch(/^fhn_live_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(test.llave).toMatch(/^fhn_test_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(leerLlave(live.llave)).toEqual({ prefijo: live.prefijo, modo: 'produccion' });
    expect(leerLlave(test.llave)).toEqual({ prefijo: test.prefijo, modo: 'prueba' });
    const vieja = llaveSinMarca();
    expect(leerLlave(vieja.llave)).toEqual({ prefijo: vieja.prefijo, modo: null });
    expect(prefijoDe(vieja.llave)).toBe(vieja.prefijo);
    expect(coincide(live.llave, live.hash)).toBe(true);
    // El hash cubre la marca: cambiar live por test da otra llave.
    expect(coincide(live.llave.replace('fhn_live_', 'fhn_test_'), live.hash)).toBe(false);
    for (const mala of ['fhn_prod_abcdefabcdef_' + 'A'.repeat(43), 'fhn_live__' + 'A'.repeat(43), `fhn_test_${live.prefijo}`, `fhn_LIVE_${live.prefijo}_${'A'.repeat(43)}`]) {
      expect(leerLlave(mala), mala).toBeNull();
    }
  });
});

conBase('modo del tenant', () => {
  it('producción: llaves fhn_live_, modoTenant y FacturaHN-Modo en las respuestas autenticadas, también en los errores', async () => {
    const { app, admin, llaveAdmin, tenant, pool } = await tenantListo(sinLimite);
    expect(llaveAdmin).toMatch(/^fhn_live_/);
    expect(await modoDeTenant(pool, tenant)).toBe('produccion');
    const r = await admin('GET', '/v1/sesion');
    expect(r.headers.get('facturahn-modo')).toBe('produccion');
    expect((await json(r)).sesion).toMatchObject({ tenant, modoTenant: 'produccion', modo: 'local', demo: false });
    const caja = await crearCaja(admin, '001');
    expect(caja).toMatch(/^fhn_live_/);
    expect(await crearLlaveOperador(pool, { tenant, rol: 'admin', nombre: 'consola' })).toMatch(/^fhn_live_/);
    // Un error después de autenticar (403) y una respuesta transmitida (libro) también la llevan.
    const prohibido = await cliente(app, caja)('GET', '/v1/llaves');
    expect(prohibido.status).toBe(403);
    expect(prohibido.headers.get('facturahn-modo')).toBe('produccion');
    const libro = await admin('GET', `/v1/libro-ventas?desde=${FECHA_LIMITE}&hasta=${FECHA_LIMITE}`);
    expect(libro.headers.get('facturahn-modo')).toBe('produccion');
    await libro.text();
    // Sin autenticar no hay modo que decir.
    const sin = await cliente(app, null)('GET', '/v1/sesion');
    expect(sin.status).toBe(401);
    expect(sin.headers.get('facturahn-modo')).toBeNull();
    expect((await app.request('/salud')).headers.get('facturahn-modo')).toBeNull();
  });

  it('prueba: llaves fhn_test_, solo CAI ficticios y documentos con la leyenda de prueba', async () => {
    const pool = await poolPrueba();
    const tenant = nombreTenant('sandbox');
    const { llaveAdmin, modo } = await crearTenant(pool, { tenant, nombre: tenant, modo: 'prueba' });
    expect(modo).toBe('prueba');
    expect(llaveAdmin).toMatch(/^fhn_test_/);
    const app = crearApp({ pool, modo: 'alojado', rol: ROL, registrar: () => undefined, ...sinLimite });
    const admin = cliente(app, llaveAdmin);
    const s = await admin('GET', '/v1/sesion');
    expect(s.headers.get('facturahn-modo')).toBe('prueba');
    expect((await json(s)).sesion).toMatchObject({ modoTenant: 'prueba', modo: 'alojado', demo: false });
    expect((await admin('POST', '/v1/emisores', EMISOR)).status).toBe(201);
    const aut = { tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: FECHA_LIMITE };
    // Un CAI real no entra al sandbox.
    const real = await admin('POST', '/v1/autorizaciones', { ...aut, cai: caiAleatorio() });
    expect(real.status).toBe(422);
    const e = await json(real);
    expect(e.error).toMatchObject({ codigo: 'AUTORIZACION_REAL_EN_DEMO', solucion: expect.stringContaining('fhn_live_') });
    expect(e.errores).toMatchObject([{ codigo: 'AUTORIZACION_REAL_EN_DEMO', campo: 'cai' }]);
    // Un CAI ficticio sí, sin necesidad de «prueba: true».
    const ficticio = await admin('POST', '/v1/autorizaciones', { ...aut, cai: caiDemo('01') });
    expect(ficticio.status).toBe(201);
    expect((await json(ficticio)).advertencias).toEqual([]);
    // Lote 4: el registro devuelve sus avisos. Una fecha límite a más de un año de la autorización (Art. 62).
    const [anio, mes, dia] = FECHA_LIMITE.split('-');
    const larga = await admin('POST', '/v1/autorizaciones', { ...aut, puntoEmision: '002', cai: caiDemo('01'), fechaAutorizacion: `${Number(anio) - 2}-${mes}-${dia}` });
    expect(larga.status).toBe(201);
    expect((await json(larga)).advertencias).toMatchObject([{ codigo: 'AVISO_VIGENCIA_MAYOR_1_ANIO', campo: 'fechaLimiteEmision' }]);
    const caja = await crearCaja(admin, '001');
    expect(caja).toMatch(/^fhn_test_/);
    expect(await crearLlaveOperador(pool, { tenant, rol: 'caja', nombre: 'consola', establecimiento: '000', puntoEmision: '001' })).toMatch(/^fhn_test_/);
    const d = await emitir(cliente(app, caja), venta('10.00'));
    expect(d.status).toBe(201);
    expect(d.headers.get('facturahn-modo')).toBe('prueba');
    expect((await json(d)).documento.modo).toBe('prueba');
  });

  it('una llave fhn_test_ no entra a un tenant de producción ni una fhn_live_ a uno de prueba; las llaves sin marca siguen valiendo', async () => {
    const pool = await poolPrueba();
    const prod = await crearTenant(pool, { tenant: nombreTenant('prod'), nombre: 'p' });
    const prueba = await crearTenant(pool, { tenant: nombreTenant('sbx'), nombre: 's', modo: 'prueba' });
    const viejaProd = llaveSinMarca();
    const viejaPrueba = llaveSinMarca();
    await insertarLlave(pool, prod.tenant, viejaProd);
    await insertarLlave(pool, prueba.tenant, viejaPrueba);
    const app = crearApp({ pool, modo: 'alojado', rol: ROL, registrar: () => undefined, ...sinLimite });
    const sesion = async (llave: string) => {
      const r = await cliente(app, llave)('GET', '/v1/sesion');
      return { estado: r.status, modo: r.headers.get('facturahn-modo'), cuerpo: await json(r) };
    };
    expect(await sesion(viejaProd.llave)).toMatchObject({ estado: 200, modo: 'produccion', cuerpo: { sesion: { modoTenant: 'produccion' } } });
    expect(await sesion(viejaPrueba.llave)).toMatchObject({ estado: 200, modo: 'prueba', cuerpo: { sesion: { modoTenant: 'prueba' } } });
    // Cambiar la marca de una llave da otra llave: 401, igual que un secreto equivocado.
    for (const falsa of [prod.llaveAdmin.replace('fhn_live_', 'fhn_test_'), prueba.llaveAdmin.replace('fhn_test_', 'fhn_live_')]) {
      const r = await sesion(falsa);
      expect(r).toMatchObject({ estado: 401, modo: null, cuerpo: { error: { codigo: 'NO_AUTENTICADO' } } });
    }
    expect((await sesion(prod.llaveAdmin)).estado).toBe(200);
    // La fuente de verdad es el modo del tenant: si el operador lo cambia en la base, sus llaves con marca dejan de
    // entrar (la llave ya validada en memoria también) y las sin marca siguen, con el modo nuevo.
    await fijarModo(pool, prod.tenant, 'prueba');
    try {
      expect(await sesion(prod.llaveAdmin)).toMatchObject({ estado: 401, cuerpo: { error: { codigo: 'NO_AUTENTICADO' } } });
      expect(await sesion(viejaProd.llave)).toMatchObject({ estado: 200, modo: 'prueba' });
    } finally {
      await fijarModo(pool, prod.tenant, 'produccion');
    }
    expect((await sesion(prod.llaveAdmin)).estado).toBe(200);
  });

  it('una llave cuya marca no coincide con el modo se cobra como un secreto equivocado: 401 y luego 429', async () => {
    const pool = await poolPrueba();
    const t = await crearTenant(pool, { tenant: nombreTenant('cobro'), nombre: 'c' });
    const app = crearApp({ pool, modo: 'alojado', rol: ROL, registrar: () => undefined, limiteIntentos: { porSegundo: 0.01, rafaga: 2 } });
    expect((await cliente(app, t.llaveAdmin)('GET', '/v1/sesion')).status).toBe(200);
    await fijarModo(pool, t.tenant, 'prueba');
    try {
      const estados: number[] = [];
      for (let i = 0; i < 4; i++) estados.push((await cliente(app, t.llaveAdmin, { ip: '192.0.2.50' })('GET', '/v1/sesion')).status);
      expect(estados).toEqual([401, 401, 429, 429]);
    } finally {
      await fijarModo(pool, t.tenant, 'produccion');
    }
  });

  it('migración v8: los tenants que ya existían quedan en producción y el demo de demostración, en prueba', async () => {
    const p = await poolPrueba();
    const esquema = `prueba_v8_${randomBytes(4).toString('hex')}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      await iniciarLocal(propio, { demo: true, rol: ROL });
      const otro = await crearTenant(propio, { tenant: 'otro', nombre: 'otro' });
      const viejo = llaveSinMarca();
      await insertarLlave(propio, TENANT_DEMO, viejo);
      // Como quedó una base en v7: sin la columna ni la marca de v8.
      await propio.query('ALTER TABLE api_tenants DROP COLUMN modo');
      await propio.query('DELETE FROM fhn_migraciones WHERE clave = $1', [`api-v${VERSION_ESQUEMA_API}-${ROL}`]);
      await migrarApi(propio, ROL);
      expect(await modoDeTenant(propio, 'local')).toBe('produccion');
      expect(await modoDeTenant(propio, 'otro')).toBe('produccion');
      expect(await modoDeTenant(propio, TENANT_DEMO)).toBe('prueba');
      // Las llaves viejas siguen entrando y las nuevas del demo son fhn_test_.
      const app = crearApp({ pool: propio, modo: 'local', rol: ROL, registrar: () => undefined, ...sinLimite });
      expect((await cliente(app, viejo.llave)('GET', '/v1/sesion')).headers.get('facturahn-modo')).toBe('prueba');
      expect((await cliente(app, otro.llaveAdmin)('GET', '/v1/sesion')).status).toBe(200);
      expect(await crearLlaveDemo(propio)).toMatch(/^fhn_test_/);
      // Otra migración no la vuelve a tocar.
      await propio.query('DELETE FROM fhn_migraciones WHERE clave = $1', [`api-v${VERSION_ESQUEMA_API}-${ROL}`]);
      await migrarApi(propio, ROL);
      expect(await modoDeTenant(propio, TENANT_DEMO)).toBe('prueba');
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });

  it('migración v8: un tenant «demo» con el emisor ficticio pero un CAI real queda en producción; «demo llave» se niega', async () => {
    const p = await poolPrueba();
    const esquema = `prueba_v8r_${randomBytes(4).toString('hex')}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      // Como en la 0.2.0: un «demo» con el emisor ficticio al que se le registró un CAI real.
      await propio.query("INSERT INTO api_tenants (tenant, nombre) VALUES ('demo', 'demo')");
      await propio.query("INSERT INTO api_emisores (tenant, datos) VALUES ('demo', $1)", [JSON.stringify(EMISOR_DEMO)]);
      await registrarAutorizacion(new AlmacenPostgres(propio, { tenant: TENANT_DEMO, rol: ROL }), {
        cai: caiAleatorio(), tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: FECHA_LIMITE,
      } as AutorizacionCAI, { actor: 'prueba' });
      await propio.query('ALTER TABLE api_tenants DROP COLUMN modo');
      await propio.query('DELETE FROM fhn_migraciones WHERE clave = $1', [`api-v${VERSION_ESQUEMA_API}-${ROL}`]);
      await migrarApi(propio, ROL);
      expect(await modoDeTenant(propio, TENANT_DEMO)).toBe('produccion');
      await expect(crearLlaveDemo(propio)).rejects.toThrow(/es de producción/);
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });

  it('la base impone el modo también al SDK: prueba solo CAI ficticios, producción ninguno; sin tenant de la API, nada cambia', async () => {
    const pool = await poolPrueba();
    const prod = await crearTenant(pool, { tenant: nombreTenant('sdkp'), nombre: 'p' });
    const sbx = await crearTenant(pool, { tenant: nombreTenant('sdks'), nombre: 's', modo: 'prueba' });
    const aut = (cai: string) => ({ cai, tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: FECHA_LIMITE }) as AutorizacionCAI;
    const registrar = (tenant: string, cai: string) => registrarAutorizacion(new AlmacenPostgres(pool, { tenant, rol: ROL }), aut(cai), { actor: 'sdk' });
    await expect(registrar(prod.tenant, caiDemo('01'))).rejects.toThrow(/CAI_DE_PRUEBA/);
    await expect(registrar(sbx.tenant, caiAleatorio())).rejects.toThrow(/AUTORIZACION_REAL_EN_DEMO/);
    await registrar(prod.tenant, caiAleatorio());
    await registrar(sbx.tenant, caiDemo('01'));
    // Un tenant que solo usa el SDK (sin fila en api_tenants) no se ve afectado.
    await registrar(nombreTenant('solo-sdk'), caiAleatorio());
    await registrar(nombreTenant('solo-sdk'), caiDemo('01'));
  });

  it('consola: tenant crear --modo prueba y llave crear dan llaves fhn_test_; --modo inválido es un error de uso', async () => {
    const env = { DATABASE_URL: URL_PG, FHN_ROL: ROL, FHN_MODO: 'alojado' };
    const correr = async (args: string[]) => {
      const log: string[] = [];
      const error: string[] = [];
      const codigo = await ejecutarConsola(args, { env, salida: { log: (t) => log.push(t), error: (t) => error.push(t) } });
      return { codigo, log: log.join('\n'), error: error.join('\n') };
    };
    const tenant = nombreTenant('cons');
    const r = await correr(['tenant', 'crear', tenant, '--modo', 'prueba']);
    expect(r.codigo).toBe(0);
    expect(r.log).toContain('(modo prueba)');
    expect(r.log).toMatch(/Llave admin \(solo se muestra ahora\): fhn_test_[0-9a-f]{12}_/);
    const llave = await correr(['llave', 'crear', tenant, '--rol', 'caja', '--caja', '000-001']);
    expect(llave.log).toMatch(/fhn_test_[0-9a-f]{12}_/);
    const prod = await correr(['tenant', 'crear', nombreTenant('cons')]);
    expect(prod.log).toContain('(modo produccion)');
    expect(prod.log).toMatch(/fhn_live_[0-9a-f]{12}_/);
    const mal = await correr(['tenant', 'crear', nombreTenant('cons'), '--modo', 'sandbox']);
    expect(mal).toMatchObject({ codigo: 1, error: expect.stringContaining('--modo debe ser produccion o prueba') });
  });
});

conBase('libro de ventas con llave de caja', () => {
  it('una caja recibe solo el libro de su punto de emisión (JSON y CSV), igual al del núcleo con esos documentos', async () => {
    const { app, admin } = await tenantListo(sinLimite, { cajas: ['001', '002'] });
    const caja1 = cliente(app, await crearCaja(admin, '001'));
    const caja2 = cliente(app, await crearCaja(admin, '002'));
    const docs: DocumentoFiscal[] = [];
    // Sin establecimiento ni punto en el cuerpo: cada llave de caja usa el suyo.
    const cliente9 = { nombre: 'Cliente', rtn: '99990000000002' };
    const conCliente = (precio: string) => ({ documento: { cliente: cliente9, lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: precio }] } });
    for (const [c, precio] of [[caja1, '100.00'], [caja2, '50.00'], [caja1, '200.00'], [caja2, '70.00']] as const) {
      const r = await emitir(c, conCliente(precio));
      expect(r.status).toBe(201);
      docs.push((await json(r)).documento);
    }
    // Una NC de la caja 1 (serie 000-001-06): el libro de la caja recorre sus dos series.
    const f = docs[0]!;
    // Sin establecimiento ni punto en el cuerpo: la llave de caja usa el suyo.
    const nc = await emitir(caja1, {
      documento: {
        tipoDocumento: '06', motivo: 'Devolución', cliente: cliente9,
        referencia: { cai: f.cai, numero: f.numero, fecha: f.fechaEmision },
        lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '50.00' }],
      },
    });
    expect(nc.status).toBe(201);
    docs.push((await json(nc)).documento);
    // Una NC de la caja 1 sobre una factura de la caja 2: va en el libro de la caja 1 (su punto) y no en el de la 2.
    const cruzada = await emitir(caja1, {
      documento: {
        tipoDocumento: '06', motivo: 'Devolución', cliente: cliente9,
        referencia: { cai: docs[1]!.cai, numero: docs[1]!.numero, fecha: docs[1]!.fechaEmision },
        lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '20.00' }],
      },
    });
    expect(cruzada.status).toBe(201);
    docs.push((await json(cruzada)).documento);
    expect(docs.at(-1)!.numero).toBe('000-001-06-00000002');
    const periodo = `desde=${f.fechaEmision}&hasta=${f.fechaEmision}`;
    const delPunto = (punto: string) => docs.filter((d) => d.numero.startsWith(`${punto}-`)).sort((a, b) => a.numero.localeCompare(b.numero));

    for (const [c, punto] of [[caja1, '000-001'], [caja2, '000-002']] as const) {
      const esperado = libroVentas(delPunto(punto));
      const r = await c('GET', `/v1/libro-ventas?${periodo}`);
      expect(r.status).toBe(200);
      const libro = await json(r);
      expect(libro.filas).toEqual(JSON.parse(JSON.stringify(esperado.filas)));
      expect(libro.resumen).toEqual(JSON.parse(JSON.stringify(esperado.resumen)));
      expect(libro.excluidos).toBe(0);
      const csv = await c('GET', `/v1/libro-ventas?${periodo}&formato=csv`);
      expect(csv.headers.get('content-disposition')).toBe(`attachment; filename="libro-ventas_${punto}_${f.fechaEmision}_${f.fechaEmision}.csv"`);
      expect(await bytes(csv)).toBe(libroVentasCSV(esperado.filas));
    }
    expect((await json(await caja1('GET', `/v1/libro-ventas?${periodo}`))).filas).toHaveLength(4);
    expect((await json(await caja2('GET', `/v1/libro-ventas?${periodo}`))).filas).toHaveLength(2);
    // La admin sigue viendo el libro de todo el tenant, con el nombre de siempre.
    const todo = await admin('GET', `/v1/libro-ventas?${periodo}&formato=csv`);
    expect(todo.headers.get('content-disposition')).toBe(`attachment; filename="libro-ventas_${f.fechaEmision}_${f.fechaEmision}.csv"`);
    expect(await bytes(todo)).toBe(libroVentasCSV(libroVentas([...docs].sort((a, b) => a.numero.localeCompare(b.numero))).filas));
    // La exportación para el SAR sigue siendo solo de admin.
    expect((await json(await caja1('GET', `/v1/exportacion?${periodo}`))).error.codigo).toBe('SOLO_ADMIN');
  });

  it('el tope y los documentos de prueba se cuentan solo en el punto de la caja', async () => {
    const { app, admin } = await tenantListo({ ...sinLimite, maxDocumentosReporte: 2 }, { cajas: ['001', '002'] });
    const caja1 = cliente(app, await crearCaja(admin, '001'));
    const caja2 = cliente(app, await crearCaja(admin, '002'));
    let fecha = '';
    for (const c of [caja1, caja2, caja2, caja2]) {
      const r = await emitir(c, { documento: { lineas: [{ descripcion: 'Martillo', cantidad: 1, precioUnitario: '10.00' }] } });
      expect(r.status).toBe(201);
      fecha = (await json(r)).documento.fechaEmision;
    }
    const periodo = `desde=${fecha}&hasta=${fecha}`;
    // El tenant tiene 4 documentos (más que el tope de 2): la caja 1 tiene 1 y recibe su libro; la 2 tiene 3.
    const r1 = await caja1('GET', `/v1/libro-ventas?${periodo}`);
    expect(r1.status).toBe(200);
    expect((await json(r1)).filas).toHaveLength(1);
    const r2 = await caja2('GET', `/v1/libro-ventas?${periodo}`);
    expect(r2.status).toBe(422);
    expect((await json(r2)).error.codigo).toBe('PERIODO_DEMASIADO_GRANDE');
  });

  it('una caja sin punto de emisión no recibe el libro (403 CAJA_SIN_PUNTO)', async () => {
    const { app, tenant, pool } = await tenantListo(sinLimite);
    const vieja = llaveSinMarca();
    const c = await pool.connect();
    try {
      // Una llave de caja anterior al disparador v4, sin punto de emisión.
      await c.query('BEGIN');
      await c.query('ALTER TABLE api_llaves DISABLE TRIGGER fhn_api_llaves_caja_con_punto');
      await c.query("INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre) VALUES ($1, $2, $3, 'caja', 'vieja')", [vieja.prefijo, tenant, vieja.hash]);
      await c.query('ALTER TABLE api_llaves ENABLE TRIGGER fhn_api_llaves_caja_con_punto');
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    const r = await cliente(app, vieja.llave)('GET', `/v1/libro-ventas?desde=${FECHA_LIMITE}&hasta=${FECHA_LIMITE}`);
    expect(r.status).toBe(403);
    expect((await json(r)).error).toMatchObject({ codigo: 'CAJA_SIN_PUNTO', solucion: expect.stringContaining('POST /v1/llaves') });
  });
});
