---
title: Restaurante
description: Configuración de factura-hn para un restaurante con varias cajas o puntos de cobro, servicio en mesa y ticket de 80 mm, con la API instalada en un equipo del local.
sidebar:
  order: 2
---

## Perfil

Servicio en mesa y para llevar, con dos o más puntos de cobro (caja principal, barra, terraza). Ticket en
impresora térmica. La cuenta de una mesa se cobra al final.

## Configuración

| | |
|---|---|
| **Camino** | API REST (`@factura-hn/api`) en un equipo del local, con Docker. Cada caja llama a la API con `@factura-hn/cliente` o desde su propio lenguaje |
| **Cajas** | Varias. Un punto de emisión por caja (`000-001`, `000-002`…), cada una con su llave de caja y sus autorizaciones |
| **Fuera de línea** | No depende de internet, pero sí de la red del local: si el equipo de la API se cae, las cajas no emiten. Ver la contingencia abajo |
| **Impreso** | Ticket de 80 mm: el texto (`.txt`) para la impresora térmica o el PDF en formato ticket |
| **Documentos** | Factura (01). Nota de Crédito (06) para devoluciones o descuentos posteriores a clientes con RTN |

Por qué la API: con varias cajas, todas deben compartir el mismo almacén para que la numeración no tenga huecos ni
repetidos. El Reglamento admite sistemas en red centralizados, regionales o por sucursal (Art. 48), y factura-hn
los configura con puntos de emisión. Ver [Varias cajas](/guias/varias-cajas/) y
[Autoalojamiento](/guias/autoalojar/).

Si el restaurante tiene una sola caja, sirve la misma configuración de la [pulpería](/negocios/pulperia/): SDK con
SQLite en el equipo de la caja.

## Reglas que aplican, con su fuente

- **Momento de emisión.** El documento se emite con lo primero que ocurra entre la entrega y el pago o el crédito;
  en servicios, al pago o al crédito (Reglamento, Art. 14). factura-hn no lo decide: tu sistema llama a la emisión
  en el momento que corresponda.
- **Un documento por venta** (Art. 9). No se agrupan las cuentas del día en un solo documento.
- **El Ticket (09) no lo emite un sistema**, solo una máquina registradora (Art. 4 num. 43). Lo que sale en el
  rollo de 80 mm es una Factura (01).
- **Consumidor final** sin datos, salvo que el cliente pida factura con RTN (Art. 11 num. 1 a-c y num. 2 a).
  Arriba de L 10,000, nombre e identificación (Art. 11, párrafo final).
- **Papel térmico**: certificación del proveedor del papel (Art. 38).
- **Contingencia**: talonarios preimpresos de imprenta si el sistema no funciona (Art. 55).

## Ejemplo: cobrar una mesa

Una caja cobra la cuenta de una mesa con la API. La clave de idempotencia es el id de la cuenta: si la red falla y
la caja reintenta, la API devuelve la misma factura en lugar de emitir otra.

```bash
npm install @factura-hn/cliente
```

```ts
import { crearCliente, ErrorFacturaHN } from '@factura-hn/cliente';

// Cada caja usa su propia llave de caja, atada a su punto de emisión. La llave vive solo en el servidor.
const fhn = crearCliente({ url: process.env.FHN_API_URL!, llave: process.env.FHN_LLAVE! });

export interface Cuenta {
  id: string;     // estable por cuenta: si la red falla y se reintenta, la API devuelve la misma factura
  mesero: string;
  consumo: { descripcion: string; cantidad: string; precio: string }[]; // precios de la carta, con ISV
}

export async function cobrarCuenta(cuenta: Cuenta) {
  try {
    const { documento } = await fhn.emitir(
      {
        operador: cuenta.mesero, // queda en la bitácora
        documento: {
          preciosIncluyenISV: true,
          lineas: cuenta.consumo.map((c) => ({ descripcion: c.descripcion, cantidad: c.cantidad, precioUnitario: c.precio })),
        },
      },
      { idempotencyKey: `cuenta-${cuenta.id}` },
    );
    const ticket = await fhn.descargar(documento.numero, 'txt'); // texto para la impresora térmica
    return { ok: true as const, numero: documento.numero, total: documento.totales.total, ticket };
  } catch (e) {
    // 422: reglas fiscales. Muestra los mensajes tal cual; no se consumió número.
    if (e instanceof ErrorFacturaHN && e.estado === 422) return { ok: false as const, errores: e.errores.map((x) => x.mensaje) };
    throw e;
  }
}
```

Con datos ficticios:

<!-- declaraciones:
declare function cobrarCuenta(cuenta: { id: string; mesero: string; consumo: { descripcion: string; cantidad: string; precio: string }[] }): Promise<unknown>;
-->
```ts
await cobrarCuenta({
  id: 'mesa-4-2026-11-24-1',
  mesero: 'Luis',
  consumo: [
    { descripcion: 'Plato típico', cantidad: '2', precio: '185.00' },
    { descripcion: 'Refresco natural', cantidad: '2', precio: '45.00' },
  ],
});
// → { ok: true, numero: '000-002-01-00000001', total: 460, ticket: '…' } en la caja 000-002
```

Para probar sin CAI real, la API trae un tenant `demo` con CAI ficticio: `docker compose up -d --build --wait` y
`docker compose exec -T api factura-hn-api demo llave --solo-llave` da una llave de caja. Todo lo que emite lleva
la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Para el negocio real, el tenant `local` con `FHN_DEMO=0`, el
CAI de cada caja y una llave de caja por punto de emisión. Ver [Autoalojamiento](/guias/autoalojar/) y
[CAI y rangos](/produccion/cai-y-rangos/).

## Situaciones frecuentes

- **Se cobró la mesa equivocada.** Un supervisor anula el documento con un motivo (`POST /v1/documentos/{numero}/anular`,
  llave admin) y la caja emite el correcto (Art. 41).
- **Dos cajas cobran a la vez.** La API serializa cada serie: cada caja tiene su punto de emisión y su numeración,
  sin huecos ni repetidos.
- **El cliente pide la factura a nombre de su empresa.** Se agrega `cliente: { nombre, rtn }` al documento antes de
  emitir. Un documento emitido no se edita: se anula (Art. 41) o se modifica con notas.
- **Se cae el equipo de la API.** Las cajas no pueden emitir. Se usan los talonarios de contingencia (Art. 55).
  Las ventas hechas con el talonario quedan documentadas en el talonario y no se vuelven a emitir en el sistema. Cuando el sistema vuelve, emite solo las ventas nuevas, con la fecha de hoy.

Siguiente: [Ir a producción](/produccion/).
