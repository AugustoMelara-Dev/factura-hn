/** Validación de emisor.json al arrancar: un error por campo, con la ruta del archivo y cómo corregirlo. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { erroresEmisor, leerEmisor, plantillaEmisor } from '../src/emisor';

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Pulpería Ejemplo', nombreComercial: 'Pulpería Ejemplo', direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo', telefono: '0000-0001', correo: 'v@ejemplo.example',
};

const dir = mkdtempSync(join(tmpdir(), 'fhn-emisor-'));
let n = 0;
/** Escribe el contenido en un archivo nuevo y devuelve el error de leerEmisor (o '' si lo acepta). */
function errorAlLeer(contenido: string): { ruta: string; mensaje: string } {
  const ruta = join(dir, `emisor-${n++}.json`);
  writeFileSync(ruta, contenido);
  try {
    leerEmisor(ruta);
    return { ruta, mensaje: '' };
  } catch (e) {
    return { ruta, mensaje: (e as Error).message };
  }
}

describe('emisor.json', () => {
  it('un emisor completo se acepta, con o sin guiones en el RTN, y las claves con «_» se ignoran', () => {
    expect(erroresEmisor(EMISOR)).toEqual([]);
    const ruta = join(dir, 'bueno.json');
    writeFileSync(ruta, `﻿${JSON.stringify({ _nota: 'x', ...EMISOR, rtn: '9999-0000-000001' })}`);
    const e = leerEmisor(ruta);
    expect(e.rtn).toBe('9999-0000-000001');
    expect(Object.keys(e)).not.toContain('_nota');
  });

  it('archivo que falta: dice la ruta y cómo crearlo', () => {
    expect(() => leerEmisor(join(dir, 'no-existe.json'))).toThrow(/No se encontró el archivo del emisor \(FHN_EMISOR=.*no-existe\.json\)[\s\S]*init/);
  });

  it('JSON roto: dice la ruta y qué revisar', () => {
    const { ruta, mensaje } = errorAlLeer('{ "rtn": "99990000000001", }');
    expect(mensaje).toContain(`${ruta} no es un JSON válido`);
    expect(mensaje).toMatch(/comas, comillas y llaves/);
  });

  it('no es un objeto', () => {
    expect(erroresEmisor([EMISOR])).toEqual([expect.stringMatching(/objeto JSON/)]);
    expect(erroresEmisor('x')).toHaveLength(1);
  });

  it.each(Object.keys(EMISOR))('falta %s: un error para ese campo, con qué escribir', (campo) => {
    const { [campo]: _q, ...resto } = EMISOR as Record<string, string>;
    const errores = erroresEmisor(resto);
    expect(errores).toEqual([expect.stringMatching(new RegExp(`^${campo}: falta\\. Escribe `))]);
    // Vacío o con espacios es lo mismo que faltar.
    expect(erroresEmisor({ ...EMISOR, [campo]: '   ' })).toEqual(errores);
  });

  it('RTN con formato inválido: lo muestra y explica los 14 dígitos (Art. 10 num. 1 a)', () => {
    for (const rtn of ['9999000000001', '99990000000001X', '9999 0000 00000a']) {
      expect(erroresEmisor({ ...EMISOR, rtn })).toEqual([`rtn: "${rtn}" no es un RTN válido (Art. 10 num. 1 a): debe tener 14 dígitos, con o sin guiones (p. ej. "99990000000001").`]);
    }
  });

  it('un número donde va texto: pide comillas (el RTN como número pierde ceros)', () => {
    expect(erroresEmisor({ ...EMISOR, rtn: 99990000000001 })).toEqual([expect.stringMatching(/^rtn: debe ir entre comillas, como texto/)]);
    expect(erroresEmisor({ ...EMISOR, telefono: 1234 })).toEqual([expect.stringMatching(/^telefono: debe ir entre comillas/)]);
  });

  it('correo inválido: el mensaje del núcleo y qué escribir', () => {
    expect(erroresEmisor({ ...EMISOR, correo: 'ventas' })).toEqual([expect.stringMatching(/^correo: El correo del emisor no parece válido: "ventas"\. Escribe el correo/)]);
  });

  it('clave mal escrita (mayúsculas o tildes): dice el nombre correcto', () => {
    const { razonSocial, telefono, ...resto } = EMISOR;
    const errores = erroresEmisor({ ...resto, RazonSocial: razonSocial, 'teléfono': telefono });
    expect(errores).toContain('«RazonSocial»: el campo se llama «razonSocial» (con esas mayúsculas y sin tildes).');
    expect(errores).toContain('«teléfono»: el campo se llama «telefono» (con esas mayúsculas y sin tildes).');
    expect(errores).toContain('razonSocial: falta. Escribe el nombre o la razón social, como en el RTN.');
  });

  it('varios errores: uno por línea, con el conteo, la ruta y cómo seguir', () => {
    const { ruta, mensaje } = errorAlLeer(JSON.stringify({ ...EMISOR, rtn: '123', correo: '' }));
    expect(mensaje.split('\n')).toEqual([
      `El archivo del emisor tiene 2 errores (${ruta}):`,
      expect.stringMatching(/^- rtn: "123" no es un RTN válido/),
      expect.stringMatching(/^- correo: falta\. Escribe/),
      expect.stringMatching(/^Corrige el archivo, guárdalo y reinicia el servidor MCP/),
    ]);
    expect(errorAlLeer(JSON.stringify({ ...EMISOR, telefono: '' })).mensaje).toMatch(/^El archivo del emisor tiene 1 error \(/);
  });

  it('la plantilla de init no arranca hasta llenarla: los siete campos faltan', () => {
    const errores = erroresEmisor(plantillaEmisor());
    expect(errores).toHaveLength(7);
    expect(errores.every((e) => /: falta\. Escribe /.test(e))).toBe(true);
  });
});
