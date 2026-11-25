---
"@factura-hn/mcp": minor
"@factura-hn/cliente": patch
---

Revisión final de la API y del servidor MCP.

- **MCP:** `anular_documento` y `registrar_cai` piden la confirmación del usuario por elicitación MCP, con el número y
  el motivo, o los datos del CAI, exactos. Si el usuario no confirma, responden `CONFIRMACION_RECHAZADA` y no hacen
  nada. Con un cliente que no ofrece elicitación se niegan (`CONFIRMACION_NO_DISPONIBLE`), salvo con
  `FHN_MCP_PERMITIR_DESTRUCTIVAS=1` o sobre datos de prueba (documento de prueba, CAI ficticio).
- **MCP:** un argumento con forma inválida (p. ej. sin `idempotencyKey`) responde `SOLICITUD_INVALIDA` en español,
  con el campo, qué hacer y la guía, en vez del texto de Zod en inglés.
- **MCP:** con Node anterior a 22.13, `init`, `registrar-cai` y el modo SQLite se niegan con «Necesitas Node 22.13 o
  más reciente (tienes …)». Los avisos de `consultar_documento` (formato resumen) van dentro de `<datos_documento>`.
- **Cliente:** los tipos declaran el 403 en todas las operaciones de `/v1` (`TENANT_FUERA_DEL_MODO_LOCAL`: el servidor
  en modo local no atiende llaves de otro tenant).
- **API:** toda respuesta JSON lleva `charset=utf-8` (Windows PowerShell 5.1 lee bien los acentos); sin
  `Idempotency-Key`, el error es `IDEMPOTENCY_KEY` con su solución; cupo de reportes por llave; un secreto de webhook
  que no se descifra falla solo su entrega; los webhooks de un tenant inactivo esperan (esquema v9); `tenant crear`
  se niega en modo local.
