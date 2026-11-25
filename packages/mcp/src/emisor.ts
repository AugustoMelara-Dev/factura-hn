import { readFileSync } from 'node:fs';
import { esRTNValido, validarEntrada, type AutorizacionCAI, type Emisor } from 'factura-hn';

const AUTORIZACION_DE_PRUEBA: AutorizacionCAI = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 1, fechaLimiteEmision: '2999-12-31',
};

/** Los campos de `emisor.json`, en el orden del Art. 10 num. 1, con qué escribir en cada uno. */
const CAMPOS: Record<keyof Emisor, string> = {
  rtn: 'el RTN del negocio: 14 dígitos, con o sin guiones (p. ej. "99990000000001")',
  razonSocial: 'el nombre o la razón social, como en el RTN',
  nombreComercial: 'el nombre comercial; si no tiene uno distinto, repite la razón social',
  direccionCasaMatriz: 'la dirección de la casa matriz',
  direccionEstablecimiento: 'la dirección del establecimiento donde factura (puede ser la de la casa matriz)',
  telefono: 'el teléfono del negocio',
  correo: 'el correo del contrato de adhesión con el SAR (p. ej. "ventas@ejemplo.example")',
};

/**
 * Plantilla de `emisor.json` para el modo SQLite: los campos vacíos, para que el servidor no arranque hasta
 * llenarlos. Las claves que empiezan con «_» son notas y no se leen.
 */
export function plantillaEmisor(): Record<string, string> {
  return {
    _instrucciones:
      'Escribe los datos de tu negocio (Art. 10 num. 1 del Acuerdo 481-2017) y guarda. El servidor MCP los valida al arrancar.',
    ...Object.fromEntries(Object.keys(CAMPOS).map((k) => [k, ''])),
  };
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Errores de un `emisor.json` ya leído como JSON, uno por campo y con cómo corregirlo. Usa las mismas reglas
 * del emisor que aplica emitir (Art. 10 num. 1) y revisa además el tipo de cada campo y las claves mal escritas.
 */
export function erroresEmisor(datos: unknown): string[] {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    return ['El archivo debe contener un objeto JSON: { "rtn": "…", "razonSocial": "…", … }.'];
  }
  const d = datos as Record<string, unknown>;
  const errores: string[] = [];
  const conocidos = Object.keys(CAMPOS);
  // Una clave con otra mayúscula o con tilde («RazonSocial», «teléfono») es casi siempre un error de digitación.
  for (const k of Object.keys(d)) {
    if (k.startsWith('_') || conocidos.includes(k)) continue;
    const parecido = conocidos.find((c) => sinTildes(c) === sinTildes(k));
    if (parecido) errores.push(`«${k}»: el campo se llama «${parecido}» (con esas mayúsculas y sin tildes).`);
  }
  const malTipo = new Set<string>();
  for (const [k, ayuda] of Object.entries(CAMPOS)) {
    const v = d[k];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      malTipo.add(k);
      errores.push(`${k}: debe ir entre comillas, como texto. Escribe ${ayuda}.`);
    }
  }
  const emisor = Object.fromEntries(conocidos.map((k) => [k, typeof d[k] === 'string' ? d[k] : undefined])) as unknown as Emisor;
  const { errores: problemas } = validarEntrada({ emisor, lineas: [{ descripcion: 'x', cantidad: 1, precioUnitario: '1' }] }, AUTORIZACION_DE_PRUEBA);
  const vistos = new Set<string>();
  for (const p of problemas) {
    if (!p.codigo.startsWith('EMISOR_') || !p.campo?.startsWith('emisor.')) continue;
    const campo = p.campo.slice('emisor.'.length) as keyof Emisor;
    if (malTipo.has(campo) || vistos.has(campo)) continue;
    vistos.add(campo);
    const valor = d[campo];
    const ayuda = CAMPOS[campo] ?? 'el dato correcto';
    if (typeof valor !== 'string' || !valor.trim()) {
      errores.push(`${campo}: falta. Escribe ${ayuda}.`);
    } else if (campo === 'rtn' && !esRTNValido(valor)) {
      errores.push(`rtn: "${valor}" no es un RTN válido (Art. 10 num. 1 a): debe tener 14 dígitos, con o sin guiones (p. ej. "99990000000001").`);
    } else {
      errores.push(`${campo}: ${p.mensaje} Escribe ${ayuda}.`);
    }
  }
  return errores;
}

/**
 * Lee y valida `emisor.json` (FHN_EMISOR) al arrancar el modo SQLite: un archivo que falta, un JSON roto o un
 * emisor incompleto se informan en el log del cliente MCP, con la ruta y qué corregir, no en la primera venta.
 */
export function leerEmisor(ruta: string): Emisor {
  let texto: string;
  try {
    texto = readFileSync(ruta, 'utf8');
  } catch {
    throw new Error(
      `No se encontró el archivo del emisor (FHN_EMISOR=${ruta}).\n` +
        'Créalo con `npx -y @factura-hn/mcp init` (o `init --demo` para probar), o corrige la ruta en la configuración del cliente MCP.',
    );
  }
  let datos: unknown;
  try {
    datos = JSON.parse(texto.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(
      `${ruta} no es un JSON válido: ${e instanceof Error ? e.message : String(e)}\n` +
        'Revisa comas, comillas y llaves: cada texto va entre comillas dobles y no hay coma después del último campo.',
    );
  }
  const errores = erroresEmisor(datos);
  if (errores.length) {
    throw new Error(
      `El archivo del emisor tiene ${errores.length === 1 ? '1 error' : `${errores.length} errores`} (${ruta}):\n` +
        `${errores.map((e) => `- ${e}`).join('\n')}\n` +
        'Corrige el archivo, guárdalo y reinicia el servidor MCP desde tu cliente. Hay un ejemplo completo en el README de @factura-hn/mcp.',
    );
  }
  const d = datos as Record<string, string>;
  return Object.fromEntries(Object.keys(CAMPOS).map((k) => [k, d[k]])) as unknown as Emisor;
}
