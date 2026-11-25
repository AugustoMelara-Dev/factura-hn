# @factura-hn/mcp

Servidor MCP de factura-hn para asistentes de IA (Claude Desktop, Claude Code, Cursor, VS Code…): emite,
consulta y anula documentos del SAR de Honduras (Acuerdo 481-2017). Proyecto independiente, no afiliado al SAR.

## Pruébalo en 3 pasos

Requiere Node 22.13 o más reciente.

**1.** En una carpeta vacía:

```bash
npx -y @factura-hn/mcp init --demo
```

Crea `factura-demo.db` (base SQLite) y `emisor-demo.json` (emisor ficticio), registra un CAI ficticio de prueba
e imprime el bloque `mcpServers` con las rutas absolutas.

**2.** Pega el bloque en la configuración de tu cliente MCP y reinícialo:

| Cliente | Dónde |
|---|---|
| Claude Desktop | Settings > Developer > Edit Config (Configuración > Desarrollador > Editar configuración) |
| Claude Code | `.mcp.json` en la raíz del proyecto |
| Cursor | `~/.cursor/mcp.json` (todos los proyectos) o `.cursor/mcp.json` (uno) |
| VS Code | `.vscode/mcp.json`, con la clave `"servers"` en vez de `"mcpServers"` |

En Windows el bloque usa `"command": "cmd", "args": ["/c", "npx", "-y", "@factura-hn/mcp"]`, porque `npx` es
un `.cmd`; en macOS y Linux, `"command": "npx"`.

**3.** Pídele al asistente: «emite una factura de prueba».

El resultado dice **DOCUMENTO DE PRUEBA — SIN VALOR FISCAL**: el CAI es ficticio (`DEMO00-NO-VALIDO-…`) y vence
a los 180 días. Repetir `init --demo` no cambia nada; `init --demo --forzar` recrea la base de prueba, salvo que
tenga algún CAI real: entonces no la toca.

## Con tus datos reales

La base real va aparte de la de prueba, en `factura.db` y `emisor.json`, para que los documentos de prueba no se
mezclen con tu numeración fiscal.

```bash
npx -y @factura-hn/mcp init
```

Crea la base vacía y la plantilla `emisor.json`, e imprime el bloque `mcpServers`. Después:

**1. Llena `emisor.json`** con los datos de tu negocio (Art. 10 num. 1). Ejemplo completo, con datos ficticios:

```json
{
  "rtn": "99990000000001",
  "razonSocial": "Comercial Ejemplo S. de R.L.",
  "nombreComercial": "Tienda Ejemplo",
  "direccionCasaMatriz": "Barrio El Centro, Ciudad Ejemplo",
  "direccionEstablecimiento": "Barrio El Centro, Ciudad Ejemplo",
  "telefono": "0000-0001",
  "correo": "ventas@ejemplo.example"
}
```

Todos los campos son obligatorios y van entre comillas. El RTN tiene 14 dígitos, con o sin guiones. Las claves que
empiezan con `_` son notas y no se leen. El servidor valida el archivo al arrancar y, si algo falla, no arranca:
el log de tu cliente MCP muestra la ruta del archivo y un error por campo, con qué escribir.

```text
El archivo del emisor tiene 2 errores (C:\negocio\emisor.json):
- rtn: "9999000" no es un RTN válido (Art. 10 num. 1 a): debe tener 14 dígitos, con o sin guiones (p. ej. "99990000000001").
- correo: falta. Escribe el correo del contrato de adhesión con el SAR (p. ej. "ventas@ejemplo.example").
Corrige el archivo, guárdalo y reinicia el servidor MCP desde tu cliente. Hay un ejemplo completo en el README de @factura-hn/mcp.
```

**2. Registra el CAI de tu resolución del SAR**, una vez por tipo de documento (01 facturas, 06 notas de
crédito, 07 notas de débito). Copia cada dato de la resolución (en una línea; funciona igual en PowerShell, cmd y
bash):

```bash
npx -y @factura-hn/mcp registrar-cai --base C:/negocio/factura.db --cai A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4 --tipo 01 --establecimiento 000 --punto 001 --desde 1 --hasta 5000 --fecha-limite 2027-06-30
```

