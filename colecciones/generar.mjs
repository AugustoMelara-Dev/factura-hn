#!/usr/bin/env node
/**
 * Genera las colecciones de Bruno (`bruno/`) y de Postman (`postman/`) desde `packages/api/openapi.json`.
 *
 *   pnpm colecciones            (desde la raíz; o `pnpm --filter @factura-hn/colecciones generar`)
 *
 * Las dos salen del mismo modelo: una carpeta por etiqueta del OpenAPI, una solicitud por operación (archivo
 * `<operationId>.bru`), y antes de todo la carpeta «Primera factura» (sesión, emitir y PDF) con sus pruebas. Las
 * dos traen el entorno `demo` (URL local y la llave de caja como secreto) y el mismo script previo, que pone una
 * `Idempotency-Key` nueva en cada solicitud.
 *
 * La salida es reproducible: sin fechas, sin ids aleatorios y en el orden del OpenAPI. La CI la regenera y falla
 * si no coincide con la versionada. No edites a mano lo que hay en bruno/ y postman/: cambia este script, los
 * ejemplos (ejemplos.mjs) o la especificación, y vuelve a generar.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUERPOS, PARAMETROS_RUTA } from './ejemplos.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const spec = JSON.parse(readFileSync(join(raiz, 'packages', 'api', 'openapi.json'), 'utf8'));
const facturaEjemplo = JSON.parse(readFileSync(join(raiz, 'packages', 'api', 'ejemplos', 'factura.json'), 'utf8'));

const NOMBRE = 'factura-hn';
const URL_DEMO = 'http://127.0.0.1:8787';
const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

// ── Modelo común ──────────────────────────────────────────────────────────────────────────────────────────────

/** Resuelve un `$ref` local (`#/components/...`). */
function resolver(esquema) {
  let e = esquema;
  while (e && e.$ref) e = e.$ref.slice(2).split('/').reduce((o, k) => o[k], spec);
  return e ?? {};
}

/** Un valor de ejemplo para un esquema: su `example`, `default`, primer `enum`, o un esqueleto de lo obligatorio. */
function ejemploDe(esquemaOriginal) {
  const e = resolver(esquemaOriginal);
  if (e.example !== undefined) return e.example;
  if (e.default !== undefined) return e.default;
  if (e.const !== undefined) return e.const;
  if (Array.isArray(e.enum)) return e.enum[0];
  if (e.anyOf || e.oneOf) return ejemploDe((e.anyOf ?? e.oneOf).find((x) => resolver(x).type !== 'null'));
  const tipo = Array.isArray(e.type) ? e.type.find((t) => t !== 'null') : e.type;
  switch (tipo) {
    case 'object': {
      const r = {};
      for (const k of e.required ?? []) r[k] = ejemploDe(e.properties?.[k] ?? {});
      return r;
    }
    case 'array':
      return e.minItems ? [ejemploDe(e.items ?? {})] : [];
    case 'integer':
    case 'number':
      return e.minimum ?? 0;
    case 'boolean':
      return false;
    default:
      return '';
  }
}

/** Una línea de texto plano (sin saltos), para nombres y descripciones cortas. */
const unaLinea = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Nombre de carpeta: el de la etiqueta en minúsculas, sin tildes ni espacios. */
const carpetaDe = (etiqueta) =>
  etiqueta.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Las operaciones del OpenAPI, agrupadas por etiqueta en el orden en que aparecen. */
