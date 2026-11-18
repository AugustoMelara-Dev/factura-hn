# @factura-hn/cliente

Cliente tipado de la API REST de factura-hn (ver `docs/api.md`). Los tipos se generan desde
`packages/api/openapi.json`; una prueba falla si quedan desactualizados. Sin dependencias pesadas
(`openapi-fetch`): Node 18+, navegador, Deno y edge.

```ts
import { crearCliente, ErrorFacturaHN } from '@factura-hn/cliente';

const fhn = crearCliente({ url: 'http://127.0.0.1:8787', llave: process.env.FHN_LLAVE! });
try {
  const { documento, repetida } = await fhn.emitir(
    { documento: { preciosIncluyenISV: true, lineas: [{ descripcion: 'Café', cantidad: 2, precioUnitario: '57.50' }] } },
    { idempotencyKey: 'venta-0001' }, // estable por venta: reintenta con la misma clave
  );
  const pdf = await fhn.descargar(documento.numero, 'pdf', { papel: 'ticket' });
} catch (e) {
  if (e instanceof ErrorFacturaHN) console.error(e.codigo, e.errores); // 422: errores fiscales tal cual
}
```

**Quién opera (DEC-031).** Si varias personas usan la misma llave, crea el cliente con el cajero de la sesión:
`crearCliente({ url, llave, operador: 'María López' })`. Va en la cabecera `X-Operador` de cada solicitud y
queda en la bitácora junto a la llave. Para imprimirlo en la factura, emite con `imprimirOperador: true`. Al
anular: `fhn.anular(numero, motivo, { operador })`.

`fhn.api` es el cliente de `openapi-fetch` con todas las rutas tipadas (`fhn.api.POST('/v1/llaves', …)`).
La llave de API va solo en el servidor: nunca en código que llega al navegador.

Regenerar: `pnpm --filter @factura-hn/api openapi && pnpm --filter @factura-hn/cliente generar`.
