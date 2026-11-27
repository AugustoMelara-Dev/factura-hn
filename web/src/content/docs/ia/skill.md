---
title: Skill para Claude
description: La skill facturacion-sar-hn, qué hace, cómo instalarla en Claude Code y qué archivos lee.
sidebar:
  order: 3
---

`facturacion-sar-hn` es una skill de Claude: un archivo `SKILL.md` con el procedimiento para integrar
factura-hn en un proyecto. Claude la usa cuando la persona usuaria pide facturar, emitir facturas fiscales,
registrar un CAI, calcular ISV o armar un POS para Honduras.

## Qué hace

- **Elige el camino.** SDK (proyecto JS/TS con su propia base) o API REST (otro lenguaje, o un servidor de
  factura-hn ya instalado). Si no está claro, pregunta. Para operar la facturación desde el asistente, y no
  integrarla, remite al [servidor MCP](/ia/mcp/).
- **Empieza con una factura de prueba.** Con el CAI ficticio, antes de tocar el proyecto.
- **Sigue los pasos del SDK.** Instalar la librería y el almacén, leer la documentación, detectar el stack,
  crear el almacén, una pantalla para registrar el CAI, el campo `tratamientoISV` en el producto, el servicio de
  emisión, impresión, anulación, nota de crédito, alertas del CAI y pruebas.
- **Sigue los pasos de la API.** Cliente tipado o generado desde `openapi.json`, `Idempotency-Key` estable por
  venta, errores del 422 tal cual, reimpresión desde la API y verificación de la firma de los webhooks.
- **Aplica las reglas.** No inventar requisitos fiscales ni CAI, no borrar ni reutilizar números, mostrar los
  errores sin reinterpretarlos, cobrar `totales.total` y no entregar un documento de prueba como factura.
  Recuerda una vez que el negocio debe estar registrado como autoimpresor.

Trae los mismos dos prompts de una línea que el README y `AGENTS.md`. Ver [Prompts](/ia/prompts/).

## Dónde está

En el repositorio: `skills/facturacion-sar-hn/SKILL.md`
([ver en GitHub](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/skills/facturacion-sar-hn/SKILL.md)).

En el paquete npm: `node_modules/factura-hn/skills/facturacion-sar-hn/SKILL.md`, después de
`npm install factura-hn`.

## Cómo instalarla en Claude Code

Claude Code busca las skills de un proyecto en `.claude/skills/<nombre>/SKILL.md`. Copia la carpeta desde
`node_modules`, en la raíz del proyecto.

En bash (Linux, macOS o Git Bash):

```bash
mkdir -p .claude/skills
cp -r node_modules/factura-hn/skills/facturacion-sar-hn .claude/skills/
```

En PowerShell:

```powershell
New-Item -ItemType Directory -Force .claude/skills | Out-Null
Copy-Item -Recurse node_modules/factura-hn/skills/facturacion-sar-hn .claude/skills/
```

Para usarla en todos tus proyectos, cópiala en `~/.claude/skills/` en lugar de `.claude/skills/`. Al actualizar
`factura-hn`, vuelve a copiarla: la copia no se actualiza sola.

En otros clientes, consulta cómo cargan skills o instrucciones. Si tu cliente no tiene skills, los
[prompts](/ia/prompts/) y [`AGENTS.md`](/ia/agents-md/) dan el mismo resultado.

:::note
Si pnpm muestra «Agent skills awaiting approval: factura-hn (tarball)» al instalar, se refiere a la carpeta
`skills/` que trae el paquete. La librería funciona igual sin aprobarla.
:::

## Qué archivos lee

La skill manda a leer estos archivos, todos dentro de `node_modules` para que coincidan con la versión instalada.

| Camino | Archivo |
|---|---|
| SDK | `node_modules/factura-hn/AGENTS.md` |
| SDK | `node_modules/factura-hn/docs/persistencia.md` |
| API | `node_modules/@factura-hn/cliente/AGENTS.md`, sección «Con la API REST» |
| API | `node_modules/@factura-hn/cliente/docs/api.md` |
| API, otro lenguaje | `/openapi.json` de la API, cuya descripción trae las reglas |

Sin el cliente instalado, la referencia de la API está en
[GitHub](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/api.md) y en
[la referencia de la API](/referencia/api/) de este sitio.
