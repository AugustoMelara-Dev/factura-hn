// Referencia de la API REST generada de packages/api/openapi.json, en Markdown y en español.
// Orden (como la referencia de Stripe): autenticación, errores, idempotencia y paginación; después las rutas por
// etiqueta y los esquemas. Es contenido normal del sitio, así que Pagefind lo indexa.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import GithubSlugger from 'github-slugger';
import { RAIZ, REPO } from '../../sitio.config.mjs';

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Orden de los grupos (etiquetas del OpenAPI): primero lo que más se usa. Una etiqueta nueva va antes de
 * «Demostración», que siempre queda al final.
 */
const ORDEN_GRUPOS = ['Documentos', 'Series', 'Autorizaciones', 'Emisor', 'Reportes', 'Auditoría', 'Llaves', 'Webhooks', 'Sesión', 'Sistema'];
const posicionGrupo = (g) => (g === 'Demostración' ? 1000 : ORDEN_GRUPOS.includes(g) ? ORDEN_GRUPOS.indexOf(g) : 500);

/** Valores de ejemplo para los formatos sin `example` en la especificación. Datos ficticios. */
const POR_FORMATO = {
  date: '2026-11-18',
  'date-time': '2026-11-18T10:30:00-06:00',
  uuid: '0b6f9c3e-6a1d-4f7e-9a51-2f3c8d7e1a42',
  email: 'cliente@ejemplo.example',
  uri: 'https://ejemplo.example/webhooks/factura-hn',
};
/** Y por nombre de campo, para que el ejemplo se lea como un documento de prueba. Datos ficticios. */
const POR_CAMPO = {
  numero: '000-001-01-00000001',
  cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01',
  rtn: '99990000000001',
  razonSocial: 'Cliente de Prueba S. de R.L.',
  nombreImpreso: 'Cliente de Prueba',
  descripcion: 'Café molido 1 lb',
  rangoAutorizado: '000-001-01-00000001 al 000-001-01-00001000',
  fechaLimiteEmision: '2027-11-18',
  fechaEmision: '2026-11-18',
  fecha: '2026-11-18',
  horaEmision: '10:30:00',
  hora: '10:30:00',
  totalEnLetras: 'DOSCIENTOS TREINTA LEMPIRAS EXACTOS',
  establecimiento: '000',
  puntoEmision: '001',
  motivo: 'Error en el precio',
};

