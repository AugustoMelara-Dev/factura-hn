// Páginas que el sitio genera desde los Markdown del repositorio: una sola fuente, sin copias a mano.
// `ruta` es la URL dentro del sitio, sin la base y sin barras (`referencia/sdk` → /referencia/sdk/).

export const PAGINAS = [
  {
    fuente: 'docs/guia-sdk.md',
    ruta: 'referencia/sdk',
    menu: 'Guía completa del SDK',
    orden: 1,
    descripcion: 'Guía del SDK de TypeScript paso a paso: almacén fiscal, autorizaciones, emisión, impresión, anulación y notas.',
  },
  {
    fuente: 'docs/api.md',
    ruta: 'referencia/api',
    menu: 'Guía completa de la API',
    orden: 2,
    descripcion: 'La API REST de factura-hn: cómo levantarla, autenticación y roles, recursos, emisión, webhooks y seguridad.',
  },
  {
    fuente: 'packages/api/openapi.json',
    ruta: 'referencia/openapi',
    titulo: 'Rutas y esquemas de la API REST',
    menu: 'API: rutas y esquemas',
    orden: 3,
    descripcion: 'Referencia generada del OpenAPI: autenticación, errores, idempotencia, paginación, cada ruta y cada esquema.',
    generar: 'openapi',
  },
  {
    fuente: 'docs/errores.md',
    ruta: 'referencia/errores',
    menu: 'Errores',
    orden: 4,
    descripcion: 'Catálogo de códigos de error y de aviso del SDK, la API y el MCP: qué significan, su base y qué hacer.',
  },
  {
    fuente: 'docs/cumplimiento.md',
    ruta: 'referencia/cumplimiento',
    titulo: 'Matriz de cumplimiento',
    menu: 'Matriz completa de cumplimiento',
    orden: 5,
    descripcion: 'Cada requisito del Reglamento de Facturación y de la Ley del ISV que implementa factura-hn, con su artículo y la prueba que lo verifica.',
    generar: 'matriz',
  },
  {
    fuente: 'docs/normativa.md',
    ruta: 'referencia/normativa',
    menu: 'Normativa',
    orden: 6,
    descripcion: 'Qué requisitos del Reglamento cubre la librería, de qué fuentes sale cada regla y qué queda fuera.',
  },
  {
    fuente: 'docs/autoalojamiento.md',
    ruta: 'guias/autoalojar',
    menu: 'Autoalojar la API',
    orden: 50,
    descripcion: 'Instalar la API y su base PostgreSQL en un equipo del negocio con Docker Compose: varias cajas, respaldos y actualización.',
  },
  {
    fuente: 'CHANGELOG.md',
    ruta: 'ayuda/cambios',
    titulo: 'Cambios por versión',
    menu: 'Cambios',
    orden: 50,
    descripcion: 'Qué cambió en cada versión de factura-hn y cómo migrar.',
  },
];

/** Ruta del repositorio → URL del sitio (`/ruta/`), para reescribir los enlaces entre documentos. */
export function mapaDeEnlaces() {
  const mapa = new Map();
  for (const p of PAGINAS) if (!p.generar) mapa.set(p.fuente, `/${p.ruta}/`);
  // La página de la matriz se genera desde las tablas de docs/cumplimiento.md: un enlace sin ancla va a la página;
  // con ancla, al archivo en GitHub (las secciones de la página generada no son las del archivo).
  mapa.set('docs/cumplimiento.md', (ancla) => (ancla ? null : '/referencia/cumplimiento/'));
  return mapa;
}
