/**
 * Fuzzing de la API: solicitudes generadas (cuerpos, parámetros de ruta y de consulta, cabeceras y cursores) contra
 * todas las operaciones de `openapi.json`, con llaves admin, de caja, ajenas o ninguna. La API nunca responde 500, y
 * cada respuesta cumple el contrato (lo valida `setup-contrato.ts`: una respuesta fuera de la especificación hace
 * fallar la solicitud).
 *
 * `FHN_FUZZ_CASOS` fija los casos (300 en el CI; el flujo nocturno sube a 20 000) y `FHN_PROP_SEMILLA` la semilla (fija por omisión).
 */
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cerrarPool, cliente, crearCaja, EMISOR, FECHA_LIMITE, tenantListo, URL_PG, venta, type Cliente } from './ayuda';
import { conCaracterDeControl, desdeEsquema, mutar, type Pistas } from './fuzz-esquema';
import { SPEC } from './openapi-validador';

const CASOS = Math.max(1, Number(process.env.FHN_FUZZ_CASOS ?? 300));
// Semilla fija por omisión: el CI corre siempre los mismos casos y sus umbrales de cobertura no dependen de la suerte.
// El flujo nocturno pasa una semilla nueva en cada corrida (FHN_PROP_SEMILLA) para explorar otros casos.
const SEMILLA = Number(process.env.FHN_PROP_SEMILLA ?? 20261125);
const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

type Metodo = 'get' | 'post' | 'patch' | 'delete';
interface Parametro { name: string; in: 'path' | 'query' | 'header'; required?: boolean; schema: Record<string, unknown> }
interface Operacion { ruta: string; metodo: Metodo; parametros: Parametro[]; cuerpo: Record<string, unknown> | null }

const OPERACIONES: Operacion[] = Object.entries(SPEC.paths).flatMap(([ruta, item]) =>
  Object.entries(item as Record<string, { parameters?: Parametro[]; requestBody?: { content: Record<string, { schema: Record<string, unknown> }> } }>).map(([metodo, op]) => ({
    ruta,
    metodo: metodo as Metodo,
    parametros: op.parameters ?? [],
    cuerpo: op.requestBody?.content['application/json']?.schema ?? null,
  })),
);

/** Contexto real del tenant: ids que existen, para que una parte de los casos pase la forma y llegue a la base. */
interface Contexto { cai: string; caiFactura: string; numero: string; emisorId: string; prefijo: string; webhookId: string; entregaId: string; cursorDocs: string; cursorBitacora: string }

const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const fechaRara = fc.oneof(
  fc.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  fc.constantFrom('2026-11-18', '2026-02-30', '0000-00-00', '9999-12-31', '1970-01-01', '2026-13-01', '+275760-09-13'),
  fc.date({ noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
);
const textoRuta = fc.oneof(
  fc.string({ maxLength: 40 }).map(encodeURIComponent),
  fc.constantFrom('%', '%zz', '%00', '..', '%2e%2e', '%2F', 'null', '0', '-1', '9'.repeat(30), 'a'.repeat(300), '000-001-01', '000-001-01-00000001.pdf', '000-001-01-00000001.html', '000-001-01-99999999'),
  fc.stringMatching(/^\d{3}-\d{3}-\d{2}(-\d{8})?(\.(pdf|html|txt|json))?$/),
  fc.uuid(),
);

function arbitrarioDeCursor(ctx: Contexto): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant(ctx.cursorDocs),
    fc.constant(ctx.cursorBitacora),
    fc.string({ maxLength: 60 }),
    fc.base64String({ maxLength: 60 }),
    fc.jsonValue({ maxDepth: 2 }).map(b64),
    fc.tuple(fechaRara, fc.oneof(fc.string({ maxLength: 50 }), fc.constant(ctx.numero))).map(b64),
    fc.tuple(fc.oneof(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }).map(String), fc.string({ maxLength: 25 })), fc.oneof(fc.uuid(), fc.string({ maxLength: 40 }))).map(b64),
    fc.oneof(fc.bigInt({ min: -(10n ** 25n), max: 10n ** 25n }).map(String), fc.stringMatching(/^\d{1,25}$/)).map(b64),
  ).map((c) => c.slice(0, 250));
}

