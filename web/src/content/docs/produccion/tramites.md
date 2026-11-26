---
title: Trámites ante el SAR
description: Los pasos que el negocio da ante el SAR para facturar con un sistema, en orden y con su artículo, y lo que el repositorio todavía no puede respaldar.
sidebar:
  order: 1
---

Estos son los pasos que el Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas) pide a un
negocio que factura con un sistema computarizado. Los hace el negocio, normalmente con su contador. factura-hn no
presenta nada ante el SAR.

Cada paso cita su artículo y la línea del texto consolidado («C L.n») con el que trabaja el proyecto. Las fuentes
y cómo se citan están en la [matriz de cumplimiento](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/cumplimiento.md#fuentes-y-c%C3%B3mo-se-citan).

## Antes de emitir

| # | Paso | Fuente |
|---|---|---|
| 1 | Tener actualizados los datos del RTN y estar al día con las obligaciones formales y materiales | Art. 45 num. 1-2, C L.2018-2022; Art. 63, C L.2312-2340 |
| 2 | Suscribir el **contrato de adhesión**. El correo de ese contrato es el que se imprime en los documentos | Art. 45 num. 3, C L.2023; Art. 10 num. 1 f, C L.594-595 |
| 3 | Inscribirse en el **Régimen de Facturación** e indicar las modalidades, los documentos, los establecimientos y los puntos de emisión | Art. 45 num. 4-5, C L.2024-2031 |
| 4 | Inscribirse como **autoimpresor**. Por sistema computarizado: registrar cada sistema, el software, el establecimiento donde está el servidor y los puntos de emisión | Art. 47, C L.2047-2080 |
| 5 | Presentar la **Declaración Jurada** de que el sistema cumple el Art. 53: integración contable o de inventario, seguridad y auditoría, persistencia y exportación a texto | Art. 53, C L.2184-2188 |
| 6 | Solicitar electrónicamente la **autorización de impresión y vigencia** (CAI, rango y fecha límite) por punto de emisión, por tipo de documento y por cada sistema | Arts. 59 y 61, C L.2245-2260, L.2290-2295 |

Para el paso 4 y el 5, el desarrollador le entrega al negocio la [ficha del Art. 53](/produccion/ficha-art-53/).
Para el 6, ver [CAI y rangos](/produccion/cai-y-rangos/).

**Papel térmico.** Si el negocio va a imprimir tickets en papel térmico, el Art. 38 (C L.1879-1889) pide la
certificación del proveedor del papel de que la impresión dura al menos 5 años, y menciona «resúmenes de ventas».

## Mientras emite

| # | Paso | Fuente |
|---|---|---|
| 7 | Renovar la autorización: una sola solicitud por punto hasta agotar, **dentro de los 2 meses previos** a la fecha límite. Vigencia máxima de 1 año | Art. 59, C L.2263-2266; Art. 62, C L.2300-2303 |
| 8 | Si la solicitud se rechaza: presentarse dentro de 10 días hábiles o pedir verificación | Art. 64, C L.2347-2355 |
| 9 | Comunicar los **documentos no utilizados** dentro de los 10 días hábiles del mes siguiente (vencimiento, cambio de datos, cierre, baja de un punto, fallas técnicas, entre otras causales) | Art. 42, C L.1958-1990 |
| 10 | Comunicar el **uso temporal** en ferias, o cuando cambian la dirección o el nombre comercial | Art. 40, C L.1925-1940 |
| 11 | Tener **talonarios preimpresos** de una imprenta para contingencias. Vender sin documento se sanciona | Art. 55, C L.2200-2209 |
| 12 | Papel térmico: certificación del proveedor del papel y resúmenes de ventas | Art. 38, C L.1879-1889 |
| 13 | Custodiar los documentos en orden cronológico durante el plazo del Código Tributario, incluidos los anulados | Arts. 41 y 43, C L.1952-1955, L.1992-1996 |

Los pasos 7, 9 y 13 tienen su rutina en [Operación mensual](/produccion/operacion-mensual/).

## Contingencia: si el sistema no está disponible

El Art. 55 (C L.2200-2209) prevé talonarios preimpresos por una imprenta para cuando el sistema no funciona, y no
permite vender sin documento. Lo que eso significa en la práctica:

- Los talonarios se tienen **antes** de necesitarlos, impresos por una imprenta certificada. El Reglamento regula
  a las imprentas en el Registro Fiscal de Imprentas (Arts. 66-70).
- La contingencia **no justifica retrofechar**. Las ventas hechas con el talonario quedan documentadas en el talonario y no se vuelven a emitir en el sistema. Cuando el sistema vuelve, emite solo las ventas nuevas, con la fecha de hoy. factura-hn no permite una fecha de emisión distinta de la
  de hoy (`FECHA_EMISION_NO_ES_HOY`).
- Si una nota de crédito o débito modifica un documento del talonario, el original no está en el almacén: la nota
  sale con el aviso `AVISO_ORIGINAL_EXTERNO`, y con la API la emite una llave admin
  (es una política de seguridad de la API, no fiscal).

## Lo que hace el proveedor del software

El Reglamento no le asigna obligaciones al proveedor del software: la custodia y la Declaración Jurada son del
negocio (Arts. 41, 43 y 53). En la práctica, el proveedor le da al negocio lo necesario para declarar con verdad:
cómo cumple cada numeral del Art. 53, la versión del software y dónde está el servidor. Es la
[ficha del Art. 53](/produccion/ficha-art-53/).

