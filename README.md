# factura-hn

[![CI](https://github.com/AugustoMelara-Dev/factura-hn/actions/workflows/ci.yml/badge.svg)](https://github.com/AugustoMelara-Dev/factura-hn/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/factura-hn?label=npm)](https://www.npmjs.com/package/factura-hn)
[![licencia MIT](https://img.shields.io/badge/licencia-MIT-blue)](LICENSE)
[![documentación](https://img.shields.io/badge/docs-espa%C3%B1ol-0b5d8f)](https://augustomelara-dev.github.io/factura-hn/)

**Facturación para Honduras (Acuerdo 481-2017) en JavaScript/TypeScript.** Numeración de 16 dígitos, control de CAI y rangos,
cálculo de ISV 15% / 18% / 0% / exento / exonerado, montos en letras, validación según el Acuerdo 481-2017 e
impresión en hoja carta, ticket de 80 mm o texto para impresoras térmicas.

Sin dependencias. Funciona en Node, Bun, Deno, el navegador y edge functions.
Hecha para que la integres tú o la integre un agente de IA (Claude, Cursor, OpenCode…) con un solo prompt.

```bash
npm install factura-hn
```

> ⚠️ Proyecto independiente, no afiliado al SAR. Te ayuda a cumplir los requisitos de formato y cálculo. **No sustituye** tu
> inscripción como autoimpresor ante el SAR ni la revisión de un contador. Ver [docs/normativa.md](docs/normativa.md).

---

## En 30 segundos

```ts
import { AlmacenFiscalMemoria, emitir, fechaHonduras, registrarAutorizacion, renderizarHTML } from 'factura-hn';

// En producción: AlmacenPostgres (@factura-hn/postgres) o AlmacenSQLite (@factura-hn/sqlite).
const almacen = new AlmacenFiscalMemoria();

// Una vez por resolución del SAR: el CAI, su rango y su fecha límite.
await registrarAutorizacion(almacen, {
  cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-D4', // de tu resolución del SAR
  tipoDocumento: '01',                          // 01 = Factura
  establecimiento: '000',
  puntoEmision: '001',
  rangoInicial: 1,
  rangoFinal: 5000,
  // La fecha límite de tu resolución. En esta prueba, dentro de seis meses (hora de Honduras).
  fechaLimiteEmision: fechaHonduras(new Date(Date.now() + 180 * 86_400_000)),
});

// En cada venta: valida, toma el siguiente número y guarda el documento, todo en una transacción.
const factura = await emitir(
  {
    emisor: {
      rtn: '99990000000001',
      razonSocial: 'Inversiones Ejemplo S. de R.L.',
      nombreComercial: 'Pulpería La Bendición',
      direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
      direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
      telefono: '0000-0001',
      correo: 'ventas@ejemplo.example',
    },
    cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' }, // u omítelo → CONSUMIDOR FINAL
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Arroz 5 lb', cantidad: 2, precioUnitario: '89.50' },
      { descripcion: 'Cerveza lata', cantidad: 6, precioUnitario: '32.00', isv: 'ISV18' },
    ],
  },
  { almacen, establecimiento: '000', puntoEmision: '001' },
);

factura.numero;                 // "000-001-01-00000001"
factura.totales.total;          // 371
factura.totales.totalEnLetras;  // "TRESCIENTOS SETENTA Y UN LEMPIRAS CON 00/100"
factura.advertencias;           // []
renderizarHTML(factura);        // HTML listo para imprimir o convertir a PDF
```

Los montos se pasan como texto (`'89.50'`) o número; el cálculo es exacto, sin punto flotante. La fecha de
emisión la pone el reloj en hora de Honduras; no se puede retrofechar.

## Avisos que verás

Los errores bloquean la emisión; los avisos (`AVISO_*`) no, pero conviene mostrarlos en caja. Todos vienen en
`documento.advertencias` con código, mensaje y campo.

<!-- declaraciones:
import type { AlmacenFiscal, Emisor } from 'factura-hn';
declare const almacen: AlmacenFiscal;
declare const emisor: Emisor;
-->
```ts
import { emitir } from 'factura-hn';

// Venta mixta a un cliente con RTN: frijoles exentos + clavos gravados.
const mixta = await emitir(
  {
    emisor,
    cliente: { nombre: 'Ferretería Pérez', rtn: '99990000000002' },
    lineas: [
      { descripcion: 'Clavos 2"', cantidad: 1, precioUnitario: '100.00' },
      { descripcion: 'Frijoles (lb)', cantidad: 3, precioUnitario: '28.00', isv: 'EXENTO' },
    ],
  },
  { almacen, establecimiento: '000', puntoEmision: '001' },
);
mixta.advertencias[0]?.codigo;   // "AVISO_VENTA_MIXTA": para el crédito fiscal solo cuenta lo gravado
mixta.totales.baseCreditoFiscal; // 100
```

| Aviso | Cuándo |
|---|---|
| `AVISO_VENTA_MIXTA` | Venta con partes exentas o exoneradas y partes gravadas a un cliente con RTN (Art. 11 num. 3) |
| `AVISO_AJUSTE_CENTAVO` | Con precios con ISV incluido, el total bajó 1 centavo para cumplir el Art. 9 de la Ley del ISV |
| `AVISO_ORIGINAL_EXTERNO` | Nota de crédito o débito sobre un documento que no está en este sistema |
| `AVISO_ORIGINAL_SIN_RTN` | Nota sobre un documento emitido sin RTN del adquirente |
| `AVISO_NOTA_SUPERA_ORIGINAL` | Nota de crédito por más que el total del documento que modifica (DEC-051) |
| `AVISO_NOTA_TASA_DISTINTA` | Nota de crédito con ISV a una tasa que el original no tenía, o sobre un original exonerado (DEC-051) |

**Cliente exonerado con una OCE que no cubre todo:** la exoneración aplica al documento completo. Emite dos
facturas, una con `exoneracion` y los artículos cubiertos por la Orden de Compra Exenta y otra normal con el
resto.

**Nota sobre una factura en dólares:** la nota se emite en lempiras. Escribe sus líneas en dólares y se
convierten con el tipo de cambio de la factura original, que la nota imprime como referencia.

## Impleméntalo con IA en un prompt

En una línea, en Claude Code, Cursor u OpenCode dentro de tu proyecto:

**SDK** (tu proyecto JS/TS emite con su propia base):

```text
Instala la librería npm "factura-hn", lee node_modules/factura-hn/AGENTS.md completo y agrega facturación SAR Honduras a este proyecto con el SDK: almacén fiscal en nuestra base, registro de CAI, emisión en el servidor con emitir, impresión, anulación y notas de crédito, sin inventar reglas fiscales.
```

**API** (cualquier lenguaje; la API de factura-hn emite):

```text
Conecta este proyecto a la API REST de factura-hn (URL en FHN_API_URL, llave de caja en FHN_LLAVE): en JS/TS instala "@factura-hn/cliente" y sigue la sección «Con la API REST» de node_modules/@factura-hn/cliente/AGENTS.md; en otro lenguaje genera el cliente desde FHN_API_URL/openapi.json, cuya descripción trae las reglas. Emite en el servidor con una Idempotency-Key estable por venta, muestra tal cual los errores fiscales (422) y verifica la firma de los webhooks.
```

La versión detallada del prompt del SDK:

```text
Instala la librería npm "factura-hn" y lee node_modules/factura-hn/AGENTS.md antes de escribir código.
Integra la facturación SAR Honduras en este proyecto:
1. Un AlmacenFiscal: @factura-hn/postgres o @factura-hn/sqlite si el proyecto usa esas bases; si usa otra,
   implementa la interfaz y hazla pasar la batería de factura-hn/pruebas (docs/persistencia.md).
2. Una pantalla para registrar autorizaciones CAI con registrarAutorizacion.
3. Un servicio "emitir factura" en el servidor que reciba el carrito y llame a emitir.
4. Impresión con renderizarHTML (carta y ticket) y una pantalla de estado del CAI con estadoAutorizacion.
5. Anulación con anular (nunca borrar) y Nota de Crédito (06) que referencie la factura.
No inventes reglas fiscales: usa las validaciones de la librería y muestra al usuario sus mensajes de error.
```

Para Claude también hay una skill lista en [`skills/facturacion-sar-hn/SKILL.md`](skills/facturacion-sar-hn/SKILL.md),
y un [`llms.txt`](llms.txt) con el resumen de la API.

## Qué hace

| | |
|---|---|
| **Numeración** | `000-001-01-00000001`: formatear, parsear, validar y comprobar que pertenece al rango del CAI |
| **CAI y rangos** | Bloquea emitir después de la fecha límite o fuera del rango; avisa cuando quedan pocos días o pocos números |
| **ISV** | 15%, 18%, gravado 0 % (exportaciones), exento y exonerado; base de crédito fiscal; precios con o sin ISV; descuentos por línea; aritmética en centavos |
| **Validación** | RTN, DNI, datos completos del emisor, consumidor final > L 10,000, adquirente exonerado, moneda extranjera, coherencia de notas de crédito/débito con el original, tipos que un sistema no puede emitir. Errores con código, mensaje y campo |
| **Documentos** | Factura (01), Nota de Crédito (06), Nota de Débito (07) — códigos vigentes tras el Acuerdo 609-2017 |
| **Impresión** | HTML carta, HTML ticket 80 mm y texto plano de 32/42/48 columnas para térmicas |
| **Persistencia** | Emisión atómica sobre Postgres, SQLite o memoria; sin huecos ni repetidos con varias cajas |
| **Reportes** | Libro de ventas en CSV y resumen por tasa para la declaración mensual |

## API

Hay **un solo camino para emitir y uno para anular**: `emitir` y `anular` sobre un `AlmacenFiscal`.

### Emisión

- `registrarAutorizacion(almacen, autorizacion)` → guarda un CAI. Rechaza rangos solapados y CAI repetidos
  del mismo punto de emisión y tipo. Un punto puede acumular varias autorizaciones; la numeración continúa
  de una a la siguiente.
- `emitir(entrada, { almacen, establecimiento, puntoEmision, opciones?, alEmitir? })` → `Promise<DocumentoFiscal>`.
  Bloquea la serie, elige la autorización vigente, valida, construye y guarda en una transacción. Si algo
  falla, el número no se consume. `alEmitir(doc, tx)` corre dentro de la misma transacción (asiento contable,
  inventario).
- `anular(numero, { almacen, motivo })` → guarda el documento con `estado: 'ANULADO'` y la leyenda ANULADA
  (Art. 41). El número sigue consumido.
- `corregirFechaAdelantada(almacen, { identificador, motivo })` → si una caja emitió con el reloj
  adelantado, anula esos documentos y desbloquea la serie sin borrar ni editar nada (Arts. 41 y 43).
- `eventosAuditoria(almacen, filtro?)` → bitácora de solo inserción: autorizaciones registradas, anulaciones,
  saltos de fecha confirmados y correcciones de reloj.
- `buscarDocumento(almacen, numero)` · `validarEntrada(entrada, autorizacion, opciones?)` (para mostrar
  errores en el formulario antes de cobrar) · `calcularDocumento(lineas, opciones?)` (total exacto para la
  caja antes de emitir).

### Almacenes

- `AlmacenFiscal` (interfaz) · `AlmacenFiscalMemoria` (pruebas y demos)
- `@factura-hn/postgres` (`AlmacenPostgres`) · `@factura-hn/sqlite` (`AlmacenSQLite`)
- `@factura-hn/pdf` (`renderizarPDF(doc, { formato: 'carta' | 'ticket' })`): PDF sin navegador
- `factura-hn/pruebas`: `ejecutarContratoAlmacen` para validar tu propio adaptador

### Autorizaciones

- `estadoAutorizacion(autorizacion, ultimoCorrelativo, { hoy?, diasAviso?, porcentajeAviso? })`: aviso de renovación desde dos meses antes de la fecha límite (Art. 59)
- `documentosNoUtilizados(autorizaciones, ultimoCorrelativo, { hoy?, feriados?, evento? })` · `noUtilizadosDelAlmacen(almacen, identificador, …)`: rangos sin usar, causal y fecha límite para avisar al SAR (Art. 42)
  → `{ vigente, diasRestantes, correlativosRestantes, siguienteCorrelativo, porcentajeUsado, alertas }`
- `validarAutorizacion(autorizacion)`

### Cálculo y utilidades

- `calcularDocumento(lineas, { preciosIncluyenISV?, exonerado?, moneda? })` · `sugerirPrecioSinAjuste`
- `montoEnLetras(monto, moneda?)` · `formatearMonto` · `formatearMoneda`
- `formatearNumero` · `parsearNumero` · `esNumeroValido` · `formatearRango` · `perteneceAAutorizacion`
- `esRTNValido` · `esDNIValido` · `esCAIValido` · `formatearRTN` · `formatearDNI`
- `hoyHonduras()` · `fechaHonduras()` · `horaHonduras()` (zona America/Tegucigalpa)

### Impresión y reportes

- `renderizarHTML(doc, { formato: 'carta' | 'ticket', logo?, leyenda? })`
- `renderizarTexto(doc, { ancho: 42 })`
- `filaLibroVentas(doc)` · `resumenVentas(filas)` · `libroVentasCSV(filas)`
- Papel térmico: antes de imprimir tickets en papel térmico hay que presentar al SAR la certificación del proveedor de que la impresión dura al menos 5 años (Reglamento Art. 38).
- `exportarTexto(docs, { formato: 'jsonl' | 'csv' | 'txt' })` · `leerExportacionJSONL(texto)`: archivos de texto para respaldo y traslado (Art. 53 num. 5)
- `libroContable` en `emitir`, `anular` y `corregirFechaAdelantada`: asiento contable o de inventario dentro de la misma transacción (Art. 53 num. 1)

## API REST

Si tu POS no es JavaScript, o tienes varias cajas contra un servidor, usa la API (`packages/api`): Hono,
OpenAPI 3.1 y PostgreSQL, instalada en el local del negocio (Art. 47) o alojada para varios negocios.

```bash
docker compose up --build    # API en http://127.0.0.1:8787/docs + Postgres, con datos de demostración (CAI ficticio)
docker compose logs api      # llaves admin y caja (se muestran una sola vez)
```

Llaves con roles caja/admin, `Idempotency-Key` obligatoria en la emisión, PDF/HTML/TXT, libro de ventas,
exportación (Art. 53 num. 5), bitácora y webhooks firmados. Detalle en [docs/api.md](docs/api.md).

Desde TypeScript, el cliente tipado [`@factura-hn/cliente`](packages/cliente/README.md) se genera de la
especificación OpenAPI e incluye `verificarFirmaWebhook` (Web Crypto: Node, edge y navegador).

## Servidor MCP

Para que un agente de IA (Claude Desktop, Claude Code, Cursor) emita, consulte y anule:
[`@factura-hn/mcp`](packages/mcp/README.md), con las herramientas `emitir_factura`, `emitir_nota_credito`,
`consultar_documento`, `anular_documento`, `estado_cai` y `libro_ventas`, vía la API o con el SDK local
sobre SQLite. Aún no está en npm: mientras tanto, `node packages/mcp/dist/cli.js` en lugar de `npx` (ver su
README). No apruebes automáticamente `anular_documento` en tu cliente MCP.

```json
{ "mcpServers": { "factura-hn": { "command": "npx", "args": ["-y", "@factura-hn/mcp"],
  "env": { "FHN_API_URL": "http://127.0.0.1:8787", "FHN_LLAVE": "fhn_…" } } } }
```

## Ejemplos

| Carpeta | Qué muestra |
|---|---|
| [`examples/basico`](examples/basico) | Emitir y guardar HTML y ticket con el SDK |
| [`examples/pos-offline`](examples/pos-offline) | Mini POS fuera de línea: SDK + SQLite, sin duplicados y con cola de sincronización |
| [`examples/express`](examples/express) | Express 5 con la API: factura por pedido y receptor de webhooks |
| [`examples/nextjs`](examples/nextjs) | Next.js 16: server action y webhooks en un route handler |
| [`examples/playground`](examples/playground) | El SDK en el navegador, sin backend |

## Reglas que tu sistema debe respetar

1. **Emite solo con `emitir`.** Reserva el número, valida y guarda en una transacción; no armes la numeración
   por tu cuenta.
2. **Nunca borres ni reutilices un número.** Si algo falla después de emitir (por ejemplo, la impresión),
   anula el documento con `anular`.
3. **No edites una factura emitida.** Corrige con Nota de Crédito (06) o Nota de Débito (07).
4. **Cada caja o dispositivo offline usa su propio punto de emisión y CAI.**

## Desarrollo

Monorepo con pnpm workspaces:

| Carpeta | Paquete | Estado |
|---|---|---|
| `packages/core` | `factura-hn` (el SDK, sin dependencias) | npm (0.2.0 al publicar) |
| `packages/sqlite` | `@factura-hn/sqlite` (almacén SQLite: POS fuera de línea, instalación local) | npm |
| `packages/postgres` | `@factura-hn/postgres` (almacén PostgreSQL: API, varias cajas) | npm |
| `packages/pdf` | `@factura-hn/pdf` (PDF carta y ticket, sin navegador) | npm |
| `packages/cliente` | `@factura-hn/cliente` (cliente tipado de la API, generado desde OpenAPI) | npm |
| `packages/mcp` | `@factura-hn/mcp` (servidor MCP: API o SDK local) | npm |
| `packages/api` | `@factura-hn/api` (API REST) | Docker (no se publica en npm) |
| `examples/` | básico, POS fuera de línea, Express, Next.js, playground | |

```bash
pnpm install
pnpm test         # vitest en todos los paquetes
pnpm test:pg      # levanta Postgres con docker compose y corre las pruebas de Postgres y de la API
pnpm typecheck
pnpm build        # ESM + CJS + tipos en packages/*/dist
pnpm example      # genera factura-ejemplo.html y ticket-ejemplo.txt en examples/basico
pnpm verificar:dist  # empaqueta cada paquete y revisa lo que se publicaría
pnpm sitio        # sitio de documentación en sitio/ (GitHub Pages)
```

Guía para contribuir: [CONTRIBUTING.md](CONTRIBUTING.md). Seguridad: [SECURITY.md](SECURITY.md). Cada cambio a
un paquete publicado lleva un changeset (`pnpm changeset`); el flujo de publicación está en
[docs/lanzamiento.md](docs/lanzamiento.md).

La documentación (README, AGENTS.md, llms.txt, skills, docs) vive en la raíz y se copia a
`packages/core` al empaquetar (`scripts/copiar-docs.mjs`).

## Hoja de ruta

- [x] Exportaciones a tasa cero (Art. 12)
- [x] Anulación (Art. 41)
- [x] Aviso de documentos no utilizados (Art. 42)
- [x] Generación de PDF sin navegador
- [x] API REST (alojada o instalada en el local del negocio)
- [x] Cliente tipado y servidor MCP
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
