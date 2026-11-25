---
'factura-hn': minor
---

Exportaciones nuevas del índice de `factura-hn` que no tenían entrada:

- `esDocumentoDePrueba(doc)`: `true` si el documento es de prueba (`modo: 'prueba'` o CAI ficticio, también los
  emitidos antes de que existiera `modo`). `esAutorizacionDePrueba(autorizacion)`: `true` con `prueba: true` o un
  CAI ficticio. Son las que usan `exportarTexto`, `libroVentas` y `separarDocumentosDePrueba`.
- El catálogo de soluciones de los errores: `SOLUCIONES` (código → qué hacer), `conSolucion(problema)` (completa
  `solucion` y `documentacion` si el código es del SDK, sin reemplazar las que ya trae), `enlaceError(codigo)`
  (enlace al código en `docs/errores.md`) y `URL_ERRORES` (la base de esos enlaces). Los usan la API y el MCP para
  dar la misma guía que el SDK.
- `autorizacionesActivas(deSerie, puntoConReal)`: las autorizaciones de una serie que todavía pueden emitir (sin las
  de prueba si el punto ya tiene una real). La usa la API para listar las autorizaciones; es de bajo nivel y puede
  cambiar sin aviso mientras la versión sea 0.x.
