# AGENTS.md — integrar `factura-hn`

Para agentes de IA que agregan facturación SAR Honduras a un proyecto. Léelo completo antes de escribir código.

Elige el camino (si el proyecto no lo deja claro, pregúntale al usuario):

- **SDK**: proyecto JS/TS que emite contra su propia base (Postgres, SQLite u otra). Todo este documento salvo
  «Con la API REST».
- **API**: proyecto en otro lenguaje, o varias cajas contra un servidor de factura-hn. Ve a «Con la API REST».

Prompt del SDK:

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

Prompt de la API:

```text
Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.
```

## Instalar y probar

```bash
npm install factura-hn @factura-hn/postgres pg   # o @factura-hn/sqlite
npx factura-hn demo                              # factura de prueba en factura-demo.html
```

En código, `crearFacturadorDemo()` de `factura-hn/demo` da un facturador en memoria con CAI ficticio
(`DEMO00-NO-VALIDO-…`). Lo que emite lleva `modo: 'prueba'` y la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR
FISCAL». No lo uses en producción ni en el almacén de producción.

## Reglas que no debes romper

1. **No inventes reglas fiscales.** Valida con `emitir` (o `validarEntrada` en el formulario) y muestra
   `ErrorValidacion.errores` tal cual: cada uno trae `codigo`, `mensaje`, `campo` y `solucion`.
2. **Un solo camino.** Emite con `emitir` y anula con `anular`, sobre un `AlmacenFiscal`. No calcules el número
   ni guardes el documento por tu cuenta. `crearFacturador` es una fachada sobre esas mismas funciones.
3. **Almacén probado.** `AlmacenPostgres` (`@factura-hn/postgres`) o `AlmacenSQLite` (`@factura-hn/sqlite`).
   Otra base: implementa `AlmacenFiscal` y pasa `ejecutarContratoAlmacen` de `factura-hn/pruebas`
   (`docs/persistencia.md`). `AlmacenFiscalMemoria` es solo para pruebas.
4. **Números inmutables.** Nunca borres ni reutilices un número. Si algo falla después de emitir, anula. Una
   factura se corrige con Nota de Crédito (06) o de Débito (07).
5. **En el servidor.** Emite en una API route, server action o servicio local. El navegador solo envía el
   carrito; las credenciales nunca llegan a él.
6. **Cobra `totales.total`.** Con `preciosIncluyenISV: true` puede quedar 1 centavo abajo (redondeo del Art. 9
   de la Ley del ISV). Muestra el total antes de cobrar con `caja.cotizar` o `calcularDocumento`.
7. **El CAI lo carga el usuario** desde su resolución del SAR con `registrarAutorizacion`. No lo escribas en el
   código.
8. **Montos como texto** (`'89.50'`) cuando vienen de la base. Nada de `float`.
9. **`factura.totales.*` son números** (`230` o `29.9`). Para mostrarlos con 2 decimales usa `formatearMonto`
   (`"1,234.50"`) o `formatearMoneda` (`"L 1,234.50"`), de `factura-hn`.

## Configurar (una vez)

```ts
import pg from 'pg';
import { crearFacturador, type Emisor } from 'factura-hn';
import { AlmacenPostgres } from '@factura-hn/postgres';

// Los siete datos son obligatorios (Art. 10 num. 1). Vienen de la configuración del negocio.
const emisor: Emisor = {
  rtn: '99990000000001',
  razonSocial: 'Inversiones Ejemplo S. de R.L.',
  nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

export const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await almacen.migrar(); // crea las tablas fhn_*; se puede repetir

// Una caja por punto de emisión. Créala una vez al arrancar, no en cada petición.
export const caja = crearFacturador({ almacen, emisor, establecimiento: '000', puntoEmision: '001', preciosIncluyenISV: true });

// Desde la pantalla de configuración, con los datos de la resolución del SAR:
await caja.registrarAutorizacion({
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4',
  tipoDocumento: '01',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
});
```

Cada tipo de documento (01, 06, 07) y cada punto de emisión tiene su propia autorización y su propia serie.
Un rango nuevo se registra igual; la numeración continúa sola.

## Emitir, imprimir, anular

<!-- declaraciones:
import type { Facturador, TratamientoISV } from 'factura-hn';
declare const caja: Facturador;
declare const cliente: { nombre: string; rtn?: string } | undefined;
declare const carrito: { sku: string; nombre: string; cantidad: string; precio: string; tratamientoISV: TratamientoISV }[];
-->
```ts
import { ErrorValidacion, renderizarHTML } from 'factura-hn';

export async function facturar() {
  try {
    const doc = await caja.emitir({
      cliente: cliente?.rtn ? { nombre: cliente.nombre, rtn: cliente.rtn } : undefined, // sin cliente: CONSUMIDOR FINAL
      lineas: carrito.map((i) => ({
        codigo: i.sku,
        descripcion: i.nombre,
        cantidad: i.cantidad,        // '2' o '1.5'
        precioUnitario: i.precio,    // '89.50'
        isv: i.tratamientoISV,       // 'ISV15' | 'ISV18' | 'GRAVADO0' | 'EXENTO', guardado en el producto
      })),
    });
    return { ok: true as const, numero: doc.numero, html: renderizarHTML(doc), avisos: doc.advertencias };
  } catch (e) {
    if (e instanceof ErrorValidacion) return { ok: false as const, errores: e.errores };
    throw e;
  }
}

// Si el cobro o la impresión fallan después de emitir, el número ya existe: se anula, no se borra.
export const anularVenta = (numero: string, motivo: string) => caja.anular(numero, motivo);

// Devolución: Nota de Crédito (06) sobre la factura guardada. Necesita su propio CAI de tipo 06.
export const devolver = (numero: string, lineas: Parameters<Facturador['emitir']>[0]['lineas']) =>
  caja.notaCredito({ original: numero, motivo: 'Devolución de mercadería', lineas });
```

