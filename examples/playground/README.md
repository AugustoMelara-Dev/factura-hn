# Playground del SDK (navegador, sin backend)

```bash
pnpm --filter @factura-hn/ejemplo-playground build
# abre examples/playground/public/index.html con doble clic (no necesita servidor)
```

El núcleo (`factura-hn`) y `src/playground.ts` se empaquetan en un solo archivo (`public/playground.global.js`,
unos 47 KB). Escribe un `DocumentoEntrada` en JSON, emite y mira la representación impresa (HTML en un iframe
sin permisos), el ticket térmico, los errores fiscales tal como los devuelve el SDK, el estado de las series y
la anulación. Trae ejemplos: consumidor final, cliente con RTN y tasas mezcladas, descuento, una entrada
inválida y una nota de crédito.

Los CAI son **ficticios** (`DEMO00-NO-VALIDO-…`) y todo vive en memoria: se borra al recargar.

Documentación: [guía del SDK](https://augustomelara-dev.github.io/factura-hn/guias/sdk/).
