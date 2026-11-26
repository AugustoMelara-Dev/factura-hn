---
title: Comercio en línea
description: Configuración de factura-hn para una tienda en línea que cobra antes de entregar, con emisión en el servidor al confirmar el pago, una clave de idempotencia por pedido y el PDF servido por pedido.
sidebar:
  order: 4
---

## Perfil

Una tienda en línea que cobra con tarjeta o transferencia antes de entregar. El cliente no está presente al
emitir. Los pedidos los procesa un servidor (Node, PHP, Python u otro).

## Configuración

| | |
|---|---|
| **Camino** | API REST desde el servidor de la tienda: `@factura-hn/cliente` en JavaScript o TypeScript, o un cliente generado desde `openapi.json` en otro lenguaje. Si la tienda es JS/TS y tiene su propia base, el SDK también sirve |
| **Cajas** | Un punto de emisión para la tienda (por ejemplo `000-002`), con su propia llave de caja y sus autorizaciones |
| **Fuera de línea** | No: la emisión corre en el servidor |
| **Impreso** | PDF carta, servido por pedido y enviado al cliente |
| **Documentos** | Factura (01). Nota de Crédito (06) para devoluciones a clientes con RTN |

El [ejemplo de Express](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/express) del repositorio es una tienda completa: factura sus pedidos con
`@factura-hn/cliente`, sirve el PDF por pedido y recibe los webhooks firmados. La CI lo prueba contra la API.

## Reglas que aplican, con su fuente

- **Fecha de emisión.** En ventas por internet o por teléfono pagadas antes de entregar, el documento se emite en
  la fecha del pago y se entrega con el bien (Reglamento, Art. 14). Por eso la factura se emite cuando la pasarela
  confirma el pago, no al despachar.
- **Un documento por venta** (Art. 9). Cada pedido pagado es una factura.
- **Arriba de L 10,000** a consumidor final, nombre e identificación del cliente (Art. 11, párrafo final). Pídelos
  en el formulario de compra; si faltan, la API responde 422 con `CONSUMIDOR_FINAL_IDENTIFICACION`.
- **Crédito fiscal**: el cliente que lo necesita da su RTN al comprar (Art. 11 num. 1 a-c).
- **Precios con ISV incluido**: con algunos precios no hay una base exacta y el total
  queda 1 centavo abajo: el cliente paga un centavo menos, nunca más (Art. 9 de la Ley del ISV). Cobra el total que devuelve la API, o cotiza antes de cobrar.

## Ejemplo: facturar un pedido pagado

Lo llama el servidor de la tienda cuando la pasarela confirma el pago. La clave de idempotencia es el id del
pedido: si la respuesta se pierde y se reintenta, la API devuelve la misma factura.

```bash
npm install @factura-hn/cliente
```

```ts
import { crearCliente, ErrorFacturaHN, type DocumentoEntrada } from '@factura-hn/cliente';

const fhn = crearCliente({ url: process.env.FHN_API_URL!, llave: process.env.FHN_LLAVE! });

// Se llama cuando la pasarela confirma el pago, en el servidor de la tienda.
export async function facturarPedido(pedido: { id: string; cliente?: DocumentoEntrada['cliente']; lineas: DocumentoEntrada['lineas'] }) {
  try {
    const { documento } = await fhn.emitir(
      { documento: { cliente: pedido.cliente, preciosIncluyenISV: true, lineas: pedido.lineas } },
      { idempotencyKey: `pedido-${pedido.id}` }, // estable por pedido: un reintento no emite otra factura
    );
    return { ok: true as const, numero: documento.numero, total: documento.totales.total };
  } catch (e) {
    if (e instanceof ErrorFacturaHN && e.estado === 422) return { ok: false as const, errores: e.errores.map((x) => x.mensaje) };
    throw e;
  }
}
```

Con datos ficticios:

<!-- declaraciones:
declare function facturarPedido(pedido: { id: string; cliente?: unknown; lineas: { descripcion: string; cantidad: string; precioUnitario: string }[] }): Promise<unknown>;
-->
```ts
await facturarPedido({ id: '1001', lineas: [{ descripcion: 'Audífonos inalámbricos', cantidad: '1', precioUnitario: '1150.00' }] });
// → { ok: true, numero: '000-002-01-00000002', total: 1150 }

// Más de L 10,000 a consumidor final sin identificación: 422, no se consume número.
await facturarPedido({ id: '1002', lineas: [{ descripcion: 'Televisor 55 pulgadas', cantidad: '1', precioUnitario: '12500.00' }] });
// → { ok: false, errores: ['Ventas a consumidor final mayores de L 10,000.00 requieren nombre e identificación del cliente (Art. 11).'] }

// Con nombre y DNI (ficticios). Sin base exacta, el total queda 1 centavo por debajo (Ley del ISV, Art. 9).
await facturarPedido({
  id: '1003',
  cliente: { nombre: 'Persona Ejemplo', identificacion: { tipo: 'DNI', numero: '9999000000001' } },
  lineas: [{ descripcion: 'Televisor 55 pulgadas', cantidad: '1', precioUnitario: '12500.00' }],
});
// → { ok: true, numero: '000-002-01-00000003', total: 12499.99 }
```

Los números dependen de lo que ya emitió esa caja. Guarda el número con el pedido y pide el PDF con
`fhn.descargar(numero, 'pdf')`.

## Buenas prácticas de la integración

No son reglas fiscales: son la forma segura de integrar.

- **La llave vive solo en el servidor**, en variables de entorno. Nunca en el navegador.
- **Los precios salen de tu base**, no del navegador.
- **Sirve el PDF por pedido** (`/pedidos/:id/factura.pdf`), detrás de la sesión del cliente, nunca por número de
  factura: los números son consecutivos y cualquiera podría recorrerlos.
- **Muestra los errores 422 tal cual**: son reglas fiscales, con su solución.
- **Webhooks**: verifica la firma sobre el cuerpo crudo, descarta repetidos por `id` y responde 2xx solo cuando ya
  procesaste el aviso. Ver [Webhooks](/guias/webhooks/).

## Situaciones frecuentes

- **El pago se confirmó dos veces** (la pasarela reenvió el aviso). La misma clave `pedido-<id>` devuelve la misma
  factura; no se emite otra.
- **El cliente devuelve el producto.** Si la factura tiene su RTN, Nota de Crédito (06) sobre ella (Art. 4 num. 32;
  ver [Nota de Crédito](/documentos/nota-credito/)). Si se emitió con un error, un supervisor la anula
  (Art. 41).
- **El pedido se cancela antes de pagar.** No hay nada que emitir: la factura sale con el pago.

Siguiente: [Ir a producción](/produccion/).
