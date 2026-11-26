/** Qué hacer ante cada error del MCP: la solución propia, la del SDK o una general que dice qué revisar. */
import { describe, expect, it } from 'vitest';
import { SOLUCIONES } from 'factura-hn';
import { conSolucion, solucionPara } from '../src/soluciones';

describe('solucionPara', () => {
  it('usa la solución propia del MCP, pensada para el asistente', () => {
    expect(solucionPara({ codigo: 'SIN_AUTORIZACION' })).toContain('registrar_cai');
  });

  it('sin una propia, usa la del SDK en vez de un texto genérico', () => {
    for (const codigo of ['LINEA_ISV', 'MONTO_FUERA_DE_RANGO', 'DOCUMENTO_CON_NOTAS', 'TIPO_CAMBIO']) {
      expect(solucionPara({ codigo }), codigo).toBe(SOLUCIONES[codigo]);
    }
  });

  it('un código desconocido dice qué revisar y qué hacer después, con o sin campo', () => {
    expect(solucionPara({ codigo: 'OTRO', campo: 'lineas.0.cantidad' })).toBe(
      'Revisa con el usuario el dato de lineas.0.cantidad, corrígelo según el mensaje y vuelve a llamar la herramienta.',
    );
    expect(solucionPara({ codigo: 'OTRO' })).toMatch(/^Explícale el mensaje al usuario, corrige con él el dato que nombra y vuelve a intentarlo\./);
  });

  it('SOLICITUD_INVALIDA nombra el campo real (no «`campo`»); sin campo, habla de los argumentos', () => {
    for (const campo of ['lineas', 'lineas.0.isv', 'desde']) {
      expect(solucionPara({ codigo: 'SOLICITUD_INVALIDA', campo })).toBe(`Corrige ${campo} según el mensaje y vuelve a llamar la herramienta. Si el dato viene del usuario, pregúntaselo.`);
    }
    expect(solucionPara({ codigo: 'SOLICITUD_INVALIDA' })).toMatch(/^Corrige los argumentos según el mensaje/);
    expect(solucionPara({ codigo: 'SOLICITUD_INVALIDA', campo: 'idempotencyKey' })).toContain('reutiliza la misma clave');
  });

  it('NO_AUTENTICADO sirve por stdio y por URL; NO_ENCONTRADO manda a listar_documentos', () => {
    expect(solucionPara({ codigo: 'NO_AUTENTICADO' })).toBe('La llave de API o la URL del MCP no es válida o fue revocada. Pide una nueva al administrador.');
    expect(solucionPara({ codigo: 'NO_ENCONTRADO' })).toContain('listar_documentos');
    expect(solucionPara({ codigo: 'NO_ENCONTRADO' })).not.toContain('libro_ventas');
  });

  it('conSolucion agrega la solución y el enlace a la guía', () => {
    expect(conSolucion({ codigo: 'LINEA_ISV', mensaje: 'x' })).toMatchObject({
      solucion: SOLUCIONES.LINEA_ISV,
      guia: 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#linea_isv',
    });
  });
});
