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
 * factura-hn calcula el ISV sobre la suma de cada grupo de tasa, no línea por línea: así el ISV impreso es siempre
 * la tasa × la base impresa y cuadra con los subtotales e impuestos por tarifa que pide el Art. 11 h-i.
 */
import { centavosATexto, deCentavos, dividirRedondeando, ErrorMonto, escaladoATexto, parsearDecimal, type Monto } from './dinero';
import { centavosEnLetras, MONEDAS } from './letras';
import type { LineaCalculada, LineaEntrada, Moneda, Problema, Totales, TratamientoISV } from './tipos';

/**
 * Tasas del ISV en porcentaje: 15 % general y 18 % para los bienes y servicios que fija el Decreto 278-2013
 * Art. 16 (La Gaceta 33,316). El SDK **no** decide qué producto va al 18 %: lo indica el integrador en cada
 * línea (`isv: 'ISV18'`).
 */
export const TASAS_ISV: Record<Exclude<TratamientoISV, 'EXENTO' | 'GRAVADO0'>, number> = {
  ISV15: 15,
  ISV18: 18,
};

/**
 * Mayor total, en centavos, que el SDK calcula: L 9,999,999,999,999.99 (15 dígitos). No es una regla fiscal
 * (el Reglamento no fija un máximo): hasta aquí los importes salen exactos como `number` (15 cifras
 * significativas) y el total cabe en letras. Más arriba, `deCentavos` perdería centavos y `centavosEnLetras`
 * fallaría con RangeError a mitad de la emisión.
 */
export const MONTO_MAXIMO_CENTAVOS = 10n ** 15n - 1n;

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
    // Siempre es ErrorMonto (parsearDecimal solo lanza ErrorMonto, también con un objeto que no se puede
    // convertir a texto): la condición `true` es un mutante equivalente que se deja vivo.
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
    // `false` → `true` es un mutante equivalente que se deja vivo: el problema ya se
    // registró, y con cantidad y precio válidos la comparación de abajo no lanza ni agrega otro.
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

/**
 * `preciosIncluyenISV` es booleano. Un texto como `'false'` (de un formulario, una variable de entorno o una query
 * string) se rechaza: tomarlo como verdadero cobraría de menos e imprimiría «Precios incluyen ISV».
 */
export function problemaDePreciosIncluyenISV(valor: unknown, campo = 'preciosIncluyenISV'): Problema | null {
  if (valor === undefined || typeof valor === 'boolean') return null;
  return {
    codigo: 'PRECIOS_INCLUYEN_ISV_FORMATO',
    mensaje: `«preciosIncluyenISV» debe ser true o false (booleano), no ${JSON.stringify(valor) ?? String(valor)}.`,
    campo,
  };
}

/** Monedas en que se emite: lempiras y dólares. Otra moneda (o `'usd'` en minúsculas) es el error `MONEDA`. */
export function problemaDeMoneda(valor: unknown, campo = 'moneda'): Problema | null {
  if (valor === undefined || (typeof valor === 'string' && (MONEDAS as readonly string[]).includes(valor))) return null;
  return { codigo: 'MONEDA', mensaje: `La moneda debe ser 'HNL' o 'USD', no ${JSON.stringify(valor) ?? String(valor)}.`, campo };
}

