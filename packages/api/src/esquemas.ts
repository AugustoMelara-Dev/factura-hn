/**
 * Esquemas Zod / OpenAPI de la API. Validan la **forma** de la solicitud; las reglas fiscales las aplica
 * el núcleo (`emitir`, `validarEntrada`) y vuelven como 422 con la lista de `errores`.
 */
import { z } from '@hono/zod-openapi';

/** Montos como texto decimal ("19.99") para no perder precisión; también se aceptan números. */
export const Monto = z.union([z.string().max(32), z.number()]).openapi({ example: '115.00', description: 'Decimal como texto (recomendado) o número.' });
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-18' });
const Codigo3 = z.string().regex(/^\d{3}$/);
const Texto = (max = 300) => z.string().max(max);

const Solucion = z.string().optional().openapi({ description: 'Qué hacer para resolverlo, si se conoce.' });
const Documentacion = z.string().optional().openapi({
  description: 'Enlace al código en la guía de errores (`docs/errores.md#<codigo>`).',
  example: 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#sin_autorizacion',
});

/**
 * Un problema (error o advertencia) como el `Problema` del núcleo: código, mensaje, campo y, si se conocen, la
 * solución y el enlace a la guía de errores.
 */
export const Problema = z
  .object({ codigo: z.string(), mensaje: z.string(), campo: z.string().optional(), solucion: Solucion, documentacion: Documentacion })
  .openapi('Problema');
/** Alias de `Problema`, de cuando el esquema base no declaraba la guía. */
export const ProblemaConGuia = Problema;

export const ErrorRespuesta = z
  .object({
    error: z.object({
      codigo: z.string(),
      mensaje: z.string(),
      campo: z.string().optional().openapi({ description: 'En un 400 de forma: el primer campo con problema (p. ej. `documento.lineas`).' }),
      solucion: Solucion,
      documentacion: Documentacion,
    }),
    errores: z.array(ProblemaConGuia).optional().openapi({ description: 'En 400 y 422: la lista completa, cada uno con su código y campo.' }),
    advertencias: z.array(Problema).optional(),
  })
  .openapi('Error');

export const Emisor = z
  .object({
    rtn: Texto(20),
    razonSocial: Texto(),
    nombreComercial: Texto(),
    direccionCasaMatriz: Texto(),
    direccionEstablecimiento: Texto(),
    telefono: Texto(40),
    correo: Texto(254),
    /** Dirección de cada establecimiento distinto de la casa matriz, por código. */
    direccionesEstablecimiento: z.record(z.string().regex(/^\d{3}$/), z.string().trim().min(1).max(300)).optional(),
  })
  .openapi('Emisor');
export const EmisorGuardado = Emisor.extend({ id: z.string().uuid() }).openapi('EmisorGuardado');
export const EmisorCambios = Emisor.partial().openapi('EmisorCambios');

const Cliente = z
  .object({
    nombre: Texto().optional(),
    rtn: Texto(20).optional(),
    identificacion: z.object({ tipo: z.enum(['DNI', 'RTN', 'PASAPORTE', 'CARNET_RESIDENTE', 'OTRO']), numero: Texto(40) }).optional(),
    direccion: Texto().optional(),
  })
  .openapi('Cliente');

const Linea = z
  .object({
    codigo: Texto(60).optional(),
    descripcion: Texto(500),
    cantidad: Monto,
    precioUnitario: Monto,
    isv: z.enum(['ISV15', 'ISV18', 'GRAVADO0', 'EXENTO']).optional(),
    descuento: Monto.optional(),
    unidad: Texto(20).optional(),
  })
  .openapi('Linea');

const Referencia = z
  .object({ cai: Texto(60), numero: Texto(19), fecha: Fecha, moneda: z.enum(['HNL', 'USD']).optional(), tipoCambio: Monto.optional() })
  .openapi('Referencia');