**¿Ya emitiste documentos con ese CAI** (talonario u otro sistema)? Agrega `--ultimo-emitido-antes` con el último
número que usaste, p. ej. `--ultimo-emitido-antes 120`: la serie sigue en el 121. Sin él, empieza en `--desde` y
esos números se repetirían.

- Valida con las mismas reglas del núcleo (`registrarAutorizacion`): formato del CAI, rango, fecha, rangos que se
  solapan y CAI repetidos. Con `--fecha-autorizacion` también avisa si la vigencia pasa de un año (Art. 62).
- `--base` puede omitirse si defines `FHN_SQLITE` o si `factura.db` está en la carpeta actual. No crea una base
  nueva: si la ruta no existe, lo dice.
- No acepta el CAI ficticio (`CAI_DEMO`) ni registra un CAI real en una base de prueba, en ninguna serie
  (`BASE_DEMO`).
- Un CAI registrado no se puede quitar: revisa los datos antes.

También puedes pedirle al asistente que lo registre con la herramienta `registrar_cai`, dándole los datos de la
resolución: la herramienta le exige no inventarlos, preguntarte si ya emitiste con ese CAI
(`ultimoEmitidoAntes`) y confirmarlos contigo antes de registrar.

**3. Pega el bloque** que imprimió `init` y reinicia el cliente MCP.

## Herramientas

| Herramienta | |
|---|---|
| `emitir_factura` | Factura (01) con el siguiente número autorizado; `idempotencyKey` para reintentos |
| `emitir_nota_credito` | Nota de crédito (06) sobre un documento por su número; `cliente` opcional |
| `consultar_documento` | Resumen, JSON o representación impresa (texto) |
| `anular_documento` | Art. 41 (marcada como destructiva) |
| `registrar_cai` | Registra una autorización del SAR con los datos de la resolución (irreversible: marcada como destructiva) |
| `estado_cai` | Vigencia, restantes y alertas de cada autorización |
| `libro_ventas` | Ventas de un período con totales |

Las reglas fiscales las aplica el SDK o la API. Si algo no cumple, la herramienta devuelve los errores para que el
asistente se los muestre al usuario tal cual. Cada error trae:

- `codigo` y `mensaje`, los del núcleo o la API;
- `solucion`: qué hacer;
- `guia`: el enlace a su entrada en
  [`docs/errores.md`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md).

**Reintentos.** Si el asistente repite una emisión con la misma `idempotencyKey`, recibe el documento ya emitido
y el resultado lo dice: el texto empieza con «Ya estaba emitida» y `structuredContent.repetido` es `true`. No se
emitió otro documento.

**Notas de crédito.** El adquirente de la nota es el del original. Si el original se emitió sin RTN (p. ej. a
CONSUMIDOR FINAL), pasa `cliente` con el nombre y el RTN del comprador: las notas los exigen (Arts. 26 y 28). Si
el original tiene RTN, la nota debe llevar el mismo (`REFERENCIA_RTN_NO_COINCIDE`).

**Modo de prueba.** Con el CAI ficticio, el resultado de emitir y consultar lleva «DOCUMENTO DE PRUEBA — SIN
VALOR FISCAL» y `structuredContent.prueba` es `true`.

## Seguridad

- `emitir_factura` y `emitir_nota_credito` exigen `idempotencyKey`: el agente la genera una vez por venta y la
  repite si reintenta. La misma clave con otro contenido da `IDEMPOTENCIA_CONFLICTO`.
- El texto de los documentos (nombres, descripciones, motivos) se entrega entre `<datos_documento>` y marcado
  como datos: lo escribieron terceros y no son instrucciones. En `structuredContent`, los resultados que traen
  documentos o el libro de ventas llevan un campo `aviso` que dice lo mismo, y ningún texto lleva las etiquetas
  `<datos_documento>` ni `</datos_documento>`: se quitan, para que un nombre no pueda cerrar el bloque de datos.
