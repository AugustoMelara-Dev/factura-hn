/**
 * `factura-hn/demo`: datos ficticios para probar sin un CAI real. Todo lo que se emite con ellos lleva
 * `modo: 'prueba'` y se imprime con la leyenda `LEYENDA_PRUEBA`: no tiene valor fiscal.
 *
 *   const facturador = await crearFacturadorDemo();
 *   const factura = await facturador.emitir({ lineas: [{ descripcion: 'Café 1 lb', cantidad: 2, precioUnitario: '120.00' }] });
 */
import { AlmacenFiscalMemoria, identificadorDe, type AlmacenFiscal } from './almacen';
import { fechaHonduras } from './autorizacion';
import { crearFacturador, type ConfigFacturador, type Facturador } from './facturador';
import { LEYENDA_PRUEBA } from './modo';
import type { AutorizacionCAI, Emisor, TipoDocumentoSoportado } from './tipos';

export { LEYENDA_PRUEBA };

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

/** Prefijo de los CAI ficticios; el CAI de cada tipo termina en su código (`…-01`, `…-06`, `…-07`). */
export const PREFIJO_CAI_DEMO = 'DEMO00-NO-VALIDO-0000-0000-0000-';

/**
 * true si el CAI es el ficticio de demostración (prefijo `DEMO00-NO-VALIDO-`), sin importar mayúsculas ni espacios
 * en los extremos. Un CAI real del SAR no puede empezar así. Sirve para documentos emitidos antes de que existiera
 * `modo: 'prueba'` (la API y el MCP los reconocen solo por el CAI); para lo nuevo, usa `esDocumentoDePrueba`.
 */
export function esCAIDemo(cai: string): boolean {
  return typeof cai === 'string' && cai.trim().toUpperCase().startsWith(PREFIJO_CAI_DEMO.toUpperCase());
}

/** Días de vigencia de una autorización demo, contados desde hoy en Honduras. */
export const DIAS_VIGENCIA_DEMO = 180;

/** CAI ficticio de un tipo de documento. */
export function caiDemo(tipoDocumento: TipoDocumentoSoportado = '01'): string {
  return `${PREFIJO_CAI_DEMO}${tipoDocumento}`;
}

export interface OpcionesAutorizacionDemo {
  /** Hoy: una fecha (se toma su fecha en Honduras) o `YYYY-MM-DD`. Por defecto, ahora. */
  hoy?: Date | string;
  tipoDocumento?: TipoDocumentoSoportado;
  establecimiento?: string | number;
  puntoEmision?: string | number;
  rangoInicial?: number;
  rangoFinal?: number;
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
  const hoy = typeof opciones.hoy === 'string' ? opciones.hoy : fechaHonduras(opciones.hoy ?? new Date());
  const tipoDocumento = opciones.tipoDocumento ?? '01';
  return {
    cai: caiDemo(tipoDocumento),
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
 * factura, nota de crédito y nota de débito ya registrados en la caja 000-001. Si el almacén ya tiene los CAI
 * demo de esa caja, no los repite.
 */
export async function crearFacturadorDemo(opciones: OpcionesFacturadorDemo = {}): Promise<Facturador> {
  const { almacen = new AlmacenFiscalMemoria(), tipos = ['01', '06', '07'], ...config } = opciones;
  const facturador = crearFacturador({ emisor: EMISOR_DEMO, actor: 'demo', ...config, almacen });
  const hoy = (config.reloj ?? (() => new Date()))();
  for (const tipoDocumento of tipos) {
    const aut = autorizacionDemo({ hoy, tipoDocumento, establecimiento: facturador.establecimiento, puntoEmision: facturador.puntoEmision });
    const ya = await almacen.transaccion((tx) => tx.autorizaciones(identificadorDe(aut)));
    if (ya.some((a) => a.cai === aut.cai)) continue;
    await facturador.registrarAutorizacion(aut);
  }
  return facturador;
}
