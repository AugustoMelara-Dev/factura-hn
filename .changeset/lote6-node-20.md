---
'factura-hn': minor
'@factura-hn/sqlite': minor
'@factura-hn/postgres': minor
'@factura-hn/pdf': minor
---

Node 20 o más reciente.

**Cambios incompatibles:**

- `factura-hn`, `@factura-hn/sqlite`, `@factura-hn/postgres` y `@factura-hn/pdf` piden Node 20 o más reciente
  (`engines: >=20`; antes, `>=18`). Node 18 dejó de recibir parches de seguridad en abril de 2025 y la CI ya no lo
  probaba. `@factura-hn/cliente` ya pedía Node 20 y `@factura-hn/mcp`, Node 22.13 (por `node:sqlite`).
  `@factura-hn/sqlite` sigue necesitando Node 22.13 si usas `node:sqlite` en lugar de `better-sqlite3`.