function operaciones() {
  const grupos = new Map();
  for (const [ruta, item] of Object.entries(spec.paths)) {
    for (const metodo of METODOS) {
      const op = item[metodo];
      if (!op) continue;
      if (!op.operationId) throw new Error(`${metodo.toUpperCase()} ${ruta} no tiene operationId`);
      const etiqueta = op.tags?.[0] ?? 'Otras';
      if (!grupos.has(etiqueta)) grupos.set(etiqueta, []);
      const parametros = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(resolver);
      const deRuta = parametros.filter((p) => p.in === 'path').map((p) => ({
        nombre: p.name,
        valor: String(p.schema?.example ?? p.example ?? PARAMETROS_RUTA[p.name] ?? ''),
        descripcion: unaLinea(p.description ?? p.schema?.description),
      }));
      const deConsulta = parametros.filter((p) => p.in === 'query').map((p) => ({
        nombre: p.name,
        valor: String(ejemploDe(p.schema ?? {})),
        activo: Boolean(p.required),
        descripcion: unaLinea(p.description ?? p.schema?.description),
      }));
      const cabeceras = [];
      for (const p of parametros.filter((x) => x.in === 'header')) {
        // La Idempotency-Key la pone el script previo de la colección.
        if (p.name.toLowerCase() === 'idempotency-key') cabeceras.push({ nombre: 'Idempotency-Key', valor: '{{idempotencyKey}}' });
        else if (p.required) cabeceras.push({ nombre: p.name, valor: String(ejemploDe(p.schema ?? {})) });
      }
      const esquemaCuerpo = op.requestBody?.content?.['application/json']?.schema;
      let cuerpo;
      if (esquemaCuerpo) {
        cuerpo = op.operationId === 'emitirDocumento' ? facturaEjemplo : CUERPOS[op.operationId] ?? ejemploDe(esquemaCuerpo);
      }
      grupos.get(etiqueta).push({
        id: op.operationId,
        nombre: unaLinea(op.summary ?? op.operationId),
        metodo,
        ruta: ruta.replace(/\{([^}]+)\}/g, ':$1'),
        deRuta,
        deConsulta,
        cabeceras,
        cuerpo,
        sinAuth: Array.isArray(op.security) && op.security.length === 0,
        docs: [op.summary, op.description].filter(Boolean).join('\n\n'),
      });
    }
  }
  return grupos;
}

