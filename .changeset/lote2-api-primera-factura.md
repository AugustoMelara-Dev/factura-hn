---
"@factura-hn/cliente": minor
---

API REST y cliente: la primera factura en 3 pasos.

- `GET /v1/sesion` (cliente: `fhn.sesion()`): con qué llave hablas (tenant, rol, caja, modo, si es el demo),
  autorizaciones vigentes por punto y tipo, y si ya puedes emitir; si no, `pendientes` con `solucion` y
  `documentacion`.
- `POST /v1/documentos` y su repetición idempotente traen `enlaces: { pdf, html, txt }`.
- Los errores frecuentes traen `error.solucion` y `error.documentacion` (enlace a `docs/errores.md`); cada
  elemento de `errores` trae su `documentacion`. `ErrorFacturaHN` expone `solucion`, `documentacion` y `campo`.
- Los 400 de forma salen en español, con el primer campo en `error.campo`.
- Límite de solicitudes: el de cada llave cuenta solo solicitudes con su secreto correcto (conocer un prefijo ya
  no deja una llave en 429). Las llaves que el proceso aún no validó tienen un límite por dirección que cuenta
  también las consultas en curso (429 `DEMASIADOS_INTENTOS`, sin consultar la base); los fallos de una llave que
  existe (p. ej. revocada) se cobran a esa llave y no a la dirección, y a lo sumo 4 consultas de llaves nuevas
  van a la base a la vez (las demás esperan en cola). Las IPv6 se agrupan por /64. `X-Forwarded-For` solo se
  usa con `FHN_PROXIES_DE_CONFIANZA`, que también acepta la lista de direcciones de los proxies.
- Consola del operador en español: `factura-hn-api ayuda`, `--help` por comando, errores con código 1 y el nuevo
  `demo llave`. En Docker se invoca igual: `docker compose exec api factura-hn-api …` (`node cli.cjs` sigue
  funcionando). Las llaves del demo salen en un bloque destacado con la advertencia de CAI ficticio.
- `docker-compose.yml`: el puerto publicado se cambia con `FHN_PUERTO`.
