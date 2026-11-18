/**
 * `factura-hn/pruebas`: batería de contrato para adaptadores de `AlmacenFiscal`.
 * Se publica aparte para no cargarla en producción.
 */
export { ejecutarContratoAlmacen, DATOS_CONTRATO } from './pruebas/contrato';
export type { ConfigContrato, FuncionesDePrueba } from './pruebas/contrato';
