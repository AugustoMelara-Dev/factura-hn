// Pruebas de la reescritura de enlaces (lib/enlaces-md.mjs) y de la base (src/plugins/rehype-base.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import rehypeBase, { conBase } from '../src/plugins/rehype-base.mjs';
import { reescribirEnlaces, resolverEnlace } from './lib/enlaces-md.mjs';
import { mapaDeEnlaces } from './lib/paginas.mjs';

const REPO = 'https://github.com/AugustoMelara-Dev/factura-hn';

test('resolverEnlace: documento con página, sin página, carpeta, absolutos y anclas', () => {
  const mapa = mapaDeEnlaces();
  assert.equal(resolverEnlace('api.md', 'docs/guia-sdk.md', mapa), '/referencia/api/');
  assert.equal(resolverEnlace('errores.md#sin_autorizacion', 'docs/api.md', mapa), '/referencia/errores/#sin_autorizacion');
  assert.equal(resolverEnlace('docs/guia-sdk.md', 'llms.txt', mapa), '/referencia/sdk/');
  assert.equal(resolverEnlace('persistencia.md', 'docs/guia-sdk.md', mapa), `${REPO}/blob/main/docs/persistencia.md`);
  assert.equal(resolverEnlace('../examples/basico', 'docs/guia-sdk.md', mapa), `${REPO}/tree/main/examples/basico`);
  assert.equal(resolverEnlace('investigacion.md', 'docs/api.md', mapa), '/referencia/cumplimiento/');
  assert.equal(resolverEnlace('investigacion.md#3-pasos-ante-el-sar', 'docs/api.md', mapa), `${REPO}/blob/main/docs/investigacion.md#3-pasos-ante-el-sar`);
  for (const absoluto of ['https://ejemplo.example/x', '#ancla', '/conceptos/cai/', 'mailto:a@ejemplo.example']) {
    assert.equal(resolverEnlace(absoluto, 'docs/api.md', mapa), absoluto);
  }
});

test('reescribirEnlaces: cambia enlaces, referencias y href; no toca el código ni los comentarios', () => {
  const md = [
    'Ver [api](api.md) y ![img](a.png "t"), [r]: api.md, <a href="api.md">x</a>.',
    '[def]: api.md',
    'En código: `[no](api.md)` y <!-- [no](api.md) -->',
    '```md',
    '[no](api.md)',
    '```',
    '[sí](api.md#errores)',
  ].join('\n');
  const r = reescribirEnlaces(md, (d) => `<${d}>`.replace(/[<>]/g, '!'));
  assert.equal(
    r,
    [
      'Ver [api](!api.md!) y ![img](!a.png! "t"), [r]: api.md, <a href="!api.md!">x</a>.',
      '[def]: !api.md!',
      'En código: `[no](api.md)` y <!-- [no](api.md) -->',
      '```md',
      '[no](api.md)',
      '```',
      '[sí](!api.md#errores!)',
    ].join('\n'),
  );
});

test('conBase y rehype-base: solo los enlaces internos absolutos, una vez', () => {
  assert.equal(conBase('/conceptos/cai/', '/factura-hn'), '/factura-hn/conceptos/cai/');
  assert.equal(conBase('/factura-hn/conceptos/', '/factura-hn'), '/factura-hn/conceptos/');
  assert.equal(conBase('//cdn.ejemplo.example/x.js', '/factura-hn'), '//cdn.ejemplo.example/x.js');
  assert.equal(conBase('#ancla', '/factura-hn'), '#ancla');
  assert.equal(conBase('https://ejemplo.example/', '/factura-hn'), 'https://ejemplo.example/');
  assert.equal(conBase('/x/', ''), '/x/');

  const arbol = {
    type: 'root',
    children: [
      { type: 'element', tagName: 'a', properties: { href: '/referencia/' }, children: [] },
      { type: 'element', tagName: 'img', properties: { src: '/logo.svg' }, children: [] },
      { type: 'raw', value: '<iframe src="/playground/index.html"></iframe>' },
    ],
  };
  rehypeBase({ base: '/factura-hn' })(arbol);
  assert.equal(arbol.children[0].properties.href, '/factura-hn/referencia/');
  assert.equal(arbol.children[1].properties.src, '/factura-hn/logo.svg');
  assert.equal(arbol.children[2].value, '<iframe src="/factura-hn/playground/index.html"></iframe>');
});
