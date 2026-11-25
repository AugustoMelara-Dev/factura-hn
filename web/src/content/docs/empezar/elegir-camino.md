---
title: Elegir camino
description: SDK, API REST o servidor MCP — para quién es cada uno, dónde se guardan los documentos y cómo se comporta sin internet o con varias cajas.
sidebar:
  order: 2
---

factura-hn tiene tres formas de uso. Las tres aplican las mismas reglas: la API y el MCP llaman por dentro al
mismo SDK. Cambia quién guarda los documentos y desde dónde se emite.

| | SDK | API REST | Servidor MCP |
|---|---|---|---|
| **Para quién** | Proyectos JavaScript o TypeScript | Cualquier lenguaje, o varias cajas contra un servidor | Un asistente de IA que emite, consulta y anula |
| **Qué instalas** | `npm install factura-hn` (Node 20+) | Docker con PostgreSQL | `npx -y @factura-hn/mcp` (Node 22.13+) |
| **Dónde se guardan los documentos** | En tu base: PostgreSQL, SQLite u otra con su propio almacén | En el PostgreSQL de la API | En un archivo SQLite del equipo, o en la API |
| **Sin internet** | Sí, con SQLite en la caja | Las cajas necesitan red hasta el servidor de la API | En modo SQLite el servidor no necesita red después de descargarse; el asistente, según el cliente que uses |
| **Varias cajas** | Sí: un PostgreSQL compartido, o un punto de emisión por caja | Sí: una llave de caja por punto de emisión | Un punto de emisión por servidor |
| **Empieza en** | [Primera factura: SDK](/empezar/primera-factura/#sdk-node-20-o-más-reciente) | [Primera factura: API](/empezar/primera-factura/#api-rest-docker) | [Primera factura: MCP](/empezar/primera-factura/#mcp-claude-desktop-claude-code-cursor) |

Si solo quieres ver cómo sale una factura, el [playground](/empezar/playground/) corre el SDK en tu navegador,
sin instalar nada y con CAI ficticios.

## Cómo decidir

1. **¿Quien va a emitir es un asistente de IA (Claude, Cursor) y no tu código?** Usa el MCP. Si tu código
   también emite, el MCP puede ir contra la misma API.
2. **¿Tu sistema está en JavaScript o TypeScript y tiene su propia base?** Usa el SDK. Los documentos quedan en
   tu base, en la misma transacción que el resto de tu venta si lo necesitas.
3. **¿Tu sistema está en otro lenguaje, o varias cajas deben compartir un servidor?** Usa la API.

## SDK

El SDK emite dentro de tu proceso, sobre un [almacén fiscal](/conceptos/almacen/) que tú eliges:

- `@factura-hn/postgres` para un servidor con varias cajas;
- `@factura-hn/sqlite` para una caja que trabaja sin internet (Node 20+ con `better-sqlite3`; Node 22.13+ con
  `node:sqlite`), cada una con su propio punto de
  emisión;
- tu propia base, implementando la interfaz `AlmacenFiscal` y pasando su batería de pruebas.

Con SQLite cada caja guarda sus documentos en un archivo local. Dos cajas no comparten una serie sin un almacén
común: por eso cada una lleva su propio punto de emisión y su propio CAI. El ejemplo
[`pos-offline`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/pos-offline) muestra un POS
así, con una cola para sincronizar después.

## API REST

La API (Hono, OpenAPI 3.1 y PostgreSQL) emite por ti: tu sistema envía la venta por HTTP y recibe el documento,
el PDF, el HTML o el texto. Cada caja usa una llave atada a su punto de emisión, y la emisión exige una
`Idempotency-Key` para que un reintento no duplique la factura. Desde TypeScript hay un cliente tipado,
`@factura-hn/cliente`; desde otro lenguaje, el cliente se genera del `openapi.json`.

Tiene dos modos:

- **local** (por defecto): un negocio con su propio servidor y su base en el establecimiento;
- **alojado**: un operador que sirve a varios negocios, aislados entre sí.

:::caution[Por confirmar con fuente]
El encaje del modo alojado con el Art. 47 del Reglamento («el establecimiento donde se encuentre el servidor»)
está pendiente: es la pregunta P-02, que aún no tiene respuesta. Mientras tanto, la recomendación es el
modo local. Ver la [consulta al SAR](/produccion/consulta-sar/).
:::

Detalle en la [referencia de la API](/referencia/api/) y en [Autoalojar](/guias/autoalojar/).

## Servidor MCP

El MCP es para **operar** la facturación con un asistente: emitir, consultar, anular, revisar el CAI y el libro
de ventas. No es para integrar factura-hn en tu código; para eso, ver
[Emitir con un asistente](/empezar/con-ia/).

Tiene dos modos:

- **SQLite**: el servidor emite en este equipo, sobre un archivo, en un punto de emisión (por defecto
  `000-001`);
- **API**: el servidor llama a una API de factura-hn con una llave. Con una llave de caja, el asistente emite y
  consulta, pero no anula ni registra un CAI.

Ver [Servidor MCP](/ia/mcp/).

## Si cambias de camino

Los tres caminos comparten las reglas, pero no los datos: cada almacén lleva sus propias series. Una serie vive
en un solo almacén; si pasas de un camino a otro, haz que cada punto de emisión siga emitiendo en un solo lugar.
Ver [Almacén fiscal](/conceptos/almacen/#una-serie-un-almacén).
