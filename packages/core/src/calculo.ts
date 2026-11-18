/**
 * Cálculo de líneas y totales con desglose del ISV por tasa (Reglamento Art. 11 num. 1 lit. g-i):
 * descuentos, importe exonerado, exento, gravado 15%, gravado 18%, ISV 15%, ISV 18% y total.
 *
 * Todo se calcula en `bigint` (ver dinero.ts). Escalas:
 * - cantidad y precio unitario: hasta 4 decimales (diezmilésimas);
 * - descuento e importes: centavos.
 *
 * Los descuentos reducen la base antes del ISV (Ley del ISV Art. 3: «No forman parte de la base gravable
 * los descuentos efectivos que consten en la factura»).
 *
 * El ISV se calcula sobre la suma de cada grupo de tasa, no línea por línea. Lectura elegida y
 * documentada (docs/investigacion.md, P-10): el Art. 11 h-i pide subtotales e impuestos por tarifa, y
 * redondear por línea puede dar un ISV impreso que no es la tasa × la base impresa.
 */
import { deCentavos, dividirRedondeando, ErrorMonto, escaladoATexto, parsearDecimal } from './dinero';
import { centavosEnLetras } from './letras';
import type { LineaCalculada, LineaEntrada, Moneda, Problema, Totales, TratamientoISV } from './tipos';

export const TASAS_ISV: Record<Exclude<TratamientoISV, 'EXENTO'>, number> = {
  ISV15: 15,
  ISV18: 18,
};

/** Decimales admitidos en cantidad y precio unitario. */
export const ESCALA_CANTIDAD = 4;
export const ESCALA_PRECIO = 4;

export interface OpcionesCalculo {
  preciosIncluyenISV?: boolean;
  /** Si el adquirente está exonerado, lo gravado pasa a "importe exonerado" sin ISV. */
  exonerado?: boolean;
  moneda?: Moneda;
}

export class ErrorCalculo extends Error {
  constructor(public readonly problemas: Problema[]) {
    super(problemas.map((p) => p.mensaje).join(' '));
    this.name = 'ErrorCalculo';
  }
}

interface LineaLeida {
  cantidad: bigint; // diezmilésimas
  precio: bigint; // diezmilésimas de lempira
  descuento: bigint; // centavos
}

function leer(valor: LineaEntrada[keyof LineaEntrada], escala: number, campo: string): bigint | string {
  try {
    return parsearDecimal(valor as string | number, escala, campo);
  } catch (e) {
    if (e instanceof ErrorMonto) return e.message;
    throw e;
  }
}

/** Importe bruto de la línea en centavos: cantidad × precio, redondeado una vez (mitad hacia arriba). */
function bruto(l: LineaLeida): bigint {
  // diezmilésimas × diezmilésimas = 10^-8 lempiras; a centavos se divide entre 10^6.
  return dividirRedondeando(l.cantidad * l.precio, 1_000_000n);
}

function leerLinea(l: LineaEntrada, i: number, problemas: Problema[]): LineaLeida | null {
  const campo = `lineas[${i}]`;
  const n = i + 1;
  const cantidad = leer(l.cantidad, ESCALA_CANTIDAD, 'La cantidad');
  const precio = leer(l.precioUnitario, ESCALA_PRECIO, 'El precio unitario');
  const descuento = leer(l.descuento ?? 0, 2, 'El descuento');
  let ok = true;
  if (typeof cantidad === 'string' || cantidad <= 0n) {
    problemas.push({ codigo: 'LINEA_CANTIDAD', mensaje: `Línea ${n}: ${typeof cantidad === 'string' ? cantidad : 'la cantidad debe ser mayor que 0.'}`, campo });
    ok = false;
  }
  if (typeof precio === 'string' || precio < 0n) {
    problemas.push({ codigo: 'LINEA_PRECIO', mensaje: `Línea ${n}: ${typeof precio === 'string' ? precio : 'el precio unitario no puede ser negativo.'}`, campo });
    ok = false;
  }
  if (typeof descuento === 'string' || descuento < 0n) {
    problemas.push({ codigo: 'LINEA_DESCUENTO', mensaje: `Línea ${n}: ${typeof descuento === 'string' ? descuento : 'el descuento no puede ser negativo.'}`, campo });
    ok = false;
  }
  if (!ok) return null;
  const leida = { cantidad: cantidad as bigint, precio: precio as bigint, descuento: descuento as bigint };
  if (leida.descuento > bruto(leida)) {
    problemas.push({ codigo: 'LINEA_DESCUENTO', mensaje: `Línea ${n}: el descuento supera el importe de la línea.`, campo });
    return null;
  }
  return leida;
}

