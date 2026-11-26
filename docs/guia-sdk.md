# Guía rápida del SDK

Esta guía es para un proyecto en JavaScript o TypeScript que emite facturas desde su propio servidor y guarda
los documentos en su propia base. Si tu proyecto es de otro lenguaje, o varias cajas emiten contra un servidor
central, usa la [API REST](api.md).

> Los datos de esta guía son ficticios: el CAI, los RTN (prefijo 9999) y los correos (`.example`). Usa los de
> tu resolución del SAR.

## 0. Prueba en un minuto

Sin CAI real ni base de datos, para ver una factura antes de configurar nada:

```bash
npx factura-hn demo     # emite una factura de prueba y escribe factura-demo.html
npx factura-hn init     # crea emitir.mjs y emisor.json en este directorio
node emitir.mjs         # emite con los datos de emisor.json y escribe factura.html
```

Lo mismo en código, con `factura-hn/demo`: un facturador en memoria con CAI ficticios de factura, nota de
crédito y nota de débito ya registrados.

```ts
import { writeFile } from 'node:fs/promises';
import { renderizarHTML } from 'factura-hn';
import { crearFacturadorDemo } from 'factura-hn/demo';

const facturador = await crearFacturadorDemo();
const factura = await facturador.emitir({
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
});
await writeFile('factura.html', renderizarHTML(factura));
```

Todo lo que se emite así lleva `modo: 'prueba'` y se imprime con la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR
FISCAL» (`LEYENDA_PRUEBA`) en el HTML, el texto y el PDF. Para facturar de verdad, sigue desde el paso 1.

## 1. Instala

```bash
npm install factura-hn @factura-hn/sqlite      # una caja, fuera de línea (Node 20+ con better-sqlite3; 22.13+ con node:sqlite)
npm install factura-hn @factura-hn/postgres pg # un servidor con varias cajas
npm install @factura-hn/pdf                    # opcional: PDF carta y ticket
```

`factura-hn` no tiene dependencias. Los montos se pasan como texto (`'89.50'`) y el cálculo es exacto.

## 2. Abre el almacén fiscal

El almacén guarda autorizaciones, documentos y bitácora, y reserva cada número en la misma transacción que
guarda el documento. Usa uno de los probados: no calcules el siguiente número por tu cuenta.

```ts
import { DatabaseSync } from 'node:sqlite';
import { AlmacenSQLite } from '@factura-hn/sqlite';

// Un archivo en el equipo de la caja; crea las tablas fhn_* si no existen.
const almacen = new AlmacenSQLite(new DatabaseSync('./factura.db'));
```

Con PostgreSQL: `new AlmacenPostgres(pool)` y `await almacen.migrar()` (ver [persistencia](persistencia.md)).

## 3. Registra el CAI (una vez por resolución)

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { registrarAutorizacion } from 'factura-hn';

await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', // de la resolución del SAR
  tipoDocumento: '01',                          // 01 = Factura, 06 = Nota de Crédito, 07 = Nota de Débito
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30', // la fecha límite de la resolución
});

// Si vas a emitir notas de crédito, registra también la autorización de la serie 06.
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06',
  tipoDocumento: '06',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 500,
  fechaLimiteEmision: '2027-06-30',
});
```

Cada tipo de documento y cada punto de emisión tiene su propia autorización y su propia serie. Los datos
salen de la pantalla de configuración de tu sistema, no del código.

## 4. Emite en cada venta

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { emitir, ErrorValidacion, renderizarTexto } from 'factura-hn';

const emisor = {
  rtn: '99990000000001',
  razonSocial: 'Inversiones Ejemplo S. de R.L.',
  nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

try {
  const factura = await emitir(
    {
      emisor,
      preciosIncluyenISV: true,
      lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }],
    },
    { almacen, establecimiento: '000', puntoEmision: '001', actor: 'caja-1', operador: 'María' },
  );
  console.log(factura.numero, factura.totales.total); // cobra totales.total
  console.log(renderizarTexto(factura, { ancho: 42 })); // ticket de 80 mm
} catch (e) {
  // Reglas fiscales: muestra los mensajes tal cual. Un error no consume número.
  if (e instanceof ErrorValidacion) console.error(e.errores.map((p) => p.mensaje));
  else throw e;
}
```

- `actor` y `operador` quedan en la bitácora (quién emitió). Para imprimir «Atendido por», agrega
  `operador` a la entrada.
- Con `preciosIncluyenISV: true` el total puede quedar un centavo por debajo del precio (redondeo del Art. 9
  de la Ley del ISV): cobra siempre `totales.total`.
- La fecha la pone el reloj en hora de Honduras. No se puede retrofechar.

