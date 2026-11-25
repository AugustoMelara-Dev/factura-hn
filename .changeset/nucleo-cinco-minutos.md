---
"factura-hn": minor
"@factura-hn/pdf": minor
---

La primera factura en un minuto, sin CAI real:

- `npx factura-hn demo` emite una factura de prueba e imprime su ticket; `npx factura-hn init` crea `emitir.mjs` y
  `emisor.json` para emitir con `node emitir.mjs`.
- Submódulo `factura-hn/demo`: `crearFacturadorDemo()`, `autorizacionDemo()`, `EMISOR_DEMO`, `LEYENDA_PRUEBA` y
  `esCAIDemo(cai)` (también en el índice), que reconoce un CAI ficticio (prefijo `DEMO00-NO-VALIDO-`).
- Modo de prueba: una autorización con CAI ficticio es de prueba, con `prueba: true` o sin él. Cada documento
  lleva `modo: 'prueba'`, y el HTML, el texto y el PDF imprimen «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».
  `prueba: true` con un CAI real se rechaza (`AUTORIZACION_PRUEBA_CAI_REAL`). Un punto de emisión pasa de prueba a real,
  nunca al revés (`AUTORIZACION_MODO_MEZCLADO`), y una nota no cruza de modo (`REFERENCIA_MODO_MEZCLADO`).
- `exportarTexto` deja fuera los documentos de prueba. Nuevas: `libroVentas(docs)` (filas, resumen y cuántos
  quedaron fuera) y `separarDocumentosDePrueba(docs)`.
- `crearFacturador({ almacen, emisor, establecimiento, puntoEmision })`: la configuración del negocio una vez, con
  `emitir`, `notaCredito`, `notaDebito`, `anular`, `documento`, `documentos`, `cotizar` y `registrarAutorizacion`.
  Por dentro usa `emitir` y `anular`.
- Errores que dicen qué hacer: cada problema del SDK trae `solucion` y `documentacion` (enlace al nuevo catálogo
  `docs/errores.md`), y el `message` los incluye. Sin almacén, el error es `ALMACEN_REQUERIDO` en lugar de un
  `TypeError`. Nuevas: `validarEmisor` y `esErrorValidacion`.
- Documentos en USD: al emitir se guarda `equivalenteLempiras` (ISV y total en lempiras con el tipo de cambio) y
  el impreso lo muestra. Un documento guardado antes, sin ese campo, se reimprime igual que se emitió.
- `crearFacturadorDemo` sobre un almacén con la demo vencida registra otra demo. `autorizacionDemo` con una fecha
  inválida da `FECHA_DEMO`.
- `npx factura-hn`: no sobrescribe los HTML que ya existen y rechaza opciones desconocidas.
- En CJS, `factura-hn/demo` y `factura-hn/pruebas` comparten las clases con el índice (`instanceof ErrorValidacion`
  funciona entre ellos).