function arbitrarioDeParametro(p: Parametro, ctx: Contexto, sano: boolean): fc.Arbitrary<string | undefined> {
  const real: Record<string, string[]> = {
    cai: [ctx.cai], archivo: [ctx.numero, `${ctx.numero}.pdf`, `${ctx.numero}.html`, `${ctx.numero}.txt`], numero: [ctx.numero],
    identificador: [ctx.numero.slice(0, 10)], id: [ctx.emisorId, ctx.webhookId], prefijo: [ctx.prefijo], entrega: [ctx.entregaId],
    desde: ['2026-01-01'], hasta: [new Date().toISOString().slice(0, 10)],
  };
  const deEsquema = desdeEsquema(p.schema).map((v) => String(v));
  if (sano) {
    // Valores reales o con la forma del esquema: el caso pasa la validación de forma y llega a la base.
    const valor = real[p.name] ? fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...real[p.name]!) }, { weight: 1, arbitrary: deEsquema }) : deEsquema;
    return p.in === 'path' || p.required ? valor : fc.option(valor, { nil: undefined, freq: 2 });
  }
  const opciones: Array<fc.Arbitrary<string>> = [deEsquema, p.in === 'path' ? textoRuta : fc.string({ maxLength: 40 })];
  if (real[p.name]) opciones.push(fc.constantFrom(...real[p.name]!));
  if (p.name === 'cursor') opciones.push(arbitrarioDeCursor(ctx));
  if (p.name === 'desde' || p.name === 'hasta') opciones.push(fechaRara);
  if (p.name === 'limite') opciones.push(fc.constantFrom('0', '-1', '1.5', '1e3', '501', '99999999999999999999', ''));
  const valor = fc.oneof(...opciones);
  return p.in === 'path' ? valor : fc.option(valor, { nil: undefined, freq: 4 });
}

/** Montos con forma decimal (y algunos que no): para que los cuerpos válidos lleguen a las reglas del núcleo. */
const monto = fc.oneof(
  fc.tuple(fc.integer({ min: 0, max: 99_999 }), fc.integer({ min: 0, max: 99 })).map(([e, c]) => `${e}.${String(c).padStart(2, '0')}`),
  fc.constantFrom('1', '0', '0.0001', '1,234.50', '89,50', '-1', '1e2', '1e400', '99999999999999999999', '9999999999999.99', ' 5 ', ''),
  fc.double({ noNaN: true }),
  fc.integer(),
);

/** Montos que el núcleo acepta casi siempre: el modo sano llega a las reglas fiscales y emite. */
const montoSano = fc.oneof(
  fc.tuple(fc.integer({ min: 0, max: 9_999 }), fc.integer({ min: 0, max: 99 })).map(([e, c]) => `${e}.${String(c).padStart(2, '0')}`),
  fc.integer({ min: 1, max: 1000 }),
  fc.constantFrom('9999999999999.99', '99999999999999', '0.005', '1e2'),
);

