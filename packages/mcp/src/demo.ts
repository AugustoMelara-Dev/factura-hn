/**
 * Modo de prueba del MCP: emisor y CAI ficticios de `factura-hn/demo`, sin valor fiscal.
 */
import type { AutorizacionCAI } from 'factura-hn';
import { autorizacionDemo, EMISOR_DEMO, esCAIDemo, LEYENDA_PRUEBA } from 'factura-hn/demo';

export { EMISOR_DEMO, esCAIDemo, LEYENDA_PRUEBA };

/**
 * CAI ficticios para facturas (01) y notas de crédito y débito (06, 07), con `prueba: true`, rango 1–5000 (el de
 * las bases demo creadas antes) y fecha límite a 180 días de hoy (fecha de Honduras).
 */
export function autorizacionesDemo(o: { hoy?: Date; establecimiento?: string; puntoEmision?: string } = {}): AutorizacionCAI[] {
  return (['01', '06', '07'] as const).map((tipoDocumento) =>
    autorizacionDemo({ hoy: o.hoy, tipoDocumento, establecimiento: o.establecimiento, puntoEmision: o.puntoEmision, rangoFinal: 5000 }),
  );
}
