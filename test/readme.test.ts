import { expect, it } from 'vitest';
import { AlmacenMemoria, crearDocumento } from '../src';

it('el ejemplo del README da los números que promete', async () => {
  const autorizacion = {
    cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000',
    puntoEmision: '001', rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: '2027-06-30',
  } as const;
  const f = await crearDocumento({
    fechaEmision: '2026-11-18',
    emisor: { rtn: '08011999123456', razonSocial: 'Inversiones Ejemplo S. de R.L.', nombreComercial: 'Pulpería La Bendición',
      direccionCasaMatriz: 'Barrio El Centro, Tocoa, Colón', telefono: '2444-0000', correo: 'ventas@ejemplo.hn' },
    cliente: { nombre: 'Ferretería Pérez', rtn: '08019005123456' },
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: 89.5 },
      { descripcion: 'Cerveza lata', cantidad: 6, precioUnitario: 32, isv: 'ISV18' },
      { descripcion: 'Frijoles (lb)', cantidad: 3, precioUnitario: 28, isv: 'EXENTO' },
    ],
  }, { autorizacion, almacen: new AlmacenMemoria() });
  expect(f.numero).toBe('000-001-01-00000001');
  expect(f.totales.total).toBe(455);
  expect(f.totales.totalEnLetras).toBe('CUATROCIENTOS CINCUENTA Y CINCO LEMPIRAS CON 00/100');
  expect(f.advertencias).toEqual([]);
});
