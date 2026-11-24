---
"factura-hn": minor
"@factura-hn/postgres": minor
---

Reportes de período acotados en memoria.

- `factura-hn`: `documentosPorPaginas`, `contarDocumentos` y `correlativosDe` leen un período por páginas
  usando métodos opcionales del almacén (`paginaDocumentos`, `contarDocumentos`, `correlativos`); un almacén
  que no los tenga sigue funcionando con `documentos`. `noUtilizadosDelAlmacen` lee solo los correlativos.
  `inicioExportacion` y `lineaExportacion` escriben el archivo de `exportarTexto` por partes, igual byte por
  byte. Nuevo tipo `ResumenDocumento` (un documento sin `lineas`); `filaLibroVentas` lo acepta.
- `@factura-hn/postgres`: implementa esos métodos con páginas por número (`LIMIT`) y conteo en SQL, y
  `transaccion(fn, { soloLectura: true })` abre una transacción de solo lectura con una sola instantánea.
