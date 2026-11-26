---
title: Guías por tipo de negocio
description: Cómo configurar factura-hn en una pulpería, un restaurante, una ferretería o un comercio en línea, con las reglas que aplican a todos.
sidebar:
  order: 0
  label: Elegir una guía
---

Cada guía cuenta cómo se configura factura-hn para un tipo de negocio: qué camino conviene (SDK, API o MCP),
cuántas cajas, si trabaja fuera de línea y qué impreso usa. Trae un ejemplo de venta típica con datos ficticios y
código que corre contra la versión publicada.

| Guía | Camino | Cajas | Fuera de línea | Impreso |
|---|---|---|---|---|
| [Pulpería](/negocios/pulperia/) | SDK con SQLite | Una | Sí | Ticket de 80 mm |
| [Restaurante](/negocios/restaurante/) | API en un equipo del local | Varias | No: las cajas usan la red del local | Ticket de 80 mm |
| [Ferretería](/negocios/ferreteria/) | SDK con PostgreSQL, o API | Varias | No | Carta para clientes con RTN, ticket en mostrador |
| [Comercio en línea](/negocios/comercio-en-linea/) | API desde el servidor de la tienda | Un punto de emisión para la tienda | No | PDF carta por pedido |

Para elegir el camino en general, ver [Elegir camino](/empezar/elegir-camino/).

## Lo que vale para todos

Estas reglas aplican a cualquier negocio que factura con un sistema. Los artículos son del Reglamento del Régimen
de Facturación (Acuerdo 481-2017). factura-hn valida las que dependen del documento (un documento por venta,
consumidor final, RTN, fecha, anulación, tipos no emitibles); el momento de emisión y la contingencia los decide
tu sistema.

- **Un documento por venta**, aunque sea pequeña. La exención de L 50 diarios no aplica a los sistemas
  computarizados (Reglamento, Art. 9, C L.559-566).
- **Momento de emisión**: lo primero que ocurra entre la entrega del bien y el pago o el otorgamiento del crédito;
  en servicios, al pago o al crédito (Art. 14). factura-hn no decide cuándo emitir: lo decide el sistema que lo
  integra.
- **Consumidor final**: sin datos del cliente, el documento dice «CONSUMIDOR FINAL» (Art. 11 num. 2 a). Arriba de
  L 10,000 hay que pedir nombre e identificación (Art. 11, párrafo final).
- **Crédito fiscal**: el cliente que necesita la factura como crédito fiscal, costo o gasto da su RTN
  (Art. 11 num. 1 a-c).
- **Sin retrofechar**: la fecha la pone el reloj, en hora de Honduras (Arts. 14 y 43).
- **Errores**: un documento con errores se anula con la leyenda «ANULADA» y no se borra (Art. 41). Una venta
  correcta que luego tiene una devolución o un descuento se corrige con Nota de Crédito (Art. 4 num. 32).
- **Lo que un sistema no emite**: el Ticket (09) es solo de máquina registradora (Art. 4 num. 43); el Recibo por
  Honorarios (04) y la Factura Prevalorada (10), solo de imprenta (Art. 46); la Constancia de Donación (12) está
  excluida para el autoimpresor (Art. 47).
- **Contingencia**: talonarios preimpresos de imprenta para cuando el sistema no funciona; vender sin documento se
  sanciona (Art. 55).

