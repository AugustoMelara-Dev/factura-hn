/**
 * Reglamento Art. 41 (C L.1943-1955): documentos con errores se anulan con la leyenda «ANULADA» y se
 * resguardan en orden cronológico. El número se conserva y no se reutiliza.
 */
import { describe, expect, it } from 'vitest';
import {
  ErrorValidacion,
  estaAnulado,
  filaLibroVentas,
  libroVentasCSV,
  renderizarHTML,
  renderizarTexto,
  type AutorizacionCAI,
  type DocumentoFiscal,
} from '../src';
import { construirDocumento } from '../src/documento';
import { anularDocumento } from '../src/anulacion';

const AUT: AutorizacionCAI = {
  cai: 'X1', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 10, fechaLimiteEmision: '2027-06-30',
};
const emitir = (): DocumentoFiscal =>
  construirDocumento(
    {
      emisor: { rtn: '08011999123456', razonSocial: 'E', nombreComercial: 'E', direccionCasaMatriz: 'D', direccionEstablecimiento: 'D', telefono: '1', correo: 'a@b.hn' },
      lineas: [{ descripcion: 'Arroz', cantidad: 1, precioUnitario: '100' }],
    },
    AUT,
    7,
  );
const manana = () => new Date('2026-11-19T09:00:00-06:00');

describe('anularDocumento (Art. 41)', () => {
  it('marca el documento como ANULADO con motivo y fecha del reloj de Honduras', () => {
    const anulado = anularDocumento(emitir(), { motivo: 'Error en la cantidad', reloj: manana });
    expect(anulado.estado).toBe('ANULADO');
    expect(anulado.anulacion).toEqual({ motivo: 'Error en la cantidad', fecha: '2026-11-19', hora: '09:00' });
    expect(estaAnulado(anulado)).toBe(true);
  });

  it('conserva el número, el correlativo, la fecha de emisión y los montos', () => {
    const doc = emitir();
    const anulado = anularDocumento(doc, { motivo: 'x' });
    expect(anulado.numero).toBe('000-001-01-00000007');
    expect(anulado.correlativo).toBe(7);
    expect(anulado.fechaEmision).toBe(doc.fechaEmision);
    expect(anulado.totales).toEqual(doc.totales);
  });

  it('no modifica el original y los documentos son inmutables', () => {
    const doc = emitir();
    anularDocumento(doc, { motivo: 'x' });
    expect(doc.estado).toBe('EMITIDO');
    expect(Object.isFrozen(doc)).toBe(true);
    expect(Object.isFrozen(doc.totales)).toBe(true);
    expect(() => {
      (doc as { estado: string }).estado = 'ANULADO';
    }).toThrow(TypeError);
  });

  it('el motivo es obligatorio', () => {
    expect(() => anularDocumento(emitir(), { motivo: '  ' })).toThrow(ErrorValidacion);
  });

  it('no se puede anular dos veces ni reactivar', () => {
    const anulado = anularDocumento(emitir(), { motivo: 'x' });
    try {
      anularDocumento(anulado, { motivo: 'otra vez' });
      expect.unreachable();
    } catch (e) {
      expect((e as ErrorValidacion).errores[0]!.codigo).toBe('YA_ANULADO');
    }
  });

  it('el HTML y el texto impreso llevan la leyenda ANULADA; el emitido no', () => {
    const doc = emitir();
    const anulado = anularDocumento(doc, { motivo: 'Error en la cantidad' });
    expect(renderizarHTML(anulado)).toContain('>ANULADA<');
    expect(renderizarHTML(anulado)).toContain('Error en la cantidad');
    const texto = renderizarTexto(anulado);
    expect(texto.split('\n')[0]).toContain('*** ANULADA ***');
    expect(texto.trimEnd().split('\n').at(-1)).toContain('*** ANULADA ***');
    expect(renderizarHTML(doc)).not.toContain('ANULADA');
    expect(renderizarTexto(doc)).not.toContain('ANULADA');
  });

  it('el libro de ventas toma el estado del documento: número presente, montos en cero', () => {
    const anulado = anularDocumento(emitir(), { motivo: 'x' });
    const fila = filaLibroVentas(anulado);
    expect(fila).toMatchObject({ numero: '000-001-01-00000007', anulado: true, total: 0, isv15: 0 });
    expect(libroVentasCSV([fila])).toContain(',SI\n');
  });
});
