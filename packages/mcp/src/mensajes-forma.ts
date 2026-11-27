/**
 * Copia de packages/api/src/mensajes-forma.ts (el MCP no depende de la API): los mismos mensajes en español para
 * los argumentos de las herramientas. Solo cambia el import de Zod; test/mensajes-forma.test.ts revisa que sigan iguales.
 */
import { z } from 'zod';

const LOCALE_ES = z.locales.es().localeError;
const LOCALE_EN = z.locales.en().localeError;
const textoDe = (m: unknown): string | undefined => (typeof m === 'string' ? m : (m as { message?: string } | null | undefined)?.message);

/** Patrones de la API con su forma dicha en palabras. Uno que no esté aquí da «no tiene el formato esperado». */
const PATRONES: Record<string, string> = {
  '^\\d{4}-\\d{2}-\\d{2}$': 'debe tener el formato AAAA-MM-DD',
  '^\\d{3}$': 'debe tener 3 dígitos (p. ej. 001)',
  '^\\d{3}-\\d{3}-\\d{2}$': 'debe tener el formato 000-001-01',
  '^\\d{3}-\\d{3}-\\d{2}-\\d{8}$': 'debe tener el formato 000-001-01-00000001',
  '^[0-9a-f]{12}$': 'debe tener 12 caracteres hexadecimales (0-9, a-f)',
};

const FORMATOS: Record<string, string> = {
  uuid: 'UUID inválido',
  guid: 'UUID inválido',
  url: 'URL inválida',
  email: 'correo electrónico inválido',
  datetime: 'debe ser una fecha y hora ISO 8601 (p. ej. 2026-11-18T14:30:00-06:00)',
  date: 'debe tener el formato AAAA-MM-DD',
  time: 'debe tener el formato HH:MM:SS',
};

/** Lo que se esperaba, con su artículo. */
const ESPERADO: Record<string, string> = {
  string: 'texto',
  number: 'un número',
  int: 'un número entero',
  bigint: 'un número entero',
  boolean: 'verdadero o falso',
  object: 'un objeto',
  array: 'una lista',
  null: 'null',
  date: 'una fecha',
};

function recibido(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'una lista';
  switch (typeof v) {
    case 'string': return 'texto';
    case 'number': return Number.isFinite(v) ? 'un número' : 'un número no válido';
    case 'boolean': return 'verdadero o falso';
    case 'object': return 'un objeto';
    default: return typeof v;
  }
}

const valor = (v: unknown) => (typeof v === 'string' ? `«${v}»` : String(v));

function natural(issue: z.core.$ZodIssue, input: unknown): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      if (input === undefined) return 'falta este dato (es obligatorio)';
      return `debe ser ${ESPERADO[issue.expected] ?? issue.expected} (llegó ${recibido(input)})`;
    case 'invalid_format':
      if (issue.format === 'regex') {
        // Zod lo trae como `/fuente/banderas`.
        const fuente = ((issue as { pattern?: string }).pattern ?? '').replace(/^\/(.*)\/[a-z]*$/s, '$1');
        return PATRONES[fuente] ?? 'no tiene el formato esperado';
      }
      if (issue.format === 'starts_with') return `debe empezar con ${valor((issue as { prefix?: string }).prefix)}`;
      if (issue.format === 'ends_with') return `debe terminar con ${valor((issue as { suffix?: string }).suffix)}`;
      if (issue.format === 'includes') return `debe contener ${valor((issue as { includes?: string }).includes)}`;
      return FORMATOS[issue.format] ?? 'formato inválido';
    case 'too_small': {
      const n = Number(issue.minimum);
      if (issue.origin === 'string') {
        if (issue.exact) return `debe tener exactamente ${n} caracteres`;
        return n === 1 ? 'no puede estar vacío' : `debe tener al menos ${n} caracteres`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        if (issue.exact) return `debe tener exactamente ${n} elementos`;
        return n === 1 ? 'debe tener al menos un elemento' : `debe tener al menos ${n} elementos`;
      }
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
        return issue.inclusive === false ? `debe ser mayor que ${n}` : `debe ser mayor o igual que ${n}`;
      }
      return undefined;
    }
    case 'too_big': {
      const n = Number(issue.maximum);
      if (issue.origin === 'string') {
        if (issue.exact) return `debe tener exactamente ${n} caracteres`;
        return `debe tener a lo sumo ${n} caracteres`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        if (issue.exact) return `debe tener exactamente ${n} elementos`;
        return `debe tener a lo sumo ${n} elementos`;
      }
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
        return issue.inclusive === false ? `debe ser menor que ${n}` : `debe ser menor o igual que ${n}`;
      }
      return undefined;
    }
    case 'invalid_value':
      return issue.values.length === 1 ? `debe ser ${valor(issue.values[0])}` : `debe ser uno de: ${issue.values.map(valor).join(', ')}`;
    case 'unrecognized_keys':
      return issue.keys.length === 1 ? `campo desconocido: ${valor(issue.keys[0])}` : `campos desconocidos: ${issue.keys.map(valor).join(', ')}`;
    case 'not_multiple_of':
      return `debe ser múltiplo de ${String(issue.divisor)}`;
    case 'invalid_union':
      return 'no tiene un valor válido';
    default:
      return undefined;
  }
}

/**
 * Mensaje en español de un problema de forma. Zod ya no trae la entrada en el problema; se toma de `datos` (lo que
 * se validó) por su ruta. Un mensaje propio del esquema se respeta: solo se traduce el que coincide con el mensaje
 * por omisión de Zod.
 */
export function mensajeEnEspanol(issue: z.core.$ZodIssue, datos: unknown): string {
  const input = issue.path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k as PropertyKey] : undefined), datos);
  const conEntrada = { ...issue, input } as Parameters<typeof LOCALE_ES>[0];
  if (textoDe(LOCALE_EN(conEntrada)) !== issue.message) return issue.message;
  return natural(issue, input) ?? textoDe(LOCALE_ES(conEntrada)) ?? issue.message;
}
