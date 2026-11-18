'use server';

import { randomUUID } from 'node:crypto';
import { fhn } from '../lib/fhn';
import { facturarVenta, type EstadoVenta } from '../lib/ventas';

export async function emitirVenta(_previo: EstadoVenta, datos: FormData): Promise<EstadoVenta> {
  return facturarVenta(fhn(), datos, randomUUID);
}
