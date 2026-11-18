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

## Seguridad

- `emitir_factura` y `emitir_nota_credito` exigen `idempotencyKey`: el agente la genera una vez por venta y la
  repite si reintenta. La misma clave con otro contenido da `IDEMPOTENCIA_CONFLICTO`.
- El texto de los documentos (nombres, descripciones, motivos) se entrega entre `<datos_documento>` y marcado
  como datos: lo escribieron terceros y no son instrucciones.
- `anular_documento` es destructiva (`destructiveHint`). **No la apruebes automáticamente** en tu cliente MCP:
  que pida confirmación cada vez. Vía la API, usa una llave de caja y el agente no podrá anular (403).

## Configuración

`@factura-hn/mcp` aún no está publicado en npm. Mientras tanto, compílalo (`pnpm --filter @factura-hn/mcp build`)
y usa `"command": "node", "args": ["<ruta al repo>/packages/mcp/dist/cli.js"]` en lugar de `npx`.

### Vía la API

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_API_URL": "http://127.0.0.1:8787", "FHN_LLAVE": "fhn_…" }
} } }
```

Con una llave de caja, el agente emite y consulta pero no anula (403): usa una llave admin solo si quieres
que pueda anular.

En ambos modos, `FHN_OPERADOR` (opcional) es la persona que opera con el agente: queda en la bitácora junto a
la llave (DEC-031). Las herramientas de emitir y anular aceptan además `operador` (si el usuario dice quién
atiende) e `imprimirOperador` para imprimir «Atendido por» en el documento.

### Vía el SDK local (SQLite en este equipo)

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_SQLITE": "C:/negocio/factura.db", "FHN_EMISOR": "C:/negocio/emisor.json",
           "FHN_ESTABLECIMIENTO": "000", "FHN_PUNTO": "001" }
} } }
```

`emisor.json` lleva los datos del emisor (RTN, razón social, nombre comercial, direcciones, teléfono y
correo). Las claves de idempotencia se guardan en la misma base (tabla `mcp_claves`), en la transacción de
cada emisión: un reintento del agente, aun después de reiniciar el servidor, devuelve la misma factura. Las autorizaciones se registran antes con el SDK (`registrarAutorizacion`) o la API: el servidor MCP
no registra CAI. `FHN_SQLITE` debe ser un archivo: no hay modo en memoria (se perderían documentos y
números consumidos). El modo SQLite requiere Node 22.13+ (`node:sqlite` sin bandera); el modo API, Node 20+.