## 5. Imprime y reimprime

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { buscarDocumento, renderizarHTML } from 'factura-hn';
import { renderizarPDF } from '@factura-hn/pdf';

const doc = await buscarDocumento(almacen, '000-001-01-00000001');
if (doc) {
  const html = renderizarHTML(doc);                        // carta, para el navegador
  const pdf = await renderizarPDF(doc, { formato: 'ticket' }); // bytes del PDF
}
```

Reimprime siempre desde el documento guardado: es idéntico al original (Art. 38).

## 6. Anula o corrige

Un documento emitido no se borra ni se edita. Hay dos caminos, según el caso:

- **El documento tuvo un error** (cantidad, cliente, precio): se anula (Art. 41) y se emite uno nuevo. El
  número anulado sigue consumido.
- **La venta fue correcta y luego hay una devolución o un descuento**: se emite una Nota de Crédito sobre el
  documento, que debe estar vigente (no anulado) y tener el RTN del cliente (Art. 26 num. 1-2).

Un documento con notas de crédito o débito vigentes no se anula (`DOCUMENTO_CON_NOTAS`): anula primero las notas.

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { anular } from 'factura-hn';

// Anular: la factura del paso 4 tenía un error en la cantidad.
await anular('000-001-01-00000001', { almacen, motivo: 'Error en la cantidad', actor: 'supervisor' });
```

<!-- declaraciones:
import type { AlmacenFiscal, Emisor } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const emisor: Emisor;
-->
```ts
import { emitir } from 'factura-hn';

// Una venta a un cliente con RTN…
const original = await emitir(
  {
    emisor,
    cliente: { nombre: 'Constructora Ejemplo S. A.', rtn: '99990000000002' },
    preciosIncluyenISV: true,
    lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }],
  },
  { almacen, establecimiento: '000', puntoEmision: '001', operador: 'María' },
);

// …y su Nota de Crédito (06) por la devolución de 1 unidad. La serie 06 requiere su propia autorización.
const nota = await emitir(
  {
    tipoDocumento: '06',
    emisor,
    cliente: { nombre: original.cliente.nombreImpreso, rtn: original.cliente.rtn },
    referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision },
    motivo: 'Devolución de mercadería',
    preciosIncluyenISV: original.preciosIncluyenISV,
    lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }],
  },
  { almacen, establecimiento: '000', puntoEmision: '001', operador: 'María' },
);
console.log(nota.numero, nota.advertencias); // 000-001-06-00000001 []
```

La suma de las notas de crédito sobre un documento no puede superar su total, ni a cada tasa (15 % y 18 %) su
importe gravado y su ISV, ni su importe exento o gravado al 0 %: si lo hace, `emitir` lanza `ErrorValidacion` con
`NOTA_SUPERA_ORIGINAL` y el saldo disponible en el mensaje. Tampoco puede llevar ISV a una tasa, ni importe exento
o gravado al 0 %, que el original no tenía (`NOTA_TASA_DISTINTA`). En
ambos casos no se consume número. Si el original es exonerado y la nota no (o al revés), la nota se emite con el
aviso `AVISO_NOTA_EXONERACION_DISTINTA`.

## 7. Libro de ventas

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { libroVentas, libroVentasCSV } from 'factura-hn';

const docs = await almacen.transaccion((tx) => tx.documentos({ desde: '2026-11-01', hasta: '2026-11-30' }));
// libroVentas deja fuera los documentos de prueba; filaLibroVentas sola no los filtra.
const { filas } = libroVentas(docs);
const csv = libroVentasCSV(filas); // en lempiras; los anulados salen con su número y montos en cero
```

Para los archivos de texto del Art. 53 num. 5 está `exportarTexto(docs, { formato })`: `jsonl` (un documento
completo por línea; se lee con `leerExportacionJSONL`), `csv` y `txt` (separador `|`, encabezado
`#factura-hn|v2|N`, con N documentos). El CSV y el TXT llevan una fila por documento con estas columnas: `numero,
tipo, fecha, hora, cai, estado, emisorRTN, clienteRTN, clienteNombre, moneda, exonerado, exento, gravado0,
gravado15, gravado18, isv15, isv18, descuentos, total, referencia, motivoAnulacion, tipoCambio, fechaAnulacion`.
Los importes van en la moneda del documento; `tipoCambio` va vacío en lempiras y `fechaAnulacion`, si no está
anulado. La versión 2 (`VERSION_EXPORTACION`) agregó esas dos al final: las 21 primeras son las de la versión 1,
en el mismo orden, así que un lector de la 1 sigue funcionando si lee por nombre o se queda con las 21 primeras.

## 8. Con `crearFacturador`: la configuración una sola vez

`crearFacturador` guarda lo que es del negocio (almacén, emisor y caja) y en cada venta recibe solo lo que es de
la venta. Por dentro llama a `emitir`, `anular` y `registrarAutorizacion`: misma transacción, mismas
validaciones y misma bitácora. Valida el almacén y el emisor al crearse, así un error de configuración sale al
arrancar y no en la primera venta.

<!-- declaraciones:
import type { AlmacenFiscal, Emisor } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const emisor: Emisor;
-->
```ts
import { crearFacturador } from 'factura-hn';

