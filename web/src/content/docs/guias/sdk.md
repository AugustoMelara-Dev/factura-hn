---
title: SDK de TypeScript
description: Guía de entrada del SDK factura-hn — para quién es, cómo emitir la primera factura de prueba, los almacenes y adónde seguir.
sidebar:
  label: SDK
  hidden: true
---

`factura-hn` es una librería de TypeScript sin dependencias que emite facturas, notas de crédito y notas de débito
según el Reglamento del Régimen de Facturación (Acuerdo 481-2017) **dentro de tu propio sistema**. Los documentos
quedan en tu base, en la misma transacción que el resto de la venta si lo necesitas.

**Úsalo si** tu sistema está en JavaScript o TypeScript (Node 20 o más reciente) y tiene su propia base. Si tu
sistema está en otro lenguaje, o varias cajas deben compartir un servidor, mira la [API REST](/guias/api/).

## Pruébalo en un minuto

Sin CAI real ni base de datos, en una carpeta nueva o en tu proyecto:

```bash
npm install factura-hn
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

Verás el ticket en la consola y quedará `factura.html` con la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».
Lo mismo desde código, con el facturador de prueba en memoria:

```ts
import { renderizarHTML } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo();
const factura = await caja.emitir({
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: 2, precioUnitario: '115.00' }],
});
console.log(factura.numero, renderizarHTML(factura).length);
```

Sin instalar nada, el [playground](/empezar/playground/) corre este mismo SDK en tu navegador.

## Qué resuelve por ti

- **Numeración atómica.** El almacén reserva cada número en la misma transacción que guarda el documento: no
  calcules el siguiente número por tu cuenta.
- **Montos exactos.** Los montos van como texto (`'89.50'`) y el cálculo es en centavos, sin punto flotante.
- **Reglas con su artículo.** Cada validación cita el Reglamento o la Ley del ISV, y cada error trae `codigo`,
  `mensaje` y `solucion`.
- **Documentos inmutables.** Lo emitido se anula o se corrige con una nota; no se edita.

## Elige el almacén

| Almacén | Para |
|---|---|
| `@factura-hn/sqlite` | Una caja que trabaja sin internet, con su propio punto de emisión |
| `@factura-hn/postgres` | Un servidor con varias cajas |
| El tuyo | Implementa la interfaz `AlmacenFiscal` y pasa su batería de pruebas |

Ver [Almacén fiscal](/conceptos/almacen/).

## Sigue con

- [Tu primera factura](/empezar/primera-factura/#sdk-node-20-o-más-reciente), paso a paso y con un error provocado.
- [Guía completa del SDK](/referencia/sdk/): CAI, emisión, impresión, anulación, notas y libro de ventas.
- [Imprimir](/guias/imprimir/), [anular](/guias/anular/) y [trabajar sin internet](/guias/fuera-de-linea/).
- [Errores](/referencia/errores/): cada código, qué significa y qué hacer.
- [Ir a producción](/produccion/): el CAI de tu resolución y los datos reales del emisor.
