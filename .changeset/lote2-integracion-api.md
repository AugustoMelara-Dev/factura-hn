---
'@factura-hn/cliente': minor
---

API REST: el mismo modo de prueba que el SDK, y los documentos de prueba fuera de los reportes fiscales.

- La API usa `factura-hn/demo`: el mismo emisor ficticio, el mismo CAI ficticio (`DEMO00-NO-VALIDO-…`,
  compatible con los ya emitidos) y la misma leyenda. Las autorizaciones demo que registra llevan `prueba: true`.
- La exportación (`/v1/exportacion`, CSV, TXT y JSONL) y el libro de ventas (`/v1/libro-ventas`, JSON y CSV)
  dejan fuera los documentos de prueba. El tope de documentos, el total del encabezado TXT y la bitácora cuentan
  solo los reales. La cabecera `Documentos-Prueba-Excluidos` dice cuántos quedaron fuera; el libro JSON trae
  además `excluidos` y, si hay, un `aviso`. En un tenant de prueba, todo de prueba, los archivos salen vacíos.
- `POST /v1/autorizaciones` acepta `prueba`. Qué CAI acepta cada tenant lo dice el cambio de los tenants de
  prueba y de producción (`AUTORIZACION_REAL_EN_DEMO` y `CAI_DE_PRUEBA`).
  `GET /v1/series/{id}/no-utilizados` no lista las autorizaciones de prueba y lo dice en `aviso`.
- Límite de intentos más estricto con la memoria y más justo con las cajas que comparten dirección: cola de
  validación acotada (256, 5 s), 429 por dirección solo con la cola en uso, memoria de 15 s para prefijos sin llave
  activa. El servidor no arranca si la base tiene un esquema de la API anterior al del código, y avisa en modo
  alojado sin `FHN_PROXIES_DE_CONFIANZA`.
- OpenAPI: el esquema `Problema` declara `solucion` y `documentacion`; `DocumentoFiscal` declara `modo` y
  `equivalenteLempiras`; `Autorizacion` declara `prueba`. En `@factura-hn/cliente`, `Problema` trae esos campos,
  `ProblemaConGuia` queda como alias y `libroVentas` devuelve `excluidos` y `aviso`.

**Cambios incompatibles:**

- `EstadoAutorizacion` (respuesta de `GET /v1/autorizaciones`) trae el campo obligatorio `retirada`: `true` en una
  autorización de prueba de un punto que ya tiene una real. Un objeto `EstadoAutorizacion` armado a mano (por
  ejemplo, en un doble de pruebas) debe incluirlo.
- La exportación y el libro de ventas dejan fuera los documentos de prueba (ver arriba): quien los sumaba verá
  totales menores.
