# AGENTS.md — cómo integrar `factura-hn` en un proyecto

Instrucciones para agentes de IA (Claude, Cursor, OpenCode, Codex…) que integran facturación SAR Honduras.
Léelo completo antes de escribir código.

## Principios no negociables

1. **No inventes reglas fiscales.** Usa `validarEntrada` y `emitir`, y muestra al usuario los mensajes de
   `ErrorValidacion.errores` tal cual (traen `codigo`, `mensaje` y `campo`).
2. **Un solo camino.** Se emite con `emitir` y se anula con `anular`, siempre sobre un `AlmacenFiscal`. No
   calcules el siguiente número por tu cuenta ni guardes el documento en otra transacción.
3. **Usa un almacén probado.** `@factura-hn/postgres` (`AlmacenPostgres`) o `@factura-hn/sqlite`
   (`AlmacenSQLite`). Si el proyecto usa otra base, implementa `AlmacenFiscal` y hazlo pasar la batería
   `ejecutarContratoAlmacen` de `factura-hn/pruebas` (ver `docs/persistencia.md`). `AlmacenFiscalMemoria` es
   solo para pruebas.
4. **Números inmutables.** Un número emitido no se borra ni se reutiliza. Si algo falla después de emitir (la
   impresión, el pago), anula el documento con `anular`. Una factura emitida se corrige con Nota de Crédito
   (`tipoDocumento: '06'`) o de Débito (`'07'`).
5. **Server-side.** La emisión corre en el servidor (API route, server action, servicio local del POS). El
   cliente solo envía el carrito. Las credenciales de la base nunca van al navegador.
6. **Cobra `totales.total`, no la suma de precios.** Con `preciosIncluyenISV: true` el total puede quedar
   1 centavo por debajo (`totales.ajustePorRedondeo`) para cumplir el redondeo del Art. 9 de la Ley del ISV.
   Llama a `calcularDocumento` antes de cobrar y muestra en caja ese total. Para evitar el ajuste, usa
   `sugerirPrecioSinAjuste` al configurar los precios.
7. **Datos de CAI desde la base**, cargados por el usuario desde su resolución del SAR con
   `registrarAutorizacion`. No los hardcodees y no inventes CAI de ejemplo en código de producción.
8. **Montos como texto exacto** (`'89.50'`) cuando vengan de la base de datos; evita pasar por `float`.

## Configuración (una vez)

```ts
import pg from 'pg';
import { registrarAutorizacion } from 'factura-hn';
import { AlmacenPostgres } from '@factura-hn/postgres';

const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await almacen.migrar(); // tablas fhn_*; idempotente

// Desde la pantalla de configuración, con los datos de la resolución del SAR:
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
});
```

Cada tipo de documento (01, 06, 07) y cada punto de emisión tiene **su propia autorización y su propia
serie**. Cuando el SAR otorga un rango nuevo, se registra igual; la numeración continúa sola.

## Mapeo carrito → `DocumentoEntrada`

<!-- declaraciones:
import type { Emisor, TratamientoISV } from 'factura-hn';
declare const emisor: Emisor;
declare const cliente: { nombre: string; rtn?: string; dni?: string } | undefined;
declare const carrito: { sku: string; nombre: string; cantidad: string; precio: string; descuento?: string;
  producto: { tratamientoISV: TratamientoISV } }[];
-->
```ts
import type { DocumentoEntrada } from 'factura-hn';

const entrada: DocumentoEntrada = {
  tipoDocumento: '01',
  emisor,                                   // de la configuración del negocio
  cliente: cliente?.rtn
    ? { nombre: cliente.nombre, rtn: cliente.rtn }
    : cliente?.dni
      ? { nombre: cliente.nombre, identificacion: { tipo: 'DNI', numero: cliente.dni } }
      : undefined,                          // → "CONSUMIDOR FINAL"
  preciosIncluyenISV: true,                 // la mayoría de POS guardan precio de góndola con ISV
  lineas: carrito.map((i) => ({
    codigo: i.sku,
    descripcion: i.nombre,
    cantidad: i.cantidad,                   // texto exacto desde la base: '2' o '1.5'
    precioUnitario: i.precio,               // '89.50'
    isv: i.producto.tratamientoISV,         // 'ISV15' | 'ISV18' | 'EXENTO', guardado en el producto
    descuento: i.descuento ?? '0',          // monto, no porcentaje
  })),
  condicionPago: 'CONTADO',
};
```

Si el cliente presenta Orden de Compra Exenta, agrega
`exoneracion: { ordenCompraExenta, constanciaRegistroExonerado, registroSAG? }`.

## Servicio de emisión (patrón)

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const contabilidad: { asentar(doc: unknown): Promise<void> };
-->
```ts
import { anular, emitir, ErrorValidacion, renderizarHTML, type DocumentoEntrada } from 'factura-hn';

export async function emitirFactura(entrada: DocumentoEntrada, caja: { establecimiento: string; puntoEmision: string }) {
  try {
    const doc = await emitir(entrada, {
      almacen,
      ...caja,
      // Dentro de la misma transacción: si el asiento falla, no se consume el número.
      alEmitir: async (d) => contabilidad.asentar(d),
    });
    return { ok: true as const, doc, html: renderizarHTML(doc) };
  } catch (e) {
    if (e instanceof ErrorValidacion) return { ok: false as const, errores: e.errores };
    throw e;
  }
}

// Si la impresión o el cobro fallan DESPUÉS de emitir, el número ya existe: se anula, no se borra.
export async function anularPorFallo(numero: string, motivo: string) {
  return anular(numero, { almacen, motivo });
}
```

