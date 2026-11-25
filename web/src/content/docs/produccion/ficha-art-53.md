---
title: Ficha del sistema (Art. 53)
description: Qué exige el Art. 53 del Reglamento a un sistema de facturación, qué implementa factura-hn en cada numeral y qué datos debe completar el negocio para su Declaración Jurada.
sidebar:
  order: 3
---

El negocio que factura con un sistema computarizado presenta una **Declaración Jurada** de que el sistema cumple
el Art. 53 del Reglamento (Art. 53, C L.2184-2188). La firma el negocio, no el proveedor del software, y responde
por ella. El Art. 53 admite sistemas «desarrollados o adquiridos» (C L.2164).

Esta ficha reúne lo que el negocio necesita saber de factura-hn para declarar con fundamento. No es la Declaración
Jurada ni un formulario del SAR: es la información técnica que el desarrollador le entrega al dueño y al contador.
Describe lo que el software implementa y prueba; no afirma que una instalación concreta cumpla el Art. 53. Eso
depende también de la configuración y la operación del negocio, y lo evalúa él con su contador.

:::caution[Por confirmar con fuente]
El repositorio no tiene el formulario de la Declaración Jurada ni sus anexos técnicos: qué campos pide, por qué
medio se presenta y en qué plazo. Tampoco sabe si el SAR lleva un registro o certificación de
proveedores de software, o si el software o su versión deben registrarse. El Reglamento solo
regula el Registro Fiscal de Imprentas (Arts. 66-70), que no aplica a un software. Confírmalo con tu contador.
:::

## Lo que pide el Art. 53, numeral por numeral

Fuente: Art. 53, C L.2161-2188. La [matriz de cumplimiento](/referencia/cumplimiento/) tiene, en la fila 53, el
archivo y el título de la prueba automatizada de cada numeral.

| Num. | Exigencia | Qué implementa factura-hn | Lo que pone el negocio |
|---|---|---|---|
| 1 | Integración con al menos un sistema contable o de inventarios | Interfaz `LibroContable` (opción `libroContable`) y gancho `alEmitir`, que corren **dentro** de la transacción de la emisión: si el asiento falla, no hay documento (decisión de diseño de factura-hn: el numeral no dice cómo se integra) | El sistema contable o de inventario al que se conecta, y la conexión misma |
| 2 | Seguridad y controles de auditoría | Bitácora de solo inserción (`eventosAuditoria`): autorizaciones, emisiones, anulaciones y correcciones de fecha, con actor y operador. Disparadores en SQLite y Postgres que impiden borrar documentos y autorizaciones, cambiar un documento salvo de EMITIDO a ANULADO y retroceder la serie. En la API: llaves con roles (`caja`, `admin`), bitácora de la API con el actor y aislamiento por tenant con RLS | Quién tiene acceso al equipo, a la base y a las llaves; contraseñas y TLS |
| 3 | Persistencia y disponibilidad inmediata | Almacenes persistentes `@factura-hn/postgres` y `@factura-hn/sqlite`. Reimpresión idéntica desde el documento guardado (Art. 38) | Respaldos, su restauración probada y el plazo de conservación |
| 4 | Código de barras 2D o 3D (opcional) | **No implementado.** El numeral lo hace opcional | — |
| 5 | Generación de archivos de texto para enviarlos al SAR | `exportarTexto(docs, { formato: 'jsonl' \| 'csv' \| 'txt' })`; en la API, `GET /v1/exportacion`. Formatos propios y versionados: no se encontró un formato oficial | Generar el archivo cuando el SAR lo pida |

## Datos del sistema para la inscripción como autoimpresor

El Art. 47 (C L.2047-2080) pide registrar **cada sistema**, el **software**, el **establecimiento donde se
encuentra el servidor** y los **puntos de emisión**.

| Dato | Lo llena factura-hn | Lo llena el negocio |
|---|---|---|
| Nombre del software | factura-hn | |
| Versión | La versión instalada de cada paquete (`npm ls factura-hn`). Esta ficha describe la versión más reciente publicada; el [CHANGELOG](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CHANGELOG.md) dice qué cambió entre versiones | Anotar la versión instalada al declarar, y revisar la ficha si actualiza |
| Licencia | MIT (código abierto) | |
| Paquetes en uso | `factura-hn` y el almacén elegido; opcionales `@factura-hn/pdf`, `@factura-hn/mcp` y la API (`@factura-hn/api`, imagen Docker) | Cuáles usa su instalación |
| Establecimiento donde está el servidor | | La dirección del equipo donde corre la base o la API |
| Puntos de emisión | | Los que registra ante el SAR (Art. 45 num. 5). En red, una o varias numeraciones según el Art. 48 |
| Desarrollador o proveedor de la integración | | Quien integró factura-hn en su sistema, si es otro |

:::caution[Por confirmar con fuente]
Si la API corre en la nube de un tercero para varios negocios, no se sabe qué «establecimiento donde se encuentre
el servidor» se declara (Art. 47), si es un «sistema en red» (Art. 4 num. 42) ni si una sola API cuenta como «un
Sistema» por cliente (Art. 61). El Reglamento no lo dice de forma literal; mientras tanto, el modo recomendado es la
instalación local, en un equipo del negocio y en su establecimiento.
:::

## Otros requisitos del Reglamento que el sistema implementa, con su prueba

Requisitos del Reglamento que no son del Art. 53, pero que el contador suele revisar. Cada uno tiene su prueba
automatizada en la [matriz de cumplimiento](/referencia/cumplimiento/).

- Numeración `NNN-NNN-NN-NNNNNNNN` con una serie por establecimiento, punto de emisión y tipo, sin huecos ni
  repetidos (Art. 10 num. 7).
- No emite con la autorización vencida ni fuera del rango (Arts. 59 y 62).
- Los siete datos del emisor obligatorios e impresos (Art. 10 num. 1).
- Anulación con la leyenda «ANULADA», sin borrar el documento ni reutilizar el número (Art. 41).
- Custodia cronológica: la fecha de emisión la pone el reloj, en hora de Honduras, y no se puede retrofechar
  (Arts. 14 y 43).
- No emite los documentos que un sistema no puede emitir: 04, 09, 10 y 12 (Arts. 4 num. 43, 46 y 47).
- Calcula los documentos no utilizados del Art. 42, con su causal y la fecha límite del aviso.

## Lo que el sistema no hace

- No envía nada al SAR: ni la Declaración Jurada, ni los archivos de texto, ni el aviso de no utilizados.
- No emite con CAEE (Art. 4 num. 9 y Art. 54): no hay especificación técnica pública.
- No emite el Comprobante de Retención (05), la Guía de Remisión (08) ni la Boleta de Compra (11). La numeración
  los reconoce; falta su cálculo y su impresión.
- No decide el tratamiento de ISV de cada producto: lo indica el negocio.

## Cómo usar esta ficha

1. El desarrollador completa la columna del negocio con los datos de la instalación: versión, almacén, servidor y
   puntos de emisión.
2. El contador la revisa junto con los [puntos que el Reglamento no dice de forma literal](/produccion/estado-legal/#puntos-que-el-reglamento-no-dice-de-forma-literal).
3. El dueño la conserva junto con su Declaración Jurada.
4. Al actualizar factura-hn, revisen los cambios de la versión en [Cambios](/ayuda/cambios/): un cambio en un
   numeral puede exigir actualizar lo declarado.
