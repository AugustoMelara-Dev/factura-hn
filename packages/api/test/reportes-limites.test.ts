/**
 * Límites de los reportes de período sin base de datos: cupos por tenant y por proceso, tope de documentos y
 * respuesta transmitida (contrapresión, partes de 64 KB, corte del cliente, plazo por parte y plazo total).
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/errores';
import {
  CuposSimultaneos,
  exigirPeriodoAcotado,
  MAX_DOCUMENTOS_REPORTE,
  maxDocumentosReporte,
  ReportesEnCurso,
  REPORTES_SIMULTANEOS,
  reportesSimultaneosProceso,
  TAMANO_PARTE,
  transmitir,
  type Escribir,
  type OpcionesTransmision,
} from '../src/reportes';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await esperar(5);
  return cond();
};
const leerTodo = (s: ReadableStream<Uint8Array>) => new Response(s).text();

/** `transmitir` con una «transacción» falsa que registra si sigue abierta. */
function transmision(
  producir: (escribir: Escribir) => Promise<void>,
  extra: Partial<OpcionesTransmision<object, number>> = {},
) {
  const estado = { abierta: false, liberado: 0, registros: [] as string[] };
  const promesa = transmitir<object, number>({
    ejecutar: async (fn) => {
      estado.abierta = true;
      try {
        await fn({});
      } finally {
        estado.abierta = false;
      }
    },
    preparar: async () => 7,
    producir: (_tx, _p, escribir) => producir(escribir),
    liberar: () => {
      estado.liberado++;
    },
    registrar: (m) => estado.registros.push(m),
    ...extra,
  });
  return { estado, promesa };
}

describe('tope y cupos: configuración', () => {
  it('tope: opción, variable de entorno o 50 000; rechaza valores no enteros', () => {
    expect(maxDocumentosReporte(undefined, {})).toBe(MAX_DOCUMENTOS_REPORTE);
    expect(MAX_DOCUMENTOS_REPORTE).toBe(50_000);
    expect(maxDocumentosReporte(undefined, { FHN_MAX_DOCUMENTOS_REPORTE: '1200' })).toBe(1200);
    expect(maxDocumentosReporte(10, { FHN_MAX_DOCUMENTOS_REPORTE: '1200' })).toBe(10);
    expect(() => maxDocumentosReporte(undefined, { FHN_MAX_DOCUMENTOS_REPORTE: 'mucho' })).toThrow(/FHN_MAX_DOCUMENTOS_REPORTE/);
    expect(() => maxDocumentosReporte(0)).toThrow(/maxDocumentosReporte/);
  });

  it('reportes por proceso: un cuarto del pool (al menos 1), la variable de entorno o la opción', () => {
    expect(reportesSimultaneosProceso(undefined, 20, {})).toBe(5);
    expect(reportesSimultaneosProceso(undefined, 4, {})).toBe(1);
    expect(reportesSimultaneosProceso(undefined, 2, {})).toBe(1);
    expect(reportesSimultaneosProceso(undefined, 20, { FHN_REPORTES_SIMULTANEOS_PROCESO: '3' })).toBe(3);
    expect(reportesSimultaneosProceso(2, 20, { FHN_REPORTES_SIMULTANEOS_PROCESO: '3' })).toBe(2);
    expect(() => reportesSimultaneosProceso(undefined, 20, { FHN_REPORTES_SIMULTANEOS_PROCESO: '-1' })).toThrow(/FHN_REPORTES_SIMULTANEOS_PROCESO/);
  });

  it('reportes por proceso: nunca más que el pool menos 1 (con un pool de 1, uno)', () => {
    expect(reportesSimultaneosProceso(undefined, 1, {})).toBe(1);
    expect(reportesSimultaneosProceso(1, 1, {})).toBe(1);
    expect(reportesSimultaneosProceso(3, 4, {})).toBe(3);
    expect(() => reportesSimultaneosProceso(4, 4, {})).toThrow(/no puede pasar de 3/);
    expect(() => reportesSimultaneosProceso(2, 1, {})).toThrow(/no puede pasar de 1/);
    expect(() => reportesSimultaneosProceso(undefined, 4, { FHN_REPORTES_SIMULTANEOS_PROCESO: '9' })).toThrow(/no puede pasar de 3/);
  });

  it('422 PERIODO_DEMASIADO_GRANDE por encima del tope', () => {
    expect(() => exigirPeriodoAcotado(5, 5)).not.toThrow();
    try {
      exigirPeriodoAcotado(6, 5);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorApi);
      expect((e as ErrorApi).estado).toBe(422);
      expect((e as ErrorApi).codigo).toBe('PERIODO_DEMASIADO_GRANDE');
      expect((e as ErrorApi).message).toMatch(/Divídelo/);
    }
  });

  it('cupos por clave; liberar dos veces no devuelve dos cupos', () => {
    const cupos = new CuposSimultaneos(2);
    const a = cupos.tomar('t1')!;
    const b = cupos.tomar('t1')!;
    expect(cupos.tomar('t1')).toBeNull();
    expect(cupos.tomar('t2')).not.toBeNull();
    a();
    a();
    expect(cupos.enUso('t1')).toBe(1);
    expect(cupos.tomar('t1')).not.toBeNull();
    expect(cupos.tomar('t1')).toBeNull();
    b();
    expect(cupos.enUso('t1')).toBe(1);
  });
});

