# factura-hn

**Facturación SAR Honduras para JavaScript/TypeScript.** Numeración de 16 dígitos, control de CAI y rangos,
cálculo de ISV 15% / 18% / exento / exonerado, montos en letras, validación según el Acuerdo 481-2017 e
impresión en hoja carta, ticket de 80 mm o texto para impresoras térmicas.

Sin dependencias. Funciona en Node, Bun, Deno, el navegador y edge functions.
Hecha para que la integres tú o la integre un agente de IA (Claude, Cursor, OpenCode…) con un solo prompt.

```bash
npm install factura-hn
```

> ⚠️ Te ayuda a cumplir los requisitos de formato y cálculo. **No sustituye** tu inscripción como
> autoimpresor ante el SAR ni la revisión de un contador. Ver [docs/normativa.md](docs/normativa.md).

---

## En 30 segundos

```ts
import { AlmacenMemoria, crearDocumento, renderizarHTML } from 'factura-hn';

const autorizacion = {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', // de tu resolución del SAR
  tipoDocumento: '01',                          // 01 = Factura
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  fechaLimiteEmision: '2027-06-30',
} as const;

const factura = await crearDocumento(
  {
    emisor: {
      rtn: '08011999123456',
      razonSocial: 'Inversiones Ejemplo S. de R.L.',
      nombreComercial: 'Pulpería La Bendición',
      direccionCasaMatriz: 'Barrio El Centro, Tocoa, Colón',
      telefono: '2444-0000',
      correo: 'ventas@ejemplo.hn',
    },
    cliente: { nombre: 'Ferretería Pérez', rtn: '08019005123456' }, // u omítelo → CONSUMIDOR FINAL
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: 89.5 },
      { descripcion: 'Cerveza lata', cantidad: 6, precioUnitario: 32, isv: 'ISV18' },
      { descripcion: 'Frijoles (lb)', cantidad: 3, precioUnitario: 28, isv: 'EXENTO' },
    ],
  },
  { autorizacion, almacen: new AlmacenMemoria() }, // en producción: tu base de datos
);

factura.numero;                 // "000-001-01-00000001"
factura.totales.total;          // 455
factura.totales.totalEnLetras;  // "CUATROCIENTOS CINCUENTA Y CINCO LEMPIRAS CON 00/100"
renderizarHTML(factura);        // HTML listo para imprimir o convertir a PDF
```

## Impleméntalo con IA en un prompt

Copia esto en Claude Code, Cursor u OpenCode dentro de tu proyecto:

```text
Instala la librería npm "factura-hn" y lee node_modules/factura-hn/AGENTS.md antes de escribir código.
Integra la facturación SAR Honduras en este proyecto:
1. Tablas para autorizaciones CAI y documentos fiscales (sigue docs/persistencia.md de la librería
   para la base de datos que usa este proyecto).
2. Un AlmacenCorrelativos atómico sobre esa base de datos.
3. Un endpoint/servicio "emitir factura" que reciba el carrito actual y use crearDocumento.
4. Impresión con renderizarHTML (carta y ticket) y una pantalla de estado del CAI con estadoAutorizacion.
5. Anulación (marcar como anulado, nunca borrar) y Nota de Crédito (06) que referencie la factura.
No inventes reglas fiscales: usa las validaciones de la librería y muestra al usuario sus mensajes de error.
```

Para Claude también hay una skill lista en [`skills/facturacion-sar-hn/SKILL.md`](skills/facturacion-sar-hn/SKILL.md),
y un [`llms.txt`](llms.txt) con el resumen de la API.

## Qué hace

| | |
|---|---|
| **Numeración** | `000-001-01-00000001`: formatear, parsear, validar y comprobar que pertenece al rango del CAI |
| **CAI y rangos** | Bloquea emitir después de la fecha límite o fuera del rango; avisa cuando quedan pocos días o pocos números |
| **ISV** | 15%, 18%, exento y exonerado; precios con o sin ISV; descuentos por línea; aritmética en centavos |
| **Validación** | RTN, DNI, datos del emisor, consumidor final > L 10,000, adquirente exonerado, moneda extranjera, notas de crédito/débito. Errores con código, mensaje y campo |
| **Documentos** | Factura (01), Nota de Crédito (06), Nota de Débito (07) — códigos vigentes tras el Acuerdo 609-2017 |
| **Impresión** | HTML carta, HTML ticket 80 mm y texto plano de 32/42/48 columnas para térmicas |
| **Reportes** | Libro de ventas en CSV y resumen por tasa para la declaración mensual |

## API

### Flujo principal

- `crearDocumento(entrada, { autorizacion, almacen, opciones? })` → `Promise<DocumentoFiscal>`
  Valida, reserva el correlativo (solo si la validación pasa) y construye el documento.
