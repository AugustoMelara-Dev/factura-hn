/**
 * Receptores de webhooks caídos: que no aceptan conexiones, que aceptan y no responden (tiempo agotado), que
 * cortan la conexión o que responden 500 durante un rato. Corre en `pnpm test:pg` (no reinicia la base).
 *
 * Lo que se exige:
 * - cada intento fallido deja la entrega PENDIENTE con el error que corresponde y el próximo intento según el
 *   calendario (`esperaBase(n)` ±20 %, el de producción, sin cambiarlo);
 * - nada se pierde: cuando el receptor vuelve, cada documento emitido tiene su aviso ENTREGADO y el receptor
 *   vio todos los ids (con duplicados solo del mismo id, que deduplica con X-FacturaHN-Entrega);
 * - la emisión no se frena: un receptor colgado no retiene conexiones de la base ni alarga la emisión;
 * - lo acumulado se vacía en una pasada, no de a 20 entregas cada 5 s.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { Socket } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { crearPool } from '../../src/pool';
import { CofreSecretos, despacharWebhooks, esperaBase, FLUCTUACION, type OpcionesDespacho } from '../../src/webhooks';
import { cerrarPool, cliente, poolPrueba, ROL, tenantListo, URL_PG, venta } from '../ayuda';
import { LARGA } from './pg-temporal';

afterAll(cerrarPool);

/** Estas pruebas emiten cientos de ventas seguidas con una llave: el límite por llave (20/s) no es lo que se prueba. */
const SIN_LIMITE = { limiteSolicitudes: { porSegundo: 10_000, rafaga: 10_000 } };

type Modo = 'caido' | 'corta' | 'cuelga' | 'error500' | 'ok';

/** Un receptor local que cambia de comportamiento. Registra cada id de entrega que recibió completo. */
class Receptor {
  modo: Modo = 'ok';
  recibidos: string[] = [];
  private readonly sockets = new Set<Socket>();
  private readonly srv = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (d) => (cuerpo += d));
    req.on('end', () => {
      if (this.modo === 'cuelga') return; // acepta y nunca responde
      this.recibidos.push(String(req.headers['x-facturahn-entrega']));
      if (this.modo === 'error500') {
        res.statusCode = 500;
        res.end('falla');
      } else res.end('ok');
    });
  });
  puerto = 0;
  constructor() {
    this.srv.on('connection', (s) => {
      if (this.modo === 'corta') return void s.destroy();
      this.sockets.add(s);
      s.on('close', () => this.sockets.delete(s));
    });
  }
  async abrir(): Promise<void> {
    await new Promise<void>((r) => this.srv.listen(this.puerto, '127.0.0.1', r));
    this.puerto = (this.srv.address() as { port: number }).port;
  }
  async cerrar(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.srv.close(() => r()));
  }
  get url() {
    return `http://127.0.0.1:${this.puerto}/hook`;
  }
}

interface FilaEntrega { entrega: string; estado: string; intentos: number; proximo: Date; ultimo_error: string | null; clave: string }

