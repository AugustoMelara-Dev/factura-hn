---
title: Cómo funciona
description: El modelo de la facturación por sistema en Honduras — CAI, rango autorizado, establecimiento, punto de emisión, tipo de documento, número de 16 dígitos y fecha límite de emisión.
sidebar:
  order: 1
---

Un negocio que factura desde un sistema computarizado (la modalidad de autoimpresor, Art. 47 del Reglamento
del Régimen de Facturación, Acuerdo 481-2017) no inventa sus números. La autoridad tributaria le autoriza un
**rango** de números para cada caja y tipo de documento, con un código, el **CAI**, y una **fecha límite**.
El sistema emite dentro de ese rango, en orden, hasta agotarlo o hasta la fecha límite.

Las citas de esta página son del Reglamento, salvo que se diga otra cosa. La tabla completa está en
[Normativa](/referencia/normativa/).

## Las piezas

| Pieza | Qué es | En el SDK |
|---|---|---|
| **CAI** | El código de la autorización. El Art. 4 num. 7 lo define como «una serie alfanumérica generada electrónicamente»; no se publica su longitud ni su formato | `AutorizacionCAI.cai` |
| **Rango autorizado** | Los números que la autorización permite usar, del inicial al final (Art. 10 num. 3-5) | `rangoInicial`, `rangoFinal` |
| **Fecha límite de emisión** | El último día en que se puede emitir con esa autorización (Art. 10 num. 3-5). La vigencia máxima es de un año (Art. 62) | `fechaLimiteEmision` |
| **Establecimiento** | El local del negocio. La casa matriz es el `000` | `establecimiento` |
| **Punto de emisión** | La caja, el dispositivo o el sistema que emite dentro de un establecimiento | `puntoEmision` |
| **Tipo de documento** | Factura, nota de crédito, nota de débito… cada uno con su código de dos dígitos | `tipoDocumento` |

El CAI, el rango y la fecha límite se imprimen en cada documento (Art. 10 num. 3-5). Ver [CAI](/conceptos/cai/).

## El número de 16 dígitos

Cada documento lleva un número con la forma `NNN-NNN-NN-NNNNNNNN` (Art. 10 num. 7):

```text
000 - 001 - 01 - 00000001
 │     │    │       └─ correlativo (8 dígitos)
 │     │    └─ tipo de documento (01 = Factura)
 │     └─ punto de emisión
 └─ establecimiento
```

Los tres primeros grupos forman el **identificador** del documento (`000-001-01`). Cada identificador es una
**serie**: lleva su propia numeración, sin huecos ni repetidos.

```js
import { formatearNumero, parsearNumero } from 'factura-hn';

parsearNumero('000-001-01-00000001');
// { establecimiento: '000', puntoEmision: '001', tipoDocumento: '01', correlativo: 1 }

formatearNumero({ establecimiento: '000', puntoEmision: '002', tipoDocumento: '06', correlativo: 15 });
// "000-002-06-00000015"
```

El Art. 10 num. 7 dice que la serie se reinicia después del `99999999`. El SDK no modela ese reinicio: rechaza
un rango que lo cruce (decisión D-07 de la investigación normativa).

## Una autorización por punto de emisión y tipo

La autorización se otorga **por punto de emisión y por tipo de documento**, con su rango (Art. 59). Por eso:

- la factura (01) y la nota de crédito (06) de una misma caja tienen cada una su CAI y su serie;
- dos cajas tienen series distintas, aunque estén en el mismo local.

Con el tiempo, un identificador acumula autorizaciones: cuando la autoridad otorga un rango nuevo, se registra y
la numeración **continúa** de una a otra. La serie no se lleva por CAI, sino por identificador. El SDK rechaza
un rango que comparte números con otro de la misma serie
([`RANGO_SOLAPADO`](/referencia/errores/#rango_solapado)).

La nueva autorización se solicita dentro de los dos meses previos a la fecha límite (Art. 59).
`estadoAutorizacion` avisa desde entonces; ver [CAI](/conceptos/cai/#alertas).

## Qué documentos emite

| Código | Documento | Por sistema |
|---|---|---|
| `01` | Factura | Sí |
| `06` | Nota de Crédito | Sí |
| `07` | Nota de Débito | Sí |
| `05`, `08`, `11` | Comprobante de Retención, Guía de Remisión, Boleta de Compra | Se pueden emitir por sistema, pero el SDK aún no los soporta |
| `04`, `09`, `10`, `12` | Recibo por Honorarios, Ticket, Factura Prevalorada, Constancia de Donación | No: el Reglamento los reserva a otras modalidades (Arts. 4 num. 43, 46 y 47) |

Los códigos son los vigentes tras la reforma del Acuerdo 609-2017. El SDK reconoce todos al leer números y
referencias, pero `emitir` rechaza los no emitibles con [`TIPO_NO_EMITIBLE`](/referencia/errores/#tipo_no_emitible).

## El ciclo de un documento

1. **Registrar la autorización**, una vez por resolución: `registrarAutorizacion`.
2. **Emitir** en cada venta: `emitir` bloquea la serie, elige la autorización vigente que cubre el siguiente
   número, valida, construye y guarda el documento, todo en una transacción. Si algo falla, el número no se
   consume.
3. **Imprimir** desde el documento guardado: `renderizarHTML`, `renderizarTexto` o `@factura-hn/pdf`. Una
   reimpresión desde el documento guardado es idéntica al original (el Art. 38 lo exige para el papel
   térmico).
4. **Corregir** sin editar: anular el documento (Art. 41) o emitir una nota de crédito o de débito. Ver
   [Documentos inmutables](/conceptos/inmutables/).

`emitir` bloquea con un error si la fecha límite ya pasó
([`AUTORIZACION_VENCIDA`](/referencia/errores/#autorizacion_vencida)) o si se agotó el rango
([`RANGO_AGOTADO`](/referencia/errores/#rango_agotado)).

## Dónde se guarda todo

Las autorizaciones, los documentos y la bitácora viven en un [almacén fiscal](/conceptos/almacen/). La fecha de
cada documento la pone el reloj, en hora de Honduras: ver [Reloj y fechas](/conceptos/reloj-y-fechas/).

Las funciones citadas en esta página están en la [referencia del SDK](/referencia/sdk/).
