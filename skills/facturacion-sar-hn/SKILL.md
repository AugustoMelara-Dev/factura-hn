---
name: facturacion-sar-hn
description: Integra facturación SAR Honduras (CAI, rangos, ISV 15%/18%, numeración de 16 dígitos, notas de crédito, anulación, impresión de facturas y tickets) en un proyecto JS/TS usando la librería npm factura-hn. Úsala cuando el usuario pida facturar, emitir facturas fiscales, CAI, SAR, ISV o un POS para Honduras.
---

# Facturación SAR Honduras con factura-hn

Dos caminos: el **SDK** (proyecto JS/TS con su propia base) o la **API REST** (otro lenguaje, o un servidor
de factura-hn ya instalado). Si no está claro, pregunta al usuario cuál.

**SDK** (tu proyecto JS/TS emite con su propia base):

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

**API** (cualquier lenguaje; la API de factura-hn emite):

```text
Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.
```

## Pasos con el SDK

1. Instala la librería: `npm install factura-hn` (o el gestor del proyecto) y el almacén que corresponda:
   `@factura-hn/postgres` (con `pg`) o `@factura-hn/sqlite` (con `better-sqlite3` o `node:sqlite`).
2. Lee `node_modules/factura-hn/AGENTS.md` y `node_modules/factura-hn/docs/persistencia.md` completos.
3. Detecta el stack del proyecto (framework, base de datos, multi-tenant o no) y pregunta al usuario solo lo
   que no puedas deducir del código.
4. Crea el almacén (`AlmacenPostgres` + `migrar()`, o `AlmacenSQLite`). Si la base no es Postgres ni SQLite,
   implementa `AlmacenFiscal` y hazlo pasar `ejecutarContratoAlmacen` de `factura-hn/pruebas`.
5. Agrega una pantalla para registrar autorizaciones CAI con `registrarAutorizacion`.
6. Agrega al modelo de producto el campo `tratamientoISV` (`ISV15` | `ISV18` | `EXENTO`), por defecto `ISV15`.
7. Crea el servicio de emisión en el servidor con `emitir`. Es el único camino: no armes la numeración ni
   guardes el documento por tu cuenta.
8. Agrega impresión (`renderizarHTML` carta/ticket o `renderizarTexto` para térmicas), anulación con `anular`
   y Nota de Crédito (06).
9. Muestra `estadoAutorizacion(...).alertas` en la UI del POS.
10. Escribe pruebas: validación sin consumo de número, CAI vencido o agotado, total en caja igual al impreso.

## Pasos con la API

1. Instala `@factura-hn/cliente` (en JS/TS) o genera un cliente desde `/openapi.json` de la API.
2. Lee la sección «Con la API REST» de `node_modules/factura-hn/AGENTS.md` y `docs/api.md`.
3. Emite en el servidor con `crearCliente({ url, llave })` y `fhn.emitir(solicitud, { idempotencyKey })`, con
   una clave estable por venta y una llave de caja que nunca llegue al navegador.
4. Muestra los errores del 422 tal cual; guarda el número y reimprime con `fhn.descargar(numero, 'pdf')`.
5. Si registras webhooks, verifica la firma con `await verificarFirmaWebhook(cuerpo, cabecera, secreto)` sobre el
   cuerpo crudo y descarta repetidos por `id`.

## Reglas

- No inventes requisitos fiscales ni CAI: todo dato de autorización lo carga el usuario desde su resolución del SAR.
- Nunca borres ni reutilices un número emitido; anula con `anular` o emite nota de crédito.
- Muestra al usuario los mensajes de `ErrorValidacion.errores` sin reinterpretarlos.
- Cobra `totales.total`.
- Recuerda al usuario, una vez, que debe estar registrado como autoimpresor ante el SAR y validar con su contador.
