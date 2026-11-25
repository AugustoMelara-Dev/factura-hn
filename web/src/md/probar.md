La página «Pruébalo ahora» crea con un clic un entorno de prueba en la demostración pública de factura-hn: un
emisor y un CAI ficticios solo para ti, sin cuenta y sin instalar nada. En el navegador necesita JavaScript; sin
él, o desde un agente, se crea con una solicitud a la API de la demostración:

```bash
curl -X POST https://API_DE_LA_DEMO/v1/demo/entornos
```

`API_DE_LA_DEMO` es la dirección de la demostración que muestra la página. Si la página dice «La demo en línea aún
no está publicada», usa el [playground](/empezar/playground/) o [instala la API](/guias/autoalojar/) en tu equipo.

## Qué recibes

La respuesta (201) trae:

- `llave`: una llave `fhn_test_…` para la cabecera `Authorization: Bearer`, con curl o el SDK `@factura-hn/cliente`;
- `mcp.url`: tu URL personal del MCP, para pegar como conector personalizado en Claude o ChatGPT (o `null` si el
  servidor no tiene MCP remoto);
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

**Claude (web, escritorio y móvil).** En claude.ai, abre Customize > Connectors y pulsa + > Add custom connector.
Ponle un nombre (por ejemplo, «factura-hn prueba»), pega tu URL del MCP y deja vacíos los campos de OAuth. En una
conversación nueva, activa el conector y pide una factura de prueba. El conector agregado en la web aparece también
en la aplicación de escritorio y en la del teléfono. Guía:
[custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).

**ChatGPT.** Activa el modo de desarrollador según tu plan, agrega un servidor MCP propio con tu URL del MCP y
autenticación «sin autenticación», y actívalo en una conversación. Con todas las herramientas solo en los planes
Business, Enterprise y Edu, en la web. Guía:
[developer mode and full MCP connectors](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta).
