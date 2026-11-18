/**
 * factura-hn — Facturación SAR Honduras (Acuerdo 481-2017).
 *
 * Flujo típico:
 *   await registrarAutorizacion(almacen, autorizacion);          // una vez por resolución del SAR
 *   const doc = await emitir(entrada, { almacen, establecimiento, puntoEmision });
 *   const html = renderizarHTML(doc);
 *   await anular(doc.numero, { almacen, motivo });                // Art. 41
 *
 * Solo hay un camino para emitir y uno para anular: `emitir` y `anular` sobre un `AlmacenFiscal`.
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
  diasEntre,
} from './autorizacion';
export type { EstadoAutorizacion } from './autorizacion';
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
  problemaDeTipo,
  TIPOS_NO_EMITIBLES_POR_SISTEMA,
  COMPROBANTES_FISCALES,
  ErrorValidacion,
  hoyHonduras,
  UMBRAL_CONSUMIDOR_FINAL,
  CONSUMIDOR_FINAL,
  DESTINO_EJEMPLARES,
} from './documento';
export { AlmacenFiscalMemoria, identificadorDe, identificadorDeNumero } from './almacen';
export type {
  AlmacenFiscal,
  TransaccionFiscal,
  EstadoSerie,
  FiltroDocumentos,
  EventoAuditoria,
  FiltroEventos,
  TipoEventoAuditoria,
} from './almacen';
export {
  emitir,
  anular,
  buscarDocumento,
  registrarAutorizacion,
  corregirFechaAdelantada,
  eventosAuditoria,
  SALTO_MAXIMO_DIAS,
  validarNuevaAutorizacion,
  elegirAutorizacion,
  nombreDeIdentificador,
} from './emision';
export type { OpcionesEmision } from './emision';
export { estaAnulado, LEYENDA_ANULADA } from './anulacion';
export { congelar } from './inmutable';
export { renderizarHTML, renderizarTexto } from './render';
export type { OpcionesRender } from './render';
export { filaLibroVentas, resumenVentas, libroVentasCSV } from './reportes';
export type { FilaLibroVentas, ResumenVentas } from './reportes';
