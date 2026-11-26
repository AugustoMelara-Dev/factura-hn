/**
 * Catálogo de soluciones: qué hacer ante cada código de error del SDK, y el enlace a su explicación en
 * `docs/errores.md`. Los textos no cambian la regla fiscal de cada código: solo dicen cómo resolverlo.
 */
import type { Problema } from './tipos';

/** Base de los enlaces del catálogo de errores. El ancla es el código en minúsculas. */
export const URL_ERRORES = 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md';

/** Enlace a la explicación de un código en `docs/errores.md`. */
export function enlaceError(codigo: string): string {
  return `${URL_ERRORES}#${codigo.toLowerCase()}`;
}

const NOTA_REFERENCIA = 'Copia el CAI, el número y la fecha tal como están impresos en el documento original.';
const RESOLUCION = 'Cópialo tal como viene en la resolución del SAR.';

/**
 * Qué hacer ante cada código de error del SDK. Los avisos (`AVISO_*`) no bloquean y no llevan solución: se
 * explican en `docs/errores.md`.
 */
export const SOLUCIONES: Readonly<Record<string, string>> = {
  // Configuración y autorizaciones
  ALMACEN_REQUERIDO:
    'Pasa un almacén fiscal en `almacen`: `new AlmacenFiscalMemoria()` para probar, `AlmacenSQLite` o `AlmacenPostgres` para guardar de verdad.',
  SIN_AUTORIZACION:
    'Registra el CAI de esa serie con `registrarAutorizacion` (una vez por resolución del SAR). Para probar sin un CAI real, usa `crearFacturadorDemo()` de `factura-hn/demo`.',
  AUTORIZACION_VENCIDA:
    'Solicita al SAR una nueva autorización (CAI) y regístrala con `registrarAutorizacion`. La solicitud se hace en los dos meses previos a la fecha límite.',
  RANGO_AGOTADO:
    'Solicita al SAR un nuevo rango (CAI) y regístralo con `registrarAutorizacion`. `estadoAutorizacion` avisa antes de que se agote.',
  RANGO_SOLAPADO:
    'Ese rango ya pertenece a otro CAI de la misma serie. Revisa el rango inicial y final contra la resolución del SAR; si es una serie distinta, revisa establecimiento, punto de emisión y tipo.',
  AUTORIZACION_DUPLICADA:
    'Ese CAI ya está registrado en esta serie: no hace falta registrarlo otra vez. Si es una resolución nueva, revisa que copiaste el CAI nuevo.',
  AUTORIZACION_MODO_MEZCLADO:
    'Un punto de emisión pasa de prueba a real, nunca al revés: el que tiene o tuvo un CAI real no recibe autorizaciones de prueba. Prueba en otro almacén (otra base de datos, o `AlmacenFiscalMemoria`), no en otro punto del almacén real.',
  RANGO_USADO_EN_PRUEBA:
    'Esos números ya los usaron documentos de prueba en esta serie y no se repiten. Registra el CAI real en un almacén nuevo (otra base), donde la serie empiece en el primer número de tu resolución.',
  AUTORIZACION_PRUEBA_FORMATO: 'Pon `prueba: true` (booleano, sin comillas) en una autorización de prueba, u omítelo en una real.',
  AUTORIZACION_PRUEBA_CAI_REAL:
    'Quita `prueba: true` si el CAI es real. Para probar, usa `autorizacionDemo()` de `factura-hn/demo`, con un CAI `DEMO00-NO-VALIDO-…`, en otro almacén.',
  REFERENCIA_MODO_MEZCLADO:
    'Emite la nota en el mismo modo que el documento: una nota de prueba sobre un documento de prueba, una real sobre uno real.',
  DEMO_SIN_NUMEROS:
    'Usa otro almacén para la demo (p. ej. un `AlmacenFiscalMemoria` nuevo) u otro punto de emisión con `crearFacturadorDemo({ puntoEmision })`.',
  FECHA_DEMO: 'Pasa en «hoy» un `Date` válido o un texto `YYYY-MM-DD` (p. ej. `2026-11-24`), u omítelo para usar la fecha actual.',
  AUTORIZACION_TIPO: 'Usa la autorización del mismo tipo de documento que emites (01 factura, 06 nota de crédito, 07 nota de débito).',
  CAI_REQUERIDO: `Indica el CAI de la autorización. ${RESOLUCION}`,
  CAI_FORMATO: `Quita espacios y signos del CAI: solo letras, dígitos y guiones. ${RESOLUCION}`,
  TIPO_DOCUMENTO: "Usa un código de tipo vigente: '01' factura, '06' nota de crédito o '07' nota de débito.",
  ESTABLECIMIENTO: "Usa el código de establecimiento de 3 dígitos de la resolución (casa matriz = '000').",
  PUNTO_EMISION: "Usa el código de punto de emisión de 3 dígitos de la resolución (p. ej. '001').",
  RANGO: `El rango inicial y el final deben ser enteros entre 1 y 99999999, y el inicial no puede ser mayor que el final. ${RESOLUCION}`,
  FECHA_LIMITE: 'Escribe la fecha límite de emisión como AAAA-MM-DD, p. ej. 2027-06-30.',
  FECHA_AUTORIZACION: 'Escribe la fecha de la resolución como AAAA-MM-DD, u omite el campo.',
  ULTIMO_EMITIDO_ANTES:
    'Indica el último correlativo de esta autorización que emitiste fuera de este sistema; si no emitiste ninguno, omite el campo.',
  TIPO_NO_EMITIBLE: 'Ese documento no se emite por sistema computarizado. Emítelo por la vía que fija el Reglamento (imprenta o máquina registradora).',
  TIPO_NO_SOPORTADO: "Emite con `tipoDocumento` '01' (factura), '06' (nota de crédito) o '07' (nota de débito): son los que emite factura-hn.",
  CORRELATIVO_FUERA_DE_RANGO: 'Ese número está fuera del rango autorizado. Usa `emitir`, que toma el siguiente número del rango vigente por ti.',

  // Fecha y reloj
  FECHA_EMISION: 'Omite `fechaEmision`: la pone el reloj con la fecha de hoy en Honduras.',
  FECHA_EMISION_NO_ES_HOY: 'Omite `fechaEmision`: la pone el reloj. Si la fecha de hoy está mal, corrige el reloj del dispositivo.',
  FECHA_ANTERIOR_AL_ULTIMO:
    'Si el reloj de este dispositivo está atrasado, corrígelo. Si el último documento se emitió con el reloj adelantado, anúlalo con `corregirFechaAdelantada`.',
  RELOJ_ADELANTADO_SOSPECHOSO:
    'Revisa el reloj del dispositivo. Si la fecha es correcta (p. ej. el negocio estuvo cerrado), vuelve a emitir con `confirmarSaltoDeFecha: true`.',
  SIN_DOCUMENTOS_ADELANTADOS: 'No hay nada que corregir: esa serie no tiene documentos con fecha posterior a hoy. Sigue emitiendo con normalidad.',

  // Emisor
  EMISOR: 'Pasa los datos del emisor: rtn, razonSocial, nombreComercial, direccionCasaMatriz, direccionEstablecimiento, telefono y correo.',
  EMISOR_RTN: 'Usa el RTN del emisor de 14 dígitos, con o sin guiones.',
  EMISOR_NOMBRE: 'Indica la razón social o el nombre del emisor tal como está en el RTN.',
  EMISOR_NOMBRE_COMERCIAL: 'Indica el nombre comercial; si no tiene uno distinto, repite la razón social.',
  EMISOR_DIRECCION: 'Indica la dirección de la casa matriz en `direccionCasaMatriz`.',
  EMISOR_DIRECCION_ESTABLECIMIENTO: 'Indica en `direccionEstablecimiento` la dirección del establecimiento que emite (puede ser la de casa matriz).',
  EMISOR_TELEFONO: 'Indica el teléfono del emisor en `telefono`.',
  EMISOR_CORREO: 'Indica el correo del emisor registrado en el contrato de adhesión, con la forma nombre@dominio.',

  // Cliente
  CLIENTE_RTN: 'Usa el RTN del cliente de 14 dígitos, con o sin guiones, o quita el campo si el cliente no lo pidió.',
  CLIENTE_DNI: 'Usa el DNI del cliente de 13 dígitos, con o sin guiones.',
  CLIENTE_IDENTIFICACION: 'Indica el número de identificación del cliente, o quita `identificacion`.',
  CLIENTE_NOMBRE: 'Indica el nombre o la razón social del cliente.',
  CONSUMIDOR_FINAL_IDENTIFICACION:
    "Pide al cliente su nombre y su identificación: `cliente: { nombre, identificacion: { tipo: 'DNI', numero } }`, o su RTN.",

  // Líneas y montos
  SIN_LINEAS: 'Agrega al menos una línea con descripción, cantidad y precio unitario.',
  LINEA_DESCRIPCION: 'Escribe la descripción del producto o servicio de esa línea.',
  LINEA_CANTIDAD: "Usa una cantidad mayor que 0, como texto con punto decimal (p. ej. '1.5'), hasta 4 decimales.",
  LINEA_PRECIO: "Pasa el precio como texto con punto decimal (p. ej. '89.50'), hasta 4 decimales y sin símbolo de moneda.",
  LINEA_DESCUENTO: "Pasa el descuento como monto (no porcentaje) con punto decimal (p. ej. '5.00'), sin superar el importe de la línea.",
  LINEA_ISV: "Usa 'ISV15', 'ISV18', 'GRAVADO0' o 'EXENTO', u omite el campo (ISV15).",
  MONTO_FUERA_DE_RANGO: 'Revisa la cantidad y el precio de las líneas (y el tipo de cambio, en moneda extranjera): el total no puede pasar de L 9,999,999,999,999.99. Suele ser un error de digitación (un precio en centavos, o la cantidad y el precio intercambiados).',
  MONEDA: "Usa `moneda: 'HNL'` (lempiras, por defecto) o `'USD'` (dólares, con `tipoCambio`), en mayúsculas.",
  PRECIOS_INCLUYEN_ISV_FORMATO:
    "Pon `preciosIncluyenISV: true` o `false` (booleano, sin comillas), u omítelo (false). Si el valor viene de un formulario o de una variable de entorno, conviértelo antes: `valor === 'true'`.",
  TIPO_CAMBIO: "Indica `tipoCambio` en lempiras por unidad de la moneda extranjera de la fecha de emisión (p. ej. '24.6500').",

  // Exoneración
  EXONERACION_ORDEN: 'Pide al cliente el número de su Orden de Compra Exenta, o el número del registro SAG/RUPNSA.',
  EXONERACION_CONSTANCIA: 'Pide al cliente el número de su Constancia del Registro de Exonerados, o el número del registro SAG/RUPNSA.',

  // Notas de crédito y débito
  REFERENCIA: `Indica en \`referencia\` el documento original: cai, numero y fecha. ${NOTA_REFERENCIA}`,
  REFERENCIA_CAI: NOTA_REFERENCIA,
  REFERENCIA_NUMERO: "Usa el número de 16 dígitos del documento original, p. ej. '000-001-01-00000042'.",
  REFERENCIA_FECHA: 'Usa la fecha de emisión del documento original como AAAA-MM-DD.',
  REFERENCIA_FECHA_POSTERIOR: 'Revisa la fecha de la referencia: es la de emisión del documento original, anterior o igual a hoy.',
  REFERENCIA_TIPO: 'Una nota de crédito se aplica a un comprobante fiscal, como una factura. Revisa el número de la referencia.',
  REFERENCIA_MONEDA: "Usa 'HNL' o 'USD' como moneda del documento original.",
  REFERENCIA_TIPO_CAMBIO: 'Indica en `referencia.tipoCambio` el tipo de cambio del documento original.',
  REFERENCIA_NO_EXISTE: 'Revisa el número: ese documento no se ha emitido en esta serie.',
  REFERENCIA_ANULADA: 'A un documento anulado no se le aplica una nota. Si la venta sigue vigente, refiere al documento que la respalda.',
  REFERENCIA_CAI_NO_COINCIDE: `${NOTA_REFERENCIA} Con \`crearFacturador\`, \`notaCredito\` los toma del original.`,
  REFERENCIA_FECHA_NO_COINCIDE: `${NOTA_REFERENCIA} Con \`crearFacturador\`, \`notaCredito\` los toma del original.`,
  REFERENCIA_RTN_NO_COINCIDE: 'Usa el RTN del adquirente del documento original: la nota es para el mismo cliente.',
  REFERENCIA_MONEDA_NO_COINCIDE: 'Usa la moneda del documento original en `referencia.moneda`, u omítela para tomarla del original.',
  REFERENCIA_TIPO_CAMBIO_NO_COINCIDE: 'Usa el tipo de cambio del documento original, u omite `referencia.moneda` para tomarlo de él.',
  MOTIVO: 'Indica en `motivo` por qué se emite la nota (p. ej. «Devolución de 1 unidad»).',
  NOTA_CLIENTE_RTN: 'Indica `cliente: { nombre, rtn }` del adquirente. Si la factura original no tiene RTN, pídeselo al cliente.',
  NOTA_MONEDA: 'Emite la nota en lempiras: quita `moneda`. Si el original está en otra moneda, indica su moneda y tipo de cambio en `referencia`.',
  NOTA_SUPERA_ORIGINAL: 'Reduce la nota al saldo disponible que indica el mensaje, o revisa las notas ya emitidas sobre ese documento.',
  NOTA_TASA_DISTINTA: 'Usa en cada línea de la nota el mismo tratamiento de ISV que tenía esa línea en el documento original.',

  // Anulación y consulta
  ANULACION_MOTIVO: 'Indica por qué se anula (p. ej. «Cantidad equivocada»): queda en el documento y en la bitácora.',
  DOCUMENTO_CON_NOTAS:
    'Anula primero las notas de crédito y débito vigentes que indica el mensaje (con su propio motivo) y después el documento. Si la venta era real, emite el documento correcto y, si hace falta, sus notas.',
  YA_ANULADO: 'El documento ya está anulado: no hay que hacer nada. Si la venta era real, emite un documento nuevo.',
  DOCUMENTO_NO_ENCONTRADO: "Revisa el número: debe tener 16 dígitos con guiones (p. ej. '000-001-01-00000001') y estar en este almacén.",

  // Varios
  OPERADOR: 'Usa un nombre de 1 a 80 caracteres, sin saltos de línea ni caracteres de control, u omite el campo.',
  TEXTO_CARACTER_NO_PERMITIDO:
    'Quita del texto que indica `campo` los caracteres invisibles (NUL, ESC, etc.): suelen venir de copiar y pegar o de un lector de códigos. El tabulador y los saltos de línea sí se permiten.',
};

/**
 * Completa un problema con su solución y el enlace a su explicación, si el código es del SDK. No reemplaza
 * una solución que ya trae.
 */
export function conSolucion(p: Problema): Problema {
  const conocido = Object.prototype.hasOwnProperty.call(SOLUCIONES, p.codigo);
  if (!conocido) return p;
  return { ...p, solucion: p.solucion ?? SOLUCIONES[p.codigo]!, documentacion: p.documentacion ?? enlaceError(p.codigo) };
}
