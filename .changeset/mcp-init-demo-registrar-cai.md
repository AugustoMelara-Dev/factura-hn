---
'@factura-hn/mcp': minor
---

El MCP se prueba en 3 pasos y registra el CAI sin escribir código.

- `npx -y @factura-hn/mcp init --demo` (o `iniciar`) crea la base SQLite, un emisor ficticio y un CAI ficticio de
  prueba, e imprime el bloque `mcpServers` con rutas absolutas y dónde pegarlo (Claude Desktop, Claude Code, Cursor,
  VS Code). Sin `--demo`, crea la base real y la plantilla `emisor.json`, y explica cómo registrar el CAI. No
  sobrescribe sin `--forzar` (que guarda `emisor.json.bak` antes de reescribir el emisor real), y repetirlo da el
  mismo resultado. La base de prueba (`factura-demo.db`) va aparte de
  la real (`factura.db`).
- Comando `registrar-cai` (en la base SQLite o vía `POST /v1/autorizaciones`) y herramienta `registrar_cai`, con las
  validaciones del núcleo y `ultimoEmitidoAntes` (`--ultimo-emitido-antes`) para un CAI con el que ya se emitió
  fuera del sistema. La herramienta exige que los datos vengan de la resolución del SAR que dio el usuario y va
  marcada como destructiva (es irreversible). Una base de prueba no recibe CAI reales en ninguna serie, e
  `init --demo` no toca una base con algún CAI real.
- `emisor.json` se valida al arrancar: un error por campo (RTN, obligatorios, tipo, claves mal escritas), con la
  ruta del archivo y cómo corregirlo.
- Un reintento con la misma `idempotencyKey` lo dice: «Ya estaba emitida» y `structuredContent.repetido: true`.
- `emitir_nota_credito` acepta `cliente`: ya se puede emitir una nota sobre una factura a CONSUMIDOR FINAL. El
  núcleo sigue exigiendo el RTN del original (`REFERENCIA_RTN_NO_COINCIDE`).
- Cada error trae `solucion` (qué hacer) y `guia` (enlace a `docs/errores.md`). Códigos nuevos: `CAI_DEMO`,
  `BASE_DEMO` y `API_INACCESIBLE`.
- Con el CAI ficticio, emitir y consultar advierten «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» (`prueba: true`).
- Al arrancar, el servidor escribe en el log del cliente el modo, el punto de emisión y si falta el CAI.
- `ayuda` lista los comandos en español.

Cambio incompatible para quien usa la librería: `Backend.emitir` devuelve `{ documento, repetido }` en vez del
documento, `Backend.libroVentas` debe devolver también `excluidos` (cuántos documentos de prueba quedaron fuera) y
`Backend` pide además `registrarCAI`. Las herramientas `estado_cai`, `libro_ventas` y
`consultar_documento` devuelven sus errores como resultado (`isError`) en vez de un error de protocolo.
