Facturación para Honduras, desde tu código. Emite facturas y notas de crédito y débito que cumplen el
Reglamento del SAR. Tu primera factura de prueba, en 5 minutos.

```bash
npm install factura-hn
```

[Empezar](/empezar/primera-factura/) · [GitHub](https://github.com/AugustoMelara-Dev/factura-hn)

## Qué es

factura-hn es una librería de TypeScript, sin dependencias, que lleva la numeración con CAI y rangos, calcula el
ISV sin errores de redondeo e imprime en hoja carta o ticket. Es gratis y de código abierto.

```js
import { crearFacturadorDemo } from 'factura-hn/demo';
const caja = await crearFacturadorDemo();
const factura = await caja.emitir({ lineas: [{ descripcion: 'Café molido', cantidad: 2, precioUnitario: '115.00' }] });
```

Esas tres líneas emiten una factura de prueba con un emisor y un CAI ficticios. Su ticket de 80 mm dice
«DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». En la página puedes emitir más, con el SDK corriendo en el navegador.

## Por qué es confiable

Cumple el Reglamento de Facturación del SAR y cada regla está probada.

- **Numeración sin huecos ni repetidos.** Cada número se reserva en la misma transacción que guarda el documento.
- **ISV exacto al centavo.** Sin punto flotante, con el redondeo del Art. 9 de la Ley del ISV.
- **Lo emitido no se edita.** Se anula (Art. 41) o se corrige con una nota de crédito o de débito.

[Ver cada regla con su prueba](/referencia/cumplimiento/).

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

El servidor MCP le da a tu asistente las herramientas para emitir, consultar y anular. Este comando crea una base de
prueba e imprime el bloque listo para pegar. Luego pide: «emite una factura de prueba».

```bash
npx -y @factura-hn/mcp init --demo
```

- **Claude** (Claude Desktop y Claude Code): [ver cómo](/ia/mcp/#empieza-en-3-pasos).
- **Cursor**: [ver cómo](/ia/mcp/#empieza-en-3-pasos).
- **ChatGPT**, por URL, con tu API en tu servidor: [ver cómo](/ia/mcp/#chatgpt).

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
