---
"@factura-hn/cliente": minor
---

Tipos regenerados de la API: el 409 `EMISOR_EXISTE` trae `id` (esquema `ErrorEmisorExiste`) y el 422
`PERIODO_DEMASIADO_GRANDE` de los reportes trae `documentos` y `maximo` (esquema `ErrorPeriodo`).

**Cambios incompatibles:**

- Salen los tipos de `POST /v1/demo/entornos` y `RespuestaEntornoDemo`: esa ruta ya no está en la especificación.
