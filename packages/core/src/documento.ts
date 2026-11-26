/**
 * Construcción y validación de documentos fiscales (Factura, Nota de Crédito, Nota de Débito).
 */
import { congelar } from './inmutable';
import { totalesALempiras } from './conversion';
import { centavosEnLetras } from './letras';
import {
  advertenciasDeCalculo,
  calcularCentavos,
  calcularDocumento,
  ESCALA_PRECIO,
  MONTO_MAXIMO_CENTAVOS,
  problemaDeMoneda,
  problemaDePreciosIncluyenISV,
  validarLineas,
} from './calculo';
import { centavosATexto, deCentavos, dividirRedondeando, escaladoATexto, ErrorMonto, formatearMonto, parsearDecimal, redondearDecimal, type Monto } from './dinero';
import { esAdvertencia, esFechaValida, fechaHonduras, horaHonduras, validarAutorizacion } from './autorizacion';
import { esDNIValido, esRTNValido, limpiarIdentificador, normalizarCAI } from './identificacion';
import { esNumeroValido, formatearNumero, formatearRango, numeroDesdeAutorizacion, parsearNumero, TIPOS_DOCUMENTO } from './numeracion';
import { conSolucion } from './errores';
import { esAutorizacionDePrueba } from './modo';
import type {
  AutorizacionCAI,
  DocumentoEntrada,
  Emisor,
  DocumentoFiscal,
  EquivalenteLempiras,
  OpcionesDocumento,
  Problema,
  ResultadoValidacion,
  TipoDocumentoSoportado,
  TipoIdentificacion,
} from './tipos';

export const UMBRAL_CONSUMIDOR_FINAL = 10_000;
export const CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';
export const DESTINO_EJEMPLARES = 'Original: Cliente / Copia: Emisor';

/** El tipo de cambio se lee con 6 decimales. */
const ESCALA_TC = 1_000_000n;

function leerTipoCambio(valor: Monto | undefined): bigint | null {
  // Sin tipo de cambio (undefined, null, '') parsearDecimal lanza ErrorMonto: también es null.
  try {
    const tc = parsearDecimal(valor as Monto, 6);
    return tc > 0n ? tc : null;
  } catch (e) {
    // Siempre es ErrorMonto (parsearDecimal solo lanza ErrorMonto, también con un objeto que no se puede
    // convertir a texto): la condición `true` es un mutante equivalente que se deja vivo.
    if (e instanceof ErrorMonto) return null;
    throw e;
  }
}

/**
 * Una nota se emite en lempiras (Arts. 26 num. 9 y 28 num. 8). Si el documento original está en
 * moneda extranjera, las líneas de la nota se escriben en esa moneda y aquí se convierten a lempiras con el
 * tipo de cambio del original (precio a 4 decimales, descuento a 2, redondeo del Art. 9 de la Ley del ISV).
 * Si las líneas no se pueden leer, se devuelven sin convertir para que la validación reporte el error.
 */
export function notaEnLempiras(entrada: DocumentoEntrada): { entrada: DocumentoEntrada; problemas: Problema[] } {
  const r = entrada.referencia;
  const tipo = entrada.tipoDocumento;
  if ((tipo !== '06' && tipo !== '07') || !r?.moneda || r.moneda === 'HNL' || !Array.isArray(entrada.lineas)) return { entrada, problemas: [] };
  if (r.moneda !== 'USD') {
    return { entrada, problemas: [{ codigo: 'REFERENCIA_MONEDA', mensaje: `Moneda del documento original desconocida: ${String(r.moneda)}.`, campo: 'referencia.moneda' }] };
  }
  const tc = leerTipoCambio(r.tipoCambio);
  if (tc === null) {
    return {
      entrada,
      problemas: [{
        codigo: 'REFERENCIA_TIPO_CAMBIO',
        mensaje: 'El documento original está en moneda extranjera: indica su tipo de cambio para convertir la nota a lempiras.',
        campo: 'referencia.tipoCambio',
      }],
    };
  }
  try {
    const lineas = entrada.lineas.map((l) => {
      // Si no se pueden leer, la validación de las líneas reporta el error con su mensaje: aquí no hace falta.
      const precio = parsearDecimal(l.precioUnitario, ESCALA_PRECIO);
      const descuento = parsearDecimal(l.descuento ?? 0, 2);
      return {
        ...l,
        precioUnitario: escaladoATexto(dividirRedondeando(precio * tc, ESCALA_TC), ESCALA_PRECIO),
        ...(l.descuento !== undefined ? { descuento: escaladoATexto(dividirRedondeando(descuento * tc, ESCALA_TC), 2) } : {}),
      };
    });
    return {
      entrada: { ...entrada, lineas, referencia: { ...r, tipoCambio: Number(escaladoATexto(tc, 6)) } },
      problemas: [],
    };
  } catch (e) {
    // Siempre es ErrorMonto (parsearDecimal solo lanza ErrorMonto, también con un objeto que no se puede
    // convertir a texto): la condición `true` es un mutante equivalente que se deja vivo.
    if (e instanceof ErrorMonto) return { entrada, problemas: [] };
    throw e;
  }
}

/** Fecha de hoy en Honduras según el reloj de las opciones. */
export function hoyHonduras(opciones: Pick<OpcionesDocumento, 'reloj'> = {}): string {
  return fechaHonduras(opciones.reloj?.()); // sin reloj, fechaHonduras usa new Date()
}

const SOPORTADOS: TipoDocumentoSoportado[] = ['01', '06', '07'];

