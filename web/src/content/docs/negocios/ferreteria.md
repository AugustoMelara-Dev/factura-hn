---
title: Ferretería
description: Configuración de factura-hn para una ferretería con clientes que piden RTN, ventas al crédito, exonerados, devoluciones con nota de crédito y precios en dólares.
sidebar:
  order: 3
---

:::caution[Guía orientativa]
Guía orientativa, pendiente de revisión por un contador. No sustituye asesoría fiscal.
:::

## Perfil

Mostrador con dos o más cajas. Muchos clientes son empresas o constructoras que piden la factura con su RTN, compran
al crédito y devuelven material. Algunos son exonerados. Ciertos productos se cotizan en dólares.

## Configuración recomendada

| | |
|---|---|
| **Camino** | SDK con `@factura-hn/postgres` si el sistema de la ferretería es JavaScript o TypeScript; si no, la API REST en un equipo del negocio |
| **Cajas** | Varias, contra el mismo almacén central. Un punto de emisión por caja (`000-001`, `000-002`…) |
| **Fuera de línea** | No: las cajas emiten contra la base o la API del negocio por la red local |
| **Impreso** | Carta (`renderizarHTML` o el PDF carta) para clientes con RTN y ventas al crédito; ticket en el mostrador |
| **Documentos** | Factura (01), Nota de Crédito (06) y, si el contador lo indica, Nota de Débito (07). Cada tipo tiene su propia autorización y su serie en cada caja |

Ver [Varias cajas](/guias/varias-cajas/) y [Clientes especiales](/guias/clientes-especiales/).

## Reglas que aplican, con su fuente

- **Cliente con RTN.** La factura para crédito fiscal lleva el nombre, el RTN del cliente y la fecha (Reglamento,
  Art. 11 num. 1 a-c).
- **Venta mixta.** Si la venta tiene partes exentas y partes gravadas, el crédito fiscal se reconoce
  solo sobre las gravadas (Art. 11 num. 3). factura-hn lo calcula en `totales.baseCreditoFiscal` (gravado 15 % más
  gravado 18 %, DEC-020) y avisa con `AVISO_VENTA_MIXTA`.
- **Venta al crédito.** Se emite al otorgar el crédito o al entregar, lo primero que ocurra (Art. 14). El documento
  lleva `condicionPago: 'CREDITO'`.
- **Exonerados.** El documento lleva la Orden de Compra Exenta **y** la Constancia del Registro de Exonerados, **o**
  el registro SAG/RUPNSA del sector agroindustrial (Art. 11 num. 4; DEC-021). Si la Orden de Compra Exenta no cubre
  todos los artículos, se emiten dos facturas: una exonerada con los cubiertos y otra normal con el resto: la
  exoneración aplica al documento completo (DEC-019; lectura del proyecto: el Reglamento no regula una exoneración
  parcial).
- **Devoluciones.** Una venta correcta con una devolución posterior se corrige con Nota de Crédito (06) sobre la
  factura (Art. 4 num. 32). La nota lleva el nombre y el RTN del adquirente (Arts. 26 y 28) y el CAI, el número y
  la fecha del documento que modifica (Art. 26 num. 3). factura-hn rechaza una nota de crédito que, sumada a las
  anteriores, supere el original o cambie su tasa (`NOTA_SUPERA_ORIGINAL`, `NOTA_TASA_DISTINTA`). Ningún artículo
  fija ese tope: es una interpretación pendiente de revisión (DEC-051 [REVISAR]).
- **Precios en dólares.** Un documento en moneda extranjera lleva la tasa de cambio vigente a la fecha (Art. 11,
  párrafo final; `tipoCambio`). factura-hn imprime además el equivalente en lempiras (DEC-068 [REVISAR]). Las notas
  se emiten solo en lempiras, con el tipo de cambio de la factura original (Arts. 26 num. 9 y 28 num. 8; DEC-018).

## Ejemplo: venta al crédito y devolución

Una constructora con RTN compra al crédito y luego devuelve parte del material. El ejemplo usa la demo (CAI
ficticio `DEMO00-NO-VALIDO-…` y leyenda de prueba) sobre PostgreSQL.

```bash
npm install factura-hn @factura-hn/postgres pg
```

