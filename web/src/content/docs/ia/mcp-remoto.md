---
title: MCP remoto
description: Conecta Claude (web, escritorio y móvil), ChatGPT o el MCP Inspector a un entorno de prueba de factura-hn con una URL personal, sin instalar nada en tu equipo.
sidebar:
  order: 5
---

El MCP remoto es el mismo [servidor MCP](/ia/mcp/) de factura-hn (las mismas herramientas, los mismos
errores en español y la misma confirmación antes de anular), pero por internet: tu asistente se conecta con una URL
y no hace falta instalar Node ni nada en tu equipo. Sirve también desde el teléfono.

En la demostración, cada URL es de **un entorno de prueba tuyo**: un emisor y un CAI ficticios que nadie más ve, que
duran 24 horas y luego se borran con todo lo que emitiste. Todo lo que emitas ahí dice
**DOCUMENTO DE PRUEBA — SIN VALOR FISCAL**. No pongas datos reales de clientes.

<!-- sin-demo -->

:::caution[La demostración pública aún no está en línea]
Mientras tanto, puedes levantar la demostración en tu equipo con la receta
[Probar el modo demo en tu equipo](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/demo.md#probar-el-modo-demo-en-tu-equipo).
Los ejemplos de esta página usan esa API local, en su puerto por defecto (`http://127.0.0.1:8787`). Para que Claude
o ChatGPT lleguen a tu MCP, tiene que estar publicado en internet con HTTPS; en tu equipo sirve el MCP Inspector.
:::

<!-- /sin-demo -->

## 1. Crea tu entorno de prueba

<!-- con-demo -->

Con el botón «[Pruébalo ahora](/probar/)» del sitio, o con curl contra la API de la demostración:

```bash
API=https://API_DE_LA_DEMO
curl -X POST "$API/v1/demo/entornos"
```

<!-- /con-demo -->
<!-- sin-demo -->

Con curl contra tu API local en modo demostración:

```bash
API=http://127.0.0.1:8787
curl -X POST "$API/v1/demo/entornos"
```

<!-- /sin-demo -->

La respuesta trae tu llave `fhn_test_…` (para curl y el SDK), tu **URL del MCP** y ejemplos listos para copiar.
Guárdalas: no se vuelven a mostrar. La URL del MCP tiene esta forma:

```text
https://…/mcp/fhnmcp_test_<prefijo>_<secreto>
```

La URL del MCP es una credencial: quien la tenga usa tu entorno de prueba hasta que venza. No la publiques. Para
apagarla antes, revoca su llave con tu llave del entorno. El `prefijo` viene en la respuesta, en `mcp.prefijo`:

```bash
LLAVE=fhn_test_…      # tu llave del entorno (campo «llave» de la respuesta)
PREFIJO=…             # el campo «mcp.prefijo» de la respuesta
curl -X DELETE "$API/v1/llaves/$PREFIJO" -H "authorization: Bearer $LLAVE"
```

Tu llave del entorno sigue sirviendo; solo deja de funcionar la URL del MCP.

## 2. Agrégala a tu asistente

Pasos verificados el 25-11-2026 con la ayuda oficial de cada cliente. Las pantallas cambian seguido: si algo no
coincide, sigue la guía enlazada.

### Claude (web, escritorio y móvil)

El conector se agrega desde [claude.ai](https://claude.ai) en un navegador, que puede ser el del teléfono; no desde
dentro de la aplicación móvil. Una vez agregado, aparece también en Claude Desktop y en la aplicación del teléfono
con la misma cuenta.

1. En claude.ai, abre **Customize > Connectors**, pulsa **+ Add** y elige **Add custom connector**. En planes Team y
   Enterprise lo agrega quien administra la organización, en **Organization settings > Connectors**; después cada
   miembro pulsa **Connect** en **Customize > Connectors**.
2. **Nombre:** por ejemplo, «factura-hn prueba». **URL:** tu URL del MCP. Pulsa **Continue**.
3. En **Authentication**, elige **No sign in**: la URL ya identifica tu entorno. No llenes los campos de OAuth ni de
   cabeceras. Pulsa **Add**.
4. En una conversación nueva (en la web, el escritorio o el teléfono), pulsa el botón **+** abajo a la izquierda de
   la caja de texto, entra a **Connectors** y activa «factura-hn prueba». Luego pide: «emite una factura de prueba
   por dos cafés de 57.50».

El plan gratuito permite un conector personalizado. Fuentes:
[Getting started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
y [Building connectors](https://claude.com/docs/connectors/building).

Si la organización filtra el tráfico saliente del servidor MCP, Claude se conecta desde las direcciones publicadas
en [IP addresses](https://platform.claude.com/docs/en/api/ip-addresses).

### ChatGPT

En ChatGPT, un servidor MCP propio se agrega como plugin, solo en la web (no en la aplicación del teléfono). Ya no
hace falta activar antes el modo de desarrollador. Con todas las herramientas (emitir, anular) solo en los planes
Business, Enterprise y Edu, donde lo crea quien administra o a quien se lo permitan; en Pro, solo con permisos de
lectura. Fuente:
[Connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta).

1. En [chatgpt.com](https://chatgpt.com), abre **Plugins**, pulsa **+** y elige **Add custom MCP server**.
2. **Nombre:** por ejemplo, «factura-hn prueba» (la descripción es opcional). En **Connection**, pega tu URL del MCP.
3. En la autenticación, elige la opción sin autenticación: la URL ya identifica tu entorno.
4. Marca **I understand and want to continue** después de leer el aviso sobre servidores de terceros y pulsa
   **Create as a plugin**. Revisa las herramientas que encontró e instala el plugin.
5. En una conversación nueva, escribe **@**, elige el plugin y pide una factura de prueba. La elección vale para ese
   mensaje: en el siguiente, vuelve a mencionarlo con **@**.

### MCP Inspector (para desarrolladores)

```bash
npx @modelcontextprotocol/inspector --server-url "https://…/mcp/fhnmcp_test_<prefijo>_<secreto>" --transport http
```

O con la ruta `/mcp` y la cabecera `Authorization: Bearer fhn_test_…` (tu llave del entorno). Ver el
[MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector).

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
