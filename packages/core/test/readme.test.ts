/**
 * La documentación es código: cada bloque ```ts del README y de AGENTS.md debe compilar contra la API
 * actual, el ejemplo principal debe dar los números que promete, y README, AGENTS.md, llms.txt y la skill
 * deben llevar los mismos prompts y nombrar solo funciones y tipos que existen.
 *
 * Un bloque que usa variables del proyecto del integrador (carrito, repo…) las declara en un comentario
 * HTML inmediatamente anterior:  <!-- declaraciones: declare const carrito: Item[]; -->
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { emitir, type AlmacenFiscalMemoria, type DocumentoFiscal } from '../src';

const RAIZ = join(__dirname, '..', '..', '..');
const INDICE = join(__dirname, '..', 'src', 'index.ts');

interface Fragmento {
  archivo: string;
  linea: number;
  codigo: string;
}

export function fragmentosTS(archivo: string): Fragmento[] {
  const texto = readFileSync(join(RAIZ, archivo), 'utf8');
  const fragmentos: Fragmento[] = [];
  const patron = /(?:<!--\s*declaraciones:([\s\S]*?)-->\s*\n)?```ts\n([\s\S]*?)```/g;
  for (let m = patron.exec(texto); m; m = patron.exec(texto)) {
    const linea = texto.slice(0, m.index).split('\n').length;
    fragmentos.push({ archivo, linea, codigo: `${m[1] ?? ''}\n${m[2]}\nexport {};\n` });
  }
  return fragmentos;
}

function compilar(fragmentos: Fragmento[]): string[] {
  const nombres = fragmentos.map((f, i) => join(RAIZ, `__fragmento_${i}.ts`));
  // Un bloque que empieza con «// lib/facturador.ts:» es ese archivo de Next.js: los demás lo importan como
  // `@/lib/facturador`.
  const facturadorNext = fragmentos.findIndex((f) => /^\s*\/\/ lib\/facturador\.ts:/m.test(f.codigo));
  const opciones: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: ['node'],
    typeRoots: [join(RAIZ, 'node_modules', '@types')],
    baseUrl: RAIZ,
    paths: {
      'factura-hn': [INDICE],
      'factura-hn/demo': [join(RAIZ, 'packages', 'core', 'src', 'demo.ts')],
      '@factura-hn/postgres': [join(RAIZ, 'packages', 'postgres', 'src', 'index.ts')],
      '@factura-hn/sqlite': [join(RAIZ, 'packages', 'sqlite', 'src', 'index.ts')],
      '@factura-hn/cliente': [join(RAIZ, 'packages', 'cliente', 'src', 'index.ts')],
      '@factura-hn/pdf': [join(RAIZ, 'packages', 'pdf', 'src', 'index.ts')],
      pg: [join(RAIZ, 'packages', 'postgres', 'node_modules', '@types', 'pg', 'index.d.ts')],
      ...(facturadorNext >= 0 ? { '@/lib/facturador': [nombres[facturadorNext]!] } : {}),
    },
  };
  const host = ts.createCompilerHost(opciones);
  const leerOriginal = host.readFile.bind(host);
  const existeOriginal = host.fileExists.bind(host);
  const normalizar = (n: string) => n.replace(/\\/g, '/').toLowerCase();
  const virtual = new Map(nombres.map((n, i) => [normalizar(n), fragmentos[i]!.codigo]));
  const buscar = (n: string) => virtual.get(normalizar(n));
  host.readFile = (n) => buscar(n) ?? leerOriginal(n);
  host.fileExists = (n) => buscar(n) !== undefined || existeOriginal(n);
  const programa = ts.createProgram(nombres, opciones, host);
  return ts.getPreEmitDiagnostics(programa)
    .filter((d) => d.file && d.file.fileName.includes('__fragmento_'))
    .map((d) => {
      const i = Number(/__fragmento_(\d+)/.exec(d.file!.fileName)![1]);
      const f = fragmentos[i]!;
      return `${f.archivo} (bloque en la línea ${f.linea}): ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
}

describe('los fragmentos de código de la documentación compilan', () => {
  for (const archivo of ['README.md', 'AGENTS.md', 'docs/guia-sdk.md', 'docs/errores.md']) {
    it(archivo, () => {
      const fragmentos = fragmentosTS(archivo);
      expect(fragmentos.length).toBeGreaterThan(0);
      expect(compilar(fragmentos)).toEqual([]);
    }, 60_000);
  }

  it('detecta un fragmento roto (control de la propia prueba)', () => {
    const roto = { archivo: 'control', linea: 1, codigo: "import { crearDocumento } from 'factura-hn';\nexport {};\n" };
    expect(compilar([roto]).join('\n')).toMatch(/crearDocumento/);
  }, 60_000);
});

it('el ejemplo «En 30 segundos» del README corre tal cual, con el reloj real, y da lo que promete', async () => {
  // Se ejecuta el bloque del README, sin reloj fijo: si su CAI de ejemplo caducara, esta prueba fallaría.
  const bloque = fragmentosTS('README.md').find((f) => f.codigo.includes('// En cada venta'));
  expect(bloque, 'bloque «En 30 segundos» del README').toBeDefined();
  const dir = join(__dirname, '.generado');
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, 'readme-en-30-segundos.ts');
  const codigo = bloque!.codigo
    .replace("from 'factura-hn'", "from '../../src/index'")
    .replace('export {};', 'export { almacen, factura };');
  writeFileSync(ruta, codigo);
  const { almacen, factura: f } = (await import(ruta)) as { almacen: AlmacenFiscalMemoria; factura: DocumentoFiscal };
  expect(f.numero).toBe('000-001-01-00000001');
  expect(f.totales.total).toBe(371);
  expect(f.totales.totalEnLetras).toBe('TRESCIENTOS SETENTA Y UN LEMPIRAS CON 00/100');
  expect(f.advertencias).toEqual([]);

  // «Avisos que verás»: venta mixta.
  const mixta = await emitir({
    emisor: f.emisor,
    cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
    lineas: [
      { descripcion: 'Clavos 2"', cantidad: 1, precioUnitario: '100.00' },
      { descripcion: 'Frijoles (lb)', cantidad: 3, precioUnitario: '28.00', isv: 'EXENTO' },
    ],
  }, { almacen, establecimiento: '000', puntoEmision: '001' });
  expect(mixta.advertencias.map((p) => p.codigo)).toEqual(['AVISO_VENTA_MIXTA']);
  expect(mixta.totales.baseCreditoFiscal).toBe(100);
});

// --- Prompts y nombres en la documentación para agentes -------------------------------------------------

const DOCS_AGENTES = ['README.md', 'AGENTS.md', 'llms.txt', 'skills/facturacion-sar-hn/SKILL.md'];
const PROMPT_SDK = 'Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.';
const PROMPT_API = 'Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.';

describe('documentación para agentes', () => {
  it('los cuatro documentos traen los mismos prompts de una línea (SDK y API)', () => {
    for (const archivo of DOCS_AGENTES) {
      const texto = readFileSync(join(RAIZ, archivo), 'utf8');
      expect(texto.includes(PROMPT_SDK), `${archivo}: prompt del SDK`).toBe(true);
      expect(texto.includes(PROMPT_API), `${archivo}: prompt de la API`).toBe(true);
    }
  });

  it('las funciones y los tipos que nombran existen en algún paquete', () => {
    const paquetes = ['core', 'sqlite', 'postgres', 'pdf', 'api', 'cliente', 'mcp'].map((n) => join(RAIZ, 'packages', n, 'src', 'index.ts'));
    paquetes.push(join(RAIZ, 'packages', 'core', 'src', 'demo.ts'));
    const programa = ts.createProgram(paquetes, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: true });
    const checker = programa.getTypeChecker();
    const exportados = new Set<string>();
    for (const f of paquetes) {
      const modulo = checker.getSymbolAtLocation(programa.getSourceFile(f)!);
      for (const s of checker.getExportsOfModule(modulo!)) exportados.add(s.name);
    }
    // Métodos y opciones que los documentos escriben con paréntesis pero no son exportaciones.
    const metodos = new Set(['migrar', 'transaccion', 'paraTenant', 'alEmitir', 'alAnular']);
    const faltan: string[] = [];
    for (const archivo of DOCS_AGENTES) {
      const texto = readFileSync(join(RAIZ, archivo), 'utf8');
      for (const m of texto.matchAll(/`([A-Za-z_]\w*)(\(|`)/g)) {
        const nombre = m[1]!;
        const esLlamada = m[2] === '(';
        const esTipo = /^[A-Z][a-z]\w*$/.test(nombre);
        if ((esLlamada || esTipo) && !metodos.has(nombre) && !exportados.has(nombre)) faltan.push(`${archivo}: ${nombre}`);
      }
    }
    expect([...new Set(faltan)]).toEqual([]);
  }, 60_000);

  it('lo que el prompt de la API manda a leer existe donde dice', () => {
    // node_modules/@factura-hn/cliente/AGENTS.md: el cliente publica AGENTS.md (lo copia al empaquetar).
    const cliente = JSON.parse(readFileSync(join(RAIZ, 'packages', 'cliente', 'package.json'), 'utf8')) as { files: string[]; scripts: Record<string, string> };
    expect(cliente.files).toContain('AGENTS.md');
    // prepack copia el AGENTS.md de la raíz (scripts/copiar-docs.mjs) al paquete.
    expect(cliente.scripts.prepack).toMatch(/copiar-docs\.mjs packages\/cliente .*AGENTS\.md/);
    expect(readFileSync(join(RAIZ, 'AGENTS.md'), 'utf8')).toContain('## Con la API REST');
    // FHN_API_URL/openapi.json: su descripción trae las reglas.
    const openapi = JSON.parse(readFileSync(join(RAIZ, 'packages', 'api', 'openapi.json'), 'utf8')) as { info: { description: string } };
    expect(openapi.info.description).toContain('Idempotency-Key estable por venta');
    expect(openapi.info.description).toContain('X-FacturaHN-Firma');
  });

  it('las herramientas MCP que se listan son las que el servidor registra', () => {
    const servidor = readFileSync(join(RAIZ, 'packages', 'mcp', 'src', 'servidor.ts'), 'utf8');
    const registradas = [...servidor.matchAll(/registerTool\(\s*'(\w+)'/g)].map((m) => m[1]).sort();
    expect(registradas).toHaveLength(7);
    for (const archivo of ['README.md', 'llms.txt', 'packages/mcp/README.md']) {
      const texto = readFileSync(join(RAIZ, archivo), 'utf8');
      for (const h of registradas) expect(texto.includes(h!), `${archivo}: ${h}`).toBe(true);
    }
  });
});

it('la guía del SDK, seguida en orden (pasos 3 a 6), corre sin errores', async () => {
  const texto = readFileSync(join(RAIZ, 'docs/guia-sdk.md'), 'utf8');
  const inicio = texto.split('\n').findIndex((l) => l.startsWith('## 3.')) + 1;
  const fin = texto.split('\n').findIndex((l) => l.startsWith('## 7.')) + 1;
  const bloques = fragmentosTS('docs/guia-sdk.md').filter((f) => f.linea > inicio && f.linea < fin);
  expect(bloques.length).toBeGreaterThanOrEqual(4);
  // Un solo módulo: sin las declaraciones (`declare …`) ni los import de cada bloque; el almacén es en memoria y el
  // PDF se omite (es otro paquete). El catch del paso 4 relanza lo que no es ErrorValidacion; un ErrorValidacion
  // impreso con console.error haría fallar la comprobación de abajo.
  const cuerpo = bloques
    .map((b) => b.codigo.split('\n').filter((l) => !/^\s*(import |declare |export \{\};)/.test(l)).join('\n'))
    .join('\n')
    .replace(/await renderizarPDF\([^)]*\)/g, 'null');
  const errores: unknown[] = [];
  const codigo = [
    "import { AlmacenFiscalMemoria, anular, buscarDocumento, emitir, ErrorValidacion, registrarAutorizacion, renderizarHTML, renderizarTexto } from '../../src/index';",
    'const almacen = new AlmacenFiscalMemoria();',
    'const console = { log: () => {}, error: (...a: unknown[]) => (globalThis as any).__erroresGuia.push(a) };',
    cuerpo,
    'export { almacen, nota };',
  ].join('\n');
  (globalThis as any).__erroresGuia = errores;
  const dir = join(__dirname, '.generado');
  mkdirSync(dir, { recursive: true });
  const ruta = join(dir, 'guia-sdk-pasos.ts');
  writeFileSync(ruta, codigo);
  const { nota } = (await import(ruta)) as { nota: DocumentoFiscal };
  expect(errores).toEqual([]);
  expect(nota.numero).toBe('000-001-06-00000001');
  expect(nota.advertencias).toEqual([]);
});
