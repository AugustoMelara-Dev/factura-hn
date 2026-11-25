/**
 * Documentos reales fijos (sin `modo`), para comprobar que el modo de prueba no cambia en nada lo que se
 * imprime de un documento real. Los usan las pruebas del núcleo y las del PDF.
 */
import { construirDocumento } from '../src/documento';
import { anularDocumento } from '../src/anulacion';
import type { AutorizacionCAI, DocumentoFiscal } from '../src/tipos';

const reloj = () => new Date('2026-11-18T16:30:00Z');

const EMISOR = {
  rtn: '99990000000001',
  razonSocial: 'Comercial Ejemplo S. de R.L.',
  nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

const autorizacion = (tipoDocumento: '01' | '06'): AutorizacionCAI => ({
  cai: `A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-${tipoDocumento}`,
  tipoDocumento,
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 500,
  fechaLimiteEmision: '2027-06-30',
});

/** Factura simple, factura mixta anulada y nota de crédito, todas en lempiras. */
export function documentosReales(): { simple: DocumentoFiscal; mixta: DocumentoFiscal; anulada: DocumentoFiscal; nota: DocumentoFiscal } {
  const simple = construirDocumento(
    { emisor: EMISOR, horaEmision: '10:30', lineas: [{ descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '89.50' }] },
    autorizacion('01'), 1, { reloj },
  );
  const mixta = construirDocumento(
    {
      emisor: EMISOR,
      cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
      preciosIncluyenISV: true,
      operador: 'Cajera 1',
      lineas: [
        { codigo: 'C-1', descripcion: 'Clavos 2"', cantidad: '1.5', precioUnitario: '115.00', descuento: '5.00' },
        { descripcion: 'Cerveza', cantidad: 6, precioUnitario: '35.40', isv: 'ISV18' },
        { descripcion: 'Frijoles (lb)', cantidad: 3, precioUnitario: '28.00', isv: 'EXENTO' },
      ],
      condicionPago: 'CREDITO',
      observaciones: 'Entrega a domicilio',
    },
    autorizacion('01'), 2, { reloj },
  );
  const anulada = anularDocumento(mixta, { motivo: 'Cantidad equivocada', reloj });
  const nota = construirDocumento(
    {
      tipoDocumento: '06',
      emisor: EMISOR,
      cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
      referencia: { cai: mixta.cai, numero: mixta.numero, fecha: mixta.fechaEmision },
      motivo: 'Devolución',
      lineas: [{ descripcion: 'Clavos 2"', cantidad: 1, precioUnitario: '100.00' }],
    },
    autorizacion('06'), 1, { reloj },
  );
  return { simple, mixta, anulada, nota };
}
