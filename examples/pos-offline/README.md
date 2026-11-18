# Mini POS fuera de línea (SDK + SQLite)

La caja emite facturas sin internet: el SDK y la base (`node:sqlite`) viven en el mismo equipo. Requiere
Node 22.13 o más nuevo.

```bash
pnpm install
POS_DEMO=1 pnpm --filter @factura-hn/ejemplo-pos-offline start   # http://127.0.0.1:3000
```

`POS_DEMO=1` registra un **CAI ficticio** (sin validez fiscal). Con tus datos reales: `POS_EMISOR=emisor.json`,
`POS_PUNTO=001` y registra el CAI de tu resolución con `registrarAutorizacion(pos.almacen, …)`.

Qué muestra (`src/pos.ts`):

- **Sin duplicados.** El navegador genera una clave por venta y la conserva hasta tener respuesta. La clave se
  guarda con `alEmitir`, en la misma transacción que el documento: un reintento devuelve la misma factura y una
  venta rechazada no consume número.
- **Cola de salida.** Lo emitido y lo anulado (`alAnular`) entra a `pos_salida` en la misma transacción.
  `sincronizar(enviar)` lo manda en orden cuando vuelve la conexión (`POS_SINCRONIZAR_URL`) y para en el
  primer fallo.
- **Estado del CAI** con las alertas de vencimiento y de fin de rango (Arts. 59 y 62).
- **Anulación** (Art. 41): `POST /api/documentos/{numero}/anular`.

El servidor escucha solo en 127.0.0.1 y no tiene usuarios: es la caja de un solo equipo. Para que otra
página abierta en el navegador no pueda emitir ni anular, acepta solo `Host` 127.0.0.1/localhost con su
puerto, `Origin` propio y POST con `application/json`. Una clave reutilizada con otra venta da
`CLAVE_VENTA_USADA` (no devuelve el ticket anterior). Para varias cajas
en red usa la API (`docs/api.md`).
