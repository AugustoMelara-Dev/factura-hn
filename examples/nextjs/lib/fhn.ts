// Solo en el servidor: la llave de API nunca debe llegar al navegador. `server-only` hace fallar el build si
// un componente 'use client' importa este archivo (directa o indirectamente).
import 'server-only';
import { crearCliente } from '@factura-hn/cliente';

let cliente: ReturnType<typeof crearCliente> | undefined;

export function fhn(): ReturnType<typeof crearCliente> {
  if (!process.env.FHN_LLAVE) throw new Error('Falta FHN_LLAVE (llave de caja de la API).');
  cliente ??= crearCliente({ url: process.env.FHN_API_URL ?? 'http://127.0.0.1:8787', llave: process.env.FHN_LLAVE });
  return cliente;
}
