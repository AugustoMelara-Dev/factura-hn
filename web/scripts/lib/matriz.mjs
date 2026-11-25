// Matriz de cumplimiento generada desde las pruebas.
//
// La fuente es la sección 1 de docs/investigacion.md: cada fila cita, en la columna «Prueba», el archivo de
// prueba y el título de la prueba entre comillas latinas («…»; los puntos suspensivos abrevian el título). Este
// módulo lee esas referencias, las busca en el código de las pruebas y genera la tabla requisito → artículo →
// prueba (enlace a la línea en GitHub) → estado. Si una fila cubierta o parcial se queda sin prueba, o cita un
// archivo o un título que ya no existe, `verificarMatriz` lo reporta y `pnpm sitio` falla.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, REPO } from '../../sitio.config.mjs';

export const ESTADOS = {
  '✅': { clase: 'cubierto', texto: 'Cubierto', exigePrueba: true },
  '🟡': { clase: 'parcial', texto: 'Parcial', exigePrueba: true },
  '❌': { clase: 'ausente', texto: 'Ausente', exigePrueba: false },
  '📄': { clase: 'documental', texto: 'Documental', exigePrueba: false },
  '➖': { clase: 'no-aplica', texto: 'No aplica', exigePrueba: false },
};
const SIMBOLO = new RegExp(`^(${Object.keys(ESTADOS).join('|')})`, 'u');

/** Las tablas de la sección 1: [{ titulo, filas: [{ celdas por nombre de columna }] }]. */
export function leerTablas(texto) {
  const inicio = texto.indexOf('\n## 1. ');
  const fin = texto.indexOf('\n## 2. ', inicio);
  if (inicio < 0 || fin < 0) throw new Error('docs/investigacion.md: no se encontró la sección «## 1.» de la matriz');
  const seccion = texto.slice(inicio, fin);
  const tablas = [];
  let titulo = '';
  let cabecera = null;
  for (const linea of seccion.split('\n')) {
    const h = /^### (.+)/.exec(linea);
    if (h) {
      titulo = h[1].trim();
      cabecera = null;
      continue;
    }
    if (!linea.startsWith('|')) {
      cabecera = null;
      continue;
    }
    const celdas = linea.slice(1, linea.trimEnd().endsWith('|') ? linea.trimEnd().length - 1 : undefined).split('|').map((c) => c.trim());
    if (!cabecera) {
      cabecera = celdas;
      tablas.push({ titulo, filas: [] });
      continue;
    }
    if (celdas.every((c) => /^:?-+:?$/.test(c))) continue;
    tablas.at(-1).filas.push(Object.fromEntries(cabecera.map((c, i) => [c, celdas[i] ?? ''])));
  }
  return tablas;
}

/** Columna por su nombre, tolerando cambios menores («factura-hn 0.2», «factura-hn 0.3»…). */
const columna = (fila, patron) => {
  const k = Object.keys(fila).find((c) => patron.test(c));
  return k === undefined ? undefined : fila[k];
};

