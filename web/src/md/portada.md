Facturación para Honduras, desde tu código. Emite facturas y notas de crédito y débito que cumplen el
Reglamento del SAR. Empieza en modo de prueba, en un minuto.

```js
import { crearFacturadorDemo } from 'factura-hn/demo';
const caja = await crearFacturadorDemo();
const factura = await caja.emitir({ lineas: [{ descripcion: 'Café molido', cantidad: 2, precioUnitario: '115.00' }] });
```

[Empezar](/empezar/primera-factura/) · [GitHub](https://github.com/AugustoMelara-Dev/factura-hn)

## Qué es

factura-hn es una librería de TypeScript, sin dependencias, que lleva la numeración con CAI y rangos, calcula el
ISV sin errores de redondeo e imprime en hoja carta o ticket. Lo emitido no se edita: se anula o se corrige con una
nota. Es gratis y de código abierto.

## Cómo se integra

Cuatro formas, las mismas reglas.

**SDK.** Emite desde tu sistema en Node, sobre PostgreSQL, SQLite o tu propia base. [Guía del SDK](/guias/sdk/).

```bash
npm install factura-hn
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

**CLI.** Una factura de prueba en la consola, sin escribir código. [Guía de la CLI](/guias/cli/).

```bash
npx factura-hn demo
```

**API REST.** Para cualquier lenguaje o varias cajas, con Docker y PostgreSQL. [Guía de la API](/guias/api/).

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git && cd factura-hn
docker compose up -d --build --wait     # API en http://127.0.0.1:8787
```

**MCP.** Un asistente de IA emite, consulta y anula con las mismas reglas. [Guía del MCP](/guias/mcp/).

```bash
npx -y @factura-hn/mcp init --demo
```

## Conéctalo a tu IA

El servidor MCP de factura-hn le da a tu asistente las herramientas para emitir, consultar y anular. Este comando
crea una base de prueba e imprime el bloque listo para pegar:

```bash
npx -y @factura-hn/mcp init --demo
```

**Claude.** Claude Desktop: Settings › Developer › Edit Config abre `claude_desktop_config.json`. Claude Code:
`.mcp.json` en la raíz del proyecto, o `claude mcp add-json`.

**Cursor.** Pégalo en `~/.cursor/mcp.json` (todos tus proyectos) o en `.cursor/mcp.json` (solo uno) y reinicia
Cursor.

**ChatGPT.** Levanta la API REST y el MCP por HTTP en tu servidor, con HTTPS. Crea su URL con
`factura-hn-api llave crear … --mcp` y agrégala en ChatGPT como conector MCP, sin autenticación.
[Pasos para ChatGPT](/ia/mcp/#chatgpt).

Luego pide: «emite una factura de prueba». Más en la [guía del servidor MCP](/guias/mcp/).

## Por qué es confiable

Cumple el Reglamento de Facturación del SAR y cada regla está probada.
[Ver cada regla con su prueba](/referencia/cumplimiento/).

## Comunidad

Pregunta, propón mejoras y contribuye con código, pruebas o documentación.

- [GitHub](https://github.com/AugustoMelara-Dev/factura-hn): el código, las pruebas y la documentación, con licencia MIT.
- [Discussions](https://github.com/AugustoMelara-Dev/factura-hn/discussions): preguntas, ideas y lo que estás construyendo.
- [Cómo contribuir](/ayuda/contribuir/): prepara el proyecto, corre las pruebas y abre tu pull request.

## Contacto

- **Preguntas e ideas:** [abre una discusión](https://github.com/AugustoMelara-Dev/factura-hn/discussions).
- **Un error, o una regla fiscal que crees que está mal:** [abre un issue](https://github.com/AugustoMelara-Dev/factura-hn/issues/new/choose).
- **Una vulnerabilidad:** [repórtala en privado](https://github.com/AugustoMelara-Dev/factura-hn/security/advisories/new),
  nunca en un issue público.

No incluyas datos reales de contribuyentes en ningún reporte.

Proyecto independiente, no afiliado al SAR.
