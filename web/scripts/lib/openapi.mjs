// Referencia de la API REST generada de packages/api/openapi.json, en Markdown y en español.
// Orden (como la referencia de Stripe): autenticación, errores, idempotencia y paginación; después las rutas por
// etiqueta y los esquemas. Es contenido normal del sitio, así que Pagefind lo indexa.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import GithubSlugger from 'github-slugger';
import { RAIZ, REPO } from '../../sitio.config.mjs';
import { EJEMPLOS, PREAMBULO, VARIABLES, variablesDe } from './ejemplos-openapi.mjs';

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

/** Orden de los grupos (etiquetas del OpenAPI): primero lo que más se usa. Una etiqueta nueva va al final. */
const ORDEN_GRUPOS = ['Documentos', 'Series', 'Autorizaciones', 'Emisor', 'Reportes', 'Auditoría', 'Llaves', 'Webhooks', 'Sesión', 'Sistema'];
const posicionGrupo = (g) => (ORDEN_GRUPOS.includes(g) ? ORDEN_GRUPOS.indexOf(g) : 500);

/** «MÉTODO /ruta» de cada operación que publica la referencia. */
export function operacionesPublicadas(spec) {
  const ops = [];
  for (const [ruta, metodos] of Object.entries(spec.paths ?? {})) {
    for (const metodo of Object.keys(metodos)) if (METODOS.includes(metodo)) ops.push(`${metodo.toUpperCase()} ${ruta}`);
  }
  return ops;
}

/**
 * Las llaves y los secretos de una respuesta real, recortados al prefijo y «…». Son de una instalación de prueba
 * que ya no existe, pero un secreto entero en la documentación parece uno que se puede usar.
 */
export function ocultarSecretos(valor) {
  if (typeof valor === 'string') return valor.replace(/\b(fhn(?:mcp)?_(?:test_|live_)?[A-Za-z0-9]{6})[A-Za-z0-9_-]{12,}/g, '$1…');
  if (Array.isArray(valor)) return valor.map(ocultarSecretos);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [
        k,
        /^(secreto|secretoAnterior|llave|token)$/.test(k) && typeof v === 'string' && v.length > 16 ? `${v.slice(0, 10)}…` : ocultarSecretos(v),
      ]),
    );
  }
  return valor;
}

/** Respuestas reales de los ejemplos, guardadas por scripts/capturar-ejemplos-openapi.mjs. */
export function respuestasCapturadas() {
  const archivo = join(RAIZ, 'web/scripts/lib/ejemplos-openapi.json');
  return existsSync(archivo) ? JSON.parse(readFileSync(archivo, 'utf8')) : {};
}

