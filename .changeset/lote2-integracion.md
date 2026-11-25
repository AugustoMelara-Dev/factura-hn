---
'factura-hn': patch
'@factura-hn/cliente': patch
'@factura-hn/mcp': patch
---

Un solo modo de prueba en todos los caminos, y los documentos de prueba fuera de los reportes fiscales.

- La API, el MCP y los ejemplos usan `factura-hn/demo`: el mismo emisor ficticio, el mismo CAI ficticio
  (`DEMO00-NO-VALIDO-…`, compatible con los ya emitidos) y la misma leyenda. Las autorizaciones demo que registran
  la API y el MCP llevan `prueba: true`.
- API: la exportación (`/v1/exportacion`, CSV, TXT y JSONL) y el libro de ventas (`/v1/libro-ventas`, JSON y CSV)
  dejan fuera los documentos de prueba. El tope de documentos, el total del encabezado TXT y la bitácora cuentan
  solo los reales. La cabecera `Documentos-Prueba-Excluidos` dice cuántos quedaron fuera; el libro JSON trae
  además `excluidos` y, si hay, un `aviso`. En el tenant `demo`, todo de prueba, los archivos salen vacíos.
- MCP: `libro_ventas` deja fuera los documentos de prueba y dice cuántos. Emitir y consultar reconocen un
  documento de prueba también por `modo: 'prueba'`, no solo por el CAI.
- OpenAPI: el esquema `Problema` declara `solucion` y `documentacion`. En `@factura-hn/cliente`, `Problema` trae
  esos campos, `ProblemaConGuia` queda como alias y `libroVentas` devuelve `excluidos` y `aviso`.
- README: la primera factura en 3 pasos por el SDK (`npx factura-hn init` y `node emitir.mjs`), la API y el MCP;
  Next.js, cómo pasar a producción con el CAI real y enlaces absolutos al repositorio.
