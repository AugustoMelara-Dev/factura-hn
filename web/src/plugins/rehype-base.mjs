// Plugin de rehype: añade la base del sitio (p. ej. `/factura-hn`) a los enlaces absolutos internos del contenido.
// Las páginas escriben `[CAI](/conceptos/cai/)`; en GitHub Pages el sitio vive en `/factura-hn/`, así que el
// enlace final es `/factura-hn/conceptos/cai/`. No toca los enlaces externos (`https:`, `//…`, `mailto:`), las
// anclas de la misma página ni los que ya llevan la base.

const ATRIBUTOS = { a: 'href', img: 'src', iframe: 'src', source: 'src', link: 'href' };

/** `/ruta` → `<base>/ruta`, si es interno y aún no lleva la base. */
export function conBase(url, base) {
  if (!base || typeof url !== 'string') return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}#`) || url.startsWith(`${base}?`)) return url;
  return base + url;
}

export default function rehypeBase({ base = '' } = {}) {
  const recorrer = (nodo) => {
    if (nodo.type === 'element') {
      const atributo = ATRIBUTOS[nodo.tagName];
      if (atributo && nodo.properties?.[atributo] != null) nodo.properties[atributo] = conBase(String(nodo.properties[atributo]), base);
    } else if (nodo.type === 'raw' && typeof nodo.value === 'string') {
      // HTML escrito tal cual en el Markdown (un <iframe>, un <a>): llega como texto sin analizar.
      nodo.value = nodo.value.replace(/(\s(?:href|src)=)(["'])(\/[^"']*)\2/g, (_, attr, q, url) => `${attr}${q}${conBase(url, base)}${q}`);
    }
    if (nodo.children) for (const hijo of nodo.children) recorrer(hijo);
  };
  return (arbol) => recorrer(arbol);
}
