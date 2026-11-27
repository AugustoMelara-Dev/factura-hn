---
"factura-hn": patch
---

`npx factura-hn`: `init --help`, `demo --help` y `ayuda <comando>` muestran la ayuda. `init --forzar` revisa que
puede escribir cada archivo antes de reemplazar alguno. El `emitir.mjs` que crea `init` dice en español qué falta
si `emisor.json` no existe o está incompleto, sin traza.
