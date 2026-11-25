---
title: Servidor MCP
description: Guía de entrada del servidor MCP de factura-hn — un asistente de IA emite, consulta y anula con las mismas reglas, en tu equipo o con una URL remota.
sidebar:
  label: MCP
  hidden: true
---

`@factura-hn/mcp` deja que un asistente de IA (Claude, ChatGPT, Cursor, VS Code) emita, consulte y anule
documentos a pedido de quien atiende. Las reglas fiscales las aplica el SDK o la API, no el asistente: si algo no
cumple, el asistente recibe el error con su artículo y su solución.

**Úsalo si** quien opera la facturación es una persona que conversa con un asistente. Para que un asistente
escriba la integración en tu código, ver [Emitir con un asistente](/empezar/con-ia/).

## En tu equipo (stdio)

Con Node 22.13 o más reciente, en una carpeta vacía:

```bash
npx -y @factura-hn/mcp init --demo
```

Crea una base SQLite de prueba con un emisor y un CAI ficticios e imprime el bloque `mcpServers`. Pégalo en la
configuración de tu cliente MCP, reinícialo y pide: «emite una factura de prueba». Dónde va el bloque en cada
cliente: [Servidor MCP](/ia/mcp/#pruébalo-en-3-pasos).

## Desde la web o el teléfono (remoto)

En [Pruébalo ahora](/probar/) creas un entorno de prueba con tu **URL personal del MCP**. La pegas como conector
personalizado en Claude (web, escritorio y móvil) o en ChatGPT, sin instalar nada. El entorno dura 24 horas y
luego se borra con todo lo emitido.

## Las herramientas

Emitir factura y nota de crédito, consultar un documento (también como ticket en texto), anular, registrar un CAI,
ver el estado del CAI y el libro de ventas. Antes de anular o registrar un CAI, el asistente pide confirmación si
tu cliente lo permite.

## Sigue con

- [Servidor MCP](/ia/mcp/): las 7 herramientas, el modo SQLite y el modo API, y la seguridad.
- [IA y agentes](/ia/): prompts, la skill y `llms.txt`.
