---
title: Trámites ante el SAR
description: Los pasos que el negocio da ante el SAR para facturar con un sistema, en orden y con su artículo, y lo que el repositorio todavía no puede respaldar.
sidebar:
  order: 1
---

Estos son los pasos que el Reglamento del Régimen de Facturación (Acuerdo 481-2017 y sus reformas) pide a un
negocio que factura con un sistema computarizado. Los hace el negocio, normalmente con su contador. factura-hn no
presenta nada ante el SAR.

Cada paso cita su artículo y la línea del texto consolidado («C L.n») con el que trabaja el proyecto. La fuente es
la sección 3a de la investigación normativa del repositorio (ver [Normativa](/referencia/normativa/)).

:::caution[Por confirmar con fuente]
Esta página tiene los artículos, no el procedimiento. Falta lo siguiente:

- **Formularios, medio y plazos** de la inscripción como autoimpresor y de la Declaración Jurada del Art. 53: qué
  pantalla de la Oficina Virtual, qué anexos y cuánto tarda (F-03, pregunta P-03).
- **Qué modalidad corresponde a cada negocio** según su tamaño o giro: sistema, imprenta o máquina registradora
  (F-20). Los Arts. 46, 47 y 52 mencionan las modalidades, pero el repositorio no dice cuál le toca a cada uno.
- **Registro de proveedores de software**: el repositorio no encontró uno en el Reglamento, lo que no prueba que no
  exista (F-04, pregunta P-01).

Las preguntas están redactadas en [Consulta al SAR](/produccion/consulta-sar/). Aún no se ha enviado.
:::

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

:::caution[Por confirmar con fuente]
No se sabe si la certificación del papel térmico la gestiona y presenta el negocio, ni qué son los «resúmenes de
ventas» del Art. 38, en qué formato ni en qué plazo se entregan (F-08, pregunta P-07). Ver
[Consulta al SAR](/produccion/consulta-sar/).
:::

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

:::caution[Por confirmar con fuente]
El formato del aviso de no utilizados (paso 9) no está publicado en las fuentes del repositorio (F-06, pregunta
P-04). factura-hn calcula los rangos y la fecha límite, pero el aviso se hace en el sistema del SAR. Ver
[Consulta al SAR](/produccion/consulta-sar/).
:::

## Contingencia: si el sistema no está disponible

El Art. 55 (C L.2200-2209) prevé talonarios preimpresos por una imprenta para cuando el sistema no funciona, y no
permite vender sin documento. Lo que eso significa en la práctica:

- Los talonarios se tienen **antes** de necesitarlos, impresos por una imprenta certificada. El Reglamento regula
  a las imprentas en el Registro Fiscal de Imprentas (Arts. 66-70).
- La contingencia **no justifica retrofechar**. Cuando el sistema vuelve, emite con la fecha de hoy; no se
  «pasan» al sistema las ventas del talonario con su fecha original. factura-hn no permite una fecha de emisión
  distinta de la de hoy (`FECHA_EMISION_NO_ES_HOY`, DEC-022).
- Si una nota de crédito o débito modifica un documento del talonario, el original no está en el almacén: la nota
  sale con el aviso `AVISO_ORIGINAL_EXTERNO` (DEC-004), y con la API la emite una llave admin (DEC-051).

:::caution[Por confirmar con fuente]
Las sanciones concretas por vender sin documento (montos y tipos de falta) están en el Código Tributario, que el
repositorio no ha analizado para este fin (F-22). Tampoco está la fuente de la declaración mensual (formulario,
nombre y campos) ni su relación con el libro de ventas (F-21). Confírmalo con tu contador.
:::

## Lo que hace el proveedor del software

El Reglamento no le asigna obligaciones al proveedor del software: la custodia y la Declaración Jurada son del
negocio (Arts. 41, 43 y 53). En la práctica, el proveedor le da al negocio lo necesario para declarar con verdad:
cómo cumple cada numeral del Art. 53, la versión del software y dónde está el servidor. Es la
[ficha del Art. 53](/produccion/ficha-art-53/).

:::caution[Por confirmar con fuente]
Si la API corre en la nube de un tercero, no se sabe cómo encaja con el Art. 47 («el establecimiento donde se
encuentre el servidor») ni con el Art. 61 («por cada Sistema») (F-05, pregunta P-02). El modo recomendado,
mientras tanto, es instalar la API en un equipo del negocio. Tampoco se sabe qué normativa de protección de datos
aplica a los datos del cliente guardados por un tercero (F-14, pregunta P-05). Ver
[Consulta al SAR](/produccion/consulta-sar/).
:::
