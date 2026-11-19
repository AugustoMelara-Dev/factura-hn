/**
 * API REST de factura-hn (Hono + OpenAPI). El mismo código sirve dos modos:
 * - `alojado`: multi-tenant; cada llave de API pertenece a un tenant y la base aísla los datos con RLS.
 * - `local`: un solo negocio con su propio servidor y base en el establecimiento (Art. 47).
 *
 * El tenant sale **solo** de la llave de API, nunca de la solicitud.
 */
import { createHash, randomBytes } from 'node:crypto';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type pg from 'pg';
import {
  anular,
  corregirFechaAdelantada,
  emitir,
  ErrorValidacion,
  problemaDeOperador,
  estadoAutorizacion,
  exportarTexto,
  fechaHonduras,
  filaLibroVentas,
  identificadorDeNumero,
  libroVentasCSV,
  noUtilizadosDelAlmacen,
  normalizarCAI,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  resumenVentas,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoFiscal,
  type Emisor as EmisorCore,
  type LibroContable,
  type TransaccionFiscal,
} from 'factura-hn';
import { AlmacenPostgres, type TransaccionPostgres } from '@factura-hn/postgres';
import { renderizarPDF } from '@factura-hn/pdf';
import { ROL_POR_DEFECTO } from './esquema';
import { ErrorApi, LimitadorSolicitudes, type CuerpoError } from './errores';
import { coincide, generarLlave, prefijoDe, type RolLlave } from './llaves';
import * as S from './esquemas';
import { CofreSecretos, comoTransaccionPostgres, encolarEvento, problemaDeURL, type EventoWebhook } from './webhooks';

export const VERSION_API = '0.2.0';

export interface ConfigApi {
  pool: pg.Pool;
  modo: 'local' | 'alojado';
  /** Rol de base de datos sin BYPASSRLS con el que corre cada transacción. */
  rol?: string;
  cofre?: CofreSecretos;
  reloj?: () => Date;
  /** Solicitudes por segundo y ráfaga por llave. Por defecto 20 y 40. */
  limiteSolicitudes?: { porSegundo: number; rafaga: number };
  registrar?: (mensaje: string, error?: unknown) => void;
}

export interface Sesion {
  tenant: string;
  rol: RolLlave;
  prefijo: string;
  /** Id interno de la llave (estable; no es parte del secreto). */
  llaveId: string;
  /** Nombre que el admin le dio a la llave (p. ej. «Caja 1»). */
  llaveNombre: string;
  establecimiento: string | null;
  puntoEmision: string | null;
  limiteMensual: number | null;
}

type Env = { Variables: { sesion: Sesion } };

const IDENTIFICADOR = /^\d{3}-\d{3}-\d{2}$/;
const NUMERO = /^\d{3}-\d{3}-\d{2}-\d{8}$/;
const CLAVE_IDEMPOTENCIA = /^[\x21-\x7e]{1,255}$/;

/** JSON con las claves ordenadas: la huella de una solicitud no depende del orden de los campos. */
function jsonEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${jsonEstable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const respuestasError = {
  400: { description: 'Solicitud mal formada', content: { 'application/json': { schema: S.ErrorRespuesta } } },
  401: { description: 'Falta la llave de API o no es válida', content: { 'application/json': { schema: S.ErrorRespuesta } } },
  403: { description: 'La llave no tiene permiso', content: { 'application/json': { schema: S.ErrorRespuesta } } },
  422: { description: 'Reglas fiscales: lista de errores', content: { 'application/json': { schema: S.ErrorRespuesta } } },
  429: { description: 'Límite de solicitudes o de documentos del mes', content: { 'application/json': { schema: S.ErrorRespuesta } } },
} as const;
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const seguridad = [{ llave: [] }];

// --- Paginación (DEC-047) ------------------------------------------------------------------------------------
const LIMITE_POR_DEFECTO = 100;
const FECHA_CURSOR = /^\d{4}-\d{2}-\d{2}$/;

/** El cursor es opaco para el cliente: la llave de orden del último elemento, en JSON y base64url. */
const escribirCursor = (llave: unknown) => Buffer.from(JSON.stringify(llave)).toString('base64url');
function leerCursor<T>(cursor: string, valido: (v: unknown) => v is T): T {
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    v = undefined;
  }
  if (!valido(v)) throw new ErrorApi(400, 'CURSOR_INVALIDO', 'El cursor no es válido: usa el valor `siguiente` de la página anterior, sin cambios.');
  return v;
}
/** De `limite + 1` filas, la página y el cursor de la siguiente si sobró una. */
function paginar<F>(filas: F[], limite: number, llave: (f: F) => unknown) {
  const hayMas = filas.length > limite;
  const elementos = hayMas ? filas.slice(0, limite) : filas;
  return { elementos, hayMas, siguiente: hayMas ? escribirCursor(llave(elementos[elementos.length - 1]!)) : null };
}

