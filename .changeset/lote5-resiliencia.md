---
"@factura-hn/cliente": patch
"factura-hn": patch
---

Resiliencia de la API REST, medida con carga y con PostgreSQL reiniciándose en medio de la emisión.

- Con la base reiniciándose, caída o sin conexiones libres, la API responde 503 `BASE_NO_DISPONIBLE` con
  `Retry-After` (antes, 500 `ERROR_INTERNO`). Reintenta con la misma `Idempotency-Key`: si el documento alcanzó a
  emitirse recibes el mismo, y si no, se emite una sola vez. El cliente lo entrega como `ErrorFacturaHN` con
  `estado: 503`; los tipos generados incluyen el 503 en cada operación.
- Los avisos de webhook acumulados (por ejemplo, mientras el receptor estaba caído) salen en una sola pasada del
  despacho, al ritmo del receptor; antes salían de a 20 cada 5 s por negocio.
- `fechaHonduras` y `horaHonduras` reusan su formateador: la emisión gasta menos CPU.