/** Texto de la especificación → Markdown seguro: `<algo>` fuera del código no debe leerse como HTML. */
const md = (s = '') =>
  String(s)
    .split(/(`[^`]*`)/)
    .map((t, i) => (i % 2 ? t : t.replace(/</g, '&lt;').replace(/>/g, '&gt;')))
    .join('');
/** Lo mismo, para una celda de tabla: sin saltos de línea ni barras sueltas. */
const celda = (s = '') => md(s).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');

export function referenciaApi(spec = JSON.parse(readFileSync(join(RAIZ, 'packages/api/openapi.json'), 'utf8'))) {
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

  /**
   * Un valor de ejemplo que cumple el esquema: su `example`, el primer valor de su `enum`, su `default` o uno
   * armado por tipo. `minimo` deja solo los campos obligatorios (para el cuerpo de una solicitud mínima).
   */
  const muestra = (s, { minimo = false, nivel = 0, campo } = {}) => {
    if (!s || nivel > 12) return null;
    if (s.$ref) return muestra(esquemas[nombreRef(s.$ref)], { minimo, nivel: nivel + 1, campo });
    const t0 = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
    if (campo && POR_CAMPO[campo] !== undefined && (t0 === 'string' || (!t0 && !s.properties)) && !s.enum) return POR_CAMPO[campo];
    if (s.example !== undefined) return s.example;
    if (s.examples?.length) return s.examples[0];
    if (s.const !== undefined) return s.const;
    if (s.enum) return s.enum[0];
    if (s.default !== undefined) return s.default;
    if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => muestra(x, { minimo, nivel: nivel + 1 }) ?? {}));
    for (const k of ['oneOf', 'anyOf']) {
      if (s[k]) return muestra(s[k].find((x) => x.type !== 'null') ?? s[k][0], { minimo, nivel: nivel + 1 });
    }
    const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
    if (t === 'object' || s.properties) {
      const req = new Set(s.required ?? []);
      const props = Object.entries(s.properties ?? {}).filter(([k]) => !minimo || req.has(k));
      return Object.fromEntries(props.map(([k, v]) => [k, muestra(v, { minimo, nivel: nivel + 1, campo: k })]));
    }
    if (t === 'array') return [muestra(s.items, { minimo, nivel: nivel + 1 })].filter((x) => x !== null);
    if (t === 'integer') return s.minimum ?? 1;
    if (t === 'number') return s.minimum ?? 0;
    if (t === 'boolean') return true;
    if (t === 'string') return POR_FORMATO[s.format] ?? (s.minLength > 5 ? 'x'.repeat(s.minLength) : 'texto');
    return null;
  };
  const json = (v) => JSON.stringify(v, null, 2);

  /** curl mínimo de una operación: la llave si la pide, la idempotencia si la exige y el cuerpo con lo obligatorio. */
  const curlDe = ({ metodo, ruta, op, parametros }) => {
    const valorParametro = (p) => {
      const v = p.example ?? p.schema?.example ?? muestra(p.schema);
      return encodeURIComponent(String(v ?? p.name));
    };
    let url = ruta.replace(/\{([^}]+)\}/g, (_, n) => valorParametro(parametros.find((p) => p.in === 'path' && p.name === n) ?? { name: n }));
    const consulta = parametros.filter((p) => p.in === 'query' && p.required);
    if (consulta.length) url += `?${consulta.map((p) => `${p.name}=${valorParametro(p)}`).join('&')}`;
    const lineas = [`curl${metodo === 'get' ? '' : ` -X ${metodo.toUpperCase()}`} "$API${url}"`];
    if ((op.security ?? spec.security ?? []).length) lineas.push('-H "authorization: Bearer $LLAVE"');
    for (const p of parametros.filter((x) => x.in === 'header' && x.required)) {
      lineas.push(`-H "${p.name.toLowerCase()}: ${/^idempotency-key$/i.test(p.name) ? '$(uuidgen)' : valorParametro(p)}"`);
    }
    const cuerpo = op.requestBody?.content?.['application/json']?.schema;
    if (cuerpo) {
      lineas.push('-H "content-type: application/json"');
      lineas.push(`-d '${JSON.stringify(muestra(cuerpo, { minimo: true }) ?? {})}'`);
    }
    return lineas.join(' \\\n  ');
  };

  /** La primera respuesta 2xx con JSON, con su código y un ejemplo. */
  const respuestaDe = (op) => {
    for (const [codigo, r] of Object.entries(op.responses ?? {})) {
      if (!/^2/.test(codigo)) continue;
      const c = r.content?.['application/json'];
      if (!c) return { codigo, ejemplo: null, tipo: Object.keys(r.content ?? {})[0] };
      const ejemplo = c.example ?? Object.values(c.examples ?? {})[0]?.value ?? muestra(c.schema);
      return { codigo, ejemplo };
    }
    return null;
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

Cada ruta trae un curl mínimo y un ejemplo de respuesta. Los ejemplos usan dos variables de la terminal:

\`\`\`bash
API=http://127.0.0.1:8787   # tu servidor (el puerto por defecto de la API)
LLAVE=fhn_test_…            # una llave de la API
\`\`\`

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
      s += `\`\`\`bash\n${curlDe(o)}\n\`\`\`\n\n`;
      const respuesta = respuestaDe(op);
      if (respuesta?.ejemplo != null) {
        s += `Respuesta \`${respuesta.codigo}\` (ejemplo armado con los valores de la especificación):\n\n\`\`\`json\n${json(respuesta.ejemplo)}\n\`\`\`\n\n`;
      } else if (respuesta) {
        s += `Respuesta \`${respuesta.codigo}\`${respuesta.tipo ? ` (\`${respuesta.tipo}\`)` : ', sin cuerpo'}.\n\n`;
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