// La carpeta «Primera factura»: los tres pasos de docs/api.md, con pruebas. Los scripts van en el dialecto de cada
// herramienta (bru/res en Bruno, pm en Postman).
const PRIMERA = {
  carpeta: 'primera-factura',
  nombre: 'Primera factura',
  docs: 'Los tres pasos de la primera factura, en el tenant `demo` (CAI ficticio, sin validez fiscal): qué puede hacer la llave, emitir y descargar el PDF. Cada envío de «Emitir» lleva una Idempotency-Key nueva y emite otra factura de prueba.',
  pasos: [
    {
      id: 'sesion',
      nombre: 'Sesión: qué falta para emitir',
      metodo: 'get',
      url: '{{baseUrl}}/v1/sesion',
      docs: 'Con qué llave hablas y si ya puedes emitir. Si `puedeEmitir` es `false`, `pendientes` dice qué falta.',
      pruebas: {
        bruno: [
          'test("la API responde 200", function () {',
          '  expect(res.status).to.equal(200);',
          '});',
          '',
          'test("la llave ya puede emitir", function () {',
          '  expect(res.body.sesion.puedeEmitir, JSON.stringify(res.body.sesion.pendientes)).to.equal(true);',
          '});',
          '',
          'test("el tenant es de prueba", function () {',
          '  expect(res.body.sesion.modoTenant).to.equal("prueba");',
          '});',
        ],
        postman: [
          'pm.test("la API responde 200", function () {',
          '  pm.response.to.have.status(200);',
          '});',
          '',
          'pm.test("la llave ya puede emitir", function () {',
          '  const sesion = pm.response.json().sesion;',
          '  pm.expect(sesion.puedeEmitir, JSON.stringify(sesion.pendientes)).to.equal(true);',
          '});',
          '',
          'pm.test("el tenant es de prueba", function () {',
          '  pm.expect(pm.response.json().sesion.modoTenant).to.equal("prueba");',
          '});',
        ],
      },
    },
    {
      id: 'emitir',
      nombre: 'Emitir la factura',
      metodo: 'post',
      url: '{{baseUrl}}/v1/documentos',
      cabeceras: [{ nombre: 'Idempotency-Key', valor: '{{idempotencyKey}}' }],
      cuerpo: facturaEjemplo,
      docs: 'Emite la factura de `packages/api/ejemplos/factura.json`. La Idempotency-Key la pone el script previo de la colección (una nueva por envío). En tu sistema, la clave es el id de la venta: un reintento con la misma clave devuelve la misma factura.',
      despues: {
        bruno: [
          'if (res.status === 201) {',
          '  bru.setVar("numero", res.body.documento.numero);',
          '  bru.setVar("enlacePdf", res.body.enlaces.pdf);',
          '}',
        ],
        postman: [
          'if (pm.response.code === 201) {',
          '  const r = pm.response.json();',
          '  pm.collectionVariables.set("numero", r.documento.numero);',
          '  pm.collectionVariables.set("enlacePdf", r.enlaces.pdf);',
          '}',
        ],
      },
      pruebas: {
        bruno: [
          'test("emite la factura (201)", function () {',
          '  expect(res.status, JSON.stringify(res.body)).to.equal(201);',
          '});',
          '',
          'test("el documento es de prueba", function () {',
          '  expect(res.body.documento.modo).to.equal("prueba");',
          '});',
          '',
          'test("trae número y enlace al PDF", function () {',
          '  expect(res.body.documento.numero).to.match(/^\\d{3}-\\d{3}-01-\\d{8}$/);',
          '  expect(res.body.enlaces.pdf).to.match(/\\.pdf$/);',
          '});',
        ],
        postman: [
          'pm.test("emite la factura (201)", function () {',
          '  pm.expect(pm.response.code, pm.response.text()).to.equal(201);',
          '});',
          '',
          'pm.test("el documento es de prueba", function () {',
          '  pm.expect(pm.response.json().documento.modo).to.equal("prueba");',
          '});',
          '',
          'pm.test("trae número y enlace al PDF", function () {',
          '  const r = pm.response.json();',
          '  pm.expect(r.documento.numero).to.match(/^\\d{3}-\\d{3}-01-\\d{8}$/);',
          '  pm.expect(r.enlaces.pdf).to.match(/\\.pdf$/);',
          '});',
        ],
      },
    },
    {
      id: 'pdf',
      nombre: 'Descargar el PDF',
      metodo: 'get',
      url: '{{baseUrl}}{{enlacePdf}}',
      docs: 'El PDF de la factura que acabas de emitir, del enlace `enlaces.pdf` de la respuesta (con la misma llave).',
      pruebas: {
        bruno: [
          'test("descarga el PDF", function () {',
          '  expect(res.status).to.equal(200);',
          '  expect(res.headers["content-type"]).to.contain("application/pdf");',
          '});',
        ],
        postman: [
          'pm.test("descarga el PDF", function () {',
          '  pm.response.to.have.status(200);',
          '  pm.expect(pm.response.headers.get("Content-Type")).to.include("application/pdf");',
          '});',
        ],
      },
    },
  ],
};

/** El script previo de la colección: una Idempotency-Key nueva por solicitud. */
const SCRIPT_PREVIO = {
  bruno: [
    '// Una Idempotency-Key nueva en cada solicitud: cada envío de «Emitir» es otra venta y emite otra factura.',
    '// En tu sistema la clave es estable por venta (el id del pedido): un reintento con ella devuelve la misma factura.',
    'const { v4: uuidv4 } = require("uuid");',
    'bru.setVar("idempotencyKey", uuidv4());',
  ],
  postman: [
    '// Una Idempotency-Key nueva en cada solicitud: cada envío de «Emitir» es otra venta y emite otra factura.',
    '// En tu sistema la clave es estable por venta (el id del pedido): un reintento con ella devuelve la misma factura.',
    'const { v4: uuidv4 } = require("uuid");',
    'pm.variables.set("idempotencyKey", uuidv4());',
  ],
};

const DOCS_COLECCION = [
  spec.info.description,
  '',
  'Colección generada de `packages/api/openapi.json` con `pnpm colecciones`: no la edites a mano.',
  'Entorno `demo`: `baseUrl` es la API local y `llave` (secreta) la llave de caja que da `factura-hn-api demo llave`.',
].join('\n');

// ── Bruno ─────────────────────────────────────────────────────────────────────────────────────────────────────

const sangrar = (texto, n = 2) =>
  texto.split('\n').map((l) => (l ? ' '.repeat(n) + l : '')).join('\n');