describe('cupos en las rutas', () => {
  /** App mínima: cupos y una ruta que transmite hasta que se le pide terminar; el tenant va en `?t=`. */
  function appDePrueba(limites: { porTenant: number; proceso: number; porLlave?: number }) {
    const reportes = new ReportesEnCurso(limites);
    const app = new Hono();
    const fin: Array<() => void> = [];
    app.onError((e, c) => {
      if (e instanceof ErrorApi) {
        if (typeof e.extra.reintentarEn === 'number') c.header('Retry-After', String(e.extra.reintentarEn));
        return c.json({ error: { codigo: e.codigo } }, e.estado);
      }
      return c.json({ error: { codigo: 'ERROR_INTERNO' } }, 500);
    });
    // La llave va en `?k=`; sin ella, cada solicitud es de una llave distinta (como antes del cupo por llave).
    let otra = 0;
    const mw = reportes.middleware((c) => c.req.query('t') ?? 'a', (c) => c.req.query('k') ?? `k${otra++}`);
    app.use('/r', mw);
    app.use('/falla', mw);
    app.use('/corto', mw);
    app.get('/r', async (c) => {
      let terminar!: () => void;
      const listo = new Promise<void>((r) => (terminar = r));
      fin.push(terminar);
      const { cuerpo } = await transmitir<object, null>({
        ejecutar: (fn) => fn({}),
        preparar: async () => null,
        producir: async (_tx, _p, escribir) => {
          await escribir('a'.repeat(TAMANO_PARTE)); // una parte completa: se envía ya
          await listo;
          await escribir('b');
        },
        liberar: reportes.reclamar(c.req.raw),
        registrar: () => undefined,
      });
      return c.body(cuerpo, 200);
    });
    app.get('/falla', async (c) => {
      await transmitir<object, null>({
        ejecutar: (fn) => fn({}),
        preparar: async () => {
          throw new ErrorApi(422, 'PERIODO_DEMASIADO_GRANDE', 'x');
        },
        producir: async () => undefined,
        liberar: reportes.reclamar(c.req.raw),
        registrar: () => undefined,
      });
      return c.text('no llega');
    });
    app.get('/corto', (c) => c.json({ ok: true }));
    return { app, fin, reportes };
  }

  it('429 con Retry-After por tenant; el cupo vuelve al terminar de transmitir', async () => {
    const { app, fin, reportes } = appDePrueba({ porTenant: 2, proceso: 10 });
    const r1 = await app.request('/r');
    const r2 = await app.request('/r');
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const r3 = await app.request('/r');
    expect(r3.status).toBe(429);
    expect(r3.headers.get('retry-after')).toBe('1');
    expect(((await r3.json()) as { error: { codigo: string } }).error.codigo).toBe('LIMITE_SOLICITUDES');
    expect((await app.request('/r?t=b')).status).toBe(200); // otro tenant
    fin[0]!();
    expect(await r1.text()).toBe('a'.repeat(TAMANO_PARTE) + 'b');
    expect(await hasta(() => reportes.porTenant.enUso('a') === 1)).toBe(true);
    expect((await app.request('/r')).status).toBe(200);
    fin.forEach((f) => f());
  });

  it('cupo por llave: una caja que lee despacio no deja sin cupo al admin del mismo tenant', async () => {
    const { app, fin, reportes } = appDePrueba({ porTenant: 2, proceso: 3, porLlave: 1 });
    const lento = await app.request('/r?k=caja');
    expect(lento.status).toBe(200);
    // La misma llave pide otro: 429, y no toma ni devuelve cupos del tenant ni del proceso.
    const segundo = await app.request('/r?k=caja');
    expect(segundo.status).toBe(429);
    expect(segundo.headers.get('retry-after')).toBe('1');
    expect(((await segundo.json()) as { error: { codigo: string } }).error.codigo).toBe('LIMITE_SOLICITUDES');
    expect([reportes.porTenant.enUso('a'), reportes.proceso.enUso('')]).toEqual([1, 1]);
    // El admin del mismo tenant sí entra.
    const admin = await app.request('/r?k=admin');
    expect(admin.status).toBe(200);
    fin.forEach((f) => f());
    await Promise.all([lento.text(), admin.text()]);
    expect(await hasta(() => reportes.porLlave.enUso('a:caja') === 0 && reportes.porTenant.enUso('a') === 0)).toBe(true);
    expect((await app.request('/r?k=caja')).status).toBe(200);
    fin.forEach((f) => f());
  });

  it('con el pool por omisión (10), el cupo del proceso (3) es mayor que el de un tenant (2)', () => {
    expect(reportesSimultaneosProceso(undefined, 10, {})).toBe(3);
    expect(reportesSimultaneosProceso(undefined, 10, {})).toBeGreaterThan(REPORTES_SIMULTANEOS);
  });

  it('el límite del proceso vale para todos los tenants juntos', async () => {
    const { app, fin, reportes } = appDePrueba({ porTenant: 2, proceso: 2 });
    const ra = await app.request('/r?t=a');
    const rb = await app.request('/r?t=b');
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const r = await app.request('/r?t=c');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('1');
    expect(reportes.porTenant.enUso('c')).toBe(0); // no se queda con el cupo del tenant
    fin.forEach((f) => f());
    await Promise.all([ra.text(), rb.text()]);
    expect(await hasta(() => reportes.proceso.enUso('') === 0)).toBe(true);
  });

  it('el cupo vuelve si el cliente corta la respuesta', async () => {
    const { app, fin, reportes } = appDePrueba({ porTenant: 1, proceso: 1 });
    const r = await app.request('/r');
    const lector = r.body!.getReader();
    await lector.read();
    await lector.cancel();
    fin.forEach((f) => f());
    expect(await hasta(() => reportes.proceso.enUso('') === 0 && reportes.porTenant.enUso('a') === 0)).toBe(true);
  });

  it('un 422 antes de transmitir y una respuesta que no transmite liberan el cupo', async () => {
    const { app, reportes } = appDePrueba({ porTenant: 1, proceso: 1 });
    expect((await app.request('/falla')).status).toBe(422);
    expect(await hasta(() => reportes.proceso.enUso('') === 0)).toBe(true);
    expect((await app.request('/corto')).status).toBe(200);
    expect(reportes.proceso.enUso('')).toBe(0);
  });

  it('HEAD: 405 (error JSON, Allow: GET) sin tomar cupo', async () => {
    const { app, reportes } = appDePrueba({ porTenant: 1, proceso: 1 });
    const r = await app.request('/r', { method: 'HEAD' });
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('GET');
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
    expect(reportes.proceso.enUso('')).toBe(0);
  });
});