export function validarLineas(lineas: LineaEntrada[]): Problema[] {
  const problemas: Problema[] = [];
  if (!Array.isArray(lineas) || lineas.length === 0) {
    problemas.push({ codigo: 'SIN_LINEAS', mensaje: 'El documento debe tener al menos una línea.', campo: 'lineas' });
    return problemas;
  }
  // Importe neto por grupo de tasa: el tope se mide con el ISV que corresponde a cada grupo.
  const grupos = { ISV15: 0n, ISV18: 0n, sinISV: 0n };
  let leidas = true;
  lineas.forEach((l, i) => {
    const campo = `lineas[${i}]`;
    if (typeof l !== 'object' || l === null || Array.isArray(l)) {
      problemas.push({ codigo: 'LINEA', mensaje: `Línea ${i + 1}: debe ser un objeto con descripcion, cantidad y precioUnitario.`, campo });
      leidas = false;
      return;
    }
    if (typeof l.descripcion !== 'string' || !l.descripcion.trim())
      problemas.push({ codigo: 'LINEA_DESCRIPCION', mensaje: `Línea ${i + 1}: ${typeof l.descripcion === 'string' || l.descripcion === undefined ? 'falta la descripción.' : 'la descripción debe ser texto.'}`, campo });
    if (l.isv !== undefined && !['ISV15', 'ISV18', 'GRAVADO0', 'EXENTO'].includes(l.isv))
      problemas.push({ codigo: 'LINEA_ISV', mensaje: `Línea ${i + 1}: tratamiento ISV inválido "${l.isv}".`, campo });
    const leida = leerLinea(l, i, problemas);
    const grupo = l.isv === 'EXENTO' || l.isv === 'GRAVADO0' ? 'sinISV' : l.isv === undefined || l.isv === 'ISV15' ? 'ISV15' : 'ISV18';
    if (leida) grupos[grupo] += bruto(leida) - leida.descuento;
    else leidas = false;
  });
  // Tope técnico, no fiscal (ver MONTO_MAXIMO_CENTAVOS). Se mide el total con el ISV de cada grupo de tasa sumado
  // aparte (precios sin ISV y sin exoneración): con el ISV incluido en el precio o con exoneración, el total real
  // es menor o igual. Una tasa inválida cuenta como 18 % (ya hay un error LINEA_ISV).
  const totalMaximo =
    grupos.sinISV + grupos.ISV15 + impuestoArt9(grupos.ISV15, TASAS_ISV.ISV15) + grupos.ISV18 + impuestoArt9(grupos.ISV18, TASAS_ISV.ISV18);
  if (leidas && totalMaximo > MONTO_MAXIMO_CENTAVOS) {
    problemas.push({
      codigo: 'MONTO_FUERA_DE_RANGO',
      mensaje: `El total de las líneas con su ISV sería L ${centavosATexto(totalMaximo)}: supera el máximo que se puede emitir, L ${centavosATexto(MONTO_MAXIMO_CENTAVOS)}.`,
      campo: 'lineas',
    });
  }
  return problemas;
}

/** Ley del ISV Art. 9: ISV = base × tasa, redondeado a centavos (≥ 0.005 sube). */
export function impuestoArt9(baseCentavos: bigint, tasa: number): bigint {
  return dividirRedondeando(baseCentavos * BigInt(tasa), 100n);
}

/**
 * Precio con ISV incluido → base e ISV que cumplen la Ley del ISV Art. 9.
 *
 * El ISV impreso siempre es `impuestoArt9(base, tasa)`: la tasa × la base impresa, redondeada con la
 * regla del Art. 9. Para un total T se busca la **mayor base b con b + ISV(b) ≤ T**. Si b + ISV(b) = T, el
 * precio se respeta exacto. Si no existe una base exacta (≈13 % de los montos al 15 % y ≈15 % al 18 %),
 * el total queda **1 centavo por debajo** del precio: se cobra de menos, nunca de más. `f(b) = b + ISV(b)` crece de 1 en 1 o de 2 en 2, así que el ajuste nunca pasa
 * de 1 centavo por tasa.
 */
