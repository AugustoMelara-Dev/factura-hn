// Términos que no deben aparecer en el repositorio público ni en lo que se publica (el sitio y los paquetes de npm):
// códigos de registros internos, jerga del proceso de desarrollo, menciones a las herramientas de IA con que se
// construyó, documentos que no son parte del producto y lenguaje de duda o de estado («pendiente de consulta»,
// «estado legal»). Lo usan verificar-terminos.mjs (todo el repositorio y el sitio construido) y verificar-dist.mjs
// (los paquetes de npm). Las pruebas están en terminos-internos.test.mjs.
//
// Lo que sí está permitido: un RTN o un monto (no tienen la forma «LETRA-dos dígitos»), la palabra fiscal «lote»
// (un lote de documentos o de entregas, sin número de orden), «documentos pendientes», y los clientes de IA que el
// usuario conecta (Claude Desktop, Claude Code, ChatGPT, Cursor) en la configuración del MCP y de la skill.

/** [nombre, patrón]. Los patrones de códigos distinguen mayúsculas y usan límites de palabra. */
export const TERMINOS = [
  ['código de decisión interna', /\bDEC-[A-Za-z0-9]/],
  // B/P/D/F más dos dígitos; una talla de ropa («Talla P-10») no cuenta.
  ['código de pendiente interno', /(?<!\b[Tt]alla )\b[BPDF]-(?:\d{2}|xx)\b/],
  // Códigos de hallazgos de mutación («M66)», «M31-M35:»). Exige el «)» o el «:» detrás: así no toma los
  // trazos de un SVG («M6 4»).
  ['código de hallazgo interno', /\bM\d{1,3}(?:-M?\d{1,3})?(?=[):])/],
  ['marca de revisión interna', /\[REVISAR\]/],
  // Una tanda de trabajo: «Lote 4:», «(Lote 4)», «lote 2 del plan» o un identificador «lote6». La palabra fiscal
  // («el lote 3», «Lote 1 de facturas») no cuenta.
  ['tanda de trabajo numerada', /\b[Ll]ote \d+(?=\s*[:)]|\s+del plan)|\blote\d+\b/],
  ['jerga del proceso', /\b(?:sub-?agentes?|subagents?|worktrees?|orquestador(?:es|a)?)\b|\brevisi[oó]n(?:es)? internas?\b|\bauditor[ií]as? de agentes\b|\bhallazgos? (?:del (?:lote|n[úu]cleo)|de la (?:ronda|revisi[oó]n))\b|\bhallazgos? [A-Z]{1,2}-?\d/i],
  ['documento interno', /\b(?:avance|plan-v1|decisiones|investigacion|consulta-sar|lanzamiento|modelo-de-negocio)\.md\b|\bdocs\/analisis\b|\bCLAUDE\.md\b|\bPROMPT_CLAUDE_CODE\b/i],
  ['página retirada del sitio', /\/referencia\/decisiones\b|\/produccion\/consulta-sar\b/],
  ['atribución a una herramienta de IA', /Co-Authored-By:|Generated with \[?Claude|Generado con \[?Claude/i],
  // Cómo se construyó el proyecto: «hecho con Claude Code», «built with AI», un modelo por su nombre. No cuentan
  // el cliente que el usuario conecta («Configura el MCP en Claude Code»), ni lo que emite o escribe el asistente
  // del usuario («la factura generada por el agente», «el código que escribe Claude Code»): por eso solo
  // «hecho/construido/desarrollado/programado con…», no «generado» ni «creado».
  ['herramienta de IA usada para construirlo', /\b(?:hech[oa]s?|construid[oa]s?|desarrollad[oa]s?|programad[oa]s?) (?:con|usando) (?:(?:la )?ayuda de )?(?:Claude|ChatGPT|Codex|Copilot|Gemini|GPT|una? IA|IA|inteligencia artificial)\b|\b(?:built|made|written|developed) (?:with|using) (?:Claude|ChatGPT|Codex|Copilot|Gemini|GPT|AI)\b|\bClaude (?:Opus|Sonnet|Haiku)\b/i],
  // Lenguaje de duda o de estado: la regla se explica con su artículo, sin estados de validación.
  ['lenguaje de duda o de estado', /\bpendientes? de (?:consulta|validaci[oó]n)\b|\blecturas? provisional(?:es)?\b|\bconsultas? al SAR\b|\bsin respuesta del SAR\b|\bestado[ -]legal\b/i],
  // La demostración pública en la nube no existe: ni su llamada ni su marcador de URL.
  ['demostración en la nube', /\bpru[eé]balo ahora\b|API_DE_LA_DEMO/i],
];

/** Coincidencias en un texto: [{ linea (1…n), nombre, texto }]. */
export function buscarTerminos(texto) {
  const hallazgos = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    for (const [nombre, patron] of TERMINOS) {
      const m = patron.exec(lineas[i]);
      if (m) hallazgos.push({ linea: i + 1, nombre, texto: m[0] });
    }
  }
  return hallazgos;
}
