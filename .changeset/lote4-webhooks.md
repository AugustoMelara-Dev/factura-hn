---
"@factura-hn/cliente": minor
---

Webhooks robustos en la API REST y el cliente.

- `verificarFirmaWebhook` acepta varias firmas `v1` en `X-FacturaHN-Firma`: la entrega es válida si alguna
  verifica con tu secreto, y las entradas desconocidas (`v0=`, `v2=`…) se ignoran. Actualiza el receptor antes de
  rotar el secreto.
- Reintentos durante unos 3 días (antes, unas 14 h y media): hasta 22 intentos, con espera creciente hasta 6 h y
  una fluctuación de ±20 %. Al agotarse, la entrega queda `FALLIDA` y se puede reenviar.
- Rutas nuevas, solo con llave admin: `GET /v1/webhooks/{id}/entregas` (paginada), `POST
  /v1/webhooks/{id}/entregas/{entrega}/reenviar`, `POST /v1/webhooks/{id}/probar` (evento `webhook.prueba`) y
  `POST /v1/webhooks/{id}/rotar-secreto` (secreto nuevo con gracia de 24 h por defecto: durante la gracia, cada
  entrega lleva dos `v1`). Los webhooks traen `graciaHasta`. Errores nuevos: 409 `WEBHOOK_INACTIVO` y 409
  `ENTREGA_VENCIDA`.
- `AvisoWebhook.evento` incluye `webhook.prueba`.
- Esquema de la API v8: migra antes de arrancar esta versión.
