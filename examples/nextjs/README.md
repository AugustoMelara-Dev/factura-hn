# Next.js 16 + API de factura-hn

- `app/acciones.ts`: **server action** que emite la factura con el cliente tipado. La llave de API se queda
  en el servidor (`lib/fhn.ts`).
- `app/formulario-venta.tsx`: formulario con `useActionState`. Cada formulario lleva una clave de
  idempotencia generada al mostrarlo: doble clic o reintento = la misma factura.
- `app/facturas/[numero]/route.ts`: el PDF (Art. 38) servido desde tu dominio.
- `app/api/webhooks/factura-hn/route.ts`: receptor de webhooks con la firma verificada sobre el texto crudo
  (Web Crypto: sirve también en el runtime edge).

```bash
docker compose up -d --build                      # API; la llave de caja demo está en `docker compose logs api`
pnpm --filter @factura-hn/cliente build
FHN_LLAVE=fhn_… pnpm --filter @factura-hn/ejemplo-nextjs dev     # http://localhost:3002
```

Variables: `FHN_API_URL` (por defecto `http://127.0.0.1:8787`), `FHN_LLAVE` (llave de **caja**, atada a su
punto de emisión) y `FHN_SECRETO_WEBHOOK`.
