import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { mensajeEnEspanol } from '../src/mensajes-forma';

/** El mensaje del primer problema de `datos` con `esquema`, como lo da la API. */
const mensaje = (esquema: z.ZodType, datos: unknown) => {
  const r = esquema.safeParse(datos);
  if (r.success) throw new Error('se esperaba un error');
  return r.error.issues.map((i) => mensajeEnEspanol(i, datos));
};

describe('mensajes de forma (400) en español natural', () => {
  it('formatos: UUID, URL, fecha y patrones de la API', () => {
    expect(mensaje(z.object({ id: z.string().uuid() }), { id: 'x' })).toEqual(['UUID inválido']);
    expect(mensaje(z.object({ url: z.string().url() }), { url: 'notaurl' })).toEqual(['URL inválida']);
    expect(mensaje(z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), { desde: 'hoy' })).toEqual(['debe tener el formato AAAA-MM-DD']);
    expect(mensaje(z.string().regex(/^\d{3}-\d{3}-\d{2}-\d{8}$/), '1')).toEqual(['debe tener el formato 000-001-01-00000001']);
    expect(mensaje(z.string().regex(/^[a-z]+$/), '1')).toEqual(['no tiene el formato esperado']);
    expect(mensaje(z.email(), 'x')).toEqual(['correo electrónico inválido']);
  });

  it('tipos, rangos, valores y campos desconocidos', () => {
    expect(mensaje(z.object({ documento: z.object({}) }), {})).toEqual(['falta este dato (es obligatorio)']);
    expect(mensaje(z.object({ documento: z.object({}) }), { documento: 'hola' })).toEqual(['debe ser un objeto (llegó texto)']);
    expect(mensaje(z.number().int(), 1.5)).toEqual(['debe ser un número entero (llegó un número)']);
    expect(mensaje(z.array(z.string()).min(1), [])).toEqual(['debe tener al menos un elemento']);
    expect(mensaje(z.string().min(1), '')).toEqual(['no puede estar vacío']);
    expect(mensaje(z.string().max(2), 'abc')).toEqual(['debe tener a lo sumo 2 caracteres']);
    expect(mensaje(z.number().min(1), 0)).toEqual(['debe ser mayor o igual que 1']);
    expect(mensaje(z.number().lt(5), 9)).toEqual(['debe ser menor que 5']);
    expect(mensaje(z.enum(['carta', 'ticket']), 'a4')).toEqual(['debe ser uno de: «carta», «ticket»']);
    expect(mensaje(z.object({ a: z.string() }).strict(), { a: 'x', b: 1 })).toEqual(['campo desconocido: «b»']);
  });

  it('nada en inglés ni en el español literal de Zod', () => {
    const casos: [z.ZodType, unknown][] = [
      [z.string().uuid(), 'x'], [z.url(), 'x'], [z.string().regex(/^\d{4}-\d{2}-\d{2}$/), 'hoy'], [z.string(), 5], [z.number().int(), 1.5],
      [z.boolean(), 'x'], [z.literal('x'), 'y'], [z.number().multipleOf(0.01), 0.001], [z.union([z.string(), z.number()]), true],
    ];
    for (const [esquema, datos] of casos) {
      for (const m of mensaje(esquema, datos)) expect(m).not.toMatch(/Inválido |Entrada inválida|Cadena inválida|patrón|recibido|Invalid|expected/);
    }
  });

  it('un mensaje propio del esquema se respeta', () => {
    expect(mensaje(z.string().min(3, { message: 'Muy corto.' }), 'a')).toEqual(['Muy corto.']);
  });
});