/** Una venta casi siempre válida (factura, a veces nota de crédito sobre una factura real): llega a emitir. */
function documentoSano(ctx: Contexto): fc.Arbitrary<unknown> {
  const hoy = new Date().toISOString().slice(0, 10);
  const linea = fc.record(
    {
      descripcion: fc.constantFrom('Martillo', 'Clavos de 2 pulgadas', 'Servicio de instalación'),
      cantidad: fc.oneof(fc.integer({ min: 1, max: 20 }), fc.constantFrom('0.5', '1.25', '3')),
      precioUnitario: montoSano,
      isv: fc.constantFrom('ISV15', 'ISV15', 'ISV18', 'EXENTO', 'GRAVADO0'),
      descuento: fc.constantFrom('0', '0.01', '1.00'),
    },
    { requiredKeys: ['descripcion', 'cantidad', 'precioUnitario'] },
  );
  const factura = fc.record(
    {
      lineas: fc.array(linea, { minLength: 1, maxLength: 5 }),
      preciosIncluyenISV: fc.boolean(),
      cliente: fc.constantFrom({ nombre: 'Cliente Ejemplo', rtn: '99990000000002' }, { nombre: 'Consumidor', identificacion: { tipo: 'DNI', numero: '9999000000001' } }),
      exoneracion: fc.constant({ registroSAG: 'SAG-0001' }),
      moneda: fc.constantFrom('HNL', 'USD'),
      tipoCambio: fc.constantFrom('24.6500', '25'),
      condicionPago: fc.constantFrom('CONTADO', 'CREDITO'),
    },
    { requiredKeys: ['lineas'] },
  );
  const nota = fc.record({
    tipoDocumento: fc.constant('06'),
    lineas: fc.array(linea, { minLength: 1, maxLength: 2 }),
    cliente: fc.constant({ nombre: 'Cliente Ejemplo', rtn: '99990000000001' }),
    referencia: fc.constant({ cai: ctx.caiFactura, numero: ctx.numero, fecha: hoy }),
    motivo: fc.constant('Devolución de 1 unidad'),
  });
  return fc.oneof({ weight: 4, arbitrary: factura }, { weight: 1, arbitrary: nota });
}

function pistas(ctx: Contexto, sano = false): Pistas {
  if (sano) {
    return {
      ...pistas(ctx),
      cantidad: montoSano, precioUnitario: montoSano, descuento: fc.constantFrom('0', '0.50', '1.00', '1000000'), tipoCambio: fc.constantFrom('24.6500', '0', '-1', 'x'),
      establecimiento: fc.constant('000'), puntoEmision: fc.constantFrom('001', '001', '002'),
      tipoDocumento: fc.constantFrom('01', '01', '01', '06', '07'),
      descripcion: fc.constantFrom('Martillo', 'Clavos 2"', 'Servicio de instalación'),
      fechaEmision: fc.constant(new Date().toISOString().slice(0, 10)),
      rtn: fc.constantFrom('99990000000001', '99990000000002'),
      cai: fc.constant(ctx.cai),
      operador: fc.constantFrom('María López', 'Caja 1'),
      url: fc.constantFrom('http://127.0.0.1:9/hook', 'https://receptor.ejemplo.example/webhook'),
      documento: documentoSano(ctx),
    };
  }
  return {
    cantidad: monto, precioUnitario: monto, descuento: monto, tipoCambio: monto,
    establecimiento: fc.constantFrom('000', '000', '001', '999'),
    puntoEmision: fc.constantFrom('001', '001', '002', '000'),
    rtn: fc.constantFrom('99990000000001', '9999-0000-000002', '1', ''),
    fechaEmision: fc.constantFrom(new Date().toISOString().slice(0, 10), '2026-11-18', '2000-01-01'),
    cai: fc.constantFrom(ctx.cai, 'DEMO00-NO-VALIDO-000000-000000-00', 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', 'X Y'),
    numero: fc.constantFrom(ctx.numero, '000-001-01-00000001', '000-001-06-00000001', '1'),
    fecha: fechaRara,
    fechaLimiteEmision: fc.constantFrom(FECHA_LIMITE, '2020-01-01', '2026-02-30'),
    descripcion: fc.constantFrom('Martillo', '', ' ', 'Línea\u0007', 'Clavos 2"'),
    correo: fc.constantFrom(EMISOR.correo, 'no-es-correo', ''),
  };
}

const cuerpoCrudo = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.constantFrom('{', '{"documento":', 'null', '[]', '"texto"', '{"__proto__":{"x":1}}', '{"a":1,"a":2}'),
  fc.uint8Array({ maxLength: 40 }),
  fc.constant(new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xe9, 0x22, 0x7d])), // {"a":"é"} en Latin-1
);

