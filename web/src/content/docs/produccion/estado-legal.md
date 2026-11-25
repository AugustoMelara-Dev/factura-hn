---
title: Estado legal
description: Qué es y qué no es factura-hn, proyecto independiente no afiliado al SAR, sin certificación, con la consulta al SAR sin enviar y una lista de interpretaciones pendientes de revisión.
sidebar:
  order: 5
---

Esta página dice sin rodeos en qué estado está factura-hn frente al SAR, para que el negocio y su contador decidan
con la información completa.

## Qué es

- Un conjunto de bibliotecas, una API y un servidor MCP de **código abierto** (licencia MIT).
- Una herramienta para que un negocio inscrito como autoimpresor por sistema computarizado (Art. 47 del
  Reglamento) genere y conserve sus documentos fiscales con los requisitos de formato y cálculo del Reglamento del
  Régimen de Facturación (Acuerdo 481-2017 y sus reformas).
- Un proyecto que cita el artículo de cada regla que aplica y la prueba con una prueba automatizada. La lista
  está en la [matriz de cumplimiento](/referencia/cumplimiento/).

## Qué no es

- **No es un producto del SAR.** Es un proyecto independiente, no afiliado al Servicio de Administración de Rentas.
- **No está certificado, homologado, registrado ni aprobado** por el SAR ni por otra autoridad. El repositorio no
  encontró en el Reglamento un registro ni una certificación de proveedores de software. Eso no prueba que no
  exista: es la pregunta P-01.
- **No ha pasado una revisión profesional.** Las revisiones que registra el repositorio, fiscales y de seguridad,
  son internas del proyecto. No hay constancia de una revisión por un contador o un abogado.
- **No es asesoría fiscal, contable ni legal.**
- **No hace los trámites del negocio**: inscripción, solicitud y renovación del CAI, Declaración Jurada del Art. 53,
  aviso de no utilizados, uso temporal, talonarios de contingencia ni certificación del papel térmico. Ver
  [Trámites ante el SAR](/produccion/tramites/).
- **No decide el tratamiento de ISV** de cada producto (15 %, 18 %, exento, exonerado o gravado 0 %): lo indica el
  negocio con su contador.
- **No emite con CAEE.** El Reglamento define el Código de Autorización de Emisión Electrónica (Art. 4 num. 9 y
  Art. 54), pero no se encontró una especificación técnica pública (pregunta P-12). El régimen que implementa
  factura-hn es el de CAI, rango y fecha límite.

Quien emite es el responsable ante el SAR. La Declaración Jurada del sistema la firma el negocio (Art. 53).

## La consulta al SAR no se ha enviado

El proyecto redactó una consulta formal con 14 preguntas (P-01 a P-14) sobre los puntos que el Reglamento no
resuelve de forma literal. **Aún no se ha enviado** y ninguna pregunta tiene respuesta del SAR. Mientras tanto,
factura-hn aplica la lectura provisional que se indica en cada una. El texto está en
[Consulta al SAR](/produccion/consulta-sar/).

Las que más afectan a un negocio que va a producción:

| Pregunta | Tema | Lectura provisional |
|---|---|---|
| P-01 | Registro o certificación de proveedores de software | No se encontró en el Reglamento |
| P-02 | API alojada en la nube de un tercero (Arts. 47 y 61) | Se recomienda instalarla en un equipo del negocio |
| P-03 | Procedimiento de la inscripción como autoimpresor y de la Declaración Jurada | Sin respuesta: lo indica el contador |
| P-04, P-14 | Formato de los archivos de texto y del aviso de no utilizados | Formatos propios (DEC-011 [REVISAR]) |
| P-06 | Plazo de conservación | 5 años desde la declaración del período, con reserva |
| P-07 | Papel térmico: certificación y resúmenes de ventas | Aviso en la documentación; el software no lo gestiona |
| P-08 | Exonerado agroindustrial solo con el registro SAG/RUPNSA | Se acepta (DEC-021) |
| P-09 | Exportaciones: «gravado 0 %» o «exento» | «Gravado 0 %», según el Art. 12 del Reglamento |
| P-10 | ISV por línea o por grupo de tasa | Por grupo de tasa; sin base exacta, 1 centavo menos (D-01) |
| P-11 | Tasa del 18 % y la lista de bienes | Sin texto primario (DEC-069 [REVISAR]) |
| P-13 | Fecha mínima de la primera emisión de una serie | Sin piso: la fecha es siempre la de hoy |