function bloque(nombre, contenido) {
  return `${nombre} {\n${sangrar(contenido)}\n}\n`;
}

function bruSolicitud({ nombre, seq, metodo, url, auth, deRuta = [], deConsulta = [], cabeceras = [], cuerpo, despues, pruebas, docs }) {
  const partes = [];
  partes.push(bloque('meta', `name: ${nombre}\ntype: http\nseq: ${seq}`));
  const urlConsulta = deConsulta.filter((q) => q.activo).map((q) => `${q.nombre}=${q.valor}`).join('&');
  const lineas = [`url: ${url}${urlConsulta ? `?${urlConsulta}` : ''}`];
  if (cuerpo !== undefined) lineas.push('body: json');
  lineas.push(`auth: ${auth}`);
  partes.push(bloque(metodo, lineas.join('\n')));
  if (deConsulta.length) {
    partes.push(bloque('params:query', deConsulta.map((q) => `${q.activo ? '' : '~'}${q.nombre}: ${q.valor}`).join('\n')));
  }
  if (deRuta.length) partes.push(bloque('params:path', deRuta.map((p) => `${p.nombre}: ${p.valor}`).join('\n')));
  if (cabeceras.length) partes.push(bloque('headers', cabeceras.map((c) => `${c.nombre}: ${c.valor}`).join('\n')));
  if (cuerpo !== undefined) partes.push(bloque('body:json', JSON.stringify(cuerpo, null, 2)));
  if (despues) partes.push(bloque('script:post-response', despues.join('\n')));
  if (pruebas) partes.push(bloque('tests', pruebas.join('\n')));
  if (docs) partes.push(bloque('docs', docs));
  return partes.join('\n');
}

function bruCarpeta(nombre, seq, docs) {
  const partes = [bloque('meta', `name: ${nombre}\nseq: ${seq}`), bloque('auth', 'mode: inherit')];
  if (docs) partes.push(bloque('docs', docs));
  return partes.join('\n');
}

function generarBruno(grupos) {
  const dir = join(aqui, 'bruno');
  rmSync(dir, { recursive: true, force: true });
  const archivos = new Map();
  archivos.set('bruno.json', `${JSON.stringify({ version: '1', name: NOMBRE, type: 'collection', ignore: ['node_modules', '.git'] }, null, 2)}\n`);
  archivos.set(
    'collection.bru',
    [
      bloque('meta', `name: ${NOMBRE}`),
      bloque('auth', 'mode: bearer'),
      bloque('auth:bearer', 'token: {{llave}}'),
      bloque('script:pre-request', SCRIPT_PREVIO.bruno.join('\n')),
      bloque('docs', DOCS_COLECCION),
    ].join('\n'),
  );
  archivos.set(join('environments', 'demo.bru'), [bloque('vars', `baseUrl: ${URL_DEMO}`), 'vars:secret [\n  llave\n]\n'].join('\n'));

  archivos.set(join(PRIMERA.carpeta, 'folder.bru'), bruCarpeta(PRIMERA.nombre, 1, PRIMERA.docs));
  PRIMERA.pasos.forEach((p, i) => {
    archivos.set(
      join(PRIMERA.carpeta, `${p.id}.bru`),
      bruSolicitud({ ...p, seq: i + 1, auth: 'inherit', despues: p.despues?.bruno, pruebas: p.pruebas?.bruno }),
    );
  });

  let seqCarpeta = 2;
  for (const [etiqueta, ops] of grupos) {
    const carpeta = carpetaDe(etiqueta);
    archivos.set(join(carpeta, 'folder.bru'), bruCarpeta(etiqueta, seqCarpeta++));
    ops.forEach((op, i) => {
      archivos.set(
        join(carpeta, `${op.id}.bru`),
        bruSolicitud({ ...op, seq: i + 1, url: `{{baseUrl}}${op.ruta}`, auth: op.sinAuth ? 'none' : 'inherit' }),
      );
    });
  }
  escribir(dir, archivos);
  return archivos.size;
}

// ── Postman (colección v2.1) ──────────────────────────────────────────────────────────────────────────────────

const evento = (listen, lineas) => ({ listen, script: { type: 'text/javascript', exec: lineas } });

