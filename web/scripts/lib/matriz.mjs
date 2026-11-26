// Matriz de cumplimiento generada desde las pruebas.
//
// La fuente son las tablas de docs/cumplimiento.md: cada fila cita, en la columna «Prueba», el archivo de
// prueba y el título de la prueba entre comillas latinas («…»; los puntos suspensivos abrevian el título). Este
// módulo lee esas referencias, las busca en el código de las pruebas y genera la tabla requisito → artículo →
// prueba (enlace a la línea en GitHub). Cada fila es un requisito implementado (✅ en la columna «factura-hn»): si
// se queda sin prueba, o cita un archivo o un título que ya no existe, `verificarMatriz` lo reporta y `pnpm sitio`
// falla.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, REPO } from '../../sitio.config.mjs';

const IMPLEMENTADO = '✅';

/**
 * Las tablas de la matriz: [{ titulo, filas: [{ celdas por nombre de columna }] }]. Una tabla es de la matriz si su
 * cabecera tiene las columnas «#» y «Prueba»; el título es el encabezado `##` o `###` anterior.
 */
export function leerTablas(texto) {
  const tablas = [];
  let titulo = '';
  let cabecera = null;
  let deMatriz = false;
  for (const linea of texto.split('\n')) {
    const h = /^#{2,3} (.+)/.exec(linea);
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
      deMatriz = celdas.includes('#') && celdas.includes('Prueba');
      if (deMatriz) tablas.push({ titulo, filas: [] });
      continue;
    }
    if (!deMatriz || celdas.every((c) => /^:?-+:?$/.test(c))) continue;
    tablas.at(-1).filas.push(Object.fromEntries(cabecera.map((c, i) => [c, celdas[i] ?? ''])));
  }
  if (!tablas.length) throw new Error('docs/cumplimiento.md: no hay tablas con las columnas «#» y «Prueba»');
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
export function construirMatriz(texto = readFileSync(join(RAIZ, 'docs/cumplimiento.md'), 'utf8')) {
  const problemas = [];
  const codigoDe = new Map();
  const tablas = leerTablas(texto).map(({ titulo, filas }) => ({
    titulo,
    filas: filas.map((fila) => {
      const numero = (columna(fila, /^#$/) ?? '').replace(/\*\*/g, '');
      const donde = `${titulo}, fila ${numero}`;
      const implementado = columna(fila, /^factura-hn/) ?? '';
      if (!implementado.startsWith(IMPLEMENTADO)) problemas.push(`${donde}: la columna «factura-hn» no empieza por ${IMPLEMENTADO}`);
      const { refs, errores } = referencias(columna(fila, /^Prueba$/) ?? '');
      for (const e of errores) problemas.push(`${donde}: ${e}`);
      if (!refs.length) problemas.push(`${donde}: sin prueba en la columna «Prueba»`);
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
    throw new Error(`Matriz de cumplimiento (docs/cumplimiento.md): hay reglas sin prueba verificable.\n  ${r.problemas.join('\n  ')}`);
  }
  return r;
}

const sinSimbolos = (s) => s.replaceAll(IMPLEMENTADO, '').replace(/\s+/g, ' ').trim();
const celda = (s) => s.replace(/\|/g, '\|');

/** La página: una tabla por sección, cada requisito con su artículo y la prueba que lo verifica. */
export function matrizMarkdown({ tablas }) {
  let md = `Cada requisito del Reglamento del Régimen de Facturación y de la Ley del Impuesto Sobre Ventas que implementa
factura-hn, con su artículo y la prueba que lo verifica. «10.7» es el Art. 10, numeral 7, y «contrato» es la batería
\`ejecutarContratoAlmacen\` de \`factura-hn/pruebas\`, que corre en memoria, SQLite y PostgreSQL.
`;
  for (const { titulo, filas } of tablas) {
    const implementadas = filas.filter((f) => f.pruebas.length);
    if (!implementadas.length) continue;
    md += `\n## ${titulo}\n\n| Artículo | Requisito | Prueba |\n|---|---|---|\n`;
    for (const f of implementadas) {
      const pruebas = f.pruebas
        .map((p) => {
          const url = `${REPO}/blob/main/${p.ruta}${p.linea ? `#L${p.linea}` : ''}`;
          const nombre = p.archivo === 'contrato' ? 'contrato' : p.ruta.split('/').at(-1);
          return `[\`${nombre}\`${p.titulo ? ` «${p.titulo}»` : ''}](${url})`;
        })
        .join('<br>');
      md += `| ${celda(f.numero)} | ${celda(sinSimbolos(f.requisito))} | ${celda(pruebas)} |\n`;
    }
  }
  return md;
}
