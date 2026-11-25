---
title: Pulpería
description: Configuración de factura-hn para una pulpería con una caja, ventas pequeñas a consumidor final, precios con ISV incluido y ticket de 80 mm, sin depender de internet.
sidebar:
  order: 1
---

:::caution[Guía orientativa]
Guía orientativa, pendiente de revisión por un contador. No sustituye asesoría fiscal.
:::

## Perfil

Una caja, muchas ventas pequeñas, casi siempre a consumidor final. Los precios de la góndola ya incluyen el ISV. La
conexión a internet puede fallar.

## Configuración recomendada

| | |
|---|---|
| **Camino** | SDK (`factura-hn`) con `@factura-hn/sqlite`: la base vive en el equipo de la caja |
| **Cajas** | Una. Un establecimiento y un punto de emisión, por ejemplo `000-001` |
| **Fuera de línea** | Sí. La emisión no pasa por un servicio del SAR, así que la caja emite sin internet |
| **Impreso** | Ticket de 80 mm: `renderizarTexto(doc, { ancho: 42 })` para una impresora térmica, o `renderizarPDF(doc, { formato: 'ticket' })` |
| **Documentos** | Factura (01). Nota de Crédito (06) si hace devoluciones a clientes con RTN |

El [POS fuera de línea](/guias/fuera-de-linea/) del repositorio muestra una caja completa con SQLite, una clave por
venta para no duplicar y una cola para sincronizar cuando vuelve la conexión. Para imprimir, ver
[Imprimir](/guias/imprimir/).

## Reglas que aplican, con su fuente

- **Factura a consumidor final, no ticket.** El Ticket (09) se emite solo por máquina registradora (Reglamento,
  Art. 4 num. 43). Un sistema emite una Factura (01) a «CONSUMIDOR FINAL» (Art. 11 num. 2 a), aunque se imprima en
  un rollo de 80 mm.
- **Un documento por cada venta**, aunque sea de pocos lempiras. La exención de L 50 diarios no aplica a los
  sistemas computarizados (Art. 9, C L.559-566). factura-hn no tiene una función para juntar las ventas del día.
- **Arriba de L 10,000**, la venta a consumidor final lleva el nombre y la identificación del cliente (Art. 11,
  párrafo final). factura-hn lo exige (`CONSUMIDOR_FINAL_IDENTIFICACION`).
- **Precios con ISV incluido y el centavo.** El ISV impreso debe salir de la base impresa con el redondeo del
  Art. 9 de la Ley del ISV. Con algunos precios de góndola no existe una base exacta, y el total queda 1 centavo
  por debajo del precio: el cliente paga un centavo menos, nunca más (decisión D-01). Por eso se cobra siempre
  `totales.total` y se calcula antes con `cotizar`. Para evitar el ajuste, `sugerirPrecioSinAjuste` propone precios
  que no lo necesitan.
- **Papel térmico.** Antes de imprimir en papel térmico, el Art. 38 pide la certificación del proveedor del papel
  de que la impresión dura al menos 5 años.
- **Contingencia.** Si la caja no funciona, se usan talonarios preimpresos de imprenta; vender sin documento se
  sanciona (Art. 55).

## Ejemplo: una venta típica

Una venta de mostrador, sin cliente, con precios de góndola. El ejemplo usa la demo: CAI ficticio
`DEMO00-NO-VALIDO-…` y la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» en el ticket. Requiere Node 22.13 o
más reciente.

```bash
npm install factura-hn @factura-hn/sqlite
```

