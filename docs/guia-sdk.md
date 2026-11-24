# Guía rápida del SDK

Esta guía es para un proyecto en JavaScript o TypeScript que emite facturas desde su propio servidor y guarda
los documentos en su propia base. Si tu proyecto es de otro lenguaje, o varias cajas emiten contra un servidor
central, usa la [API REST](api.md).

> Los datos de esta guía son ficticios: el CAI, los RTN (prefijo 9999) y los correos (`.example`). Usa los de
> tu resolución del SAR.

## 1. Instala

```bash
npm install factura-hn @factura-hn/sqlite      # una caja, fuera de línea (Node 22.13+)
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

La suma de las notas de crédito sobre un documento no puede superar su total: si lo hace, `emitir` lanza
`ErrorValidacion` con `NOTA_SUPERA_ORIGINAL` y el saldo disponible en el mensaje. Tampoco puede llevar ISV a una
tasa que el original no tenía (`NOTA_TASA_DISTINTA`). En ambos casos no se consume número.

## 7. Libro de ventas

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { filaLibroVentas, libroVentasCSV } from 'factura-hn';

const docs = await almacen.transaccion((tx) => tx.documentos({ desde: '2026-11-01', hasta: '2026-11-30' }));
const csv = libroVentasCSV(docs.map(filaLibroVentas)); // en lempiras; los anulados salen con su número y montos en cero
```

## Con un agente de IA

Pega este prompt en Claude Code, Cursor u otro agente, dentro de tu proyecto:

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

Siguiente: [qué cubre la librería](normativa.md) (de qué artículo sale cada regla).
