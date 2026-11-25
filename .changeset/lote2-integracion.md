---
'factura-hn': minor
'@factura-hn/cliente': minor
'@factura-hn/mcp': minor
---

Un solo modo de prueba en todos los caminos, y los documentos de prueba fuera de los reportes fiscales.

- La API, el MCP y los ejemplos usan `factura-hn/demo`: el mismo emisor ficticio, el mismo CAI ficticio
  (`DEMO00-NO-VALIDO-…`, compatible con los ya emitidos) y la misma leyenda. Las autorizaciones demo que registran
  la API y el MCP llevan `prueba: true`.
- API: la exportación (`/v1/exportacion`, CSV, TXT y JSONL) y el libro de ventas (`/v1/libro-ventas`, JSON y CSV)
  dejan fuera los documentos de prueba. El tope de documentos, el total del encabezado TXT y la bitácora cuentan
  solo los reales. La cabecera `Documentos-Prueba-Excluidos` dice cuántos quedaron fuera; el libro JSON trae
  además `excluidos` y, si hay, un `aviso`. En el tenant `demo`, todo de prueba, los archivos salen vacíos.
- API: `POST /v1/autorizaciones` acepta `prueba`. Un CAI ficticio necesita `prueba: true` explícito
  (`AUTORIZACION_DEMO_SIN_PRUEBA`) y el tenant `demo` solo acepta CAI ficticios (`AUTORIZACION_REAL_EN_DEMO`).
  `GET /v1/series/{id}/no-utilizados` no lista las autorizaciones de prueba y lo dice en `aviso`.
- API: límite de intentos más estricto con la memoria y más justo con las cajas que comparten dirección: cola de
  validación acotada (256, 5 s), 429 por dirección solo con la cola en uso, memoria de 15 s para prefijos sin llave
  activa. El servidor no arranca si la base tiene un esquema de la API anterior al del código, y avisa en modo
  alojado sin `FHN_PROXIES_DE_CONFIANZA`.
- MCP: `libro_ventas` deja fuera los documentos de prueba y dice cuántos. Emitir y consultar reconocen un
  documento de prueba también por `modo: 'prueba'`, no solo por el CAI.
- OpenAPI: el esquema `Problema` declara `solucion` y `documentacion`; `DocumentoFiscal` declara `modo` y
  `equivalenteLempiras`; `Autorizacion` declara `prueba`. En `@factura-hn/cliente`, `Problema` trae esos campos,
  `ProblemaConGuia` queda como alias y `libroVentas` devuelve `excluidos` y `aviso`.
- `crearFacturadorDemo` da `DEMO_SIN_NUMEROS` si una renovación pasaría del correlativo 99 999 999.
- `registrarAutorizacion` bloquea todas las series del punto de emisión, en orden fijo: dos registros
  simultáneos de tipos distintos en el mismo punto ya no pueden mezclar prueba y real.
- README: la primera factura en 3 pasos por el SDK (`npx factura-hn init` y `node emitir.mjs`), la API y el MCP;
  Next.js, cómo pasar a producción con el CAI real y enlaces absolutos al repositorio.

## Cambios incompatibles

- `exportarTexto` (CSV, TXT y JSONL) y `libroVentas` dejan fuera los documentos de prueba (`modo: 'prueba'` o CAI
  `DEMO00-NO-VALIDO-…`). El encabezado TXT cuenta solo los reales. `libroVentas` devuelve además `excluidos`.
  Quien sumaba esos reportes con documentos de prueba verá totales menores.
- Reglas del modo de prueba: una autorización con CAI ficticio es de prueba, con `prueba: true` o sin él, y un
  punto de emisión pasa de prueba a real, nunca al revés: una autorización de prueba no entra en un punto que
  tiene o tuvo una real (`AUTORIZACION_MODO_MEZCLADO`). Al registrar el CAI real, la demo de ese punto queda
  retirada en todos los tipos, y un rango real no puede repetir números ya usados por documentos de prueba
  (`RANGO_USADO_EN_PRUEBA`). `prueba: true` con un CAI
  real da `AUTORIZACION_PRUEBA_CAI_REAL`; un `prueba` que no es booleano, `AUTORIZACION_PRUEBA_FORMATO`.
- Los documentos con CAI `DEMO00-…` ya emitidos (por ejemplo, con la demo de la API o del MCP de la 0.2.0) se
  reconocen como de prueba: al reimprimirse llevan la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y salen
  del libro de ventas y de la exportación. No se modifica ningún documento guardado.
- `ErrorValidacion.message` cambia de formato: cada problema va como `[CODIGO] mensaje.`, seguido de
  `Solución: …` y `Más información: <enlace a docs/errores.md>` cuando el código los tiene. Quien comparaba el
  texto debe usar `errores[].codigo`.
- API: un CAI ficticio sin `prueba: true` en `POST /v1/autorizaciones` responde 422 fuera del tenant `demo`.

### Nota de migración desde la 0.2.0

Una base de la 0.2.0 puede tener, en el mismo punto de emisión, CAI de demostración `DEMO00-…` (sin
`prueba: true`, que entonces no existía) y CAI reales. Registrar CAI reales en ese punto sigue funcionando,
venza o no la demostración. Desde que el punto tiene una autorización real, sus autorizaciones de demostración
quedan retiradas: no se vuelven a usar para emitir, en ningún tipo. Los documentos ya emitidos con ellas quedan
como de prueba (ver arriba). Un CAI real nuevo cuyo rango empiece en un número ya usado por documentos de prueba
de su serie da `RANGO_USADO_EN_PRUEBA`: regístralo en una base nueva.