const valorCabecera = fc.string({ unit: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)), maxLength: 60 });

interface Caso {
  op: Operacion;
  ruta: string;
  llave: 'admin' | 'caja' | 'otraCaja' | 'ninguna' | 'basura';
  cuerpo: { tipo: 'json'; valor: unknown } | { tipo: 'crudo'; valor: string | Uint8Array } | null;
  cabeceras: Record<string, string>;
}

/**
 * Un caso: con `sano`, llave admin o de caja, cabeceras correctas y cuerpo con la forma del esquema (llega a las
 * reglas del núcleo y a la base); sin él, todo puede ser hostil (llaves ajenas o rotas, cabeceras, rutas, JSON roto).
 */
function arbitrarioDeCaso(ctx: Contexto, sano: boolean): fc.Arbitrary<Caso> {
  // La emisión es la operación que más importa: en el modo sano va en un tercio de los casos.
  const emitir = OPERACIONES.find((o) => o.metodo === 'post' && o.ruta === '/v1/documentos')!;
  const operacion = sano ? fc.oneof({ weight: 1, arbitrary: fc.constant(emitir) }, { weight: 2, arbitrary: fc.constantFrom(...OPERACIONES) }) : fc.constantFrom(...OPERACIONES);
  return operacion.chain((op): fc.Arbitrary<Caso> => {
    const params = Object.fromEntries(op.parametros.filter((p) => p.in !== 'header').map((p) => [`${p.in}:${p.name}`, arbitrarioDeParametro(p, ctx, sano)]));
    const deEsquema = op.cuerpo ? desdeEsquema(op.cuerpo, pistas(ctx, sano)) : fc.constant(undefined);
    if (sano) {
      return fc.record({
        params: fc.record(params),
        llave: fc.constantFrom('admin', 'caja') as fc.Arbitrary<Caso['llave']>,
        cuerpo: op.cuerpo
          ? fc.oneof({ weight: 8, arbitrary: deEsquema }, { weight: 2, arbitrary: deEsquema.chain(mutar) }, { weight: 1, arbitrary: deEsquema.chain(conCaracterDeControl) }).map((valor) => ({ tipo: 'json' as const, valor }))
          : fc.constant(null),
        clave: fc.oneof({ weight: 9, arbitrary: fc.uuid() }, { weight: 1, arbitrary: fc.constant('clave-repetida-fuzz') }),
      }).map(({ params, llave, cuerpo, clave }): Caso => ({
        op, ruta: armarRuta(op, params), llave, cuerpo: cuerpo as Caso['cuerpo'],
        cabeceras: { 'content-type': 'application/json', 'idempotency-key': clave },
      }));
    }
    const cuerpo: fc.Arbitrary<Caso['cuerpo']> = op.cuerpo
      ? fc.oneof(
          { weight: 4, arbitrary: deEsquema.map((valor) => ({ tipo: 'json' as const, valor })) },
          { weight: 3, arbitrary: deEsquema.chain(mutar).map((valor) => ({ tipo: 'json' as const, valor })) },
          { weight: 1, arbitrary: deEsquema.chain(conCaracterDeControl).map((valor) => ({ tipo: 'json' as const, valor })) },
          { weight: 1, arbitrary: fc.jsonValue({ maxDepth: 3 }).map((valor) => ({ tipo: 'json' as const, valor })) },
          { weight: 1, arbitrary: cuerpoCrudo.map((valor) => ({ tipo: 'crudo' as const, valor })) },
        )
      : fc.oneof({ weight: 6, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: cuerpoCrudo.map((valor) => ({ tipo: 'crudo' as const, valor })) });
    const cabeceras = fc.record(
      {
        'idempotency-key': fc.oneof(fc.uuid(), fc.constant('clave-repetida-fuzz'), valorCabecera),
        'x-operador': fc.oneof(fc.constant('Caja%201'), fc.constant('%E0%A4%A'), valorCabecera),
        'solicitud-id': valorCabecera,
        'content-type': fc.constantFrom('application/json', 'text/plain', 'application/json; charset=latin1', ''),
        accept: fc.constantFrom('application/pdf', 'text/html', '*/*', 'application/json'),
      },
      { requiredKeys: [] },
    );
    return fc.record({
      op: fc.constant(op),
      params: fc.record(params),
      llave: fc.constantFrom('admin', 'admin', 'caja', 'caja', 'otraCaja', 'ninguna', 'basura') as fc.Arbitrary<Caso['llave']>,
      cuerpo,
      cabeceras,
    }).map(({ op, params, llave, cuerpo, cabeceras }): Caso => ({ op, ruta: armarRuta(op, params), llave, cuerpo, cabeceras }));
  });
}