/**
 * Documentos que un autoimpresor por sistema computarizado no puede emitir:
 * - 09 Ticket: se emite «exclusivamente para consumidores finales a través de máquinas registradoras»
 *   (Reglamento Art. 4 num. 43, C L.448-450; Art. 17).
 * - 04 Recibo por Honorarios Profesionales y 10 Factura Prevalorada: «deben ser exclusivamente emitidos bajo
 *   la modalidad de imprenta» (Art. 46).
 * - 12 Constancia de Donación: excluida de la modalidad de autoimpresor (Art. 47, C L.2047-2080).
 */
export const TIPOS_NO_EMITIBLES_POR_SISTEMA: Readonly<Record<string, string>> = {
  '04': 'el Recibo por Honorarios Profesionales se emite exclusivamente bajo la modalidad de imprenta (Art. 46)',
  '09': 'el Ticket se emite exclusivamente por máquinas registradoras (Art. 4 num. 43)',
  '10': 'la Factura Prevalorada se emite exclusivamente bajo la modalidad de imprenta (Art. 46)',
  '12': 'la Constancia de Donación no se emite en la modalidad de autoimpresor (Art. 47)',
};

/** Comprobantes Fiscales (Reglamento Art. 6). Una Nota de Crédito solo se vincula a uno de ellos (Art. 4 num. 32). */
export const COMPROBANTES_FISCALES: readonly string[] = ['01', '10', '09', '04', '11', '12'];

/** Problema de tipo de documento, o null si el sistema puede emitirlo en esta versión. */
export function problemaDeTipo(tipo: string): Problema | null {
  const motivo = TIPOS_NO_EMITIBLES_POR_SISTEMA[tipo];
  if (motivo) {
    return { codigo: 'TIPO_NO_EMITIBLE', mensaje: `Un sistema computarizado no puede emitir el tipo ${tipo}: ${motivo}.`, campo: 'tipoDocumento' };
  }
  if (!SOPORTADOS.includes(tipo as TipoDocumentoSoportado)) {
    return { codigo: 'TIPO_NO_SOPORTADO', mensaje: `Tipo de documento ${tipo} no soportado en esta versión (01, 06, 07).`, campo: 'tipoDocumento' };
  }
  return null;
}

const PATRON_HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const PATRON_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Un problema en una línea de texto: código, mensaje, qué hacer y dónde leer más. */
function textoProblema(p: Problema): string {
  const mensaje = p.mensaje.trim();
  const partes = [`[${p.codigo}] ${mensaje}${/[.!?»)]$/.test(mensaje) ? '' : '.'}`];
  if (p.solucion) partes.push(`Solución: ${p.solucion}`);
  if (p.documentacion) partes.push(`Más información: ${p.documentacion}`);
  return partes.join(' ');
}

/**
 * Error de validación del SDK. Cada problema trae `codigo`, `mensaje` y, si el código es del SDK, `solucion`
 * y `documentacion` (enlace al catálogo de errores). El `message` los incluye.
 */
export class ErrorValidacion extends Error {
  readonly errores: Problema[];
  readonly advertencias: Problema[];
  constructor(errores: Problema[], advertencias: Problema[] = []) {
    const completos = errores.map(conSolucion);
    super(`Documento inválido: ${completos.map(textoProblema).join(' ')}`);
    this.name = 'ErrorValidacion';
    this.errores = completos;
    this.advertencias = advertencias;
  }
}

/**
 * true si `e` es un `ErrorValidacion`, aunque venga de otra copia del paquete (ESM y CJS cargados a la vez),
 * donde `instanceof` falla.
 */
export function esErrorValidacion(e: unknown): e is ErrorValidacion {
  return e instanceof ErrorValidacion || (e instanceof Error && e.name === 'ErrorValidacion' && Array.isArray((e as ErrorValidacion).errores));
}

/**
 * Nombre del operador (cajero) para la bitácora o la impresión. No es un requisito del Reglamento: solo se
 * valida que sea texto legible y corto, para que no rompa la impresión ni la bitácora.
 */
export function problemaDeOperador(operador: unknown, campo = 'operador'): Problema | null {
  if (operador === undefined) return null;
  if (typeof operador !== 'string' || !operador.trim() || operador.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(operador)) {
    return { codigo: 'OPERADOR', mensaje: 'El operador debe ser un nombre de 1 a 80 caracteres, sin caracteres de control.', campo };
  }
  return null;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const tipoDe = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'una lista' : typeof v === 'string' ? `el texto ${JSON.stringify(v)}` : `${typeof v} ${String(v)}`);

/** Tipos de identificación del consumidor final (`TipoIdentificacion`). */
export const TIPOS_IDENTIFICACION: readonly TipoIdentificacion[] = ['DNI', 'RTN', 'PASAPORTE', 'CARNET_RESIDENTE', 'OTRO'];

/**
 * Problemas de forma de la entrada: que cada parte sea del tipo que espera el SDK (objeto, texto, lista). Se
 * revisan antes que todo lo demás: con un tipo equivocado, el resto de la validación no tiene qué leer, y un
 * texto en lugar del cliente no debe guardarse deformado en el documento.
 */
