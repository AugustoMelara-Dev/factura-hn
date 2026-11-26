# @factura-hn/sqlite

`AlmacenFiscal` de [factura-hn](https://www.npmjs.com/package/factura-hn) sobre SQLite. Sirve para el POS fuera de línea y para la
instalación local en el negocio.

<!-- declaraciones:
import type { DocumentoEntrada } from 'factura-hn';
declare const entrada: DocumentoEntrada;
declare const cai: string;
-->
```ts
import { DatabaseSync } from 'node:sqlite'; // o: import Database from 'better-sqlite3'
import { emitir, registrarAutorizacion } from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';

// `entrada` es la venta (un DocumentoEntrada: emisor, cliente y líneas) y `cai`, el CAI de tu resolución del SAR.
const almacen = new AlmacenSQLite(new DatabaseSync('fiscal.db')); // o: new Database('fiscal.db')
// Una sola vez por base, no en cada arranque: registrar el mismo CAI otra vez da AUTORIZACION_DUPLICADA.
await registrarAutorizacion(almacen, { cai, tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
  rangoInicial: 1, rangoFinal: 5000, fechaLimiteEmision: '2027-06-30' }); // la de tu resolución
const doc = await emitir(entrada, { almacen, establecimiento: '000', puntoEmision: '001' });
```

## Qué garantiza

- **Sin huecos ni repetidos.** Cada transacción abre con `BEGIN IMMEDIATE`. Varias cajas, en el mismo proceso
  o en procesos distintos sobre el mismo archivo, se serializan. Si la base está ocupada, el adaptador espera
  de forma asíncrona (hasta `esperaMaxima`, 10 s por defecto) sin bloquear el hilo.
- **Todo o nada.** Si la validación, el guardado o tu gancho `alEmitir` fallan, se revierte y el número no se
  consume.
- **La base se protege sola.** Hay disparadores que impiden borrar documentos o autorizaciones, cambiar un
  documento emitido salvo para anularlo (Art. 41) y hacer retroceder la serie. Esto aplica aunque alguien
  edite la base a mano.

El esquema está en `ESQUEMA_SQLITE`, con tablas `fhn_*`. Se aplica al crear el almacén y es idempotente. Por
defecto pone la base en modo WAL; pasa `{ wal: false }` para no tocarlo.

Pasa la batería de contrato de `factura-hn/pruebas`, incluidas 50 emisiones concurrentes desde 5 conexiones.

**Respaldos:** el Código Tributario (Arts. 58.4 y 63.3) pide conservar la información 5 años en el domicilio
fiscal. Copia `fiscal.db` con `VACUUM INTO` o `.backup`; no copies el archivo mientras está abierto en WAL.

Documentación: [guía del SDK](https://augustomelara-dev.github.io/factura-hn/guias/sdk/).
