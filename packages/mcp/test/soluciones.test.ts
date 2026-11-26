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

  it('conSolucion agrega la solución y el enlace a la guía', () => {
    expect(conSolucion({ codigo: 'LINEA_ISV', mensaje: 'x' })).toMatchObject({
      solucion: SOLUCIONES.LINEA_ISV,
      guia: 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md#linea_isv',
    });
  });
});