export function problemasDeForma(entrada: unknown): Problema[] {
  if (!esObjeto(entrada)) {
    return [{ codigo: 'ENTRADA', mensaje: `La entrada del documento debe ser un objeto con emisor y lineas, no ${tipoDe(entrada)}.`, campo: 'entrada' }];
  }
  const problemas: Problema[] = [];
  const texto = (valor: unknown, codigo: string, campo: string) => {
    if (valor !== undefined && typeof valor !== 'string') problemas.push({ codigo, mensaje: `«${campo}» debe ser texto, no ${tipoDe(valor)}.`, campo });
  };
  const c = entrada.cliente;
  if (c !== undefined && c !== null) {
    if (!esObjeto(c)) {
      problemas.push({ codigo: 'CLIENTE', mensaje: `«cliente» debe ser un objeto como { nombre, rtn }, no ${tipoDe(c)}.`, campo: 'cliente' });
    } else {
      texto(c.nombre, 'CLIENTE_NOMBRE', 'cliente.nombre');
      texto(c.rtn, 'CLIENTE_RTN', 'cliente.rtn');
      texto(c.direccion, 'CLIENTE', 'cliente.direccion');
      const id = c.identificacion;
      if (id !== undefined && id !== null) {
        if (!esObjeto(id)) {
          problemas.push({ codigo: 'CLIENTE_IDENTIFICACION', mensaje: `«cliente.identificacion» debe ser un objeto { tipo, numero }, no ${tipoDe(id)}.`, campo: 'cliente.identificacion' });
        } else {
          if (!(TIPOS_IDENTIFICACION as readonly unknown[]).includes(id.tipo)) {
            problemas.push({
              codigo: 'CLIENTE_IDENTIFICACION',
              mensaje: `Tipo de identificación desconocido: ${tipoDe(id.tipo)}. Usa ${TIPOS_IDENTIFICACION.join(', ')}.`,
              campo: 'cliente.identificacion.tipo',
            });
          }
          texto(id.numero, 'CLIENTE_IDENTIFICACION', 'cliente.identificacion.numero');
        }
      }
    }
  }
  const e = entrada.emisor;
  if (e !== undefined && e !== null && !esObjeto(e)) {
    problemas.push({ codigo: 'EMISOR', mensaje: `«emisor» debe ser un objeto con los datos del emisor, no ${tipoDe(e)}.`, campo: 'emisor' });
  }
  if (Array.isArray(entrada.lineas)) {
    entrada.lineas.forEach((l: unknown, i: number) => {
      const campo = `lineas[${i}]`;
      if (!esObjeto(l)) {
        problemas.push({ codigo: 'LINEA', mensaje: `Línea ${i + 1}: debe ser un objeto con descripcion, cantidad y precioUnitario, no ${tipoDe(l)}.`, campo });
        return;
      }
      texto(l.descripcion, 'LINEA_DESCRIPCION', `${campo}.descripcion`);
      texto(l.codigo, 'LINEA', `${campo}.codigo`);
      texto(l.unidad, 'LINEA', `${campo}.unidad`);
    });
  }
  const r = entrada.referencia;
  if (r !== undefined && r !== null) {
    if (!esObjeto(r)) {
      problemas.push({ codigo: 'REFERENCIA', mensaje: `«referencia» debe ser un objeto { cai, numero, fecha }, no ${tipoDe(r)}.`, campo: 'referencia' });
    } else {
      texto(r.cai, 'REFERENCIA_CAI', 'referencia.cai');
      texto(r.numero, 'REFERENCIA_NUMERO', 'referencia.numero');
      texto(r.fecha, 'REFERENCIA_FECHA', 'referencia.fecha');
    }
  }
  texto(entrada.motivo, 'MOTIVO', 'motivo');
  return problemas;
}

/**
 * Caracteres que ningún texto de un documento puede llevar:
 * - los de control Unicode (categoría Cc: C0, DEL y C1), salvo el tabulador, el salto de línea y el retorno de
 *   carro, que tienen sentido en texto libre (descripciones, direcciones, observaciones);
 * - las mitades sueltas de un par sustituto UTF-16, que no son texto válido.
 * No es una regla fiscal: un NUL o un sustituto suelto no se pueden guardar en `jsonb` de PostgreSQL (la
 * emisión o el listado terminaban en error 500) y los de control la impresora los toma como comandos.
 */
const CARACTER_NO_PERMITIDO = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const CARACTER_NO_PERMITIDO_GLOBAL = new RegExp(CARACTER_NO_PERMITIDO.source, 'g');

/** `U+XXXX` de un carácter (o de la primera unidad UTF-16 de una mitad suelta). */
const puntoDeCodigo = (c: string) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

/** Un nombre de campo apto para `campo` y el mensaje: sus caracteres no permitidos se escriben como `U+XXXX`. */
const claveLegible = (clave: string) => clave.replace(CARACTER_NO_PERMITIDO_GLOBAL, (c) => `<${puntoDeCodigo(c)}>`);

const SOLUCION_EMISOR =
  'El carácter está en la configuración del emisor, no en la venta: corrígelo en `crearFacturador({ emisor })` o, en la API, con `PATCH /v1/emisores/{id}`.';

/**
 * Un problema `TEXTO_CARACTER_NO_PERMITIDO` por cada texto de la entrada, o nombre de campo, que lleva un carácter
 * no permitido (`CARACTER_NO_PERMITIDO`). Recorre todos los textos (emisor, cliente, líneas, referencia,
 * exoneración, motivo, observaciones…) a cualquier profundidad, no solo los que el SDK conoce; un objeto que se
 * contiene a sí mismo se recorre una vez. `operador` ya lo valida `problemaDeOperador` (código `OPERADOR`).
 * Los problemas de `emisor.*` traen una solución propia: el texto viene de la configuración, no de la venta.
 */
