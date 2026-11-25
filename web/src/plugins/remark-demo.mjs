// Plugin de remark: deja en cada Markdown solo la versión que corresponde a la demostración pública (en línea o no)
// y pone su URL real donde dice `https://API_DE_LA_DEMO`. Las reglas son las de `filtrarDemo` en sitio.config.mjs
// (la que usan las copias para IA): `<!-- con-demo -->…<!-- /con-demo -->` y `<!-- sin-demo -->…<!-- /sin-demo -->`,
// cada marcador solo en su línea y fuera de listas o tablas.
import { MARCADOR_API } from '../../sitio.config.mjs';

const MARCADOR = /^<!--\s*(\/?)(con|sin)-demo\s*-->$/;

export default function remarkDemo({ api = null } = {}) {
  const quitar = api ? 'sin' : 'con';
  const reemplazar = (nodo) => {
    for (const campo of ['value', 'url']) {
      if (typeof nodo[campo] === 'string' && nodo[campo].includes(MARCADOR_API)) nodo[campo] = nodo[campo].replaceAll(MARCADOR_API, api ?? MARCADOR_API);
    }
    if (nodo.children) for (const hijo of nodo.children) reemplazar(hijo);
  };
  return (arbol) => {
    let saltando = false;
    arbol.children = arbol.children.filter((nodo) => {
      const m = nodo.type === 'html' && MARCADOR.exec(nodo.value.trim());
      if (m) {
        if (m[2] === quitar) saltando = !m[1];
        return false;
      }
      return !saltando;
    });
    reemplazar(arbol);
  };
}
