---
title: Errores frecuentes
description: Los 10 errores más probables en la primera semana con factura-hn, con su causa, su solución y el enlace a su entrada en la referencia.
sidebar:
  order: 2
---

Los errores que más aparecen al empezar, con lo que hay que hacer. Cada uno enlaza a su entrada en la
[referencia de errores](/referencia/errores/), que tiene el catálogo completo.

Un intento fallido no consume número: la emisión es una transacción que se revierte entera. Corrige y vuelve a
emitir.

## Cómo leer un error

El SDK lanza `ErrorValidacion` con una lista de problemas. Cada uno trae `codigo`, `mensaje`, `campo` y, en los
del SDK, `solucion` y `documentacion` (el enlace a su explicación). Compara siempre el `codigo`, nunca el texto,
y muestra el mensaje tal cual a quien opera.

<!-- declaraciones:
import type { AlmacenFiscal, DocumentoEntrada } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const entrada: DocumentoEntrada;
-->
```ts
import { emitir, esErrorValidacion } from 'factura-hn';

try {
  await emitir(entrada, { almacen, establecimiento: '000', puntoEmision: '001' });
} catch (e) {
  if (!esErrorValidacion(e)) throw e;
  for (const p of e.errores) console.error(`[${p.codigo}] ${p.mensaje} ${p.solucion ?? ''}`);
}
```

En la API, un error fiscal llega como `422 VALIDACION`, con los mismos códigos en `errores`. Los códigos que
empiezan por `AVISO_` no bloquean: el documento se emite y el aviso queda en `documento.advertencias`.

## 1. `SIN_AUTORIZACION`

- **Síntoma:** la primera emisión, o la primera nota de crédito, falla.
- **Causa:** no hay un CAI registrado para esa serie: establecimiento, punto de emisión y tipo. Cada tipo tiene su
  propio CAI, así que la primera nota de crédito necesita uno de tipo `06`.
- **Solución:** registra el CAI de la resolución con `registrarAutorizacion` (o `registrar-cai` en el MCP). Para
  probar sin uno real, usa `crearFacturadorDemo()` de `factura-hn/demo`.