## Interpretaciones pendientes

Donde la norma no es literal, el proyecto adopta una lectura y la registra como decisión (DEC). Las que cambian la
interpretación fiscal llevan la marca **[REVISAR]** hasta que el responsable del proyecto las aprueba. Ninguna es
una regla del SAR: son **interpretaciones pendientes de revisión**, y conviene que el contador las conozca.

| Decisión | Qué se decidió | Por qué importa |
|---|---|---|
| DEC-008 [REVISAR] | `ultimoEmitidoAntes`: al migrar desde otro sistema o un talonario, la serie continúa en el número siguiente y los anteriores se tratan como documentos externos | Notas sobre documentos emitidos antes de la migración |
| DEC-010 [REVISAR] | El plazo del Art. 42 descuenta solo sábados y domingos; los feriados los pasa el integrador | Sin feriados, la fecha límite del aviso puede quedar uno o más días después de la real |
| DEC-011 [REVISAR] | El archivo de texto del Art. 53 num. 5 usa formatos propios (jsonl, csv, txt) y conserva los importes de los anulados | No hay formato oficial (P-14) |
| DEC-012 [REVISAR] | El asiento contable (Art. 53 num. 1) corre dentro de la transacción fiscal: si falla, no hay documento | Integración con la contabilidad o el inventario |
| DEC-025 [REVISAR] | El aviso de renovación se abre dos meses de calendario antes de la fecha límite (Art. 59) | Cuándo empieza a avisar la caja |
| DEC-050 [REVISAR] | El libro de ventas va en lempiras; un documento en moneda extranjera se convierte con su tipo de cambio, campo por campo | El total puede diferir 1 centavo de la suma de las partes |
| DEC-051 [REVISAR] | Una nota de crédito no supera su original ni cambia la tasa de ISV (`NOTA_SUPERA_ORIGINAL`, `NOTA_TASA_DISTINTA`). Es una derivación del Art. 4 num. 32: ningún artículo fija un tope numérico | Devoluciones y descuentos posteriores |
| DEC-068 [REVISAR] | Un documento en dólares imprime su equivalente en lempiras | Ningún texto del repositorio lo exige |
| DEC-069 [REVISAR] | La tasa del 18 % se mantiene sin fuente primaria en el repositorio | Falta el texto del Decreto 278-2013, Art. 16, y la lista vigente (P-11) |
| DEC-079 [REVISAR] | Una nota de crédito sobre una factura a CONSUMIDOR FINAL acepta el nombre y el RTN que se indiquen | Lectura de los Arts. 26 y 28: la nota podría dar crédito fiscal a quien el original no identificaba |

DEC-066 lleva además una marca parcial: si `preciosIncluyenISV` debe ser obligatorio en `crearFacturador` antes de
la 1.0. Es una decisión de diseño del SDK, no fiscal.

El detalle de cada una, con su contexto y la alternativa descartada, está en
[Decisiones](/referencia/decisiones/).

## Qué hacer con esta información

1. Revisa con tu contador las [interpretaciones pendientes](#interpretaciones-pendientes) que afectan a tu negocio.
2. Confirma con él lo que está marcado «Por confirmar con fuente» en las páginas de
   [Ir a producción](/produccion/) y de [Guías por negocio](/negocios/).
3. Si tienes una fuente para alguno de estos puntos (un artículo, una respuesta escrita del SAR o el criterio de un
   contador), apórtala con la plantilla «Regla fiscal». Ver [Contribuir](/ayuda/contribuir/).
