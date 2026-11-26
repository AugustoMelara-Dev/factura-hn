// Ejemplos de la referencia de la API REST (/referencia/openapi/): un curl por ruta, que corre tal cual en bash
// (Linux, macOS, Git Bash o WSL en Windows) contra la API de `docker compose up`, con las variables del preámbulo.
// Las respuestas que muestra la página no se escriben a mano: las guarda scripts/capturar-ejemplos-openapi.mjs en
// ejemplos-openapi.json al correr estos mismos curl, en este orden, sobre una instalación nueva.
//
// Reglas (las comprueba scripts/ejemplos-openapi.test.mjs): el cuerpo va por un heredoc (UTF-8 en cualquier
// terminal, también en Windows), la clave de idempotencia no depende de `uuidgen`, y cada valor es uno real.

/** Lo que se pega una vez en la terminal antes de los ejemplos. */
export const PREAMBULO = `API=http://127.0.0.1:8787                                                              # tu servidor
LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)             # llave de caja del demo
ADMIN=$(docker compose exec -T api factura-hn-api demo llave --rol admin --solo-llave) # llave admin del demo
HOY=$(date +%F)                                                                        # fecha de hoy, AAAA-MM-DD`;

/**
 * Variables que un ejemplo toma de la respuesta de otro. `ruta` es el camino dentro del JSON de la respuesta.
 * En la página, cada ejemplo que usa una dice de dónde sale.
 */
export const VARIABLES = {
  EMISOR: { de: 'GET /v1/emisores', ruta: ['emisores', 0, 'id'], texto: 'el `id` de tu emisor (`GET /v1/emisores`)' },
  CAI: { de: 'GET /v1/autorizaciones', ruta: ['autorizaciones', 0, 'cai'], texto: 'un CAI registrado (`GET /v1/autorizaciones`)' },
  NUMERO: { de: 'POST /v1/documentos', ruta: ['documento', 'numero'], texto: 'el número que devolvió `POST /v1/documentos`' },
  PREFIJO: { de: 'POST /v1/llaves', ruta: ['llave', 'prefijo'], texto: 'el `prefijo` de la llave (`GET /v1/llaves`)' },
  WEBHOOK: { de: 'POST /v1/webhooks', ruta: ['webhook', 'id'], texto: 'el `id` que devolvió `POST /v1/webhooks`' },
  ENTREGA: { de: 'GET /v1/webhooks/{id}/entregas', ruta: ['entregas', 0, 'id'], texto: 'el `id` de una entrega (`GET /v1/webhooks/{id}/entregas`)' },
};

const json = (cuerpo) => `--data-binary @- <<'JSON'\n${JSON.stringify(cuerpo, null, 2)}\nJSON`;
const llave = (v) => `-H "authorization: Bearer $${v}"`;
const conCuerpo = '-H "content-type: application/json"';
const lineas = (...l) => l.join(' \\\n  ');

