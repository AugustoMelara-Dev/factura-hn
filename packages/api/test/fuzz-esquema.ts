/**
 * Generador de valores a partir de los esquemas de `openapi.json` (el subconjunto de JSON Schema que usa la
 * especificación: type, properties, required, items, enum, anyOf, pattern, minLength/maxLength, minimum/maximum,
 * minItems/maxItems, additionalProperties, $ref). Sirve para el fuzzing: cuerpos que pasan la forma y llegan a las
 * reglas del núcleo, y luego se mutan.
 *
 * `pistas` cambia el generador de un campo por su nombre (p. ej. `precioUnitario` con montos con forma decimal),
 * para que los cuerpos válidos no se queden siempre en el primer error.
 */
import fc from 'fast-check';
import { SPEC } from './openapi-validador';

type Esquema = {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, Esquema>;
  required?: string[];
  items?: Esquema;
  enum?: unknown[];
  anyOf?: Esquema[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: Esquema | boolean;
  format?: string;
};

export type Pistas = Record<string, fc.Arbitrary<unknown>>;

function resolver(e: Esquema): Esquema {
  let actual = e;
  while (actual.$ref) {
    const nombre = actual.$ref.split('/').pop()!;
    actual = (SPEC.components as unknown as { schemas: Record<string, Esquema> }).schemas[nombre]!;
  }
  return actual;
}

const textoLibre = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 30 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 10 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 10 }) },
);

export function desdeEsquema(esquema: Esquema, pistas: Pistas = {}, profundidad = 0): fc.Arbitrary<unknown> {
  const e = resolver(esquema);
  if (e.enum) return fc.constantFrom(...e.enum);
  if (e.anyOf) return fc.oneof(...e.anyOf.map((x) => desdeEsquema(x, pistas, profundidad + 1)));
  const tipo = Array.isArray(e.type) ? e.type : e.type ? [e.type] : [];
  if (tipo.length > 1) return fc.oneof(...tipo.map((t) => desdeEsquema({ ...e, type: t }, pistas, profundidad)));
  switch (tipo[0]) {
    case 'string': {
      if (e.pattern) return fc.stringMatching(new RegExp(e.pattern));
      if (e.format === 'uri') return fc.oneof(fc.webUrl(), fc.constantFrom('https://receptor.ejemplo.example/webhook', 'http://127.0.0.1/x', 'https://[::1]/'));
      if (e.format === 'uuid') return fc.uuid();
      const max = Math.min(e.maxLength ?? 40, 40);
      const min = Math.min(e.minLength ?? 0, max);
      return textoLibre.map((s) => s.slice(0, max)).filter((s) => s.length >= min);
    }
    case 'integer':
      return fc.integer({ min: e.minimum ?? -1_000_000, max: e.maximum ?? 1_000_000_000 });
    case 'number':
      return fc.double({ min: e.minimum ?? -1e9, max: e.maximum ?? 1e9, noNaN: true });
    case 'boolean':
      return fc.boolean();
    case 'null':
      return fc.constant(null);
    case 'array': {
      const item = desdeEsquema(e.items ?? {}, pistas, profundidad + 1);
      return fc.array(item, { minLength: e.minItems ?? 0, maxLength: Math.min(e.maxItems ?? 4, 4) });
    }
    case 'object': {
      const props = Object.fromEntries(
        Object.entries(e.properties ?? {}).map(([k, v]) => [k, pistas[k] ?? desdeEsquema(v, pistas, profundidad + 1)]),
      );
      const base = fc.record(props, { requiredKeys: (e.required ?? []).filter((k) => k in props) });
      if (e.additionalProperties && typeof e.additionalProperties === 'object' && profundidad < 3) {
        return fc.tuple(base, fc.dictionary(fc.string({ maxLength: 8 }), desdeEsquema(e.additionalProperties, pistas, profundidad + 1), { maxKeys: 2 })).map(([b, extra]) => ({ ...extra, ...b }));
      }
      return base;
    }
    default:
      return fc.jsonValue({ maxDepth: 2 });
  }
}

/** Cambia un valor en una ruta al azar del objeto (o lo borra): la forma casi válida que más errores destapa. */
export function mutar(valor: unknown): fc.Arbitrary<unknown> {
  const rutas: Array<Array<string | number>> = [];
  const recorrer = (v: unknown, ruta: Array<string | number>) => {
    rutas.push(ruta);
    if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, [...ruta, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) recorrer(x, [...ruta, k]);
  };
  recorrer(valor, []);
  const nuevo = fc.oneof(
    fc.jsonValue({ maxDepth: 2 }),
    fc.constantFrom(null, '', -1, 0, 1e308, -1e-308, '1e400', '9'.repeat(40), '\u0000', '\ud800', 'NaN', true, [], {}, '__proto__'),
    fc.string({ unit: 'binary', maxLength: 20 }),
  );
  return fc.tuple(fc.constantFrom(...rutas), nuevo, fc.boolean()).map(([ruta, x, borrar]) => {
    if (ruta.length === 0) return x;
    const copia = structuredClone(valor) as Record<string | number, unknown>;
    let padre: Record<string | number, unknown> = copia;
    for (const k of ruta.slice(0, -1)) padre = padre[k] as Record<string | number, unknown>;
    const ultimo = ruta[ruta.length - 1]!;
    if (borrar && !Array.isArray(padre)) delete padre[ultimo];
    else padre[ultimo] = x;
    return copia;
  });
}
