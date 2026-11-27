---
title: llms.txt y Markdown
description: Para qué sirven llms.txt, llms-full.txt y la versión .md de cada página, y cómo dárselos a un agente.
sidebar:
  order: 6
---

Este sitio publica tres recursos en texto plano para que un agente de IA lea la documentación sin pasar por el
HTML. Se generan al construir el sitio, a partir de los mismos Markdown que las páginas: no hay una copia aparte
que mantener.

| Recurso | Qué es | Cuándo usarlo |
|---|---|---|
| `/llms.txt` | Un resumen curado: qué es factura-hn, la primera factura por cada camino, el flujo de emisión, los tipos clave, los prompts y un índice de enlaces | Para orientar a un agente en pocas líneas |
| `/llms-full.txt` | Toda la documentación del sitio en un solo archivo de texto | Para darle a un agente el contexto completo de una vez |
| `.md` de cada página | El Markdown de una página, sin la navegación del sitio | Para darle a un agente solo la página que necesita |

Las rutas son relativas a la raíz del sitio. Por ejemplo, con el sitio en
`https://augustomelara-dev.github.io/factura-hn/`, el resumen está en
`https://augustomelara-dev.github.io/factura-hn/llms.txt`.

## llms.txt

Sigue la propuesta de [llmstxt.org](https://llmstxt.org/): un título, un resumen y una lista de enlaces. Es el
mismo `llms.txt` de la raíz del repositorio, con los enlaces convertidos a páginas de este sitio. Trae:

- la primera factura en modo de prueba por el SDK, la API y el MCP;
- el camino único: `registrarAutorizacion`, `emitir`, `renderizarHTML` o `renderizarTexto`, y `anular`;
- los almacenes, los documentos que se pueden emitir, los montos, las fechas y los errores;
- la API REST, el cliente tipado y las 8 herramientas del MCP;
- los dos [prompts de una línea](/ia/prompts/);
- los tipos clave (`AutorizacionCAI`, `DocumentoEntrada`, `Emisor`, `LineaEntrada`, `DocumentoFiscal`, `Totales`).

Una prueba del repositorio comprueba que `llms.txt` lleve los mismos prompts que el README y `AGENTS.md`, que
nombre solo funciones y tipos que existen y que liste las 8 herramientas que registra el servidor MCP.

El paquete npm `factura-hn` también trae `llms.txt`, en `node_modules/factura-hn/llms.txt`.

## llms-full.txt

Concatena las páginas de la documentación en un solo archivo. Sirve cuando el agente no puede navegar enlaces o
cuando quieres pegar todo el contexto en una conversación. Es largo: si solo necesitas un tema, usa el `.md` de
esa página.

## El .md de cada página

Cada página tiene su versión en Markdown en la misma ruta, terminada en `.md`. Trae el texto y los bloques de
código de la fuente, con los enlaces convertidos en URL completas, sin menús ni estilos. El `llms.txt` del
sitio también lista las páginas con su versión `.md`. Es lo más fácil de leer para un agente y lo más
barato en contexto.

## Cómo dárselos a un agente

- **Asistente con acceso a la web.** Pásale la URL de `llms.txt` y pídele que siga los enlaces que necesite.
- **Asistente sin acceso a la web.** Descarga `llms-full.txt` o el `.md` de la página y adjúntalo.
- **Asistente de código en tu proyecto.** No hace falta el sitio: después de `npm install factura-hn`,
  `AGENTS.md`, `llms.txt` y `docs/` están en `node_modules/factura-hn/` y corresponden a la versión instalada.
  Ver [AGENTS.md](/ia/agents-md/).

La API REST publica además su especificación en `/openapi.json`, con las reglas en la descripción. Un agente que
integra otro lenguaje genera el cliente desde ahí. Ver la [referencia de la API](/referencia/api/).
