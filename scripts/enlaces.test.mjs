// Pruebas de enlaces.mjs: node --test scripts/enlaces.test.mjs (verificar-dist.mjs las corre primero).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinosDe, enlacesRotos } from './enlaces.mjs';

/** Paquete de prueba: README.md con `md`, más los archivos que existen. */
const rotos = (md, doc = 'README.md') =>
  enlacesRotos(new Map([[doc, md], ['LICENSE', ''], ['docs/api.md', ''], ['docs/a (b).md', ''], ['skills/x/SKILL.md', '']])).map(([, d]) => d);

test('enlaces válidos: no se reportan', () => {
  const md = [
    '[licencia](LICENSE) [api](docs/api.md) [ancla](docs/api.md#errores) [carpeta](skills) [carpeta/](skills/)',
    '[aquí](./) [misma página](#uso) [npm](https://www.npmjs.com/package/factura-hn) [correo](mailto:x@ejemplo.example)',
    '[con título](docs/api.md "Título") [título simple](docs/api.md \'Título\') [título paréntesis](docs/api.md (Título))',
    '[paréntesis](docs/a%20(b).md) [ángulos](<docs/a (b).md>) <https://ejemplo.example> <x@ejemplo.example>',
    '![img](LICENSE) <a href="docs/api.md">x</a> <img src=\'LICENSE\'> <br/> </div> <details>',
    '[r]: docs/api.md "Título"',
    '[s]: <docs/a (b).md>',
  ].join('\n');
  assert.deepEqual(rotos(md), []);
});

test('enlaces rotos: relativos fuera del paquete o inexistentes', () => {
  const md = [
    '[core](../core) [ej](examples/basico) [abs](/docs/api.md)',
    '[con título](../core "x") [título simple](../uno \'x\') [título paréntesis](../dos (x))',
    '[ángulos con espacios](<docs/no existe.md>)',
    '<../tres> <docs/cuatro.md>',
    '[paréntesis](docs/c(d).md)',
    '<a href="../cinco">x</a>',
  ].join('\n');
  assert.deepEqual(rotos(`${md}\n\n[r]: ../seis\n[t]: <../siete con espacio> "x"\n`).sort(), [
    '../core', '../cinco', '../dos', '../seis', '../siete con espacio', '../tres', '../uno', '/docs/api.md',
    'docs/c(d).md', 'docs/cuatro.md', 'docs/no existe.md', 'examples/basico',
  ].sort());
});

test('desde un subdirectorio, .. vuelve dentro del paquete', () => {
  assert.deepEqual(rotos('[api](api.md) [lic](../LICENSE) [fuera](../../x)', 'docs/guia.md'), ['../../x']);
});

test('el código no cuenta: vallas de 3+ comillas o ~~~, con sangría, código en línea y comentarios', () => {
  const md = [
    '```ts', '[a](../a)', '```',
    '- lista', '   ```bash', '   [b](../b)', '   ```',
    '1. otra', '     ~~~~', '     [c](../c)', '     ~~~~',
    '````md', '```', '[d](../d)', '```', '````',
    'Texto `[e](../e)` y ``[f](../f) con ` dentro``.',
    '<!-- [g](../g) -->',
    '[h](../h)',
  ].join('\n');
  assert.deepEqual(rotos(md), ['../h']);
});

test('CRLF y un % suelto no rompen nada', () => {
  assert.deepEqual(rotos('[a](docs/api.md)\r\n[b](../b%)\r\n[c](docs/100%.md)'), ['../b%', 'docs/100%.md']);
});

test('llms.txt también se revisa; otros .txt no', () => {
  const archivos = new Map([['llms.txt', '[x](../x) [r](README.md)'], ['README.md', ''], ['otro.txt', '[y](../y)']]);
  assert.deepEqual(enlacesRotos(archivos), [['llms.txt', '../x']]);
});

test('destinosDe no duplica', () => {
  assert.deepEqual(destinosDe('[a](x.md) [b](x.md)'), ['x.md']);
});
