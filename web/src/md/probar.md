<!-- sin-demo -->

:::caution[La demostración pública aún no está en línea]
Cuando lo esté, esta página creará con un clic un entorno de prueba de factura-hn. Mientras tanto, prueba el SDK
en el [playground](/empezar/playground/), que corre en el navegador, o levanta la demostración en tu equipo con la
receta
[Probar el modo demo en tu equipo](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/demo.md#probar-el-modo-demo-en-tu-equipo).
:::

Con la API en modo demostración en tu equipo (puerto por defecto, 8787), el entorno se crea así:

```bash
curl -X POST http://127.0.0.1:8787/v1/demo/entornos
```

Lo que sigue es lo que recibes, en tu equipo o en la demostración pública cuando esté en línea.

<!-- /sin-demo -->
<!-- con-demo -->

La página «Pruébalo ahora» crea con un clic un entorno de prueba en la demostración pública de factura-hn: un
emisor y un CAI ficticios solo para ti, sin cuenta y sin instalar nada. En el navegador necesita JavaScript; sin
él, o desde un agente, se crea con una solicitud a la API de la demostración:

```bash
curl -X POST https://API_DE_LA_DEMO/v1/demo/entornos
```

<!-- /con-demo -->

## Qué recibes

La respuesta (201) trae:

- `llave`: una llave `fhn_test_…` para la cabecera `Authorization: Bearer`, con curl o el SDK `@factura-hn/cliente`;
- `mcp.url`: tu URL personal del MCP (`https://…/mcp/fhnmcp_test_<prefijo>_<secreto>`), para pegar como conector
  personalizado en Claude o ChatGPT (o `null` si el servidor no tiene MCP remoto);
- `entorno`: el emisor ficticio, el punto de emisión `000-001`, cuándo se borra y los límites;
- `ejemplos`: los mismos pasos listos para copiar con curl, con el SDK y para el conector MCP.

La llave y la URL se muestran una sola vez. La URL del MCP es una credencial: quien la tenga usa tu entorno hasta
que venza.

## Lo que conviene saber

- A las 24 horas el entorno se borra con sus documentos y su llave.
- Todo lo que emitas dice «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».
- No pongas datos reales de clientes.
- Un entorno emite hasta 50 documentos y atiende unas 30 solicitudes por minuto; cada dirección crea a lo sumo 3
  entornos por día. Al pasar un límite, la respuesta es 429 con `Retry-After` (segundos). Si la demostración está
  en pausa, responde 503 `DEMO_PAUSADO`.
- En la demostración no se puede registrar un CAI real, cambiar el emisor ni configurar webhooks.

## Conecta tu asistente

Pasos verificados el 25-11-2026 con la ayuda oficial; el detalle está en [MCP remoto](/ia/mcp-remoto/).

**Claude (web, escritorio y móvil).** Desde claude.ai en un navegador (sirve el del teléfono; no desde la
aplicación móvil): Customize > Connectors > + Add > Add custom connector. Nombre «factura-hn prueba», tu URL del
MCP y, en Authentication, «No sign in». Después aparece también en la aplicación de escritorio y en la del
teléfono: en una conversación, pulsa + abajo a la izquierda, entra a Connectors y actívalo. Guía:
[custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).

**ChatGPT (solo en la web).** Plugins > + > Add custom MCP server. Nombre «factura-hn prueba», tu URL del MCP en
Connection y la opción sin autenticación; acepta el aviso («I understand and want to continue») y pulsa «Create as
a plugin». En una conversación, escribe @ y elige el plugin. Con todas las herramientas solo en Business,
Enterprise y Edu; en Pro, solo lectura. Guía:
[connecting custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta).
