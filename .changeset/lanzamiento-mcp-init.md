---
"@factura-hn/mcp": minor
---

`init --demo` dice qué hizo y qué pegar, paso por paso, y `init` sin bandera sugiere primero el modo de prueba. Cada
error trae su solución (si no tiene una propia, la del SDK), y los errores de arranque dicen qué cambiar en la
configuración del cliente. Para ChatGPT y otros clientes que se conectan solo por URL: la consola de la API crea una
URL propia del MCP con `factura-hn-api llave crear <tenant> --rol caja --caja 000-001 --mcp`. El README nombra el
binario `factura-hn-mcp` y cómo usarlo con el paquete instalado en el proyecto. Por HTTP, una llave de caja emite en su propia caja.