export function problemasDeTexto(entrada: unknown): Problema[] {
  const problemas: Problema[] = [];
  const reportar = (texto: string, campo: string, deClave: boolean) => {
    const m = CARACTER_NO_PERMITIDO.exec(texto);
    if (!m) return;
    const punto = puntoDeCodigo(m[0]);
    const que = /[\ud800-\udfff]/.test(m[0]) ? `una mitad suelta de un par sustituto UTF-16 (${punto})` : `un carácter de control (${punto})`;
    const donde = deClave ? `El nombre del campo «${campo}»` : `El texto de «${campo}»`;
    const p: Problema = {
      codigo: 'TEXTO_CARACTER_NO_PERMITIDO',
      mensaje: `${donde} tiene ${que} en la posición ${m.index + 1}. De los caracteres de control solo se permiten el tabulador y los saltos de línea.`,
      campo,
    };
    if (campo === 'emisor' || campo.startsWith('emisor.') || campo.startsWith('emisor[')) p.solucion = SOLUCION_EMISOR;
    problemas.push(p);
  };
  // Recorrido iterativo (sin límite de profundidad ni riesgo de desbordar la pila), en el orden de la entrada.
  const vistos = new WeakSet<object>();
  const pendientes: Array<{ valor: unknown; campo: string; raiz: boolean }> = [{ valor: entrada, campo: '', raiz: true }];
  while (pendientes.length) {
    const { valor, campo, raiz } = pendientes.pop()!;
    if (typeof valor === 'string') {
      reportar(valor, campo, false);
      continue;
    }
    if (valor === null || typeof valor !== 'object' || vistos.has(valor)) continue;
    vistos.add(valor);
    // Un elemento extra en la lista inicial sería un texto sin caracteres no permitidos: equivalente.
    // Stryker disable next-line ArrayDeclaration: equivalente (ver arriba)
    const hijos: Array<{ valor: unknown; campo: string; raiz: boolean }> = [];
    if (Array.isArray(valor)) {
      valor.forEach((v, i) => hijos.push({ valor: v, campo: `${campo}[${i}]`, raiz: false }));
    } else {
      for (const [clave, v] of Object.entries(valor)) {
        if (raiz && clave === 'operador') continue;
        const ruta = campo ? `${campo}.${claveLegible(clave)}` : claveLegible(clave);
        reportar(clave, ruta, true);
        hijos.push({ valor: v, campo: ruta, raiz: false });
      }
    }
    for (let i = hijos.length - 1; i >= 0; i--) pendientes.push(hijos[i]!);
  }
  return problemas;
}

const CAMPOS_EMISOR: ReadonlyArray<[keyof Emisor, string]> = [
  ['rtn', 'EMISOR_RTN'], ['razonSocial', 'EMISOR_NOMBRE'], ['nombreComercial', 'EMISOR_NOMBRE_COMERCIAL'],
  ['direccionCasaMatriz', 'EMISOR_DIRECCION'], ['direccionEstablecimiento', 'EMISOR_DIRECCION_ESTABLECIMIENTO'],
  ['telefono', 'EMISOR_TELEFONO'], ['correo', 'EMISOR_CORREO'],
];

/**
 * Problemas de los datos del emisor: todos son obligatorios (Reglamento Art. 10 num. 1; Arts. 25 y 27 num. 1
 * para las notas). Es la misma comprobación que hace `emitir`; sirve para validar la configuración del negocio
 * al arrancar.
 */
export function validarEmisor(e: Emisor | undefined): Problema[] {
  const problemas: Problema[] = [];
  if (!e) problemas.push({ codigo: 'EMISOR', mensaje: 'Faltan los datos del emisor.', campo: 'emisor' });
  else if (!esObjeto(e)) problemas.push({ codigo: 'EMISOR', mensaje: `«emisor» debe ser un objeto con los datos del emisor, no ${tipoDe(e)}.`, campo: 'emisor' });
  else if (CAMPOS_EMISOR.some(([campo]) => e[campo] !== undefined && typeof e[campo] !== 'string')) {
    for (const [campo, codigo] of CAMPOS_EMISOR) {
      const v: unknown = e[campo];
      if (v !== undefined && typeof v !== 'string') problemas.push({ codigo, mensaje: `«emisor.${campo}» debe ser texto, no ${tipoDe(v)}.`, campo: `emisor.${campo}` });
    }
  } else {
    if (!e.rtn || !esRTNValido(e.rtn)) problemas.push({ codigo: 'EMISOR_RTN', mensaje: 'RTN del emisor inválido (14 dígitos).', campo: 'emisor.rtn' });
    if (!e.razonSocial?.trim()) problemas.push({ codigo: 'EMISOR_NOMBRE', mensaje: 'Falta el nombre o razón social del emisor.', campo: 'emisor.razonSocial' });
    // Art. 10 num. 1 (y Arts. 25 y 27 num. 1 para las notas): todos los datos de identificación del emisor.
    if (!e.nombreComercial?.trim())
      problemas.push({ codigo: 'EMISOR_NOMBRE_COMERCIAL', mensaje: 'Falta el nombre comercial del emisor (Art. 10 num. 1 c). Si no tiene uno distinto, repite la razón social.', campo: 'emisor.nombreComercial' });
    if (!e.direccionCasaMatriz?.trim()) problemas.push({ codigo: 'EMISOR_DIRECCION', mensaje: 'Falta la dirección de casa matriz (Art. 10 num. 1 d).', campo: 'emisor.direccionCasaMatriz' });
    if (!e.direccionEstablecimiento?.trim())
      problemas.push({ codigo: 'EMISOR_DIRECCION_ESTABLECIMIENTO', mensaje: 'Falta la dirección del establecimiento donde está el punto de emisión (Art. 10 num. 1 d).', campo: 'emisor.direccionEstablecimiento' });
    if (!e.telefono?.trim()) problemas.push({ codigo: 'EMISOR_TELEFONO', mensaje: 'Falta el número telefónico del emisor (Art. 10 num. 1 e).', campo: 'emisor.telefono' });
    if (!e.correo?.trim()) problemas.push({ codigo: 'EMISOR_CORREO', mensaje: 'Falta el correo electrónico del emisor (Art. 10 num. 1 f).', campo: 'emisor.correo' });
    else if (!PATRON_CORREO.test(e.correo.trim()))
      problemas.push({ codigo: 'EMISOR_CORREO', mensaje: `El correo del emisor no parece válido: "${e.correo}".`, campo: 'emisor.correo' });
  }
  return problemas.map(conSolucion);
}

