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
  assert.deepEqual(nombres('las decisiones DEC-xxx'), ['código de decisión interna']);
  assert.deepEqual(nombres('NO reintenta solo (DEC-RES-003)'), ['código de decisión interna']);
  assert.deepEqual(nombres('contenido que falta (F-01)'), ['código de pendiente interno']);
  assert.deepEqual(nombres('el DNI tiene 13 dígitos (M66)'), ['código de hallazgo interno']);
  assert.deepEqual(nombres('mutaciones M31-M35: datos del emisor'), ['código de hallazgo interno']);
  assert.deepEqual(nombres('la rama lote4/x'), ['tanda de trabajo numerada']);
  assert.deepEqual(nombres('(Lote 4)'), ['tanda de trabajo numerada']);
  assert.deepEqual(nombres('el lote 2 del plan'), ['tanda de trabajo numerada']);
  assert.deepEqual(nombres('ver claude.md'), ['documento interno']);
  assert.deepEqual(nombres('Generated with Claude Code'), ['atribución a una herramienta de IA']);
  assert.deepEqual(nombres('Revisión interna de la matriz'), ['jerga del proceso']);
  assert.deepEqual(nombres('las revisiones internas'), ['jerga del proceso']);
  assert.deepEqual(nombres('hallazgos del núcleo'), ['jerga del proceso']);
  assert.deepEqual(nombres('el hallazgo M4 de la segunda ronda'), ['jerga del proceso']);
  assert.deepEqual(nombres('la auditoría de agentes'), ['jerga del proceso']);
});

test('detecta menciones a las herramientas de IA con que se construyó', () => {
  const ia = 'herramienta de IA usada para construirlo';
  assert.deepEqual(nombres('Proyecto hecho con Claude Code.'), [ia]);
  assert.deepEqual(nombres('El SDK fue construido con ayuda de IA'), [ia]);
  assert.deepEqual(nombres('El SDK fue construido con la ayuda de Claude'), [ia]);
  assert.deepEqual(nombres('desarrollado usando inteligencia artificial'), [ia]);
  assert.deepEqual(nombres('programada con una IA'), [ia]);
  assert.deepEqual(nombres('Built with Claude'), [ia]);
  assert.deepEqual(nombres('made with AI'), [ia]);
  assert.deepEqual(nombres('lo revisó Claude Opus'), [ia]);
  assert.deepEqual(nombres('Claude Sonnet 4'), [ia]);
  assert.deepEqual(nombres('lo partió un subagente'), ['jerga del proceso']);
  assert.deepEqual(nombres('Lote 3: anulación'), ['tanda de trabajo numerada']);
});

test('detecta lenguaje de duda o de estado y la demostración en la nube', () => {
  const duda = 'lenguaje de duda o de estado';
  const nube = 'demostración en la nube';
  assert.deepEqual(nombres('Regla pendiente de consulta.'), [duda]);
  assert.deepEqual(nombres('pendiente de validación con el contador'), [duda]);
  assert.deepEqual(nombres('Pendiente de validacion'), [duda]);
  assert.deepEqual(nombres('Es una lectura provisional del Art. 10.'), [duda]);
  assert.deepEqual(nombres('lecturas provisionales'), [duda]);
  assert.deepEqual(nombres('Ver la consulta al SAR.'), [duda]);
  assert.deepEqual(nombres('las consultas al SAR'), [duda]);
  assert.deepEqual(nombres('Todavía sin respuesta del SAR.'), [duda]);
  assert.deepEqual(nombres('## Estado legal'), [duda]);
  assert.deepEqual(nombres('[aquí](/produccion/estado-legal/)'), [duda]);
  assert.deepEqual(nombres('Pruébalo ahora'), [nube]);
  assert.deepEqual(nombres('PRUEBALO AHORA'), [nube]);
  assert.deepEqual(nombres('curl https://API_DE_LA_DEMO/v1'), [nube]);
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
    // La palabra fiscal u operativa «lote» con número.
    'Se entregan en el lote 3. El Lote 1 de facturas ya salió. Lote 2 de 5 enviado.',
    // Tallas y trazos de un SVG.
    'Camisa Talla P-10, talla B-12.',
    '<path d="M6 4h12v16H6z M10 8l4 4"/>',
    // Hallazgos de una prueba de seguridad, en una frase normal.
    'Hallazgos y correcciones: un hallazgo corregido en el límite de solicitudes.',
    // Auditoría fiscal (la bitácora) y agentes de IA del usuario.
    'La auditoría de la bitácora; instrucciones para agentes de IA.',
    // Documentos y entregas pendientes, y el estado de un documento.
    'Documentos pendientes de envío; webhooks pendientes de entrega; 3 documentos pendientes.',
    'El estado del documento (emitido, anulado); el estado de la entrega; un lote de documentos.',
    'Validación pendiente del formulario; la consulta de un documento; consultar el CAI en el portal del SAR.',
    // Lo que el asistente del usuario emite o escribe, y el modo de prueba local.
    'La factura generada por el agente; el código que escribe Claude Code; creado con Claude Desktop.',
    'Pídele a Claude Code que lo integre: hecho con el SDK; construido con factura-hn.',
    'Pruébalo en tu equipo con npx factura-hn demo; ahora emite la factura.',
    'Modelo de datos; el modelo de la factura; Sonnet de Shakespeare; el Opus Dei.',
  ].join('\n');
  assert.deepEqual(buscarTerminos(muestra), []);
});
