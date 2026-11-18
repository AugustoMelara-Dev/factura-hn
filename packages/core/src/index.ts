/**
 * factura-hn — Facturación SAR Honduras (Acuerdo 481-2017).
 *
 * Flujo típico:
 *   const doc = await crearDocumento(entrada, { autorizacion, almacen });
 *   const html = renderizarHTML(doc);
 */
export * from './tipos';
export {
  aCentavos,
  deCentavos,
  redondear2,
  formatearMonto,
  formatearMoneda,
  parsearDecimal,
  redondearDecimal,
  dividirRedondeando,
  centavosATexto,
  escaladoATexto,
  ErrorMonto,
} from './dinero';
export type { Monto } from './dinero';
export { montoEnLetras, centavosEnLetras, enteroALetras } from './letras';
export {
  TIPOS_DOCUMENTO,
  CORRELATIVO_MAXIMO,
  formatearNumero,
  parsearNumero,
  esNumeroValido,
  numeroDesdeAutorizacion,
  formatearRango,
  perteneceAAutorizacion,
} from './numeracion';
export type { PartesNumero } from './numeracion';
export {
  esRTNValido,
  esDNIValido,
  esCAIValido,
  formatearRTN,
  formatearDNI,
  limpiarIdentificador,
  normalizarCAI,
  PATRON_CAI,
} from './identificacion';
export {
  validarAutorizacion,
  estadoAutorizacion,
  fechaHonduras,
  horaHonduras,
  esFechaValida,
} from './autorizacion';
export type { EstadoAutorizacion } from './autorizacion';
export { AlmacenMemoria, RangoAgotadoError } from './correlativos';
export type { AlmacenCorrelativos } from './correlativos';
export {
  calcularDocumento,
  calcularCentavos,
  impuestoArt9,
  baseDesdePrecioConISV,
  sugerirPrecioSinAjuste,
  advertenciasDeCalculo,
  validarLineas,
  TASAS_ISV,
  ESCALA_CANTIDAD,
  ESCALA_PRECIO,
  ErrorCalculo,
} from './calculo';
export type { OpcionesCalculo, TotalesCentavos } from './calculo';
export {
  validarEntrada,
  construirDocumento,
  crearDocumento,
  ErrorValidacion,
  hoyHonduras,
  UMBRAL_CONSUMIDOR_FINAL,
  CONSUMIDOR_FINAL,
  DESTINO_EJEMPLARES,
} from './documento';
export { renderizarHTML, renderizarTexto } from './render';
export type { OpcionesRender } from './render';
export { filaLibroVentas, resumenVentas, libroVentasCSV } from './reportes';
export type { FilaLibroVentas, ResumenVentas } from './reportes';