export function crearApp(cfg: ConfigApi): OpenAPIHono<Env> {
  const rolBd = cfg.rol ?? ROL_POR_DEFECTO;
  const base = new AlmacenPostgres(cfg.pool, { rol: rolBd });
  const cofre = cfg.cofre ?? new CofreSecretos(null);
  const reloj = cfg.reloj ?? (() => new Date());
  const limitador = new LimitadorSolicitudes(cfg.limiteSolicitudes?.porSegundo ?? 20, cfg.limiteSolicitudes?.rafaga ?? 40);
  const registrar = cfg.registrar ?? ((m: string, e?: unknown) => console.error(m, e));
  const ultimoUso = new Map<string, number>();

  const app = new OpenAPIHono<Env>({
    defaultHook: (r, c) => {
      if (!r.success) {
        const detalles = r.error.issues.map((i) => ({ codigo: 'SOLICITUD_INVALIDA', mensaje: i.message, campo: i.path.join('.') }));
        return c.json<CuerpoError>({ error: { codigo: 'SOLICITUD_INVALIDA', mensaje: 'La solicitud no tiene la forma esperada.' }, errores: detalles }, 400);
      }
      return undefined;
    },
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'llave', {
    type: 'http',
    scheme: 'bearer',
    description: 'Llave de API `fhn_<prefijo>_<secreto>`. Rol `caja`: emite y consulta. Rol `admin`: todo.',
  });

  // --- Infraestructura -------------------------------------------------------------------------------------
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
  });
  app.use('/v1/*', bodyLimit({ maxSize: 512 * 1024, onError: () => { throw new ErrorApi(413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo supera 512 KB.'); } }));

  app.onError((e, c) => {
    if (e instanceof ErrorApi) {
      if (e.estado === 429 && typeof e.extra.reintentarEn === 'number') c.header('Retry-After', String(e.extra.reintentarEn));
      const { reintentarEn: _r, ...extra } = e.extra;
      return c.json<CuerpoError>({ error: { codigo: e.codigo, mensaje: e.message }, ...extra }, e.estado);
    }
    if (e instanceof ErrorValidacion) {
      const noEncontrado = e.errores.some((p) => p.codigo === 'DOCUMENTO_NO_ENCONTRADO');
      return c.json<CuerpoError>(
        { error: { codigo: noEncontrado ? 'NO_ENCONTRADO' : 'VALIDACION', mensaje: e.errores.map((p) => p.mensaje).join(' ') }, errores: e.errores, advertencias: e.advertencias },
        noEncontrado ? 404 : 422,
      );
    }
    if (e instanceof HTTPException) return e.getResponse();
    registrar('Error interno', e);
    return c.json<CuerpoError>({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno. Se registró para revisión.' } }, 500);
  });
  app.notFound((c) => c.json<CuerpoError>({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Ruta no encontrada.' } }, 404));

  // Autenticación: Authorization: Bearer fhn_<prefijo>_<secreto>
  app.use('/v1/*', async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    const llave = /^bearer +(\S+)$/i.exec(auth.trim())?.[1] ?? '';
    const prefijo = prefijoDe(llave);
    const noValida = new ErrorApi(401, 'NO_AUTENTICADO', 'Falta la llave de API o no es válida.');
    if (!prefijo) throw noValida;
    // El límite va antes de consultar la base: también frena a quien prueba secretos con un prefijo conocido.
    const espera = limitador.tomar(prefijo);
    if (espera > 0) throw new ErrorApi(429, 'DEMASIADAS_SOLICITUDES', 'Demasiadas solicitudes con esta llave. Espera y reintenta.', { reintentarEn: espera });
    const fila = await base.transaccion(async (t) => {
      const r = await comoTransaccionPostgres(t).consulta<{
        tenant: string; hash: Buffer; rol: RolLlave; establecimiento: string | null; punto_emision: string | null; limite_mensual: number | null;
        id: string; nombre: string;
      }>('SELECT * FROM fhn_api_autenticar($1)', [prefijo]);
      return r.rows[0];
    });
    if (!fila || !coincide(llave, fila.hash)) throw noValida;
    // Último uso: solo con el secreto correcto y a lo sumo una vez por minuto por llave.
    const ahoraMs = Date.now();
    if ((ultimoUso.get(prefijo) ?? 0) < ahoraMs - 60_000) {
      ultimoUso.set(prefijo, ahoraMs);
      if (ultimoUso.size > 10_000) ultimoUso.delete(ultimoUso.keys().next().value!);
      await base.transaccion((t) => comoTransaccionPostgres(t).consulta('SELECT fhn_api_marcar_uso($1, $2)', [prefijo, fila.hash]));
    }
    c.set('sesion', {
      tenant: fila.tenant,
      rol: fila.rol,
      prefijo,
      llaveId: fila.id,
      llaveNombre: fila.nombre,
      establecimiento: fila.establecimiento,
      puntoEmision: fila.punto_emision,
      limiteMensual: fila.limite_mensual,
    });
    await next();
  });

  // El cuerpo debe ser UTF-8 válido. Sin esto, un byte en otra codificación (p. ej. «é» en Latin-1 desde una
  // consola de Windows) se convierte en U+FFFD y queda guardado en un documento que ya no se puede corregir.
  const utf8Estricto = new TextDecoder('utf-8', { fatal: true });
  app.use('/v1/*', async (c, next) => {
    if (c.req.raw.body) {
      try {
        utf8Estricto.decode(await c.req.arrayBuffer());
      } catch {
        throw new ErrorApi(
          400,
          'CUERPO_NO_UTF8',
          'El cuerpo no es UTF-8 válido. Envía el JSON en UTF-8; con curl, guárdalo en un archivo y usa --data-binary @archivo.json.',
        );
      }
    }
    await next();
  });

  const sesion = (c: Context<Env>) => c.get('sesion');
  const almacenDe = (c: Context<Env>) => base.paraTenant(sesion(c).tenant);
  // DEC-031: el actor es el id interno de la llave, con su rol y nombre al momento de la operación.
  const actor = (c: Context<Env>) => {
    const s = sesion(c);
    return `llave:${s.llaveId} (${s.rol}: ${s.llaveNombre})`;
  };
  /**
   * Operador (p. ej. el cajero) del cuerpo o de la cabecera X-Operador (codificada con encodeURIComponent si
   * lleva caracteres fuera de ASCII). Si llegan ambos, deben coincidir. Lo valida el núcleo (`OPERADOR`, 422).
   */
  const operadorDe = (c: Context<Env>, delCuerpo: string | undefined): string | undefined => {
    const cabecera = c.req.header('x-operador');
    let deCabecera: string | undefined;
    if (cabecera !== undefined) {
      try {
        deCabecera = decodeURIComponent(cabecera);
      } catch {
        throw new ErrorApi(400, 'OPERADOR_CABECERA', 'La cabecera X-Operador no es válida: codifícala con encodeURIComponent.');
      }
    }
    if (deCabecera !== undefined && delCuerpo !== undefined && deCabecera.trim() !== delCuerpo.trim()) {
      throw new ErrorApi(400, 'OPERADOR_CONFLICTO', 'El operador del cuerpo y el de la cabecera X-Operador no coinciden.');
    }
    const op = delCuerpo ?? deCabecera;
    const p = problemaDeOperador(op);
    if (p) throw new ErrorValidacion([p]);
    return op?.trim();
  };
  const exigirAdmin = (c: Context<Env>) => {
    if (sesion(c).rol !== 'admin') throw new ErrorApi(403, 'SOLO_ADMIN', 'Esta operación requiere una llave con rol admin.');
  };
  /** Una transacción del tenant de la sesión con acceso SQL a las tablas de la API. */
  const enTenant = <T>(c: Context<Env>, fn: (tx: TransaccionPostgres) => Promise<T>) =>
    almacenDe(c).transaccion((t) => fn(comoTransaccionPostgres(t)));
  const bitacora = (tx: TransaccionPostgres, quien: string, accion: string, detalle: Record<string, unknown> = {}, operador?: string) =>
    tx.consulta('INSERT INTO api_bitacora (tenant, actor, accion, detalle, operador) VALUES ($1, $2, $3, $4, $5)', [tx.tenant, quien, accion, JSON.stringify(detalle), operador ?? null]);
  const libroWebhooks: LibroContable = {
    async registrarEmision() {},
    async registrarAnulacion(doc: DocumentoFiscal, tx: TransaccionFiscal) {
      await encolarEvento(comoTransaccionPostgres(tx), 'documento.anulado', `documento.anulado:${doc.numero}`, doc, reloj());
    },
  };

  // --- Público ---------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({ method: 'get', path: '/salud', tags: ['Sistema'], summary: 'Estado del servicio', responses: { 200: json(z.object({ ok: z.boolean(), version: z.string(), modo: z.string() }), 'En servicio') } }),
    async (c) => {
      await cfg.pool.query('SELECT 1');
      return c.json({ ok: true, version: VERSION_API, modo: cfg.modo }, 200);
    },
  );

  // --- Emisores --------------------------------------------------------------------------------------------
  type EmisorGuardado = z.infer<typeof S.Emisor>;
  const problemasEmisor = (e: EmisorGuardado) => {
    const { errores } = validarEntrada(
      { emisor: e as EmisorCore, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] },
      { cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoInicial: 1, rangoFinal: 1, fechaLimiteEmision: '2999-12-31' },
    );
    const delEmisor = errores.filter((p) => p.campo?.startsWith('emisor'));
    if (delEmisor.length) throw new ErrorValidacion(delEmisor);
  };
  const leerEmisor = async (tx: TransaccionPostgres) => {
    const r = await tx.consulta<{ id: string; datos: EmisorGuardado }>('SELECT id, datos FROM api_emisores WHERE tenant = $1', [tx.tenant]);
    return r.rows[0] ?? null;
  };

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/emisores', tags: ['Emisor'], security: seguridad,
      summary: 'Registra los datos del obligado tributario (uno por tenant)',
      request: { body: { content: { 'application/json': { schema: S.Emisor } }, required: true } },
      responses: { 201: json(S.RespuestaEmisor, 'Registrado'), 409: json(S.ErrorRespuesta, 'Ya existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const e = c.req.valid('json');
      problemasEmisor(e);
      const id = await enTenant(c, async (tx) => {
        const r = await tx.consulta<{ id: string }>('INSERT INTO api_emisores (tenant, datos) VALUES ($1, $2) ON CONFLICT (tenant) DO NOTHING RETURNING id', [tx.tenant, JSON.stringify(e)]);
        if (!r.rows[0]) {
          const actual = await leerEmisor(tx);
          throw new ErrorApi(409, 'EMISOR_EXISTE', `Este tenant ya tiene emisor (id ${actual?.id}): usa PATCH /v1/emisores/${actual?.id}.`, { id: actual?.id });
        }
        await bitacora(tx, actor(c), 'emisor.creado', { rtn: e.rtn });
        return r.rows[0].id;
      });
      return c.json({ emisor: { id, ...e } }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/emisores', tags: ['Emisor'], security: seguridad, summary: 'El emisor del tenant (lista de 0 o 1)',
      responses: { 200: json(S.pagina('emisores', S.EmisorGuardado), 'Lista'), ...respuestasError },
    }),
    async (c) => {
      const e = await enTenant(c, leerEmisor);
      return c.json({ emisores: e ? [{ id: e.id, ...e.datos }] : [], hayMas: false, siguiente: null }, 200);
    },
  );

  const rutaEmisorId = z.object({ id: z.string().uuid() });
  app.openapi(
    createRoute({
      method: 'get', path: '/v1/emisores/{id}', tags: ['Emisor'], security: seguridad, summary: 'Datos del emisor',
      request: { params: rutaEmisorId },
      responses: { 200: json(S.RespuestaEmisor, 'Emisor'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const e = await enTenant(c, leerEmisor);
      if (!e || e.id !== id) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Emisor no encontrado.');
      return c.json({ emisor: { id: e.id, ...e.datos } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch', path: '/v1/emisores/{id}', tags: ['Emisor'], security: seguridad,
      summary: 'Actualiza el emisor (solo afecta a los documentos futuros; el RTN no cambia)',
      request: { params: rutaEmisorId, body: { content: { 'application/json': { schema: S.EmisorCambios } }, required: true } },
      responses: { 200: json(S.RespuestaEmisor, 'Actualizado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      const cambios = c.req.valid('json');
      const nuevo = await enTenant(c, async (tx) => {
        const e = await leerEmisor(tx);
        if (!e || e.id !== id) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Emisor no encontrado.');
        if (cambios.rtn !== undefined && cambios.rtn !== e.datos.rtn) {
          throw new ErrorApi(422, 'EMISOR_RTN_INMUTABLE', 'El RTN identifica al obligado tributario y sus autorizaciones: no se cambia. Crea otro tenant.');
        }
        const datos = { ...e.datos, ...cambios };
        problemasEmisor(datos);
        await tx.consulta('UPDATE api_emisores SET datos = $2, actualizado = now() WHERE tenant = $1', [tx.tenant, JSON.stringify(datos)]);
        await bitacora(tx, actor(c), 'emisor.actualizado', { campos: Object.keys(cambios) });
        return datos;
      });
      return c.json({ emisor: { id, ...nuevo } }, 200);
    },
  );

  // --- Autorizaciones (CAI) --------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/autorizaciones', tags: ['Autorizaciones'], security: seguridad,
      summary: 'Registra una autorización del SAR (CAI, rango y fecha límite)',
      request: { body: { content: { 'application/json': { schema: S.Autorizacion } }, required: true } },
      responses: { 201: json(S.RespuestaAutorizacion, 'Registrada'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const a = await registrarAutorizacion(almacenDe(c), c.req.valid('json') as AutorizacionCAI, { reloj, actor: actor(c), operador: operadorDe(c, undefined) });
      return c.json({ autorizacion: a as unknown as z.infer<typeof S.Autorizacion> }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/autorizaciones', tags: ['Autorizaciones'], security: seguridad, summary: 'Autorizaciones registradas',
      responses: { 200: json(S.pagina('autorizaciones', S.Autorizacion), 'Lista'), ...respuestasError },
    }),
    async (c) => {
      const lista = await enTenant(c, async (tx) =>
        (await tx.consulta<{ datos: AutorizacionCAI }>('SELECT datos FROM fhn_autorizaciones WHERE tenant = $1 ORDER BY identificador, rango_inicial', [tx.tenant])).rows.map((f) => f.datos),
      );
      return c.json({ autorizaciones: lista as unknown as z.infer<typeof S.Autorizacion>[], hayMas: false, siguiente: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/autorizaciones/{cai}/estado', tags: ['Autorizaciones'], security: seguridad,
      summary: 'Vigencia y rango restante de una autorización (Arts. 59 y 62)',
      request: { params: z.object({ cai: z.string().min(1).max(60) }) },
      responses: { 200: json(S.RespuestaEstado, 'Estado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      const cai = normalizarCAI(c.req.valid('param').cai);
      const r = await enTenant(c, async (tx) => {
        const a = (await tx.consulta<{ datos: AutorizacionCAI; identificador: string }>('SELECT datos, identificador FROM fhn_autorizaciones WHERE tenant = $1 AND cai = $2', [tx.tenant, cai])).rows[0];
        if (!a) return null;
        const s = (await tx.consulta<{ ultimo: number | null }>('SELECT ultimo FROM fhn_series WHERE tenant = $1 AND identificador = $2', [tx.tenant, a.identificador])).rows[0];
        return { aut: a.datos, ultimo: s?.ultimo ?? null };
      });
      if (!r) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Autorización no encontrada.');
      const consumido = Math.max(r.ultimo ?? 0, r.aut.ultimoEmitidoAntes ?? 0);
      const ultimo = consumido < r.aut.rangoInicial ? null : Math.min(consumido, r.aut.rangoFinal);
      const estado = estadoAutorizacion(r.aut, ultimo, { hoy: fechaHonduras(reloj()) });
      return c.json({ autorizacion: r.aut as unknown as z.infer<typeof S.Autorizacion>, estado }, 200);
    },
  );

  // --- Documentos ------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/documentos', tags: ['Documentos'], security: seguridad,
      summary: 'Emite una factura, nota de crédito o nota de débito',
      description:
        'Reserva el correlativo, guarda el documento y registra la auditoría en una sola transacción. ' +
        'La cabecera `Idempotency-Key` es obligatoria: repetir la solicitud con la misma clave devuelve el mismo documento ' +
        '(cabecera `Idempotency-Replayed: true`) sin consumir otro número; la misma clave con otro cuerpo es 422.',
      request: {
        headers: z.object({ 'idempotency-key': z.string().openapi({ description: 'Clave única por venta (p. ej. un UUID generado por el POS).' }) }),
        body: { content: { 'application/json': { schema: S.SolicitudEmision } }, required: true },
      },
      responses: { 201: json(S.RespuestaDocumento, 'Emitido'), 409: json(S.ErrorRespuesta, 'Falta registrar el emisor'), ...respuestasError },
    }),
    async (c) => {
      const s = sesion(c);
      const clave = c.req.header('idempotency-key') ?? '';
      if (!CLAVE_IDEMPOTENCIA.test(clave)) {
        throw new ErrorApi(400, 'IDEMPOTENCY_KEY', 'La cabecera Idempotency-Key es obligatoria (1 a 255 caracteres visibles).');
      }
      const cuerpo = c.req.valid('json');
      if (cuerpo.confirmarSaltoDeFecha && s.rol !== 'admin') {
        throw new ErrorApi(403, 'SOLO_ADMIN', 'Confirmar un salto de fecha requiere una llave admin (Art. 43).');
      }
      let establecimiento = cuerpo.establecimiento;
      let puntoEmision = cuerpo.puntoEmision;
      if (s.establecimiento && s.puntoEmision) {
        if ((establecimiento && establecimiento !== s.establecimiento) || (puntoEmision && puntoEmision !== s.puntoEmision)) {
          throw new ErrorApi(403, 'CAJA_NO_AUTORIZADA', `Esta llave emite solo en ${s.establecimiento}-${s.puntoEmision}.`);
        }
        establecimiento = s.establecimiento;
        puntoEmision = s.puntoEmision;
      }
      if (!establecimiento || !puntoEmision) {
        throw new ErrorApi(400, 'PUNTO_EMISION_REQUERIDO', 'Indica establecimiento y puntoEmision (o usa una llave atada a una caja).');
      }
      const { operador: _delCuerpo, imprimirOperador, ...solicitud } = cuerpo;
      const operador = operadorDe(c, cuerpo.operador);
      if (imprimirOperador && !operador) {
        throw new ErrorApi(400, 'OPERADOR_REQUERIDO', 'imprimirOperador requiere un operador (campo operador o cabecera X-Operador).');
      }
      const documento = imprimirOperador ? { ...cuerpo.documento, operador } : cuerpo.documento;
      // El operador solo cambia el documento si se imprime: un reintento de otro cajero con la misma clave no es
      // otra venta.
      const huella = createHash('sha256')
        .update(jsonEstable({ ...solicitud, documento, establecimiento, puntoEmision }))
        .digest('hex');
      const almacen = almacenDe(c);

      const repetir = (previa: { huella: string; codigo: number; respuesta: unknown }) => {
        if (previa.huella !== huella) {
          throw new ErrorApi(422, 'IDEMPOTENCIA_CONFLICTO', 'Esta Idempotency-Key ya se usó con otra solicitud. Usa una clave nueva por venta.');
        }
        c.header('Idempotency-Replayed', 'true');
        return c.json(previa.respuesta as unknown as z.infer<typeof S.RespuestaDocumento>, 201);
      };
      const buscarPrevia = () =>
        enTenant(c, async (tx) => (await tx.consulta<{ huella: string; codigo: number; respuesta: unknown }>(
          'SELECT huella, codigo, respuesta FROM api_idempotencia WHERE tenant = $1 AND clave = $2', [tx.tenant, clave],
        )).rows[0]);

      const previa = await buscarPrevia();
      if (previa) return repetir(previa);

      const emisor = await enTenant(c, leerEmisor);
      if (!emisor) throw new ErrorApi(409, 'SIN_EMISOR', 'Registra primero el emisor (POST /v1/emisores).');
      const { direccionesEstablecimiento, ...datosEmisor } = emisor.datos;
      const emisorDoc: EmisorCore = {
        ...datosEmisor,
        direccionEstablecimiento: direccionesEstablecimiento?.[establecimiento] ?? datosEmisor.direccionEstablecimiento,
      };

      const CONFLICTO = Symbol('conflicto');
      let respuesta: { documento: DocumentoFiscal } | null = null;
      try {
        await emitir({ ...documento, emisor: emisorDoc }, {
          almacen,
          establecimiento,
          puntoEmision,
          actor: actor(c),
          operador,
          confirmarSaltoDeFecha: cuerpo.confirmarSaltoDeFecha,
          opciones: { reloj },
          alEmitir: async (doc, t) => {
            const tx = comoTransaccionPostgres(t);
            respuesta = { documento: doc };
            const r = await tx.consulta(
              'INSERT INTO api_idempotencia (tenant, clave, huella, codigo, respuesta) VALUES ($1, $2, $3, 201, $4) ON CONFLICT DO NOTHING',
              [tx.tenant, clave, huella, JSON.stringify(respuesta)],
            );
            // Otra solicitud con la misma clave ganó la carrera: se revierte esta emisión (el número no se consume).
            if (r.rowCount === 0) throw CONFLICTO;
            const mes = doc.fechaEmision.slice(0, 7);
            const uso = await tx.consulta<{ documentos: number }>(
              `INSERT INTO api_uso (tenant, mes, documentos) VALUES ($1, $2, 1)
               ON CONFLICT (tenant, mes) DO UPDATE SET documentos = api_uso.documentos + 1 RETURNING documentos`,
              [tx.tenant, mes],
            );
            if (s.limiteMensual !== null && uso.rows[0]!.documentos > s.limiteMensual) {
              throw new ErrorApi(429, 'LIMITE_MENSUAL', `Se alcanzó el límite de ${s.limiteMensual} documentos del mes.`);
            }
            const instante = reloj();
            await encolarEvento(tx, 'documento.emitido', `documento.emitido:${doc.numero}`, doc, instante);
            const aut = (await tx.autorizaciones(identificadorDeNumero(doc.numero))).find((a) => a.cai === doc.cai);
            if (aut) {
              const est = estadoAutorizacion(aut, doc.correlativo, { hoy: doc.fechaEmision });
              const codigos = est.alertas.map((a) => a.codigo);
              const ev: EventoWebhook | null = codigos.includes('RANGO_AGOTADO')
                ? 'autorizacion.agotada'
                : codigos.some((k) => k === 'AVISO_RANGO' || k === 'AVISO_VENCIMIENTO') ? 'autorizacion.por_vencer' : null;
              if (ev) await encolarEvento(tx, ev, `${ev}:${aut.cai}`, { autorizacion: aut, ...est }, instante);
            }
            await bitacora(tx, actor(c), 'documento.emitido', { numero: doc.numero, total: doc.totales.total, idempotencia: clave }, operador);
          },
        });
      } catch (e) {
        if (e !== CONFLICTO) throw e;
        const ganadora = await buscarPrevia();
        if (!ganadora) throw e;
        return repetir(ganadora);
      }
      return c.json(respuesta! as unknown as z.infer<typeof S.RespuestaDocumento>, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/documentos', tags: ['Documentos'], security: seguridad, summary: 'Documentos de un período, por fecha de emisión y número (paginado)',
      request: { query: S.periodo({ identificador: z.string().regex(IDENTIFICADOR).optional(), ...S.Paginacion }) },
      responses: { 200: json(S.pagina('documentos', S.DocumentoFiscal), 'Una página'), ...respuestasError },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const limite = q.limite ?? LIMITE_POR_DEFECTO;
      const despues = q.cursor ? leerCursor(q.cursor, (v): v is [string, string] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && FECHA_CURSOR.test(v[0]) && typeof v[1] === 'string' && v[1].length <= 40) : null;
      const filas = await enTenant(c, async (tx) => {
        const params: unknown[] = [tx.tenant, q.desde, q.hasta];
        let sql = 'SELECT datos, fecha_emision::text AS fecha, numero FROM fhn_documentos WHERE tenant = $1 AND fecha_emision >= $2 AND fecha_emision <= $3';
        if (q.identificador) sql += ` AND identificador = $${params.push(q.identificador)}`;
        if (despues) sql += ` AND (fecha_emision, numero) > ($${params.push(despues[0])}::date, $${params.push(despues[1])})`;
        sql += ` ORDER BY fecha_emision, numero LIMIT $${params.push(limite + 1)}`;
        return (await tx.consulta<{ datos: unknown; fecha: string; numero: string }>(sql, params)).rows;
      });
      const { elementos, hayMas, siguiente } = paginar(filas, limite, (f) => [f.fecha, f.numero]);
      const documentos = elementos.map((f) => (typeof f.datos === 'string' ? JSON.parse(f.datos) : f.datos));
      return c.json({ documentos: documentos as z.infer<typeof S.DocumentoFiscal>[], hayMas, siguiente }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/documentos/{archivo}', tags: ['Documentos'], security: seguridad,
      summary: 'Un documento: JSON, o la representación impresa con .pdf, .html o .txt',
      description: 'La copia impresa es idéntica al original (Art. 38). Un documento anulado lleva la leyenda ANULADA (Art. 41).',
      request: {
        params: z.object({ archivo: z.string().openapi({ example: '000-001-01-00000001.pdf' }) }),
        query: z.object({ formato: z.enum(['carta', 'ticket']).optional(), ancho: z.coerce.number().int().min(32).max(120).optional() }),
      },
      responses: {
        200: {
          description: 'Documento',
          content: {
            'application/json': { schema: S.RespuestaDocumento },
            'application/pdf': { schema: z.string().openapi({ format: 'binary' }) },
            'text/html': { schema: z.string() },
            'text/plain': { schema: z.string() },
          },
        },
        404: json(S.ErrorRespuesta, 'No existe'),
        ...respuestasError,
      },
    }),
    async (c) => {
      const m = /^(\d{3}-\d{3}-\d{2}-\d{8})(?:\.(pdf|html|txt))?$/.exec(c.req.valid('param').archivo);
      if (!m) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Número de documento inválido (NNN-NNN-TT-NNNNNNNN).');
      const doc = await almacenDe(c).transaccion((tx) => tx.buscarDocumento(m[1]!));
      if (!doc) throw new ErrorApi(404, 'NO_ENCONTRADO', `No existe el documento ${m[1]}.`);
      const q = c.req.valid('query');
      switch (m[2]) {
        case 'pdf': {
          const pdf = await renderizarPDF(doc, { formato: q.formato });
          return c.body(pdf as unknown as ArrayBuffer, 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${doc.numero}.pdf"` });
        }
        case 'html':
          return c.body(renderizarHTML(doc), 200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          });
        case 'txt':
          return c.body(renderizarTexto(doc, q.ancho ? { ancho: q.ancho } : {}), 200, { 'Content-Type': 'text/plain; charset=utf-8' });
        default:
          return c.json({ documento: doc as unknown as z.infer<typeof S.DocumentoFiscal> }, 200);
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/v1/documentos/{numero}/anular', tags: ['Documentos'], security: seguridad,
      summary: 'Anula un documento (Art. 41): conserva número y contenido, cambia el estado',
      request: { params: z.object({ numero: z.string().regex(NUMERO) }), body: { content: { 'application/json': { schema: S.Motivo } }, required: true } },
      responses: { 200: json(S.RespuestaDocumento, 'Anulado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const cuerpo = c.req.valid('json');
      const doc = await anular(c.req.valid('param').numero, {
        almacen: almacenDe(c),
        motivo: cuerpo.motivo,
        reloj,
        actor: actor(c),
        operador: operadorDe(c, cuerpo.operador),
        libroContable: libroWebhooks,
      });
      return c.json({ documento: doc as unknown as z.infer<typeof S.DocumentoFiscal> }, 200);
    },
  );

  // --- Series ----------------------------------------------------------------------------------------------
  const rutaSerie = z.object({ identificador: z.string().regex(IDENTIFICADOR).openapi({ example: '000-001-01' }) });
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/series/{identificador}/corregir-fecha', tags: ['Series'], security: seguridad,
      summary: 'Anula los documentos emitidos con el reloj adelantado (Arts. 41 y 43)',
      request: { params: rutaSerie, body: { content: { 'application/json': { schema: S.Motivo } }, required: true } },
      responses: { 200: json(z.object({ anulados: z.array(S.DocumentoFiscal) }), 'Anulados'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const cuerpo = c.req.valid('json');
      const anulados = await corregirFechaAdelantada(almacenDe(c), {
        identificador: c.req.valid('param').identificador,
        motivo: cuerpo.motivo,
        reloj,
        actor: actor(c),
        operador: operadorDe(c, cuerpo.operador),
        libroContable: libroWebhooks,
      });
      return c.json({ anulados: anulados as unknown as z.infer<typeof S.DocumentoFiscal>[] }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/series/{identificador}/no-utilizados', tags: ['Series'], security: seguridad,
      summary: 'Números que hay que reportar al SAR como no utilizados (Art. 42)',
      request: { params: rutaSerie },
      responses: { 200: json(z.object({ rangos: z.array(z.looseObject({ desde: z.number(), hasta: z.number(), cantidad: z.number(), fechaLimiteAviso: z.string() })) }), 'Rangos'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const rangos = await noUtilizadosDelAlmacen(almacenDe(c), c.req.valid('param').identificador, { hoy: fechaHonduras(reloj()) });
      return c.json({ rangos } as never, 200);
    },
  );

  // --- Reportes --------------------------------------------------------------------------------------------
  app.openapi(
    createRoute({
      method: 'get', path: '/v1/libro-ventas', tags: ['Reportes'], security: seguridad,
      summary: 'Libro de ventas de un período (las NC restan, las ND suman; anulados en cero)',
      request: { query: S.periodo({ formato: z.enum(['json', 'csv']).optional() }) },
      responses: {
        200: { description: 'Libro', content: { 'application/json': { schema: z.object({ filas: z.array(z.looseObject({})), resumen: z.looseObject({}) }) }, 'text/csv': { schema: z.string() } } },
        ...respuestasError,
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const docs = await almacenDe(c).transaccion((tx) => tx.documentos({ desde: q.desde, hasta: q.hasta }));
      const filas = docs.map(filaLibroVentas);
      if (q.formato === 'csv') {
        return c.body(libroVentasCSV(filas), 200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="libro-ventas_${q.desde}_${q.hasta}.csv"`,
        });
      }
      return c.json({ filas: filas as never, resumen: resumenVentas(filas) as never }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/exportacion', tags: ['Reportes'], security: seguridad,
      summary: 'Archivo de texto de un período para el SAR (Art. 53 num. 5)',
      request: { query: S.periodo({ formato: z.enum(['jsonl', 'csv', 'txt']).optional() }) },
      responses: { 200: { description: 'Archivo', content: { 'text/plain': { schema: z.string() } } }, ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const q = c.req.valid('query');
      const formato = q.formato ?? 'jsonl';
      const docs = await almacenDe(c).transaccion((tx) => tx.documentos({ desde: q.desde, hasta: q.hasta }));
      const tipos = { jsonl: 'application/x-ndjson', csv: 'text/csv', txt: 'text/plain' } as const;
      await enTenant(c, (tx) => bitacora(tx, actor(c), 'exportacion', { desde: q.desde, hasta: q.hasta, formato, documentos: docs.length }));
      return c.body(exportarTexto(docs, { formato }), 200, {
        'Content-Type': `${tipos[formato]}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="factura-hn_${q.desde}_${q.hasta}.${formato}"`,
      }) as never;
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/bitacora', tags: ['Auditoría'], security: seguridad,
      summary: 'Bitácora fiscal (Art. 53 num. 2) o de la API, del evento más reciente al más antiguo (paginada)',
      request: {
        query: z.object({
          origen: z.enum(['fiscal', 'api']).optional().openapi({ description: '`fiscal` (por defecto): emisiones, anulaciones y autorizaciones. `api`: llaves, emisor y webhooks.' }),
          ...S.Paginacion,
        }),
      },
      responses: { 200: json(S.pagina('eventos', z.looseObject({})), 'Una página'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const q = c.req.valid('query');
      const limite = q.limite ?? LIMITE_POR_DEFECTO;
      const antesDe = q.cursor ? leerCursor(q.cursor, (v): v is string => typeof v === 'string' && /^\d{1,19}$/.test(v)) : null;
      const sql = q.origen === 'api'
        ? "SELECT id::text AS id, json_build_object('id', id, 'instante', instante, 'actor', actor, 'operador', operador, 'accion', accion, 'detalle', detalle) AS evento FROM api_bitacora"
        : 'SELECT id::text AS id, datos AS evento FROM fhn_eventos';
      const filas = await enTenant(c, async (tx) =>
        (await tx.consulta<{ id: string; evento: unknown }>(
          `${sql} WHERE tenant = $1 AND ($2::bigint IS NULL OR id < $2::bigint) ORDER BY id DESC LIMIT $3`, [tx.tenant, antesDe, limite + 1],
        )).rows,
      );
      const { elementos, hayMas, siguiente } = paginar(filas, limite, (f) => f.id);
      const eventos = elementos.map((f) => (typeof f.evento === 'string' ? JSON.parse(f.evento) : f.evento));
      return c.json({ eventos, hayMas, siguiente } as never, 200);
    },
  );

  // --- Llaves ----------------------------------------------------------------------------------------------
  type FilaLlave = { id: string; prefijo: string; nombre: string; rol: RolLlave; establecimiento: string | null; punto_emision: string | null; creada: Date; revocada: Date | null; ultimo_uso: Date | null };
  const aLlave = (f: FilaLlave) => ({
    id: f.id, prefijo: f.prefijo, nombre: f.nombre, rol: f.rol, establecimiento: f.establecimiento, puntoEmision: f.punto_emision,
    creada: f.creada.toISOString(), revocada: f.revocada?.toISOString() ?? null, ultimoUso: f.ultimo_uso?.toISOString() ?? null,
  });
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/llaves', tags: ['Llaves'], security: seguridad,
      summary: 'Crea una llave (la llave completa se muestra solo esta vez)',
      request: { body: { content: { 'application/json': { schema: S.LlaveNueva } }, required: true } },
      responses: { 201: json(S.RespuestaLlaveNueva, 'Creada'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const b = c.req.valid('json');
      if (Boolean(b.establecimiento) !== Boolean(b.puntoEmision) || (b.rol === 'caja' && !b.establecimiento)) {
        throw new ErrorApi(400, 'CAJA_INCOMPLETA', 'Una llave de caja se ata a un establecimiento y punto de emisión: indica ambos.');
      }
      const { llave, prefijo, hash } = generarLlave();
      const fila = await enTenant(c, async (tx) => {
        const r = await tx.consulta<FilaLlave>(
          `INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre, establecimiento, punto_emision) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, prefijo, nombre, rol, establecimiento, punto_emision, creada, revocada, ultimo_uso`,
          [prefijo, tx.tenant, hash, b.rol, b.nombre, b.establecimiento ?? null, b.puntoEmision ?? null],
        );
        await bitacora(tx, actor(c), 'llave.creada', { prefijo, rol: b.rol, nombre: b.nombre });
        return r.rows[0]!;
      });
      return c.json({ llave: aLlave(fila), secreto: llave }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/llaves', tags: ['Llaves'], security: seguridad, summary: 'Llaves del tenant (sin secretos)',
      responses: { 200: json(S.pagina('llaves', S.Llave), 'Lista'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const filas = await enTenant(c, async (tx) =>
        (await tx.consulta<FilaLlave>('SELECT id, prefijo, nombre, rol, establecimiento, punto_emision, creada, revocada, ultimo_uso FROM api_llaves WHERE tenant = $1 ORDER BY creada', [tx.tenant])).rows,
      );
      return c.json({ llaves: filas.map(aLlave), hayMas: false, siguiente: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete', path: '/v1/llaves/{prefijo}', tags: ['Llaves'], security: seguridad, summary: 'Revoca una llave',
      request: { params: z.object({ prefijo: z.string().regex(/^[0-9a-f]{12}$/) }) },
      responses: { 200: json(S.RespuestaLlave, 'Revocada'), 404: json(S.ErrorRespuesta, 'No existe'), 409: json(S.ErrorRespuesta, 'Última llave admin'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const { prefijo } = c.req.valid('param');
      const fila = await enTenant(c, async (tx) => {
        const objetivo = (await tx.consulta<{ rol: RolLlave }>('SELECT rol FROM api_llaves WHERE tenant = $1 AND prefijo = $2 AND revocada IS NULL FOR UPDATE', [tx.tenant, prefijo])).rows[0];
        if (!objetivo) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Llave no encontrada o ya revocada.');
        if (objetivo.rol === 'admin') {
          const admins = await tx.consulta("SELECT 1 FROM api_llaves WHERE tenant = $1 AND rol = 'admin' AND revocada IS NULL FOR UPDATE", [tx.tenant]);
          if ((admins.rowCount ?? 0) <= 1) throw new ErrorApi(409, 'ULTIMA_LLAVE_ADMIN', 'No se puede revocar la única llave admin activa.');
        }
        const r = await tx.consulta<FilaLlave>(
          'UPDATE api_llaves SET revocada = now() WHERE tenant = $1 AND prefijo = $2 RETURNING id, prefijo, nombre, rol, establecimiento, punto_emision, creada, revocada, ultimo_uso',
          [tx.tenant, prefijo],
        );
        await bitacora(tx, actor(c), 'llave.revocada', { prefijo });
        return r.rows[0]!;
      });
      return c.json({ llave: aLlave(fila) }, 200);
    },
  );

  // --- Webhooks --------------------------------------------------------------------------------------------
  type FilaWebhook = { id: string; url: string; eventos: string[]; activo: boolean; creado: Date };
  const aWebhook = (f: FilaWebhook) => ({ id: f.id, url: f.url, eventos: f.eventos, activo: f.activo, creado: f.creado.toISOString() });
  app.openapi(
    createRoute({
      method: 'post', path: '/v1/webhooks', tags: ['Webhooks'], security: seguridad,
      summary: 'Suscribe una URL a eventos (el secreto de firma se muestra solo esta vez)',
      request: { body: { content: { 'application/json': { schema: S.WebhookNuevo } }, required: true } },
      responses: { 201: json(S.RespuestaWebhookNuevo, 'Creado'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const b = c.req.valid('json');
      const problema = problemaDeURL(b.url, cfg.modo === 'local');
      if (problema) throw new ErrorApi(422, 'WEBHOOK_URL', problema);
      const secreto = `whsec_${randomBytes(24).toString('base64url')}`;
      const fila = await enTenant(c, async (tx) => {
        const r = await tx.consulta<FilaWebhook>(
          'INSERT INTO api_webhooks (tenant, url, secreto, eventos) VALUES ($1, $2, $3, $4) RETURNING id, url, eventos, activo, creado',
          [tx.tenant, b.url, cofre.guardar(secreto), [...new Set(b.eventos)]],
        );
        await bitacora(tx, actor(c), 'webhook.creado', { id: r.rows[0]!.id, url: b.url, eventos: b.eventos });
        return r.rows[0]!;
      });
      return c.json({ webhook: aWebhook(fila), secreto }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get', path: '/v1/webhooks', tags: ['Webhooks'], security: seguridad, summary: 'Webhooks del tenant',
      responses: { 200: json(S.pagina('webhooks', S.Webhook), 'Lista'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const filas = await enTenant(c, async (tx) =>
        (await tx.consulta<FilaWebhook>('SELECT id, url, eventos, activo, creado FROM api_webhooks WHERE tenant = $1 ORDER BY creado', [tx.tenant])).rows,
      );
      return c.json({ webhooks: filas.map(aWebhook), hayMas: false, siguiente: null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete', path: '/v1/webhooks/{id}', tags: ['Webhooks'], security: seguridad, summary: 'Desactiva un webhook',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: json(S.RespuestaWebhook, 'Desactivado'), 404: json(S.ErrorRespuesta, 'No existe'), ...respuestasError },
    }),
    async (c) => {
      exigirAdmin(c);
      const { id } = c.req.valid('param');
      const fila = await enTenant(c, async (tx) => {
        const r = await tx.consulta<FilaWebhook>('UPDATE api_webhooks SET activo = false WHERE tenant = $1 AND id = $2 RETURNING id, url, eventos, activo, creado', [tx.tenant, id]);
        if (!r.rows[0]) throw new ErrorApi(404, 'NO_ENCONTRADO', 'Webhook no encontrado.');
        await bitacora(tx, actor(c), 'webhook.desactivado', { id });
        return r.rows[0];
      });
      return c.json({ webhook: aWebhook(fila) }, 200);
    },
  );

  // --- Documentación ---------------------------------------------------------------------------------------
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'factura-hn API',
      version: VERSION_API,
      description: [
        'Facturación para Honduras según el Reglamento del Régimen de Facturación del SAR (Acuerdo 481-2017). Proyecto independiente, no afiliado al SAR. Fechas en America/Tegucigalpa.',
        '',
        'Montos (DEC-048): en la entrada, texto decimal (`"57.50"`, recomendado) o número. En la salida, número en lempiras con a lo sumo 2 decimales, calculado en centavos enteros: `Math.round(monto * 100)` da los centavos exactos. Para sumar montos, pásalos antes a centavos.',
        '',
        'Respuestas (DEC-047): cada recurso va envuelto con su nombre (`{ documento }`, `{ emisor }`, `{ llave, secreto }`…). Cada lista es `{ <plural>, hayMas, siguiente }`: si `hayMas`, pide la página siguiente con `?cursor=<siguiente>` (`limite` de 1 a 500, 100 por defecto).',
        '',
        'Reglas para integrar (también en AGENTS.md, sección «Con la API REST»):',
        '1. La llave va solo en el servidor. Usa una llave de caja, atada a su punto de emisión.',
        '2. `POST /v1/documentos` lleva una Idempotency-Key estable por venta (el id del pedido o de la venta, nunca un valor nuevo por intento): un reintento devuelve la misma factura.',
        '3. 422 = reglas fiscales: muestra `errores[].mensaje` tal cual. Un 422 no consume número ni la clave: corrige y reintenta con la misma.',
        '4. Guarda el número y reimprime desde `/v1/documentos/{numero}.pdf|.html|.txt`; no recalcules.',
        '5. Webhooks: verifica `X-FacturaHN-Firma` (t=<unix>,v1=hex HMAC-SHA256(secreto, "<t>.<cuerpo crudo>"), 5 min de tolerancia), descarta repetidos por `id` y responde 2xx solo cuando procesaste el aviso.',
      ].join('\n'),
    },
  });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));
  app.get('/', (c) => c.redirect('/docs'));

  return app;
}
