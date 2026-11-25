---
"@factura-hn/cliente": patch
---

API REST: el contrato OpenAPI se valida en cada respuesta de las pruebas, y el fuzzing de la API.

- Un cuerpo sin `Content-Type: application/json` es 415 `TIPO_DE_CONTENIDO` con la forma de error de la API (antes,
  texto plano y sin declarar). Cada operación con cuerpo declara el 415.
- `/openapi.json` declara lo que la API ya enviaba: `Idempotency-Replayed` en el 201 de `emitirDocumento`, los tres
  tipos de archivo de `exportarPeriodo` (`application/x-ndjson`, `text/csv`, `text/plain`), el 403 de
  `obtenerLibroVentas` y `FacturaHN-Modo` en los 429 de `/v1`. Los tipos de `@factura-hn/cliente` se regeneraron.
- Una fecha de período que no existe (`2026-02-30`) es 400 `SOLICITUD_INVALIDA` (antes, 500), y un CAI con un
  carácter NUL en la ruta es 404 (antes, 500).
- Un carácter de control (p. ej. U+0000) en el nombre de una llave o en la URL de un webhook es 400
  `SOLICITUD_INVALIDA` (antes, 500). `Solicitud-Id`, `FacturaHN-Version` y el `Retry-After` de los 429 se declaran
  obligatorias en `/openapi.json`.
- Un total por encima del tope técnico, también el total en lempiras de un documento en dólares, es 422 `MONTO_FUERA_DE_RANGO` y no consume número (antes, 500).
