// Navegación principal, la misma en la portada y en la cabecera de la documentación.
// Las rutas van sin la base: `conBase` la agrega.
import { BASE, REPO } from '../../sitio.config.mjs';

export const conBase = (ruta: string) => (/^[a-z]+:/i.test(ruta) ? ruta : `${BASE}${ruta}`);

export interface Enlace {
  texto: string;
  ruta: string;
  externo?: boolean;
}

export const DOCUMENTACION = '/empezar/primera-factura/';
export const DISCUSIONES = `${REPO}/discussions`;

/** Cabecera: la documentación («Docs») y el repositorio. */
export const NAV: Enlace[] = [
  { texto: 'Docs', ruta: DOCUMENTACION },
  { texto: 'GitHub', ruta: REPO, externo: true },
];

/** El pie de todo el sitio: una línea, con estos enlaces al final. */
export const PIE: Enlace[] = [
  { texto: 'GitHub', ruta: REPO, externo: true },
  { texto: 'Licencia MIT', ruta: `${REPO}/blob/main/LICENSE`, externo: true },
];
