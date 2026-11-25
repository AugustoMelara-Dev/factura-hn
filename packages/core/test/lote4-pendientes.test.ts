/**
 * Lote 4, pendientes del núcleo:
 * - `TEXTO_CARACTER_NO_PERMITIDO`: los textos de entrada no llevan caracteres de control (salvo tabulador y
 *   saltos de línea) ni mitades sueltas de pares sustitutos. No es regla fiscal: PostgreSQL no los guarda en
 *   `jsonb` y la impresora toma los de control como comandos (DEC-060).
 * - `registrarAutorizacionConAvisos` devuelve `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62); `registrarAutorizacion`
 *   conserva su firma.
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  emitir,
  enlaceError,
  ErrorValidacion,
  eventosAuditoria,
  problemasDeTexto,
  registrarAutorizacion,
  registrarAutorizacionConAvisos,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoEntrada,
} from '../src';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-06-30',
};
const caja = { establecimiento: '000', puntoEmision: '001' };
const entrada = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: { rtn: '99990000000001', razonSocial: 'Ejemplo S. de R.L.', nombreComercial: 'Ejemplo', direccionCasaMatriz: 'D', direccionEstablecimiento: 'D', telefono: '1', correo: 'a@ejemplo.example' },
  lineas: [{ descripcion: 'Arroz', cantidad: '1', precioUnitario: '100.00' }],
  ...extra,
});

async function errorDe(p: Promise<unknown>): Promise<ErrorValidacion> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ErrorValidacion);
  return e as ErrorValidacion;
}

describe('TEXTO_CARACTER_NO_PERMITIDO', () => {
  it('emitir rechaza un NUL en la descripción sin consumir número, con campo, solución y enlace', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacion(almacen, AUT);
    const e = await errorDe(emitir(entrada({ lineas: [{ descripcion: 'Arroz\u0000', cantidad: '1', precioUnitario: '100.00' }] }), { almacen, ...caja }));
    expect(e.errores).toHaveLength(1);
    expect(e.errores[0]).toMatchObject({
      codigo: 'TEXTO_CARACTER_NO_PERMITIDO',
      campo: 'lineas[0].descripcion',
      documentacion: enlaceError('TEXTO_CARACTER_NO_PERMITIDO'),
    });
    expect(e.errores[0]!.mensaje).toContain('U+0000');
    expect(e.errores[0]!.mensaje).toContain('posición 6');
    expect(e.errores[0]!.solucion).toMatch(/tabulador/);
    const doc = await emitir(entrada(), { almacen, ...caja });
    expect(doc.correlativo).toBe(1);
  });

  it('revisa todos los textos: emisor, cliente, referencia, exoneración, motivo y observaciones', () => {
    const malo = 'x\u001by';
    const r = validarEntrada(
      entrada({
        tipoDocumento: '07',
        emisor: { ...entrada().emisor, direccionCasaMatriz: malo },
        cliente: { nombre: malo, rtn: '99990000000002', identificacion: { tipo: 'PASAPORTE', numero: malo } as never },
        referencia: { cai: malo, numero: '000-001-01-00000001', fecha: '2026-11-18' },
        exoneracion: { registroSAG: malo },
        motivo: malo,
        observaciones: malo,
        lineas: [{ descripcion: 'A', cantidad: '1', precioUnitario: '1.00', codigo: malo }],
      }),
      { ...AUT, tipoDocumento: '07' },
    );
    const campos = r.errores.filter((p) => p.codigo === 'TEXTO_CARACTER_NO_PERMITIDO').map((p) => p.campo);
    expect(campos.sort()).toEqual(
      [
        'emisor.direccionCasaMatriz',
        'cliente.nombre',
        'cliente.identificacion.numero',
        'referencia.cai',
        'exoneracion.registroSAG',
        'motivo',
        'observaciones',
        'lineas[0].codigo',
      ].sort(),
    );
  });

  it('acepta tabulador y saltos de línea en texto libre, y los pares sustitutos completos (emojis)', () => {
    expect(problemasDeTexto({ observaciones: 'Entrega:\tportón\r\nsegundo piso', lineas: [{ descripcion: 'Pastel 🎂' }] })).toEqual([]);
  });

  it('rechaza DEL, los C1 y las mitades sueltas de pares sustitutos', () => {
    for (const malo of ['a\u007f', 'a\u0085', 'a\u009f', 'a\ud800', '\udfffa', 'a\ud83d b']) {
      const [p] = problemasDeTexto({ motivo: malo });
      expect(p, JSON.stringify(malo)).toMatchObject({ codigo: 'TEXTO_CARACTER_NO_PERMITIDO', campo: 'motivo' });
    }
    expect(problemasDeTexto({ motivo: 'a\ud800' })[0]!.mensaje).toContain('par sustituto');
  });

  it('el operador sigue con su propio código (OPERADOR), sin duplicar el problema', () => {
    const r = validarEntrada(entrada({ operador: 'Ana\u0000' }), AUT);
    expect(r.errores.map((p) => p.codigo)).toEqual(['OPERADOR']);
  });
});

describe('registrarAutorizacionConAvisos', () => {
  const larga = { ...AUT, fechaAutorizacion: '2026-01-15', fechaLimiteEmision: '2027-06-30' };

  it('devuelve AVISO_VIGENCIA_MAYOR_1_ANIO (Art. 62) y lo deja en la bitácora', async () => {
    const almacen = new AlmacenFiscalMemoria();
    const r = await registrarAutorizacionConAvisos(almacen, larga, { actor: 'prueba' });
    expect(r.autorizacion).toMatchObject({ cai: AUT.cai, fechaLimiteEmision: '2027-06-30' });
    expect(r.advertencias).toHaveLength(1);
    expect(r.advertencias[0]).toMatchObject({ codigo: 'AVISO_VIGENCIA_MAYOR_1_ANIO', campo: 'fechaLimiteEmision' });
    expect(r.advertencias[0]!.mensaje).toContain('Art. 62');
    const [ev] = await eventosAuditoria(almacen, { tipo: 'AUTORIZACION_REGISTRADA' });
    expect(ev!.detalle.advertencias).toEqual(['AVISO_VIGENCIA_MAYOR_1_ANIO']);
  });

  it('sin aviso, advertencias vacía; registrarAutorizacion conserva su firma (devuelve la autorización)', async () => {
    const sinAviso = await registrarAutorizacionConAvisos(new AlmacenFiscalMemoria(), { ...AUT, fechaAutorizacion: '2026-07-01' });
    expect(sinAviso.advertencias).toEqual([]);
    const a = await registrarAutorizacion(new AlmacenFiscalMemoria(), larga);
    expect(a).not.toHaveProperty('advertencias');
    expect(a.cai).toBe(AUT.cai);
  });

  it('los errores siguen lanzando ErrorValidacion', async () => {
    const almacen = new AlmacenFiscalMemoria();
    await registrarAutorizacionConAvisos(almacen, AUT);
    const e = await errorDe(registrarAutorizacionConAvisos(almacen, AUT));
    expect(e.errores[0]!.codigo).toBe('AUTORIZACION_DUPLICADA');
  });
});
