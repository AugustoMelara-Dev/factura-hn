---
title: Prompts
description: Los prompts de una línea para integrar factura-hn con un asistente de código, por el SDK o por la API, y qué revisar después.
sidebar:
  order: 1
---

Pega uno de estos prompts en Claude Code, Cursor u OpenCode, dentro de tu proyecto. Son los mismos que traen el
README, `AGENTS.md`, `llms.txt` y la skill. Una prueba del repositorio (`packages/core/test/readme.test.ts`)
comprueba que esos cuatro documentos lleven exactamente el mismo texto. Esta página los copia sin cambios.

## SDK

Para un proyecto JavaScript o TypeScript que emite contra su propia base de datos.

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

El agente lee `AGENTS.md` desde `node_modules`, es decir, la copia que corresponde a la versión instalada. Ver
[AGENTS.md](/ia/agents-md/).

## API

Para un proyecto en cualquier lenguaje que emite contra un servidor de factura-hn ya instalado.

```text
Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.
```

Antes de pegarlo, define `FHN_API_URL` y `FHN_LLAVE` en el entorno del servidor. La llave es de **caja**: no
llega al navegador. Ver la [referencia de la API](/referencia/api/).

## Versión detallada del prompt del SDK

Úsala si quieres guiar al agente paso a paso. Es la del README.

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

## Qué revisar después

Revisa el cambio del agente antes de aceptarlo. Cada punto sale de `AGENTS.md`.

- **Un solo camino.** Emite con `emitir` (o la fachada `crearFacturador`) y anula con `anular`. El agente no
  calcula el siguiente número ni guarda el documento en otra transacción.
- **En el servidor.** La emisión corre en el servidor. Las credenciales de la base o la llave de la API no
  llegan al navegador.
- **Almacén persistente.** `AlmacenPostgres` o `AlmacenSQLite`, o uno propio que pase `ejecutarContratoAlmacen`
  de `factura-hn/pruebas`. `AlmacenFiscalMemoria` solo sirve para pruebas: se pierde al reiniciar.
- **CAI desde la base.** Se registra una vez, desde una pantalla o un script, con los datos de la resolución. No
  queda fijo en el código ni se registra en cada solicitud.
- **Total cobrado = total impreso.** La caja cobra `totales.total`, no la suma de los precios. Con precios con
  ISV incluido puede quedar un centavo abajo (Art. 9 de la Ley del ISV). Ver [ISV y montos](/conceptos/isv-y-montos/).
- **Errores tal cual.** La interfaz muestra `ErrorValidacion.errores` (o el 422 de la API) sin reescribirlos.
- **Sin borrar.** No hay un botón que elimine un documento. Hay anulación con motivo obligatorio y nota de
  crédito.
- **Idempotencia en la API.** La `Idempotency-Key` se crea al abrir la venta y se guarda con ella. Es la misma en
  cada reintento.
- **Webhooks.** La firma se verifica sobre el cuerpo crudo, antes de `JSON.parse`.
- **Pruebas.** Una validación fallida no consume número; un CAI vencido o agotado muestra el error; el total
  impreso coincide con lo cobrado.

Para probar sin un CAI real, pide al agente que use `crearFacturadorDemo()` de `factura-hn/demo` en otro
almacén, nunca en el de producción.
