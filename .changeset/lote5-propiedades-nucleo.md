---
"factura-hn": minor
---

Lo que encontraron las pruebas de propiedades y el fuzzing del núcleo:

- `montoEnLetras` y `enteroALetras` escriben los billones (escala larga): 10^12 es «UN BILLÓN», no «UN MILLÓN
  MILLONES». Por debajo de 10^12 nada cambia.
- `validarLineas` (y con ella `validarEntrada` y `calcularDocumento`) devuelve el problema `MONTO_FUERA_DE_RANGO`
  cuando el total del documento, con el ISV de cada grupo de tasa, pasaría de L 9,999,999,999,999.99
  (`MONTO_MAXIMO_CENTAVOS`, nueva exportación); `validarEntrada` también, cuando lo pasaría el total en lempiras de un
  documento en moneda extranjera. Es un tope técnico (el límite en que el total en `number` sigue exacto al
  centavo), no una regla fiscal. Antes, un total así lanzaba un `RangeError` a mitad del cálculo.
- `leerExportacionJSONL` lanza `ErrorExportacion` (nueva exportación; sigue siendo `SyntaxError`) con el número de
  línea, también cuando una línea es JSON pero no un objeto (`5`, `null`, una lista). Antes, un `SyntaxError` sin línea o un
  documento que no lo era.