export const DocumentoEntrada = z
  .object({
    tipoDocumento: z.enum(['01', '06', '07']).optional(),
    cliente: Cliente.optional(),
    lineas: z.array(Linea).min(1).max(500),
    fechaEmision: Fecha.optional(),
    preciosIncluyenISV: z.boolean().optional(),
    exoneracion: z
      .object({ ordenCompraExenta: Texto(60).optional(), constanciaRegistroExonerado: Texto(60).optional(), registroSAG: Texto(60).optional() })
      .optional(),
    moneda: z.enum(['HNL', 'USD']).optional(),
    tipoCambio: Monto.optional(),
    referencia: Referencia.optional(),
    motivo: Texto(500).optional(),
    condicionPago: z.enum(['CONTADO', 'CREDITO']).optional(),
    observaciones: Texto(1000).optional(),
  })
  .openapi('DocumentoEntrada');

/** Persona que opera (p. ej. el cajero). Para la bitácora; se imprime solo si se pide. */
const Operador = z.string().min(1).max(80).openapi({
  description:
    'Persona que opera (p. ej. el nombre del cajero). Queda en la bitácora junto a la llave. También se puede ' +
    'enviar en la cabecera `X-Operador` (codificada con encodeURIComponent si lleva tildes); si llegan ambos, deben coincidir.',
  example: 'María López',
});

export const SolicitudEmision = z
  .object({
    /** Si la llave está atada a una caja, se usa la suya; si se indica otra, 403. */
    establecimiento: Codigo3.optional(),
    puntoEmision: Codigo3.optional(),
    documento: DocumentoEntrada,
    /** Solo admin (Art. 43): acepta un salto de fecha mayor que el permitido. */
    confirmarSaltoDeFecha: z.boolean().optional(),
    operador: Operador.optional(),
    imprimirOperador: z.boolean().optional().openapi({ description: 'Imprime el operador en el documento («Atendido por»). Requiere operador.' }),
  })
  .openapi('SolicitudEmision');

const LineaCalculada = z.object({
  codigo: z.string().optional(),
  descripcion: z.string(),
  cantidad: z.number(),
  unidad: z.string().optional(),
  precioUnitario: z.number(),
  isv: z.string(),
  descuento: z.number(),
  importe: z.number(),
});

export const DocumentoFiscal = z
  .looseObject({
    tipoDocumento: z.enum(['01', '06', '07']),
    nombreDocumento: z.string(),
    numero: z.string(),
    correlativo: z.number().int(),
    cai: z.string(),
    rangoAutorizado: z.string(),
    fechaLimiteEmision: z.string(),
    fechaEmision: z.string(),
    horaEmision: z.string().optional(),
    emisor: z.looseObject({ rtn: z.string(), razonSocial: z.string() }),
    cliente: z.looseObject({ nombreImpreso: z.string() }),
    moneda: z.enum(['HNL', 'USD']),
    tipoCambio: z.number().optional(),
    lineas: z.array(LineaCalculada),
    totales: z.looseObject({ subtotal: z.number(), isv15: z.number(), isv18: z.number(), total: z.number(), totalEnLetras: z.string() }),
    referencia: Referencia.optional(),
    advertencias: z.array(Problema),
    estado: z.enum(['EMITIDO', 'ANULADO']),
    anulacion: z.object({ motivo: z.string(), fecha: z.string(), hora: z.string() }).optional(),
  })
  .openapi('DocumentoFiscal');

export const RespuestaDocumento = z.object({ documento: DocumentoFiscal }).openapi('RespuestaDocumento');

export const Enlaces = z
  .object({
    pdf: z.string().openapi({ example: '/v1/documentos/000-001-01-00000001.pdf' }),
    html: z.string().openapi({ example: '/v1/documentos/000-001-01-00000001.html' }),
    txt: z.string().openapi({ example: '/v1/documentos/000-001-01-00000001.txt' }),
  })
  .openapi('Enlaces', { description: 'Rutas de la representación impresa, relativas al servidor. Se piden con la misma llave.' });
