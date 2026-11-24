# Express 5 + API de factura-hn

Una tienda que factura sus pedidos con el cliente tipado (`@factura-hn/cliente`) y recibe los webhooks
firmados. Ver `src/app.ts`.

```bash
docker compose up -d --build                       # API en 127.0.0.1:8787; la llave de caja demo está en el log
FHN_LLAVE=fhn_… pnpm --filter @factura-hn/ejemplo-express start
curl -X POST -H 'content-type: application/json' http://127.0.0.1:3001/pedidos/1001/factura   # dos veces: la misma factura (idempotencia)
curl -o factura.pdf http://127.0.0.1:3001/pedidos/1001/factura.pdf
```

**Las rutas `/pedidos` no tienen autenticación propia.** El ejemplo no tiene sesión de usuario: en tu tienda,
móntalas detrás del middleware de sesión, con la cookie de sesión en `SameSite=Lax` o `Strict` o con un token
CSRF, y haz que `buscarPedido` compruebe que el pedido es del usuario de la sesión (si no, que devuelva null).

- `POST /pedidos/:id/factura` exige `content-type: application/json` y responde 415 a cualquier otro tipo. Un
  formulario de otro sitio solo puede enviar `text/plain`, `application/x-www-form-urlencoded` o
  `multipart/form-data` sin preflight de CORS; con JSON el navegador pregunta antes, y la tienda no lo permite.
- La clave de idempotencia es el id del pedido: un reintento nunca emite otra factura.
- Los precios salen de tu base (`buscarPedido`), nunca del navegador.
- El PDF se sirve por pedido (`/pedidos/:id/factura.pdf`), no por número de factura: los números son
  consecutivos y cualquiera podría recorrerlos.
- Los 422 de la API traen la lista de errores fiscales: muéstralos tal cual.
- El receptor de webhooks verifica la firma sobre el cuerpo **crudo** (`express.raw`), descarta repetidos por
  `id` y responde 2xx; si tu proceso falla, responde 5xx y la API reintenta.

Para registrar el webhook (llave admin): `POST /v1/webhooks {"url": "https://tu-tienda.hn/webhooks/factura-hn",
"eventos": ["documento.emitido","documento.anulado","autorizacion.por_vencer","autorizacion.agotada"]}`. El
secreto viene en la respuesta, una sola vez: guárdalo en `FHN_SECRETO_WEBHOOK`.
