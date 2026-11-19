/**
 * factura-hn — facturación para Honduras (Acuerdo 481-2017). Proyecto independiente, no afiliado al SAR.
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
  textoSeguroCSV,
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
  PATRON_CAI_BASICO,
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
  problemaDeOperador,
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
export { exportarTexto, leerExportacionJSONL, VERSION_EXPORTACION } from './exportacion';
export type { FormatoExportacion, LibroContable } from './exportacion';
export {
  CAUSALES_NO_UTILIZACION,
  decimoDiaHabilDelMesSiguiente,
  documentosNoUtilizados,
  noUtilizadosDelAlmacen,
} from './no-utilizados';
export type { CausalNoUtilizacion, OpcionesNoUtilizados, RangoNoUtilizado, UltimoConsumido } from './no-utilizados';
export { estaAnulado, LEYENDA_ANULADA } from './anulacion';
export { congelar } from './inmutable';
export { renderizarHTML, renderizarTexto } from './render';
export type { OpcionesRender } from './render';
export { filaLibroVentas, resumenVentas, libroVentasCSV } from './reportes';
export type { FilaLibroVentas, ResumenVentas } from './reportes';