- `validarEntrada(entrada, autorizacion, opciones?)` → `{ ok, errores, advertencias }`
  Úsala para mostrar errores en el formulario antes de cobrar.
- `construirDocumento(entrada, autorizacion, correlativo, opciones?)` → `DocumentoFiscal`
  Versión pura si tú manejas los correlativos.

### Autorizaciones

- `estadoAutorizacion(autorizacion, ultimoCorrelativo, { hoy?, diasAviso?, porcentajeAviso? })`
  → `{ vigente, diasRestantes, correlativosRestantes, siguienteCorrelativo, porcentajeUsado, alertas }`
- `validarAutorizacion(autorizacion)`
- `AlmacenCorrelativos` (interfaz) · `AlmacenMemoria` (solo pruebas) · `RangoAgotadoError`

### Cálculo y utilidades

- `calcularDocumento(lineas, { preciosIncluyenISV?, exonerado?, moneda? })`
- `montoEnLetras(monto, moneda?)` · `formatearMonto` · `formatearMoneda`
- `formatearNumero` · `parsearNumero` · `esNumeroValido` · `formatearRango` · `perteneceAAutorizacion`
- `esRTNValido` · `esDNIValido` · `esCAIValido` · `formatearRTN` · `formatearDNI`
- `fechaHonduras()` · `horaHonduras()` (zona America/Tegucigalpa)

### Impresión y reportes

- `renderizarHTML(doc, { formato: 'carta' | 'ticket', logo?, leyenda? })`
- `renderizarTexto(doc, { ancho: 42 })`
- `filaLibroVentas(doc, { anulado? })` · `resumenVentas(filas)` · `libroVentasCSV(filas)`

## Reglas que tu sistema debe respetar

1. **Nunca reutilices ni saltes un correlativo.** Si una venta falla después de recibir número, guárdala como anulada.
2. **Reserva el número de forma atómica** en tu base de datos ([docs/persistencia.md](docs/persistencia.md)).
3. **No edites una factura emitida.** Corrige con Nota de Crédito (06) o Nota de Débito (07).
4. **Cada caja o dispositivo offline usa su propio punto de emisión y CAI.**

## Desarrollo

Monorepo con pnpm workspaces:

| Carpeta | Paquete | Estado |
|---|---|---|
| `packages/core` | `factura-hn` (el SDK, sin dependencias) | estable |
| `packages/api` | `@factura-hn/api` | Fase 2 |
| `packages/mcp` | `@factura-hn/mcp` | Fase 3 |
| `examples/` | ejemplos | en crecimiento |

```bash
pnpm install
pnpm test         # vitest en todos los paquetes
pnpm typecheck
pnpm build        # ESM + CJS + tipos en packages/*/dist
pnpm example      # genera factura-ejemplo.html y ticket-ejemplo.txt en examples/basico
```

La documentación (README, AGENTS.md, llms.txt, skills, docs) vive en la raíz y se copia a
`packages/core` al empaquetar (`scripts/copiar-docs.mjs`).

## Hoja de ruta

- [ ] Exportaciones a tasa cero (Art. 12)
- [ ] Anulación (Art. 41) y aviso de documentos no utilizados (Art. 42)
- [ ] Generación de PDF sin navegador
- [ ] API REST (alojada o instalada en el local del negocio) y servidor MCP
- [ ] Comprobante de Retención (05), Guía de Remisión (08) y Boleta de Compra (11)
- [ ] Paquetes hermanos: Python y .NET
- [ ] Módulo de factura electrónica (CAEE) cuando el SAR publique la documentación técnica (Arts. 54 y 58)

**Lo que esta librería no va a emitir, y por qué.** Es software para la modalidad de *autoimpresor por
sistema computarizado*, y el Reglamento reserva algunos documentos para otras modalidades:

- **Ticket (09)**: se emite «exclusivamente para consumidores finales a través de **máquinas registradoras**
  autorizadas» (Art. 4 num. 43) con memoria fiscal inamovible (Art. 52). Un sistema computarizado emite
  **Factura** también a consumidor final.
- **Recibo por Honorarios Profesionales (04)** y **Factura Prevalorada (10)**: «deben ser exclusivamente emitidos
  bajo la modalidad de **imprenta**» (Art. 46). La **Constancia de Donación (12)** también está excluida del
  autoimpresor (Art. 47).

Los códigos se reconocen al parsear números y referencias, pero `validarEntrada` rechaza emitirlos.
Detalle y citas en [docs/investigacion.md](docs/investigacion.md).

Las contribuciones son bienvenidas, sobre todo de contadores y de desarrolladores con sistemas ya autorizados.

## Licencia

MIT © Augusto Melara — VitoCode Technologies
