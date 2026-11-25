/**
 * Qué hacer ante cada error, y el enlace a su entrada en la guía de errores (`docs/errores.md`, un encabezado
 * `### CODIGO` por código). El texto está escrito para el asistente, que se lo explica al usuario.
 */
import type { Problema } from 'factura-hn';

const GUIA = 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md';

/** Enlace a la entrada del código en la guía de errores. */
export const enlaceGuia = (codigo: string) => `${GUIA}#${codigo.toLowerCase()}`;

const REGISTRAR =
  'Registra el CAI de la resolución del SAR con la herramienta registrar_cai (con los datos que te dé el usuario) ' +
  'o con `npx -y @factura-hn/mcp registrar-cai`. Para probar sin CAI real: `npx -y @factura-hn/mcp init --demo`.';

const SOLUCIONES: Record<string, string> = {
  SIN_AUTORIZACION: `No hay un CAI registrado para esta serie. ${REGISTRAR}`,
  AUTORIZACION_VENCIDA: `El CAI pasó su fecha límite de emisión (Art. 59). Pide al usuario la nueva resolución del SAR. ${REGISTRAR}`,
  RANGO_AGOTADO: `Se usaron todos los números del rango autorizado. Pide al usuario la nueva resolución del SAR. ${REGISTRAR}`,
  AUTORIZACION_DUPLICADA: 'Ese CAI ya está registrado para esta serie: no hace falta registrarlo otra vez. Consulta estado_cai.',
  RANGO_SOLAPADO: 'El rango se cruza con otro CAI de la misma serie. Revisa con el usuario el rango de la resolución (desde y hasta).',
  RANGO: 'Revisa el rango de la resolución: desde y hasta son números enteros de 1 a 99999999, y desde no pasa de hasta.',
  CAI_FORMATO: 'Copia el CAI exactamente como viene en la resolución del SAR: letras, dígitos y guiones, sin espacios.',
  CAI_REQUERIDO: 'Falta el CAI. Pídeselo al usuario: viene en la resolución del SAR.',
  CAI_DEMO: 'El CAI ficticio solo se usa en la base de demostración que crea `npx -y @factura-hn/mcp init --demo`.',
  BASE_DEMO:
    'Esta base es de demostración. Para facturar de verdad, crea la base del negocio con `npx -y @factura-hn/mcp init` ' +
    '(sin --demo), registra ahí el CAI real y cambia FHN_SQLITE y FHN_EMISOR en la configuración del cliente MCP.',
  ULTIMO_EMITIDO_ANTES: 'El último número ya usado con este CAI debe estar dentro del rango (o ser desde − 1 si no se usó ninguno). Verifícalo con el usuario.',
  FECHA_LIMITE: 'Escribe la fecha límite de emisión de la resolución como AAAA-MM-DD.',
  FECHA_AUTORIZACION: 'Escribe la fecha de la resolución como AAAA-MM-DD, o no la indiques.',
  TIPO_DOCUMENTO: 'Usa 01 para facturas, 06 para notas de crédito y 07 para notas de débito, según la resolución.',
  TIPO_NO_EMITIBLE: 'Ese tipo de documento no se emite con este sistema. Registra solo los tipos 01, 06 o 07.',
  ESTABLECIMIENTO: 'El establecimiento tiene hasta 3 dígitos (casa matriz = 000), como en la resolución.',
  PUNTO_EMISION: 'El punto de emisión tiene hasta 3 dígitos (p. ej. 001), como en la resolución.',
  IDEMPOTENCIA_CONFLICTO:
    'Esa idempotencyKey ya se usó con otra venta. Si es una venta nueva, genera una clave nueva; si es un reintento, ' +
    'repite exactamente los mismos datos.',
  NOTA_CLIENTE_RTN:
    'La nota de crédito necesita el RTN del adquirente (Arts. 26 y 28). Si el original se emitió sin RTN, pide al ' +
    'usuario el nombre y el RTN del comprador y pásalos en `cliente`.',
  CLIENTE_NOMBRE: 'Pide al usuario el nombre o la razón social del cliente y pásalo en `cliente.nombre`.',
  CLIENTE_RTN: 'El RTN tiene 14 dígitos (con o sin guiones). Pide al usuario que lo verifique.',
  REFERENCIA_RTN_NO_COINCIDE:
    'La nota debe ir al mismo adquirente del documento original. Usa el RTN del original u omite `cliente` para ' +
    'tomar el del original.',
  REFERENCIA_ANULADA: 'El documento original está anulado: no admite notas. Verifica el número con el usuario.',
  NOTA_SUPERA_ORIGINAL: 'La nota acredita más de lo que queda por acreditar del original. Revisa las líneas con el usuario.',
  NOTA_TASA_DISTINTA: 'Usa en la nota la misma tarifa de ISV que tenía la línea en el original.',
  YA_ANULADO: 'El documento ya estaba anulado: no hay nada más que hacer.',
  NO_ENCONTRADO: 'Verifica el número con el usuario (16 dígitos, p. ej. 000-001-01-00000001), o búscalo en libro_ventas.',
  CONSUMIDOR_FINAL_IDENTIFICACION:
    'La venta pasa del umbral para consumidor final: pide al usuario la identificación o el RTN del comprador.',
  LINEA_PRECIO: 'Revisa el precio: un decimal positivo, mejor como texto (p. ej. "57.50").',
  LINEA_CANTIDAD: 'Revisa la cantidad: un decimal mayor que cero.',
  LINEA_DESCRIPCION: 'Cada línea necesita una descripción.',
  MOTIVO: 'Pide al usuario el motivo de la nota (devolución, descuento, error…).',
  OPERADOR: 'El nombre del operador no puede llevar caracteres de control. Escríbelo como texto simple.',
  OPERADOR_REQUERIDO: 'Para imprimir «Atendido por», indica en `operador` quién atiende.',
  SOLO_ADMIN: 'La llave de API de este servidor es de caja. Esta operación la hace un administrador con una llave admin.',
  NO_AUTENTICADO: 'La llave de API (FHN_LLAVE) no es válida o fue revocada. Pide una nueva al administrador.',
  SIN_EMISOR: 'La API no tiene los datos del emisor. El administrador los registra con POST /v1/emisores.',
  API_INACCESIBLE: 'No se pudo conectar con la API de factura-hn. Revisa que esté en marcha y que FHN_API_URL sea correcta.',
  SOLICITUD_INVALIDA: 'Corrige el argumento de `campo` según el mensaje y vuelve a llamar la herramienta. Si el dato viene del usuario, pregúntaselo.',
  CONFIRMACION_NO_DISPONIBLE:
    'Esta herramienta pide la confirmación del usuario en el cliente MCP (elicitación) y este cliente no la ofrece. Díselo al ' +
    'usuario: un CAI lo puede registrar él con `npx -y @factura-hn/mcp registrar-cai` y, si acepta que el asistente anule o registre CAI sin esa confirmación, ' +
    'agregue FHN_MCP_PERMITIR_DESTRUCTIVAS=1 a la configuración del servidor MCP y lo reinicie.',
  CONFIRMACION_RECHAZADA:
    'El usuario no confirmó, así que no se hizo nada. No reintentes por tu cuenta: pregúntale qué quiere hacer y, si lo pide de ' +
    'nuevo, revisa con él los datos antes de llamar otra vez.',
};

