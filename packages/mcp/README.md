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

Dos modos: contra la API de factura-hn (con Docker) o con el SDK local sobre un archivo SQLite (sin Docker).

### Vía la API

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_API_URL": "http://127.0.0.1:8787", "FHN_LLAVE": "fhn_…" }
} } }
```

Con una llave de caja, el agente emite y consulta pero no anula (403), ni emite una nota de crédito sobre un
documento que no está en el sistema (403 `SOLO_ADMIN`).
Usa una llave admin solo si quieres que pueda hacerlo.

En ambos modos, `FHN_OPERADOR` (opcional) es la persona que opera con el agente: queda en la bitácora junto a
la llave. Las herramientas de emitir y anular aceptan además `operador` (si el usuario dice quién
atiende) e `imprimirOperador` para imprimir «Atendido por» en el documento.

### Vía el SDK local (SQLite en este equipo)

```json
{ "mcpServers": { "factura-hn": {
  "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_SQLITE": "C:/negocio/factura.db", "FHN_EMISOR": "C:/negocio/emisor.json",
           "FHN_ESTABLECIMIENTO": "000", "FHN_PUNTO": "001" }
} } }
```

Requiere Node 22.13+ (el modo SQLite usa `node:sqlite` sin bandera). `FHN_SQLITE` debe ser
un archivo: no hay modo en memoria (se perderían documentos y números consumidos). Antes de arrancar:

**1. `emisor.json`** con los datos del emisor (Art. 10 num. 1). El servidor lo valida al arrancar y dice qué
falta:

```json
{
  "rtn": "99990000000001",
  "razonSocial": "Comercial Ejemplo S. de R.L.",
  "nombreComercial": "Tienda Ejemplo",
  "direccionCasaMatriz": "Barrio Centro, Tegucigalpa",
  "direccionEstablecimiento": "Barrio Centro, Tegucigalpa",
  "telefono": "0000-0000",
  "correo": "ventas@ejemplo.example"
}
```

**2. El CAI de tu resolución**, registrado en la misma base. El servidor MCP no registra CAI: hazlo una vez con
el SDK. En una carpeta con `"type": "module"` en `package.json`, `npm install factura-hn @factura-hn/sqlite` y
este `registrar-cai.mjs` (cambia los datos por los de tu resolución):

```js
import { DatabaseSync } from 'node:sqlite';
import { registrarAutorizacion } from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';

const db = new DatabaseSync('C:/negocio/factura.db'); // el mismo archivo de FHN_SQLITE
await registrarAutorizacion(new AlmacenSQLite(db), {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01', // 06 para notas de crédito: registra también su CAI
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
});
db.close();
console.log('CAI registrado');
```

`node registrar-cai.mjs`. Las claves de idempotencia se guardan en la misma base (tabla `mcp_claves`), en la
transacción de cada emisión: un reintento del agente, aun después de reiniciar el servidor, devuelve la misma
factura.
