/**
 * PostgreSQL se reinicia (o se cae) en medio de las emisiones. Corre solo con `pnpm resiliencia`, sobre un
 * clúster desechable (scripts/pg-temporal.mjs); nunca sobre la base compartida.
 *
 * Lo que se exige:
 * - ningún número se pierde ni se repite: en cada serie, los correlativos van de 1 al último sin huecos;
 * - cada Idempotency-Key da un solo documento, aunque el primer intento haya fallado a mitad de la transacción;
 * - la API se recupera sola, sin reiniciarla;
 * - mientras la base no está, el cliente recibe un error claro y reintentable (503 BASE_NO_DISPONIBLE con
 *   Retry-After), no un 500 genérico.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { problemasDeIntegridad, revisarIntegridad } from '../../carga/integridad';
import { arrancarApi, emitirConReintentos, http, tenantPorHttp, ventaCaja, type ApiEnMarcha, type Intento } from './ayuda-http';
import { arrancarPg, detenerPg, esperar, LARGA, REINICIABLE } from './pg-temporal';

const URL_PG = process.env.FHN_PG_URL!;

describe.skipIf(!REINICIABLE)('PostgreSQL se reinicia durante la emisión', () => {
  let api: ApiEnMarcha;
  beforeAll(async () => {
    api = await arrancarApi(URL_PG);
  });
  afterAll(async () => {
    await api?.cerrar();
  });

  /** Errores que vio el cliente mientras la base no estaba: todos deben ser el 503 claro. */
  const erroresVistos = (intentos: Intento[]) => intentos.filter((i) => i.estado !== 201);

  it('una emisión bloqueada dentro de su transacción cuando la base se detiene: 503 claro y, al reintentar con la misma clave, un solo documento', async () => {
    const { tenant, llaves } = await tenantPorHttp(api, ['001']);
    const caja = http(api.url, llaves['001']!);
    const intentos: Intento[] = [];
    // La primera venta deja la serie creada.
    const primero = await emitirConReintentos(caja, (i) => intentos.push(i));
    expect(primero).toBe('000-001-01-00000001');

    // Otro proceso retiene la fila de la serie: la emisión siguiente queda esperando DENTRO de su transacción
    // (ya hizo BEGIN y pidió el candado de la serie) cuando la base se detiene.
    const bloqueo = await api.dueno.connect();
    await bloqueo.query('BEGIN');
    await bloqueo.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
    await bloqueo.query("SELECT 1 FROM fhn_series WHERE tenant = $1 AND identificador = '000-001-01' FOR UPDATE", [tenant]);
    bloqueo.on('error', () => undefined);
    const clave = 'venta-en-vuelo';
    const enVuelo = caja('POST', '/v1/documentos', ventaCaja('250.00'), { 'idempotency-key': clave });
    await esperar(300);
    await detenerPg('fast');
    try {
      const r = await enVuelo;
      const cuerpo = (await r.json()) as Record<string, any>;
      bloqueo.release(true);
      expect(r.status).toBe(503);
      expect(cuerpo.error.codigo).toBe('BASE_NO_DISPONIBLE');
      expect(cuerpo.error.solucion).toMatch(/misma Idempotency-Key/);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);

      // Con la base abajo, otra emisión también recibe el 503 claro (no 500, no se cuelga).
      const abajo = await caja('POST', '/v1/documentos', ventaCaja(), { 'idempotency-key': 'venta-abajo' });
      expect(abajo.status).toBe(503);
      expect(((await abajo.json()) as Record<string, any>).error.codigo).toBe('BASE_NO_DISPONIBLE');
    } finally {
      await arrancarPg();
    }
    // La API se recupera sola: el reintento con la misma clave emite una vez, con el número siguiente.
    const numero = await emitirConReintentos(caja, (i) => intentos.push(i), { clave, cuerpo: ventaCaja('250.00') });
    expect(numero).toBe('000-001-01-00000002');
    const repetida = await caja('POST', '/v1/documentos', ventaCaja('250.00'), { 'idempotency-key': clave });
    expect(repetida.status).toBe(201);
    expect(repetida.headers.get('idempotency-replayed')).toBe('true');
    expect(((await repetida.json()) as Record<string, any>).documento.numero).toBe(numero);

    const integridad = await revisarIntegridad(api.dueno, tenant);
    expect(problemasDeIntegridad(integridad)).toEqual([]);
    expect(integridad.documentos).toBe(2);
    expect(api.registros.join('\n')).not.toMatch(/Error interno/);
  });

  for (const modo of ['fast', 'immediate'] as const) {
    it(`tráfico en 4 cajas mientras PostgreSQL ${modo === 'fast' ? 'se reinicia' : 'se cae y se recupera'}: sin huecos, sin duplicados y un documento por clave`, async () => {
      const cajas = ['001', '002', '003', '004'];
      const { tenant, llaves } = await tenantPorHttp(api, cajas);
      const intentos: Intento[] = [];
      const emitidos = new Map<string, string>();
      let parar = false;
      // Dos trabajadores por caja con la misma llave; cada uno a menos de 20 solicitudes por segundo (el límite
      // por llave de la API), para que lo que se mida sea la base y no el limitador.
      const trabajador = async (punto: string) => {
        const caja = http(api.url, llaves[punto]!);
        while (!parar) {
          const clave = `${punto}-${crypto.randomUUID()}`;
          emitidos.set(clave, await emitirConReintentos(caja, (i) => intentos.push(i), { clave }));
          await esperar(60);
        }
      };
      const trabajos = cajas.flatMap((p) => [trabajador(p), trabajador(p)]);
      const ciclos = LARGA ? 5 : 1;
      const caidas: { desde: number; hasta: number }[] = [];
      for (let n = 0; n < ciclos; n++) {
        await esperar(1500);
        const desde = Date.now();
        await detenerPg(modo);
        await esperar(LARGA ? 4000 : 2000);
        await arrancarPg();
        caidas.push({ desde, hasta: Date.now() });
      }
      // Tráfico después de la recuperación: la API sigue sola, sin reiniciarla.
      const antesDeParar = emitidos.size;
      await esperar(2000);
      parar = true;
      await Promise.all(trabajos);
      expect(emitidos.size).toBeGreaterThan(antesDeParar);

      // Cada clave, un número; ningún número para dos claves.
      const numeros = [...emitidos.values()];
      expect(new Set(numeros).size).toBe(numeros.length);
      // Todas las respuestas 201 de una misma clave traen el mismo número.
      for (const i of intentos.filter((x) => x.estado === 201)) expect(i.numero).toBe(emitidos.get(i.clave));
      // Mientras la base no estaba, solo errores claros y reintentables.
      const errores = erroresVistos(intentos);
      expect(errores.length).toBeGreaterThan(0);
      const otros = errores.filter((e) => !(e.estado === 503 && e.codigo === 'BASE_NO_DISPONIBLE'));
      expect(otros, JSON.stringify(otros.slice(0, 5))).toEqual([]);
      expect(errores.every((e) => Number(e.retryAfter) > 0)).toBe(true);

      const integridad = await revisarIntegridad(api.dueno, tenant);
      expect(problemasDeIntegridad(integridad)).toEqual([]);
      expect(integridad.documentos).toBe(emitidos.size);
      expect(integridad.claves).toBe(emitidos.size);
      expect(integridad.series.map((s) => s.identificador)).toEqual(cajas.map((p) => `000-${p}-01`));
      console.info(
        `[resiliencia] ${modo}: ${emitidos.size} documentos, ${errores.length} respuestas 503 durante ${caidas.length} caída(s), ` +
          `${intentos.filter((i) => i.repetida).length} repeticiones con la misma clave`,
      );
    }, LARGA ? 180_000 : 60_000);
  }
});
