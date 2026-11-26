---
"factura-hn": minor
"@factura-hn/sqlite": patch
"@factura-hn/pdf": patch
---

Entradas validadas con errores que dicen qué hacer, y una sola conversión a lempiras para los documentos en dólares.

- Una entrada con un tipo equivocado da un `ErrorValidacion` con código, sin consumir número, en lugar de un
  `TypeError` o de un documento deformado. Códigos nuevos: `PRECIOS_INCLUYEN_ISV_FORMATO`, `MONEDA`, `ENTRADA`,
  `CLIENTE`, `LINEA`, `HORA_EMISION` e `IDENTIFICADOR`. `emitir` y `crearFacturador` validan el establecimiento y el
  punto de emisión (`PUNTO_EMISION` con un `'0001'`).
- `horaEmision`: si falta, la pone el reloj (hora de Honduras), como la fecha.
- `registrarAutorizacionConAvisos` avisa con `AVISO_AUTORIZACION_VENCIDA` si el CAI ya venció.
- `renderizarTexto` acepta un `ancho` entero de 32 a 120 columnas y si no lanza un `RangeError` claro;
  `renderizarPDF` con un formato desconocido dice cuáles hay.
- `@factura-hn/sqlite`: abrir el almacén espera (hasta `esperaMaxima`) si otra caja tiene la base ocupada.

**Cambios incompatibles:**

- `preciosIncluyenISV` solo acepta `true` o `false`: un texto como `'false'` ya no se toma como verdadero.
- Un `cliente.identificacion` con un `tipo` desconocido es error (`CLIENTE_IDENTIFICACION`) y ya no cuenta como
  identificado sobre el umbral de consumidor final.
- `noUtilizadosDelAlmacen` con un identificador que no es `NNN-NNN-TT` da `IDENTIFICADOR` en lugar de `[]`.
- Una nota de crédito no puede llevar importe exento o gravado al 0 % que el original no tenía
  (`NOTA_TASA_DISTINTA`), ni más que el original en esos grupos (`NOTA_SUPERA_ORIGINAL`).
- Documentos en dólares: el libro de ventas, el equivalente en lempiras impreso, el tope de las notas de crédito y
  los importes de una nota sobre un original en dólares usan la misma conversión (cada columna al tipo de cambio;
  el total es la suma de las columnas). Cada fila del libro cuadra al centavo y una nota por el total deja el neto
  en 0. El total en lempiras de una fila puede diferir en un centavo del de la versión anterior.
