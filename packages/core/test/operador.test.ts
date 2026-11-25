/**
 * La bitácora apoya los controles de auditoría del Reglamento (Art. 53 num. 2): guarda quién hizo cada operación
 * (`actor`: sistema, caja o llave) y, si se indica, la persona que operó (`operador`, p. ej. el cajero). El
 * operador también se puede imprimir en el documento («Atendido por»); no es un requisito del Reglamento.
 */
import { describe, expect, it } from 'vitest';
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  ErrorValidacion,
  eventosAuditoria,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  validarEntrada,
  type AutorizacionCAI,
  type DocumentoEntrada,
} from '../src';

const AUT: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-06-30',
};
const reloj = () => new Date('2026-11-18T10:00:00-06:00');
const entrada = (extra: Partial<DocumentoEntrada> = {}): DocumentoEntrada => ({
  emisor: { rtn: '99990000000001', razonSocial: 'Ejemplo S. de R.L.', nombreComercial: 'Ejemplo', direccionCasaMatriz: 'D', direccionEstablecimiento: 'D', telefono: '1', correo: 'a@ejemplo.example' },
  lineas: [{ descripcion: 'Arroz', cantidad: '1', precioUnitario: '100.00' }],
  ...extra,
});
const caja = { establecimiento: '000', puntoEmision: '001', opciones: { reloj } };

async function preparar() {
  const almacen = new AlmacenFiscalMemoria();
  await registrarAutorizacion(almacen, AUT, { reloj, actor: 'admin', operador: 'Ana' });
  return almacen;
}

describe('actor y operador en la bitácora (apoya los controles de auditoría del Art. 53 num. 2; el operador es opcional y no lo exige el Reglamento)', () => {
  it('cada emisión deja DOCUMENTO_EMITIDO con actor y operador, en la misma transacción', async () => {
    const almacen = await preparar();
    const doc = await emitir(entrada(), { almacen, ...caja, actor: 'llave:abc (Caja 1, caja)', operador: '  María López ' });
    const [ev] = await eventosAuditoria(almacen, { tipo: 'DOCUMENTO_EMITIDO' });
    expect(ev).toMatchObject({
      numero: doc.numero, identificador: '000-001-01', actor: 'llave:abc (Caja 1, caja)', operador: 'María López',
      detalle: { tipoDocumento: '01', cai: AUT.cai, total: doc.totales.total },
    });
    // Sin operador en la entrada, el documento no lo imprime: la bitácora no cambia lo impreso.
    expect(doc.operador).toBeUndefined();
    expect(renderizarTexto(doc)).not.toContain('Atendido por');
  });

  it('una emisión rechazada no deja evento (ni consume número)', async () => {
    const almacen = await preparar();
    await expect(emitir(entrada({ lineas: [] }), { almacen, ...caja, operador: 'María' })).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await eventosAuditoria(almacen, { tipo: 'DOCUMENTO_EMITIDO' })).toEqual([]);
  });

  it('registro de CAI y anulación también guardan el operador', async () => {
    const almacen = await preparar();
    const doc = await emitir(entrada(), { almacen, ...caja });
    await anular(doc.numero, { almacen, motivo: 'Error en la cantidad', reloj, actor: 'supervisor', operador: 'Pedro' });
    expect((await eventosAuditoria(almacen, { tipo: 'AUTORIZACION_REGISTRADA' }))[0]).toMatchObject({ actor: 'admin', operador: 'Ana' });
    expect((await eventosAuditoria(almacen, { tipo: 'DOCUMENTO_ANULADO' }))[0]).toMatchObject({ actor: 'supervisor', operador: 'Pedro' });
    // Sin operador, el evento no lleva el campo.
    expect((await eventosAuditoria(almacen, { tipo: 'DOCUMENTO_EMITIDO' }))[0]).not.toHaveProperty('operador');
  });

  it('un operador inválido (vacío, largo o con caracteres de control) se rechaza antes de tocar el almacén', async () => {
    const almacen = await preparar();
    for (const operador of ['   ', 'x'.repeat(81), 'Ana\nBeto']) {
      await expect(emitir(entrada(), { almacen, ...caja, operador })).rejects.toMatchObject({ errores: [{ codigo: 'OPERADOR' }] });
      await expect(anular('000-001-01-00000001', { almacen, motivo: 'x', operador })).rejects.toMatchObject({ errores: [{ codigo: 'OPERADOR' }] });
    }
    expect(await eventosAuditoria(almacen, { tipo: 'DOCUMENTO_EMITIDO' })).toEqual([]);
  });
});

describe('operador impreso (opcional)', () => {
  it('DocumentoEntrada.operador se imprime como «Atendido por» en HTML y texto (y por tanto en el PDF)', async () => {
    const almacen = await preparar();
    const doc = await emitir(entrada({ operador: 'María <b>López</b>' }), { almacen, ...caja });
    expect(doc.operador).toBe('María <b>López</b>');
    expect(renderizarTexto(doc)).toContain('Atendido por: María <b>López</b>');
    expect(renderizarHTML(doc)).toContain('Atendido por: María &lt;b&gt;López&lt;/b&gt;');
    expect(Object.isFrozen(doc)).toBe(true);
  });

  it('validarEntrada rechaza un operador impreso inválido', () => {
    const v = validarEntrada(entrada({ operador: 'a\u0007b' }), AUT, { reloj });
    expect(v.errores.map((p) => p.codigo)).toContain('OPERADOR');
  });
});