/** Qué hacer con un argumento inválido (`SOLICITUD_INVALIDA`), por campo; los demás, la solución del código. */
const SOLUCION_CAMPO: Record<string, string> = {
  idempotencyKey:
    'Genera una idempotencyKey de 8 a 255 caracteres (p. ej. un UUID) una sola vez para esta venta y pásala en la llamada. ' +
    'Si reintentas esta misma venta, reutiliza la misma clave: así no se emiten dos documentos.',
  numero: 'El número tiene 16 dígitos con guiones, p. ej. 000-001-01-00000001. Verifícalo con el usuario.',
  numeroOriginal: 'El número del original tiene 16 dígitos con guiones, p. ej. 000-001-01-00000001. Verifícalo con el usuario.',
};

/** Texto de solución del código: el propio o, si no hay, uno general que remite a la guía. */
export function solucionPara(p: Pick<Problema, 'codigo' | 'campo'>): string {
  const delCampo = p.codigo === 'SOLICITUD_INVALIDA' && p.campo ? SOLUCION_CAMPO[p.campo.split('.')[0]!] : undefined;
  if (delCampo) return delCampo;
  const propia = SOLUCIONES[p.codigo];
  if (propia) return propia;
  if (p.codigo.startsWith('EMISOR_')) return 'Corrige ese dato en emisor.json (FHN_EMISOR) y reinicia el servidor MCP.';
  if (p.codigo.startsWith('REFERENCIA_')) return 'Revisa con el usuario el documento original: número, CAI, fecha y cliente deben ser los del original.';
  return p.campo ? `Revisa el campo ${p.campo} con el usuario y corrígelo. Detalle en la guía.` : 'Detalle y solución en la guía.';
}

/** El problema con su solución y su enlace, para el resultado de la herramienta. */
export const conSolucion = (p: Problema) => ({ ...p, solucion: solucionPara(p), guia: enlaceGuia(p.codigo) });
