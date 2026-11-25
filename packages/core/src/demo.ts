/**
 * `factura-hn/demo`: datos ficticios para probar sin un CAI real. Todo lo que se emite con ellos lleva
 * `modo: 'prueba'` y se imprime con la leyenda `LEYENDA_PRUEBA`: no tiene valor fiscal.
 *
 *   const facturador = await crearFacturadorDemo();
 *   const factura = await facturador.emitir({ lineas: [{ descripcion: 'Café 1 lb', cantidad: 2, precioUnitario: '120.00' }] });
 */
import { AlmacenFiscalMemoria, identificadorDe, type AlmacenFiscal } from './almacen';
import { esFechaValida, fechaHonduras } from './autorizacion';
import { ErrorValidacion } from './documento';
import { crearFacturador, type ConfigFacturador, type Facturador } from './facturador';
import { esCAIDemo, LEYENDA_PRUEBA } from './modo';
import type { AutorizacionCAI, Emisor, TipoDocumentoSoportado } from './tipos';

export { esCAIDemo, LEYENDA_PRUEBA };

/** Emisor ficticio. La razón social dice que no es real. */
export const EMISOR_DEMO: Readonly<Emisor> = Object.freeze({
  rtn: '99990000000000',
  razonSocial: 'NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)',
  nombreComercial: 'Pulpería Demostración',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'demo@ejemplo.example',
});

/**
 * Prefijo con el que se construyen los CAI demo; el CAI de cada tipo termina en su código (`…-01`, `…-06`,
 * `…-07`). Para reconocer un CAI ficticio usa `esCAIDemo`, que acepta cualquier `DEMO00-NO-VALIDO-…`.
 */
export const PREFIJO_CAI_DEMO = 'DEMO00-NO-VALIDO-0000-0000-0000-';

/** Días de vigencia de una autorización demo, contados desde hoy en Honduras. */
export const DIAS_VIGENCIA_DEMO = 180;

/**
 * CAI ficticio de un tipo de documento. Con `renovacion` (una fecha `YYYY-MM-DD`), el CAI de una demo renovada:
 * `DEMO00-NO-VALIDO-0000-0000-AAAAMMDD-TT`. Los dos cumplen `esCAIDemo`.
 */
export function caiDemo(tipoDocumento: TipoDocumentoSoportado = '01', renovacion?: string): string {
  return renovacion
    ? `DEMO00-NO-VALIDO-0000-0000-${renovacion.replace(/-/g, '')}-${tipoDocumento}`
    : `${PREFIJO_CAI_DEMO}${tipoDocumento}`;
}

export interface OpcionesAutorizacionDemo {
  /** Hoy: una fecha (se toma su fecha en Honduras) o `YYYY-MM-DD`. Por defecto, ahora. */
  hoy?: Date | string;
  tipoDocumento?: TipoDocumentoSoportado;
  establecimiento?: string | number;
  puntoEmision?: string | number;
  rangoInicial?: number;
  rangoFinal?: number;
  /** true para el CAI de una demo renovada (`caiDemo(tipo, hoy)`), distinto del de la primera. */
  renovacion?: boolean;
}

/** Hoy en Honduras, de una fecha o de un texto `YYYY-MM-DD`. Otra cosa es `FECHA_DEMO`. */
function fechaDeHoy(hoy: Date | string | undefined): string {
  if (hoy === undefined) return fechaHonduras(new Date());
  if (hoy instanceof Date && !Number.isNaN(hoy.getTime())) return fechaHonduras(hoy);
  if (typeof hoy === 'string' && esFechaValida(hoy)) return hoy;
  throw new ErrorValidacion([
    {
      codigo: 'FECHA_DEMO',
      mensaje: `autorizacionDemo: «hoy» debe ser una fecha (Date) o un texto YYYY-MM-DD válido, no ${JSON.stringify(String(hoy))}.`,
      campo: 'hoy',
    },
  ]);
}

/** `fecha` (YYYY-MM-DD) más `dias` días de calendario. */
function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Autorización ficticia, marcada como de prueba: CAI `DEMO00-NO-VALIDO-…`, rango del 1 al 1,000,000 y fecha
 * límite a 180 días de hoy en Honduras. No caduca en los ejemplos porque se calcula cada vez.
 */
export function autorizacionDemo(opciones: OpcionesAutorizacionDemo = {}): AutorizacionCAI {
  const hoy = fechaDeHoy(opciones.hoy);
  const tipoDocumento = opciones.tipoDocumento ?? '01';
  return {
    cai: caiDemo(tipoDocumento, opciones.renovacion ? hoy : undefined),
    tipoDocumento,
    establecimiento: String(opciones.establecimiento ?? '000').padStart(3, '0'),
    puntoEmision: String(opciones.puntoEmision ?? '001').padStart(3, '0'),
    rangoInicial: opciones.rangoInicial ?? 1,
    rangoFinal: opciones.rangoFinal ?? 1_000_000,
    fechaLimiteEmision: sumarDias(hoy, DIAS_VIGENCIA_DEMO),
    prueba: true,
  };
}

export interface OpcionesFacturadorDemo extends Partial<Omit<ConfigFacturador, 'almacen'>> {
  /** Almacén donde registrar los CAI demo. Por defecto uno en memoria, nuevo. */
  almacen?: AlmacenFiscal;
  /** Tipos con CAI demo. Por defecto factura, nota de crédito y nota de débito. */
  tipos?: TipoDocumentoSoportado[];
}

/**
 * Facturador listo para emitir documentos de prueba: emisor ficticio, almacén en memoria y CAI demo de
 * factura, nota de crédito y nota de débito ya registrados en la caja 000-001.
 *
 * Con un almacén persistente se puede llamar cada vez: si ya hay una demo vigente, no registra otra. Si la
 * demo del almacén venció (dura 180 días), registra una nueva con otro CAI ficticio (`caiDemo(tipo, hoy)`) y el
 * rango a continuación del anterior. Es solo para pruebas: un almacén con CAI demo no admite CAI reales en la
 * misma caja.
 */
export async function crearFacturadorDemo(opciones: OpcionesFacturadorDemo = {}): Promise<Facturador> {
  const { almacen = new AlmacenFiscalMemoria(), tipos = ['01', '06', '07'], ...config } = opciones;
  const facturador = crearFacturador({ emisor: EMISOR_DEMO, actor: 'demo', ...config, almacen });
  const ahora = (config.reloj ?? (() => new Date()))();
  const hoy = fechaHonduras(ahora);
  for (const tipoDocumento of tipos) {
    const base = { hoy, tipoDocumento, establecimiento: facturador.establecimiento, puntoEmision: facturador.puntoEmision };
    const ya = await almacen.transaccion((tx) => tx.autorizaciones(identificadorDe(autorizacionDemo(base))));
    const demos = ya.filter((a) => esCAIDemo(a.cai));
    if (demos.length === 0) {
      await facturador.registrarAutorizacion(autorizacionDemo(base));
      continue;
    }
    if (demos.some((a) => a.fechaLimiteEmision >= hoy)) continue;
    // Todas vencidas: una demo nueva, con otro CAI y el rango a continuación (los rangos no se solapan).
    const desde = Math.max(...ya.map((a) => a.rangoFinal)) + 1;
    const renovada = autorizacionDemo({ ...base, renovacion: true, rangoInicial: desde, rangoFinal: Math.min(desde + 999_999, 99_999_999) });
    if (ya.some((a) => a.cai === renovada.cai)) continue;
    await facturador.registrarAutorizacion(renovada);
  }
  return facturador;
}
