---
title: CLI
description: La línea de comandos de factura-hn — una factura de prueba en la consola y un proyecto inicial con emitir.mjs y emisor.json.
sidebar:
  label: CLI
  hidden: true
---

El paquete `factura-hn` trae una línea de comandos para empezar sin escribir código. No necesita CAI real ni base
de datos: todo lo que emite es de prueba y lleva la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».

## Comandos

| Comando | Qué hace |
|---|---|
| `npx factura-hn demo` | Emite al instante una factura de prueba en memoria, imprime el ticket y escribe `factura-demo.html` (nunca sobrescribe: si existe, `factura-demo-2.html`) |
| `npx factura-hn init` | Crea `emitir.mjs` (un ejemplo que emite y guarda `factura.html`) y `emisor.json` (datos ficticios del negocio). No sobrescribe nada salvo con `--forzar` |
| `npx factura-hn ayuda` | Muestra la ayuda |
| `npx factura-hn version` | Muestra la versión |

## De la consola a tu código

```bash
npm install factura-hn
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

`emitir.mjs` es un punto de partida: cambia la venta y los datos de `emisor.json` (ficticios, con RTN `9999…`) y
sigue con el [SDK](/guias/sdk/). `init` genera un `.mjs` para que Node lo trate como módulo sin tocar tu
`package.json`.

¿`demo` o `init`? `demo` solo muestra una factura; `init` deja código que puedes cambiar.

## Otras líneas de comandos

- **MCP:** `npx -y @factura-hn/mcp init --demo` prepara una base de prueba para un asistente de IA. Ver la
  [guía del MCP](/guias/mcp/).
- **API:** la imagen de Docker trae la consola del operador (`factura-hn-api`), para tenants y llaves. Los CAI
  se registran con la API (`POST /v1/autorizaciones`) o con `npx -y @factura-hn/mcp registrar-cai`. Ver la
  [guía de la API](/guias/api/).

## Sigue con

- [Tu primera factura](/empezar/primera-factura/).
- [Modo de prueba](/empezar/modo-de-prueba/): el CAI ficticio y qué queda fuera de los reportes.
