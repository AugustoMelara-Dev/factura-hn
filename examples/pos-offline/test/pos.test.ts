import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { registrarAutorizacion } from 'factura-hn';
import { crearPOS } from '../src/pos';

// node:sqlite se carga con require para que el empaquetador de las pruebas no intente resolverlo.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const EMISOR = {
  rtn: '08011999123456', razonSocial: 'Pulpería Ejemplo', nombreComercial: 'Pulpería Ejemplo', direccionCasaMatriz: 'Tocoa',
  direccionEstablecimiento: 'Tocoa', telefono: '2444-0000', correo: 'v@ejemplo.hn',
};
const reloj = () => new Date('2026-11-18T15:00:00Z');

async function posListo(rangoFinal = 50, puerto?: number) {
  const db = new DatabaseSync(':memory:');
  const pos = crearPOS({ db, emisor: EMISOR, establecimiento: '000', puntoEmision: '001', reloj, puerto });
  await registrarAutorizacion(pos.almacen, {
    cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
    rangoInicial: 1, rangoFinal, fechaLimiteEmision: '2027-10-31',
  }, { reloj });
  return { db, pos };
}

const venta = { lineas: [{ descripcion: 'Café', cantidad: 2, precioUnitario: '57.50' }] };

describe('POS fuera de línea', () => {
  it('la misma clave no duplica la factura, ni siquiera con reintentos simultáneos', async () => {
    const { pos } = await posListo();
    const rs = await Promise.all(Array.from({ length: 5 }, () => pos.vender('venta-0001', venta).catch((e: Error) => e)));
    const docs = rs.filter((r): r is Awaited<ReturnType<typeof pos.vender>> => !(r instanceof Error));
    expect(new Set(docs.map((r) => r.documento.numero))).toEqual(new Set(['000-001-01-00000001']));
    // Los que corrieron a la vez que la primera emisión chocan con la clave y revierten: el número no se consume.
    const otra = await pos.vender('venta-0002', venta);
    expect(otra.documento.numero).toBe('000-001-01-00000002');
    expect((await pos.vender('venta-0001', venta)).repetida).toBe(true);
    // La misma clave con otra venta no devuelve el ticket de la primera: es un error.
    await expect(pos.vender('venta-0001', { lineas: [{ descripcion: 'Té', cantidad: '1', precioUnitario: '30.00' }] })).rejects.toMatchObject({
      errores: [expect.objectContaining({ codigo: 'CLAVE_VENTA_USADA' })],
    });
  });

  it('una venta inválida no consume número ni deja la clave usada', async () => {
    const { pos } = await posListo();
    await expect(pos.vender('venta-mala-1', { lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '-1' }] })).rejects.toThrow();
    const r = await pos.vender('venta-mala-1', venta);
    expect(r).toMatchObject({ repetida: false, documento: { numero: '000-001-01-00000001' } });
  });

  it('cola de salida: emitido y anulado se envían en orden; un fallo deja el resto para después', async () => {
    const { pos } = await posListo();
    await pos.vender('venta-a-0001', venta);
    await pos.vender('venta-b-0001', venta);
    await pos.anular('000-001-01-00000001', 'Error de digitación');
    expect(pos.pendientesDeEnviar()).toBe(3);
    const recibidos: string[] = [];
    let conexion = false;
    const enviar = async (a: { evento: string; documento: { numero: string } }) => {
      if (!conexion && recibidos.length === 1) throw new Error('sin internet');
      recibidos.push(`${a.evento} ${a.documento.numero}`);
    };
    expect(await pos.sincronizar(enviar)).toBe(1);
    conexion = true;
    expect(await pos.sincronizar(enviar)).toBe(2);
    expect(recibidos).toEqual(['documento.emitido 000-001-01-00000001', 'documento.emitido 000-001-01-00000002', 'documento.anulado 000-001-01-00000001']);
    expect(pos.pendientesDeEnviar()).toBe(0);
  });

  it('estado del CAI con alerta cuando se acerca el fin del rango', async () => {
    const { pos } = await posListo(10);
    for (let i = 0; i < 9; i++) await pos.vender(`venta-r-${String(i).padStart(4, '0')}`, venta);
    const e = await pos.estado();
    expect(e.autorizacion).toMatchObject({ correlativosRestantes: 1 });
    expect(e.autorizacion!.alertas.length).toBeGreaterThan(0);
  });

  it('por HTTP: página, venta, ticket, 422 con los errores y rutas desconocidas', async () => {
    let pos!: Awaited<ReturnType<typeof posListo>>['pos'];
    const srv = createServer((req, res) => void pos.manejador(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const puerto = (srv.address() as { port: number }).port;
    ({ pos } = await posListo(50, puerto));
    const base = `http://127.0.0.1:${puerto}`;
    const json = { 'content-type': 'application/json' };
    try {
      const pagina = await fetch(base);
      expect(pagina.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(await pagina.text()).toContain('Cobrar y emitir factura');
      const post = (cuerpo: unknown) => fetch(`${base}/api/ventas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const r = await post({ clave: 'http-venta-0001', ...venta });
      expect(r.status).toBe(201);
      const d = await r.json();
      expect(d.ticket).toContain('000-001-01-00000001');
      expect((await post({ clave: 'http-venta-0001', ...venta })).status).toBe(200);
      const malo = await post({ clave: 'http-venta-0002', lineas: [] });
      expect(malo.status).toBe(422);
      expect((await malo.json()).errores.length).toBeGreaterThan(0);
      expect((await post({ clave: 'no válida', ...venta })).status).toBe(422);
      expect((await fetch(`${base}/api/ventas`, { method: 'POST', headers: json, body: '{' })).status).toBe(400);
      expect(await (await fetch(`${base}/api/documentos/000-001-01-00000001.txt`)).text()).toContain('CAI');
      expect((await fetch(`${base}/api/documentos/000-001-01-00000099`)).status).toBe(404);
      expect((await fetch(`${base}/../etc/passwd`)).status).toBe(404);
      // Otra página del navegador (CSRF): sin JSON, con otro Origin o por otro nombre de anfitrión, no pasa.
      const anularUrl = `${base}/api/documentos/000-001-01-00000001/anular`;
      const cuerpoAnular = JSON.stringify({ motivo: 'Prueba' });
      expect((await fetch(anularUrl, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: cuerpoAnular })).status).toBe(415);
      expect((await fetch(anularUrl, { method: 'POST', headers: { ...json, origin: 'https://sitio-malo.example' }, body: cuerpoAnular })).status).toBe(403);
      const http = await import('node:http');
      const rebinding = await new Promise<number>((r) => {
        const q = http.request(anularUrl, { method: 'POST', headers: { ...json, host: `malo.example:${puerto}` } }, (s) => r(s.statusCode ?? 0));
        q.end(cuerpoAnular);
      });
      expect(rebinding).toBe(421);
      expect((await pos.documento('000-001-01-00000001'))!.estado).toBe('EMITIDO');
      const anulado = await fetch(anularUrl, { method: 'POST', headers: { ...json, origin: base }, body: cuerpoAnular });
      expect((await anulado.json()).estado).toBe('ANULADO');
    } finally {
      srv.close();
    }
  });
});
