import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  buscarDocumento,
  emitir,
  enlaceError,
  ErrorValidacion,
  esErrorValidacion,
  registrarAutorizacion,
  SOLUCIONES,
  validarAutorizacion,
  type AlmacenFiscal,
  type AutorizacionCAI,
  type OpcionesEmision,
} from '../src';
import { EMISOR_DEMO } from '../src/demo';

const RAIZ = join(__dirname, '..', '..', '..');
const caja = { establecimiento: '000', puntoEmision: '001' };
const venta = { emisor: EMISOR_DEMO, lineas: [{ descripcion: 'Café 1 lb', cantidad: '1', precioUnitario: '100.00' }] };
const aut = (extra: Partial<AutorizacionCAI> = {}): AutorizacionCAI => ({
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', ...caja,
  rangoInicial: 1, rangoFinal: 1, fechaLimiteEmision: '2027-06-30', ...extra,
});

async function errorDe(p: Promise<unknown>): Promise<ErrorValidacion> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ErrorValidacion);
  return e as ErrorValidacion;
}

describe('errores que dicen qué hacer', () => {
  it('SIN_AUTORIZACION nombra la serie y la llamada que falta; el message trae la solución y el enlace', async () => {
    const e = await errorDe(emitir({ ...venta, tipoDocumento: '06' }, { almacen: new AlmacenFiscalMemoria(), ...caja }));
    const [p] = e.errores;
    expect(p).toMatchObject({ codigo: 'SIN_AUTORIZACION', documentacion: enlaceError('SIN_AUTORIZACION') });
    expect(p!.mensaje).toContain('Nota de Crédito, serie 000-001-06');
    expect(p!.solucion).toContain("registrarAutorizacion(almacen, { cai, tipoDocumento: '06', establecimiento: '000', puntoEmision: '001'");
    expect(p!.solucion).toContain('crearFacturadorDemo()');
    expect(e.message).toContain('[SIN_AUTORIZACION]');
    expect(e.message).toContain(`Solución: ${p!.solucion}`);
    expect(e.message).toContain('Más información: https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#sin_autorizacion');
  });

  it('AUTORIZACION_VENCIDA y RANGO_AGOTADO dicen la fecha o el número y qué hacer', async () => {
    const vencida = new AlmacenFiscalMemoria();
    await registrarAutorizacion(vencida, aut({ fechaLimiteEmision: '2026-01-31' }));
    const v = (await errorDe(emitir(venta, { almacen: vencida, ...caja }))).errores[0]!;
    expect(v.codigo).toBe('AUTORIZACION_VENCIDA');
    expect(v.mensaje).toContain('la última venció el 2026-01-31');
    expect(v.solucion).toMatch(/nueva autorización/);

    const agotada = new AlmacenFiscalMemoria();
    await registrarAutorizacion(agotada, aut());
    await emitir(venta, { almacen: agotada, ...caja });
    const r = (await errorDe(emitir(venta, { almacen: agotada, ...caja }))).errores[0]!;
    expect(r.codigo).toBe('RANGO_AGOTADO');
    expect(r.mensaje).toContain('el último número autorizado es el 1');
    expect(r.documentacion).toBe(enlaceError('RANGO_AGOTADO'));
  });

  it('RANGO_SOLAPADO, AUTORIZACION_DUPLICADA y RANGO traen solución', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, aut({ rangoFinal: 100 }));
    const dup = await errorDe(registrarAutorizacion(almacen, aut({ rangoFinal: 100 })));
    expect(dup.errores[0]).toMatchObject({ codigo: 'AUTORIZACION_DUPLICADA', solucion: SOLUCIONES.AUTORIZACION_DUPLICADA });
    const sol = await errorDe(registrarAutorizacion(almacen, aut({ cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-02', rangoInicial: 50, rangoFinal: 150 })));
    expect(sol.errores[0]).toMatchObject({ codigo: 'RANGO_SOLAPADO', solucion: SOLUCIONES.RANGO_SOLAPADO });
    expect(validarAutorizacion(aut({ rangoInicial: 10, rangoFinal: 5 }))[0]).toMatchObject({
      codigo: 'RANGO', mensaje: expect.stringContaining('el inicial (10) es mayor que el final (5)'), solucion: expect.any(String),
    });
    expect(validarAutorizacion(aut({ rangoFinal: 100_000_000 }))[0]!.mensaje).toContain('rangoFinal (100000000) debe ser un entero entre 1 y 99999999');
  });

  it('sin almacén: ALMACEN_REQUERIDO en lugar de un TypeError', async () => {
    const sin = undefined as unknown as AlmacenFiscal;
    for (const llamada of [
      () => emitir(venta, { ...caja } as OpcionesEmision),
      () => anular('000-001-01-00000001', { motivo: 'x' } as Parameters<typeof anular>[1]),
      () => registrarAutorizacion(sin, aut()),
      () => buscarDocumento(sin, '000-001-01-00000001'),
    ]) {
      const e = await errorDe(llamada());
      expect(e.errores[0]).toMatchObject({ codigo: 'ALMACEN_REQUERIDO', campo: 'almacen', solucion: expect.stringContaining('AlmacenFiscalMemoria') });
    }
  });

  it('un código ajeno al SDK queda como vino; los avisos no se tocan', () => {
    const e = new ErrorValidacion([{ codigo: 'CLAVE_VENTA', mensaje: 'Clave inválida.' }], [{ codigo: 'AVISO_RANGO', mensaje: 'x' }]);
    expect(e.errores).toEqual([{ codigo: 'CLAVE_VENTA', mensaje: 'Clave inválida.' }]);
    expect(e.advertencias).toEqual([{ codigo: 'AVISO_RANGO', mensaje: 'x' }]);
    expect(e.message).toBe('Documento inválido: [CLAVE_VENTA] Clave inválida.');
  });

  it('esErrorValidacion reconoce el error de otra copia del paquete', () => {
    const copia = Object.assign(new Error('x'), { name: 'ErrorValidacion', errores: [] });
    expect(esErrorValidacion(copia)).toBe(true);
    expect(esErrorValidacion(new ErrorValidacion([]))).toBe(true);
    expect(esErrorValidacion(new Error('x'))).toBe(false);
  });
});

describe('catálogo docs/errores.md', () => {
  const catalogo = readFileSync(join(RAIZ, 'docs', 'errores.md'), 'utf8');
  const encabezados = new Set([...catalogo.matchAll(/^### ([A-Z][A-Z0-9_]+)\s*$/gm)].map((m) => m[1]!));

  /** Códigos que lanza o devuelve packages/core/src: `codigo: 'X'` y `error('X', …)`. */
  function codigosDelNucleo(): Set<string> {
    const codigos = new Set<string>();
    const recorrer = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, e.name);
        if (e.isDirectory()) recorrer(ruta);
        else if (e.name.endsWith('.ts') && !ruta.includes(`${join('src', 'pruebas')}`)) {
          const texto = readFileSync(ruta, 'utf8');
          for (const m of texto.matchAll(/(?:codigo:\s*|\berror\(\s*)'([A-Z][A-Z0-9_]+)'/g)) codigos.add(m[1]!);
        }
      }
    };
    recorrer(join(__dirname, '..', 'src'));
    return codigos;
  }

  it('cada código del núcleo tiene su «### CODIGO» en docs/errores.md', () => {
    const codigos = codigosDelNucleo();
    expect(codigos.size).toBeGreaterThan(70);
    expect([...codigos].filter((c) => !encabezados.has(c)).sort()).toEqual([]);
  });

  it('cada error del núcleo (no los avisos) tiene solución y enlace', () => {
    const errores = [...codigosDelNucleo()].filter((c) => !c.startsWith('AVISO_'));
    expect(errores.filter((c) => !SOLUCIONES[c]).sort()).toEqual([]);
    // Y lo que el catálogo de soluciones nombra existe en el documento.
    expect(Object.keys(SOLUCIONES).filter((c) => !encabezados.has(c))).toEqual([]);
  });

  it('cada «### CODIGO» dice qué hacer: «Solución» o, en un aviso o un código retirado, «Qué hacer»', () => {
    // Con un «##» al final, la última sección del archivo también se revisa.
    const sinSolucion = [...`${catalogo}\n## fin\n`.matchAll(/^### ([A-Z][A-Z0-9_]+)\s*\n([\s\S]*?)(?=^##)/gm)]
      .filter((m) => !/^- \*\*(Solución|Qué hacer)[^*]*:\*\*/m.test(m[2]!))
      .map((m) => m[1]);
    expect(encabezados.size).toBeGreaterThan(100);
    expect(sinSolucion).toEqual([]);
  });

  it('también los códigos de la API REST y del servidor MCP', () => {
    const faltan: string[] = [];
    for (const paquete of ['api', 'mcp']) {
      const dir = join(RAIZ, 'packages', paquete, 'src');
      for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
        const texto = readFileSync(join(dir, archivo), 'utf8');
        for (const m of texto.matchAll(/(?:ErrorApi\(\s*\d+,\s*|ErrorBackend\(\s*|errorDe\(\s*|codigo:\s*)'([A-Z][A-Z0-9_]+)'/g)) {
          if (!encabezados.has(m[1]!)) faltan.push(`${paquete}/${archivo}: ${m[1]}`);
        }
      }
    }
    expect(faltan).toEqual([]);
  });

  it('detecta un código sin encabezado (control de la propia prueba)', () => {
    expect(encabezados.has('CODIGO_QUE_NO_EXISTE')).toBe(false);
    expect(codigosDelNucleo().has('SIN_AUTORIZACION')).toBe(true);
  });

  it('los encabezados no se repiten y el ancla es el código en minúsculas', () => {
    const todos = [...catalogo.matchAll(/^### (\S+)\s*$/gm)].map((m) => m[1]!);
    expect(todos.length).toBe(new Set(todos).size);
    expect(enlaceError('SIN_AUTORIZACION')).toBe('https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#sin_autorizacion');
  });
});
