// Enlaces relativos de la documentación publicada que apuntan a algo que no viaja en el paquete. En npmjs.com y
// dentro de node_modules no existe el resto del repositorio: `../core` o `examples/basico` quedan rotos.
// Lo usa verificar-dist.mjs; las pruebas están en enlaces.test.mjs.

/** Documentos que se revisan: los .md y llms.txt. */
export const esDocumento = (ruta) => /\.md$/i.test(ruta) || /(^|\/)llms\.txt$/i.test(ruta);

/** El texto sin código: bloques con valla (``` o ~~~, de 3 o más, con cualquier sangría), código en línea y comentarios HTML. */
export function sinCodigo(texto) {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[`~]*[ \t]*$|(?![\s\S]))/gm, '')
    .replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** Destino de un enlace en línea a partir de `desde` (justo después de `](`): `<con espacios>` o con paréntesis balanceados. */
function destinoEnLinea(texto, desde) {
  let i = desde;
  while (texto[i] === ' ' || texto[i] === '\t' || texto[i] === '\n') i++;
  if (texto[i] === '<') {
    const fin = texto.indexOf('>', i);
    const dentro = fin < 0 ? '' : texto.slice(i + 1, fin);
    return dentro.includes('\n') ? null : dentro;
  }
  let nivel = 0;
  let r = '';
  for (; i < texto.length; i++) {
    const c = texto[i];
    if (c === '\\' && i + 1 < texto.length) {
      r += texto[++i];
      continue;
    }
    if (/\s/.test(c)) break; // lo que sigue es el título: "…", '…' o (…)
    if (c === '(') nivel++;
    if (c === ')') {
      if (!nivel) break;
      nivel--;
    }
    r += c;
  }
  return r;
}

/** Todos los destinos de enlace de un documento Markdown, fuera del código. */
export function destinosDe(texto) {
  const t = sinCodigo(texto);
  const destinos = [];
  // Enlaces e imágenes en línea: [texto](destino "título").
  for (const m of t.matchAll(/\]\(/g)) {
    const d = destinoEnLinea(t, m.index + 2);
    if (d) destinos.push(d);
  }
  // Definiciones de referencia: [r]: destino "título".
  for (const m of t.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]*)>|(\S+))/gm)) destinos.push(m[1] ?? m[2]);
  // Autoenlaces: <https://…> y también <../core> o <docs/api.md>. Quedan fuera las etiquetas HTML (<br/>, </div>).
  for (const m of t.matchAll(/<([^<>\s"']+)>/g)) {
    if (/^\/?[a-z][a-z0-9-]*\s*\/?$/i.test(m[1])) continue;
    if (/^[^/]+@[^/]+$/.test(m[1])) continue; // correo
    if (/[/.:#]/.test(m[1])) destinos.push(m[1]);
  }
  // HTML: href="…" y src="…".
  for (const m of t.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) destinos.push(m[1] ?? m[2]);
  return [...new Set(destinos)];
}

/**
 * Ruta dentro del paquete a la que lleva `destino` desde el documento `doc`, o null si sale del paquete.
 * Los destinos absolutos (con esquema, `//…`, `mailto:`) y las anclas de la misma página devuelven undefined.
 */
export function resolver(doc, destino) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(destino)) return undefined;
  let ruta = destino.replace(/[?#].*$/, '');
  try {
    ruta = decodeURIComponent(ruta);
  } catch {
    // Un «%» suelto: se revisa tal cual.
  }
  if (ruta.startsWith('/')) return null;
  const partes = [];
  for (const p of [...doc.split('/').slice(0, -1), ...ruta.split('/')]) {
    if (p === '..') {
      if (!partes.length) return null;
      partes.pop();
    } else if (p && p !== '.') partes.push(p);
  }
  return partes.join('/');
}

/**
 * Enlaces rotos de los documentos de un paquete. `archivos`: Map de ruta (sin el prefijo `package/`) a contenido
 * (Buffer o texto). Devuelve pares [documento, destino].
 */
export function enlacesRotos(archivos) {
  const rutas = [...archivos.keys()];
  const existe = (r) => r === '' || rutas.includes(r) || rutas.some((f) => f.startsWith(`${r.replace(/\/$/, '')}/`));
  const rotos = [];
  for (const [doc, contenido] of archivos) {
    if (!esDocumento(doc)) continue;
    for (const destino of destinosDe(contenido.toString('utf8'))) {
      const r = resolver(doc, destino);
      if (r === undefined) continue;
      if (r === null || !existe(r)) rotos.push([doc, destino]);
    }
  }
  return rotos;
}
