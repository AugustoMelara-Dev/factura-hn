# Seguridad

## Versiones con soporte

| Versión | Soporte |
|---|---|
| 0.2.x (la más reciente) | ✅ |
| Anteriores | ❌ |

## Reportar una vulnerabilidad

**No abras un issue público.** Usa el aviso privado de GitHub: pestaña **Security** del repositorio →
**Report a vulnerability**. Solo los mantenedores lo ven.

Incluye qué componente afecta (SDK, adaptadores, API, cliente, MCP, ejemplos), cómo reproducirlo y su impacto.
No incluyas datos reales de contribuyentes.

- Confirmamos la recepción en 3 días hábiles.
- Te decimos si lo aceptamos y el plan en 10 días hábiles.
- Publicamos la corrección y un aviso (GHSA) y te damos crédito si lo deseas.

## Qué nos interesa especialmente

- Fugas entre tenants en la API (RLS), autenticación y llaves, idempotencia.
- Cualquier forma de consumir, saltar o repetir un correlativo, o de modificar un documento emitido.
- Firma de webhooks y SSRF en sus destinos.
- Inyección (SQL, HTML del documento impreso, fórmulas en CSV) e instrucciones inyectadas a agentes a través
  del MCP.

## Fuera de alcance

- La configuración de tu propio servidor (TLS, contraseñas de la base, respaldos): ver
  `docs/autoalojamiento.md`.
- Interpretaciones fiscales: abre un issue con la plantilla «Regla fiscal».
