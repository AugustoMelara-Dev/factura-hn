---
"factura-hn": minor
"@factura-hn/pdf": minor
---

La primera factura en un minuto, sin CAI real:

- `npx factura-hn demo` emite una factura de prueba e imprime su ticket; `npx factura-hn init` crea `emitir.mjs` y
  `emisor.json` para emitir con `node emitir.mjs`.
- Submódulo `factura-hn/demo`: `crearFacturadorDemo()`, `autorizacionDemo()`, `EMISOR_DEMO`, `LEYENDA_PRUEBA` y
  `esCAIDemo(cai)`, que reconoce el CAI ficticio (prefijo `DEMO00-NO-VALIDO-`) de documentos ya emitidos.
- Modo de prueba: una autorización con `prueba: true` marca cada documento con `modo: 'prueba'`, y el HTML, el
  texto y el PDF imprimen «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Un documento real se imprime igual que antes.
  Una serie no mezcla CAI de prueba y reales (`AUTORIZACION_MODO_MEZCLADO`).
- `crearFacturador({ almacen, emisor, establecimiento, puntoEmision })`: la configuración del negocio una vez, con
  `emitir`, `notaCredito`, `notaDebito`, `anular`, `documento`, `documentos`, `cotizar` y `registrarAutorizacion`.
  Por dentro usa `emitir` y `anular`.
- Errores que dicen qué hacer: cada problema del SDK trae `solucion` y `documentacion` (enlace al nuevo catálogo
  `docs/errores.md`), y el `message` los incluye. Sin almacén, el error es `ALMACEN_REQUERIDO` en lugar de un
  `TypeError`. Nuevas: `validarEmisor` y `esErrorValidacion`.
- Documentos en USD: el impreso muestra el equivalente en lempiras del ISV y del total con el tipo de cambio.
- En CJS, `factura-hn/demo` y `factura-hn/pruebas` comparten las clases con el índice (`instanceof ErrorValidacion`
  funciona entre ellos).
