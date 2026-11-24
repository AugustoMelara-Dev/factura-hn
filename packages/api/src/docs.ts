/**
 * Página `/docs` (Swagger UI). Ahí se pegan llaves admin y de caja, así que el código que corre en el origen
 * de la API queda fijado:
 * - versión exacta de swagger-ui-dist (no «la última» del CDN) con Subresource Integrity;
 * - CSP que solo permite esos dos archivos y el arranque en línea (por su hash);
 * - sin marcos (frame-ancestors 'none' y X-Frame-Options) para que otra página no la envuelva.
 * Para actualizar Swagger UI: cambia la versión y recalcula los dos hashes (sha256 en base64 del archivo).
 */
import { createHash } from 'node:crypto';

const BASE = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';
const JS = `${BASE}/swagger-ui-bundle.js`;
const CSS = `${BASE}/swagger-ui.css`;
const SRI_JS = 'sha256-Nu601WQLnANrHQ+FRJmvHM7rvbJgt5CgOhi+XoSI+/U=';
const SRI_CSS = 'sha256-w8/oJIxLC4lnNgD7gpkk6vusbeS8SysG9fUkNIMHTQo=';

const ARRANQUE = "window.onload = () => { window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui', validatorUrl: null }); };";
const HASH_ARRANQUE = `sha256-${createHash('sha256').update(ARRANQUE).digest('base64')}`;

export const HTML_DOCS = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>factura-hn API</title>
<link rel="stylesheet" href="${CSS}" integrity="${SRI_CSS}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${JS}" integrity="${SRI_JS}" crossorigin="anonymous"></script>
<script>${ARRANQUE}</script>
</body>
</html>`;

export const CABECERAS_DOCS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'none'",
    `script-src '${HASH_ARRANQUE}' ${JS}`,
    `style-src ${CSS} 'unsafe-inline'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'X-Frame-Options': 'DENY',
};
