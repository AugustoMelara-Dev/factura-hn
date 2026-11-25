// Pruebas de terminos-internos.mjs: node --test scripts/terminos-internos.test.mjs (las corre `pnpm verificar:terminos`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buscarTerminos } from './terminos-internos.mjs';

const nombres = (texto) => buscarTerminos(texto).map((h) => h.nombre);

test('detecta los términos internos, con su línea', () => {
  const muestra = [
    'Ver DEC-051 para la nota.',
    'Pendiente B-13 y la pregunta P-02; decisión D-01; los B-xx.',
    'Interpretación [REVISAR] del proyecto.',
    'Lote 6: revisión final. En el lote 2 también.',
    'Lo hizo un subagente en su worktree, según el orquestador.',
    'Fuente: docs/investigacion.md, docs/decisiones.md y docs/analisis/sdk.md.',
    'Las reglas del repositorio están en CLAUDE.md.',
    'Ver [consulta](/produccion/consulta-sar/) y [decisiones](/referencia/decisiones/#dec-001).',
    'Co-Authored-By: alguien',
  ].join('\n');
  const h = buscarTerminos(muestra);
  assert.deepEqual(
    h.map((x) => x.linea),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(h.find((x) => x.linea === 2).texto, 'B-13');
  assert.deepEqual(nombres('DEC-182'), ['código de decisión interna']);
  assert.deepEqual(nombres('la rama lote4/x'), ['tanda de trabajo numerada']);
});

test('no confunde el texto del producto con términos internos', () => {
  const muestra = [
    // RTN, CAI de demostración, números de documento y montos.
    'RTN 99999999999999, CAI DEMO00-NO-VALIDO-000000-000000-00, número 000-001-01-00000001, total L 1,150.00.',
    // La palabra fiscal «lote», sin número de orden.
    'Los webhooks se entregan por lote; el lote de documentos del mes. Un lote de facturas.',
    // Clientes de IA que el usuario conecta.
    'Configura el MCP en Claude Desktop, Claude Code, Cursor o ChatGPT. Skill de Claude.',
    // Artículos, códigos de error y palabras parecidas.
    'Art. 4 num. 32; AVISO_ORIGINAL_EXTERNO; NOTA_SUPERA_ORIGINAL; tipo 06; la ISO-8601; UTF-8; P-256.',
    'Decisiones de diseño; investigación normativa; consulta al contador; el plan de cuentas; avance del mes.',
    'Un ADEC-0510 o un B-123 no son códigos internos.',
  ].join('\n');
  assert.deepEqual(buscarTerminos(muestra), []);
});