export function validarLineas(lineas: LineaEntrada[]): Problema[] {
  const problemas: Problema[] = [];
  if (!Array.isArray(lineas) || lineas.length === 0) {
    problemas.push({ codigo: 'SIN_LINEAS', mensaje: 'El documento debe tener al menos una línea.', campo: 'lineas' });
    return problemas;
  }
  lineas.forEach((l, i) => {
    const campo = `lineas[${i}]`;
    if (!l.descripcion || !l.descripcion.trim())
      problemas.push({ codigo: 'LINEA_DESCRIPCION', mensaje: `Línea ${i + 1}: falta la descripción.`, campo });
    if (l.isv !== undefined && !['ISV15', 'ISV18', 'EXENTO'].includes(l.isv))
      problemas.push({ codigo: 'LINEA_ISV', mensaje: `Línea ${i + 1}: tratamiento ISV inválido "${l.isv}".`, campo });
    leerLinea(l, i, problemas);
  });
  return problemas;
}

function baseDesdeTotal(totalCentavos: bigint, tasa: number): bigint {
  return dividirRedondeando(totalCentavos * 100n, BigInt(100 + tasa));
}

/** Ley del ISV Art. 9: ISV = base × tasa, redondeado a centavos (≥ 0.005 sube). */
export function impuestoArt9(baseCentavos: bigint, tasa: number): bigint {
  return dividirRedondeando(baseCentavos * BigInt(tasa), 100n);
}

/** Resultado del cálculo en centavos exactos; `calcularDocumento` lo expone en lempiras. */
export interface TotalesCentavos {
  descuentos: bigint;
  subtotal: bigint;
  importeExonerado: bigint;
  importeExento: bigint;
  importeGravado15: bigint;
  importeGravado18: bigint;
  isv15: bigint;
  isv18: bigint;
  total: bigint;
}

export function calcularCentavos(
  lineas: LineaEntrada[],
  opciones: OpcionesCalculo = {},
): { lineas: Array<{ entrada: LineaEntrada; leida: LineaLeida; importe: bigint }>; totales: TotalesCentavos } {
  const problemas = validarLineas(lineas);
  if (problemas.length) throw new ErrorCalculo(problemas);

  const incluye = opciones.preciosIncluyenISV ?? false;
  const grupos: Record<TratamientoISV, bigint> = { ISV15: 0n, ISV18: 0n, EXENTO: 0n };
  let descuentos = 0n;

  const calculadas = lineas.map((entrada, i) => {
    const leida = leerLinea(entrada, i, [])!;
    const importe = bruto(leida) - leida.descuento;
    grupos[entrada.isv ?? 'ISV15'] += importe;
    descuentos += leida.descuento;
    return { entrada, leida, importe };
  });

  let gravado15 = 0n, gravado18 = 0n, isv15 = 0n, isv18 = 0n, exonerado = 0n;
  const base15 = incluye ? baseDesdeTotal(grupos.ISV15, TASAS_ISV.ISV15) : grupos.ISV15;
  const base18 = incluye ? baseDesdeTotal(grupos.ISV18, TASAS_ISV.ISV18) : grupos.ISV18;

  if (opciones.exonerado) {
    exonerado = base15 + base18;
  } else {
    gravado15 = base15;
    gravado18 = base18;
    isv15 = incluye ? grupos.ISV15 - base15 : impuestoArt9(base15, TASAS_ISV.ISV15);
    isv18 = incluye ? grupos.ISV18 - base18 : impuestoArt9(base18, TASAS_ISV.ISV18);
  }
  const exento = grupos.EXENTO;
  const subtotal = exonerado + exento + gravado15 + gravado18;
  const total = subtotal + isv15 + isv18;
  return {
    lineas: calculadas,
    totales: {
      descuentos, subtotal, importeExonerado: exonerado, importeExento: exento,
      importeGravado15: gravado15, importeGravado18: gravado18, isv15, isv18, total,
    },
  };
}

export function calcularDocumento(
  lineas: LineaEntrada[],
  opciones: OpcionesCalculo = {},
): { lineas: LineaCalculada[]; totales: Totales } {
  const r = calcularCentavos(lineas, opciones);
  const calculadas: LineaCalculada[] = r.lineas.map(({ entrada: l, leida, importe }) => {
    const linea: LineaCalculada = {
      descripcion: l.descripcion.trim(),
      cantidad: Number(escaladoATexto(leida.cantidad, ESCALA_CANTIDAD)),
      precioUnitario: Number(escaladoATexto(leida.precio, ESCALA_PRECIO)),
      isv: l.isv ?? 'ISV15',
      descuento: deCentavos(leida.descuento),
      importe: deCentavos(importe),
    };
    if (l.codigo !== undefined) linea.codigo = l.codigo;
    if (l.unidad !== undefined) linea.unidad = l.unidad;
    return linea;
  });
  const t = r.totales;
  const totales: Totales = {
    descuentos: deCentavos(t.descuentos),
    subtotal: deCentavos(t.subtotal),
    importeExonerado: deCentavos(t.importeExonerado),
    importeExento: deCentavos(t.importeExento),
    importeGravado15: deCentavos(t.importeGravado15),
    importeGravado18: deCentavos(t.importeGravado18),
    isv15: deCentavos(t.isv15),
    isv18: deCentavos(t.isv18),
    total: deCentavos(t.total),
    totalEnLetras: centavosEnLetras(t.total, opciones.moneda ?? 'HNL'),
  };
  return { lineas: calculadas, totales };
}
