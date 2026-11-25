---
title: Tu primera factura en 5 minutos
description: Emite una factura de prueba con el SDK, la API REST, el servidor MCP o Next.js, en tres pasos y sin un CAI real.
sidebar:
  order: 1
---

Cuatro caminos, cada uno en unos pocos pasos. Todos empiezan en **modo de prueba**: un CAI ficticio
(`DEMO00-NO-VALIDO-…`) y un emisor ficticio con RTN `9999…`. Todo lo que se imprime lleva la leyenda
**«DOCUMENTO DE PRUEBA — SIN VALOR FISCAL»**.

:::caution[Sin valor fiscal]
Estas facturas no sirven ante la autoridad tributaria. Para facturar de verdad necesitas el CAI de tu propia
resolución: ver [Modo de prueba](/empezar/modo-de-prueba/#pasar-al-cai-real).
:::

¿No sabes cuál elegir? Ver [Elegir camino](/empezar/elegir-camino/). Para verlo sin instalar nada, abre el
[playground](/empezar/playground/).

## SDK (Node 20 o más reciente)

En la carpeta de tu proyecto, o en una nueva:

```bash
npm install factura-hn
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

**Qué verás:**

- el ticket en la consola, enmarcado entre dos líneas con la leyenda de prueba;
- una línea con el número, `000-001-01-00000001`, y el total;
- el archivo `factura.html` en la carpeta. Ábrelo en el navegador: lleva la leyenda en un recuadro al inicio y
  al final.

La venta de `emitir.mjs` es de 2 × L 115.00 con `preciosIncluyenISV: true`, es decir, con los precios que ya
traen el ISV. El subtotal es L 200.00, el ISV 15 % L 30.00 y el total L 230.00.

`init` genera un archivo `.mjs` para que Node lo trate como módulo ESM sin tocar tu `package.json`. En tus
propios archivos, usa `.mjs` o `.ts`, o pon `"type": "module"` en `package.json`.

¿`demo` o `init`? `npx factura-hn demo` solo muestra una factura de prueba (el ticket en la consola y
`factura-demo.html`), sin crear código. `npx factura-hn init` deja `emitir.mjs` y `emisor.json` para que los
cambies y sigas desde ahí.

### Provoca un error

Los errores dicen qué falló y qué hacer. Prueba con un RTN de 13 dígitos (le falta uno):

```js
// error.mjs
import { esErrorValidacion } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo();
try {
  await caja.emitir({
    cliente: { nombre: 'Ferretería Pérez', rtn: '9999000000000' }, // 13 dígitos
    lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
  });
} catch (e) {
  if (!esErrorValidacion(e)) throw e;
  for (const p of e.errores) console.log(p.codigo, '·', p.mensaje, '·', p.solucion);
}
```

`node error.mjs` imprime el código `CLIENTE_RTN`, el mensaje «RTN del cliente inválido (14 dígitos).» y la
solución. Cada problema trae también `campo` y `documentacion`, un enlace a su entrada en la
[referencia de errores](/referencia/errores/#cliente_rtn).

Un intento rechazado no consume número: la siguiente factura de esa caja sigue siendo la `00000001`.

## API REST (Docker)

Con Docker y Compose v2. Los comandos son de bash (Linux, macOS o Git Bash en Windows); los mismos pasos en
PowerShell están en la [referencia de la API](/referencia/api/).

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git && cd factura-hn
docker compose up -d --build --wait     # API en http://127.0.0.1:8787
```

Los pasos siguientes se corren desde la raíz del repositorio. Para otro puerto, arranca con
`FHN_PUERTO=8788 docker compose up -d --build --wait` y usa `API=http://127.0.0.1:8788` en el paso 1.

1. La dirección de la API y la llave de caja del tenant `demo`. La consola escribe además un aviso en la salida
   de errores («Llave caja del demo… Se muestra solo esta vez»): es normal.

   ```bash
   API=http://127.0.0.1:8787
   LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)
   ```

2. Emite, con una clave de idempotencia nueva para esta venta:

   ```bash
   VENTA="venta-$(date +%s)"
   RESPUESTA=$(curl -s -X POST "$API/v1/documentos" \
     -H "authorization: Bearer $LLAVE" -H "idempotency-key: $VENTA" -H "content-type: application/json" \
     --data-binary @packages/api/ejemplos/factura.json)
   PDF=$(printf '%s' "$RESPUESTA" | sed -n 's/.*"pdf":"\([^"]*\)".*/\1/p')
   if [ -n "$PDF" ]; then echo "Emitida: $(printf '%s' "$RESPUESTA" | sed -n 's/.*"numero":"\([^"]*\)".*/\1/p')"
   else echo "No se emitió: $RESPUESTA"; fi
   ```

3. Descarga el PDF:

   ```bash
   curl -f -H "authorization: Bearer $LLAVE" -o factura.pdf "$API${PDF:?el paso 2 no emitió: revisa su salida}"
   ```

**Qué verás:** el paso 2 escribe `Emitida:` y el número que asignó la API, con la forma
`000-001-01-0000000N`. El número sale de la respuesta; no lo escribas a mano. El `factura.pdf` lleva la leyenda
de prueba y una marca de agua «PRUEBA».

La venta de `packages/api/ejemplos/factura.json` es de 2 × L 57.50 con los precios con ISV: total L 115.00. No
es la misma venta del SDK ni de Next.js.

Si el paso 2 dice «No se emitió», la respuesta trae el error con su `solucion`. Lo más común: `LLAVE` vacía (el
paso 1 falló) o el comando no se corrió desde la raíz del repositorio. En ese caso el paso 3 se detiene con «el
paso 2 no emitió» y no deja un `factura.pdf` vacío.

## MCP (Claude Desktop, Claude Code, Cursor)

Con Node 22.13 o más reciente, en una carpeta vacía:

1. `npx -y @factura-hn/mcp init --demo`. Crea la base de prueba `factura-demo.db` y el emisor ficticio
   `emisor-demo.json`, e imprime el bloque `mcpServers`, con la variante de Windows (`cmd /c`) si lo corres en
   Windows. `npx` descarga el paquete la primera vez: hace falta conexión a internet.
2. Pega el bloque en la configuración de tu cliente MCP y reinícialo.
3. Pídele al asistente: «emite una factura de prueba».

**Qué verás:** la respuesta del asistente con el número (`000-001-01-00000001` en una base nueva) y la leyenda
«DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Para ver el impreso, pídele que la muestre impresa: la herramienta
`consultar_documento` con formato `texto` da el ticket en texto. El MCP no genera PDF ni HTML.

Dónde va el bloque en cada cliente: ver [Servidor MCP](/ia/mcp/).

## Next.js

En modo de prueba, sin base de datos, en un proyecto de `create-next-app` con el alias `@/`. Si tu proyecto usa
`src/`, crea los archivos en `src/lib` y `src/app`.

1. `npm install factura-hn`
2. Crea `lib/facturador.ts`:

   ```ts
   // lib/facturador.ts: solo en el servidor. Se crea una vez por proceso, no en cada solicitud.
   import { crearFacturadorDemo } from 'factura-hn/demo';

   // Ya trae el emisor ficticio y el CAI ficticio de la caja 000-001. Devuelve una promesa: úsala con `await`.
   export const facturador = crearFacturadorDemo();
   ```

3. Crea `app/factura/route.ts`:

   ```ts
   // app/factura/route.ts: cada visita emite la siguiente factura de prueba y la devuelve como HTML.
   import { renderizarHTML } from 'factura-hn';
   import { facturador } from '@/lib/facturador';

   export async function GET() {
     const caja = await facturador;
     // Sin `cliente`, el documento va a CONSUMIDOR FINAL.
     const factura = await caja.emitir({
       preciosIncluyenISV: true, // los precios ya traen el ISV
       lineas: [{ descripcion: 'Café molido 1 lb', cantidad: 2, precioUnitario: '115.00' }],
     });
     return new Response(renderizarHTML(factura), { headers: { 'content-type': 'text/html; charset=utf-8' } });
   }
   ```

4. `npm run dev` y abre `http://localhost:3000/factura`.

**Qué verás:** la factura `000-001-01-00000001` con la misma venta del SDK (subtotal L 200.00, ISV L 30.00,
total L 230.00) y la leyenda de prueba. Cada recarga emite el número siguiente. El almacén es de memoria: la
numeración vuelve a empezar al reiniciar el servidor.

## Siguientes pasos

- Entender qué acabas de emitir: [Cómo funciona](/conceptos/como-funciona/).
- Guardar los documentos de verdad: [Almacén fiscal](/conceptos/almacen/) (SQLite o Postgres).
- Pasar al CAI de tu resolución: [Modo de prueba](/empezar/modo-de-prueba/#pasar-al-cai-real) y la lista de
  [Ir a producción](/produccion/).
- Integrarlo con un agente: [Emitir con un asistente](/empezar/con-ia/).
