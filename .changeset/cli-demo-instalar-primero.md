---
"factura-hn": patch
---

`npx factura-hn demo` empieza sus «Siguientes pasos» con `npm install factura-hn`: el `emitir.mjs` que crea
`npx factura-hn init` importa el SDK, y sin instalarlo Node no lo encuentra. El ejemplo «El SDK paso a paso» del
README registra un CAI ficticio de prueba (`prueba: true`), así que lo que emite lleva la leyenda «DOCUMENTO DE
PRUEBA — SIN VALOR FISCAL», como los demás caminos de inicio.
