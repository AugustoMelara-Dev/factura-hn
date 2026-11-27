# @factura-hn/cliente

Cliente tipado de la API REST de factura-hn (referencia: `docs/api.md` en este paquete o
[en GitHub](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/api.md)). Los tipos se generan desde
[`openapi.json`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/api/openapi.json) de la API.
Sin dependencias pesadas (`openapi-fetch`): Node 20+, navegador, Deno y edge.

```ts
import { crearCliente, ErrorFacturaHN } from '@factura-hn/cliente';

const fhn = crearCliente({ url: 'http://127.0.0.1:8787', llave: process.env.FHN_LLAVE! });
// Una clave por venta: créala al abrir la venta y guárdala con ella. Un reintento de la misma venta usa la
// misma clave y recibe la misma factura (`repetida: true`); otra venta lleva otra clave.
const clave = crypto.randomUUID();
try {
  const { documento, repetida } = await fhn.emitir(
    { documento: { preciosIncluyenISV: true, lineas: [{ descripcion: 'Café', cantidad: 2, precioUnitario: '57.50' }] } },
    { idempotencyKey: clave },
  );
  // El número lo asigna la API: tómalo de la respuesta, no lo supongas.
  const pdf = await fhn.descargar(documento.numero, 'pdf', { papel: 'ticket' });
} catch (e) {
  // 422: errores fiscales tal cual. En los frecuentes, e.solucion dice qué hacer y e.documentacion enlaza la guía.
  if (e instanceof ErrorFacturaHN) console.error(e.codigo, e.solucion, e.errores);
}
```

**Quién opera.** Si varias personas usan la misma llave, crea el cliente con el cajero de la sesión:
`crearCliente({ url, llave, operador: 'María López' })`. Va en la cabecera `X-Operador` de cada solicitud y
queda en la bitácora junto a la llave. Para imprimirlo en la factura, emite con `imprimirOperador: true`. Al
anular: `fhn.anular(numero, motivo, { operador })`.

`emitir` devuelve también `enlaces` (`pdf`, `html`, `txt`): las rutas de la representación impresa. `fhn.sesion()`
dice con qué llave hablas y, si aún no puedes emitir, qué falta (`pendientes`, con su solución).

`fhn.documentos(desde, hasta)` recorre todas las páginas; `fhn.paginaDocumentos(desde, hasta, { limite, cursor })`
lee una por una (`hayMas`, `siguiente`).

`fhn.api` es el cliente de `openapi-fetch` con todas las rutas tipadas (`fhn.api.POST('/v1/llaves', …)`).
La llave de API va solo en el servidor: nunca en código que llega al navegador.

Documentación: [guía de la API](https://augustomelara-dev.github.io/factura-hn/guias/api/).
