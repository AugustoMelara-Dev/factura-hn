/**
 * Cálculo de líneas y totales con desglose del ISV por tasa (Art. 11):
 * descuentos, importe exonerado, exento, gravado 15%, gravado 18%, ISV 15%, ISV 18% y total.
 *
 * Todo se calcula en centavos enteros. El ISV se calcula sobre la suma de cada grupo de tasa
 * (no línea por línea), así los totales siempre cuadran: total = subtotal + ISV15 + ISV18.
 */
import { aCentavos, deCentavos, redondearEntero } from './dinero';
import { montoEnLetras } from './letras';
import type { LineaCalculada, LineaEntrada, Moneda, Problema, Totales, TratamientoISV } from './tipos';

export const TASAS_ISV: Record<Exclude<TratamientoISV, 'EXENTO'>, number> = {
  ISV15: 15,
  ISV18: 18,
};

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
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0)
      problemas.push({ codigo: 'LINEA_CANTIDAD', mensaje: `Línea ${i + 1}: la cantidad debe ser mayor que 0.`, campo });
    if (!Number.isFinite(l.precioUnitario) || l.precioUnitario < 0)
      problemas.push({ codigo: 'LINEA_PRECIO', mensaje: `Línea ${i + 1}: el precio unitario no puede ser negativo.`, campo });
    if (l.isv !== undefined && !['ISV15', 'ISV18', 'EXENTO'].includes(l.isv))
      problemas.push({ codigo: 'LINEA_ISV', mensaje: `Línea ${i + 1}: tratamiento ISV inválido "${l.isv}".`, campo });
    const desc = l.descuento ?? 0;
    if (!Number.isFinite(desc) || desc < 0)
      problemas.push({ codigo: 'LINEA_DESCUENTO', mensaje: `Línea ${i + 1}: el descuento no puede ser negativo.`, campo });
    else if (Number.isFinite(l.cantidad) && Number.isFinite(l.precioUnitario)) {
      const bruto = redondearEntero(l.cantidad * aCentavos(l.precioUnitario));
      if (aCentavos(desc) > bruto)
        problemas.push({ codigo: 'LINEA_DESCUENTO', mensaje: `Línea ${i + 1}: el descuento supera el importe de la línea.`, campo });
    }
  });
  return problemas;
}

function baseDesdeTotal(totalCentavos: number, tasa: number): number {
  return redondearEntero((totalCentavos * 100) / (100 + tasa));
}

function impuesto(baseCentavos: number, tasa: number): number {
  return redondearEntero((baseCentavos * tasa) / 100);
}

export function calcularDocumento(
  lineas: LineaEntrada[],
  opciones: OpcionesCalculo = {},
): { lineas: LineaCalculada[]; totales: Totales } {
  const problemas = validarLineas(lineas);
  if (problemas.length) throw new ErrorCalculo(problemas);

  const incluye = opciones.preciosIncluyenISV ?? false;
  const grupos = { ISV15: 0, ISV18: 0, EXENTO: 0 };
  let descuentos = 0;

  const calculadas: LineaCalculada[] = lineas.map((l) => {
    const isv: TratamientoISV = l.isv ?? 'ISV15';
    const bruto = redondearEntero(l.cantidad * aCentavos(l.precioUnitario));
    const desc = aCentavos(l.descuento ?? 0);
    const importe = bruto - desc;
    grupos[isv] += importe;
    descuentos += desc;
    const linea: LineaCalculada = {
      descripcion: l.descripcion.trim(),
      cantidad: l.cantidad,
      precioUnitario: deCentavos(aCentavos(l.precioUnitario)),
      isv,
      descuento: deCentavos(desc),
      importe: deCentavos(importe),
    };
    if (l.codigo !== undefined) linea.codigo = l.codigo;
    if (l.unidad !== undefined) linea.unidad = l.unidad;
    return linea;
  });

  let gravado15 = 0, gravado18 = 0, isv15 = 0, isv18 = 0, exonerado = 0;
  const base15 = incluye ? baseDesdeTotal(grupos.ISV15, TASAS_ISV.ISV15) : grupos.ISV15;
  const base18 = incluye ? baseDesdeTotal(grupos.ISV18, TASAS_ISV.ISV18) : grupos.ISV18;

  if (opciones.exonerado) {
    exonerado = base15 + base18;
  } else {
    gravado15 = base15;
    gravado18 = base18;
    // Con precios con ISV, el impuesto es la diferencia exacta para que el total sea el precio cobrado.
    isv15 = incluye ? grupos.ISV15 - base15 : impuesto(base15, TASAS_ISV.ISV15);
    isv18 = incluye ? grupos.ISV18 - base18 : impuesto(base18, TASAS_ISV.ISV18);
  }
  const exento = grupos.EXENTO;
  const subtotal = exonerado + exento + gravado15 + gravado18;
  const total = subtotal + isv15 + isv18;

  const totales: Totales = {
    descuentos: deCentavos(descuentos),
    subtotal: deCentavos(subtotal),
    importeExonerado: deCentavos(exonerado),
    importeExento: deCentavos(exento),
    importeGravado15: deCentavos(gravado15),
    importeGravado18: deCentavos(gravado18),
    isv15: deCentavos(isv15),
    isv18: deCentavos(isv18),
    total: deCentavos(total),
    totalEnLetras: montoEnLetras(deCentavos(total), opciones.moneda ?? 'HNL'),
  };
  return { lineas: calculadas, totales };
}