- Reimprime desde el documento guardado (`caja.documento(numero)`), en carta o ticket, sin recalcular.
- Muestra `doc.advertencias` (`AVISO_*`) como aviso: no bloquean.
- Exportaciones: `isv: 'GRAVADO0'` (tasa cero, Art. 12), que no es `EXENTO`.
- Cliente exonerado: `exoneracion` con `{ ordenCompraExenta, constanciaRegistroExonerado }` o `{ registroSAG }`.
  Si la orden no cubre todo, emite dos facturas.
- Emite al entregar o al cobrar, lo que ocurra primero (Art. 14). Un documento por venta (Art. 9).
- En la UI: alerta de vencimiento con `estadoAutorizacion(aut, ultimo).alertas`; libro mensual con
  `libroVentas(docs)` y `libroVentasCSV(filas)`.

## Errores comunes

| Código | Qué hacer |
|---|---|
| `SIN_AUTORIZACION` | Registrar el CAI de ese punto de emisión y tipo de documento |
| `AUTORIZACION_VENCIDA` / `RANGO_AGOTADO` | Pedir al usuario que registre su nuevo CAI |
| `RANGO_SOLAPADO` / `AUTORIZACION_DUPLICADA` | Ese rango ya está registrado: revisar los datos de la resolución |
| `AUTORIZACION_MODO_MEZCLADO` | No mezclar CAI de prueba y reales en un punto: probar en otra base |
| `EMISOR_*` | Completar los siete datos del emisor |
| `CONSUMIDOR_FINAL_IDENTIFICACION` | Venta mayor de L 10,000: pedir nombre y DNI o RTN |
| `CLIENTE_RTN` | El RTN lleva 14 dígitos |
| `REFERENCIA_*`, `NOTA_SUPERA_ORIGINAL` | Revisar la factura original de la nota y mostrar el mensaje (trae el saldo) |
| `TIPO_NO_EMITIBLE` | Ese tipo (04, 09, 10, 12) no se emite por sistema |
| `FECHA_EMISION_NO_ES_HOY` | No enviar `fechaEmision`: la pone el reloj |
| `RELOJ_ADELANTADO_SOSPECHOSO` | Corregir el reloj o reintentar con `confirmarSaltoDeFecha: true` |
| `FECHA_ANTERIOR_AL_ULTIMO` | Corregir el reloj; si se emitió con fecha futura, un supervisor usa `corregirFechaAdelantada` |
| `AVISO_*` | No bloquea: mostrarlo a quien cobra |

Catálogo completo, con la solución de cada código: `docs/errores.md`.

## Con la API REST

La API aplica las mismas reglas que el SDK. Referencia: `docs/api.md`.

1. La llave va **solo en el servidor**. Usa una llave de **caja**; la de admin es para emisor, CAI, llaves y
   webhooks.
2. **`Idempotency-Key` estable por venta** (el id del pedido, nunca uno nuevo por intento): si reintentas,
   recibes la misma factura.
3. **422 = reglas fiscales.** Muestra `errores[].mensaje` tal cual. Una solicitud rechazada no consume número.
4. Guarda el `numero` que devuelve la emisión y reimprime desde la API (`.pdf`, `.html`, `.txt`).
5. Webhooks: verifica la firma sobre el cuerpo **crudo**, descarta repetidos por `id` y responde 2xx al
   terminar.

<!-- declaraciones:
declare const req: { texto: string; firma: string | null };
-->
```ts
import { crearCliente, ErrorFacturaHN, verificarFirmaWebhook, type DocumentoEntrada } from '@factura-hn/cliente';

const fhn = crearCliente({ url: process.env.FHN_API_URL!, llave: process.env.FHN_LLAVE! });

export async function facturarPedido(pedido: { id: string; lineas: DocumentoEntrada['lineas'] }) {
  try {
    const { documento } = await fhn.emitir(
      { documento: { preciosIncluyenISV: true, lineas: pedido.lineas } },
      { idempotencyKey: `pedido-${pedido.id}` },
    );
    return { ok: true as const, numero: documento.numero, total: documento.totales.total };
  } catch (e) {
    if (e instanceof ErrorFacturaHN && e.estado === 422) return { ok: false as const, errores: e.errores.map((x) => x.mensaje) };
    throw e;
  }
}

// Receptor de webhooks: `req.texto` es el cuerpo tal como llegó, antes de JSON.parse.
export async function recibirAviso() {
  if (!(await verificarFirmaWebhook(req.texto, req.firma, process.env.FHN_SECRETO_WEBHOOK!))) return 400;
  const aviso = JSON.parse(req.texto) as { id: string; evento: string };
  return aviso.id ? 204 : 400;
}
```

Para probar sin CAI real: `docker compose up -d --build --wait` (desde el repositorio) crea un tenant `demo` con
CAI ficticio, y `docker compose exec -T api factura-hn-api demo llave --solo-llave` da una llave de caja.

## Con el MCP

Para que el asistente opere la facturación (no para integrarla): `@factura-hn/mcp`, con las herramientas
`emitir_factura`, `emitir_nota_credito`, `consultar_documento`, `anular_documento`, `estado_cai`,
`libro_ventas` y `registrar_cai`. Prueba: `npx -y @factura-hn/mcp init --demo`. Con datos reales:
`npx -y @factura-hn/mcp init` y `npx -y @factura-hn/mcp registrar-cai`.