export const RespuestaEmision = z.object({ documento: DocumentoFiscal, enlaces: Enlaces }).openapi('RespuestaEmision');

export const Autorizacion = z
  .object({
    cai: Texto(60),
    tipoDocumento: z.enum(['01', '06', '07']),
    establecimiento: Codigo3,
    puntoEmision: Codigo3,
    rangoInicial: z.number().int().min(1),
    rangoFinal: z.number().int().min(1),
    fechaLimiteEmision: Fecha,
    fechaAutorizacion: Fecha.optional(),
    ultimoEmitidoAntes: z.number().int().min(0).optional(),
  })
  .openapi('Autorizacion');

export const EstadoAutorizacion = z
  .object({
    vigente: z.boolean(),
    diasRestantes: z.number().int(),
    correlativosRestantes: z.number().int(),
    siguienteCorrelativo: z.number().int().nullable(),
    porcentajeUsado: z.number(),
    alertas: z.array(Problema),
  })
  .openapi('EstadoAutorizacion');

// --- Respuestas (DEC-047) ------------------------------------------------------------------------------------
// Todo recurso va envuelto con su nombre y toda lista es { <plural>, hayMas, siguiente }.

/** Parámetros de una lista paginada: `limite` (1-500, 100 por defecto) y el `cursor` de la página anterior. */
export const Paginacion = {
  limite: z.coerce.number().int().min(1).max(500).optional().openapi({ description: 'Elementos por página (1-500). Por defecto 100.' }),
  cursor: z.string().min(1).max(200).optional().openapi({ description: 'El valor `siguiente` de la página anterior.' }),
};

/** Una página de una lista: los elementos, si hay más y el cursor para pedir la siguiente. */
export const pagina = <T extends z.ZodTypeAny>(nombre: string, elemento: T) =>
  z.object({
    [nombre]: z.array(elemento),
    hayMas: z.boolean().openapi({ description: 'true si hay más elementos después de esta página.' }),
    siguiente: z.string().nullable().openapi({ description: 'Cursor para la página siguiente (parámetro `cursor`); null en la última.' }),
  });

export const RespuestaEmisor = z.object({ emisor: EmisorGuardado }).openapi('RespuestaEmisor');
export const RespuestaAutorizacion = z.object({ autorizacion: Autorizacion }).openapi('RespuestaAutorizacion');
export const RespuestaEstado = z.object({ autorizacion: Autorizacion, estado: EstadoAutorizacion }).openapi('RespuestaEstado');

export const Motivo = z.object({ motivo: z.string().min(1).max(500), operador: Operador.optional() }).openapi('Motivo');

/** Período de consulta: como máximo un año, para no cargar todo el historial en una solicitud. */
export const periodo = <T extends z.ZodRawShape>(extra: T) => z
  .object({ desde: Fecha, hasta: Fecha, ...extra })
  .refine((p) => fechas(p).desde <= fechas(p).hasta, { message: 'desde debe ser anterior o igual a hasta.', path: ['desde'] })
  .refine((p) => (Date.parse(fechas(p).hasta) - Date.parse(fechas(p).desde)) / 86_400_000 <= 366, { message: 'El período no puede pasar de 366 días.', path: ['hasta'] });
const fechas = (p: unknown) => p as { desde: string; hasta: string };

export const LlaveNueva = z
  .object({
    nombre: z.string().min(1).max(100),
    rol: z.enum(['caja', 'admin']),
    establecimiento: Codigo3.optional(),
    puntoEmision: Codigo3.optional(),
  })
  .openapi('LlaveNueva');
export const Llave = z
  .object({
    id: z.string().openapi({ description: 'Id interno de la llave: identifica al actor en la bitácora.' }),
    prefijo: z.string(),
    nombre: z.string(),
    rol: z.enum(['caja', 'admin']),
    establecimiento: z.string().nullable(),
    puntoEmision: z.string().nullable(),
    creada: z.string(),
    revocada: z.string().nullable(),
    ultimoUso: z.string().nullable(),
  })
  .openapi('Llave');