/**
 * Valida la entrada contra la autorización, sin asignar número.
 * Llama a esto antes de reservar un correlativo.
 */
export function validarEntrada(
  entrada: DocumentoEntrada,
  autorizacion: AutorizacionCAI,
  opciones: OpcionesDocumento = {},
): ResultadoValidacion {
  const forma = problemasDeForma(entrada);
  if (forma.length) return { ok: false, errores: forma.map(conSolucion), advertencias: [] };
  const problemas: Problema[] = [];
  const conversion = notaEnLempiras(entrada);
  problemas.push(...conversion.problemas);
  entrada = conversion.entrada;
  const tipo = entrada.tipoDocumento ?? '01';
  const hoy = hoyHonduras(opciones);
  const fecha = entrada.fechaEmision ?? hoy;

  const problemaTipo = problemaDeTipo(tipo);
  if (problemaTipo) problemas.push(problemaTipo);
  const problemaOperador = problemaDeOperador(entrada.operador);
  if (problemaOperador) problemas.push(problemaOperador);
  const problemaPrecios = problemaDePreciosIncluyenISV(entrada.preciosIncluyenISV);
  if (problemaPrecios) problemas.push(problemaPrecios);
  problemas.push(...problemasDeTexto(entrada));

  // Autorización
  problemas.push(...validarAutorizacion(autorizacion, { caiEstricto: opciones.caiEstricto ?? false }));
  if (autorizacion.tipoDocumento !== tipo) {
    problemas.push({
      codigo: 'AUTORIZACION_TIPO',
      mensaje: `La autorización es para ${TIPOS_DOCUMENTO[autorizacion.tipoDocumento] ?? autorizacion.tipoDocumento}, pero el documento es ${TIPOS_DOCUMENTO[tipo] ?? tipo}.`,
      campo: 'tipoDocumento',
    });
  }

  // Fecha
  if (!esFechaValida(fecha)) {
    problemas.push({ codigo: 'FECHA_EMISION', mensaje: 'fechaEmision debe ser YYYY-MM-DD.', campo: 'fechaEmision' });
  } else if (fecha !== hoy) {
    // Reglamento Art. 14 (momento de emisión) y Art. 43 (custodia en orden cronológico): el documento se
    // emite con la fecha en que ocurre la operación. Retrofechar o adelantar no se permite; la contingencia
    // del Art. 55 se cubre con talonarios preimpresos, no con fechas pasadas.
    problemas.push({
      codigo: 'FECHA_EMISION_NO_ES_HOY',
      mensaje: `La fecha de emisión (${fecha}) debe ser la de hoy en Honduras (${hoy}). No se puede retrofechar ni adelantar (Arts. 14 y 43).`,
      campo: 'fechaEmision',
    });
  } else if (esFechaValida(autorizacion.fechaLimiteEmision) && fecha > autorizacion.fechaLimiteEmision) {
    problemas.push({
      codigo: 'AUTORIZACION_VENCIDA',
      mensaje: `La fecha de emisión ${fecha} es posterior a la fecha límite ${autorizacion.fechaLimiteEmision}.`,
      campo: 'fechaEmision',
    });
  }

  // Hora: HH:mm de 24 horas. Si falta, la pone el reloj, como la fecha.
  if (entrada.horaEmision !== undefined && (typeof entrada.horaEmision !== 'string' || !PATRON_HORA.test(entrada.horaEmision))) {
    problemas.push({
      codigo: 'HORA_EMISION',
      mensaje: `horaEmision debe ser HH:mm de 24 horas (p. ej. 14:05), no ${JSON.stringify(entrada.horaEmision) ?? String(entrada.horaEmision)}.`,
      campo: 'horaEmision',
    });
  }

  // Emisor
  problemas.push(...validarEmisor(entrada.emisor));

  // Cliente
  const c = entrada.cliente ?? {};
  if (c.rtn !== undefined && c.rtn !== '' && !esRTNValido(c.rtn)) {
    problemas.push({ codigo: 'CLIENTE_RTN', mensaje: 'RTN del cliente inválido (14 dígitos).', campo: 'cliente.rtn' });
  }
  if (c.rtn && !c.nombre?.trim()) {
    problemas.push({ codigo: 'CLIENTE_NOMBRE', mensaje: 'Si el cliente tiene RTN, se requiere su nombre o razón social.', campo: 'cliente.nombre' });
  }
  if (c.identificacion) {
    if (!c.identificacion.numero?.trim())
      problemas.push({ codigo: 'CLIENTE_IDENTIFICACION', mensaje: 'Falta el número de identificación del cliente.', campo: 'cliente.identificacion' });
    else if (c.identificacion.tipo === 'DNI' && !esDNIValido(c.identificacion.numero))
      problemas.push({ codigo: 'CLIENTE_DNI', mensaje: 'DNI del cliente inválido (13 dígitos).', campo: 'cliente.identificacion' });
    else if (c.identificacion.tipo === 'RTN' && !esRTNValido(c.identificacion.numero))
      problemas.push({ codigo: 'CLIENTE_RTN', mensaje: 'RTN del cliente inválido (14 dígitos).', campo: 'cliente.identificacion' });
  }

  // Exoneración
  if (entrada.exoneracion) {
    const x = entrada.exoneracion;
    // Art. 11 num. 4: OCE y Constancia del Registro de Exonerados «o» el registro RUPNSA de la SAG, «según
    // corresponda». Con el registro SAG basta; sin él, hacen falta los dos documentos.
    const lleno = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    if (!lleno(x.registroSAG)) {
      const falta = ' (Art. 11 num. 4: Orden de Compra Exenta y Constancia, o el registro SAG/RUPNSA).';
      if (!lleno(x.ordenCompraExenta))
        problemas.push({ codigo: 'EXONERACION_ORDEN', mensaje: `Falta el número de Orden de Compra Exenta${falta}`, campo: 'exoneracion.ordenCompraExenta' });
      if (!lleno(x.constanciaRegistroExonerado))
        problemas.push({ codigo: 'EXONERACION_CONSTANCIA', mensaje: `Falta el número de Constancia de Registro de Exonerados${falta}`, campo: 'exoneracion.constanciaRegistroExonerado' });
    }
    if (!c.rtn)
      problemas.push({ codigo: 'AVISO_EXONERADO_RTN', mensaje: 'Un adquirente exonerado normalmente se identifica con RTN.', campo: 'cliente.rtn' });
  }

  // Moneda
  const moneda = entrada.moneda ?? 'HNL';
  const problemaMoneda = problemaDeMoneda(entrada.moneda);
  if (problemaMoneda) problemas.push(problemaMoneda);
  const tipoCambio = moneda === 'HNL' ? null : leerTipoCambio(entrada.tipoCambio);
  if (!problemaMoneda && moneda !== 'HNL' && tipoCambio === null) {
    problemas.push({ codigo: 'TIPO_CAMBIO', mensaje: 'En moneda extranjera se debe indicar el tipo de cambio de la fecha de emisión (mayor que 0, hasta 6 decimales).', campo: 'tipoCambio' });
  }

  // Notas de crédito / débito
  if (tipo === '06' || tipo === '07') {
    const r = entrada.referencia;
    if (!r) problemas.push({ codigo: 'REFERENCIA', mensaje: 'Las notas de crédito y débito deben referenciar el documento original (CAI, número y fecha).', campo: 'referencia' });
    else {
      if (!r.cai?.trim()) problemas.push({ codigo: 'REFERENCIA_CAI', mensaje: 'Falta el CAI del documento referenciado.', campo: 'referencia.cai' });
      if (!r.numero || !esNumeroValido(r.numero)) problemas.push({ codigo: 'REFERENCIA_NUMERO', mensaje: 'Número del documento referenciado inválido.', campo: 'referencia.numero' });
      if (!r.fecha || !esFechaValida(r.fecha)) problemas.push({ codigo: 'REFERENCIA_FECHA', mensaje: 'Fecha del documento referenciado inválida.', campo: 'referencia.fecha' });
      else if (esFechaValida(fecha) && r.fecha > fecha) {
        // Arts. 26 num. 3 c y 28 num. 3 c: la nota consigna los datos de un documento ya emitido; la NC respalda
        // ajustes «efectuados con posterioridad a la emisión del correspondiente Comprobante Fiscal» (Art. 4 num. 32).
        problemas.push({ codigo: 'REFERENCIA_FECHA_POSTERIOR', mensaje: `El documento referenciado (${r.fecha}) no puede tener fecha posterior a la nota (${fecha}).`, campo: 'referencia.fecha' });
      }
      if (r.numero && esNumeroValido(r.numero) && tipo === '06') {
        const tipoRef = parsearNumero(r.numero).tipoDocumento;
        // Art. 4 num. 32: la Nota de Crédito está «vinculada a un Comprobante Fiscal» (los del Art. 6). La Nota de
        // Débito admite «el Comprobante Fiscal o el documento» (Art. 28 num. 3 b), así que no se restringe.
        if (!COMPROBANTES_FISCALES.includes(tipoRef)) {
          problemas.push({
            codigo: 'REFERENCIA_TIPO',
            mensaje: `Una Nota de Crédito se aplica a un Comprobante Fiscal (Art. 6); el documento ${r.numero} es ${TIPOS_DOCUMENTO[tipoRef]}.`,
            campo: 'referencia.numero',
          });
        }
      }
    }
    if (!entrada.motivo?.trim()) problemas.push({ codigo: 'MOTIVO', mensaje: 'Las notas de crédito y débito requieren el motivo.', campo: 'motivo' });
    // Arts. 26 y 28 num. 1 (una sola vez aunque el cliente traiga RTN sin nombre).
    if (!c.nombre?.trim() && !problemas.some((p) => p.codigo === 'CLIENTE_NOMBRE'))
      problemas.push({ codigo: 'CLIENTE_NOMBRE', mensaje: 'Las notas de crédito y débito requieren el nombre del adquirente (Arts. 26 y 28).', campo: 'cliente.nombre' });
    // Arts. 26 y 28 num. 1-2: piden el RTN del adquirente, sin alternativa de CONSUMIDOR FINAL.
    if (!c.rtn) problemas.push({ codigo: 'NOTA_CLIENTE_RTN', mensaje: 'Las notas de crédito y débito requieren el RTN del adquirente (Arts. 26 y 28).', campo: 'cliente.rtn' });
    // Arts. 26 num. 9 y 28 num. 8: moneda nacional Lempira.
    if (moneda !== 'HNL') problemas.push({ codigo: 'NOTA_MONEDA', mensaje: 'Las notas de crédito y débito se emiten en Lempiras (Arts. 26 y 28).', campo: 'moneda' });
  }

  // Líneas y umbral de consumidor final
  const problemasLineas = validarLineas(entrada.lineas);
  problemas.push(...problemasLineas);
  if (problemasLineas.length === 0) {
    const { totales } = calcularCentavos(entrada.lineas, {
      preciosIncluyenISV: entrada.preciosIncluyenISV === true,
      exonerado: Boolean(entrada.exoneracion),
      moneda,
    });
    // Comparación exacta: total (centavos) × tipo de cambio (10^-6) contra umbral (centavos × 10^6).
    const totalLempiras6 = totales.total * (tipoCambio ?? ESCALA_TC);
    const umbral = opciones.umbralIdentificacionConsumidorFinal ?? UMBRAL_CONSUMIDOR_FINAL;
    const umbral6 = parsearDecimal(umbral, 2, 'umbralIdentificacionConsumidorFinal') * ESCALA_TC;
    problemas.push(...advertenciasDeCalculo(totales));
    // Tope técnico, no fiscal (ver MONTO_MAXIMO_CENTAVOS): el equivalente en lempiras del total también debe caber,
    // porque se guarda en el documento (equivalenteLempiras) y sale en el libro de ventas.
    if (tipoCambio !== null) {
      const totalLempiras = dividirRedondeando(totalLempiras6, ESCALA_TC);
      if (totalLempiras > MONTO_MAXIMO_CENTAVOS) {
        problemas.push({
          codigo: 'MONTO_FUERA_DE_RANGO',
          mensaje: `El total en lempiras, al tipo de cambio, sería L ${centavosATexto(totalLempiras)}: supera el máximo que se puede emitir, L ${centavosATexto(MONTO_MAXIMO_CENTAVOS)}.`,
          campo: 'tipoCambio',
        });
      }
    }
    // Art. 11 num. 3: si la factura mezcla ventas exentas (o exoneradas) y gravadas, para el crédito fiscal del
    // comprador solo cuentan las gravadas. Se avisa cuando el comprador se identifica con RTN.
    // Con exoneración no hay base gravada (baseCreditoFiscal = 0), así que `+` → `-` es equivalente aquí.
    // Stryker disable next-line ArithmeticOperator: equivalente (ver arriba)
    const noGravado = totales.importeExento + totales.importeExonerado;
    if (c.rtn && noGravado > 0n && totales.baseCreditoFiscal > 0n) {
      problemas.push({
        codigo: 'AVISO_VENTA_MIXTA',
        mensaje: 'Venta mixta: para el crédito fiscal del comprador solo cuenta lo gravado (Art. 11 num. 3), ' +
          `L ${centavosATexto(totales.baseCreditoFiscal)} de base.`,
        campo: 'lineas',
      });
    }
    const identificado = Boolean(c.rtn) || (Boolean(c.nombre?.trim()) && Boolean(c.identificacion?.numero?.trim()));
    if (totalLempiras6 > umbral6 && !identificado) {
      problemas.push({
        codigo: 'CONSUMIDOR_FINAL_IDENTIFICACION',
        mensaje: `Ventas a consumidor final mayores de L ${formatearMonto(umbral)} requieren nombre e identificación del cliente (Art. 11).`,
        campo: 'cliente',
      });
    }
  }

  const errores = problemas.filter((p) => !esAdvertencia(p)).map(conSolucion);
  const advertencias = problemas.filter(esAdvertencia);
  return { ok: errores.length === 0, errores, advertencias };
}

