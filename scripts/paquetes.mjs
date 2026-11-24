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
// Solo lo que le sirve a quien integra la librería. Quedan fuera, en el repositorio: decisiones.md (registro de
// decisiones del proyecto), investigacion.md (matriz interna con los pendientes B-xx y P-xx) y consulta-sar.md
// (borrador de consulta al SAR, sin enviar).
export const DOCS_PUBLICOS = [
  'api.md',
  'autoalojamiento.md',
  'guia-sdk.md',
  'normativa.md',
  'persistencia.md',
];
