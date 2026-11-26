---
title: Varias cajas y sucursales
description: Cómo emitir desde varias cajas sin repetir ni saltar números, con un punto de emisión por caja, un CAI por punto y tipo, y una llave de caja por punto en la API.
sidebar:
  order: 2
---

Cada caja que emite documentos es un **punto de emisión**. El número de un documento lleva el establecimiento, el
punto de emisión y el tipo: `000-002-01-00000015` es la factura 15 de la caja `002` del establecimiento `000`
(Reglamento, Art. 10 num. 7). Esos tres primeros grupos forman el **identificador** de la serie.

## Las reglas

- **Una serie por identificador.** El correlativo se lleva por `establecimiento-puntoEmision-tipo`, no por CAI.
  Cada caja tiene su propia numeración, que empieza en el primer número de su rango.
- **Un CAI por punto de emisión y por tipo.** La autorización se otorga por punto de emisión y por tipo de
  documento (Art. 59). Una caja que emite facturas y notas de crédito necesita dos CAI: uno de tipo `01` y otro de
  tipo `06`.
- **Las autorizaciones se suceden.** Cuando el SAR otorga un rango nuevo para la misma caja, se registra en el
  mismo identificador y la numeración continúa de una autorización a la siguiente.
- **Una serie, un almacén.** Dos procesos pueden emitir en la misma serie solo si comparten el mismo almacén
  transaccional: la misma base Postgres, o el mismo archivo SQLite en la misma máquina. El almacén bloquea la serie
  mientras emite, así que dos cajas a la vez no repiten ni saltan números.

## Los tres modelos del Art. 48

El Reglamento admite tres estructuras para un sistema en red (Art. 48). En factura-hn se eligen con los puntos de
emisión que registras ante el SAR y con dónde vive el almacén:

| Estructura | Numeración | Cómo se configura |
|---|---|---|
| Centralizado | Una para todo el país | Un único punto de emisión (p. ej. `000-001`) en un almacén central. Todas las cajas llaman a la misma API o base; el bloqueo de la serie ordena los números |
| Regional | Una por región | Un punto de emisión por región (`000-001` norte, `000-002` sur), cada uno con sus autorizaciones; un almacén por región o uno central |
| Por sucursal | Varias, por sucursal | Un establecimiento por sucursal y un punto de emisión por caja (`001-001`, `001-002`, …) |

El modelo por sucursal, con un punto por caja, es el que permite que una caja emita sin conexión con las demás.
Ver [Fuera de línea](/guias/fuera-de-linea/).

## Con el SDK

Un facturador por caja, todos sobre el mismo almacén. Cada caja registra sus propias autorizaciones:

```ts
import { AlmacenFiscalMemoria, crearFacturador } from 'factura-hn';
import { EMISOR_DEMO } from 'factura-hn/demo';

const almacen = new AlmacenFiscalMemoria(); // en producción, uno compartido: AlmacenPostgres
const cajas = ['001', '002'].map((puntoEmision) =>
  crearFacturador({ almacen, emisor: EMISOR_DEMO, establecimiento: '000', puntoEmision, preciosIncluyenISV: true }),
);

for (const caja of cajas) {
  // En producción, el CAI, el rango y la fecha límite de la resolución de esa caja, sin `prueba`.
  await caja.registrarAutorizacion({
    cai: `DEMO00-NO-VALIDO-CAJA-${caja.puntoEmision}-01`,
    prueba: true,
    tipoDocumento: '01',
    rangoInicial: 1,
    rangoFinal: 5000,
    fechaLimiteEmision: '2027-06-30',
  });
}

const [caja1, caja2] = cajas;
const venta = { lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }] };
const [a, b] = await Promise.all([caja1.emitir(venta), caja2.emitir(venta)]);
a.numero; // '000-001-01-00000001'
b.numero; // '000-002-01-00000001': otra serie, su propia numeración
```

`registrarAutorizacion` del facturador toma el establecimiento y el punto de emisión de la caja si la autorización
no los trae. Si los trae, mandan los de la autorización.

## Con la API REST

La API corre sobre Postgres y bloquea la serie en cada emisión (`SELECT … FOR UPDATE`). Varias cajas pueden emitir
a la vez contra el mismo servidor. Los pasos, con la llave admin del negocio:

1. **Registra el CAI de cada caja** con `POST /v1/autorizaciones`, indicando `establecimiento` y `puntoEmision`
   en cada una. Uno por punto y por tipo.
2. **Crea una llave de caja por punto de emisión** con `POST /v1/llaves`:
   `{ "nombre": "Caja 2", "rol": "caja", "establecimiento": "000", "puntoEmision": "002" }`. O desde la consola del
   operador:

   ```bash
   docker compose exec api factura-hn-api llave crear local --rol caja --nombre "Caja 2" --caja 000-002
   ```

   La llave completa se muestra una sola vez.
3. **Configura cada caja con su llave.** Una llave de caja emite solo en su punto: no hace falta enviar
   `establecimiento` ni `puntoEmision`, los pone la llave.

Una llave de caja no puede registrar CAI, anular ni exportar: eso es de la llave admin. La llave admin puede emitir
en cualquier punto, indicando `establecimiento` y `puntoEmision`. Los permisos completos están en la
[referencia de la API](/referencia/api/).

Si varias personas usan la misma caja, envía el nombre de quien cobra en `operador` (o en la cabecera
`X-Operador`): queda en la bitácora junto a la llave.

`GET /v1/sesion` dice, con la llave de cada caja, si ya puede emitir y qué le falta: emisor, CAI, punto de emisión.

Para un negocio, usa el modo local: la API en un servidor del propio negocio, en su establecimiento (el Art. 47
pide registrar «el establecimiento donde se encuentre el servidor»).
Ver [Autoalojar la API](/guias/autoalojar/).

## Errores frecuentes

| Código | Causa habitual |
|---|---|
| [`SIN_AUTORIZACION`](/referencia/errores/#sin_autorizacion) | La caja no tiene CAI de ese tipo; el CAI se registró en otro punto de emisión |
| [`RANGO_SOLAPADO`](/referencia/errores/#rango_solapado) | El rango nuevo comparte números con otro CAI de la misma serie |
| [`AUTORIZACION_DUPLICADA`](/referencia/errores/#autorizacion_duplicada) | Ese CAI ya está registrado en la serie, por ejemplo porque el registro corre en cada arranque |
| [`CAJA_NO_AUTORIZADA`](/referencia/errores/#caja_no_autorizada) | La llave de caja pidió emitir en otro punto: omite `establecimiento` y `puntoEmision` |
| [`CAJA_SIN_PUNTO`](/referencia/errores/#caja_sin_punto) | La llave de caja no está atada a un punto de emisión |
| [`CAJA_INCOMPLETA`](/referencia/errores/#caja_incompleta) | Al crear la llave se indicó solo el establecimiento o solo el punto de emisión |
| [`PUNTO_EMISION_REQUERIDO`](/referencia/errores/#punto_emision_requerido) | Una llave admin emitió sin decir en qué caja |
| [`SOLO_ADMIN`](/referencia/errores/#solo_admin) | Una llave de caja intentó registrar un CAI, anular o exportar |

## Fuentes

- Reglamento, Arts. 10 num. 7, 47, 48 y 59: matriz de [cumplimiento](/referencia/cumplimiento/).
- [Almacén fiscal](/conceptos/almacen/), «Sistemas en red», y la [referencia de la API](/referencia/api/), «Autenticación y
  roles».
