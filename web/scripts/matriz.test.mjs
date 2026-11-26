// Pruebas del verificador de la matriz de cumplimiento (scripts/lib/matriz.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { construirMatriz, lineaDelTitulo, matrizMarkdown, referencias } from './lib/matriz.mjs';

const matriz = (filas) => `# Matriz de cumplimiento

## Reglamento

| # | Requisito | factura-hn | Prueba |
|---|---|---|---|
${filas.join('\n')}
`;

test('la matriz real del repositorio: cada regla cubierta o parcial tiene su prueba', () => {
  const { tablas, problemas } = construirMatriz();
  assert.deepEqual(problemas, []);
  assert.ok(tablas.flatMap((t) => t.filas).length > 50);
});

test('referencias: archivos, contrato y citas', () => {
  const { refs, errores } = referencias('`matriz.test.ts` «Art. 9 …» y «Art. 10 …»; contrato `factura-hn/pruebas` «anula …»; `readme.test.ts`');
  assert.deepEqual(errores, []);
  assert.deepEqual(refs, [
    { archivo: 'matriz.test.ts', titulos: ['Art. 9 …', 'Art. 10 …'] },
    { archivo: 'contrato', titulos: ['anula …'] },
    { archivo: 'readme.test.ts', titulos: [] },
  ]);
  assert.deepEqual(referencias('«sin archivo»').errores, ['cita «sin archivo» sin archivo de prueba antes']);
});

test('lineaDelTitulo: «…» abrevia; solo cuenta un título de prueba', () => {
  const codigo = "// Art. 9 en un comentario\ndescribe('Art. 9: un documento por venta', () => {\n  it('se emite aun por L 0.01', () => {});\n});";
  assert.equal(lineaDelTitulo(codigo, 'Art. 9 …'), 2);
  assert.equal(lineaDelTitulo(codigo, 'se emite … L 0.01'), 3);
  assert.equal(lineaDelTitulo(codigo, 'Art. 10 …'), 0);
});

test('falla si un requisito pierde su prueba o no está marcado como implementado', () => {
  const { problemas } = construirMatriz(
    matriz([
      '| 1 | Sin prueba | ✅ | — |',
      '| 2 | Archivo que no existe | ✅ | `no-existe.test.ts` «x» |',
      '| 3 | Título que no existe | ✅ | `matriz.test.ts` «Art. 999 …» |',
      '| 4 | Bien | ✅ Con detalle | `matriz.test.ts` «Art. 9 …» |',
      '| 6 | Sin marca | implementado | `matriz.test.ts` |',
    ]),
  );
  assert.deepEqual(problemas, [
    'Reglamento, fila 1: sin prueba en la columna «Prueba»',
    'Reglamento, fila 2: no existe el archivo de prueba no-existe.test.ts',
    'Reglamento, fila 3: packages/core/test/matriz.test.ts no tiene una prueba titulada «Art. 999 …»',
    'Reglamento, fila 6: la columna «factura-hn» no empieza por ✅',
  ]);
});

test('la página: artículo, requisito y prueba, sin la marca ✅', () => {
  const md = matrizMarkdown(construirMatriz(matriz(['| 4 | Bien ✅ | ✅ Con detalle | `matriz.test.ts` «Art. 9 …» |'])));
  assert.match(md, /\| Artículo \| Requisito \| Prueba \|/);
  assert.match(md, /\| 4 \| Bien \| \[`matriz\.test\.ts` «Art\. 9 …»\]/);
  assert.doesNotMatch(md, /✅|Con detalle|Fuente|<small>/);
});