// Una vez, al arrancar el servidor o la caja. Este almacén es otro que el de los pasos 2 a 7 (allí ya se
// registró el CAI de la serie 000-001-01 y la numeración siguió).
const caja = crearFacturador({ almacen, emisor, establecimiento: '000', puntoEmision: '001', preciosIncluyenISV: true });

// Una vez por resolución del SAR: establecimiento y punto de emisión los pone el facturador.
await caja.registrarAutorizacion({
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', tipoDocumento: '01',
  rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: '2027-06-30',
});
// La nota de crédito de abajo necesita el CAI de su tipo (06).
await caja.registrarAutorizacion({
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-06', tipoDocumento: '06',
  rangoInicial: 1, rangoFinal: 500, fechaLimiteEmision: '2027-06-30',
});

// En cada venta.
const { totales } = caja.cotizar({ lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }] });
const factura = await caja.emitir(
  { cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' }, lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }] },
  { operador: 'María' },
);

// Nota de crédito: el cliente, la referencia y la moneda se toman del original guardado.
const nota = await caja.notaCredito({
  original: factura.numero,
  motivo: 'Devolución de 1 bolsa',
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }],
});

await caja.anular(nota.numero, 'Nota duplicada');
const guardada = await caja.documento(factura.numero);
const delMes = await caja.documentos({ desde: '2026-11-01', hasta: '2026-11-30' });
console.log(totales.total, guardada?.estado, delMes.length);
```

`notaCredito` y `notaDebito` necesitan el CAI de su tipo (`06` y `07`) registrado en la misma caja. Si el
original no está en el almacén (talonario u otro sistema), pasa `referencia` y `cliente` completos.

## 9. Errores que dicen qué hacer

`ErrorValidacion.errores` trae, en cada problema, `codigo`, `mensaje` y `campo`, y en los del SDK también
`solucion` (qué hacer) y `documentacion` (enlace al [catálogo de errores](errores.md)). El `message` del error
los incluye, así que un log o una consola ya dicen cómo resolverlo. Usa `esErrorValidacion(e)` en lugar de
`instanceof` si tu proyecto puede cargar el paquete dos veces (ESM y CJS).

## 10. Modo de prueba

Una autorización es de prueba si tiene un CAI ficticio, que empieza con `DEMO00-NO-VALIDO-` (`esCAIDemo`), como
la de `autorizacionDemo()`. Con `prueba: true` y un CAI real, el registro falla (`AUTORIZACION_PRUEBA_CAI_REAL`).
Cada documento que emite lleva `modo: 'prueba'`; ese campo no cambia nunca, ni al anular. `renderizarHTML`,
`renderizarTexto` y `@factura-hn/pdf` imprimen la leyenda `LEYENDA_PRUEBA` al inicio y al final. Un documento real
se imprime igual que siempre.

- Un punto de emisión pasa de prueba a real, nunca al revés: el que tiene o tuvo un CAI real no recibe
  autorizaciones de prueba (`AUTORIZACION_MODO_MEZCLADO`). Una nota no cruza de un modo a otro
  (`REFERENCIA_MODO_MEZCLADO`).
- Para pasar a producción en el mismo almacén, registra el CAI real; la demo de ese punto queda retirada (en
  todos sus tipos) y los documentos de prueba ya emitidos no cambian. Sus números no se repiten: si ya emitiste
  documentos de prueba y tu rango empieza en 1, registra el CAI en un almacén nuevo (`RANGO_USADO_EN_PRUEBA`).
- Prueba en **otro almacén** (otra base de datos, o `AlmacenFiscalMemoria`), no en otro punto del almacén real.
- `exportarTexto` y `libroVentas` dejan fuera los documentos de prueba (`filaLibroVentas` y `lineaExportacion`
  no filtran). `separarDocumentosDePrueba(docs)` dice
  cuántos quedaron fuera; úsala también si armas el archivo por partes con `lineaExportacion` o `filaLibroVentas`.

## Con un agente de IA

Pega este prompt en Claude Code, Cursor u otro agente, dentro de tu proyecto:

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

Siguiente: [qué cubre la librería](normativa.md) (de qué artículo sale cada regla).
