/**
 * La documentación es código: cada bloque ```ts del README y de AGENTS.md debe compilar contra la API
 * actual, y el ejemplo principal debe dar los números que promete.
 *
 * Un bloque que usa variables del proyecto del integrador (carrito, repo…) las declara en un comentario
 * HTML inmediatamente anterior:  <!-- declaraciones: declare const carrito: Item[]; -->
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { AlmacenFiscalMemoria, emitir, registrarAutorizacion } from '../src';

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
      '@factura-hn/postgres': [join(RAIZ, 'packages', 'postgres', 'src', 'index.ts')],
      '@factura-hn/sqlite': [join(RAIZ, 'packages', 'sqlite', 'src', 'index.ts')],
      pg: [join(RAIZ, 'packages', 'postgres', 'node_modules', '@types', 'pg', 'index.d.ts')],
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
  for (const archivo of ['README.md', 'AGENTS.md']) {
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

it('el ejemplo del README da los números que promete', async () => {
  const almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, {
    cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000',
    puntoEmision: '001', rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: '2027-06-30',
  });
  const f = await emitir({
    emisor: { rtn: '08011999123456', razonSocial: 'Inversiones Ejemplo S. de R.L.', nombreComercial: 'Pulpería La Bendición',
      direccionCasaMatriz: 'Barrio El Centro, Tocoa, Colón', direccionEstablecimiento: 'Barrio El Centro, Tocoa, Colón',
      telefono: '2444-0000', correo: 'ventas@ejemplo.hn' },
    cliente: { nombre: 'Ferretería Pérez', rtn: '08019005123456' },
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '89.50' },
      { descripcion: 'Cerveza lata', cantidad: 6, precioUnitario: '32.00', isv: 'ISV18' },
    ],
  }, { almacen, establecimiento: '000', puntoEmision: '001' });
  expect(f.numero).toBe('000-001-01-00000001');
  expect(f.totales.total).toBe(371);
  expect(f.totales.totalEnLetras).toBe('TRESCIENTOS SETENTA Y UN LEMPIRAS CON 00/100');
  expect(f.advertencias).toEqual([]);

  // «Avisos que verás»: venta mixta.
  const mixta = await emitir({
    emisor: f.emisor,
    cliente: { nombre: 'Ferretería Pérez', rtn: '08019005123456' },
    lineas: [
      { descripcion: 'Clavos 2"', cantidad: 1, precioUnitario: '100.00' },
      { descripcion: 'Frijoles (lb)', cantidad: 3, precioUnitario: '28.00', isv: 'EXENTO' },
    ],
  }, { almacen, establecimiento: '000', puntoEmision: '001' });
  expect(mixta.advertencias.map((p) => p.codigo)).toEqual(['AVISO_VENTA_MIXTA']);
  expect(mixta.totales.baseCreditoFiscal).toBe(100);
});