/** Referencias de la celda «Prueba»: [{ archivo (tal como se cita), titulo? }]. */
export function referencias(celda) {
  const refs = [];
  const errores = [];
  let actual = null;
  for (const m of celda.matchAll(/contrato `factura-hn\/pruebas`|`([^`]+\.test\.[cm]?[tj]s)`|«([^»]*)»/g)) {
    if (m[0].startsWith('contrato')) {
      actual = { archivo: 'contrato', titulos: [] };
      refs.push(actual);
    } else if (m[1]) {
      actual = { archivo: m[1], titulos: [] };
      refs.push(actual);
    } else if (actual) {
      actual.titulos.push(m[2]);
    } else {
      errores.push(`cita «${m[2]}» sin archivo de prueba antes`);
    }
  }
  return { refs, errores };
}

let pruebasDe;
/** Archivo citado → ruta en el repositorio. Sin carpeta, se busca en packages/core/test, packages/pdf/test y el resto. */
export function resolverArchivo(archivo) {
  if (archivo === 'contrato') return 'packages/core/src/pruebas/contrato.ts';
  if (archivo.includes('/')) {
    const ruta = archivo.startsWith('packages/') ? archivo : `packages/${archivo}`;
    return existsSync(join(RAIZ, ruta)) ? ruta : null;
  }
  pruebasDe ??= readdirSync(join(RAIZ, 'packages'))
    .sort((a, b) => ['core', 'pdf'].indexOf(b) - ['core', 'pdf'].indexOf(a))
    .flatMap((p) => {
      const dir = join(RAIZ, 'packages', p, 'test');
      return existsSync(dir) ? readdirSync(dir).map((f) => `packages/${p}/test/${f}`) : [];
    });
  return pruebasDe.find((r) => r.endsWith(`/${archivo}`)) ?? null;
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** La línea (1…n) de la prueba cuyo título contiene la cita, o 0. Los «…» de la cita valen por cualquier texto. */
export function lineaDelTitulo(codigo, cita) {
  const partes = cita.split('…').map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return 0;
  const patron = new RegExp(partes.map(escapar).join('[^\\n]*?'));
  const lineas = codigo.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    if (!patron.test(lineas[i])) continue;
    // Debe ser el título de una prueba o de un grupo, o un nombre de una tabla de casos (`it(nombre, …)`).
    const esPrueba = /\b(it|test|describe)(\.\w+)?\(\s*['"`]/.test(lineas[i]) || /^\s*\[\s*['"`]/.test(lineas[i]);
    if (esPrueba) return i + 1;
  }
  return 0;
}

