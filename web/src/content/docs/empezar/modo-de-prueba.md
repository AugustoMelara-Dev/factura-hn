---
title: Modo de prueba
description: El CAI ficticio, la leyenda de los documentos de prueba, por qué un punto de emisión es de prueba o real, cómo pasar al CAI de tu resolución y qué queda fuera de los reportes.
sidebar:
  order: 5
---

El modo de prueba deja emitir, imprimir, anular y hacer notas de crédito sin un CAI real. Todo lo que sale de
él dice que no tiene valor fiscal, y queda fuera de los reportes.

La leyenda y estas reglas son una marca del producto, no una regla fiscal: ningún artículo del Reglamento las
exige ni las regula. Sirven para que un documento de demostración nunca pase por uno real ([DEC-063](/referencia/decisiones/#dec-063--modo-de-prueba-visible)).

## El CAI ficticio

Una autorización es **de prueba** si su CAI empieza con `DEMO00-NO-VALIDO-` o si lleva `prueba: true`. Ningún
CAI emitido por la autoridad tributaria empieza así. `esCAIDemo(cai)` lo reconoce, sin importar mayúsculas ni
espacios en los extremos.

`factura-hn/demo` trae todo lo necesario para probar:

| Exportación | Qué es |
|---|---|
| `crearFacturadorDemo()` | Un facturador en memoria con CAI ficticios de factura (01), nota de crédito (06) y nota de débito (07) en la caja `000-001` |
| `autorizacionDemo({ hoy? })` | Una autorización ficticia: rango del 1 al 1,000,000 y fecha límite a 180 días de hoy en Honduras, con `prueba: true` |
| `EMISOR_DEMO` | El emisor ficticio «Pulpería Demostración», RTN `99990000000000` |
| `LEYENDA_PRUEBA` | El texto `DOCUMENTO DE PRUEBA — SIN VALOR FISCAL` |
| `esCAIDemo(cai)` · `esDocumentoDePrueba(doc)` | Reconocen un CAI ficticio y un documento de prueba |

```js
import { esDocumentoDePrueba } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

const caja = await crearFacturadorDemo();
const factura = await caja.emitir({
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '1', precioUnitario: '100.00' }],
});

factura.cai;                   // "DEMO00-NO-VALIDO-0000-0000-0000-01"
factura.modo;                  // "prueba"
esDocumentoDePrueba(factura);  // true
```

`autorizacionDemo` también sirve con tu propio almacén: `caja.registrarAutorizacion(autorizacionDemo())`.
Registrar `prueba: true` con un CAI que no es ficticio falla con
[`AUTORIZACION_PRUEBA_CAI_REAL`](/referencia/errores/#autorizacion_prueba_cai_real): así un CAI con forma real
nunca gasta números en documentos sin valor fiscal.

:::caution
No uses `factura-hn/demo` en producción. Ahí el CAI viene de tu resolución y se registra una vez, desde la
configuración de tu sistema.
:::

## La leyenda

Cada documento emitido con una autorización de prueba lleva `modo: 'prueba'`. Ese campo no cambia nunca, ni al
anular. Los tres formatos de impresión ponen la leyenda al inicio y al final:

- **HTML** (`renderizarHTML`): en un recuadro, y con «PRUEBA ·» en el título de la página;
- **texto** (`renderizarTexto`, el ticket de las impresoras térmicas): enmarcada con asteriscos;
- **PDF** (`@factura-hn/pdf`): en negrita, con una marca de agua «PRUEBA».

```text
******************************************
  DOCUMENTO DE PRUEBA — SIN VALOR FISCAL
******************************************
          Pulpería Demostración
```

Un documento real se imprime igual que siempre, sin leyenda.

## Un punto de emisión es de prueba o real

Un punto de emisión (establecimiento y punto, en todos sus tipos de documento) es de prueba o es real. Pasa de
prueba a real, nunca al revés ([DEC-091](/referencia/decisiones/#dec-091--un-punto-de-emisión-pasa-de-prueba-a-real-nunca-al-revés)):

- **De prueba a real:** registrar el CAI de tu resolución en un punto que solo tiene autorizaciones de prueba se
  acepta. Desde ese momento, las de prueba quedan retiradas en todos los tipos de ese punto: no se vuelven a
  usar. Los documentos de prueba ya emitidos no cambian.
- **De real a prueba:** una autorización de prueba en un punto que tiene o tuvo una real se rechaza con
  [`AUTORIZACION_MODO_MEZCLADO`](/referencia/errores/#autorizacion_modo_mezclado).
- **Las notas no cruzan:** una nota real sobre un documento de prueba, o al revés, falla con
  [`REFERENCIA_MODO_MEZCLADO`](/referencia/errores/#referencia_modo_mezclado).

Para volver a probar después de pasar a real, usa **otro almacén**: otra base de datos o un
`AlmacenFiscalMemoria`. No uses otro punto de emisión del almacén real: sus documentos de prueba se mezclarían
con los reales en las consultas.

## Pasar al CAI real

1. Cambia el emisor de prueba por los datos de tu negocio, tal como están en tu RTN.
2. Registra el CAI de **tu** resolución, sin `prueba: true`: `registrarAutorizacion` en el SDK,
   `POST /v1/autorizaciones` en la API o `npx -y @factura-hn/mcp registrar-cai` en el MCP. Ver
   [CAI](/conceptos/cai/#registrar-una-autorización).
3. Usa un almacén que guarde: `@factura-hn/sqlite` o `@factura-hn/postgres`. Ver
   [Almacén fiscal](/conceptos/almacen/).

Lo más simple es registrar el CAI real en un **almacén nuevo**. Si lo registras en el almacén donde probaste,
hay un límite: un número no se repite en una serie. Si ya emitiste documentos de prueba en esa caja y el rango
de tu resolución empieza en 1, el registro falla con
[`RANGO_USADO_EN_PRUEBA`](/referencia/errores/#rango_usado_en_prueba). Si el rango empieza después del último
número de prueba, se acepta.

Cada camino tiene además su propia protección:

- **API:** cada tenant es de prueba o de producción. Uno de prueba (el `demo`, con llaves `fhn_test_…`) solo
  acepta CAI ficticios (`AUTORIZACION_REAL_EN_DEMO`); uno de producción (llaves `fhn_live_…`) no acepta ninguno
  (`CAI_DE_PRUEBA`). Una llave `fhn_test_` no entra a un tenant de producción, ni al revés.
- **MCP:** la base de prueba (`factura-demo.db`) va aparte de la real (`factura.db`), y no acepta un CAI real.

Antes de emitir con tu CAI, revisa la lista de [Ir a producción](/produccion/).

## Qué queda fuera de los reportes

Los documentos de prueba no son ventas. Quedan fuera de:

- **el libro de ventas:** `libroVentas(docs)` devuelve `{ filas, resumen, excluidos }` sin ellos, y `excluidos`
  dice cuántos dejó fuera;
- **la exportación a texto:** `exportarTexto` (CSV, TXT y JSONL) no los incluye. Para saber cuántos quedaron
  fuera, usa `separarDocumentosDePrueba(docs).excluidos`;
- **los documentos no utilizados:** `documentosNoUtilizados` omite las autorizaciones de prueba. Un CAI ficticio
  no es una autorización que haya que reportar ([DEC-094](/referencia/decisiones/#dec-094--no-utilizados-sin-las-autorizaciones-de-prueba)).

`filaLibroVentas` y `lineaExportacion` trabajan documento por documento y no filtran: si armas el archivo por
partes, pasa antes los documentos por `separarDocumentosDePrueba`.

En la API, la cabecera `Documentos-Prueba-Excluidos` (y `excluidos` en el libro en JSON) dice cuántos quedaron
fuera. En el tenant `demo` quedan fuera todos.
