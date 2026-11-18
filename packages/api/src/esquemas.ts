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

export const Problema = z.object({ codigo: z.string(), mensaje: z.string(), campo: z.string().optional() }).openapi('Problema');

export const ErrorRespuesta = z
  .object({
    error: z.object({ codigo: z.string(), mensaje: z.string() }),
    errores: z.array(Problema).optional(),
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

export const SolicitudEmision = z
  .object({
    /** Si la llave está atada a una caja, se usa la suya; si se indica otra, 403. */
    establecimiento: Codigo3.optional(),
    puntoEmision: Codigo3.optional(),
    documento: DocumentoEntrada,
    /** Solo admin (Art. 43): acepta un salto de fecha mayor que el permitido. */
    confirmarSaltoDeFecha: z.boolean().optional(),
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
    autorizacion: Autorizacion,
    vigente: z.boolean(),
    diasRestantes: z.number().int(),
    correlativosRestantes: z.number().int(),
    siguienteCorrelativo: z.number().int().nullable(),
    porcentajeUsado: z.number(),
    alertas: z.array(Problema),
  })
  .openapi('EstadoAutorizacion');

export const Motivo = z.object({ motivo: z.string().min(1).max(500) }).openapi('Motivo');

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
