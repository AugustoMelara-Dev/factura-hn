// Enlaces firmados al PDF: los números son consecutivos, así que sin firma cualquiera podría recorrer
// /facturas/000-001-01-00000001, …02, … y bajar las facturas (nombre, RTN y montos) de todos los clientes.
// En tu aplicación, además, comprueba que el documento sea del usuario o del pedido de la sesión.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

function secreto(): string {
  const s = process.env.FHN_SECRETO_ENLACES;
  if (!s || s.length < 32) throw new Error('Falta FHN_SECRETO_ENLACES (al menos 32 caracteres aleatorios).');
  return s;
}

const firma = (numero: string) => createHmac('sha256', secreto()).update(`pdf:${numero}`).digest('base64url');

export function enlacePDF(numero: string): string {
  return `/facturas/${numero}?firma=${firma(numero)}`;
}

export function firmaValida(numero: string, recibida: string | null): boolean {
  if (!recibida) return false;
  const a = Buffer.from(firma(numero));
  const b = Buffer.from(recibida);
  return a.length === b.length && timingSafeEqual(a, b);
}
