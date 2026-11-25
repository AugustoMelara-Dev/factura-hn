/**
 * Ejemplo: emitir una factura de prueba en un POS y guardarla como HTML y texto térmico.
 * Ejecuta: pnpm example (desde la raíz)
 *
 * Usa una autorización de prueba (CAI ficticio `DEMO00-NO-VALIDO-…`): cada impreso lleva la leyenda
 * «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Para facturar de verdad, registra el CAI de tu resolución del SAR
 * (ver «Pasar a producción» en el README) en un almacén persistente.
 */
import { writeFileSync } from 'node:fs';
import { AlmacenFiscalMemoria, emitir, estadoAutorizacion, registrarAutorizacion, renderizarHTML, renderizarTexto } from 'factura-hn';
import { autorizacionDemo, LEYENDA_PRUEBA } from 'factura-hn/demo';

// Autorización de prueba: CAI ficticio, rango 1–5000 y fecha límite a 180 días de hoy en Honduras.
const autorizacion = autorizacionDemo({ tipoDocumento: '01', establecimiento: '000', puntoEmision: '001', rangoFinal: 5000 });

// En producción: AlmacenPostgres (@factura-hn/postgres) o AlmacenSQLite (@factura-hn/sqlite).
const almacen = new AlmacenFiscalMemoria();
await registrarAutorizacion(almacen, autorizacion);

const doc = await emitir(
  {
    emisor: {
      rtn: '99990000000001',
      razonSocial: 'Inversiones Ejemplo S. de R.L.',
      nombreComercial: 'Pulpería La Bendición',
      direccionCasaMatriz: 'Barrio El Centro, frente al parque, Ciudad Ejemplo',
      direccionEstablecimiento: 'Barrio El Centro, frente al parque, Ciudad Ejemplo',
      telefono: '+504 0000-0001',
      correo: 'ventas@ejemplo.example',
    },
    cliente: { nombre: 'Ferretería Hermanos Pérez', rtn: '99990000000002' },
    preciosIncluyenISV: true,
    condicionPago: 'CONTADO',
    lineas: [
      { codigo: '7501', descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '89.50' },
      { codigo: '7502', descripcion: 'Aceite vegetal 750 ml', cantidad: 1, precioUnitario: '72.00', descuento: '5.00' },
      { codigo: '8801', descripcion: 'Cerveza lata 355 ml', cantidad: 6, precioUnitario: '32.00', isv: 'ISV18' },
      { codigo: '9901', descripcion: 'Frijoles rojos (lb)', cantidad: 3, precioUnitario: '28.00', isv: 'EXENTO' },
    ],
  },
  { almacen, establecimiento: '000', puntoEmision: '001' },
);

console.log(LEYENDA_PRUEBA);
console.log(doc.numero, doc.modo, doc.totales);
console.log(estadoAutorizacion(autorizacion, doc.correlativo));

writeFileSync('factura-ejemplo.html', renderizarHTML(doc));
writeFileSync('ticket-ejemplo.html', renderizarHTML(doc, { formato: 'ticket' }));
writeFileSync('ticket-ejemplo.txt', renderizarTexto(doc, { ancho: 42 }));
console.log('Guardados: factura-ejemplo.html, ticket-ejemplo.html y ticket-ejemplo.txt, con la leyenda de prueba.');
