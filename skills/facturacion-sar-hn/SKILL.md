---
name: facturacion-sar-hn
description: Integra facturación SAR Honduras (CAI, rangos, ISV 15%/18%, numeración de 16 dígitos, notas de crédito, impresión de facturas y tickets) en un proyecto JS/TS usando la librería npm factura-hn. Úsala cuando el usuario pida facturar, emitir facturas fiscales, CAI, SAR, ISV o un POS para Honduras.
---

# Facturación SAR Honduras con factura-hn

## Pasos

1. Instala la librería: `npm install factura-hn` (o el gestor del proyecto).
2. Lee `node_modules/factura-hn/AGENTS.md` y `node_modules/factura-hn/docs/persistencia.md` completos.
3. Detecta el stack del proyecto (framework, base de datos, ORM, multi-tenant o no) y pregunta al usuario
   solo lo que no puedas deducir del código.
4. Crea las tablas `autorizaciones_cai` y `documentos_fiscales` con la herramienta de migraciones del proyecto.
5. Implementa `AlmacenCorrelativos` con una reserva **atómica** del siguiente correlativo.
6. Agrega al modelo de producto el campo `tratamientoISV` (`ISV15` | `ISV18` | `EXENTO`), por defecto `ISV15`.
7. Crea el servicio de emisión en el servidor con `crearDocumento`, guardando el `DocumentoFiscal` como JSON.
8. Agrega impresión (`renderizarHTML` carta/ticket o `renderizarTexto` para térmicas), anulación y Nota de Crédito.
9. Muestra `estadoAutorizacion(...).alertas` en la UI del POS.
10. Escribe pruebas: concurrencia de correlativos, validación sin consumo de número, CAI vencido/agotado.

## Reglas

- No inventes requisitos fiscales ni CAI: todo dato de autorización lo carga el usuario desde su resolución del SAR.
- Nunca borres ni reutilices un número emitido; anula o emite nota de crédito.
- Muestra al usuario los mensajes de `ErrorValidacion.errores` sin reinterpretarlos.
- Recuerda al usuario, una vez, que debe estar registrado como autoimpresor ante el SAR y validar con su contador.