```ts
import pg from 'pg';
import { renderizarHTML, type Emisor } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';
import { AlmacenPostgres } from '@factura-hn/postgres';

// Datos del negocio, tal como están en el RTN (estos son ficticios).
const emisor: Emisor = {
  rtn: '99990000000001',
  razonSocial: 'Ferretería Demostración S. de R.L.',
  nombreComercial: 'Ferretería Demostración',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

// Un almacén central: las cajas del mostrador emiten contra la misma base.
const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await almacen.migrar();

// En prueba: CAI ficticios de factura, nota de crédito y nota de débito en la caja 000-002.
const caja = await crearFacturadorDemo({ almacen, emisor, establecimiento: '000', puntoEmision: '002', preciosIncluyenISV: true });

// Venta al crédito a una constructora con RTN.
const factura = await caja.emitir(
  {
    cliente: { nombre: 'Constructora Ejemplo S. A.', rtn: '99990000000002' },
    condicionPago: 'CREDITO',
    lineas: [
      { codigo: 'CEM-42', descripcion: 'Cemento gris 42.5 kg', cantidad: '20', precioUnitario: '245.00' },
      { codigo: 'VAR-38', descripcion: 'Varilla corrugada 3/8"', cantidad: '30', precioUnitario: '118.00', descuento: '90.00' },
    ],
  },
  { operador: 'Mostrador 2' },
);
const carta = renderizarHTML(factura); // carta, para enviar o imprimir

// Devuelven 5 varillas: Nota de Crédito sobre la factura. Cliente, referencia y moneda salen del original.
const nota = await caja.notaCredito({
  original: factura.numero,
  motivo: 'Devolución de 5 varillas',
  lineas: [{ codigo: 'VAR-38', descripcion: 'Varilla corrugada 3/8"', cantidad: '5', precioUnitario: '118.00' }],
});
```

La factura `000-002-01-00000001` suma L 8,350.00 y la nota `000-002-06-00000001`, L 590.00. Usa una base de prueba
en `DATABASE_URL`, no la de producción: un punto de emisión no mezcla documentos de prueba y reales.

Un cliente exonerado con Orden de Compra Exenta y constancia (números ficticios):

```ts
const exonerada = await caja.emitir({
  cliente: { nombre: 'Asociación Ejemplo', rtn: '99990000000003' },
  exoneracion: { ordenCompraExenta: 'OCE-0001', constanciaRegistroExonerado: 'CRE-0001' },
  lineas: [{ descripcion: 'Lámina de zinc 12 pies', cantidad: '10', precioUnitario: '310.00' }],
});
```

Una venta en dólares, con precios sin ISV:

```ts
const enDolares = await caja.emitir({
  cliente: { nombre: 'Constructora Ejemplo S. A.', rtn: '99990000000002' },
  moneda: 'USD',
  tipoCambio: '24.7000',
  preciosIncluyenISV: false,
  lineas: [{ descripcion: 'Generador eléctrico 5 kW', cantidad: '1', precioUnitario: '850.00' }],
});
```

**Para producción**, cambia `crearFacturadorDemo` por `crearFacturador` con los mismos datos, usa la base real y
registra el CAI de cada tipo (01 y 06) en cada caja, una sola vez. Ver [CAI y rangos](/produccion/cai-y-rangos/).

## Situaciones frecuentes

- **La devolución supera lo facturado.** `NOTA_SUPERA_ORIGINAL`, con el saldo disponible en el mensaje. No se
  consume número.
- **La factura original es de un talonario u otro sistema.** La nota se emite con `referencia` y `cliente`
  completos, y sale con el aviso `AVISO_ORIGINAL_EXTERNO` (DEC-004). Con la API, la emite una llave admin
  (DEC-051 [REVISAR]; es una política de seguridad de la API, no fiscal).
- **El cliente exonerado no trae la constancia.** `EXONERACION_*`: hay que pedir la Orden de Compra Exenta y la
  constancia, o el registro SAG/RUPNSA.
- **Un error en la cantidad antes de entregar.** Se anula el documento y se emite otro (Art. 41).

## Por confirmar con fuente

:::caution[Por confirmar con fuente]
- **Guía de Remisión (08)**: si la ferretería debe emitirla al despachar mercadería y cuándo. El repositorio solo
  sabe que está en el Art. 29, sin su contenido, y factura-hn todavía no la emite (aún sin pregunta propia en la consulta).
- **Retenciones** de grandes contribuyentes y el Comprobante de Retención (05): el repositorio solo sabe que está en
  el Art. 33 (aún sin pregunta propia en la consulta). factura-hn no lo emite.
- **Usos concretos de la Nota de Débito (07)**: intereses, fletes, diferencias de precio. El Reglamento solo dice
  «ajustes» (Art. 4 num. 32; aún sin pregunta propia en la consulta).
- **Exonerado agroindustrial solo con el registro SAG/RUPNSA**, sin Orden de Compra Exenta: es la lectura adoptada
  (DEC-021), pendiente de confirmación (pregunta P-08).
- **Productos exentos**: el repositorio no tiene listas (aún sin pregunta propia en la consulta).
- **Si el equivalente en lempiras** de un documento en dólares es exigible y con qué redondeo (DEC-068 [REVISAR]).

Ver [Consulta al SAR](/produccion/consulta-sar/), aún no enviada.
:::

## Qué confirmar con tu contador

- El tratamiento de ISV de cada producto.
- Los documentos que necesita además de la factura y la nota de crédito.
- Cómo se manejan los exonerados y las retenciones de sus clientes.

Siguiente: [Ir a producción](/produccion/).
