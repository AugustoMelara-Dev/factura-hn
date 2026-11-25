# @factura-hn/mcp

## 0.4.0

### Minor Changes

- bbe5ce9: MCP remoto por Streamable HTTP: `npx -y @factura-hn/mcp http` sirve las mismas herramientas, los mismos errores en
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

### Patch Changes

- Updated dependencies [f9fbe7c]
- Updated dependencies [bbe5ce9]
- Updated dependencies [c683c6c]
  - factura-hn@0.4.0
  - @factura-hn/cliente@0.4.0
  - @factura-hn/sqlite@0.4.0

## 0.3.0

**Cambios incompatibles del MCP en la 0.3.0** (el detalle sigue abajo):

- `anular_documento` y `registrar_cai` piden confirmación por elicitación sobre datos reales. Con un cliente MCP que
  no ofrece elicitación se niegan con `CONFIRMACION_NO_DISPONIBLE`, salvo con `FHN_MCP_PERMITIR_DESTRUCTIVAS=1`.
- `anular_documento` rechaza con `DOCUMENTO_CON_NOTAS` un documento con notas vigentes: anula primero sus notas.
- Una nota de crédito que supera el gravado o el ISV del original a una tasa da `NOTA_SUPERA_ORIGINAL`, aunque no
  supere el total.
- Los paquetes piden Node 20 o más reciente (el modo SQLite del MCP, Node 22.13).

### Minor Changes

- El MCP usa el mismo modo de prueba que el SDK y deja los documentos de prueba fuera del libro de ventas.
  
  - El MCP usa `factura-hn/demo`: el mismo emisor ficticio, el mismo CAI ficticio (`DEMO00-NO-VALIDO-…`, compatible
    con los ya emitidos) y la misma leyenda. Las autorizaciones demo que registra llevan `prueba: true`.
  - `libro_ventas` deja fuera los documentos de prueba y dice cuántos. Emitir y consultar reconocen un documento de
    prueba también por `modo: 'prueba'`, no solo por el CAI.
- Revisión final de la API y del servidor MCP.
  
  - **MCP:** `anular_documento` y `registrar_cai` piden la confirmación del usuario por elicitación MCP, con el número y
    el motivo, o los datos del CAI, exactos. Si el usuario no confirma, responden `CONFIRMACION_RECHAZADA` y no hacen
    nada. Con un cliente que no ofrece elicitación se niegan (`CONFIRMACION_NO_DISPONIBLE`), salvo con
    `FHN_MCP_PERMITIR_DESTRUCTIVAS=1` o sobre datos de prueba (documento de prueba, CAI ficticio).
  - **MCP:** un argumento con forma inválida (p. ej. sin `idempotencyKey`) responde `SOLICITUD_INVALIDA` en español,
    con el campo, qué hacer y la guía, en vez del texto de Zod en inglés.
  - **MCP:** con Node anterior a 22.13, `init`, `registrar-cai` y el modo SQLite se niegan con «Necesitas Node 22.13 o
    más reciente (tienes …)». Los avisos de `consultar_documento` (formato resumen) van dentro de `<datos_documento>`.
  - **Cliente:** los tipos declaran el 403 en todas las operaciones de `/v1` (`TENANT_FUERA_DEL_MODO_LOCAL`: el servidor
    en modo local no atiende llaves de otro tenant).
  - **API:** toda respuesta JSON lleva `charset=utf-8` (Windows PowerShell 5.1 lee bien los acentos); sin
    `Idempotency-Key`, el error es `IDEMPOTENCY_KEY` con su solución; cupo de reportes por llave; un secreto de webhook
    que no se descifra falla solo su entrega; los webhooks de un tenant inactivo esperan (esquema v9); `tenant crear`
    se niega en modo local.
- 74a8eea: El MCP se prueba en 3 pasos y registra el CAI sin escribir código.
  
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
  
  **Cambios incompatibles:**
  
  Para quien usa la librería, `Backend.emitir` devuelve `{ documento, repetido }` en vez del
  documento, `Backend.libroVentas` debe devolver también `excluidos` (cuántos documentos de prueba quedaron fuera) y
  `Backend` pide además `registrarCAI`. Las herramientas `estado_cai`, `libro_ventas` y
  `consultar_documento` devuelven sus errores como resultado (`isError`) en vez de un error de protocolo.

### Patch Changes

- Lo que viaja en cada paquete de npm:
  
  - Cada paquete trae su `CHANGELOG.md` y exporta `./package.json` (`require('factura-hn/package.json')`).
  - `factura-hn/demo` y `factura-hn/pruebas` tienen tipos también con `moduleResolution: node10` (`typesVersions`);
    antes, TypeScript daba TS2307 al importarlos.
  - El ejecutable `npx factura-hn` usa el núcleo del mismo paquete en lugar de llevar otra copia (de 108 KB a 8 KB).
  - `@factura-hn/mcp` acepta cualquier versión de parche de `factura-hn`, `@factura-hn/sqlite` y `@factura-hn/cliente`
    dentro de su versión menor (`^`), en lugar de una exacta: npm no instala dos copias del núcleo si ya tienes otra
    0.x.y. Sus tipos usan los de Node (`@types/node`, dependencia par opcional).
- Updated dependencies [74a8eea]
- Updated dependencies [74a8eea]
- Updated dependencies [74a8eea]
- Updated dependencies [cc2bbd0]
- Updated dependencies [cc2bbd0]
- Updated dependencies [cc2bbd0]
- Updated dependencies [cc2bbd0]
- Updated dependencies [39072d8]
- Updated dependencies [39072d8]
- Updated dependencies [39072d8]
- Updated dependencies [39072d8]
- Updated dependencies [74a8eea]
  - @factura-hn/cliente@0.3.0
  - factura-hn@0.3.0
  - @factura-hn/sqlite@0.3.0

## 0.2.0 y anteriores

La historia hasta la 0.2.0 está en el [CHANGELOG del repositorio](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CHANGELOG.md).
