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

Desde la raíz del repositorio, en tres comandos (bash: Linux, macOS o Git Bash en Windows):

```bash
pnpm install
docker compose up -d --build --wait               # API en 127.0.0.1:8787 (Docker Compose v2)
FHN_LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave) \
FHN_SECRETO_ENLACES=$(node -e "console.log(crypto.randomUUID()+crypto.randomUUID())") \
  pnpm --filter @factura-hn/ejemplo-nextjs dev     # compila el cliente y abre http://localhost:3002
```

En PowerShell, el tercer comando es:

```powershell
$env:FHN_LLAVE = docker compose exec -T api factura-hn-api demo llave --solo-llave; $env:FHN_SECRETO_ENLACES = node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"; pnpm --filter @factura-hn/ejemplo-nextjs dev
```

`demo llave --solo-llave` crea una llave de caja nueva del tenant de demostración (CAI ficticio, sin validez
fiscal) y la imprime sola en la salida estándar. El aviso «Se muestra solo esta vez» va a la salida de errores:
es normal. Cada vez que lo corres crea otra llave; las anteriores siguen sirviendo.

Cada carga del formulario trae una clave nueva y el número sale de la respuesta: puedes emitir, reiniciar y
volver a emitir sin chocar con lo anterior.

Variables: `FHN_API_URL` (por defecto `http://127.0.0.1:8787`), `FHN_LLAVE` (llave de **caja**, atada a su
punto de emisión), `FHN_SECRETO_ENLACES` (32+ caracteres aleatorios, firma los enlaces al PDF) y
`FHN_SECRETO_WEBHOOK`. Este ejemplo no tiene inicio de sesión: en tu aplicación, protege la página y la acción.
