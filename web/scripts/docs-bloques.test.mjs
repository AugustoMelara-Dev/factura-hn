// La documentación corre como está escrita: estas pruebas leen los Markdown del repositorio (README, AGENTS.md,
// llms.txt, la skill, docs/, las páginas del sitio y los README de los ejemplos) y comprueban lo que un lector
// ejecuta tal cual. Los ```ts compilan aparte (packages/core/test/readme.test.ts); el autoalojamiento con Docker,
// de punta a punta, está en scripts/probar-autoalojamiento.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { RAIZ, WEB } from '../sitio.config.mjs';
import { EJEMPLOS, PREAMBULO, VARIABLES, variablesDe } from './lib/ejemplos-openapi.mjs';
import { operacionesPublicadas, referenciaApi, respuestasCapturadas } from './lib/openapi.mjs';

const leer = (r) => readFileSync(join(RAIZ, r), 'utf8').replace(/\r\n/g, '\n');
const markdownsEn = (dir) =>
  existsSync(join(RAIZ, dir))
    ? readdirSync(join(RAIZ, dir), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.mdx?$/.test(e.name))
        .map((e) => relative(RAIZ, join(e.parentPath, e.name)).replaceAll('\\', '/'))
    : [];

/** Los documentos que lee quien integra factura-hn (los mismos que revisa el auditor de la documentación). */
const DOCUMENTOS = [
  'README.md',
  'AGENTS.md',
  'llms.txt',
  ...markdownsEn('skills'),
  ...readdirSync(join(RAIZ, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  ...readdirSync(join(RAIZ, 'examples')).map((d) => `examples/${d}/README.md`).filter((f) => existsSync(join(RAIZ, f))),
  ...markdownsEn('clientes'),
  ...markdownsEn('web/src/content/docs').filter((f) => !generadas().has(f)),
];
function generadas() {
  const manifiesto = join(WEB, '.generado.json');
  return new Set(existsSync(manifiesto) ? JSON.parse(readFileSync(manifiesto, 'utf8')).map((f) => `web/${f}`) : []);
}

/** Bloques de código con su lenguaje, su línea y las declaraciones ocultas que los preceden. */
function bloques(archivo) {
  const texto = leer(archivo);
  return [...texto.matchAll(/(?:<!--\s*declaraciones:([\s\S]*?)-->\s*\n)?^( *)```(\w*)[^\n]*\n([\s\S]*?)^ *```/gm)].map((m) => ({
    archivo,
    linea: texto.slice(0, m.index).split('\n').length,
    declaraciones: m[1] ?? null,
    lenguaje: m[3],
    codigo: m[4].split('\n').map((l) => l.slice(m[2].length)).join('\n'),
  }));
}

test('ningún documento usa uuidgen, la demo en la nube ni el \\password interactivo', () => {
  const malos = [];
  for (const archivo of DOCUMENTOS) {
    const texto = leer(archivo);
    for (const [patron, por] of [
      [/uuidgen/, 'uuidgen no está en Windows ni en todas las distribuciones'],
      [/\/v1\/demo\b/, 'ruta de la demo en la nube'],
      [/FHN_DEMO_[A-Z]/, 'variable de la demo en la nube'],
      [/\\password/, '\\password pide una terminal: no corre en un script'],
    ]) {
      if (patron.test(texto)) malos.push(`${archivo}: ${por}`);
    }
  }
  assert.deepEqual(malos, []);
  assert.ok(DOCUMENTOS.length > 60, `se revisan ${DOCUMENTOS.length} documentos`);
});

test('un solo tiempo: «en 5 minutos»', () => {
  const malos = DOCUMENTOS.filter((f) => /\ben (un|1|2|dos|3|tres|10|diez) minutos?\b/i.test(leer(f).replace(/por minuto/gi, '')));
  assert.deepEqual(malos, []);
});

test('docker-compose.yml: la base está «sana» solo cuando acepta conexiones por TCP, con margen para crearse', () => {
  const compose = leer('docker-compose.yml');
  const salud = /healthcheck:\n([\s\S]*?)\n\n/.exec(compose)?.[1] ?? '';
  assert.match(salud, /pg_isready -h 127\.0\.0\.1 /, 'por TCP: el servidor temporal del initdb solo escucha en el socket');
  assert.match(salud, /start_period: \d+s/);
  assert.match(compose, /- \.\/scripts\/db-init:\/docker-entrypoint-initdb\.d:ro/);
  assert.ok(existsSync(join(RAIZ, 'scripts/db-init/10-rol-api.sh')));
});

test('autoalojamiento: restaurar en una instalación nueva arranca todo antes de pg_restore y detiene la API', () => {
  const restaurar = bloques('docs/autoalojamiento.md').find((b) => b.codigo.includes('pg_restore'));
  assert.ok(restaurar, 'bloque con pg_restore');
  const l = restaurar.codigo.trim().split('\n');
  assert.equal(l[0], 'docker compose up -d --build --wait', 'la instalación nueva crea los roles fhn_app y fhn_api');
  assert.equal(l[1], 'docker compose stop api');
  assert.match(l[2], /pg_restore .*--single-transaction --exit-on-error/);
  assert.equal(l.at(-1), 'docker compose up -d --wait');
});

test('las declaraciones ocultas no importan por el lector: lo de factura-hn que usa el código, el código lo importa', () => {
  // Una declaración oculta (<!-- declaraciones: … -->) es lo que el lector ya tiene en su proyecto (su `caja`, su
  // `carrito`). Un tipo o una función de factura-hn que el bloque usa se importa a la vista, en ese bloque o en uno
  // anterior de la página: si no, quien copia el bloque no compila.
  const malos = [];
  for (const archivo of DOCUMENTOS) {
    const vistos = new Set();
    for (const b of bloques(archivo).filter((x) => ['js', 'ts'].includes(x.lenguaje))) {
      const importados = (texto) =>
        [...texto.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(?:factura-hn|@factura-hn\/[\w-]+)[^']*'/gm)].flatMap((m) =>
          m[1].split(',').map((x) => x.replace(/^\s*type\s+/, '').split(/\s+as\s+/).at(-1).trim()).filter(Boolean),
        );
      for (const n of importados(b.codigo)) vistos.add(n);
      const codigo = b.codigo.replace(/\/\/.*$/gm, '');
      for (const n of importados(b.declaraciones ?? '')) {
        if (!vistos.has(n) && new RegExp(`\\b${n}\\b`).test(codigo)) malos.push(`${archivo}:${b.linea} usa ${n}, que solo importan las declaraciones ocultas`);
      }
    }
  }
  assert.deepEqual(malos, []);
});

// --- Bloques encadenados ------------------------------------------------------------------------------------

const MODULOS_SDK = /^factura-hn(\/demo)?$/;
const AsyncFunction = (async () => {}).constructor;

/**
 * Cadenas de cada página, como las lee quien copia los bloques en orden a un archivo: un bloque js/ts sigue al
 * anterior de la página; los imports de `factura-hn` se juntan arriba. Un bloque con declaraciones ocultas, con
 * otros imports o que necesita la red o variables de entorno corta la cadena (depende de código del lector); un
 * fragmento que no es un programa (p. ej. solo un objeto) se salta.
 */
function cadenas(archivo) {
  const salida = [];
  let actual = null;
  for (const b of bloques(archivo).filter((x) => ['js', 'ts', 'mjs'].includes(x.lenguaje))) {
    const imports = [...b.codigo.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)';?\s*$/gm)];
    const otros = /^import\s+(?!(type\s+)?\{)/m.test(b.codigo);
    const cuerpo = b.codigo.replace(/^import\s+(type\s+)?\{[^}]*\}\s+from\s+'[^']+';?\s*$/gm, '');
    if (b.declaraciones !== null || otros || imports.some((m) => !MODULOS_SDK.test(m[3])) || /process\.env|fetch\(/.test(b.codigo)) {
      actual = null;
      continue;
    }
    if (b.lenguaje !== 'ts') {
      try {
        new AsyncFunction(cuerpo);
      } catch {
        continue; // un fragmento, no un programa
      }
    }
    if (!actual) {
      if (!imports.length) continue;
      salida.push((actual = { archivo, linea: b.linea, ts: false, imports: new Map(), partes: [] }));
    }
    for (const m of imports) {
      const lista = actual.imports.get(m[3]) ?? new Set();
      for (const x of m[2].split(',').map((y) => y.trim()).filter(Boolean)) lista.add(m[1] ? `type ${x}` : x);
      actual.imports.set(m[3], lista);
    }
    actual.ts ||= b.lenguaje === 'ts';
    actual.partes.push({ ...b, cuerpo });
  }
  return salida;
}

const declarados = (codigo) =>
  [...codigo.matchAll(/^(?:export\s+)?(?:const|let|var|function|class)\s+(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))/gm)].flatMap((m) =>
    m[3] ? [m[3]] : (m[1] ?? m[2]).split(',').map((x) => x.split(':').at(-1).split('=')[0].trim()).filter(Boolean),
  );

test('los bloques que siguen a otro de la misma página no vuelven a declarar sus nombres', () => {
  const malos = [];
  for (const archivo of DOCUMENTOS) {
    for (const c of cadenas(archivo)) {
      const vistos = new Map();
      for (const b of c.partes) {
        for (const n of declarados(b.cuerpo)) {
          if (vistos.has(n)) malos.push(`${archivo}:${b.linea} vuelve a declarar «${n}» (ya en la línea ${vistos.get(n)})`);
          else vistos.set(n, b.linea);
        }
      }
    }
  }
  assert.deepEqual(malos, []);
});

// --- Valores comentados: `expr; // 230` se ejecuta y se compara --------------------------------------------

/** El valor de un comentario `// 230`, `// '000-001-06-00000001': la serie…` o `// ['AVISO_X']`, si es un literal. */
function literal(comentario) {
  for (const c of [comentario, comentario.split(/:\s/)[0], comentario.split(/\s\(/)[0]]) {
    const t = c.trim();
    if (!t || /[A-Za-z_$]/.test(t.replace(/'[^']*'|"[^"]*"/g, ''))) continue; // solo literales, sin identificadores
    try {
      return { valor: new Function(`return (${t});`)(), texto: t };
    } catch {}
  }
  return null;
}

/**
 * Lo que las páginas dicen que es del lector («`almacen` es tu almacén fiscal», «`emisor`, el de tu sistema»):
 * un almacén en memoria y un emisor ficticio. Un bloque que los declara usa los suyos.
 */
const DEL_LECTOR = `import { AlmacenFiscalMemoria as __Almacen } from 'factura-hn';
globalThis.almacen = new __Almacen();
globalThis.emisor = { rtn: '99990000000001', razonSocial: 'Inversiones Ejemplo S. de R.L.', nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo', direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001', correo: 'ventas@ejemplo.example' };
`;

test('los valores comentados en los bloques de código son los que da el código', () => {
  const tmp = join(WEB, '.bloques-prueba');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const malos = [];
  let comprobados = 0;
  try {
    let n = 0;
    for (const archivo of DOCUMENTOS) {
      for (const c of cadenas(archivo)) {
        let comparaciones = 0;
        const codigo = c.partes
          .map((b) =>
            b.cuerpo
              .split('\n')
              .map((l, i) => {
                const m = /^([^/'"`]*?[^\s;]);?\s*\/\/\s*(.+)$/.exec(l);
                const v = m && !/^\s*(const|let|var|await|import|export|return|if|for)\b/.test(m[1]) && literal(m[2]);
                if (!v) return l;
                comparaciones++;
                return `__comparar(${m[1].trim()}, ${v.texto}, ${JSON.stringify(`${archivo}:${b.linea + i + 1}`)});`;
              })
              .join('\n'),
          )
          .join('\n');
        if (!comparaciones) continue;
        comprobados += comparaciones;
        const imports = [...c.imports].map(([m, l]) => `import { ${[...l].join(', ')} } from '${m}';`).join('\n');
        const ruta = join(tmp, `bloque-${n++}.${c.ts ? 'mts' : 'mjs'}`);
        writeFileSync(
          ruta,
          `${imports}\n${DEL_LECTOR}import { isDeepStrictEqual as __igual } from 'node:util';\nconst __fallos = [];\n` +
            `function __comparar(real, doc, donde) { if (!__igual(real, doc)) __fallos.push(\`\${donde}: el documento dice \${JSON.stringify(doc)} y da \${JSON.stringify(real)}\`); }\n` +
            `${codigo}\nif (__fallos.length) { console.error(__fallos.join('\\n')); process.exitCode = 1; }\n`,
        );
        try {
          execFileSync(process.execPath, [ruta], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
        } catch (e) {
          malos.push(`${c.archivo} (cadena desde la línea ${c.linea}):\n${(e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n')}`);
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.deepEqual(malos, []);
  assert.ok(comprobados > 30, `se comprobaron ${comprobados} valores`);
});

test('control: un valor comentado falso se detecta', () => {
  assert.deepEqual(literal("'000-001-06-00000001': la serie 06 es propia"), { valor: '000-001-06-00000001', texto: "'000-001-06-00000001'" });
  assert.equal(literal('{ ok: true }'), null);
  assert.equal(literal('230')?.valor, 230);
});

// --- Referencia de la API (generada de openapi.json) --------------------------------------------------------

test('referencia de la API: cada ruta tiene un curl que corre tal cual y su respuesta real', () => {
  const spec = JSON.parse(leer('packages/api/openapi.json'));
  const capturadas = respuestasCapturadas();
  const ops = operacionesPublicadas(spec);
  assert.deepEqual(ops.filter((o) => !EJEMPLOS.some((e) => e.op === o)), [], 'rutas sin ejemplo');
  assert.deepEqual(ops.filter((o) => !capturadas[o]), [], 'rutas sin respuesta capturada (web/scripts/capturar-ejemplos-openapi.mjs)');
  for (const e of EJEMPLOS) {
    assert.ok(ops.includes(e.op), `${e.op}: el ejemplo es de una ruta que ya no está en openapi.json`);
    assert.doesNotMatch(e.curl, /uuidgen|-d '|--data '/, `${e.op}: cuerpo por heredoc y sin uuidgen`);
    if (/-X (POST|PATCH)/.test(e.curl) && /content-type/.test(e.curl)) assert.match(e.curl, /--data-binary @- <<'JSON'\n[\s\S]+\nJSON$/, e.op);
    for (const v of variablesDe(e.curl)) {
      assert.ok(EJEMPLOS.findIndex((x) => x.op === VARIABLES[v].de) < EJEMPLOS.indexOf(e), `${e.op}: ${v} sale de un ejemplo anterior`);
    }
  }
  const pagina = referenciaApi(spec, capturadas);
  assert.doesNotMatch(pagina, /uuidgen|\/v1\/demo|FHN_DEMO_|"texto"|EXACTOS/);
  assert.ok(pagina.includes(PREAMBULO));
});

test('referencia de la API: las respuestas capturadas tienen la forma de la especificación y son coherentes', () => {
  const spec = JSON.parse(leer('packages/api/openapi.json'));
  const capturadas = respuestasCapturadas();
  const esquema = (s) => (s?.$ref ? spec.components.schemas[s.$ref.split('/').at(-1)] : s);
  for (const [op, r] of Object.entries(capturadas)) {
    const [metodo, ruta] = op.split(' ');
    const respuesta = spec.paths[ruta]?.[metodo.toLowerCase()]?.responses?.[String(r.codigo)];
    assert.ok(respuesta, `${op}: ${r.codigo} no está entre las respuestas de la especificación`);
    const s = esquema(respuesta.content?.[r.tipo]?.schema ?? respuesta.content?.['application/json']?.schema);
    // La forma se compara en las respuestas 2xx, las que la página muestra como resultado de la ruta.
    if (r.codigo < 300 && r.tipo === 'application/json' && s?.properties) {
      const claves = Object.keys(r.cuerpo);
      assert.deepEqual(claves.filter((k) => !(k in s.properties)), [], `${op}: campos que la especificación no tiene`);
      assert.deepEqual((s.required ?? []).filter((k) => !claves.includes(k)), [], `${op}: faltan campos obligatorios`);
    }
  }
  // La factura de ejemplo: 2 × 115.00 con ISV incluido.
  const doc = capturadas['POST /v1/documentos'].cuerpo.documento;
  assert.equal(doc.totales.total, 230);
  assert.equal(doc.totales.totalEnLetras, 'DOSCIENTOS TREINTA LEMPIRAS CON 00/100');
});