Reimprime siempre desde el documento guardado (`buscarDocumento(almacen, numero)`); no recalcules.

## Notas de crédito

<!-- declaraciones:
import type { AlmacenFiscal, DocumentoFiscal, Emisor, LineaEntrada } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const emisor: Emisor;
declare const original: DocumentoFiscal;
declare const lineasDevueltas: LineaEntrada[];
-->
```ts
import { emitir } from 'factura-hn';

const nota = await emitir({
  tipoDocumento: '06',
  emisor,
  cliente: { nombre: original.cliente.nombreImpreso, rtn: original.cliente.rtn },
  referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision },
  motivo: 'Devolución de mercadería',
  preciosIncluyenISV: original.preciosIncluyenISV,
  lineas: lineasDevueltas,
}, { almacen, establecimiento: '000', puntoEmision: '001' });   // usa la autorización del tipo 06
```

## Reloj del dispositivo

La fecha de emisión la pone el reloj en hora de Honduras. Dos errores protegen el orden cronológico del
archivo (Art. 43):

- `RELOJ_ADELANTADO_SOSPECHOSO`: la fecha está más de 7 días después de la última emisión de la serie.
  Muestra el mensaje y ofrece dos botones: «Corregir el reloj» y «La fecha es correcta», que reintenta con
  `confirmarSaltoDeFecha: true` (queda en la bitácora).
- `FECHA_ANTERIOR_AL_ULTIMO`: el último documento válido tiene una fecha posterior a hoy. O el reloj de
  este dispositivo está atrasado (corrígelo), o se emitió antes con el reloj adelantado. En ese caso, un
  supervisor corre el procedimiento de corrección:

<!-- declaraciones:
import type { AlmacenFiscal } from 'factura-hn';
declare const almacen: AlmacenFiscal;
-->
```ts
import { corregirFechaAdelantada, eventosAuditoria } from 'factura-hn';

// Con el reloj ya corregido: anula los documentos de la serie con fecha futura (no borra ni edita nada)
// y deja el evento en la bitácora. Después la caja vuelve a emitir con la fecha real.
const anulados = await corregirFechaAdelantada(almacen, {
  identificador: '000-001-01',
  motivo: 'Reloj de la caja 1 adelantado tres días',
  actor: 'supervisor@negocio',
});
const bitacora = await eventosAuditoria(almacen, { identificador: '000-001-01' });
```

Si esas ventas fueron reales, emite documentos nuevos con la fecha correcta.

## UI recomendada

- Pantalla de configuración: datos del emisor y alta de autorizaciones con `registrarAutorizacion`.
- Banner en el POS con `estadoAutorizacion(aut, ultimo).alertas` (vencimiento cercano o rango casi agotado).
- Botón de reimpresión (desde el documento guardado) en carta y ticket.
- Anulación con motivo obligatorio (`anular`).
- Exportación mensual: `libroVentasCSV(docs.map((d) => filaLibroVentas(d)))`. Los anulados salen con su
  número y montos en cero.

## Pruebas que debes agregar en el proyecto

- Si escribiste tu propio almacén: la batería `ejecutarContratoAlmacen` completa, concurrencia incluida.
- Una validación fallida no consume correlativo.
- Emitir con autorización vencida o agotada muestra el error al usuario.
- El total impreso coincide con lo cobrado en caja.

## Referencia rápida de errores

| Código | Qué hacer |
|---|---|
| `SIN_AUTORIZACION` | Registrar el CAI de ese punto de emisión y tipo |
| `AUTORIZACION_VENCIDA` / `RANGO_AGOTADO` | Pedir al usuario que registre un nuevo CAI |
| `RANGO_SOLAPADO` / `AUTORIZACION_DUPLICADA` | Revisar los datos de la resolución: el rango ya está registrado |
| `FECHA_EMISION_NO_ES_HOY` | No enviar `fechaEmision`: la pone el reloj |
| `RELOJ_ADELANTADO_SOSPECHOSO` | Corregir el reloj o confirmar el salto (`confirmarSaltoDeFecha`) |
| `FECHA_ANTERIOR_AL_ULTIMO` | Reloj atrasado: corregirlo. Documento previo con fecha futura: `corregirFechaAdelantada` |
| `SIN_DOCUMENTOS_ADELANTADOS` | No hay nada que corregir en esa serie |
| `CONSUMIDOR_FINAL_IDENTIFICACION` | Pedir nombre + DNI/RTN (venta > L 10,000) |
| `CLIENTE_RTN`, `EMISOR_RTN` | RTN debe tener 14 dígitos |
| `REFERENCIA*`, `MOTIVO` | Completar los datos del documento original en notas 06/07 |
| `NOTA_CLIENTE_RTN`, `NOTA_MONEDA` | Las notas exigen RTN del adquirente y se emiten en lempiras |
| `TIPO_CAMBIO` | Indicar tipo de cambio si la moneda no es HNL |
| `YA_ANULADO` / `DOCUMENTO_NO_ENCONTRADO` | Al anular: el documento ya estaba anulado o el número no existe |
| `AVISO_*`, `*_ADVERTENCIA` | No bloquean; mostrarlos como aviso |
