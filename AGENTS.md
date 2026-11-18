# AGENTS.md — cómo integrar `factura-hn` en un proyecto

Instrucciones para agentes de IA (Claude, Cursor, OpenCode, Codex…) que integran facturación SAR Honduras.
Léelo completo antes de escribir código.

## Principios no negociables

1. **No inventes reglas fiscales.** Usa `validarEntrada` / `crearDocumento` y muestra al usuario los mensajes
   de `ErrorValidacion.errores` tal cual (traen `codigo`, `mensaje` y `campo`).
2. **Correlativos atómicos.** Implementa `AlmacenCorrelativos.siguiente()` con una sola operación atómica en la
   base de datos del proyecto (ver `docs/persistencia.md`). Nunca calcules el siguiente número con
   `SELECT max(...) + 1` sin bloqueo. `AlmacenMemoria` es solo para pruebas.
3. **Números inmutables.** Un número asignado no se borra ni se reutiliza. Fallo después de asignar = registro
   con `anulado = true`. Corrección de una factura emitida = Nota de Crédito (`tipoDocumento: '06'`) o Débito (`'07'`).
4. **Guarda el `DocumentoFiscal` completo** (JSON) al emitir. Reimprime desde ese JSON; no recalcules.
5. **Server-side.** La emisión corre en el servidor (API route, server action, edge function). El cliente
   solo envía el carrito. Las credenciales de BD y la reserva de correlativos nunca van al navegador.
6. **Datos de CAI desde la BD**, cargados por el usuario desde su resolución del SAR. No los hardcodees y no
   inventes CAI de ejemplo en código de producción.

## Modelo mínimo de datos

- `autorizaciones_cai`: cai (PK), tipo_documento, establecimiento, punto_emision, rango_inicial, rango_final,
  fecha_limite, ultimo_correlativo (nullable), activa.
- `documentos_fiscales`: numero (PK), cai (FK), tipo, fecha_emision, total, anulado, motivo_anulacion,
  documento (JSON), creado_en.
- En multi-tenant: agrega `tenant_id` a ambas y aplica RLS / filtros por tenant.

## Mapeo carrito → `DocumentoEntrada`

```ts
import { horaHonduras, type DocumentoEntrada } from 'factura-hn';

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
    cantidad: i.cantidad,
    precioUnitario: i.precio,
    isv: i.producto.tratamientoISV,         // 'ISV15' | 'ISV18' | 'EXENTO' — guardarlo en el producto
    descuento: i.descuento ?? 0,            // monto, no porcentaje
  })),
  horaEmision: horaHonduras(),
  condicionPago: 'CONTADO',
};
```

Si el cliente presenta Orden de Compra Exenta, agrega
`exoneracion: { ordenCompraExenta, constanciaRegistroExonerado, registroSAG? }`.

## Servicio de emisión (patrón)

```ts
import { crearDocumento, ErrorValidacion, RangoAgotadoError, renderizarHTML } from 'factura-hn';

export async function emitirFactura(entrada: DocumentoEntrada, tenantId: string) {
  const autorizacion = await repo.autorizacionActiva(tenantId, '01');   // la vigente para este punto
  try {
    const doc = await crearDocumento(entrada, { autorizacion, almacen: almacenBD(tenantId) });
    await repo.guardarDocumento(tenantId, doc);   // idealmente en la misma transacción que la reserva
    return { ok: true, doc, html: renderizarHTML(doc) };
  } catch (e) {
    if (e instanceof ErrorValidacion) return { ok: false, errores: e.errores };
    if (e instanceof RangoAgotadoError) return { ok: false, errores: [{ codigo: 'RANGO_AGOTADO', mensaje: e.message }] };
    throw e;
  }
}
```

## Notas de crédito

```ts
await crearDocumento({
  tipoDocumento: '06',
  emisor,
  cliente: { nombre: original.cliente.nombreImpreso, rtn: original.cliente.rtn },
  referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision },
  motivo: 'Devolución de mercadería',
  preciosIncluyenISV: original.preciosIncluyenISV,
  lineas: lineasDevueltas,
}, { autorizacion: autorizacionNotasCredito, almacen });   // CAI propio del tipo 06
```

Cada tipo de documento tiene **su propia autorización CAI y su propio rango**.

## UI recomendada

- Pantalla de configuración: datos del emisor y alta de autorizaciones CAI (validar con `validarAutorizacion`).
- Banner en el POS con `estadoAutorizacion(aut, ultimo).alertas` (vencimiento ≤ 30 días o rango ≥ 90%).
- Botón de reimpresión (desde el JSON guardado) en carta y ticket.
- Exportación mensual: `libroVentasCSV(docs.map(d => filaLibroVentas(d.documento, { anulado: d.anulado })))`.

## Pruebas que debes agregar en el proyecto

- Dos emisiones concurrentes nunca obtienen el mismo número.
- Una validación fallida no consume correlativo.
- Emitir con autorización vencida o agotada muestra el error al usuario.
- El total impreso coincide con lo cobrado en caja.

## Referencia rápida de errores

| Código | Qué hacer |
|---|---|
| `AUTORIZACION_VENCIDA` / `RANGO_AGOTADO` | Pedir al usuario que registre un nuevo CAI |
| `CONSUMIDOR_FINAL_IDENTIFICACION` | Pedir nombre + DNI/RTN (venta > L 10,000) |
| `CLIENTE_RTN`, `EMISOR_RTN` | RTN debe tener 14 dígitos |
| `AUTORIZACION_TIPO` | Usar la autorización del mismo tipo de documento |
| `REFERENCIA*`, `MOTIVO` | Completar los datos del documento original en notas 06/07 |
| `NOTA_CLIENTE_RTN`, `NOTA_MONEDA` | Las notas exigen RTN del adquirente y se emiten en lempiras |
| `TIPO_CAMBIO` | Indicar tipo de cambio si la moneda no es HNL |
| `AVISO_*`, `*_ADVERTENCIA` | No bloquean; mostrarlos como aviso |