function pmSolicitud({ nombre, metodo, url, ruta, deRuta = [], deConsulta = [], cabeceras = [], cuerpo, sinAuth, docs, despues, pruebas }) {
  let urlPm;
  if (ruta) {
    const consulta = deConsulta.filter((q) => q.activo).map((q) => `${q.nombre}=${q.valor}`).join('&');
    urlPm = {
      raw: `{{baseUrl}}${ruta}${consulta ? `?${consulta}` : ''}`,
      host: ['{{baseUrl}}'],
      path: ruta.split('/').filter(Boolean),
    };
    if (deConsulta.length) {
      urlPm.query = deConsulta.map((q) => ({
        key: q.nombre,
        value: q.valor,
        ...(q.descripcion ? { description: q.descripcion } : {}),
        ...(q.activo ? {} : { disabled: true }),
      }));
    }
    if (deRuta.length) {
      urlPm.variable = deRuta.map((p) => ({ key: p.nombre, value: p.valor, ...(p.descripcion ? { description: p.descripcion } : {}) }));
    }
  } else {
    urlPm = url;
  }
  const request = {
    method: metodo.toUpperCase(),
    header: [
      ...cabeceras.map((c) => ({ key: c.nombre, value: c.valor })),
      ...(cuerpo !== undefined ? [{ key: 'Content-Type', value: 'application/json' }] : []),
    ],
    url: urlPm,
  };
  if (sinAuth) request.auth = { type: 'noauth' };
  if (cuerpo !== undefined) {
    request.body = { mode: 'raw', raw: JSON.stringify(cuerpo, null, 2), options: { raw: { language: 'json' } } };
  }
  if (docs) request.description = docs;
  const item = { name: nombre, request };
  const eventos = [];
  if (despues || pruebas) eventos.push(evento('test', [...(despues ?? []), ...(despues && pruebas ? [''] : []), ...(pruebas ?? [])]));
  if (eventos.length) item.event = eventos;
  return item;
}

function generarPostman(grupos) {
  const dir = join(aqui, 'postman');
  rmSync(dir, { recursive: true, force: true });
  const items = [
    {
      name: PRIMERA.nombre,
      description: PRIMERA.docs,
      item: PRIMERA.pasos.map((p) => pmSolicitud({ ...p, despues: p.despues?.postman, pruebas: p.pruebas?.postman })),
    },
  ];
  for (const [etiqueta, ops] of grupos) items.push({ name: etiqueta, item: ops.map((op) => pmSolicitud(op)) });
  const coleccion = {
    info: {
      name: NOMBRE,
      description: DOCS_COLECCION,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{llave}}', type: 'string' }] },
    event: [evento('prerequest', SCRIPT_PREVIO.postman)],
    variable: [
      { key: 'numero', value: '' },
      { key: 'enlacePdf', value: '' },
    ],
    item: items,
  };
  const entorno = {
    name: 'demo',
    values: [
      { key: 'baseUrl', value: URL_DEMO, type: 'default', enabled: true },
      { key: 'llave', value: '', type: 'secret', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
  const archivos = new Map([
    [`${NOMBRE}.postman_collection.json`, `${JSON.stringify(coleccion, null, 2)}\n`],
    ['demo.postman_environment.json', `${JSON.stringify(entorno, null, 2)}\n`],
  ]);
  escribir(dir, archivos);
  return archivos.size;
}

// ── Escritura ─────────────────────────────────────────────────────────────────────────────────────────────────

function escribir(dir, archivos) {
  for (const [ruta, contenido] of archivos) {
    const destino = join(dir, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido.replace(/\r\n/g, '\n'));
  }
}

const grupos = operaciones();
const total = [...grupos.values()].reduce((n, ops) => n + ops.length, 0);
const nBruno = generarBruno(grupos);
const nPostman = generarPostman(grupos);
console.log(`Colecciones generadas de openapi.json: ${total} operaciones en ${grupos.size} carpetas, más «${PRIMERA.nombre}».`);
console.log(`  colecciones/bruno: ${nBruno} archivos · colecciones/postman: ${nPostman} archivos`);
