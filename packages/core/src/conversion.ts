/**
 * Conversión a lempiras de los totales de un documento en moneda extranjera. Es la única que usa factura-hn: el
 * libro de ventas, el equivalente impreso, el tope de las notas de crédito y los importes de una nota sobre un
 * original en moneda extranjera. Así una nota con las mismas líneas que el original lo acredita entero, el neto
 * del libro queda en 0 y cada fila cuadra al centavo.
 *
 * Regla: cada columna (exonerado, exento, gravado 0 %, 15 % y 18 %, y el ISV de cada tasa) se convierte con el tipo de
 * cambio del documento (Art. 11, párrafo final) y se redondea a centavos con la regla del Art. 9 de la Ley del ISV.
 * El total en lempiras es la suma de esas columnas, no el total convertido aparte: los dos pueden diferir en un
 * centavo por redondeo, y la fila del libro tiene que cuadrar.
 */
import type { TotalesCentavos } from './calculo';
import { dividirRedondeando, redondearDecimal } from './dinero';
import type { Totales } from './tipos';

/** Escala del tipo de cambio: 6 decimales. */
export const ESCALA_TIPO_CAMBIO = 1_000_000n;

type Columnas = Pick<
  Totales,
  'descuentos' | 'importeExonerado' | 'importeExento' | 'importeGravado0' | 'importeGravado15' | 'importeGravado18' | 'isv15' | 'isv18' | 'ajustePorRedondeo'
>;

/** Totales en centavos de la moneda del documento: `Totales` (números) o `TotalesCentavos` (bigint). */
type Entrada = { [K in keyof Columnas]: number | bigint };

/**
 * Totales en centavos de lempira de unos totales en moneda extranjera, con el tipo de cambio escalado a 6
 * decimales (`tc` = 24.6789 → 24_678_900n). Con `tc` = 1 000 000 (lempiras) devuelve los mismos importes.
 */
export function totalesALempiras(t: Entrada, tc: bigint): TotalesCentavos {
  const L = (v: number | bigint) => dividirRedondeando((typeof v === 'bigint' ? v : redondearDecimal(v, 2)) * tc, ESCALA_TIPO_CAMBIO);
  const importeExonerado = L(t.importeExonerado);
  const importeExento = L(t.importeExento);
  const importeGravado0 = L(t.importeGravado0);
  const importeGravado15 = L(t.importeGravado15);
  const importeGravado18 = L(t.importeGravado18);
  const isv15 = L(t.isv15);
  const isv18 = L(t.isv18);
  const subtotal = importeExonerado + importeExento + importeGravado0 + importeGravado15 + importeGravado18;
  return {
    descuentos: L(t.descuentos),
    subtotal,
    importeExonerado,
    importeExento,
    importeGravado0,
    importeGravado15,
    importeGravado18,
    baseCreditoFiscal: importeGravado15 + importeGravado18,
    isv15,
    isv18,
    total: subtotal + isv15 + isv18,
    ajustePorRedondeo: L(t.ajustePorRedondeo),
  };
}