/** Recorre la matriz y devuelve las filas con sus pruebas resueltas y la lista de problemas. */
export function construirMatriz(texto = readFileSync(join(RAIZ, 'docs/investigacion.md'), 'utf8')) {
  const problemas = [];
  const codigoDe = new Map();
  const tablas = leerTablas(texto).map(({ titulo, filas }) => ({
    titulo,
    filas: filas.map((fila) => {
      const numero = (columna(fila, /^#$/) ?? '').replace(/\*\*/g, '');
      const donde = `${titulo}, fila ${numero}`;
      const estadoCelda = columna(fila, /^factura-hn/) ?? '';
      const simbolo = SIMBOLO.exec(estadoCelda)?.[1];
      if (!simbolo) problemas.push(`${donde}: la columna de estado no empieza por ${Object.keys(ESTADOS).join(' ')}`);
      const estado = ESTADOS[simbolo] ?? { clase: 'desconocido', texto: '?', exigePrueba: false };
      const celdaPrueba = columna(fila, /^Prueba$/) ?? '';
      const { refs, errores } = referencias(celdaPrueba);
      for (const e of errores) problemas.push(`${donde}: ${e}`);
      if (estado.exigePrueba && !refs.length) problemas.push(`${donde}: estado «${estado.texto}» sin prueba en la columna «Prueba»`);
      const pruebas = [];
      for (const ref of refs) {
        const ruta = resolverArchivo(ref.archivo);
        if (!ruta) {
          problemas.push(`${donde}: no existe el archivo de prueba ${ref.archivo}`);
          continue;
        }
        if (!codigoDe.has(ruta)) codigoDe.set(ruta, readFileSync(join(RAIZ, ruta), 'utf8'));
        if (!ref.titulos.length) {
          if (!/\b(it|test)(\.\w+)?\(/.test(codigoDe.get(ruta))) problemas.push(`${donde}: ${ruta} no tiene pruebas`);
          pruebas.push({ ruta, archivo: ref.archivo, titulo: null, linea: 0 });
        }
        for (const titulo of ref.titulos) {
          const linea = lineaDelTitulo(codigoDe.get(ruta), titulo);
          if (!linea) problemas.push(`${donde}: ${ruta} no tiene una prueba titulada «${titulo}»`);
          pruebas.push({ ruta, archivo: ref.archivo, titulo, linea });
        }
      }
      return {
        numero,
        requisito: columna(fila, /^Requisito$/) ?? '',
        fuente: columna(fila, /^Fuente$/) ?? '',
        estado,
        detalle: estadoCelda.replace(SIMBOLO, '').trim(),
        notaPrueba: refs.length ? '' : celdaPrueba.replace(/^—\s*/, '').trim(),
        pruebas,
      };
    }),
  }));
  return { tablas, problemas };
}

/** Si alguna regla perdió su prueba, lanza con la lista. */
export function verificarMatriz(texto) {
  const r = construirMatriz(texto);
  if (r.problemas.length) {
    throw new Error(`Matriz de cumplimiento (docs/investigacion.md §1): hay reglas sin prueba verificable.\n  ${r.problemas.join('\n  ')}`);
  }
  return r;
}

const PALABRA = Object.fromEntries(Object.entries(ESTADOS).map(([s, e]) => [s, `(${e.texto.toLowerCase()})`]));
const sinSimbolos = (s) => s.replace(new RegExp(Object.keys(ESTADOS).join('|'), 'gu'), (m) => PALABRA[m]).replace(/\s+/g, ' ').trim();
const celda = (s) => s.replace(/\|/g, '\\|');

/** La página: Markdown con la leyenda y una tabla por sección. */
export function matrizMarkdown({ tablas }) {
  const total = tablas.flatMap((t) => t.filas);
  const cuenta = Object.values(ESTADOS).map((e) => `${total.filter((f) => f.estado === e).length} ${e.texto.toLowerCase()}`);
  let md = `Cada fila es un requisito del Reglamento del Régimen de Facturación (Acuerdo 481-2017, texto consolidado) o de la
Ley del Impuesto Sobre Ventas, con su artículo, cómo lo cumple factura-hn y la prueba que lo verifica. La tabla se
genera al construir el sitio desde la [matriz de investigación](${REPO}/blob/main/docs/investigacion.md#1-matriz-de-cumplimiento)
y desde el código de las pruebas: si una regla cubierta pierde su prueba, la construcción falla.

Filas: ${total.length} (${cuenta.join(', ')}).

**Estados.** <span class="fhn-estado cubierto">Cubierto</span> cubierto y probado ·
<span class="fhn-estado parcial">Parcial</span> cubierto en parte ·
<span class="fhn-estado ausente">Ausente</span> no implementado ·
<span class="fhn-estado documental">Documental</span> se cumple con documentación o trámite, sin cálculo que probar ·
<span class="fhn-estado no-aplica">No aplica</span> obligación del contribuyente, de la API o de la operación.

**Artículo.** «10.7» es el Art. 10, numeral 7. La fuente «C L.n» es la línea del texto consolidado del Reglamento e
«ISV L.n», la de la Ley del ISV; ver [normativa](/referencia/normativa/). «Contrato» es la batería
\`ejecutarContratoAlmacen\` de \`factura-hn/pruebas\`, que corre en memoria, SQLite y PostgreSQL.

:::note
factura-hn no es un sistema autorizado por el SAR. La matriz muestra cómo el código implementa cada requisito;
las interpretaciones pendientes están en las [decisiones](/referencia/decisiones/) marcadas [REVISAR] y en la
[consulta al SAR](/produccion/consulta-sar/).
:::
`;
  for (const { titulo, filas } of tablas) {
    md += `\n## ${titulo}\n\n| Artículo | Requisito | Estado | Prueba |\n|---|---|---|---|\n`;
    for (const f of filas) {
      const pruebas = f.pruebas.length
        ? f.pruebas
            .map((p) => {
              const url = `${REPO}/blob/main/${p.ruta}${p.linea ? `#L${p.linea}` : ''}`;
              const nombre = p.archivo === 'contrato' ? 'contrato' : p.ruta.split('/').at(-1);
              return `[\`${nombre}\`${p.titulo ? ` «${p.titulo}»` : ''}](${url})`;
            })
            .join('<br>')
        : f.notaPrueba
          ? `— (${f.notaPrueba.replace(/^\(|\)$/g, '')})`
          : '—';
      md += `| ${celda(`${f.numero}<br><small>${f.fuente}</small>`)} | ${celda(sinSimbolos(f.requisito))} | ${celda(`<span class="fhn-estado ${f.estado.clase}">${f.estado.texto}</span>${f.detalle ? ` ${sinSimbolos(f.detalle)}` : ''}`)} | ${celda(pruebas)} |\n`;
    }
  }
  return md;
}
