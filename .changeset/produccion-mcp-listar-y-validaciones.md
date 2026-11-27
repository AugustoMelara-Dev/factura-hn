---
"@factura-hn/mcp": minor
---

Nueva herramienta `listar_documentos` (8 en total): lista los documentos de un período, también los de prueba. Si
`consultar_documento` no encuentra un número, sugiere listarlos.

- Los argumentos inválidos dan los mismos mensajes en español que la API (p. ej. «debe tener al menos 8
  caracteres») y cada uno nombra su campo.
- `anular_documento` y `registrar_cai` validan antes de pedir confirmación: con una llave de caja, anular da
  `SOLO_ADMIN`; un CAI con otro formato, vencido o que se solapa se rechaza sin preguntar.
- `libro_ventas` y `listar_documentos` rechazan fechas que no existen y períodos al revés.
- CLI: `version`, `--version`, `<comando> --help` y `ayuda <comando>`. `init --forzar` guarda una copia `.bak`
  numerada del emisor; una base SQLite dañada da un error con su ruta. `--api-url` debe ser una URL http(s).

**Cambios incompatibles:**

- Por HTTP, la URL `/mcp/<token>` solo acepta tokens de una llave de caja: un token de una llave admin responde 403.
  Trata esa URL como una contraseña.
