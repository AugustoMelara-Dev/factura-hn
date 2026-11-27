// Comandos que muestra la portada. Son los del README (y, los del MCP por HTTP, los del README del MCP), que
// tienen prueba: `scripts/verificar.mjs` falla si alguno deja de estar ahí.

export const INSTALAR = 'npm install factura-hn';

/** Por producto: el primer comando de cada camino. */
export const PRIMEROS = {
  sdk: 'npm install factura-hn',
  cli: 'npx factura-hn demo',
  api: 'docker compose up -d --build --wait',
  mcp: 'npx -y @factura-hn/mcp init --demo',
};

/** La primera factura con el SDK, en tres comandos. */
export const PRIMERA_FACTURA = [
  'npm install factura-hn',
  'npx factura-hn init     # crea emitir.mjs y emisor.json',
  'node emitir.mjs         # emite la factura de prueba',
];

/** La API REST con Docker, desde un clon del repositorio. */
export const API_DOCKER = [
  'git clone https://github.com/AugustoMelara-Dev/factura-hn.git && cd factura-hn',
  'docker compose up -d --build --wait     # API en http://127.0.0.1:8787',
];

/** Todas las líneas que deben estar en el README. */
export const COMANDOS = [INSTALAR, ...Object.values(PRIMEROS), ...PRIMERA_FACTURA, ...API_DOCKER];

/** El MCP remoto (Streamable HTTP) en tu equipo, contra la API local. Están en packages/mcp/README.md. */
export const MCP_HTTP = ['FHN_API_URL=http://127.0.0.1:8787 FHN_MCP_HOST=127.0.0.1 npx -y @factura-hn/mcp http'];
