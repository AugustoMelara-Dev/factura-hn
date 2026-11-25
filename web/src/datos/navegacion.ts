// Navegación principal, la misma en las páginas del producto y en la cabecera de la documentación.
// Las rutas van sin la base: `conBase` la agrega.
import { BASE, REPO } from '../../sitio.config.mjs';

export const conBase = (ruta: string) => (/^[a-z]+:/i.test(ruta) ? ruta : `${BASE}${ruta}`);

export interface Enlace {
  texto: string;
  ruta: string;
  externo?: boolean;
}

export const NAV: Enlace[] = [
  { texto: 'Producto', ruta: '/#productos' },
  { texto: 'Documentación', ruta: '/empezar/primera-factura/' },
  { texto: 'Pruébalo', ruta: '/probar/' },
  { texto: 'Precios', ruta: '/precios/' },
  { texto: 'GitHub', ruta: REPO, externo: true },
];

/**
 * Las páginas del producto, para la documentación: en el menú del teléfono (MenuMovilDocs.astro) y en el pie
 * compacto (Pie.astro). Así, desde cualquier página de la documentación se llega a ellas en cualquier pantalla.
 */
export const PRODUCTO: Enlace[] = [
  { texto: 'Portada', ruta: '/' },
  { texto: 'Pruébalo', ruta: '/probar/' },
  { texto: 'Precios', ruta: '/precios/' },
  { texto: 'Cumplimiento', ruta: '/cumplimiento/' },
  { texto: 'Contacto', ruta: '/contacto/' },
];

/** Columnas del pie de las páginas del producto. */
export const PIE: { titulo: string; enlaces: Enlace[] }[] = [
  {
    titulo: 'Producto',
    enlaces: [
      { texto: 'SDK', ruta: '/guias/sdk/' },
      { texto: 'CLI', ruta: '/guias/cli/' },
      { texto: 'API REST', ruta: '/guias/api/' },
      { texto: 'MCP', ruta: '/guias/mcp/' },
      { texto: 'Pruébalo', ruta: '/probar/' },
      { texto: 'Playground', ruta: '/empezar/playground/' },
    ],
  },
  {
    titulo: 'Documentación',
    enlaces: [
      { texto: 'Tu primera factura', ruta: '/empezar/primera-factura/' },
      { texto: 'Tipos de documento', ruta: '/documentos/' },
      { texto: 'Guías por negocio', ruta: '/negocios/' },
      { texto: 'Referencia de la API', ruta: '/referencia/openapi/' },
      { texto: 'Para agentes de IA (llms.txt)', ruta: '/llms.txt' },
    ],
  },
  {
    titulo: 'Proyecto',
    enlaces: [
      { texto: 'Cumplimiento', ruta: '/cumplimiento/' },
      { texto: 'Precios', ruta: '/precios/' },
      { texto: 'Contacto', ruta: '/contacto/' },
      { texto: 'Cambios por versión', ruta: '/ayuda/cambios/' },
      { texto: 'Código en GitHub', ruta: REPO, externo: true },
    ],
  },
];