/** En el orden en que se capturan (cada uno puede necesitar lo que dejó el anterior). */
export const EJEMPLOS = [
  { op: 'GET /salud', curl: 'curl "$API/salud"' },
  { op: 'GET /v1/sesion', curl: lineas('curl "$API/v1/sesion"', llave('LLAVE')) },
  { op: 'GET /v1/emisores', curl: lineas('curl "$API/v1/emisores"', llave('ADMIN')) },
  { op: 'GET /v1/emisores/{id}', curl: lineas('curl "$API/v1/emisores/$EMISOR"', llave('ADMIN')) },
  {
    op: 'PATCH /v1/emisores/{id}',
    curl: lineas('curl -X PATCH "$API/v1/emisores/$EMISOR"', llave('ADMIN'), conCuerpo, json({ telefono: '0000-0002' })),
  },
  {
    op: 'POST /v1/emisores',
    nota: 'El tenant del demo ya tiene emisor: ahí la respuesta es 409 `EMISOR_EXISTE`. En tu tenant `local` vacío, con tus datos, responde 201 con el emisor.',
    curl: lineas(
      'curl -X POST "$API/v1/emisores"',
      llave('ADMIN'),
      conCuerpo,
      json({
        rtn: '99990000000001',
        razonSocial: 'Inversiones Ejemplo S. de R.L.',
        nombreComercial: 'Pulpería La Bendición',
        direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
        direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
        telefono: '0000-0001',
        correo: 'ventas@ejemplo.example',
      }),
    ),
  },
  { op: 'GET /v1/autorizaciones', curl: lineas('curl "$API/v1/autorizaciones"', llave('ADMIN')) },
  {
    op: 'POST /v1/autorizaciones',
    nota: 'En el tenant del demo solo se aceptan CAI ficticios (`DEMO00-NO-VALIDO-…`); en el tuyo, los datos de tu resolución.',
    curl: lineas(
      'curl -X POST "$API/v1/autorizaciones"',
      llave('ADMIN'),
      conCuerpo,
      json({
        cai: 'DEMO00-NO-VALIDO-0000-0000-0000-02',
        tipoDocumento: '01',
        establecimiento: '000',
        puntoEmision: '002',
        rangoInicial: 1,
        rangoFinal: 1000,
        fechaLimiteEmision: '2027-12-31',
      }),
    ),
  },
  { op: 'GET /v1/autorizaciones/{cai}/estado', curl: lineas('curl "$API/v1/autorizaciones/$CAI/estado"', llave('ADMIN')) },
  {
    op: 'POST /v1/documentos',
    curl: lineas(
      'curl -X POST "$API/v1/documentos"',
      llave('LLAVE'),
      '-H "idempotency-key: venta-$(date +%s)"',
      conCuerpo,
      json({
        documento: {
          preciosIncluyenISV: true,
          lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
        },
      }),
    ),
  },
  { op: 'GET /v1/documentos', curl: lineas('curl "$API/v1/documentos?desde=$HOY&hasta=$HOY"', llave('LLAVE')) },
  { op: 'GET /v1/documentos/{archivo}', curl: lineas('curl "$API/v1/documentos/$NUMERO.txt"', llave('LLAVE')) },
  { op: 'GET /v1/series/{identificador}/no-utilizados', curl: lineas('curl "$API/v1/series/000-001-01/no-utilizados"', llave('ADMIN')) },
  {
    op: 'POST /v1/series/{identificador}/corregir-fecha',
    nota: 'Corrige solo documentos emitidos con el reloj adelantado (ver [Reloj y fechas](/conceptos/reloj-y-fechas/)). En una serie sin ellos, como la del demo, la respuesta es 422 `SIN_DOCUMENTOS_ADELANTADOS`: no hay nada que corregir.',
    curl: lineas(
      'curl -X POST "$API/v1/series/000-001-01/corregir-fecha"',
      llave('ADMIN'),
      conCuerpo,
      json({ motivo: 'El reloj de la caja estaba adelantado' }),
    ),
  },
  { op: 'GET /v1/libro-ventas', curl: lineas('curl "$API/v1/libro-ventas?desde=$HOY&hasta=$HOY"', llave('LLAVE')) },
  { op: 'GET /v1/exportacion', curl: lineas('curl "$API/v1/exportacion?desde=$HOY&hasta=$HOY&formato=csv"', llave('ADMIN')) },
  { op: 'GET /v1/bitacora', curl: lineas('curl "$API/v1/bitacora?limite=2"', llave('ADMIN')) },
  {
    op: 'POST /v1/llaves',
    curl: lineas(
      'curl -X POST "$API/v1/llaves"',
      llave('ADMIN'),
      conCuerpo,
      json({ nombre: 'Caja 2', rol: 'caja', establecimiento: '000', puntoEmision: '002' }),
    ),
  },
  { op: 'GET /v1/llaves', curl: lineas('curl "$API/v1/llaves"', llave('ADMIN')) },
  { op: 'DELETE /v1/llaves/{prefijo}', curl: lineas('curl -X DELETE "$API/v1/llaves/$PREFIJO"', llave('ADMIN')) },
  {
    op: 'POST /v1/webhooks',
    curl: lineas(
      'curl -X POST "$API/v1/webhooks"',
      llave('ADMIN'),
      conCuerpo,
      json({ url: 'https://tienda.ejemplo.example/webhooks/factura-hn', eventos: ['documento.emitido', 'documento.anulado'] }),
    ),
  },
  { op: 'GET /v1/webhooks', curl: lineas('curl "$API/v1/webhooks"', llave('ADMIN')) },
  { op: 'POST /v1/webhooks/{id}/probar', curl: lineas('curl -X POST "$API/v1/webhooks/$WEBHOOK/probar"', llave('ADMIN')) },
  { op: 'GET /v1/webhooks/{id}/entregas', curl: lineas('curl "$API/v1/webhooks/$WEBHOOK/entregas"', llave('ADMIN')) },
  {
    op: 'POST /v1/webhooks/{id}/entregas/{entrega}/reenviar',
    curl: lineas('curl -X POST "$API/v1/webhooks/$WEBHOOK/entregas/$ENTREGA/reenviar"', llave('ADMIN')),
  },
  {
    op: 'POST /v1/webhooks/{id}/rotar-secreto',
    curl: lineas('curl -X POST "$API/v1/webhooks/$WEBHOOK/rotar-secreto"', llave('ADMIN'), conCuerpo, json({ graciaHoras: 24 })),
  },
  { op: 'DELETE /v1/webhooks/{id}', curl: lineas('curl -X DELETE "$API/v1/webhooks/$WEBHOOK"', llave('ADMIN')) },
  {
    op: 'POST /v1/documentos/{numero}/anular',
    curl: lineas('curl -X POST "$API/v1/documentos/$NUMERO/anular"', llave('ADMIN'), conCuerpo, json({ motivo: 'Error en el precio' })),
  },
];

/** Variables de `VARIABLES` que usa un curl. */
export const variablesDe = (curl) => Object.keys(VARIABLES).filter((v) => new RegExp(`\\$${v}\\b`).test(curl));
