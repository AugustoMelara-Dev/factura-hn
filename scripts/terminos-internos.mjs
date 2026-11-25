// Términos del proceso interno de desarrollo que no deben aparecer en el repositorio público ni en lo que se
// publica: códigos de registros internos, jerga del proceso y referencias a documentos que no son parte del
// producto. Lo usan verificar-terminos.mjs (todo el repositorio y el sitio construido) y verificar-dist.mjs (los
// paquetes de npm). Las pruebas están en terminos-internos.test.mjs.
//
// Lo que sí está permitido: un RTN o un monto (no tienen la forma «LETRA-dos dígitos»), la palabra fiscal «lote»
// (un lote de documentos o de entregas, sin número de orden) y los clientes de IA que el usuario conecta (Claude
// Desktop, Claude Code, ChatGPT, Cursor) en la configuración del MCP y de la skill.

/** [nombre, patrón]. Los patrones de códigos distinguen mayúsculas y usan límites de palabra. */
export const TERMINOS = [
  ['código de decisión interna', /\bDEC-\d{3}\b/],
  ['código de pendiente interno', /\b[BPD]-(?:\d{2}|xx)\b/],
  ['marca de revisión interna', /\[REVISAR\]/],
  ['tanda de trabajo numerada', /\b[Ll]ote \d+\b|\blote\d\b/],
  ['jerga del proceso', /\b(?:sub-?agentes?|subagents?|worktrees?|orquestador(?:es|a)?)\b/i],
  ['documento interno', /\b(?:avance|plan-v1|decisiones|investigacion|consulta-sar|lanzamiento|modelo-de-negocio)\.md\b|\bdocs\/analisis\b|\bCLAUDE\.md\b|\bPROMPT_CLAUDE_CODE\b/],
  ['página retirada del sitio', /\/referencia\/decisiones\b|\/produccion\/consulta-sar\b/],
  ['atribución a una herramienta de IA', /Co-Authored-By:|Generated with \[Claude|Generado con \[Claude/i],
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