export const WebhookNuevo = z
  .object({ url: z.string().url().max(2000), eventos: z.array(z.enum(['documento.emitido', 'documento.anulado', 'autorizacion.por_vencer', 'autorizacion.agotada'])).min(1) })
  .openapi('WebhookNuevo');
export const Webhook = z
  .object({ id: z.string(), url: z.string(), eventos: z.array(z.string()), activo: z.boolean(), creado: z.string() })
  .openapi('Webhook');

const AutorizacionVigente = z.object({
  cai: z.string(),
  rangoInicial: z.number().int(),
  rangoFinal: z.number().int(),
  fechaLimiteEmision: z.string(),
  diasRestantes: z.number().int(),
  correlativosRestantes: z.number().int(),
  alertas: z.array(Problema),
});

export const Sesion = z
  .object({
    tenant: z.string(),
    modo: z.enum(['local', 'alojado']),
    demo: z.boolean().openapi({ description: 'true en el tenant de demostración (CAI ficticio, sin validez fiscal).' }),
    llave: z.object({
      id: z.string(),
      prefijo: z.string(),
      nombre: z.string(),
      rol: z.enum(['caja', 'admin']),
      establecimiento: z.string().nullable(),
      puntoEmision: z.string().nullable(),
    }),
    emisor: z.object({ registrado: z.boolean(), rtn: z.string().nullable(), razonSocial: z.string().nullable() }),
    puntos: z
      .array(
        z.object({
          establecimiento: z.string(),
          puntoEmision: z.string(),
          tipos: z.array(
            z.object({
              tipoDocumento: z.enum(['01', '06', '07']),
              listo: z.boolean().openapi({ description: 'Hay una autorización vigente con números disponibles para este tipo.' }),
              siguienteNumero: z.string().nullable(),
              autorizaciones: z.array(AutorizacionVigente).openapi({ description: 'Autorizaciones vigentes de este punto y tipo.' }),
              problema: z.union([Problema, z.null()]).openapi({ description: 'Por qué no se puede emitir este tipo, o null si está listo.' }),
            }),
          ),
        }),
      )
      .openapi({ description: 'Llave de caja: su punto de emisión. Llave admin: los puntos con alguna autorización registrada.' }),
    documentosDelMes: z.number().int().nullable().openapi({ description: 'Documentos emitidos este mes por todo el tenant. Solo para llaves admin; null para una llave de caja.' }),
    limiteMensual: z.number().int().nullable(),
    puedeEmitir: z.boolean().openapi({ description: 'Con esta llave ya se puede emitir una factura (tipo 01).' }),
    pendientes: z.array(ProblemaConGuia).openapi({ description: 'Lo que falta para emitir una factura, con su solución.' }),
  })
  .openapi('Sesion');
export const RespuestaSesion = z.object({ sesion: Sesion }).openapi('RespuestaSesion');

export const RespuestaLlave = z.object({ llave: Llave }).openapi('RespuestaLlave');
export const RespuestaLlaveNueva = z
  .object({
    llave: Llave,
    secreto: z.string().openapi({ description: 'La llave completa (`fhn_<prefijo>_<secreto>`) para `Authorization: Bearer`. Solo se muestra esta vez.' }),
  })
  .openapi('RespuestaLlaveNueva');
export const RespuestaWebhook = z.object({ webhook: Webhook }).openapi('RespuestaWebhook');
export const RespuestaWebhookNuevo = z
  .object({
    webhook: Webhook,
    secreto: z.string().openapi({ description: 'Secreto de firma (`whsec_…`) para verificar los envíos. Solo se muestra esta vez.' }),
  })
  .openapi('RespuestaWebhookNuevo');
