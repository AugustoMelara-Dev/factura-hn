---
"@factura-hn/cliente": patch
---

API REST: el contrato de la especificación OpenAPI.

- Cada operación tiene un `operationId` estable en español (`emitirDocumento`, `listarDocumentos`,
  `anularDocumento`…). Los clientes generados en otros lenguajes toman de ahí sus nombres. Los tipos de
  `@factura-hn/cliente` se regeneraron; el cliente se comporta igual.
- Cada operación declara solo los estados que puede devolver: el 422 ya no aparece en los `GET` (salvo
  `libro-ventas` y `exportacion`), y se documentan el 413 (cuerpo de más de 512 KB) y el 500.
- Todas las respuestas traen `Solicitud-Id` (el del cliente si manda uno válido; si no, uno generado) y
  `FacturaHN-Version`. Los errores traen el mismo id en `error.solicitud`, y el log de un 500 también.
- Las respuestas autenticadas traen `RateLimit-Policy` y `RateLimit` (borrador IETF). El 429 `LIMITE_MENSUAL`
  trae `Retry-After` hasta el primer día del mes siguiente (00:00 en Honduras).
- Un cuerpo que no es JSON es 400 `JSON_INVALIDO` con la forma de error de la API (antes, texto plano).
- La especificación pasa el linter de Redocly en la CI (`pnpm lint:openapi`).
