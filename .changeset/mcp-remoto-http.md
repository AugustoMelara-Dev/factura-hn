---
"@factura-hn/mcp": minor
---

MCP remoto por Streamable HTTP: `npx -y @factura-hn/mcp http` sirve las mismas herramientas, los mismos errores en
español y la misma confirmación antes de anular o registrar un CAI, para agregarlo como conector personalizado en
Claude (web, escritorio y móvil) o en ChatGPT, o para probarlo con el MCP Inspector. El modo stdio no cambia.

- Corre aparte de la API y la llama por HTTP con la llave de cada conexión: la URL personal `/mcp/<token>` (el
  token `fhnmcp_…` que da la demostración pública; de él se deriva la llave) o `/mcp` con
  `Authorization: Bearer <llave>`. No guarda datos ni credenciales.
- Cada sesión queda atada a su llave (otra llave recibe 404), vence a los 15 minutos sin uso y se reanuda con
  `Last-Event-ID`; los flujos SSE llevan un latido cada 15 segundos.
- Límites por dirección, por llave, de cuerpo y de llaves rechazadas, con 429 y `Retry-After`; sesiones con cupo por
  llave, por tenant y por dirección (al pasarse se cierra la más vieja de ese mismo visitante); eventos para
  reconexión acotados por sesión y en todo el proceso; un mensaje JSON-RPC por solicitud (un arreglo recibe 400);
  `Origin` solo de los clientes conocidos (`FHN_MCP_ORIGENES`); nunca un 500 por una solicitud mal formada.
- Manda a la API la dirección del cliente en `X-Forwarded-For`, para que los intentos con llaves no válidas
  cuenten por visitante.
- Un resultado de una herramienta de más de 64 KB (`FHN_MCP_MAX_RESULTADO`) se recorta con un aviso; nueva opción
  `maxResultado` de `crearServidorMCP`.
- Nuevas exportaciones: `servirMcpHttp`, `crearManejadorMcpHttp`, `opcionesMcpHttpDesdeEntorno`, `direccionDelCliente`,
  `ipDelCliente`, `llaveDeTokenMcp`.
