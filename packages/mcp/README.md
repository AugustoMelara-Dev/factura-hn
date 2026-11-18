# @factura-hn/mcp

Servidor MCP de factura-hn para agentes de IA (Claude Desktop, Claude Code, Cursor…). Herramientas:

| Herramienta | |
|---|---|
| `emitir_factura` | Factura (01) con el siguiente número autorizado; `idempotencyKey` para reintentos |
| `emitir_nota_credito` | Nota de crédito (06) sobre un documento por su número |
| `consultar_documento` | Resumen, JSON o representación impresa (texto) |
| `anular_documento` | Art. 41 (marcada como destructiva) |
| `estado_cai` | Vigencia, restantes y alertas de cada autorización |
| `libro_ventas` | Ventas de un período con totales |

Las reglas fiscales las aplica el SDK o la API: si algo no cumple, la herramienta devuelve los errores para
que el agente se los muestre al usuario tal cual.

## Vía la API

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_API_URL": "http://127.0.0.1:8787", "FHN_LLAVE": "fhn_…" }
} } }
```

Con una llave de caja, el agente emite y consulta pero no anula (403): usa una llave admin solo si quieres
que pueda anular.

## Vía el SDK local (SQLite en este equipo)

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_SQLITE": "C:/negocio/factura.db", "FHN_EMISOR": "C:/negocio/emisor.json",
           "FHN_ESTABLECIMIENTO": "000", "FHN_PUNTO": "001" }
} } }
```

`emisor.json` lleva los datos del emisor (RTN, razón social, nombre comercial, direcciones, teléfono y
correo). Las autorizaciones se registran antes con el SDK (`registrarAutorizacion`) o la API: el servidor MCP
no registra CAI. Requiere Node 22.5+ (`node:sqlite`).
