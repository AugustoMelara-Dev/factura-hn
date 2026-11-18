/**
 * Ejemplo: emitir una factura en un POS y guardarla como HTML y texto térmico.
 * Ejecuta: pnpm example (desde la raíz)
 */
import { writeFileSync } from 'node:fs';
import {
  AlmacenMemoria,
  crearDocumento,
  estadoAutorizacion,
  horaHonduras,
  renderizarHTML,
  renderizarTexto,
  type AutorizacionCAI,
} from 'factura-hn';

// Datos de la resolución del SAR (estos son de ejemplo, NO son un CAI real).
const autorizacion: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
};

const almacen = new AlmacenMemoria({ [autorizacion.cai]: 1247 }); // ya se emitieron 1,247

const doc = await crearDocumento(
  {
    emisor: {
      rtn: '08011999123456',
      razonSocial: 'Inversiones Ejemplo S. de R.L.',
      nombreComercial: 'Pulpería La Bendición',
      direccionCasaMatriz: 'Barrio El Centro, frente al parque, Tocoa, Colón',
      telefono: '+504 2444-0000',
      correo: 'ventas@ejemplo.hn',
    },
    cliente: { nombre: 'Ferretería Hermanos Pérez', rtn: '08019005123456' },
    horaEmision: horaHonduras(),
    preciosIncluyenISV: true,
    condicionPago: 'CONTADO',
    lineas: [
      { codigo: '7501', descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: 89.5 },
      { codigo: '7502', descripcion: 'Aceite vegetal 750 ml', cantidad: 1, precioUnitario: 72, descuento: 5 },
      { codigo: '8801', descripcion: 'Cerveza lata 355 ml', cantidad: 6, precioUnitario: 32, isv: 'ISV18' },
      { codigo: '9901', descripcion: 'Frijoles rojos (lb)', cantidad: 3, precioUnitario: 28, isv: 'EXENTO' },
    ],
  },
  { autorizacion, almacen },
);

console.log(doc.numero, doc.totales);
console.log(estadoAutorizacion(autorizacion, doc.correlativo));

writeFileSync('factura-ejemplo.html', renderizarHTML(doc));
writeFileSync('ticket-ejemplo.html', renderizarHTML(doc, { formato: 'ticket' }));
writeFileSync('ticket-ejemplo.txt', renderizarTexto(doc, { ancho: 42 }));
