/**
 * Modo de prueba del MCP: emisor y CAI ficticios, sin valor fiscal.
 * TODO(lote2-integracion): usar factura-hn/demo (crearFacturadorDemo, EMISOR_DEMO, autorizacionDemo, LEYENDA_PRUEBA).
 */
import { fechaHonduras, type AutorizacionCAI, type Emisor } from 'factura-hn';

/** Texto exacto aprobado por el responsable (con raya, U+2014). */
export const LEYENDA_PRUEBA = 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL';

/** Prefijo de los CAI ficticios: el mismo del tenant demo de la API. No es un CAI del SAR. */
export const PREFIJO_CAI_DEMO = 'DEMO00-NO-VALIDO-';

/** Días de vigencia del CAI ficticio, contados desde hoy (como el tenant demo de la API). */
const DIAS_DEMO = 180;

/** true si el CAI es el ficticio de prueba. */
export const esCAIDemo = (cai: string | undefined) => Boolean(cai?.trim().toUpperCase().startsWith(PREFIJO_CAI_DEMO));

export const EMISOR_DEMO: Emisor = {
  rtn: '99990000000000',
  razonSocial: 'NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)',
  nombreComercial: 'Demo factura-hn',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'demo@ejemplo.example',
};

/** Suma días a una fecha YYYY-MM-DD, sin depender de la zona horaria del equipo. */
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * CAI ficticios para facturas (01) y notas de crédito y débito (06, 07), rango 1–5000, con fecha límite a
 * 180 días de hoy (fecha de Honduras).
 */
export function autorizacionesDemo(o: { hoy?: Date; establecimiento?: string; puntoEmision?: string } = {}): AutorizacionCAI[] {
  const limite = sumarDias(fechaHonduras(o.hoy ?? new Date()), DIAS_DEMO);
  return (['01', '06', '07'] as const).map((tipoDocumento) => ({
    cai: `${PREFIJO_CAI_DEMO}0000-0000-0000-${tipoDocumento}`,
    tipoDocumento,
    establecimiento: o.establecimiento ?? '000',
    puntoEmision: o.puntoEmision ?? '001',
    rangoInicial: 1,
    rangoFinal: 5000,
    fechaLimiteEmision: limite,
  }));
}
