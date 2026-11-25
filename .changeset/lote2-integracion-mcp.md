---
'@factura-hn/mcp': minor
---

El MCP usa el mismo modo de prueba que el SDK y deja los documentos de prueba fuera del libro de ventas.

- El MCP usa `factura-hn/demo`: el mismo emisor ficticio, el mismo CAI ficticio (`DEMO00-NO-VALIDO-…`, compatible
  con los ya emitidos) y la misma leyenda. Las autorizaciones demo que registra llevan `prueba: true`.
- `libro_ventas` deja fuera los documentos de prueba y dice cuántos. Emitir y consultar reconocen un documento de
  prueba también por `modo: 'prueba'`, no solo por el CAI.
