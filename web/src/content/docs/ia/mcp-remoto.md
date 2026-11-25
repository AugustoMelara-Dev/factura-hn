---
title: MCP remoto
description: Conecta Claude (web, escritorio y móvil), ChatGPT o el MCP Inspector a un entorno de prueba de factura-hn con una URL personal, sin instalar nada.
sidebar:
  order: 5
---

El MCP remoto es el mismo [servidor MCP](/ia/mcp/) de factura-hn (las mismas herramientas, los mismos
errores en español y la misma confirmación antes de anular), pero por internet: tu asistente se conecta con una URL
y no hace falta instalar Node ni nada en tu equipo. Sirve también desde el teléfono.

En la demostración pública, cada URL es de **un entorno de prueba tuyo**: un emisor y un CAI ficticios que nadie más
ve, que duran 24 horas y luego se borran con todo lo que emitiste. Todo lo que emitas ahí dice
**DOCUMENTO DE PRUEBA — SIN VALOR FISCAL**. No pongas datos reales de clientes.

## 1. Crea tu entorno de prueba

Con el botón «Pruébalo ahora» del sitio, o con curl contra la API de la demostración:

```bash
curl -X POST https://API_DE_LA_DEMO/v1/demo/entornos
```

La respuesta trae tu llave `fhn_test_…` (para curl y el SDK), tu **URL del MCP**
(`https://…/mcp/fhnmcp_test_…`) y ejemplos listos para copiar. Guárdalas: no se vuelven a mostrar.

La URL del MCP es una credencial: quien la tenga usa tu entorno de prueba hasta que venza. No la publiques. Para
apagarla antes, revoca su llave con tu llave del entorno: `DELETE /v1/llaves/{prefijo}`, con el `prefijo` que
trae la respuesta en `mcp.prefijo`.

## 2. Agrégala a tu asistente

### Claude (web, escritorio y móvil)

1. En [claude.ai](https://claude.ai), abre **Customize > Connectors** y pulsa **+** > **Add custom connector**. En
   planes Team y Enterprise, quien administra la organización lo agrega en **Organization settings > Connectors**.
2. Ponle un nombre (por ejemplo, «factura-hn prueba») y pega tu URL del MCP. No llenes los campos de OAuth: la URL
   ya identifica tu entorno.
3. Guarda. En una conversación nueva, activa el conector desde el menú de herramientas y pide: «emite una factura de
   prueba por dos cafés de 57.50».

El conector que agregas en la web aparece también en Claude Desktop y en la aplicación móvil con la misma cuenta.
El plan gratuito permite un conector personalizado. Fuentes:
[Getting started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
y [Building connectors](https://claude.com/docs/connectors/building).

Si la organización filtra el tráfico saliente del servidor MCP, Claude se conecta desde las direcciones publicadas
en [IP addresses](https://platform.claude.com/docs/en/api/ip-addresses).

### ChatGPT

Los conectores MCP propios están en el modo de desarrollador de ChatGPT (beta). Con todas las herramientas (emitir,
anular) solo en los planes Business, Enterprise y Edu, y solo en la web; en otros planes el acceso es de solo
lectura o no está disponible. Los pasos y los planes cambian seguido: revisa
[Developer mode and full MCP connectors in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
y [Connect from ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).

1. Activa el modo de desarrollador según la guía de tu plan.
2. Agrega un servidor MCP propio: nombre, **URL de conexión** (tu URL del MCP) y autenticación **sin
   autenticación** (la URL ya identifica tu entorno).
3. Acepta el aviso sobre servidores de terceros y crea el conector. Actívalo en una conversación y pide una factura
   de prueba.

### MCP Inspector (para desarrolladores)

```bash
npx @modelcontextprotocol/inspector --server-url "https://…/mcp/fhnmcp_test_…" --transport http
```

O con la ruta `/mcp` y la cabecera `Authorization: Bearer fhn_test_…` (tu llave del entorno). Ver el
[MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector).

## Qué puede hacer el asistente

Lo mismo que con el MCP local: emitir facturas y notas de crédito, consultar un documento (también como ticket en
texto), anular, ver el estado del CAI y el libro de ventas. Antes de anular, si tu cliente lo permite (elicitación
MCP), el asistente te pide confirmación con el número y el motivo. Con datos reales, un cliente que no puede
preguntar no anula; en la demostración todo es de prueba, así que ahí sí anula.

En la demostración no se puede registrar un CAI real, cambiar el emisor ficticio ni configurar webhooks. Para eso,
[instala factura-hn](/empezar/elegir-camino/) con tus datos.

## Límites de la demostración

Un entorno dura 24 horas, emite hasta 50 documentos y atiende unas 30 solicitudes por minuto. Cada dirección crea a
lo sumo 3 entornos por día. Al pasar un límite, la respuesta dice cuánto esperar (`Retry-After`). Si el servicio
está en pausa por mantenimiento, responde 503 `DEMO_PAUSADO`.

Si el asistente dice que la sesión no existe o venció, es normal tras unos minutos sin uso: el cliente abre otra
sola. Si la URL deja de funcionar (401), tu entorno venció: crea otro.

## Para quien opera la demostración

Las variables, el despliegue (incluido Fly.io con Supabase), la limpieza, el interruptor global y las notas de
seguridad están en [docs/demo.md](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/demo.md).
