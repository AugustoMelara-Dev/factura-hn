# Persistencia: `AlmacenFiscal`

`factura-hn` emite siempre sobre un `AlmacenFiscal`. `emitir` bloquea la serie, elige la autorización, valida,
construye y guarda el documento en una transacción. Si algo falla, el número no se consume.

## Qué almacén usar

| Proyecto | Almacén |
|---|---|
| PostgreSQL, Supabase, Neon, RDS… | `@factura-hn/postgres` → `new AlmacenPostgres(pool)` y `await almacen.migrar()` |
| POS fuera de línea, Electron, instalación local | `@factura-hn/sqlite` → `new AlmacenSQLite(new Database('fiscal.db'))` |
| Pruebas y demos | `AlmacenFiscalMemoria` (se pierde al reiniciar) |
| Otra base (MySQL, SQL Server, IndexedDB…) | Implementa `AlmacenFiscal` y hazlo pasar la batería de contrato (abajo) |

Los dos adaptadores crean sus tablas `fhn_*` y además las protegen con disparadores: no se pueden borrar
documentos ni autorizaciones, un documento emitido solo puede pasar a ANULADO y la serie nunca retrocede.
Esto se cumple aunque alguien edite la base a mano.

## Reglas que cumple cualquier almacén

1. **Una serie por identificador** `NNN-NNN-TT` (establecimiento, punto de emisión y tipo; Reglamento Art. 10
   num. 7), no por CAI. Un identificador acumula autorizaciones con el tiempo y la numeración continúa de una
   a otra.
2. **Sin huecos ni repetidos.** Dos cajas que emiten a la vez se serializan en la serie.
3. **Todo o nada.** El documento se guarda en la misma transacción que consume el número. Lo que falle
   *después* de confirmar (impresión, pago) se resuelve anulando con `anular` (Art. 41), nunca borrando.
4. **Inmutable.** El documento guardado no se modifica; solo pasa de EMITIDO a ANULADO. Una factura se corrige
   con Nota de Crédito (06) o de Débito (07).
5. **Conservación.** El Código Tributario (Arts. 58.4 y 63.3) pide conservar la información 5 años en el
   domicilio fiscal. Haz respaldos.

## Sistemas en red (Art. 48)

El Reglamento admite tres estructuras (Art. 48, C L.2083-2115). En factura-hn cada serie es un
identificador `establecimiento-puntoEmision-tipo`, así que la estructura se elige con los puntos de emisión
que se registran ante el SAR y con dónde vive el almacén:

| Estructura | Numeración | Cómo se configura |
|---|---|---|
| Centralizado | Una sola para todo el país | Un único establecimiento y punto de emisión (p. ej. `000-001`) en un almacén central (Postgres). Todas las cajas llaman a la misma API o base; el bloqueo de la serie ordena los números |
| Regional | Una por región | Un punto de emisión por región (p. ej. `000-001` norte, `000-002` sur), cada uno con sus autorizaciones; puede ser un almacén por región o uno central |
| Por sucursal | Varias, por sucursal | Un establecimiento por sucursal y uno o más puntos de emisión por caja (`001-001`, `001-002`, …). Con SQLite, cada caja fuera de línea tiene su propio punto de emisión: dos cajas nunca comparten serie sin un almacén común |

La regla de oro: **una serie, un almacén**. Dos procesos pueden emitir en la misma serie solo si comparten
el mismo almacén transaccional (Postgres, o el mismo archivo SQLite en la misma máquina).

## Escribir tu propio almacén

Implementa dos interfaces:

```ts
interface AlmacenFiscal {
  transaccion<T>(fn: (tx: TransaccionFiscal) => Promise<T>): Promise<T>; // todo o nada
}

interface TransaccionFiscal {
  bloquearSerie(identificador: string): Promise<EstadoSerie>;   // bloqueo exclusivo hasta el fin
  autorizaciones(identificador: string): Promise<AutorizacionCAI[]>;
  guardarAutorizacion(autorizacion: AutorizacionCAI): Promise<void>;
  guardarDocumento(doc: DocumentoFiscal): Promise<void>;        // y avanza la serie
  guardarAnulacion(doc: DocumentoFiscal): Promise<void>;
  buscarDocumento(numero: string): Promise<DocumentoFiscal | null>;
  documentos(filtro?: FiltroDocumentos): Promise<DocumentoFiscal[]>;
  registrarEvento(evento: EventoAuditoria): Promise<void>;     // bitácora: solo inserción
  eventos(filtro?: FiltroEventos): Promise<EventoAuditoria[]>;  // en orden de registro

  // Opcionales: optimizaciones para períodos grandes.
  paginaDocumentos?(filtro: FiltroDocumentos, pagina: PaginaDocumentos): Promise<ResumenDocumento[]>;
  contarDocumentos?(filtro: FiltroDocumentos): Promise<number>;
  correlativos?(identificador: string): Promise<number[]>;
}
```

Las tres últimas son opcionales. `paginaDocumentos` lee los documentos por páginas (los reportes de período la
usan para no cargar todo el período en memoria), `contarDocumentos` los cuenta y `correlativos` da los números de
una serie. Sin ellas, el core usa `documentos(filtro)` y filtra o cuenta en memoria: el resultado es el mismo,
con más memoria en períodos grandes. Si implementas `paginaDocumentos`, devuelve los documentos en orden de número
y empieza después de `despuesDe`: una página que no avanza es un error.

`EstadoSerie.ultimaFecha` es la fecha más reciente entre los documentos **EMITIDOS** de la serie; al anular,
recalcúlala (así un documento anulado por fecha errónea deja de trabar la serie).

Las validaciones (solapamiento de rangos, vigencia, cálculo) las hace el core; el almacén solo guarda y
bloquea. Para el bloqueo, en MySQL o SQL Server usa `SELECT … FOR UPDATE` / `WITH (UPDLOCK, ROWLOCK)` sobre la
fila de la serie; en IndexedDB, una transacción `readwrite` sobre el almacén de series.

Después corre la batería de contrato con tu framework de pruebas:

```ts
import { describe, it } from 'vitest';
import { ejecutarContratoAlmacen } from 'factura-hn/pruebas';

ejecutarContratoAlmacen({ describe, it }, {
  nombre: 'MySQL',
  crear: async () => crearAlmacenVacio(),             // un almacén aislado por prueba
  otraConexion: async (a) => otraConexionAlMismo(a),  // otra «caja» sobre los mismos datos
});
```

La batería verifica la numeración consecutiva, la continuidad entre autorizaciones, el salto de CAI vencidos,
que un fallo no consuma número, la anulación, el orden cronológico, el procedimiento ante reloj adelantado, la
bitácora y 50 emisiones concurrentes desde 5 conexiones. Si quitas el bloqueo de la serie, la prueba de concurrencia falla.
