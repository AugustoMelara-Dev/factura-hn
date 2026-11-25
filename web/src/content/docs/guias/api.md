---
title: API REST
description: Guía de entrada de la API REST de factura-hn — para quién es, cómo levantarla con Docker, emitir desde cualquier lenguaje y la referencia OpenAPI.
sidebar:
  label: API REST
  hidden: true
---

La API REST de factura-hn emite por ti: tu sistema envía la venta por HTTP y recibe el documento con su número, y
el PDF, el HTML o el texto impreso. Corre en tu servidor con Docker y PostgreSQL; por dentro aplica el mismo SDK.

**Úsala si** tu sistema está en otro lenguaje que JavaScript, o si varias cajas deben emitir contra un mismo
servidor del negocio.

## Levántala

Con Docker y Compose v2, desde un clon del repositorio:

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git && cd factura-hn
docker compose up -d --build --wait     # API en http://127.0.0.1:8787
```

Los pasos para obtener la llave de caja del tenant de prueba y emitir con curl están en
[Tu primera factura](/empezar/primera-factura/#api-rest-docker). Sin instalar nada, [Pruébalo ahora](/probar/)
crea un entorno de prueba en la demostración pública, cuando está en línea.

## Lo esencial

- **Llaves por punto de emisión.** Cada caja usa una llave atada a su establecimiento y punto de emisión.
- **Idempotencia.** Cada emisión lleva `Idempotency-Key`: un reintento de la misma venta devuelve el mismo
  documento, no otro.
- **Errores que dicen qué hacer.** `{ "error": { "codigo", "mensaje", "solucion" } }`, y en un 422 la lista
  completa de problemas fiscales.
- **Webhooks firmados** para enterarte de cada emisión o anulación.

## Desde TypeScript

El cliente tipado `@factura-hn/cliente` se genera del OpenAPI:

```ts
import { crearCliente } from '@factura-hn/cliente';

const fhn = crearCliente({ url: 'http://127.0.0.1:8787', llave: process.env.FHN_LLAVE! });
const { documento } = await fhn.emitir(
  { documento: { preciosIncluyenISV: true, lineas: [{ descripcion: 'Café', cantidad: 2, precioUnitario: '57.50' }] } },
  { idempotencyKey: crypto.randomUUID() },
);
```

Desde otro lenguaje, genera el cliente desde `openapi.json`. La llave va solo en el servidor, nunca en código que
llega al navegador.

## Sigue con

- [Guía de la API](/referencia/api/): autenticación y roles, recursos, emisión, webhooks y seguridad.
- [Rutas y esquemas](/referencia/openapi/): la referencia generada del OpenAPI.
- [Autoalojar](/guias/autoalojar/): instalarla en un equipo del negocio, con respaldos y varias cajas.
- [Webhooks](/guias/webhooks/) y [varias cajas](/guias/varias-cajas/).
