# Next.js 16 + API de factura-hn

- `app/acciones.ts`: **server action** que emite la factura con el cliente tipado. La llave de API se queda
  en el servidor (`lib/fhn.ts`).
- `app/formulario-venta.tsx`: formulario con `useActionState`. Cada venta lleva una clave de idempotencia:
  doble clic o reintento = la misma factura; tras un error fiscal se corrige y se reenvía con la misma clave;
  tras emitir, la siguiente venta recibe una nueva.
- `app/facturas/[numero]/route.ts`: el PDF (Art. 38) servido desde tu dominio, solo con un enlace firmado
  (`lib/enlaces.ts`): los números son consecutivos y sin firma cualquiera podría recorrerlos.
- `app/api/webhooks/factura-hn/route.ts`: receptor de webhooks con la firma verificada sobre el texto crudo
  (Web Crypto: sirve también en el runtime edge).

```bash
docker compose up -d --build                      # API; la llave de caja demo está en `docker compose logs api`
pnpm --filter @factura-hn/cliente build
FHN_LLAVE=fhn_… FHN_SECRETO_ENLACES=$(node -e "console.log(crypto.randomUUID()+crypto.randomUUID())") \
  pnpm --filter @factura-hn/ejemplo-nextjs dev     # http://localhost:3002
```

Variables: `FHN_API_URL` (por defecto `http://127.0.0.1:8787`), `FHN_LLAVE` (llave de **caja**, atada a su
punto de emisión), `FHN_SECRETO_ENLACES` (32+ caracteres aleatorios, firma los enlaces al PDF) y
`FHN_SECRETO_WEBHOOK`. Este ejemplo no tiene inicio de sesión: en tu aplicación, protege la página y la acción.
