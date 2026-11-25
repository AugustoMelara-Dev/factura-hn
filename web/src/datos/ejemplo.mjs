// El ejemplo de código de la portada y sus temas de resaltado. Viven aquí para que contraste.test.mjs revise el
// contraste de cada color que Shiki le da, en los dos temas, sobre el fondo del bloque (--fhn-fondo; la barra de
// título va sobre --fhn-superficie). Las líneas son cortas (los comentarios también) para que quepan a 375 px.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Temas de Shiki: los «default» de GitHub, que pasan AA sobre el fondo del sitio (los «github-light» y
 * «github-dark» que usa la documentación no: sus comentarios dan 4,11 en el oscuro). Astro no los trae en su
 * paquete de temas, así que se cargan de @shikijs/themes, que llega con Astro (no es dependencia directa).
 */
export async function temasCodigo() {
  const desdeAstro = createRequire(createRequire(import.meta.url).resolve('astro/package.json'));
  const desdeShiki = createRequire(desdeAstro.resolve('shiki'));
  const cargar = async (nombre) => (await import(pathToFileURL(desdeShiki.resolve(`@shikijs/themes/${nombre}`)).href)).default;
  return { light: await cargar('github-light-default'), dark: await cargar('github-dark-default') };
}

export const EJEMPLO_PORTADA = `import { renderizarTexto } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

// Emisor y CAI ficticios
const caja = await crearFacturadorDemo();

const factura = await caja.emitir({
  preciosIncluyenISV: true,
  lineas: [{
    descripcion: 'Café molido 1 lb',
    cantidad: 2,
    precioUnitario: '115.00',
  }],
});

// 000-001-01-00000001
console.log(factura.numero);
console.log(renderizarTexto(factura));`;
