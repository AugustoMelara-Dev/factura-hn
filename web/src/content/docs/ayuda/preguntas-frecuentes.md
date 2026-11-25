---
title: Preguntas frecuentes
description: Respuestas cortas a las dudas más comunes sobre factura-hn, cada una con su fuente y el enlace a la página que la explica a fondo.
sidebar:
  order: 1
---

Respuestas cortas. Cada una enlaza a la página que la explica a fondo. Los artículos citados son del Reglamento
del Régimen de Facturación (Acuerdo 481-2017 y sus reformas), salvo que se indique otra norma.

## Sobre el proyecto

### ¿factura-hn es oficial?

No. Es un proyecto independiente de código abierto, no afiliado al SAR. Genera documentos con los requisitos de
formato y cálculo del Reglamento, pero no sustituye tu inscripción como autoimpresor ni la revisión de un
contador. Ver [Normativa](/referencia/normativa/).

### ¿Cuánto cuesta?

Nada. El SDK, los almacenes, el PDF, el modo local de la API, el cliente, el MCP y la documentación son gratis y
de código abierto (licencia MIT). El proyecto no pone ninguna función fiscal detrás de un pago.

El modo alojado de la API (varios negocios en un servidor) existe en el código, pero no se ofrece como servicio
mientras no esté claro cómo encaja con el Art. 47. Ver [¿Puedo usarlo en la nube?](#puedo-usarlo-en-la-nube)

### ¿Es factura electrónica?

Depende de qué se entienda por eso. factura-hn implementa el régimen vigente de **CAI, rango autorizado y fecha
límite**, con el negocio como autoimpresor por sistema computarizado (Arts. 47, 53 y 59-62). El documento se
genera en tu sistema y no se transmite al SAR.

El Reglamento define además un **CAEE**, un código por documento que se obtiene interactuando con el SAR (Art. 4
num. 9 y Art. 54). Prevé un calendario y una documentación técnica (Arts. 57 y 58), pero el proyecto no encontró
ninguna publicación oficial. factura-hn no implementa el CAEE. Ver [Normativa](/referencia/normativa/).

:::caution[Por confirmar con fuente]
Calendario y especificación técnica de la emisión electrónica (Arts. 57-58): no se encontraron publicados.
:::

### ¿El proveedor del software tiene que estar registrado o certificado?

El Reglamento solo regula un registro de proveedores: el Registro Fiscal de Imprentas (Arts. 66-70), que aplica
a quien imprime formularios, no a un software. El proyecto no encontró un registro de proveedores de sistemas.
Eso no prueba que no exista. La Declaración Jurada del sistema la firma el negocio (Art. 53).

:::caution[Por confirmar con fuente]
Si existe un registro, homologación o certificación de proveedores de software: no se encontró en el Reglamento.
Confírmalo con tu contador.
:::

## Antes de facturar

### ¿Necesito inscribirme ante el SAR?

Sí. Para emitir con un sistema, el negocio:

1. se inscribe en el Régimen de Facturación (Art. 45);
2. se inscribe como autoimpresor por sistema computarizado, con el sistema, el software, el establecimiento donde
   está el servidor y los puntos de emisión (Art. 47);
3. presenta la Declaración Jurada de que el sistema cumple el Art. 53;
4. solicita la autorización (CAI, rango y fecha límite) por punto de emisión y por tipo de documento (Arts. 59 y
   61).

Ver [Pasos ante la autoridad tributaria](/produccion/tramites/).

:::caution[Por confirmar con fuente]
Formularios, medio y plazos de la inscripción y de la Declaración Jurada. Confírmalos con tu contador.
:::

### ¿Puedo probar sin un CAI real?

Sí. Los tres caminos empiezan en modo de prueba, con un CAI ficticio (`DEMO00-NO-VALIDO-…`) y un emisor
ficticio. Todo impreso dice «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Ver
[Tu primera factura](/empezar/primera-factura/) y el [playground](/empezar/playground/), que corre en el navegador.

### ¿Puedo usar mi CAI?

Sí, el de **tu** resolución del SAR. Se registra una vez por tipo de documento y punto de emisión:
`registrarAutorizacion` en el SDK, `POST /v1/autorizaciones` en la API o `registrar-cai` en el MCP.

Si ya emitiste documentos con ese CAI (en talonario o en otro sistema), indica el último número usado
(`ultimoEmitidoAntes`): la serie sigue en el siguiente. Sin ese dato, empieza en el rango inicial y esos números
se repetirían. Este campo es una lectura del proyecto: el Reglamento no regula la migración de una serie. Ver
[CAI y rangos](/produccion/cai-y-rangos/).

:::caution[Por confirmar con fuente]
La autorización se otorga por sistema y por tipo de documento (Art. 61). El repositorio no tiene fuente sobre si
un CAI solicitado para otro sistema o para talonarios de imprenta puede seguir usándose al cambiar a factura-hn.
Confírmalo con tu contador o con el SAR antes de registrarlo.
:::

### ¿Necesito internet?

No para emitir con el SDK: la librería y el almacén corren en tu equipo. El ejemplo
[POS fuera de línea](/guias/fuera-de-linea/) emite con SQLite sin conexión y sincroniza cuando vuelve.

Sí hace falta para instalar (`npm install`) y la primera vez que corres `npx` (el MCP o la CLI), porque descarga el
paquete. Con la API instalada en el local del negocio, las cajas necesitan llegar a ese servidor por la red
local.

### ¿Puedo usarlo en la nube?

El modo recomendado es el **local**: la API o el SDK en un equipo del negocio, en su establecimiento. El Art. 47
pide registrar «el establecimiento donde se encuentre el servidor», y un servidor en la nube de un tercero no
encaja literalmente en esa definición. Ver [Autoalojamiento](/guias/autoalojar/).

:::caution[Por confirmar con fuente]
Si un sistema alojado en la nube por un tercero cumple el Art. 47 y qué establecimiento se declara: el Reglamento
no lo dice de forma literal. Confírmalo con tu contador.
:::

### ¿Qué productos van al 18 % o son exentos?

Lo decide el negocio con su contador: la librería no trae listas de productos. Cada línea lleva su tratamiento
(`ISV15`, `ISV18`, `GRAVADO0` o `EXENTO`). Ver [ISV y montos](/conceptos/isv-y-montos/).

:::caution[Por confirmar con fuente]
La tasa del 18 % viene del Decreto 278-2013, Art. 16, que el proyecto no tiene en texto primario. El repositorio tampoco tiene la lista de bienes exentos.
:::

## Al emitir

### ¿Por qué el total bajó un centavo?

Con precios que ya incluyen el ISV, el total puede quedar un centavo abajo para cumplir el redondeo del Art. 9 de
la Ley del ISV: una fracción menor a medio centavo debe bajarse. El documento trae el aviso
`AVISO_AJUSTE_CENTAVO` y el monto en `totales.ajustePorRedondeo`. Cobra `totales.total`. Para evitarlo, ajusta el
precio con `sugerirPrecioSinAjuste`. Ver [ISV y montos](/conceptos/isv-y-montos/).

### ¿Puedo emitir tickets o recibos por honorarios?

No desde un sistema computarizado. El Ticket (09) se emite solo por máquinas registradoras (Art. 4 num. 43). El
Recibo por Honorarios Profesionales (04) y la Factura Prevalorada (10) solo por imprenta (Art. 46). La Constancia
de Donación (12) está excluida del autoimpresor (Art. 47). La librería responde `TIPO_NO_EMITIBLE`. A un
consumidor final, el sistema le emite Factura. Ver [Documentos no emitibles](/documentos/no-emitibles/).

### ¿Puedo cambiar la fecha de una factura?

No. La fecha de emisión la pone el reloj en hora de Honduras: no se puede retrofechar ni adelantar
(`FECHA_EMISION_NO_ES_HOY`). Es una decisión de factura-hn que se apoya en el momento de emisión (Art. 14) y en el archivo
en orden cronológico (Art. 43). Si el reloj del equipo está mal, ver [Reloj](/guias/reloj/).

### ¿Qué pasa si se va la luz a mitad de una venta?

Depende de en qué momento:

- **Antes de que termine la emisión.** La emisión es una sola transacción: valida, toma el número y guarda el
  documento, todo o nada. Si no se completa, no se consume el número. Vuelve a emitir.
- **Después de emitir, antes de imprimir.** El documento ya está guardado. Reimprímelo desde lo guardado
  (`buscarDocumento`): la copia es idéntica al original.
- **Si el sistema no está disponible por un tiempo.** El negocio debe tener talonarios preimpresos de una imprenta
  certificada para contingencias. Vender sin documento se sanciona (Art. 55). Un corte no justifica emitir
  después con otra fecha.

Esto requiere un almacén que guarde en disco (SQLite o Postgres). `AlmacenFiscalMemoria` pierde todo al
reiniciar: es solo para pruebas. Ver [Almacén fiscal](/conceptos/almacen/) y
[Contingencia](/produccion/tramites/#contingencia-si-el-sistema-no-está-disponible).

### Un cliente exonerado trae una Orden de Compra Exenta que no cubre todo. ¿Qué hago?

Emite dos facturas: una con `exoneracion` y los artículos cubiertos por la OCE, y otra normal con el resto. La
exoneración aplica al documento completo: es una decisión del proyecto, porque el Reglamento no regula
una exoneración parcial. Los documentos que acreditan la exoneración son los del Art. 11 num. 4. Ver
[Exonerado](/conceptos/isv-y-montos/#exonerado).

## Correcciones

### ¿Por qué no puedo borrar una factura?

Porque el Reglamento pide conservarla. Un documento con errores lleva la leyenda «ANULADA» y se resguardan el
original y la copia (Art. 41), en orden cronológico (Art. 43). El número sigue consumido. Para corregir:

- anula el documento con `anular`, con motivo obligatorio;
- o emite una Nota de Crédito (06) o de Débito (07) que lo referencie.

Ver [Documentos inmutables](/conceptos/inmutables/).

### ¿Cómo hago una nota sobre una factura en dólares?

La nota se emite en lempiras (Arts. 26 num. 9 y 28 num. 8). Escribe sus líneas en dólares: se
convierten con el tipo de cambio de la factura original, que la nota imprime como referencia. Ver
[Nota de Crédito](/documentos/nota-credito/).

## Datos y reportes

### ¿Por qué la factura de prueba no sale en el libro de ventas?

Porque no tiene valor fiscal. `libroVentas` y `exportarTexto` dejan fuera los documentos de prueba, y el libro
dice cuántos quedaron fuera (`excluidos`). La leyenda de prueba es una marca del
producto, no una regla fiscal. Para probar, usa otro almacén: un punto de emisión no mezcla documentos
de prueba y reales. Ver [Reportes](/guias/reportes/).

### ¿Cuánto tiempo guardo los documentos?

El Reglamento remite al plazo de prescripción del Código Tributario (Arts. 5, 41 y 43). Según la compilación de
2024 del Código Tributario, son 5 años para los inscritos en el RTN, contados desde la presentación de la
declaración (Código Tributario, Arts. 58 num. 4, 63 num. 3, 144 y 145). La política del proyecto es no borrar
nunca de forma automática. Ver [Operación mensual](/produccion/operacion-mensual/).

:::caution[Por confirmar con fuente]
La cita sale de una compilación del Código Tributario, no de La Gaceta. Falta confirmar que no hubo reformas
posteriores.
:::

### Al instalar con pnpm aparece «Agent skills awaiting approval: factura-hn (tarball)». ¿Qué es?

Se refiere a la carpeta `skills/` que trae el paquete: la [skill para Claude](/ia/skill/). La librería funciona
igual sin aprobarla.
