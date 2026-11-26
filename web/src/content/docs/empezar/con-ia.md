---
title: Emitir con un asistente
description: Prompts probados para que un agente de IA integre factura-hn en tu proyecto, la skill para Claude y el servidor MCP para operar la facturación.
sidebar:
  order: 4
---

Un asistente de IA puede hacer dos cosas distintas con factura-hn:

- **Integrarla** en tu código: escribe el almacén, la pantalla del CAI, el servicio de emisión y la impresión.
  Para eso, un prompt y `AGENTS.md`.
- **Operarla**: emite, consulta y anula desde la conversación. Para eso, el [servidor MCP](/ia/mcp/).

El panorama completo está en [IA y agentes](/ia/).

## Integrar en un prompt

En Claude Code, Cursor u OpenCode, dentro de tu proyecto, pega uno de estos prompts. Son los mismos de
`README.md` y `AGENTS.md`.

**SDK** (tu proyecto JS/TS emite con su propia base):

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

**API** (cualquier lenguaje; la API de factura-hn emite):

```text
Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.
```

La versión detallada del prompt del SDK, si prefieres decir paso a paso qué quieres:

```text
Instala la librería npm "factura-hn" y lee node_modules/factura-hn/AGENTS.md antes de escribir código.
Integra la facturación SAR Honduras en este proyecto:
1. Un AlmacenFiscal: @factura-hn/postgres o @factura-hn/sqlite si el proyecto usa esas bases; si usa otra,
   implementa la interfaz y hazla pasar la batería de factura-hn/pruebas (docs/persistencia.md).
2. Una pantalla para registrar autorizaciones CAI con registrarAutorizacion.
3. Un servicio "emitir factura" en el servidor que reciba el carrito y llame a emitir.
4. Impresión con renderizarHTML (carta y ticket) y una pantalla de estado del CAI con estadoAutorizacion.
5. Anulación con anular (nunca borrar) y Nota de Crédito (06) que referencie la factura.
No inventes reglas fiscales: usa las validaciones de la librería y muestra al usuario sus mensajes de error.
```

## Qué lee el agente

El paquete `factura-hn` trae `AGENTS.md`: las instrucciones para un agente que integra la librería. Sus
principios, en corto:

1. No inventa reglas fiscales: usa `validarEntrada` y `emitir`, y muestra los errores tal cual.
2. Un solo camino: emite con `emitir` y anula con `anular`, siempre sobre un `AlmacenFiscal`.
3. Usa un almacén probado (Postgres o SQLite) o uno propio que pase la batería de contrato.
4. Un número emitido no se borra ni se reutiliza; una factura se corrige con nota de crédito o de débito.
5. La emisión corre en el servidor; el navegador solo envía el carrito.
6. Cobra `totales.total`, no la suma de los precios.
7. Los datos del CAI vienen de la base, cargados desde la resolución, nunca escritos en el código.
8. Los montos viajan como texto exacto (`'89.50'`).

El texto completo está en [AGENTS.md](/ia/agents-md/).

## Qué revisar después

Revisa el código del agente antes de usarlo con un CAI real:

- [ ] La emisión pasa por `emitir` (o `crearFacturador`) y corre en el servidor.
- [ ] El almacén es `AlmacenPostgres`, `AlmacenSQLite` o uno propio que pasa `ejecutarContratoAlmacen`.
  `AlmacenFiscalMemoria` es solo para pruebas.
- [ ] El CAI se registra una vez, desde una pantalla de configuración, no en cada arranque ni en cada venta.
- [ ] No hay ningún CAI de ejemplo en el código de producción, ni `factura-hn/demo`.
- [ ] Los errores se muestran con su mensaje, sin reescribirlos.
- [ ] La caja cobra `totales.total`.
- [ ] Una falla después de emitir (impresión, pago) anula el documento; nunca lo borra.
- [ ] El proyecto tiene las pruebas que pide `AGENTS.md`: una validación fallida no consume número, una
  autorización vencida o agotada muestra el error, y el total impreso coincide con lo cobrado.

Con la API, además: la llave va solo en el servidor, la `Idempotency-Key` es estable por venta (el id del
pedido, no un valor nuevo por intento) y la firma de los webhooks se verifica sobre el cuerpo crudo.

## Skill para Claude

El repositorio trae una skill, `facturacion-sar-hn`, con los mismos dos caminos, la prueba previa con el CAI
ficticio y los pasos de la integración. Está en
[`skills/facturacion-sar-hn/SKILL.md`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/skills/facturacion-sar-hn/SKILL.md).
Ver [Skill para Claude](/ia/skill/).

## Operar con el servidor MCP

Para que el asistente emita por ti, sin escribir código:

```bash
npx -y @factura-hn/mcp init --demo
```

Pega el bloque `mcpServers` que imprime en tu cliente, reinícialo y pide «emite una factura de prueba». Los
pasos completos están en [Primera factura: MCP](/empezar/primera-factura/#mcp-claude-desktop-claude-code-cursor).

Herramientas: `emitir_factura`, `emitir_nota_credito`, `consultar_documento`, `listar_documentos`,
`anular_documento`, `registrar_cai`, `estado_cai` y `libro_ventas`.

:::danger[No apruebes la anulación automáticamente]
`anular_documento` y `registrar_cai` están marcadas como destructivas: una anulación no se deshace y un CAI
registrado no se quita. Configura tu cliente MCP para que pida confirmación cada vez.
:::

Con datos reales, la base va aparte de la de prueba: `npx -y @factura-hn/mcp init` y después
`npx -y @factura-hn/mcp registrar-cai` con los datos de tu resolución. Ver [Servidor MCP](/ia/mcp/).