describe.skipIf(!URL_PG)('webhooks con el receptor caído', () => {
  const entregas = async (tenant: string): Promise<FilaEntrega[]> =>
    (
      await (await poolPrueba()).query<FilaEntrega>(
        `SELECT entrega, estado, intentos, proximo, ultimo_error, clave FROM api_entregas WHERE tenant = $1 AND evento = 'documento.emitido' ORDER BY id`,
        [tenant],
      )
    ).rows;
  /** El tiempo pasa: lo pendiente vence ya (solo cambia `proximo`; el calendario ya se comprobó). */
  const vencer = async (tenant: string) =>
    (await poolPrueba()).query("UPDATE api_entregas SET proximo = now() - interval '1 second' WHERE tenant = $1 AND estado = 'PENDIENTE'", [tenant]);

  it('caído, cortando, colgado y con 500: cada intento sigue el calendario; al volver, todo se entrega una vez por id', async () => {
    const receptor = new Receptor();
    await receptor.abrir();
    const { admin, tenant, pool } = await tenantListo(SIN_LIMITE);
    try {
      const r = await admin('POST', '/v1/webhooks', { url: receptor.url, eventos: ['documento.emitido'] });
      expect(r.status).toBe(201);
      const n = LARGA ? 120 : 30;
      const numeros: string[] = [];
      for (let i = 0; i < n; i++) {
        const e = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
        numeros.push(((await e.json()) as { documento: { numero: string } }).documento.numero);
      }
      // Las fases del corte. Cada una es una pasada del despacho con un instante fijo (para medir el calendario).
      const fases: { modo: Modo; error: string }[] = [
        { modo: 'caido', error: 'Error de red' },
        { modo: 'corta', error: 'Error de red' },
        { modo: 'cuelga', error: 'Tiempo agotado' },
        { modo: 'error500', error: 'HTTP 500' },
      ];
      const rondas = LARGA ? [...fases, ...fases, ...fases] : fases;
      const opciones: OpcionesDespacho = { pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant], tiempoMaximo: 400 };
      for (const [i, fase] of rondas.entries()) {
        receptor.modo = fase.modo;
        if (fase.modo === 'caido') await receptor.cerrar();
        const instante = new Date();
        await despacharWebhooks({ ...opciones, ahora: () => instante });
        if (fase.modo === 'caido') await receptor.abrir();
        const filas = await entregas(tenant);
        expect(filas).toHaveLength(n);
        for (const f of filas) {
          expect(f).toMatchObject({ estado: 'PENDIENTE', intentos: i + 1, ultimo_error: fase.error });
          // El próximo intento, según el calendario de producción: esperaBase(intentos) con ±20 % de fluctuación.
          const espera = f.proximo.getTime() - instante.getTime();
          expect(espera).toBeGreaterThanOrEqual(Math.floor(esperaBase(i + 1) * (1 - FLUCTUACION)) - 1);
          expect(espera).toBeLessThanOrEqual(Math.ceil(esperaBase(i + 1) * (1 + FLUCTUACION)) + 1);
        }
        // Antes de su momento, una pasada no reintenta nada.
        const antes = receptor.recibidos.length;
        expect(await despacharWebhooks(opciones)).toBe(0);
        expect(receptor.recibidos.length).toBe(antes);
        await vencer(tenant);
      }

      // El receptor vuelve: todo lo pendiente se entrega en una pasada.
      receptor.modo = 'ok';
      await despacharWebhooks(opciones);
      const filas = await entregas(tenant);
      expect(filas.every((f) => f.estado === 'ENTREGADA')).toBe(true);
      // Nada se perdió: un aviso por documento emitido, y el receptor vio todos los ids.
      expect(filas.map((f) => f.clave).sort()).toEqual(numeros.map((x) => `documento.emitido:${x}`).sort());
      const vistos = new Set(receptor.recibidos);
      expect([...vistos].sort()).toEqual(filas.map((f) => f.entrega).sort());
      // Los que llegaron más de una vez (los 500 y los colgados que el receptor sí leyó) traen el mismo id.
      expect(receptor.recibidos.length).toBeGreaterThan(vistos.size);
    } finally {
      await receptor.cerrar().catch(() => undefined);
    }
  }, LARGA ? 120_000 : 60_000);

  it('un receptor colgado no frena la emisión ni retiene conexiones de la base', async () => {
    const receptor = new Receptor();
    await receptor.abrir();
    receptor.modo = 'cuelga';
    // Un pool chico, como el de un despliegue modesto: si el despacho retuviera conexiones, la emisión esperaría.
    const MAX_POOL = 4;
    const pool = crearPool(URL_PG!, MAX_POOL, () => undefined);
    const base = await tenantListo(SIN_LIMITE);
    try {
      const app = crearApp({ pool, modo: 'local', rol: ROL, registrar: () => undefined, ...SIN_LIMITE });
      const admin = cliente(app, base.llaveAdmin);
      const medir = async (k: number) => {
        const tiempos: number[] = [];
        for (let i = 0; i < k; i++) {
          const t = performance.now();
          const r = await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
          expect(r.status).toBe(201);
          tiempos.push(performance.now() - t);
        }
        return tiempos.sort((a, b) => a - b);
      };
      const p95 = (t: number[]) => t[Math.ceil(t.length * 0.95) - 1]!;
      const mediana = (t: number[]) => t[Math.floor(t.length / 2)]!;
      await medir(10); // calentamiento
      const sinWebhook = await medir(40);

      await admin('POST', '/v1/webhooks', { url: receptor.url, eventos: ['documento.emitido'] });
      // Acumula entregas vencidas y despacha como el servidor (cada 100 ms, sin esperar la pasada anterior), con
      // el tiempo máximo de producción (10 s): las entregas quedan colgadas mientras se mide.
      await medir(20);
      const enCurso = new Set<string>();
      const pasadas: Promise<number>[] = [];
      const intervalo = setInterval(() => {
        pasadas.push(despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [base.tenant], enCurso }));
      }, 100);
      await new Promise((r) => setTimeout(r, 300));
      expect(enCurso.has(base.tenant)).toBe(true); // hay entregas colgadas en curso
      const conColgado = await medir(40);
      // Mientras tanto, el despacho no retiene conexiones: el HTTP corre fuera de la transacción. Cada pasada solo
      // toma una un instante (la consulta de tenants con pendientes y el reclamo del lote). Dos pasadas pueden
      // coincidir si la consulta tarda más de 100 ms (un runner cargado), pero el pool nunca se agota: la emisión
      // siempre encuentra una conexión libre.
      let maxPrestadas = 0;
      for (let i = 0; i < 20; i++) {
        maxPrestadas = Math.max(maxPrestadas, pool.totalCount - pool.idleCount);
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(maxPrestadas).toBeLessThan(MAX_POOL);
      clearInterval(intervalo);
      console.info(
        `[resiliencia] emisión sin webhook: mediana ${mediana(sinWebhook).toFixed(1)} ms, p95 ${p95(sinWebhook).toFixed(1)} ms; ` +
          `con receptor colgado: mediana ${mediana(conColgado).toFixed(1)} ms, p95 ${p95(conColgado).toFixed(1)} ms; ` +
          `hasta ${maxPrestadas} conexión(es) prestada(s) de ${MAX_POOL}`,
      );
      // La mediana (no el p95 de 40 muestras, que en un runner de 4 vCPU depende de una o dos): si el despacho
      // retuviera conexiones, cada emisión esperaría una y la mediana se iría a segundos.
      expect(mediana(conColgado)).toBeLessThan(mediana(sinWebhook) * 2 + 25);
      await receptor.cerrar(); // suelta las entregas colgadas
      await Promise.all(pasadas);
    } finally {
      await receptor.cerrar().catch(() => undefined);
      await pool.end();
    }
  });

  it('lo acumulado durante el corte se vacía en una pasada, no de a 20 entregas cada 5 s', async () => {
    const receptor = new Receptor();
    await receptor.abrir();
    const { admin, tenant, pool } = await tenantListo(SIN_LIMITE);
    try {
      await admin('POST', '/v1/webhooks', { url: receptor.url, eventos: ['documento.emitido'] });
      const n = LARGA ? 500 : 70;
      for (let i = 0; i < n; i++) await admin('POST', '/v1/documentos', venta(), { 'idempotency-key': randomUUID() });
      const t = Date.now();
      const intentadas = await despacharWebhooks({ pool, rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [tenant] });
      expect(intentadas).toBe(n);
      expect(new Set(receptor.recibidos).size).toBe(n);
      expect((await entregas(tenant)).every((f) => f.estado === 'ENTREGADA')).toBe(true);
      console.info(`[resiliencia] ${n} entregas acumuladas, vaciadas en una pasada de ${Date.now() - t} ms`);
    } finally {
      await receptor.cerrar();
    }
  });
});