function armarRuta(op: Operacion, params: Record<string, string | undefined>): string {
  let ruta = op.ruta;
  const consulta = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const [donde, nombre] = k.split(':') as ['path' | 'query', string];
    if (donde === 'path') ruta = ruta.replace(`{${nombre}}`, v ?? 'x');
    else if (v !== undefined) consulta.set(nombre, v);
  }
  const q = consulta.toString();
  return q ? `${ruta}?${q}` : ruta;
}

conBase('fuzzing de la API', () => {
  let llaves: Record<Caso['llave'], string | null>;
  let app: Awaited<ReturnType<typeof tenantListo>>['app'];
  let ctx: Contexto;
  let admin: Cliente;
  const estados = new Map<string, number>();
  const codigos = new Map<string, number>();

  beforeAll(async () => {
    const t = await tenantListo({ limiteSolicitudes: { porSegundo: 100_000, rafaga: 100_000 }, limiteIntentos: { porSegundo: 100_000, rafaga: 100_000 } }, { cajas: ['001', '002'], rangoFinal: 99_999 });
    app = t.app;
    const caja = await crearCaja(t.admin, '001');
    llaves = { admin: t.llaveAdmin, caja, otraCaja: await crearCaja(t.admin, '002'), ninguna: null, basura: 'fhn_live_abcdefgh_0123456789abcdef0123456789abcdef' };
    const c: Cliente = cliente(app, caja);
    const docs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await c('POST', '/v1/documentos', venta(`${10 + i}.00`), { 'idempotency-key': randomUUID() });
      docs.push(((await r.json()) as { documento: { numero: string } }).documento.numero);
    }
    const auts = (await (await t.admin('GET', '/v1/autorizaciones')).json()) as { autorizaciones: Array<{ cai: string; tipoDocumento: string; puntoEmision: string }> };
    // Una llave de sacrificio para DELETE /v1/llaves/{prefijo}: el fuzz no debe revocar las llaves con las que trabaja.
    const sacrificio = (await (await t.admin('POST', '/v1/llaves', { nombre: 'sacrificio', rol: 'caja', establecimiento: '000', puntoEmision: '001' })).json()) as { llave: { prefijo: string } };
    admin = t.admin;
    const wh = (await (await t.admin('POST', '/v1/webhooks', { url: 'http://127.0.0.1:9/hook', eventos: ['documento.emitido'] })).json()) as { webhook: { id: string } };
    await c('POST', '/v1/documentos', venta('5.00'), { 'idempotency-key': randomUUID() });
    const entregas = (await (await t.admin('GET', `/v1/webhooks/${wh.webhook.id}/entregas`)).json()) as { entregas: Array<{ id: string }> };
    const hoy = new Date().toISOString().slice(0, 10);
    const pagDocs = (await (await t.admin('GET', `/v1/documentos?desde=2026-01-01&hasta=${hoy}&limite=1`)).json()) as { siguiente: string };
    const pagBit = (await (await t.admin('GET', '/v1/bitacora?limite=1')).json()) as { siguiente: string };
    ctx = {
      cai: auts.autorizaciones[0]!.cai, caiFactura: auts.autorizaciones.find((a) => a.tipoDocumento === '01' && a.puntoEmision === '001')!.cai, numero: docs[0]!, emisorId: t.emisorId, prefijo: sacrificio.llave.prefijo,
      webhookId: wh.webhook.id, entregaId: entregas.entregas[0]?.id ?? randomUUID(), cursorDocs: pagDocs.siguiente, cursorBitacora: pagBit.siguiente,
    };
  });

  async function enviar(caso: Caso): Promise<Response> {
    const cabeceras: Record<string, string> = { ...caso.cabeceras };
    const llave = llaves[caso.llave];
    if (llave) cabeceras.authorization = `Bearer ${llave}`;
    // fetch no permite cuerpo en un GET: ahí el cuerpo generado se descarta.
    const conCuerpo = caso.op.metodo !== 'get' ? caso.cuerpo : null;
    if (!conCuerpo) delete cabeceras['content-type'];
    else if (cabeceras['content-type'] === undefined) cabeceras['content-type'] = 'application/json';
    const body = !conCuerpo ? undefined : conCuerpo.tipo === 'json' ? JSON.stringify(conCuerpo.valor ?? null) : conCuerpo.valor;
    return app.request(caso.ruta, { method: caso.op.metodo.toUpperCase(), headers: cabeceras, body: body as BodyInit | undefined });
  }

  it(`${CASOS} solicitudes generadas: ninguna da 500 y todas cumplen el contrato OpenAPI`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(arbitrarioDeCaso(ctx, true), arbitrarioDeCaso(ctx, false)), async (caso) => {
        // Una respuesta fuera del contrato rechaza la promesa (setup-contrato.ts) y el caso falla con su descripción.
        const r = await enviar(caso);
        const texto = await r.text(); // los reportes se transmiten: leerlos libera la conexión
        // Un PATCH aceptado pudo dejar al emisor con datos que el núcleo rechaza: se restaura para que las emisiones
        // siguientes lleguen a las reglas de la venta y no se queden en las del emisor.
        if (caso.op.metodo === 'patch' && r.status === 200) await admin('PATCH', `/v1/emisores/${ctx.emisorId}`, EMISOR);
        const clave = `${caso.op.metodo.toUpperCase()} ${caso.op.ruta} ${r.status}`;
        estados.set(clave, (estados.get(clave) ?? 0) + 1);
        if (r.status >= 400) {
          let codigo = '?';
          try {
            codigo = (JSON.parse(texto) as { error: { codigo: string } }).error.codigo;
          } catch { /* sin cuerpo JSON */ }
          const c = `${clave} ${codigo}`;
          codigos.set(c, (codigos.get(c) ?? 0) + 1);
        }
        expect(r.status, `${caso.op.metodo.toUpperCase()} ${caso.ruta}`).not.toBe(500);
      }),
      { numRuns: CASOS, seed: SEMILLA },
    );
    if (process.env.FHN_FUZZ_RESUMEN) {
      console.log(`RESUMEN DEL FUZZ\n${[...estados, ...codigos].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${n}\t${k}`).join('\n')}`);
    }
    // Cobertura: el fuzz llega a todas las operaciones y no se queda solo en 400 y 401.
    const operaciones = new Set([...estados.keys()].map((k) => k.split(' ').slice(0, 2).join(' ')));
    if (CASOS >= 300) expect(operaciones.size).toBe(OPERACIONES.length);
    const exitos = [...estados.entries()].filter(([k]) => /\s2\d\d$/.test(k)).reduce((s, [, n]) => s + n, 0);
    if (CASOS >= 300) expect(exitos).toBeGreaterThan(CASOS * 0.15);
    // Y a las reglas fiscales: emisiones aceptadas (201) y rechazadas por el núcleo (422).
    if (CASOS >= 300) for (const e of ['201', '422']) expect(estados.get(`POST /v1/documentos ${e}`) ?? 0, `POST /v1/documentos ${e}`).toBeGreaterThan(0);
  }, Math.max(120_000, CASOS * 200));
});
