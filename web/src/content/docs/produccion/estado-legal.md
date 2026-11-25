---
title: Estado legal
description: Qué es y qué no es factura-hn, proyecto independiente no afiliado al SAR, sin certificación, y la lectura que aplica en los puntos que el Reglamento no dice de forma literal.
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
  exista: confírmalo con tu contador.
- **No ha pasado una revisión profesional.** No hay constancia de una revisión por un contador o un abogado. Las
  pruebas de seguridad y de calidad del código están en
  [`docs/calidad/`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/docs/calidad).
- **No es asesoría fiscal, contable ni legal.**
- **No hace los trámites del negocio**: inscripción, solicitud y renovación del CAI, Declaración Jurada del Art. 53,
  aviso de no utilizados, uso temporal, talonarios de contingencia ni certificación del papel térmico. Ver
  [Trámites ante el SAR](/produccion/tramites/).
- **No decide el tratamiento de ISV** de cada producto (15 %, 18 %, exento, exonerado o gravado 0 %): lo indica el
  negocio con su contador.
- **No emite con CAEE.** El Reglamento define el Código de Autorización de Emisión Electrónica (Art. 4 num. 9 y
  Art. 54), pero no se encontró una especificación técnica pública. El régimen que implementa
  factura-hn es el de CAI, rango y fecha límite.

Quien emite es el responsable ante el SAR. La Declaración Jurada del sistema la firma el negocio (Art. 53).

## Puntos que el Reglamento no dice de forma literal

En algunos puntos el Reglamento no es literal o no se encontró el texto primario. En cada uno, factura-hn aplica una
lectura declarada, que se resume aquí. **Ninguna es una regla confirmada por el SAR**: conviene que tu contador las
conozca y las confirme para tu negocio.

### Proveedor, instalación y trámites

| Tema | Lectura que aplica factura-hn |
|---|---|
| Registro o certificación de proveedores de software | No se encontró en el Reglamento |
| API alojada en la nube de un tercero (Arts. 47 y 61) | Se recomienda instalarla en un equipo del negocio |
| Procedimiento de la inscripción como autoimpresor y de la Declaración Jurada (Arts. 47 y 53) | Lo indica el contador |
| Formato de los archivos de texto (Art. 53 num. 5) y del aviso de no utilizados (Art. 42) | No hay formato oficial publicado: factura-hn usa formatos propios (jsonl, csv, txt) y conserva los importes de los anulados |
| Plazo de conservación (Art. 43) | 5 años desde la declaración del período, con reserva |
| Papel térmico: certificación y resúmenes de ventas (Art. 38) | Aviso en la documentación; el software no lo gestiona |
| CAI solicitado para otro sistema o para talonarios (Art. 61) | Se puede registrar, con un aviso: confírmalo con el contador antes |
| Fecha mínima de la primera emisión de una serie | Sin piso: la fecha es siempre la de hoy |

### Cálculo e impresión

| Tema | Lectura que aplica factura-hn |
|---|---|
| Exportaciones: «gravado 0 %» o «exento» | «Gravado 0 %», según el Art. 12 del Reglamento |
| ISV por línea o por grupo de tasa (Ley del ISV, Art. 9; Reglamento, Art. 11 num. 1 h-i) | Por grupo de tasa; si un precio con ISV incluido no tiene base exacta, el total queda 1 centavo abajo, nunca arriba |
| Tasa del 18 % y la lista de bienes | Se mantiene; falta en el repositorio el texto del Decreto 278-2013, Art. 16, y la lista vigente. Qué va al 18 % lo decide el negocio con su contador |
| Adquirente exonerado del sector agroindustrial (Art. 11 num. 4) | Se acepta la OCE con la constancia, o el registro SAG/RUPNSA |
| Documento en dólares | Imprime su equivalente en lempiras; ningún texto del repositorio lo exige |
| Libro de ventas con documentos en moneda extranjera | Va en lempiras: cada campo se convierte con su tipo de cambio; el total puede diferir 1 centavo de la suma de las partes |

### Notas, anulación y plazos

| Tema | Lectura que aplica factura-hn |
|---|---|
| Tope de la nota de crédito (Art. 4 num. 32: la nota ajusta el comprobante correspondiente) | La suma de las notas no supera el original ni cambia su tasa de ISV (`NOTA_SUPERA_ORIGINAL`, `NOTA_TASA_DISTINTA`). Ningún artículo fija un tope numérico: es una lectura derivada |
| Anular un documento con notas vigentes (Arts. 41 y 4 num. 32) | No se anula: primero se anulan las notas (`DOCUMENTO_CON_NOTAS`) |
| Nota de crédito sobre una factura a CONSUMIDOR FINAL (Arts. 26 y 28) | Acepta el nombre y el RTN que se indiquen, con el aviso `AVISO_ORIGINAL_SIN_RTN`: la nota podría dar crédito fiscal a quien el original no identificaba |
| Serie que continúa la de otro sistema o un talonario (`ultimoEmitidoAntes`) | La serie sigue en el número siguiente y los anteriores se tratan como documentos externos |
| Plazo de diez días hábiles del aviso de no utilizados (Art. 42) | Descuenta sábados y domingos; los feriados los pasa el integrador. Sin ellos, la fecha límite puede quedar uno o más días después de la real |
| Aviso de renovación del CAI (Art. 59, «dentro de los dos (2) meses previos») | Se abre dos meses de calendario antes de la fecha límite |
| Asiento contable (Art. 53 num. 1) | Corre dentro de la misma transacción que el documento: si falla, no hay documento |
| Profesional independiente: Factura (01) o Recibo por Honorarios (04) (Art. 46) | La guía se publica con un aviso de peligro: confírmalo con tu contador |

## Qué hacer con esta información

1. Revisa con tu contador los [puntos que el Reglamento no dice de forma literal](#puntos-que-el-reglamento-no-dice-de-forma-literal)
   que afectan a tu negocio.
2. Confirma con él lo que está marcado «Por confirmar con fuente» en las páginas de
   [Ir a producción](/produccion/) y de [Guías por negocio](/negocios/).
3. Si tienes una fuente para alguno de estos puntos (un artículo, una respuesta escrita del SAR o el criterio de un
   contador), apórtala con la plantilla «Regla fiscal». Ver [Contribuir](/ayuda/contribuir/).
