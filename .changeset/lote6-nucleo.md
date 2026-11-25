---
"factura-hn": minor
---

Notas, anulación y exportación coherentes con el original:

- `anular` rechaza con `DOCUMENTO_CON_NOTAS` (sin anular nada) un documento que tiene notas de crédito o débito
  vigentes: hay que anular primero las notas. Antes se anulaba y el libro de ventas quedaba en negativo.
- Nota de crédito: además del total, la suma de las notas vigentes no puede superar, a cada tasa (15 % y 18 %), el
  importe gravado ni el ISV del original (`NOTA_SUPERA_ORIGINAL`, con el saldo de esa tasa en el mensaje).
- Nota de crédito sobre un original en dólares: el saldo se calcula pasando las líneas del original por la misma
  conversión que la nota, así la devolución total de un documento en USD ya no da `NOTA_SUPERA_ORIGINAL` por
  redondeo.
- Nuevo aviso `AVISO_NOTA_EXONERACION_DISTINTA` (con `solucion`) cuando el original es exonerado y la nota no, o al
  revés.
- `emitir` bloquea la serie del original antes de leerlo al emitir una nota 06/07: una anulación y una nota
  simultáneas no dejan una nota vigente sobre un original anulado.
- **Exportación versión 2** (`VERSION_EXPORTACION = 2`): el CSV y el TXT agregan al final las columnas
  `tipoCambio` y `fechaAnulacion`; el encabezado TXT pasa a `#factura-hn|v2|N`. Las 21 columnas de la versión 1 no
  cambian de nombre ni de orden. El JSONL no cambia.
- El HTML explica «G0 = gravado 0%» cuando hay líneas `GRAVADO0`, como el ticket.
- `estadoAutorizacion` con el último correlativo antes del rango (serie que viene de un CAI anterior) ya no da
  números restantes de más ni un porcentaje usado negativo.
- `crearFacturadorDemo({ caiEstricto: true })` funciona: `caiEstricto` no exige la forma hexadecimal al CAI
  ficticio `DEMO00-NO-VALIDO-…`.
- `npx factura-hn init`: `emitir.mjs` avisa que cada corrida empieza en 00000001 (almacén en memoria) y, si
  `emisor.json` no es JSON válido, lo dice en español y cómo arreglarlo, en lugar de un `SyntaxError`.
- La batería `ejecutarContratoAlmacen` agrega una prueba de anulación con notas vigentes, también con anulación y
  nota a la vez.
