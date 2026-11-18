/**
 * Aritmética monetaria exacta, sin punto flotante en la ruta de cálculo.
 *
 * Ley del ISV, Art. 9 (redactado por Decreto 135-94): «Cuando al calcular dicho gravamen, resulte una
 * fracción menor de 0.005 de Lempira, deberá reducirse el recargo hasta la cifra de centavos próxima
 * inferior, en cambio, si la fracción citada es igual o mayor de 0.005 de Lempira, entonces podrá subirse
 * … El recargo del impuesto al consumidor fuera de la regla … se considerará como hurto.»
 * (docs/investigacion.md, ISV L.252-260).
 *
 * Un `number` binario no representa 0.10 exactamente, así que:
 * - Las entradas (`number` o `string`) se leen por su texto decimal y se convierten a `bigint` escalado.
 *   Un `number` se lee con `String(n)`, que es la representación decimal más corta que vuelve al mismo
 *   valor: `89.5` → "89.5" exacto. Si trae más decimales de los permitidos (p. ej. `0.1 + 0.2` →
 *   "0.30000000000000004") se rechaza en lugar de redondearse en silencio.
 * - Todo el cálculo ocurre en `bigint` (centavos o diezmilésimas).
 * - La conversión a `number` solo ocurre a la salida (`deCentavos`) para mantener la API.
 *
 * test/sin-flotante.test.ts vigila esto de forma estructural.
 */

/** Un monto o cantidad tal como lo entrega el integrador. Se recomienda `string` ("19.99"). */
export type Monto = number | string;

export class ErrorMonto extends RangeError {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorMonto';
  }
}

const PATRON_DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Descompone un decimal en signo, dígitos y exponente base 10: valor = signo · dígitos · 10^exp. */
function descomponer(valor: Monto): { negativo: boolean; digitos: bigint; exp: number } {
  let texto: string;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new ErrorMonto(`Monto inválido: ${valor}`);
    texto = String(valor);
  } else if (typeof valor === 'string') {
    texto = valor.trim().replace(/,/g, '');
  } else {
    throw new ErrorMonto(`Monto inválido: ${String(valor)}`);
  }
  const m = PATRON_DECIMAL.exec(texto);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new ErrorMonto(`Monto inválido: "${String(valor)}"`);
  const enteros = m[2] ?? '';
  const fraccion = m[3] ?? '';
  const exp = Number(m[4] ?? '0') - fraccion.length;
  return { negativo: m[1] === '-', digitos: BigInt((enteros + fraccion) || '0'), exp };
}

function potencia10(n: number): bigint {
  return 10n ** BigInt(n);
}

/**
 * Divide redondeando a entero, mitad lejos de cero: la regla del Art. 9 de la Ley del ISV
 * (≥ 0.005 sube, < 0.005 baja) aplicada en la unidad que corresponda.
 */
export function dividirRedondeando(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new ErrorMonto('División por cero');
  const negativo = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const q = (n * 2n + d) / (d * 2n);
  return negativo ? -q : q;
}

/**
 * Lee un decimal como entero escalado (`escala` decimales), **sin redondear**.
 * Lanza `ErrorMonto` si trae más decimales significativos que `escala`.
 * @example parsearDecimal('19.99', 2) // 1999n
 */
export function parsearDecimal(valor: Monto, escala: number, campo = 'monto'): bigint {
  const { negativo, digitos, exp } = descomponer(valor);
  const desplazamiento = exp + escala;
  let r: bigint;
  if (desplazamiento >= 0) r = digitos * potencia10(desplazamiento);
  else {
    const div = potencia10(-desplazamiento);
    if (digitos % div !== 0n) {
      throw new ErrorMonto(`${campo} admite como máximo ${escala} decimales: "${String(valor)}"`);
    }
    r = digitos / div;
  }
  return negativo ? -r : r;
}

/** Lee un decimal como entero escalado, redondeando (mitad lejos de cero) sobre su texto decimal exacto. */
export function redondearDecimal(valor: Monto, escala: number): bigint {
  const { negativo, digitos, exp } = descomponer(valor);
  const desplazamiento = exp + escala;
  const r = desplazamiento >= 0 ? digitos * potencia10(desplazamiento) : dividirRedondeando(digitos, potencia10(-desplazamiento));
  return negativo ? -r : r;
}

/** Centavos como entero. Redondea a 2 decimales sobre el texto decimal: `aCentavos(1.005) === 101`. */
export function aCentavos(monto: Monto): number {
  return Number(redondearDecimal(monto, 2));
}

/**
 * Centavos → lempiras como `number`, solo para la salida de la API.
 * Es la única división en flotante permitida (ver test/sin-flotante.test.ts).
 */
export function deCentavos(centavos: number | bigint): number {
  return Number(centavos) / 100; // permitido: salida
}

/** Redondea un monto a 2 decimales. */
export function redondear2(monto: Monto): number {
  return deCentavos(redondearDecimal(monto, 2));
}

/** Centavos como texto decimal exacto: 123456n → "1234.56". Sin separadores de miles. */
export function centavosATexto(centavos: number | bigint): string {
  const c = BigInt(centavos);
  const negativo = c < 0n;
  const abs = negativo ? -c : c;
  const enteros = (abs / 100n).toString();
  const dec = (abs % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${enteros}.${dec}`;
}

/** Formatea un monto como "1,234.56". */
export function formatearMonto(monto: Monto): string {
  const [enteros, dec] = centavosATexto(redondearDecimal(monto, 2)).split('.');
  const negativo = enteros!.startsWith('-');
  const digitos = negativo ? enteros!.slice(1) : enteros!;
  return `${negativo ? '-' : ''}${digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

/** Formatea con símbolo: "L 1,234.56" o "$ 1,234.56". */
export function formatearMoneda(monto: Monto, moneda: 'HNL' | 'USD' = 'HNL'): string {
  return `${moneda === 'HNL' ? 'L' : '$'} ${formatearMonto(monto)}`;
}

/** Texto decimal de un entero escalado, sin ceros sobrantes: (15000n, 4) → "1.5". */
export function escaladoATexto(valor: bigint, escala: number): string {
  const negativo = valor < 0n;
  const abs = negativo ? -valor : valor;
  const div = potencia10(escala);
  const fr = (abs % div).toString().padStart(escala, '0').replace(/0+$/, '');
  return `${negativo ? '-' : ''}${(abs / div).toString()}${fr ? '.' + fr : ''}`;
}
