---
title: Ir a producción
description: Lista por rol de lo que hacen el dueño del negocio, el contador y el desarrollador, en orden, desde la demo hasta emitir con el CAI propio.
sidebar:
  order: 0
  label: Lista por rol
---

Esta lista va desde «tengo el SDK funcionando con la demo» hasta «emito con mi CAI». Cada paso dice quién lo hace
y de qué artículo sale. factura-hn no hace ningún trámite ante el SAR: los hace el negocio, que es el responsable
de lo que emite (ver [qué es y qué no es factura-hn](/produccion/estado-legal/)).

Los artículos son del Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas), salvo que se diga
otra cosa. La lista de pasos ante el SAR, con sus fuentes, está en [Trámites ante el SAR](/produccion/tramites/).

:::caution[Por confirmar con fuente]
El repositorio tiene los artículos de cada trámite, pero no el procedimiento actual: qué formulario se usa, por
qué medio de la Oficina Virtual se presenta y cuánto tarda (F-03, pregunta P-03). Tampoco sabe qué modalidad
corresponde a cada negocio según su tamaño o giro: sistema, imprenta o máquina registradora (F-20). Ambas cosas
las confirma tu contador. La consulta formal está en [Consulta al SAR](/produccion/consulta-sar/) y aún no se ha
enviado.
:::

## El orden, de un vistazo

