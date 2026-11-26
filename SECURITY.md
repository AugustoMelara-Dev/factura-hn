# Seguridad

Gracias por cuidar a quienes facturan con factura-hn.

## Versiones con soporte

| Versión | Soporte |
|---|---|
| 0.4.x (la más reciente) | ✅ |
| Anteriores | ❌ |

## Reportar una vulnerabilidad

**No abras un issue público.** Repórtala en privado: pestaña **Security** del repositorio →
[**Report a vulnerability**](https://github.com/AugustoMelara-Dev/factura-hn/security/advisories/new). Solo la ven
quienes mantienen el proyecto.

Cuéntanos qué parte afecta (SDK, CLI, adaptadores, API, cliente, MCP, ejemplos), cómo reproducirla y qué
permite hacer. Usa datos ficticios, nunca los de un contribuyente real.

- Confirmamos que lo recibimos en 3 días hábiles.
- En 10 días hábiles te decimos si lo aceptamos y cómo lo vamos a corregir.
- Publicamos la corrección con un aviso (GHSA) y te damos crédito, si quieres.

## Lo que más nos interesa

- Fugas entre tenants en la API (RLS), autenticación y llaves, idempotencia.
- Cualquier forma de consumir, saltar o repetir un correlativo, o de modificar un documento emitido.
- Firma de webhooks y SSRF en sus destinos.
- Inyección (SQL, HTML del documento impreso, fórmulas en CSV) e instrucciones inyectadas a un asistente de IA
  a través del MCP.

## Fuera de alcance

- La configuración de tu propio servidor (TLS, contraseñas de la base, respaldos): ver
  `docs/autoalojamiento.md`.
- Una regla fiscal que no cuadra: abre un issue con la plantilla «Una regla fiscal que no cuadra».
