# factura-hn

[![CI](https://github.com/AugustoMelara-Dev/factura-hn/actions/workflows/ci.yml/badge.svg)](https://github.com/AugustoMelara-Dev/factura-hn/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/factura-hn?label=npm)](https://www.npmjs.com/package/factura-hn)

Facturación SAR para Honduras en JavaScript y TypeScript: CAI, rangos, ISV, numeración, notas e impresión.

## Instalación

```bash
npm install factura-hn
```

```js
import { crearFacturadorDemo } from 'factura-hn/demo';
const caja = await crearFacturadorDemo();
const factura = await caja.emitir({ lineas: [{ descripcion: 'Café molido', cantidad: 2, precioUnitario: '115.00' }] });
```

Emite con un CAI ficticio: todo impreso dice «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».

## Tu primera factura en 5 minutos

```bash
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

## Cómo se integra

- **SDK**: `npm install factura-hn` · [guía](https://augustomelara-dev.github.io/factura-hn/guias/sdk/)
- **CLI**: `npx factura-hn demo` · [guía](https://augustomelara-dev.github.io/factura-hn/guias/cli/)
- **API REST**: `docker compose up -d --build --wait` · [guía](https://augustomelara-dev.github.io/factura-hn/guias/api/)
- **MCP**: `npx -y @factura-hn/mcp init --demo` · [guía](https://augustomelara-dev.github.io/factura-hn/guias/mcp/)

## Enlaces

[Documentación](https://augustomelara-dev.github.io/factura-hn/) ·
[Conéctalo a tu IA](https://augustomelara-dev.github.io/factura-hn/ia/) ·
[Contribuir](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CONTRIBUTING.md) ·
[Discussions](https://github.com/AugustoMelara-Dev/factura-hn/discussions) ·
[Licencia MIT](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/LICENSE)

Proyecto independiente, no afiliado al SAR.
