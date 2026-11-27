/**
 * Los mensajes de argumentos inválidos del MCP son los de la API REST: src/mensajes-forma.ts es una copia de
 * packages/api/src/mensajes-forma.ts (el MCP no depende de la API) y solo cambia el import de Zod y el comentario.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mensajeEnEspanol } from '../src/mensajes-forma';

const cuerpo = (ruta: string) =>
  readFileSync(ruta, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
    .replace(/^import \{ z \} from '[^']+';\n/m, '');

describe('mensajes de forma en español', () => {
  it('la copia del MCP es igual a la de la API', () => {
    const api = cuerpo(join(__dirname, '..', '..', 'api', 'src', 'mensajes-forma.ts'));
    expect(api).toContain('export function mensajeEnEspanol');
    expect(cuerpo(join(__dirname, '..', 'src', 'mensajes-forma.ts'))).toBe(api);
  });

  it('da los mensajes naturales, no los de Zod', () => {
    const esquema = z.object({ clave: z.string().min(8), n: z.number().int(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), isv: z.enum(['ISV15', 'EXENTO']) });
    const datos = { clave: 'corta', n: 'uno', fecha: '26/11/2026', isv: 'X' };
    const r = esquema.safeParse(datos);
    expect(r.success).toBe(false);
    const mensajes = Object.fromEntries(r.error!.issues.map((i) => [i.path.join('.'), mensajeEnEspanol(i, datos)]));
    expect(mensajes).toEqual({
      clave: 'debe tener al menos 8 caracteres',
      n: 'debe ser un número (llegó texto)',
      fecha: 'debe tener el formato AAAA-MM-DD',
      isv: 'debe ser uno de: «ISV15», «EXENTO»',
    });
    const falta = z.object({ x: z.string() }).safeParse({});
    expect(mensajeEnEspanol(falta.error!.issues[0]!, {})).toBe('falta este dato (es obligatorio)');
  });

  it('respeta el mensaje propio de un esquema', () => {
    const r = z.object({ x: z.string().min(3, 'pon al menos tres letras') }).safeParse({ x: 'a' });
    expect(mensajeEnEspanol(r.error!.issues[0]!, { x: 'a' })).toBe('pon al menos tres letras');
  });
});