/**
 * Equivalente en lempiras del ISV y del total de un documento en moneda extranjera, con su tipo de cambio:
 * importe en centavos × tipo de cambio, redondeado al centavo (mitad lejos de cero, Ley del ISV Art. 9).
 * Información para el adquirente; los importes del documento siguen en su moneda. Se calcula al emitir y se
 * guarda, así el impreso no cambia al reimprimir. null si el documento está en lempiras.
 */
function calcularEquivalenteLempiras(doc: DocumentoFiscal): EquivalenteLempiras | null {
  if (doc.tipoCambio === undefined) return null; // solo un documento en moneda extranjera lleva tipo de cambio
  // La misma conversión que el libro de ventas: el total es la suma de las columnas convertidas.
  const L = totalesALempiras(doc.totales, parsearDecimal(doc.tipoCambio, 6));
  const t = doc.totales;
  return {
    ...(t.isv15 > 0 ? { isv15: deCentavos(L.isv15) } : {}),
    ...(t.isv18 > 0 ? { isv18: deCentavos(L.isv18) } : {}),
    total: deCentavos(L.total),
  };
}

/**
 * Construye el documento con un correlativo ya asignado. Función pura.
 * Lanza `ErrorValidacion` si la entrada no es válida o el correlativo está fuera del rango.
 */