- `anular_documento` es destructiva (`destructiveHint`). **No la apruebes automáticamente** en tu cliente MCP:
  que pida confirmación cada vez. Vía la API, usa una llave de caja y el agente no podrá anular (403).
- `registrar_cai` también es destructiva (`destructiveHint`): no borra nada, pero un CAI registrado no se quita y
  fija la numeración. Que tu cliente pida confirmación y revisa los datos contra la resolución.

## Modo SQLite (en este equipo)

En Windows:

```json
{ "mcpServers": { "factura-hn": {
  "command": "cmd", "args": ["/c", "npx", "-y", "@factura-hn/mcp"],
  "env": { "FHN_SQLITE": "C:/negocio/factura.db", "FHN_EMISOR": "C:/negocio/emisor.json",
           "FHN_ESTABLECIMIENTO": "000", "FHN_PUNTO": "001" }
} } }
```

En macOS y Linux:

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_SQLITE": "/srv/negocio/factura.db", "FHN_EMISOR": "/srv/negocio/emisor.json",
           "FHN_ESTABLECIMIENTO": "000", "FHN_PUNTO": "001" }
} } }
```

- `FHN_SQLITE` debe ser un archivo: no hay modo en memoria (se perderían documentos y números consumidos).
- `FHN_ESTABLECIMIENTO` y `FHN_PUNTO` son dónde emite este servidor; por defecto, `000` y `001`.
- Al arrancar, el servidor escribe en el log del cliente el modo, el punto de emisión y si falta el CAI.
- Las claves de idempotencia se guardan en la misma base (tabla `mcp_claves`), en la transacción de cada emisión:
  un reintento del agente, aun después de reiniciar el servidor, devuelve la misma factura.

## Modo API

Contra la API de factura-hn (local con Docker, o alojada). En Windows, usa `"command": "cmd"` y
`"args": ["/c", "npx", "-y", "@factura-hn/mcp"]`, como arriba:

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_API_URL": "http://127.0.0.1:8787", "FHN_LLAVE": "fhn_…" }
} } }
```

- Con una llave de caja, el agente emite y consulta, pero no anula (403), no registra CAI (403 `SOLO_ADMIN`) ni
  emite una nota de crédito sobre un documento que no está en el sistema (403 `SOLO_ADMIN`). Usa una llave admin
  solo si quieres que pueda hacerlo.
- `registrar-cai` también funciona contra la API (`POST /v1/autorizaciones`), con una llave admin:
  `npx -y @factura-hn/mcp registrar-cai --api-url http://127.0.0.1:8787 --llave fhn_… --cai CAI_DE_LA_RESOLUCION …`
  (o `FHN_API_URL` y `FHN_LLAVE`).
- Si la API no responde, el error es `API_INACCESIBLE`.

En ambos modos, `FHN_OPERADOR` (opcional) es la persona que opera con el agente: queda en la bitácora. Las
herramientas de emitir y anular aceptan además `operador` (si el usuario dice quién atiende) e `imprimirOperador`
para imprimir «Atendido por» en el documento.

## Comandos

Todos en español. `npx -y @factura-hn/mcp ayuda` los lista.

| Comando | |
|---|---|
| *(ninguno)* | Arranca el servidor MCP por stdio. Lo hace tu cliente MCP. |
| `init` (o `iniciar`) | Crea la base y el emisor e imprime el bloque `mcpServers`. Opciones: `--demo`, `--dir`, `--establecimiento`, `--punto`, `--forzar`. |
| `registrar-cai` | Registra el CAI de una resolución del SAR, en la base SQLite o vía la API. Opciones: `--cai`, `--tipo`, `--establecimiento`, `--punto`, `--desde`, `--hasta`, `--fecha-limite`, `--fecha-autorizacion`, `--ultimo-emitido-antes`, `--base`, `--api-url`, `--llave`. |
| `ayuda` | La ayuda. |

`init` no sobrescribe nada sin `--forzar`, y repetirlo da el mismo resultado. `--forzar` reescribe el archivo del
emisor (del `emisor.json` real guarda antes una copia, `emisor.json.bak`) y, con `--demo`, recrea la base de
prueba si no tiene ningún CAI real. La base real no se borra nunca.