describe('respuesta transmitida', () => {
  it('si preparar lanza, se rechaza (todavía se puede responder el error) y se libera', async () => {
    const { estado, promesa } = transmision(async () => undefined, {
      preparar: async () => {
        throw new ErrorApi(422, 'PERIODO_DEMASIADO_GRANDE', 'x');
      },
    });
    await expect(promesa).rejects.toMatchObject({ codigo: 'PERIODO_DEMASIADO_GRANDE' });
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
  });

  it('contrapresión: sin lector el productor no avanza; partes de 64 KB como máximo; libera al terminar', async () => {
    let escritas = 0;
    const { estado, promesa } = transmision(async (escribir) => {
      for (let i = 0; i < 10; i++) {
        await escribir('x'.repeat(40_000));
        escritas++;
      }
    });
    const { cuerpo, preparado } = await promesa;
    expect(preparado).toBe(7);
    await esperar(30);
    expect(escritas).toBeLessThan(10);
    expect(estado.abierta).toBe(true);
    const lector = cuerpo.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      expect(value.length).toBeLessThanOrEqual(TAMANO_PARTE);
      total += value.length;
    }
    expect(total).toBe(400_000);
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
    expect(estado.abierta).toBe(false);
  });

  it('un cliente lento que avanza no se corta, aunque la respuesta entera tarde más que el plazo por parte', async () => {
    const { estado, promesa } = transmision(async (escribir) => {
      await escribir('y'.repeat(1_000_000)); // un documento grande: se envía en partes
    }, { esperaEscrituraMs: 60 });
    const lector = (await promesa).cuerpo.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.length;
      await esperar(15); // 16 partes × 15 ms > 60 ms
    }
    expect(total).toBe(1_000_000);
    expect(estado.registros).toEqual([]);
  });

  it('si el cliente cancela, escribir devuelve false, la transacción termina y se libera', async () => {
    let resultado: boolean | undefined;
    const { estado, promesa } = transmision(async (escribir) => {
      await escribir('a'.repeat(TAMANO_PARTE));
      resultado = await escribir('b'.repeat(TAMANO_PARTE));
    });
    const lector = (await promesa).cuerpo.getReader();
    await lector.read();
    await lector.cancel();
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
    expect(resultado).toBe(false);
    expect(estado.abierta).toBe(false);
  });

  it('si el cliente deja de leer, el plazo por parte corta con error y libera', async () => {
    const { estado, promesa } = transmision(async (escribir) => {
      await escribir('a'.repeat(TAMANO_PARTE));
      await escribir('b'.repeat(TAMANO_PARTE));
    }, { esperaEscrituraMs: 30 });
    const { cuerpo } = await promesa;
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
    expect(estado.abierta).toBe(false);
    await expect(leerTodo(cuerpo)).rejects.toThrow();
  });

  it('plazo total: corta con error aunque el cliente siga leyendo, y libera', async () => {
    const { estado, promesa } = transmision(async (escribir) => {
      for (;;) if (!(await escribir('z'.repeat(TAMANO_PARTE)))) return;
    }, { duracionMaxMs: 80 });
    const lector = (await promesa).cuerpo.getReader();
    const inicio = Date.now();
    await expect((async () => {
      for (;;) {
        const { done } = await lector.read();
        if (done) return 'completo';
        await esperar(2);
      }
    })()).rejects.toThrow();
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
    expect(estado.abierta).toBe(false);
  });

  it('si ejecutar lanza sin devolver una promesa, se rechaza y se libera', async () => {
    const { estado, promesa } = transmision(async () => undefined, {
      ejecutar: () => {
        throw new Error('sin conexión');
      },
    });
    await expect(promesa).rejects.toThrow('sin conexión');
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
  });

  it('un motivo vacío también corta con error', async () => {
    const { estado, promesa } = transmision(async (escribir) => {
      await escribir('a');
      throw undefined; // eslint-disable-line no-throw-literal
    });
    await expect(leerTodo((await promesa).cuerpo)).rejects.toThrow();
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
  });

  it('alTerminar corre con la transacción cerrada y antes de la última parte; si falla, no llega completa', async () => {
    const vistos: Array<[boolean, boolean]> = [];
    const ok = transmision(async (escribir) => {
      await escribir('fin');
    }, {
      alTerminar: async (_p, completo) => {
        vistos.push([completo, ok.estado.abierta]);
      },
    });
    expect(await leerTodo((await ok.promesa).cuerpo)).toBe('fin');
    expect(vistos).toEqual([[true, false]]);

    const falla = transmision(async (escribir) => {
      await escribir('fin');
    }, {
      alTerminar: async () => {
        throw new Error('bitácora caída');
      },
    });
    await expect(leerTodo((await falla.promesa).cuerpo)).rejects.toThrow();
    expect(falla.estado.registros).toEqual(['Error al cerrar un reporte transmitido']);

    const cortes: boolean[] = [];
    const cancelada = transmision(async (escribir) => {
      await escribir('a'.repeat(TAMANO_PARTE));
      await escribir('b'.repeat(TAMANO_PARTE));
    }, {
      alTerminar: async (_p, completo) => {
        cortes.push(completo);
      },
    });
    const lector = (await cancelada.promesa).cuerpo.getReader();
    await lector.read();
    await lector.cancel();
    expect(await hasta(() => cancelada.estado.liberado === 1)).toBe(true);
    expect(cortes).toEqual([false]);
  });

  it('un error del productor corta la respuesta con error (no un archivo truncado que parezca completo)', async () => {
    const { estado, promesa } = transmision(async (escribir) => {
      await escribir('a');
      throw new Error('la base se cayó');
    });
    await expect(leerTodo((await promesa).cuerpo)).rejects.toThrow();
    expect(estado.registros).toEqual(['Error al transmitir un reporte']);
    expect(await hasta(() => estado.liberado === 1)).toBe(true);
  });
});