- **Base:** Arts. 59-61, autorización por punto de emisión y tipo.
- [Ver en la referencia](/referencia/errores/#sin_autorizacion)

## 2. `AUTORIZACION_VENCIDA` y `RANGO_AGOTADO`

- **Síntoma:** una caja que emitía deja de hacerlo.
- **Causa:** pasó la fecha límite de emisión del CAI, o se usaron todos los números del rango.
- **Solución:** solicita al SAR una nueva autorización y regístrala; la numeración continúa sola. Para que no te
  tome por sorpresa, muestra en la caja las alertas de `estadoAutorizacion`: avisa en los dos meses previos a la
  fecha límite (`AVISO_VENCIMIENTO`) y al llegar al 90 % del rango (`AVISO_RANGO`).
- **Base:** Art. 62 (vigencia) y Art. 59 (solicitud de una nueva).
- Ver en la referencia: [AUTORIZACION_VENCIDA](/referencia/errores/#autorizacion_vencida) ·
  [RANGO_AGOTADO](/referencia/errores/#rango_agotado)

## 3. `AUTORIZACION_MODO_MEZCLADO`

- **Síntoma:** al registrar un CAI de prueba, el registro falla.
- **Causa:** ese punto de emisión ya tiene o tuvo un CAI real. Un punto pasa de prueba a real, nunca al revés.
- **Solución:** prueba en otro almacén (otra base de datos, o `AlmacenFiscalMemoria`). No uses otro punto de
  emisión del almacén real.
- **Base:** ninguna fiscal: protege la numeración real de los documentos de prueba.
- [Ver en la referencia](/referencia/errores/#autorizacion_modo_mezclado)

## 4. `EMISOR_*`

- **Síntoma:** la emisión falla por un dato del negocio, por ejemplo `EMISOR_RTN` o `EMISOR_CORREO`.
- **Causa:** falta uno de los siete datos del emisor o tiene un formato inválido. Los más comunes: un RTN que no
  tiene 14 dígitos o un correo sin la forma `nombre@dominio`.
- **Solución:** completa en la configuración del negocio el RTN, la razón social, el nombre comercial, las
  direcciones de casa matriz y del establecimiento, el teléfono y el correo del contrato de adhesión. En el MCP,
  revisa `emisor.json`: el log del cliente muestra un error por campo.
- **Base:** Art. 10 num. 1.
- Ver en la referencia: [EMISOR_RTN](/referencia/errores/#emisor_rtn) ·
  [EMISOR_CORREO](/referencia/errores/#emisor_correo) · [EMISOR](/referencia/errores/#emisor)

## 5. `CONSUMIDOR_FINAL_IDENTIFICACION`

- **Síntoma:** una venta grande sin cliente no se emite.
- **Causa:** una venta a consumidor final supera L 10,000 sin el nombre y la identificación del cliente.
- **Solución:** pide al cliente su nombre y su DNI
  (`cliente: { nombre, identificacion: { tipo: 'DNI', numero } }`), o su RTN.
- **Base:** Art. 11, párrafo final.
- [Ver en la referencia](/referencia/errores/#consumidor_final_identificacion)

## 6. `FECHA_EMISION_NO_ES_HOY`

- **Síntoma:** la emisión falla al enviar una fecha.
- **Causa:** se envió `fechaEmision` con un día distinto de hoy en Honduras.
- **Solución:** no envíes `fechaEmision`: la pone el reloj. Si la fecha de hoy está mal, corrige el reloj del
  equipo.
- **Base:** Arts. 14 y 43; decisión DEC-022.
- [Ver en la referencia](/referencia/errores/#fecha_emision_no_es_hoy)

## 7. `RELOJ_ADELANTADO_SOSPECHOSO` y `FECHA_ANTERIOR_AL_ULTIMO`

- **Síntoma:** la caja no emite después de unos días cerrada, o después de corregir el reloj.
- **Causa:** `RELOJ_ADELANTADO_SOSPECHOSO`: la fecha de hoy está más de 7 días después de la última emisión de la
  serie. `FECHA_ANTERIOR_AL_ULTIMO`: el último documento válido tiene una fecha posterior a hoy.
- **Solución:** en el primer caso, revisa el reloj; si la fecha es correcta, reintenta con
  `confirmarSaltoDeFecha: true` (queda en la bitácora). En el segundo, corrige el reloj si está atrasado; si un
  documento anterior salió con fecha futura, un supervisor corre `corregirFechaAdelantada`.
- **Base:** Arts. 41 y 43, archivo en orden cronológico.
- Ver en la referencia:
  [RELOJ_ADELANTADO_SOSPECHOSO](/referencia/errores/#reloj_adelantado_sospechoso) ·
  [FECHA_ANTERIOR_AL_ULTIMO](/referencia/errores/#fecha_anterior_al_ultimo). Guía: [Reloj](/guias/reloj/).

## 8. `NOTA_CLIENTE_RTN`

- **Síntoma:** la nota de crédito sobre una venta a consumidor final no se emite.
- **Causa:** el núcleo pide el nombre y el RTN del adquirente en toda nota, sin la opción de CONSUMIDOR FINAL
  (Arts. 26 y 28 num. 1-2).
- **Solución:** indica `cliente: { nombre, rtn }`. Si el original no tiene RTN, pídeselo al cliente. Si el
  original tiene RTN, la nota debe llevar el mismo (`REFERENCIA_RTN_NO_COINCIDE`).
- **Base:** Arts. 26 y 28 num. 1-2.
- [Ver en la referencia](/referencia/errores/#nota_cliente_rtn)

:::note[Interpretación pendiente]
Aceptar una nota con RTN sobre un original emitido sin RTN es una lectura de los Arts. 26 y 28 que espera revisión
(DEC-079 [REVISAR]). La nota sale con el aviso `AVISO_ORIGINAL_SIN_RTN`. Ver [Decisiones](/referencia/decisiones/).
:::

## 9. `TIPO_NO_EMITIBLE`

- **Síntoma:** se intenta emitir un ticket o un recibo por honorarios.
- **Causa:** el Ticket (09), el Recibo por Honorarios (04), la Factura Prevalorada (10) y la Constancia de
  Donación (12) no se emiten por un sistema computarizado.
- **Solución:** a un consumidor final, emite Factura (01). Los demás se emiten por la vía que fija el Reglamento:
  máquina registradora para el ticket, imprenta para los otros.
- **Base:** Art. 4 num. 43 y Art. 17 (ticket), Art. 46 (honorarios y prevalorada), Art. 47 (donación).
- [Ver en la referencia](/referencia/errores/#tipo_no_emitible). Guía:
  [Documentos no emitibles](/documentos/no-emitibles/).

## 10. `IDEMPOTENCY_KEY` e `IDEMPOTENCIA_CONFLICTO` (API y MCP)

- **Síntoma:** la API responde 400 al emitir, o 422 con una venta nueva.
- **Causa:** `IDEMPOTENCY_KEY`: falta la cabecera `Idempotency-Key`. `IDEMPOTENCIA_CONFLICTO`: esa clave ya se usó
  con otra venta.
- **Solución:** crea una clave al abrir cada venta (por ejemplo, el id del pedido), guárdala con ella y repítela
  en cada reintento. Una venta nueva lleva una clave nueva.
- **Base:** ninguna fiscal: evita emitir dos veces la misma venta.
- Ver en la referencia: [IDEMPOTENCY_KEY](/referencia/errores/#idempotency_key) ·
  [IDEMPOTENCIA_CONFLICTO](/referencia/errores/#idempotencia_conflicto)

## Otros que conviene conocer

- `ALMACEN_REQUERIDO`: falta pasar un almacén. Créalo una vez al arrancar.
  [Ver](/referencia/errores/#almacen_requerido)
- `NO_AUTENTICADO` y `SOLO_ADMIN` (API): falta la llave, o la operación pide una llave admin (registrar un CAI,
  anular). [Ver](/referencia/errores/#solo_admin)
- `AVISO_VENTA_MIXTA`: no bloquea. Una venta con partes exentas y gravadas a un cliente con RTN: el crédito fiscal
  solo reconoce lo gravado (Art. 11 num. 3). [Ver](/referencia/errores/#aviso_venta_mixta)
