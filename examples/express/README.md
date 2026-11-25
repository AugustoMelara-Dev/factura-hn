# Express 5 + API de factura-hn

Una tienda que factura sus pedidos con el cliente tipado (`@factura-hn/cliente`) y recibe los webhooks
firmados. Ver `src/app.ts`.

Desde la raíz del repositorio, en tres comandos:

```bash
pnpm install
docker compose up -d --build                                   # API en 127.0.0.1:8787 (Docker Compose v2)
FHN_LLAVE=fhn_… pnpm --filter @factura-hn/ejemplo-express start  # compila el cliente y abre 127.0.0.1:3001
```

En PowerShell, el tercer comando es:

```powershell
$env:FHN_LLAVE = 'fhn_…'; pnpm --filter @factura-hn/ejemplo-express start
```

La llave de caja del demo (CAI ficticio) sale una sola vez en `docker compose logs api`. Si ya no la tienes,
crea otra: `docker compose exec api node cli.cjs llave crear demo --rol caja --nombre "Tienda" --caja 000-001`.

Pruébalo en otra terminal (en PowerShell, escribe `curl.exe` en lugar de `curl`):

```bash
curl -X POST -H 'content-type: application/json' http://127.0.0.1:3001/pedidos/1001/factura   # 201 la primera vez (200 si el pedido ya se facturó)
curl -X POST -H 'content-type: application/json' http://127.0.0.1:3001/pedidos/1001/factura   # 200: la misma factura
curl -o factura.pdf http://127.0.0.1:3001/pedidos/1001/factura.pdf
```

El número lo asigna la API y la tienda lo guarda con el pedido: el PDF se pide por pedido, no por número.
Puedes reiniciar la tienda y repetir todo: el pedido 1001 vuelve a dar su misma factura.

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
