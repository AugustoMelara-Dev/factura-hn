// Reescritura de los destinos de enlace en un texto Markdown, sin tocar el código (bloques con valla y código en
// línea) ni los comentarios HTML. La usan el generador (enlaces relativos entre documentos del repositorio →
// URL del sitio o GitHub) y las versiones .md para IA (enlaces del sitio → URL completas).
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { RAIZ, REPO } from '../../sitio.config.mjs';

/** Aplica `cambiar(texto)` solo a los tramos de prosa: deja intactos los bloques con valla. */
function porProsa(md, cambiar) {
  const lineas = md.split('\n');
  const salida = [];
  let prosa = [];
  let valla = null;
  const vaciar = () => {
    if (prosa.length) salida.push(cambiar(prosa.join('\n')));
    prosa = [];
  };
  for (const linea of lineas) {
    if (valla) {
      salida.push(linea);
      if (new RegExp(`^[ \\t]*${valla[0] === '`' ? '`' : '~'}{${valla.length},}[ \\t]*$`).test(linea)) valla = null;
      continue;
    }
    const abre = /^[ \t]*(`{3,}|~{3,})/.exec(linea);
    if (abre) {
      vaciar();
      valla = abre[1];
      salida.push(linea);
      continue;
    }
    prosa.push(linea);
  }
  vaciar();
  return salida.join('\n');
}

/** Dentro de la prosa, protege el código en línea y los comentarios HTML. */
function fueraDeCodigo(texto, cambiar) {
  const protegidos = [];
  const marca = (m) => `\u0000${protegidos.push(m) - 1}\u0000`;
  const t = texto.replace(/<!--[\s\S]*?-->/g, marca).replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, marca);
  // Un tramo protegido puede llevar dentro la marca de otro (un comentario con código en línea, por ejemplo):
  // se restaura en bucle hasta que no quede ninguna marca.
  let salida = cambiar(t);
  while (/\u0000\d+\u0000/.test(salida)) salida = salida.replace(/\u0000(\d+)\u0000/g, (_, i) => protegidos[Number(i)]);
  return salida;
}

/**
 * Devuelve `md` con cada destino de enlace (en línea, de referencia, autoenlace y href/src de HTML) reemplazado
 * por `cambiar(destino)`.
 */
export function reescribirEnlaces(md, cambiar) {
  return porProsa(md, (prosa) =>
    fueraDeCodigo(prosa, (t) =>
      t
        // [texto](destino "título") e imágenes.
        .replace(/\]\(([ \t]*)(<[^>\n]*>|[^)\s]+)/g, (_, esp, d) => `](${esp}${d.startsWith('<') ? `<${cambiar(d.slice(1, -1))}>` : cambiar(d)}`)
        // [ref]: destino
        .replace(/^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm, (_, pre, d) => pre + (d.startsWith('<') ? `<${cambiar(d.slice(1, -1))}>` : cambiar(d)))
        // href="…" y src="…"
        .replace(/\b(href|src)=(["'])([^"'\n]*)\2/g, (_, attr, q, d) => `${attr}=${q}${cambiar(d)}${q}`),
    ),
  );
}

/**
 * Enlace de un Markdown del repositorio (`fuente`, ruta desde la raíz) → enlace del sitio.
 * - Absolutos (`https:`, `mailto:`, `//`), anclas de la misma página y rutas del sitio (`/…`): tal cual.
 * - Otro documento con página en el sitio (`mapa`: ruta del repositorio → `/ruta/del/sitio/`): esa página.
 * - El resto: el archivo o la carpeta en GitHub.
 */
export function resolverEnlace(href, fuente, mapa) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
  const [ruta, ancla] = href.split('#');
  if (!ruta) return href;
  const enRepo = posix.normalize(posix.join(posix.dirname(fuente), decodeURI(ruta))).replace(/\/$/, '');
  const pagina = mapa.get(enRepo);
  if (typeof pagina === 'function') {
    const destino = pagina(ancla);
    if (destino) return destino;
  } else if (pagina) {
    return pagina + (ancla ? `#${ancla}` : '');
  }
  const tipo = existsSync(join(RAIZ, enRepo)) && !/\.[a-z0-9]+$/i.test(enRepo) ? 'tree' : 'blob';
  return `${REPO}/${tipo}/main/${encodeURI(enRepo)}${ancla ? `#${ancla}` : ''}`;
}
