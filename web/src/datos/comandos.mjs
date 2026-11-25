// Comandos que muestran las páginas del producto. Son los del README, que tienen prueba: `scripts/verificar.mjs`
// falla si alguno deja de estar en el README.

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

/** Todas las líneas que deben estar en el README. */
export const COMANDOS = [INSTALAR, ...Object.values(PRIMEROS), ...PRIMERA_FACTURA];
