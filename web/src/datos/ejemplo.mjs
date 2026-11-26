// El ejemplo de código de la portada y su tema de resaltado. Viven aquí para que contraste.test.mjs revise el
// contraste de cada color que Shiki le da sobre el fondo del bloque (--fhn-superficie).
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Tema de Shiki: el «light default» de GitHub, que pasa AA sobre la superficie gris del sitio. Astro no lo trae en
 * su paquete de temas, así que se carga de @shikijs/themes, que llega con Astro (no es dependencia directa).
 */
export async function temaCodigo() {
  const desdeAstro = createRequire(createRequire(import.meta.url).resolve('astro/package.json'));
  const desdeShiki = createRequire(desdeAstro.resolve('shiki'));
  return (await import(pathToFileURL(desdeShiki.resolve('@shikijs/themes/github-light-default')).href)).default;
}

/** El ejemplo canónico: el mismo de la portada y del README. */
export const EJEMPLO_PORTADA = `import { crearFacturadorDemo } from 'factura-hn/demo';
const caja = await crearFacturadorDemo();
const factura = await caja.emitir({ lineas: [{ descripcion: 'Café molido', cantidad: 2, precioUnitario: '115.00' }] });`;
