// Datos del proyecto que muestran las páginas del producto. Se leen del repositorio al construir: la versión del
// paquete y la matriz de cumplimiento (la misma que genera /referencia/cumplimiento/), así no se publica un dato
// viejo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from '../../sitio.config.mjs';
import { construirMatriz, ESTADOS } from '../../scripts/lib/matriz.mjs';

export const version: string = JSON.parse(readFileSync(join(RAIZ, 'packages/core/package.json'), 'utf8')).version;

interface Fila {
  estado: { clase: string; texto: string };
  pruebas: unknown[];
}
const { tablas } = construirMatriz() as { tablas: { titulo: string; filas: Fila[] }[] };
const filas = tablas.flatMap((t) => t.filas);
const contar = (clase: string, de: Fila[] = filas) => de.filter((f) => f.estado.clase === clase).length;

export const matriz = {
  total: filas.length,
  pruebas: filas.reduce((n, f) => n + f.pruebas.length, 0),
  porEstado: Object.values(ESTADOS as Record<string, { clase: string; texto: string }>).map((e) => ({
    clase: e.clase,
    texto: e.texto,
    cuenta: contar(e.clase),
  })),
  secciones: tablas.map((t) => ({
    titulo: t.titulo,
    total: t.filas.length,
    cubiertos: contar('cubierto', t.filas),
    parciales: contar('parcial', t.filas),
  })),
  cubiertos: contar('cubierto'),
};
