/**
 * Commit incierto: la conexión se corta justo después de que PostgreSQL confirmó la emisión, antes de que la API
 * reciba la confirmación. La API no sabe si el documento quedó: responde 503 `BASE_NO_DISPONIBLE` y el reintento
 * con la misma Idempotency-Key devuelve el MISMO documento (la clave se guardó en la transacción que se confirmó),
 * sin emitir otro ni saltar un número. Corre en `pnpm test:pg` (no reinicia la base): un proxy TCP entre la API y
 * PostgreSQL corta la conexión en el momento exacto.
 */
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { problemasDeIntegridad, revisarIntegridad } from '../../carga/integridad';
import { URL_PG } from '../ayuda';
import { arrancarApi, http, tenantPorHttp, ventaCaja, type ApiEnMarcha } from './ayuda-http';

/**
 * Reenvía todo entre la API y PostgreSQL. Armado, espera en alguna conexión el INSERT del documento y, después,
 * su COMMIT: lo reenvía, deja que PostgreSQL lo confirme y, al llegar la respuesta, la descarta y corta las dos
 * puntas. Se desarma al cortar una vez.
 */
class ProxyPg {
  armado = false;
  cortes = 0;
  private readonly sockets = new Set<net.Socket>();
  private readonly srv: net.Server;
  constructor(private readonly destino: { host: string; port: number }) {
    this.srv = net.createServer((api) => {
      const pg = net.connect(this.destino);
      this.sockets.add(api).add(pg);
      let emitiendo = false;
      let confirmando = false;
      const cortar = () => {
        api.destroy();
        pg.destroy();
      };
      api.on('data', (d) => {
        if (this.armado && d.includes('INSERT INTO fhn_documentos')) emitiendo = true;
        // Mensaje de consulta simple 'Q' con "COMMIT\0" (node-postgres manda así el COMMIT de la transacción).
        if (this.armado && emitiendo && d.includes('COMMIT\0') && d[d.indexOf('COMMIT\0') - 5] === 0x51) {
          confirmando = true;
          this.armado = false;
        }
        pg.write(d);
      });
      pg.on('data', (d) => {
        if (confirmando) {
          // La respuesta al COMMIT: PostgreSQL ya confirmó. Se pierde, como en un corte de red a la vuelta.
          this.cortes++;
          return cortar();
        }
        api.write(d);
      });
      for (const s of [api, pg]) {
        s.on('error', () => undefined);
        s.on('close', () => {
          this.sockets.delete(s);
          cortar();
        });
      }
    });
  }
  async abrir(): Promise<number> {
    await new Promise<void>((r) => this.srv.listen(0, '127.0.0.1', r));
    return (this.srv.address() as net.AddressInfo).port;
  }
  async cerrar(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.srv.close(() => r()));
  }
}

describe.skipIf(!URL_PG)('commit incierto', () => {
  let proxy: ProxyPg;
  let api: ApiEnMarcha;
  beforeAll(async () => {
    const u = new URL(URL_PG!);
    proxy = new ProxyPg({ host: u.hostname, port: Number(u.port || 5432) });
    const puerto = await proxy.abrir();
    u.host = `127.0.0.1:${puerto}`;
    api = await arrancarApi(u.toString());
  });
  afterAll(async () => {
    await api?.cerrar();
    await proxy?.cerrar();
  });

  it('la conexión se corta después del COMMIT: 503 y el reintento con la misma clave da el mismo documento', async () => {
    const { tenant, llaves } = await tenantPorHttp(api, ['001']);
    const caja = http(api.url, llaves['001']!);
    const clave = randomUUID();

    proxy.armado = true;
    const r = await caja('POST', '/v1/documentos', ventaCaja('300.00'), { 'idempotency-key': clave });
    const cuerpo = (await r.json()) as Record<string, any>;
    expect(proxy.cortes).toBe(1);
    expect(r.status).toBe(503);
    expect(cuerpo.error.codigo).toBe('BASE_NO_DISPONIBLE');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);

    // El documento quedó, aunque la API no lo supo.
    expect((await revisarIntegridad(api.dueno, tenant)).documentos).toBe(1);

    // El reintento con la misma clave: el mismo documento, marcado como repetido; nada nuevo.
    const reintento = await caja('POST', '/v1/documentos', ventaCaja('300.00'), { 'idempotency-key': clave });
    expect(reintento.status).toBe(201);
    expect(reintento.headers.get('idempotency-replayed')).toBe('true');
    expect(((await reintento.json()) as Record<string, any>).documento.numero).toBe('000-001-01-00000001');

    // La venta siguiente toma el número siguiente: el corte no consumió ni repitió números.
    const siguiente = await caja('POST', '/v1/documentos', ventaCaja(), { 'idempotency-key': randomUUID() });
    expect(((await siguiente.json()) as Record<string, any>).documento.numero).toBe('000-001-01-00000002');
    const integridad = await revisarIntegridad(api.dueno, tenant);
    expect(problemasDeIntegridad(integridad)).toEqual([]);
    expect(integridad.documentos).toBe(2);
    expect(integridad.claves).toBe(2);
    expect(api.registros.join('\n')).not.toMatch(/Error interno/);
  });
});
