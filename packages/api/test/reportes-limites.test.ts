/**
 * Límites de los reportes de período sin base de datos: cupos por tenant, tope de documentos y cuerpo
 * transmitido (contrapresión, corte del cliente y plazo por escritura).
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/errores';
import {
  CuposSimultaneos,
  cuerpoTransmitido,
  exigirPeriodoAcotado,
  limitarReportes,
  MAX_DOCUMENTOS_REPORTE,
  maxDocumentosReporte,
} from '../src/reportes';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('tope de documentos por reporte', () => {
  it('opción, variable de entorno o 50 000; rechaza valores no enteros', () => {
    expect(maxDocumentosReporte(undefined, {})).toBe(MAX_DOCUMENTOS_REPORTE);
    expect(MAX_DOCUMENTOS_REPORTE).toBe(50_000);
    expect(maxDocumentosReporte(undefined, { FHN_MAX_DOCUMENTOS_REPORTE: '1200' })).toBe(1200);
    expect(maxDocumentosReporte(10, { FHN_MAX_DOCUMENTOS_REPORTE: '1200' })).toBe(10);
    expect(() => maxDocumentosReporte(undefined, { FHN_MAX_DOCUMENTOS_REPORTE: 'mucho' })).toThrow(/FHN_MAX_DOCUMENTOS_REPORTE/);
    expect(() => maxDocumentosReporte(0)).toThrow(/maxDocumentosReporte/);
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
});

describe('cupos de reportes simultáneos', () => {
  it('por clave; liberar dos veces no devuelve dos cupos', () => {
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

  /** App mínima: el middleware de cupos y una ruta que transmite hasta que se le pide terminar. */
  function appDePrueba(cupos: CuposSimultaneos) {
    const app = new Hono();
    const fin: Array<() => void> = [];
    app.onError((e, c) => {
      if (e instanceof ErrorApi) {
        if (typeof e.extra.reintentarEn === 'number') c.header('Retry-After', String(e.extra.reintentarEn));
        return c.json({ error: { codigo: e.codigo } }, e.estado);
      }
      return c.json({ error: { codigo: 'ERROR_INTERNO' } }, 500);
    });
    app.use('/r', limitarReportes(cupos, () => 'tenant'));
    app.get('/r', (c) => {
      let terminar!: () => void;
      const listo = new Promise<void>((r) => (terminar = r));
      fin.push(terminar);
      return c.body(cuerpoTransmitido(async (escribir) => {
        await escribir('a');
        await listo;
        await escribir('b');
      }, { registrar: () => undefined }), 200);
    });
    app.use('/falla', limitarReportes(cupos, () => 'tenant'));
    app.get('/falla', () => {
      throw new ErrorApi(422, 'PERIODO_DEMASIADO_GRANDE', 'x');
    });
    return { app, fin };
  }

  it('429 con Retry-After mientras hay dos respuestas sin terminar; el cupo vuelve al terminar de leerse', async () => {
    const cupos = new CuposSimultaneos(2);
    const { app, fin } = appDePrueba(cupos);
    const r1 = await app.request('/r');
    const r2 = await app.request('/r');
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const r3 = await app.request('/r');
    expect(r3.status).toBe(429);
    expect(r3.headers.get('retry-after')).toBe('1');
    expect(((await r3.json()) as { error: { codigo: string } }).error.codigo).toBe('LIMITE_SOLICITUDES');
    fin[0]!();
    expect(await r1.text()).toBe('ab');
    expect(cupos.enUso('tenant')).toBe(1);
    expect((await app.request('/r')).status).toBe(200);
    expect(cupos.enUso('tenant')).toBe(2);
    fin.forEach((f) => f());
  });

  it('el cupo vuelve si el cliente corta la respuesta', async () => {
    const cupos = new CuposSimultaneos(1);
    const { app, fin } = appDePrueba(cupos);
    const r = await app.request('/r');
    expect(cupos.enUso('tenant')).toBe(1);
    const lector = r.body!.getReader();
    expect(new TextDecoder().decode((await lector.read()).value)).toBe('a');
    await lector.cancel();
    expect(cupos.enUso('tenant')).toBe(0);
    fin.forEach((f) => f());
  });

  it('una respuesta de error libera el cupo de inmediato', async () => {
    const cupos = new CuposSimultaneos(1);
    const { app } = appDePrueba(cupos);
    expect((await app.request('/falla')).status).toBe(422);
    expect(cupos.enUso('tenant')).toBe(0);
  });

  it('HEAD no toma cupo (405)', async () => {
    const cupos = new CuposSimultaneos(1);
    const { app } = appDePrueba(cupos);
    const r = await app.request('/r', { method: 'HEAD' });
    expect(r.status).toBe(405);
    expect(cupos.enUso('tenant')).toBe(0);
  });
});

describe('cuerpo transmitido', () => {
  const leerTodo = (s: ReadableStream<Uint8Array>) => new Response(s).text();

  it('escribe las partes en orden y espera al lector (contrapresión)', async () => {
    let escritas = 0;
    const cuerpo = cuerpoTransmitido(async (escribir) => {
      for (let i = 0; i < 5; i++) {
        await escribir(`${i}`);
        escritas++;
      }
    }, { registrar: () => undefined });
    await esperar(20);
    expect(escritas).toBeLessThan(5); // nadie lee: el productor no avanza
    expect(await leerTodo(cuerpo)).toBe('01234');
    expect(escritas).toBe(5);
  });

  it('si el cliente cancela, escribir devuelve false y el productor termina', async () => {
    let resultado: boolean | undefined;
    let terminado = false;
    const cuerpo = cuerpoTransmitido(async (escribir) => {
      await escribir('a');
      resultado = await escribir('b');
      terminado = true;
    }, { registrar: () => undefined });
    const lector = cuerpo.getReader();
    await lector.read();
    await lector.cancel();
    for (let i = 0; i < 50 && !terminado; i++) await esperar(5);
    expect(terminado).toBe(true);
    expect(resultado).toBe(false);
  });

  it('si el cliente deja de leer, el plazo corta la respuesta y libera al productor', async () => {
    let resultado: boolean | undefined;
    const cuerpo = cuerpoTransmitido(async (escribir) => {
      await escribir('a');
      resultado = await escribir('b');
    }, { registrar: () => undefined, esperaMs: 30 });
    await esperar(120);
    expect(resultado).toBe(false);
    await expect(leerTodo(cuerpo)).rejects.toThrow();
  });

  it('un error del productor corta la respuesta con error (no un archivo truncado que parezca completo)', async () => {
    const registros: string[] = [];
    const cuerpo = cuerpoTransmitido(async (escribir) => {
      await escribir('a');
      throw new Error('la base se cayó');
    }, { registrar: (m) => registros.push(m) });
    await expect(leerTodo(cuerpo)).rejects.toThrow();
    expect(registros).toEqual(['Error al transmitir un reporte']);
  });
});