export function construirDocumento(
  entrada: DocumentoEntrada,
  autorizacion: AutorizacionCAI,
  correlativo: number,
  opciones: OpcionesDocumento = {},
  /** Problemas que el flujo de emisión detectó fuera de la entrada (p. ej. contra el almacén). */
  adicionales: Problema[] = [],
): DocumentoFiscal {
  const forma = problemasDeForma(entrada);
  if (forma.length) throw new ErrorValidacion(forma);
  // Fecha y hora salen del mismo instante del reloj si no vienen en la entrada.
  const ahora = opciones.reloj?.() ?? new Date();
  entrada = {
    ...entrada,
    fechaEmision: entrada.fechaEmision ?? hoyHonduras({ reloj: () => ahora }),
    horaEmision: entrada.horaEmision ?? horaHonduras(ahora),
  };
  const v = validarEntrada(entrada, autorizacion, opciones);
  const errores = [...v.errores, ...adicionales.filter((p) => !esAdvertencia(p))];
  const advertencias = [...v.advertencias, ...adicionales.filter(esAdvertencia)];
  if (!Number.isInteger(correlativo) || correlativo < autorizacion.rangoInicial || correlativo > autorizacion.rangoFinal) {
    errores.push({
      codigo: 'CORRELATIVO_FUERA_DE_RANGO',
      mensaje: `El correlativo ${correlativo} está fuera del rango autorizado ${autorizacion.rangoInicial}–${autorizacion.rangoFinal}.`,
      campo: 'correlativo',
    });
  }
  if (errores.length) throw new ErrorValidacion(errores, advertencias);
  // Las líneas de una nota sobre un original en moneda extranjera vienen en esa moneda.
  const lineasMonedaOriginal = entrada.lineas;
  entrada = notaEnLempiras(entrada).entrada;

  const tipo = entrada.tipoDocumento ?? '01';
  const moneda = entrada.moneda ?? 'HNL';
  const preciosIncluyenISV = entrada.preciosIncluyenISV ?? false;
  const opcionesCalculo = { preciosIncluyenISV, exonerado: Boolean(entrada.exoneracion), moneda };
  const calculado = calcularDocumento(entrada.lineas, opcionesCalculo);
  const lineas = calculado.lineas;
  let totales = calculado.totales;
  const tcOriginal = entrada.referencia?.moneda && entrada.referencia.moneda !== 'HNL' ? leerTipoCambio(entrada.referencia.tipoCambio) : null;
  if ((tipo === '06' || tipo === '07') && tcOriginal !== null) {
    // Nota sobre un original en moneda extranjera: sus importes se calculan en esa moneda y se convierten columna
    // por columna (`totalesALempiras`), igual que el libro de ventas y el tope convierten el original. Así una nota
    // con las mismas líneas acredita exactamente lo que el libro registró de la venta. Las líneas se imprimen con
    // el precio convertido.
    const t = totalesALempiras(calcularCentavos(lineasMonedaOriginal, opcionesCalculo).totales, tcOriginal);
    totales = {
      descuentos: deCentavos(t.descuentos), subtotal: deCentavos(t.subtotal), importeExonerado: deCentavos(t.importeExonerado),
      importeExento: deCentavos(t.importeExento), importeGravado0: deCentavos(t.importeGravado0),
      importeGravado15: deCentavos(t.importeGravado15), importeGravado18: deCentavos(t.importeGravado18),
      baseCreditoFiscal: deCentavos(t.baseCreditoFiscal), isv15: deCentavos(t.isv15), isv18: deCentavos(t.isv18),
      total: deCentavos(t.total), ajustePorRedondeo: deCentavos(t.ajustePorRedondeo),
      totalEnLetras: centavosEnLetras(t.total, 'HNL'),
    };
  }

  const c = entrada.cliente ?? {};
  const cliente: DocumentoFiscal['cliente'] = {
    ...c,
    ...(c.rtn ? { rtn: limpiarIdentificador(c.rtn) } : {}),
    nombreImpreso: c.nombre?.trim() || CONSUMIDOR_FINAL,
  };

  const doc: DocumentoFiscal = {
    tipoDocumento: tipo,
    nombreDocumento: TIPOS_DOCUMENTO[tipo],
    numero: numeroDesdeAutorizacion(autorizacion, correlativo),
    correlativo,
    cai: normalizarCAI(autorizacion.cai),
    rangoAutorizado: formatearRango(autorizacion),
    fechaLimiteEmision: autorizacion.fechaLimiteEmision,
    fechaEmision: entrada.fechaEmision!,
    emisor: { ...entrada.emisor, rtn: limpiarIdentificador(entrada.emisor.rtn) },
    cliente,
    moneda,
    preciosIncluyenISV,
    lineas,
    totales,
    destinoEjemplares: DESTINO_EJEMPLARES,
    advertencias,
    estado: 'EMITIDO',
  };
  if (entrada.horaEmision) doc.horaEmision = entrada.horaEmision;
  if (entrada.exoneracion) doc.exoneracion = entrada.exoneracion;
  if (moneda !== 'HNL') doc.tipoCambio = Number(escaladoATexto(leerTipoCambio(entrada.tipoCambio)!, 6));
  if (entrada.referencia) {
    // El número se guarda con guiones para poder buscar las notas de un documento.
    const r = entrada.referencia;
    doc.referencia = esNumeroValido(r.numero) ? { ...r, numero: formatearNumero(parsearNumero(r.numero)) } : r;
  }
  if (entrada.motivo) doc.motivo = entrada.motivo;
  if (entrada.condicionPago) doc.condicionPago = entrada.condicionPago;
  if (entrada.observaciones) doc.observaciones = entrada.observaciones;
  if (entrada.operador) doc.operador = entrada.operador.trim();
  // Una autorización de prueba (`prueba: true` o CAI ficticio) marca el documento; uno real no lleva el campo.
  if (esAutorizacionDePrueba(autorizacion)) doc.modo = 'prueba';
  const equivalente = calcularEquivalenteLempiras(doc);
  if (equivalente) doc.equivalenteLempiras = equivalente;
  // Documento emitido = inmutable. Corregir es anular (Art. 41) o emitir una nota 06/07.
  return congelar(doc);
}
