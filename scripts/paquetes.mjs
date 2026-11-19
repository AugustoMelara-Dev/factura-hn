// Paquetes que se publican en npm, compartido por verificar-dist.mjs y publicar.mjs.

/** Carpetas en packages/, en orden de dependencias: cada paquete va después de los que usa. */
export const PUBLICABLES = ['core', 'pdf', 'postgres', 'sqlite', 'cliente', 'mcp'];

/**
 * La publicación de confianza (OIDC) de npm exige que repository.url coincida exactamente con el repositorio de
 * GitHub que publica. Si el repositorio cambia, el paso 1 de docs/lanzamiento.md actualiza también esta línea.
 */
export const REPOSITORIO = 'git+https://github.com/AugustoMelara-Dev/factura-hn.git';

/**
 * Documentos de `docs/` que van dentro del paquete `factura-hn` (lista de inclusión). Lo demás es interno del
 * proyecto (avance, lanzamiento, modelo de negocio, planes y análisis) y no se publica: verificar-dist falla si
 * el paquete trae algo fuera de esta lista.
 */
export const DOCS_PUBLICOS = [
  'api.md',
  'autoalojamiento.md',
  'consulta-sar.md',
  'decisiones.md',
  'guia-sdk.md',
  'investigacion.md',
  'normativa.md',
  'persistencia.md',
];
