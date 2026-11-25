// Valores de ejemplo de las colecciones, por operationId. Solo datos ficticios: RTN 9999…, correos @ejemplo.example,
// CAI DEMO00-NO-VALIDO-…. Lo que no esté aquí sale del `example` del OpenAPI o, en un cuerpo, de un esqueleto con
// los campos obligatorios de su esquema.

/** Cuerpos JSON de ejemplo. El de emitirDocumento es `packages/api/ejemplos/factura.json` (lo lee generar.mjs). */
export const CUERPOS = {
  crearEmisor: {
    rtn: '99999999999999',
    razonSocial: 'NEGOCIO DE EJEMPLO S. DE R.L.',
    nombreComercial: 'Negocio de Ejemplo',
    direccionCasaMatriz: 'Barrio El Centro, Tegucigalpa',
    direccionEstablecimiento: 'Barrio El Centro, Tegucigalpa',
    telefono: '2200-0000',
    correo: 'facturas@ejemplo.example',
  },
  actualizarEmisor: { telefono: '2200-0001' },
  registrarAutorizacion: {
    cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01',
    tipoDocumento: '01',
    establecimiento: '000',
    puntoEmision: '002',
    rangoInicial: 1,
    rangoFinal: 5000,
    fechaLimiteEmision: '2027-06-30',
    prueba: true,
  },
  anularDocumento: { motivo: 'Error en el precio de una línea', operador: 'María López' },
  corregirFechaSerie: { motivo: 'El reloj de la caja estaba adelantado', operador: 'María López' },
  crearLlave: { nombre: 'Caja 2', rol: 'caja', establecimiento: '000', puntoEmision: '002' },
  crearWebhook: { url: 'https://pos.ejemplo.example/webhooks/factura-hn', eventos: ['documento.emitido', 'documento.anulado'] },
  rotarSecretoWebhook: { graciaHoras: 24 },
};

/** Parámetros de ruta de ejemplo, cuando el OpenAPI no trae uno. */
export const PARAMETROS_RUTA = {
  cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01',
  numero: '000-001-01-00000001',
};
