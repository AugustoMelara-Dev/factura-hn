import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, registrarAutorizacion, type Emisor } from 'factura-hn';
import { crearApp, crearTenant, migrarApi } from '@factura-hn/api';
import { BackendApi, BackendLocal, crearServidorMCP, type Backend } from '../src';

const EMISOR: Emisor = {
  rtn: '08011999123456', razonSocial: 'Pulpería Ejemplo', nombreComercial: 'Pulpería Ejemplo',
  direccionCasaMatriz: 'Tocoa, Colón', direccionEstablecimiento: 'Tocoa, Colón', telefono: '2444-0000', correo: 'v@ejemplo.hn',
};
const aut = (tipoDocumento: '01' | '06', cai: string) => ({
  cai, tipoDocumento, establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 100, fechaLimiteEmision: '2027-10-31',
});

async function conectar(backend: Backend) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: 'prueba', version: '1.0.0' });
  await Promise.all([crearServidorMCP(backend).connect(a), cliente.connect(b)]);
  const llamar = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await cliente.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[]; structuredContent?: any };
    return { error: Boolean(r.isError), texto: r.content[0]!.text, datos: r.structuredContent };
  };
  return { cliente, llamar };
}

async function recorrido(backend: Backend) {
  const { cliente, llamar } = await conectar(backend);
  const herramientas = (await cliente.listTools()).tools;
  expect(herramientas.map((t) => t.name).sort()).toEqual(['anular_documento', 'consultar_documento', 'emitir_factura', 'emitir_nota_credito', 'estado_cai', 'libro_ventas']);
  expect(herramientas.find((t) => t.name === 'anular_documento')!.annotations?.destructiveHint).toBe(true);
  expect(herramientas.find((t) => t.name === 'libro_ventas')!.annotations?.readOnlyHint).toBe(true);

  const clave = randomUUID();
  const venta = { cliente: { nombre: 'Ferretería Pérez', rtn: '08019005123456' }, preciosIncluyenISV: true, lineas: [{ descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '89.50' }], idempotencyKey: clave };
  const f = await llamar('emitir_factura', venta);
  expect(f.error).toBe(false);
  expect(f.texto).toMatch(/^Emitida: Factura 000-001-01-00000001 \(EMITIDO\)/);
  expect(f.datos.documento.totales.total).toBe(179);
  // Reintento del agente con la misma clave: el mismo documento.
  expect((await llamar('emitir_factura', venta)).datos.documento.numero).toBe('000-001-01-00000001');

  const malo = await llamar('emitir_factura', { lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '-5' }] });
  expect(malo.error).toBe(true);
  expect(malo.texto).toContain('Muestra estos mensajes al usuario');
  expect(malo.datos.errores.length).toBeGreaterThan(0);

  const nc = await llamar('emitir_nota_credito', { numeroOriginal: '000-001-01-00000001', motivo: 'Devolución de 1 unidad', preciosIncluyenISV: true, lineas: [{ descripcion: 'Arroz 5 lb', cantidad: 1, precioUnitario: '89.50' }] });
  expect(nc.error).toBe(false);
  expect(nc.datos.documento).toMatchObject({ numero: '000-001-06-00000001', referencia: { numero: '000-001-01-00000001' } });

  const ticket = await llamar('consultar_documento', { numero: '000-001-01-00000001', formato: 'texto' });
  expect(ticket.texto).toContain('CAI');
  expect((await llamar('consultar_documento', { numero: '000-001-01-00000099' })).error).toBe(true);

  const estado = await llamar('estado_cai');
  expect(estado.datos.autorizaciones.map((e: any) => [e.serie, e.correlativosRestantes])).toEqual([['000-001-01', 99], ['000-001-06', 99]]);

  const anulado = await llamar('anular_documento', { numero: '000-001-01-00000001', motivo: 'Prueba' });
  expect(anulado.datos.documento.estado).toBe('ANULADO');
  expect((await llamar('anular_documento', { numero: '000-001-01-00000001', motivo: 'otra vez' })).error).toBe(true);

  const hoy = f.datos.documento.fechaEmision;
  const libro = await llamar('libro_ventas', { desde: hoy, hasta: hoy });
  expect(libro.datos.filas).toHaveLength(2);

  // Formas inválidas las rechaza el esquema de la herramienta.
  const forma = await llamar('consultar_documento', { numero: '1' });
  expect(forma.error).toBe(true);
}

describe('servidor MCP con el SDK local', () => {
  it('las seis herramientas: emitir, reintentar, NC, consultar, estado del CAI, anular y libro', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01'));
    await registrarAutorizacion(almacen, aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'));
    await recorrido(new BackendLocal({ almacen, emisor: EMISOR, establecimiento: '000', puntoEmision: '001' }));
  });
});

const URL_PG = process.env.FHN_PG_URL;
describe.skipIf(!URL_PG)('servidor MCP vía la API', () => {
  const pool = new pg.Pool({ connectionString: URL_PG, max: 5 });
  afterAll(() => pool.end());

  it('el mismo recorrido contra la API REST', async () => {
    await migrarApi(pool);
    const tenant = `mcp-${randomUUID().slice(0, 8)}`;
    const { llaveAdmin } = await crearTenant(pool, { tenant, nombre: tenant });
    const app = crearApp({ pool, modo: 'local' });
    const fetchApp = ((e: RequestInfo | URL, init?: RequestInit) => app.fetch(e instanceof Request ? e : new Request(e, init))) as typeof fetch;
    const admin = (ruta: string, cuerpo: unknown) =>
      app.request(ruta, { method: 'POST', headers: { authorization: `Bearer ${llaveAdmin}`, 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    expect((await admin('/v1/emisores', EMISOR)).status).toBe(201);
    expect((await admin('/v1/autorizaciones', aut('01', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01'))).status).toBe(201);
    expect((await admin('/v1/autorizaciones', aut('06', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06'))).status).toBe(201);
    await recorrido(new BackendApi({ url: 'http://api.local', llave: llaveAdmin, establecimiento: '000', puntoEmision: '001', fetch: fetchApp }));
  });
});
