---
title: Seguridad
description: Cómo reportar una vulnerabilidad de factura-hn en privado, qué versiones tienen soporte y qué está fuera de alcance.
sidebar:
  order: 4
---

La política completa está en
[SECURITY.md](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/SECURITY.md).

## Reportar una vulnerabilidad

**No abras un issue público.** Usa el aviso privado de GitHub: pestaña **Security** del repositorio, **Report a
vulnerability** ([enlace directo](https://github.com/AugustoMelara-Dev/factura-hn/security/advisories/new)).
Solo los mantenedores lo ven.

Incluye:

- qué componente afecta: SDK, adaptadores, API, cliente, MCP o ejemplos;
- cómo reproducirlo;
- su impacto.

No incluyas datos reales de contribuyentes. Usa los ficticios de [Contribuir](/ayuda/contribuir/#datos-de-ejemplo).

## Qué pasa después

- Confirmamos la recepción en 3 días hábiles.
- Te decimos si lo aceptamos y el plan en 10 días hábiles.
- Publicamos la corrección y un aviso (GHSA), y te damos crédito si lo deseas.

## Versiones con soporte

| Versión | Soporte |
|---|---|
| La más reciente (0.4.x) | Sí |
| Anteriores | No |

## Qué nos interesa especialmente

- Fugas entre tenants en la API (RLS), autenticación y llaves, idempotencia.
- Cualquier forma de consumir, saltar o repetir un correlativo, o de modificar un documento emitido.
- Firma de webhooks y SSRF en sus destinos.
- Inyección: SQL, HTML del documento impreso, fórmulas en CSV, e instrucciones inyectadas a agentes a través del
  MCP.

## Fuera de alcance

- La configuración de tu propio servidor (TLS, contraseñas de la base, respaldos). Ver
  [Autoalojamiento](/guias/autoalojar/).
- Las reglas fiscales: abre un issue con la plantilla «Regla fiscal». Ver [Contribuir](/ayuda/contribuir/).
