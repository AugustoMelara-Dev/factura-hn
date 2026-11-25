---
title: IA y agentes
description: Cómo usar factura-hn con asistentes que escriben la integración y con asistentes que emiten documentos.
sidebar:
  order: 0
---

Un asistente de IA puede hacer dos trabajos distintos con factura-hn. Cada uno usa recursos diferentes.

- **Integrar.** Un asistente de código (Claude Code, Cursor, OpenCode, Codex) escribe en tu proyecto el código
  que emite: almacén, registro del CAI, servicio de emisión, impresión y anulación. El que emite después es tu
  sistema, no el asistente.
- **Operar.** Un asistente conectado por MCP (Claude Desktop, Claude Code, Cursor, VS Code) emite, consulta y
  anula documentos a pedido de quien atiende. No escribe código.

## Qué recurso usar

| Tarea | Recurso | Página |
|---|---|---|
| Que un agente integre el SDK en un proyecto JS/TS | Prompt de una línea (SDK) y `AGENTS.md` | [Prompts](/ia/prompts/), [AGENTS.md](/ia/agents-md/) |
| Que un agente conecte un proyecto de otro lenguaje a la API REST | Prompt de una línea (API) y `openapi.json` | [Prompts](/ia/prompts/) |
| Darle a Claude el procedimiento completo de integración | La skill `facturacion-sar-hn` | [Skill](/ia/skill/) |
| Emitir, consultar o anular desde el chat del asistente | El servidor MCP `@factura-hn/mcp` | [Servidor MCP](/ia/mcp/) |
| Probar desde Claude (también en el móvil) o ChatGPT, sin instalar nada | El MCP remoto con un entorno de prueba | [MCP remoto](/ia/mcp-remoto/) |
| Que un agente lea esta documentación | `llms.txt`, `llms-full.txt` y el `.md` de cada página | [llms.txt](/ia/llms-txt/) |

Si es la primera vez, empieza por [Integrar con IA en un prompt](/empezar/con-ia/).

## Reglas para cualquier agente

Valen para integrar y para operar. `AGENTS.md`, la skill y el servidor MCP dicen lo mismo.

- **No inventar reglas fiscales.** Las validaciones las aplica la librería. El agente no agrega ni quita
  requisitos por su cuenta.
- **No inventar un CAI.** Cada dato de una autorización (CAI, tipo, establecimiento, punto de emisión, rango,
  fecha límite) sale de la resolución del SAR que entrega la persona usuaria.
- **Mostrar los errores tal cual.** Cada error trae `codigo`, `mensaje` y, si aplica, `campo`. Los del SDK traen
  además `solucion` y un enlace a su entrada en la [referencia de errores](/referencia/errores/). El agente no los
  reinterpreta.
- **No borrar ni reutilizar un número.** Un documento emitido se anula o se corrige con una nota de crédito o de
  débito. Ver [Documentos inmutables](/conceptos/inmutables/).
- **No aprobar automáticamente `anular_documento` ni `registrar_cai`** en el cliente MCP. Las dos son
  irreversibles: el cliente debe pedir confirmación cada vez.
- **Un documento de prueba no es una factura.** Lo que se emite con el CAI ficticio (`DEMO00-NO-VALIDO-…`) dice
  «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y no se entrega como factura real.
- **Recordar una vez lo que el software no hace.** Para emitir con un sistema, el negocio debe inscribirse en el
  Régimen de Facturación (Art. 45) y como autoimpresor (Art. 47), y validar con su contador. Ver
  [Ir a producción](/produccion/).

:::note
factura-hn es un proyecto independiente, no afiliado al SAR. Ni la librería ni un asistente sustituyen la
inscripción ante el SAR ni la revisión de un contador.
:::