export function baseDesdePrecioConISV(totalCentavos: bigint, tasa: number): { base: bigint; isv: bigint; ajuste: bigint } {
  // `<= 0n` → `< 0n` es un mutante equivalente que se deja vivo: con T = 0 el ciclo de abajo llega a base 0, ISV 0 y ajuste 0.
  if (totalCentavos <= 0n) return { base: 0n, isv: 0n, ajuste: 0n };
  // Cota superior: f(b) ≥ b·(100+tasa)/100 − ½, así que b ≤ (T + ½)·100/(100+tasa). Cambiar el «+ 1n» de adentro
  // por «- 1n» es un mutante equivalente que se deja vivo: mueve la cota menos de 1 y el «+ 1n» final la compensa.
  let base = ((totalCentavos * 2n + 1n) * 100n) / (BigInt(100 + tasa) * 2n) + 1n;
  // `base > 0n` → `base >= 0n` o `true` es un mutante equivalente que se deja vivo: con T > 0, en base 0 vale 0 + ISV(0) = 0 ≤ T
  // y el ciclo para.
  while (base > 0n && base + impuestoArt9(base, tasa) > totalCentavos) base -= 1n;
  const isv = impuestoArt9(base, tasa);
  return { base, isv, ajuste: totalCentavos - base - isv };
}

/** Resultado del cálculo en centavos exactos; `calcularDocumento` lo expone en lempiras. */
export interface TotalesCentavos {
  descuentos: bigint;
  subtotal: bigint;
  importeExonerado: bigint;
  importeExento: bigint;
  importeGravado15: bigint;
  importeGravado18: bigint;
  importeGravado0: bigint;
  /** gravado 15 % + gravado 18 % (Art. 11 num. 3). */
  baseCreditoFiscal: bigint;
  isv15: bigint;
  isv18: bigint;
  total: bigint;
  /** Centavos que el total queda por debajo de la suma de precios con ISV (Ley del ISV, Art. 9). 0 si no hubo ajuste. */
  ajustePorRedondeo: bigint;
}

export function calcularCentavos(
  lineas: LineaEntrada[],
  opciones: OpcionesCalculo = {},
): { lineas: Array<{ entrada: LineaEntrada; leida: LineaLeida; importe: bigint }>; totales: TotalesCentavos } {
  const problemas = validarLineas(lineas);
  // Solo `true` activa los precios con ISV incluido: un texto como 'false' es un error, no un «sí».
  const problemaPrecios = problemaDePreciosIncluyenISV(opciones.preciosIncluyenISV);
  if (problemaPrecios) problemas.push(problemaPrecios);
  if (problemas.length) throw new ErrorCalculo(problemas);

  const incluye = opciones.preciosIncluyenISV === true;
  const grupos: Record<TratamientoISV, bigint> = { ISV15: 0n, ISV18: 0n, GRAVADO0: 0n, EXENTO: 0n };
  let descuentos = 0n;

  const calculadas = lineas.map((entrada, i) => {
    // Las líneas ya se validaron: la lista de problemas queda vacía y cambiarla es equivalente.
    // Stryker disable next-line ArrayDeclaration: equivalente (ver arriba)
    const leida = leerLinea(entrada, i, [])!;
    const importe = bruto(leida) - leida.descuento;
    grupos[entrada.isv ?? 'ISV15'] += importe;
    descuentos += leida.descuento;
    return { entrada, leida, importe };
  });

  let gravado15 = 0n, gravado18 = 0n, isv15 = 0n, isv18 = 0n, exonerado = 0n, ajuste = 0n;
  const g15 = incluye ? baseDesdePrecioConISV(grupos.ISV15, TASAS_ISV.ISV15) : null;
  const g18 = incluye ? baseDesdePrecioConISV(grupos.ISV18, TASAS_ISV.ISV18) : null;
  const base15 = g15 ? g15.base : grupos.ISV15;
  const base18 = g18 ? g18.base : grupos.ISV18;

  if (opciones.exonerado) {
    // El adquirente exonerado paga solo la base; no hay ISV que redondear.
    exonerado = base15 + base18;
  } else {
    gravado15 = base15;
    gravado18 = base18;
    isv15 = impuestoArt9(base15, TASAS_ISV.ISV15);
    isv18 = impuestoArt9(base18, TASAS_ISV.ISV18);
    ajuste = (g15?.ajuste ?? 0n) + (g18?.ajuste ?? 0n);
  }
  const exento = grupos.EXENTO;
  // Alícuota cero (Art. 12): gravado, sin ISV; se discrimina aparte (Art. 11 num. 1 g).
  const gravado0 = grupos.GRAVADO0;
  const subtotal = exonerado + exento + gravado0 + gravado15 + gravado18;
  const total = subtotal + isv15 + isv18;
  return {
    lineas: calculadas,
    totales: {
      descuentos, subtotal, importeExonerado: exonerado, importeExento: exento,
      importeGravado15: gravado15, importeGravado18: gravado18, importeGravado0: gravado0,
      baseCreditoFiscal: gravado15 + gravado18, isv15, isv18, total,
      ajustePorRedondeo: ajuste,
    },
  };
}