| # | Etapa | Quién | Detalle |
|---|---|---|---|
| 1 | Probar con la demo y decidir el camino (SDK, API o MCP) | Desarrollador | [Empezar](/empezar/) |
| 2 | Revisar con el contador la modalidad, los documentos y la clasificación de cada producto | Dueño y contador | [Contador](#el-contador) |
| 3 | Inscripción y registro como autoimpresor por sistema | Dueño, con el contador | Arts. 45 y 47 |
| 4 | Declaración Jurada del sistema | Dueño, con datos del desarrollador | Art. 53, [ficha del Art. 53](/produccion/ficha-art-53/) |
| 5 | Solicitar el CAI por punto de emisión y tipo de documento | Dueño o contador | Arts. 59 y 61 |
| 6 | Preparar el entorno real y registrar el CAI | Desarrollador | [CAI y rangos](/produccion/cai-y-rangos/) |
| 7 | Emitir la primera factura real y revisarla | Los tres | [Primera factura real](#la-primera-factura-real) |
| 8 | Operar cada mes | Dueño y contador | [Operación mensual](/produccion/operacion-mensual/) |

## El dueño del negocio

1. **Datos del RTN al día** y obligaciones formales y materiales cumplidas (Art. 45 num. 1-2 y Art. 63).
2. **Contrato de adhesión** (Art. 45 num. 3). El correo de ese contrato es el que se imprime en cada documento
   (Art. 10 num. 1 f).
3. **Inscripción en el Régimen de Facturación**, con las modalidades, los documentos, los establecimientos y los
   puntos de emisión (Art. 45 num. 4-5).
4. **Inscripción como autoimpresor por sistema computarizado.** Se registra cada sistema, el software, el
   establecimiento donde está el servidor y los puntos de emisión (Art. 47). Para eso, el desarrollador le
   entrega la [ficha del Art. 53](/produccion/ficha-art-53/).
5. **Declaración Jurada** de que el sistema cumple el Art. 53. La firma el negocio, no el proveedor del software
   (Art. 53).
6. **Solicitud del CAI**: una autorización por punto de emisión y por tipo de documento (Art. 59), y por cada
   sistema (Art. 61). Ver [CAI y rangos](/produccion/cai-y-rangos/).
7. **Papel térmico**, si va a imprimir tickets en ese papel: la certificación del proveedor del papel de que la
   impresión dura al menos 5 años (Art. 38). El trámite exacto está por confirmar (F-08, P-07).
8. **Talonarios de contingencia** de una imprenta, para vender si el sistema no está disponible. Vender sin
   documento se sanciona (Art. 55).
9. **Respaldos**: decidir quién los hace, dónde se guardan y quién prueba la restauración.

## El contador

1. **Modalidad y documentos.** Confirmar que el negocio puede facturar por sistema y qué documentos necesita. Un
   sistema emite Factura (01), Nota de Crédito (06) y Nota de Débito (07). No emite el Recibo por Honorarios (04)
   ni la Factura Prevalorada (10), que son solo de imprenta (Art. 46); ni el Ticket (09), que es solo de máquina
   registradora (Art. 4 num. 43); ni la Constancia de Donación (12), que el Art. 47 excluye.
2. **Tratamiento de ISV de cada producto o servicio**: 15 %, 18 %, exento, exonerado o gravado 0 %. El SDK no trae
   listas de productos; la clasificación la pone el negocio. La tasa del 18 % no tiene texto primario en el
   repositorio (P-11, DEC-069 [REVISAR]); ver [Estado legal](/produccion/estado-legal/).
3. **Clientes especiales**, si los hay: exonerados (Art. 11 num. 4), ventas en moneda extranjera (Art. 11,
   párrafo final), exportaciones (Art. 12, con la reserva de P-09). Ver [Clientes especiales](/guias/clientes-especiales/).
4. **Revisar las interpretaciones pendientes** que afectan al negocio: la lista está en
   [Estado legal](/produccion/estado-legal/#interpretaciones-pendientes).
5. **Revisar la primera factura real** contra los requisitos del Art. 10 y del Art. 11.
6. **Acordar la rutina mensual**: documentos no utilizados (Art. 42), libro de ventas y respaldos. Ver
   [Operación mensual](/produccion/operacion-mensual/).

## El desarrollador

1. **Probar fuera del almacén real.** La demo y las pruebas van en otro almacén: otra base de datos o
   `AlmacenFiscalMemoria`. Un punto de emisión no mezcla documentos de prueba y reales (DEC-063, DEC-091).
2. **Almacén persistente**: `@factura-hn/postgres` o `@factura-hn/sqlite`. `AlmacenFiscalMemoria` pierde todo al
   reiniciar y es solo para pruebas.
3. **Datos del emisor completos.** Los siete datos del Art. 10 num. 1: RTN, razón social, nombre comercial,
   direcciones de casa matriz y del establecimiento, teléfono y correo. Salen del RTN y del contrato de adhesión,
   no del código.
4. **Entregar la ficha del Art. 53** al dueño: versión del software, cómo cumple cada numeral y dónde está el
   servidor. Ver [Ficha del Art. 53](/produccion/ficha-art-53/).
5. **Registrar el CAI** de la resolución, uno por tipo de documento y punto de emisión, sin `prueba: true`. Si ya
   emitió documentos de prueba en ese almacén y el rango real empieza en 1, el registro da
   `RANGO_USADO_EN_PRUEBA`: use una base nueva. Ver [CAI y rangos](/produccion/cai-y-rangos/).
6. **Con la API**:
   - `FHN_DEMO=0` (o quitar la variable);
   - contraseña en Postgres antes del primer arranque y TLS delante de la API si otras cajas la usan;
   - una llave de caja por punto de emisión;
   - la llave admin guardada en un gestor de contraseñas.

   Ver [Autoalojamiento](/guias/autoalojar/).
7. **Respaldos probados**: hacer uno y restaurarlo en una instalación nueva al menos una vez.
8. **Alertas visibles en la caja**: vencimiento del CAI y fin del rango (`estadoAutorizacion(...).alertas`, o los
   webhooks `autorizacion.por_vencer` y `autorizacion.agotada` con la API).
9. **Webhooks verificados**, si se usan: firma sobre el cuerpo crudo y descarte de repetidos por `id`. Ver
   [Webhooks](/guias/webhooks/).

## La primera factura real

Antes de entregarla al cliente, los tres revisan el impreso:

- **No** lleva la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Si la lleva, el CAI registrado es de prueba.
- Lleva el CAI, el rango autorizado y la fecha límite de emisión de la resolución (Art. 10 num. 3-5).
- El número tiene la forma `NNN-NNN-NN-NNNNNNNN`, con el establecimiento, el punto de emisión y el tipo
  correctos, y empieza en el primer número del rango (Art. 10 num. 7).
- Los datos del emisor coinciden con el RTN (Art. 10 num. 1).
- El total cobrado en caja es el `totales.total` impreso. Con precios con ISV incluido puede quedar 1 centavo por
  debajo del precio, por el redondeo del Art. 9 de la Ley del ISV (decisión D-01).

Desde ahí, la rutina está en [Operación mensual](/produccion/operacion-mensual/).