/** Texto de la especificación → Markdown seguro: `<algo>` fuera del código no debe leerse como HTML. */
const md = (s = '') =>
  String(s)
    .split(/(`[^`]*`)/)
    .map((t, i) => (i % 2 ? t : t.replace(/</g, '&lt;').replace(/>/g, '&gt;')))
    .join('');
/** Lo mismo, para una celda de tabla: sin saltos de línea ni barras sueltas. */
const celda = (s = '') => md(s).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');

export function referenciaApi(spec = JSON.parse(readFileSync(join(RAIZ, 'packages/api/openapi.json'), 'utf8')), capturadas = respuestasCapturadas()) {
  const esquemas = spec.components?.schemas ?? {};
  const nombreRef = (ref) => ref.split('/').at(-1);

  // Los ids de los encabezados los calcula github-slugger, igual que Astro. Como los enlaces a los esquemas se
  // escriben antes que sus encabezados, primero van con una marca ({{ancla:clave}}) y al final se reemplazan.
  const slugger = new GithubSlugger();
  const anclas = new Map();
  const encabezado = (nivel, texto, clave, visible = texto) => {
    const id = slugger.slug(texto);
    if (clave) anclas.set(clave, id);
    return `\n${'#'.repeat(nivel)} ${visible}\n\n`;
  };
  const ancla = (clave) => `{{ancla:${clave}}}`;

  const tipo = (s) => {
    if (!s) return '';
    if (s.$ref) return `[\`${nombreRef(s.$ref)}\`](#${ancla(`esquema:${nombreRef(s.$ref)}`)})`;
    if (s.enum) return s.enum.map((v) => `\`${JSON.stringify(v)}\``).join(' \\| ');
    for (const k of ['anyOf', 'oneOf', 'allOf']) if (s[k]) return s[k].map(tipo).join(k === 'allOf' ? ' y ' : ' o ');
    const t = Array.isArray(s.type) ? s.type.join(' \\| ') : s.type;
    if (t === 'array') return `arreglo de ${tipo(s.items) || 'valores'}`;
    if (t === 'object' && s.properties) return 'objeto';
    return `\`${t ?? 'cualquiera'}\`${s.format ? ` (${s.format})` : ''}`;
  };
  const restricciones = (s = {}) => {
    const r = [];
    if (s.pattern) r.push(`patrón \`${s.pattern}\``);
    if (s.minimum !== undefined || s.maximum !== undefined) r.push(`de ${s.minimum ?? '…'} a ${s.maximum ?? '…'}`);
    if (s.minLength !== undefined || s.maxLength !== undefined) r.push(`longitud de ${s.minLength ?? 0} a ${s.maxLength ?? '…'}`);
    if (s.default !== undefined) r.push(`por defecto \`${JSON.stringify(s.default)}\``);
    if (s.example !== undefined) r.push(`ejemplo \`${JSON.stringify(s.example)}\``);
    return r.length ? ` (${r.join('; ')})` : '';
  };
  const tablaPropiedades = (s) => {
    if (s?.$ref) s = esquemas[nombreRef(s.$ref)];
    if (!s?.properties) return s ? `Tipo: ${tipo(s)}\n` : '';
    const req = new Set(s.required ?? []);
    const filas = Object.entries(s.properties).map(
      ([k, v]) => `| \`${k}\`${req.has(k) ? ' (obligatorio)' : ''} | ${tipo(v)} | ${celda(v.description ?? '')}${celda(restricciones(v))} |`,
    );
    return `| Campo | Tipo | Descripción |\n|---|---|---|\n${filas.join('\n')}\n`;
  };

  const json = (v) => JSON.stringify(v, null, 2);
  const ejemplos = new Map(EJEMPLOS.map((e) => [e.op, e]));

  /** El curl de una operación (lib/ejemplos-openapi.mjs) y su respuesta real (lib/ejemplos-openapi.json). */
  const ejemploDe = ({ metodo, ruta }) => {
    const clave = `${metodo.toUpperCase()} ${ruta}`;
    const ejemplo = ejemplos.get(clave);
    const respuesta = capturadas[clave];
    if (!ejemplo || !respuesta) {
      throw new Error(
        `Referencia de la API: ${clave} no tiene ${ejemplo ? 'respuesta capturada' : 'ejemplo'}. Agrégalo en web/scripts/lib/ejemplos-openapi.mjs ` +
          'y corre web/scripts/capturar-ejemplos-openapi.mjs contra una API nueva.',
      );
    }
    return { ...ejemplo, respuesta };
  };
  /** Una respuesta de texto, recortada a sus primeras líneas. */
  const recortar = (texto, max = 12) => {
    const l = String(texto).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    return l.length > max ? `${l.slice(0, max).join('\n')}\n…` : l.join('\n');
  };

  const operaciones = [];
  for (const [ruta, metodos] of Object.entries(spec.paths ?? {})) {
    for (const [metodo, op] of Object.entries(metodos)) {
      if (!METODOS.includes(metodo)) continue;
      const parametros = (op.parameters ?? []).map((p) => (p.$ref ? spec.components.parameters[nombreRef(p.$ref)] : p));
      operaciones.push({ ruta, metodo, op, parametros, grupo: op.tags?.[0] ?? 'Otros', clave: `op:${operaciones.length}` });
    }
  }
  // Por grupo en el orden de ORDEN_GRUPOS; dentro de cada grupo, el orden de la especificación.
  operaciones.sort((a, b) => posicionGrupo(a.grupo) - posicionGrupo(b.grupo));
  const grupos = [...new Set(operaciones.map((o) => o.grupo))];
  const publicas = operaciones.filter((o) => !(o.op.security ?? spec.security ?? []).length);
  const enlaceOp = (o) => `[\`${o.metodo.toUpperCase()} ${o.ruta}\`](#${ancla(o.clave)})`;

  let s = `Generada de [\`openapi.json\`](${REPO}/blob/main/packages/api/openapi.json) (OpenAPI ${spec.openapi}, versión
${spec.info?.version ?? ''}). Tu servidor la sirve en \`/openapi.json\` y la documentación interactiva en \`/docs\`. Cómo
levantar la API, los roles, los webhooks y la seguridad están en la [guía de la API REST](/referencia/api/).

Cada ruta trae un curl que corre tal cual y la respuesta real que dio en una instalación nueva, levantada con
\`docker compose up -d --build --wait\` (ver [Autoalojar la API](/guias/autoalojar/)). Los ejemplos son de bash:
Linux, macOS, Git Bash o WSL en Windows. Antes, en la carpeta del repositorio, pega una vez:

\`\`\`bash
${PREAMBULO}
\`\`\`

\`LLAVE\` emite y consulta en la caja 000-001; \`ADMIN\` anula y configura el emisor, los CAI, las llaves y los webhooks. Las dos
son del tenant \`demo\`, con CAI ficticio: nada de lo que emitas ahí tiene validez fiscal. Los números, los \`id\` y las
fechas de tus respuestas serán otros.

${md(spec.info?.description ?? '')}
`;

  // --- Autenticación ---
  s += encabezado(2, 'Autenticación', 'autenticacion');
  for (const [nombre, esquema] of Object.entries(spec.components?.securitySchemes ?? {})) {
    const cabecera = esquema.type === 'http' && esquema.scheme === 'bearer' ? 'Authorization: Bearer <llave>' : esquema.name ?? nombre;
    s += `Cada ruta, salvo las públicas, lleva la cabecera \`${cabecera}\`. ${md(esquema.description ?? '')}\n\n`;
  }
  s += `Sin llave o con una llave inválida la respuesta es \`401\`; con una llave sin permiso para la ruta, \`403\`.\n\n`;
  if (publicas.length) s += `Rutas públicas (sin llave): ${publicas.map(enlaceOp).join(', ')}.\n`;

  // --- Errores ---
  s += encabezado(2, 'Errores', 'errores');
  s += `Toda respuesta de error trae el objeto ${tipo({ $ref: '#/components/schemas/Error' })}. Compara siempre \`error.codigo\`,
nunca el texto. Qué hacer ante cada código: [catálogo de errores](/referencia/errores/).\n\n`;
  if (esquemas.Error) s += tablaPropiedades(esquemas.Error);
  const codigos = new Map();
  for (const o of operaciones) {
    for (const [codigo, r] of Object.entries(o.op.responses ?? {})) {
      if (!/^[45]/.test(codigo)) continue;
      if (!codigos.has(codigo)) codigos.set(codigo, new Set());
      codigos.get(codigo).add(r.description ?? '');
    }
  }
  s += `\nCódigos HTTP de error que usan las rutas:\n\n| Código | Significado |\n|---|---|\n`;
  for (const [codigo, descripciones] of [...codigos].sort(([a], [b]) => a.localeCompare(b))) {
    s += `| \`${codigo}\` | ${[...descripciones].map(celda).join('; ')} |\n`;
  }

  // --- Idempotencia ---
  s += encabezado(2, 'Idempotencia', 'idempotencia');
  const idempotentes = operaciones.filter((o) => o.parametros.some((p) => p.in === 'header' && /^idempotency-key$/i.test(p.name)));
  for (const o of idempotentes) {
    const p = o.parametros.find((x) => /^idempotency-key$/i.test(x.name));
    s += `${enlaceOp(o)} exige la cabecera \`Idempotency-Key\`${p.required ? ' (obligatoria)' : ''}: ${md(p.description ?? '')}\n\n`;
    if (o.op.description) s += `${md(o.op.description)}\n\n`;
  }
  if (!idempotentes.length) s += 'Ninguna ruta declara la cabecera `Idempotency-Key`.\n';

  // --- Paginación ---
  s += encabezado(2, 'Paginación', 'paginacion');
  const paginadas = operaciones.filter((o) => o.parametros.some((p) => p.name === 'cursor'));
  s += `Las listas responden \`{ <plural>, hayMas, siguiente }\`. Si \`hayMas\` es verdadero, pide la página siguiente con
\`?cursor=<siguiente>\`.\n\n`;
  const ejemplo = paginadas[0];
  if (ejemplo) {
    s += '| Parámetro | Tipo | Descripción |\n|---|---|---|\n';
    for (const p of ejemplo.parametros.filter((x) => ['limite', 'cursor'].includes(x.name))) {
      s += `| \`${p.name}\` | ${tipo(p.schema)} | ${celda(p.description ?? p.schema?.description ?? '')}${celda(restricciones(p.schema))} |\n`;
    }
    s += `\nRutas paginadas: ${paginadas.map(enlaceOp).join(', ')}.\n`;
  }

  // --- Rutas ---
  s += encabezado(2, 'Rutas', 'rutas');
  s += '| Método | Ruta | Qué hace |\n|---|---|---|\n';
  for (const o of operaciones) {
    s += `| <span class="fhn-metodo ${o.metodo}">${o.metodo.toUpperCase()}</span> | [\`${o.ruta}\`](#${ancla(o.clave)}) | ${celda(o.op.summary ?? '')} |\n`;
  }
  for (const g of grupos) {
    s += encabezado(2, g, `grupo:${grupos.indexOf(g)}`);
    for (const o of operaciones.filter((x) => x.grupo === g)) {
      const { op, metodo, ruta, parametros } = o;
      s += encabezado(3, `${metodo.toUpperCase()} ${ruta}`, o.clave, `<span class="fhn-metodo ${metodo}">${metodo.toUpperCase()}</span> \`${ruta}\``);
      s += `**${md(op.summary ?? '')}** · ${(op.security ?? spec.security ?? []).length ? 'requiere llave' : 'pública'}\n\n`;
      if (op.description) s += `${md(op.description)}\n\n`;
      if (parametros.length) {
        s += '| Parámetro | En | Tipo | Descripción |\n|---|---|---|---|\n';
        for (const p of parametros) {
          s += `| \`${p.name}\`${p.required ? ' (obligatorio)' : ''} | ${p.in} | ${tipo(p.schema)} | ${celda(p.description ?? p.schema?.description ?? '')}${celda(restricciones(p.schema))} |\n`;
        }
        s += '\n';
      }
      const cuerpo = op.requestBody?.content?.['application/json']?.schema;
      if (cuerpo) s += `Cuerpo (JSON): ${tipo(cuerpo)}\n\n`;
      const { curl, nota, respuesta } = ejemploDe(o);
      const usa = variablesDe(curl);
      if (usa.length) s += `${usa.map((v) => `\`$${v}\` es ${VARIABLES[v].texto}`).join('; ')}.\n\n`;
      s += `\`\`\`bash\n${curl}\n\`\`\`\n\n`;
      if (nota) s += `${nota}\n\n`;
      const tipoR = respuesta.tipo ? ` (\`${respuesta.tipo}\`)` : '';
      if (respuesta.tipo === 'application/json') {
        s += `Respuesta \`${respuesta.codigo}\`:\n\n\`\`\`json\n${json(respuesta.cuerpo)}\n\`\`\`\n\n`;
      } else if (respuesta.cuerpo) {
        s += `Respuesta \`${respuesta.codigo}\`${tipoR}:\n\n\`\`\`text\n${recortar(respuesta.cuerpo)}\n\`\`\`\n\n`;
      } else {
        s += `Respuesta \`${respuesta.codigo}\`, sin cuerpo.\n\n`;
      }
      s += '| Respuesta | Descripción | Cuerpo |\n|---|---|---|\n';
      for (const [codigo, r] of Object.entries(op.responses ?? {})) {
        const contenido = Object.entries(r.content ?? {});
        const cuerpoR = contenido.map(([tipoMime, c]) => (c.schema ? `${tipo(c.schema)}${tipoMime === 'application/json' ? '' : ` (${tipoMime})`}` : `\`${tipoMime}\``)).join(', ');
        s += `| \`${codigo}\` | ${celda(r.description ?? '')} | ${cuerpoR} |\n`;
      }
    }
  }

  // --- Esquemas ---
  s += encabezado(2, 'Esquemas', 'esquemas');
  for (const [nombre, esquema] of Object.entries(esquemas)) {
    s += encabezado(3, nombre, `esquema:${nombre}`, `\`${nombre}\``);
    if (esquema.description) s += `${md(esquema.description)}\n\n`;
    s += tablaPropiedades(esquema);
  }

  const faltan = [];
  s = s.replace(/\{\{ancla:([^}]+)\}\}/g, (_, clave) => anclas.get(clave) ?? (faltan.push(clave), ''));
  if (faltan.length) throw new Error(`Referencia de la API: anclas sin encabezado: ${faltan.join(', ')}`);
  return s;
}
