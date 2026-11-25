---
title: Playground
description: El SDK de factura-hn corriendo en el navegador, sin servidor y con CAI ficticios, para probar la emisión y los errores fiscales.
sidebar:
  order: 3
---

El SDK de factura-hn corriendo en tu navegador, sin servidor: escribe una entrada, emite y mira el documento
impreso, el ticket y los errores fiscales tal como los recibiría tu sistema. Las autorizaciones son
**ficticias** (`DEMO00-NO-VALIDO-…`) y todo se pierde al recargar: nada de lo que emitas aquí tiene validez
fiscal.

<iframe class="fhn-playground" src="/playground/index.html" title="Playground de factura-hn" loading="lazy"></iframe>

[Abrir el playground en pantalla completa](/playground/index.html)

Prueba a:

- emitir dos veces y ver cómo avanza el correlativo;
- poner un precio negativo o un RTN de 13 dígitos y leer el error;
- pasar de L 10,000 sin identificar al cliente (Art. 11, párrafo final);
- emitir una nota de crédito sobre la última factura.

El código del playground está en
[`examples/playground`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/playground).