```ts
import { DatabaseSync } from 'node:sqlite';
import { renderizarTexto, type Emisor } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';
import { AlmacenSQLite } from '@factura-hn/sqlite';

// Datos del negocio, tal como están en el RTN (estos son ficticios).
const emisor: Emisor = {
  rtn: '99990000000001',
  razonSocial: 'Pulpería Demostración',
  nombreComercial: 'Pulpería Demostración',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

// La base vive en el equipo de la caja: emite sin internet.
const almacen = new AlmacenSQLite(new DatabaseSync('./pulperia-prueba.db'));

// En prueba: CAI ficticio DEMO00-NO-VALIDO-…, y cada impreso lleva la leyenda de prueba.
const caja = await crearFacturadorDemo({ almacen, emisor, establecimiento: '000', puntoEmision: '001', preciosIncluyenISV: true });

// Una venta típica: precios de góndola con ISV incluido, sin cliente (CONSUMIDOR FINAL).
const venta = {
  lineas: [
    { codigo: '7501', descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' },
    { codigo: '7610', descripcion: 'Jabón de lavar', cantidad: '2', precioUnitario: '23.00' },
  ],
};

const { totales } = caja.cotizar(venta); // lo que se cobra: totales.total
console.log('Cobrar L', totales.total);

const factura = await caja.emitir(venta, { operador: 'Rosa' });
console.log(renderizarTexto(factura, { ancho: 42 })); // ticket de 80 mm
```

Cobra L 135.50 y emite `000-001-01-00000001`. Cada vez que lo corres, la numeración sigue en el archivo
`pulperia-prueba.db`. Las líneas sin `isv` van gravadas al 15 %; si un producto tiene otro tratamiento, se indica
en la línea (`isv: 'ISV18'`, `'EXENTO'`), según lo que diga tu contador.

**Para producción**, usa otra base (por ejemplo `pulperia.db`), cambia `crearFacturadorDemo` por `crearFacturador`
con los mismos datos y registra el CAI de tu resolución una sola vez, con `caja.registrarAutorizacion({ … })`. No
registres el CAI real en la base de prueba: los números de prueba no se repiten y el registro daría
`RANGO_USADO_EN_PRUEBA`. Ver [CAI y rangos](/produccion/cai-y-rangos/).

## Situaciones frecuentes

- **El cliente pide factura con RTN.** Se emite con `cliente: { nombre, rtn }`. Si compra productos exentos y
  gravados, el documento trae el aviso `AVISO_VENTA_MIXTA`: para el crédito fiscal solo cuenta lo gravado
  (Art. 11 num. 3).
- **Se equivocó la cajera.** Se anula el documento con un motivo y se emite uno nuevo (Art. 41). El número anulado
  sigue consumido.
- **El cliente devuelve un producto de una compra con RTN.** Nota de Crédito (06) sobre la factura (Art. 4
  num. 32). Requiere el CAI de la serie 06. Ver [Nota de Crédito](/documentos/06-nota-de-credito/).
- **El reloj de la caja se adelantó.** factura-hn lo detecta (`RELOJ_ADELANTADO_SOSPECHOSO`). Ver
  [Reloj](/guias/reloj/).

## Por confirmar con fuente

:::caution[Por confirmar con fuente]
- **Productos exentos.** El repositorio no tiene ninguna lista de bienes exentos (canasta básica u otros). La
  clasificación de cada producto la decide el negocio con su contador (F-02, pregunta nueva fuera de P-01 a P-14).
- **Productos al 18 %.** La Ley del ISV, en la copia del repositorio, no trae las tasas vigentes. La de 18 % viene
  del Decreto 278-2013, Art. 16, que no está en texto primario (F-01, pregunta P-11; DEC-069 [REVISAR]).
- **Si una pulpería está obligada a facturar con un sistema** o puede usar talonarios de imprenta, según su tamaño
  (F-20).
- **Papel térmico**: quién presenta la certificación del Art. 38 y qué son los «resúmenes de ventas» que menciona
  (F-08, pregunta P-07).

Ver [Consulta al SAR](/produccion/consulta-sar/), aún no enviada.
:::

## Qué confirmar con tu contador

- El tratamiento de ISV de cada producto del inventario.
- Si el negocio debe inscribirse como autoimpresor por sistema y qué documentos necesita.
- Los talonarios de contingencia y el papel térmico.

Siguiente: [Ir a producción](/produccion/).
