// Contraste de la paleta del sitio (WCAG 2.x, luminancia relativa). Lee los tokens de src/styles/tokens.css (claro
// en `:root`, oscuro en `:root[data-theme='dark']`) y las asignaciones de Starlight (tema.css) y de Astryx
// (astryx-puente.css), que apuntan a esos tokens. Si un cambio baja un par de AA, la prueba falla. Corre con
// `node --test` (lo hace `pnpm sitio`).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const leerCss = (archivo) => readFileSync(new URL(`../src/styles/${archivo}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const bloque = (css, selector, archivo) => {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `falta el bloque ${selector} en ${archivo}`);
  return css.slice(i, css.indexOf('}', i));
};
const variables = (texto) => Object.fromEntries([...texto.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const tokens = leerCss('tokens.css');
const asignaciones = {
  ...variables(bloque(leerCss('tema.css'), ':root', 'tema.css')),
  ...variables(bloque(leerCss('astryx-puente.css'), '[data-astryx-theme]', 'astryx-puente.css')),
};
const claro = { ...variables(bloque(tokens, ':root', 'tokens.css')), ...asignaciones };
const oscuro = { ...claro, ...variables(bloque(tokens, ":root[data-theme='dark']", 'tokens.css')) };

function color(tema, nombre) {
  let v = tema[nombre];
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = tema[v.slice(4, -1).trim()];
  assert.match(v ?? '', /^#[0-9a-f]{6}$/i, `${nombre} no es un color #rrggbb`);
  return v;
}

/** Luminancia relativa de WCAG 2.x. */
function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Pares [texto, fondo, mínimo, uso]. 4,5 para texto normal; 3 para bordes de componentes (WCAG 1.4.11). */
const PARES = [
  ['--sl-color-text', '--sl-color-bg', 4.5, 'cuerpo'],
  ['--sl-color-white', '--sl-color-bg', 4.5, 'títulos'],
  ['--sl-color-gray-1', '--sl-color-bg', 4.5, 'texto'],
  ['--sl-color-gray-2', '--sl-color-bg', 4.5, 'texto secundario'],
  ['--sl-color-gray-3', '--sl-color-bg', 4.5, 'texto suave (pie, metadatos)'],
  ['--sl-color-gray-3', '--sl-color-bg-nav', 4.5, 'texto suave en la barra'],
  ['--sl-color-gray-2', '--sl-color-bg-sidebar', 4.5, 'menú lateral'],
  ['--sl-color-gray-3', '--fhn-superficie', 4.5, 'texto suave sobre superficie'],
  ['--sl-color-white', '--sl-color-bg-nav', 4.5, 'barra superior'],
  ['--sl-color-white', '--sl-color-bg-inline-code', 4.5, 'código en línea'],
  ['--sl-color-text-accent', '--sl-color-bg', 4.5, 'enlaces'],
  ['--sl-color-text-accent', '--sl-color-bg-nav', 4.5, 'enlaces en la barra'],
  ['--sl-color-text-accent', '--sl-color-bg-inline-code', 4.5, 'enlace con código'],
  ['--sl-color-text-accent', '--fhn-superficie', 4.5, 'enlaces sobre superficie'],
  ['--sl-color-black', '--sl-color-text-accent', 4.5, 'botón primario'],
  ['--sl-color-text-invert', '--sl-color-text-accent', 4.5, 'página actual en el menú'],
  ['--sl-color-text-accent', '--sl-color-accent-low', 4.5, 'badge por defecto'],
  ['--sl-color-white', '--fhn-superficie', 4.5, 'texto en tablas y citas'],
  ...['blue', 'purple', 'green', 'orange', 'red'].flatMap((c) => [
    [`--sl-color-${c}-high`, `--sl-color-${c}-low`, 4.5, `título de aviso ${c}`],
    ['--sl-color-white', `--sl-color-${c}-low`, 4.5, `texto de aviso ${c}`],
    [`--sl-color-${c}`, `--sl-color-${c}-low`, 3, `borde de aviso ${c}`],
  ]),
  ['--fhn-exito', '--fhn-exito-fondo', 4.5, 'estado cubierto, POST'],
  ['--fhn-aviso', '--fhn-aviso-fondo', 4.5, 'estado parcial, PATCH'],
  ['--fhn-error', '--fhn-error-fondo', 4.5, 'estado ausente, DELETE'],
  ['--fhn-neutro', '--fhn-neutro-fondo', 4.5, 'estado no aplica'],
  ['--sl-color-gray-4', '--sl-color-bg', 3, 'borde de campos'],
  // Páginas del producto y componentes de Astryx
  ['--fhn-sobre-acento', '--fhn-acento', 4.5, 'botón primario del producto'],
  ['--fhn-acento-fuerte', '--fhn-acento-suave', 4.5, 'etiqueta sobre acento suave'],
  ['--fhn-gris-3', '--fhn-superficie', 4.5, 'texto suave en tarjetas'],
  ['--fhn-texto', '--fhn-superficie', 4.5, 'texto en tarjetas y código'],
  ['--color-on-accent', '--color-accent', 4.5, 'botón primario de Astryx'],
  ['--color-text-primary', '--color-background-body', 4.5, 'texto de Astryx'],
  ['--color-text-secondary', '--color-background-body', 4.5, 'texto secundario de Astryx'],
  ['--color-text-accent', '--color-background-body', 4.5, 'enlaces de Astryx'],
  ['--color-text-secondary', '--color-background-surface', 4.5, 'texto secundario de Astryx en superficie'],
];

for (const [nombreTema, tema] of [['claro', claro], ['oscuro', oscuro]]) {
  test(`contraste AA, tema ${nombreTema}`, () => {
    const fallos = [];
    for (const [texto, fondo, minimo, uso] of PARES) {
      const r = contraste(color(tema, texto), color(tema, fondo));
      if (r < minimo) fallos.push(`${uso}: ${texto} sobre ${fondo} = ${r.toFixed(2)} (< ${minimo})`);
    }
    assert.deepEqual(fallos, []);
  });
}

// `node scripts/contraste.test.mjs --tabla` imprime la tabla de contrastes de cada tema.
if (process.argv.includes('--tabla')) {
  for (const [nombreTema, tema] of [['claro', claro], ['oscuro', oscuro]]) {
    console.log(`\n${nombreTema}`);
    for (const [texto, fondo, minimo, uso] of PARES) {
      const [a, b] = [color(tema, texto), color(tema, fondo)];
      console.log(`| ${uso} | \`${a}\` sobre \`${b}\` | ${contraste(a, b).toFixed(2).replace('.', ',')} | ${minimo} |`);
    }
  }
}
