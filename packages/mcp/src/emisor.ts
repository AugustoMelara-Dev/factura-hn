import { readFileSync } from 'node:fs';
import { validarEntrada, type AutorizacionCAI, type Emisor } from 'factura-hn';

const AUTORIZACION_DE_PRUEBA: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 1, fechaLimiteEmision: '2999-12-31',
};

/**
 * Lee y valida `emisor.json` (FHN_EMISOR) al arrancar el modo SQLite: un archivo que falta, un JSON roto o un
 * emisor incompleto se informan en el log del cliente MCP con qué corregir, no en la primera venta.
 */
export function leerEmisor(ruta: string): Emisor {
  let texto: string;
  try {
    texto = readFileSync(ruta, 'utf8');
  } catch {
    throw new Error(
      `No se encontró el archivo del emisor (FHN_EMISOR=${ruta}). Crea un JSON con rtn, razonSocial, nombreComercial, ` +
        'direccionCasaMatriz, direccionEstablecimiento, telefono y correo (ver el README de @factura-hn/mcp).',
    );
  }
  let emisor: Emisor;
  try {
    emisor = JSON.parse(texto.replace(/^﻿/, '')) as Emisor;
  } catch (e) {
    throw new Error(`${ruta} no es un JSON válido: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Las mismas reglas del emisor que aplica emitir (Art. 10 num. 1), con un documento cualquiera de una línea.
  const { errores } = validarEntrada({ emisor, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, AUTORIZACION_DE_PRUEBA);
  const problemas = errores.filter((p) => p.codigo.startsWith('EMISOR_'));
  if (problemas.length) {
    throw new Error(`Datos del emisor incompletos en ${ruta}:\n${problemas.map((p) => `- ${p.mensaje}`).join('\n')}`);
  }
  return emisor;
}