export function calcularDocumento(
  lineas: LineaEntrada[],
  opciones: OpcionesCalculo = {},
): { lineas: LineaCalculada[]; totales: Totales; advertencias: Problema[] } {
  const problemaMoneda = problemaDeMoneda(opciones.moneda);
  if (problemaMoneda) throw new ErrorCalculo([problemaMoneda]);
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
    importeGravado0: deCentavos(t.importeGravado0),
    importeGravado15: deCentavos(t.importeGravado15),
    importeGravado18: deCentavos(t.importeGravado18),
    baseCreditoFiscal: deCentavos(t.baseCreditoFiscal),
    isv15: deCentavos(t.isv15),
    isv18: deCentavos(t.isv18),
    total: deCentavos(t.total),
    ajustePorRedondeo: deCentavos(t.ajustePorRedondeo),
    totalEnLetras: centavosEnLetras(t.total, opciones.moneda ?? 'HNL'),
  };
  return { lineas: calculadas, totales, advertencias: advertenciasDeCalculo(t) };
}

/** Avisos que dependen solo del cálculo. */
export function advertenciasDeCalculo(t: TotalesCentavos): Problema[] {
  if (t.ajustePorRedondeo === 0n) return [];
  return [{
    codigo: 'AVISO_AJUSTE_CENTAVO',
    mensaje: `El total se redujo L ${centavosATexto(t.ajustePorRedondeo)} para que el ISV impreso sea exactamente la tasa × la base (Ley del ISV Art. 9). Cobra el total del documento, no la suma de precios.`,
    campo: 'lineas',
  }];
}

/**
 * Sugiere precios con ISV incluido que no requieren ajuste por redondeo (Ley del ISV, Art. 9), para configurar el
 * precio de góndola. Con `cantidad` > 1 verifica el importe de la línea (precio × cantidad).
 * La sugerencia es por línea: en un documento con varias líneas de la misma tasa cuenta la suma del grupo.
 * @example sugerirPrecioSinAjuste('0.27') // { requiereAjuste: true, anterior: 0.26, siguiente: 0.28 }
 */
export function sugerirPrecioSinAjuste(
  precio: Monto,
  opciones: { isv?: Exclude<TratamientoISV, 'EXENTO' | 'GRAVADO0'>; cantidad?: Monto } = {},
): { requiereAjuste: boolean; anterior: number; siguiente: number } {
  const tasa = TASAS_ISV[opciones.isv ?? 'ISV15'];
  const p = parsearDecimal(precio, 2, 'El precio');
  const cant = parsearDecimal(opciones.cantidad ?? 1, ESCALA_CANTIDAD, 'La cantidad');
  const exacto = (c: bigint) => c >= 0n && baseDesdePrecioConISV(dividirRedondeando(c * cant, 10_000n), tasa).ajuste === 0n;
  let abajo = p;
  // `abajo > 0n` → `>= 0n` es un mutante equivalente que se deja vivo: el precio 0 siempre es exacto y el ciclo para ahí.
  while (abajo > 0n && !exacto(abajo)) abajo -= 1n;
  let arriba = p;
  while (!exacto(arriba)) arriba += 1n;
  return { requiereAjuste: !exacto(p), anterior: deCentavos(abajo), siguiente: deCentavos(arriba) };
}
