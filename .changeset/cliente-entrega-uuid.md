---
"@factura-hn/cliente": patch
---

Tipos regenerados de la especificación de la API: `POST /v1/webhooks` puede responder 409 `LIMITE_WEBHOOKS` (20 webhooks activos por tenant). `AvisoWebhook.id` es el UUID de la entrega, el mismo de `X-FacturaHN-Entrega`.
