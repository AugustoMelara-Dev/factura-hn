# factura-hn

[![CI](https://github.com/AugustoMelara-Dev/factura-hn/actions/workflows/ci.yml/badge.svg)](https://github.com/AugustoMelara-Dev/factura-hn/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/factura-hn?label=npm)](https://www.npmjs.com/package/factura-hn)
[![licencia MIT](https://img.shields.io/badge/licencia-MIT-blue)](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/LICENSE)
[![documentación](https://img.shields.io/badge/docs-espa%C3%B1ol-0b5d8f)](https://augustomelara-dev.github.io/factura-hn/)

**Facturación para Honduras (Acuerdo 481-2017) en JavaScript/TypeScript.** Numeración de 16 dígitos, control de
CAI y rangos, ISV 15 % / 18 % / 0 % / exento / exonerado, montos en letras, validación e impresión en hoja carta,
ticket de 80 mm o texto para impresoras térmicas. Sin dependencias.

> ⚠️ Proyecto independiente, no afiliado al SAR. Te ayuda a cumplir los requisitos de formato y cálculo. **No
> sustituye** tu inscripción como autoimpresor ante el SAR ni la revisión de un contador. Ver
> [normativa](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/normativa.md).

---

## La primera factura en 3 pasos

Elige un camino: SDK, API REST, MCP o Next.js. Los cuatro empiezan en **modo de prueba**: CAI ficticio (`DEMO00-NO-VALIDO-…`) y emisor
ficticio. Todo impreso dice **«DOCUMENTO DE PRUEBA — SIN VALOR FISCAL»**. Para facturar de verdad, ver
[Pasar a producción](#pasar-a-producción).

### SDK (Node 20 o más reciente)

En la carpeta de tu proyecto, o en una nueva:

```bash
npm install factura-hn
npx factura-hn init     # crea emitir.mjs y emisor.json
node emitir.mjs         # emite la factura de prueba
```

Qué verás: el ticket en la consola y una línea con el número (`000-001-01-00000001`) y el total. En la carpeta
queda `factura.html`, con la leyenda de prueba: ábrelo en el navegador.

La venta de `emitir.mjs` es de 2 × L 115.00 con `preciosIncluyenISV: true`: los precios ya traen el ISV. El
subtotal es L 200.00, el ISV 15 % L 30.00 y el total L 230.00.

`init` genera un `.mjs`: así Node lo trata como módulo ESM (`import` y `await` de nivel superior) sin tocar tu
`package.json`. En tus archivos, usa `.mjs` o `.ts`, o pon `"type": "module"` en `package.json`. Con `require`
(CommonJS) también funciona, dentro de una función `async`.

¿`demo` o `init`? `npx factura-hn demo` solo muestra una factura de prueba (el ticket en la consola y
`factura-demo.html`), sin crear código. `npx factura-hn init` deja `emitir.mjs` y `emisor.json` para que los
cambies y sigas desde ahí.
### API REST (Docker)

Con Docker y Compose v2. Los comandos son de bash (Linux, macOS o Git Bash en Windows); los mismos pasos en
PowerShell están en la [guía de la API](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/api.md).

```bash
git clone https://github.com/AugustoMelara-Dev/factura-hn.git && cd factura-hn
docker compose up -d --build --wait     # API en http://127.0.0.1:8787
```

Los pasos siguientes se corren desde la raíz del repositorio (la carpeta `factura-hn`). Para otro puerto, arranca
con `FHN_PUERTO=8788 docker compose up -d --build --wait` y usa `API=http://127.0.0.1:8788` en el paso 1.

1. La dirección de la API y la llave de caja del tenant `demo`. La consola escribe además un aviso en la salida
   de errores («Llave caja del demo… Se muestra solo esta vez»): es normal.

   ```bash
   API=http://127.0.0.1:8787
   LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)
   ```

2. Emite, con una clave de idempotencia nueva para esta venta:

   ```bash
   VENTA="venta-$(date +%s)"
   RESPUESTA=$(curl -s -X POST "$API/v1/documentos" \
     -H "authorization: Bearer $LLAVE" -H "idempotency-key: $VENTA" -H "content-type: application/json" \
     --data-binary @packages/api/ejemplos/factura.json)
   PDF=$(printf '%s' "$RESPUESTA" | sed -n 's/.*"pdf":"\([^"]*\)".*/\1/p')
   if [ -n "$PDF" ]; then echo "Emitida: $(printf '%s' "$RESPUESTA" | sed -n 's/.*"numero":"\([^"]*\)".*/\1/p')"
   else echo "No se emitió: $RESPUESTA"; fi
   ```

   Si dice «No se emitió», la respuesta trae el error con su `solucion`. Lo más común: `LLAVE` vacía (el paso 1
   falló) o el comando no se corrió desde la raíz del repositorio (no encuentra `packages/api/ejemplos/factura.json`).

   La venta de `factura.json` es de 2 × L 57.50 con los precios con ISV: total L 115.00. No es la misma venta del
   SDK ni de Next.js.

3. Descarga el PDF:

   ```bash
   curl -f -H "authorization: Bearer $LLAVE" -o factura.pdf "$API${PDF:?el paso 2 no emitió: revisa su salida}"
   ```

   Si el paso 2 no emitió, este paso se detiene con «el paso 2 no emitió» y no deja un `factura.pdf` vacío.

El resto de la API (llaves de caja, CAI real, reportes, webhooks) está en la
[guía de la API](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/api.md).

### MCP (Claude Desktop, Claude Code, Cursor)

Con Node 22.13 o más reciente, en una carpeta vacía:

1. `npx -y @factura-hn/mcp init --demo`: crea la base de prueba `factura-demo.db` y el emisor ficticio
   `emisor-demo.json`, e imprime el bloque `mcpServers` (ya trae la variante de Windows, con `cmd /c`, si lo
   corres en Windows). `npx` descarga el paquete la primera vez: hace falta conexión a internet.
2. Pega el bloque en la configuración de tu cliente MCP y reinícialo.
3. Pídele al asistente: «emite una factura de prueba».

Para ver la factura como sale impresa, pídele que la muestre impresa: `consultar_documento` con formato `texto`
da el ticket en texto. El MCP no genera PDF ni HTML.

Dónde va el bloque en cada cliente: [README del MCP](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/mcp/README.md).

**Sin instalar nada (Claude web y móvil, ChatGPT):** la demostración pública crea un entorno de prueba de 24 horas
con su propia URL de MCP remoto, que se pega como conector personalizado. Cómo, en
[MCP remoto](https://augustomelara-dev.github.io/factura-hn/ia/mcp-remoto/) (la página «Pruébalo ahora» del sitio
lo crea con un botón). Para operar una demostración propia, o probar el modo demo en tu equipo:
[docs/demo.md](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/demo.md).

### Next.js

Primero en modo de prueba, sin base de datos, en un proyecto de `create-next-app` (con el alias `@/`). Si tu
proyecto usa `src/`, crea los archivos en `src/lib` y `src/app`.

1. `npm install factura-hn`
2. Crea `lib/facturador.ts`:

   ```ts
   // lib/facturador.ts: solo en el servidor. Se crea una vez por proceso, no en cada solicitud.
   import { crearFacturadorDemo } from 'factura-hn/demo';

   // crearFacturadorDemo() ya trae el emisor ficticio y el CAI ficticio de la caja 000-001 (establecimiento 000,
   // punto 001). Devuelve una promesa (registra el CAI al crearse): úsala con `await`.
   export const facturador = crearFacturadorDemo();
   ```

3. Crea `app/factura/route.ts`:

   ```ts
   // app/factura/route.ts: cada visita emite la siguiente factura de prueba y la devuelve como HTML.
   import { renderizarHTML } from 'factura-hn';
   import { facturador } from '@/lib/facturador';

   export async function GET() {
     const caja = await facturador;
     // Sin `cliente`, el documento va a CONSUMIDOR FINAL.
     const factura = await caja.emitir({
       preciosIncluyenISV: true, // los precios ya traen el ISV
       lineas: [{ descripcion: 'Café molido 1 lb', cantidad: 2, precioUnitario: '115.00' }],
     });
     return new Response(renderizarHTML(factura), { headers: { 'content-type': 'text/html; charset=utf-8' } });
   }
   ```

4. `npm run dev` y abre <http://localhost:3000/factura>. Verás la factura `000-001-01-00000001` con la misma
   venta del SDK: 2 × L 115.00, subtotal L 200.00, ISV L 30.00 y total L 230.00, con la leyenda
   «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Cada recarga emite el número siguiente. El almacén es de memoria:
   la numeración vuelve a empezar al reiniciar el servidor.

Para facturar de verdad, el mismo `lib/facturador.ts` pasa a usar tu emisor, Postgres y tu CAI: ver
[Pasar a producción](#pasar-a-producción).

El [ejemplo de Next.js](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/nextjs) del
repositorio usa la **API REST**, no el SDK: emite desde una server action con `@factura-hn/cliente`, sirve el PDF
con un enlace firmado y recibe los webhooks.

### Pasar a producción

1. Cambia el emisor de prueba por los datos de tu negocio, tal como están en tu RTN.
2. Registra el CAI de **tu** resolución del SAR, sin `prueba: true`: `registrarAutorizacion` en el SDK,
   `POST /v1/autorizaciones` en la API o `npx -y @factura-hn/mcp registrar-cai` en el MCP.
3. Usa un almacén que guarde: `@factura-hn/sqlite` o `@factura-hn/postgres`.

Haz las pruebas en otro almacén (otra base): un punto de emisión no mezcla documentos de prueba y reales. Los
documentos de prueba no entran en el libro de ventas ni en la exportación.

En Next.js, `lib/facturador.ts` queda así (`npm install factura-hn @factura-hn/postgres pg`). El CAI se registra
**una sola vez**, desde un script o una pantalla de administración, nunca en cada solicitud:

```ts
// lib/facturador.ts en producción: solo en el servidor. Un almacén por proceso, no uno por solicitud.
import pg from 'pg';
import { crearFacturador, type Emisor } from 'factura-hn';
import { AlmacenPostgres } from '@factura-hn/postgres';

// Los datos de tu negocio, tal como están en tu RTN (estos son ficticios).
const emisor: Emisor = {
  rtn: '99990000000001',
  razonSocial: 'Inversiones Ejemplo S. de R.L.',
  nombreComercial: 'Pulpería La Bendición',
  direccionCasaMatriz: 'Barrio El Centro, frente al parque, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, frente al parque, Ciudad Ejemplo',
  telefono: '+504 0000-0001',
  correo: 'ventas@ejemplo.example',
};

export const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
export const caja = crearFacturador({ almacen, emisor, establecimiento: '000', puntoEmision: '001', preciosIncluyenISV: true });

// Una vez, en un script de instalación: `await almacen.migrar()` y `await caja.registrarAutorizacion({ … })`
// con los datos de la resolución del SAR.
```

En `app/factura/route.ts` (o en tu server action), usa `caja.emitir(venta)` en lugar de `(await facturador).emitir(venta)`.

## El SDK paso a paso

```ts
import { AlmacenFiscalMemoria, emitir, fechaHonduras, registrarAutorizacion, renderizarHTML } from 'factura-hn';

// En producción: AlmacenPostgres (@factura-hn/postgres) o AlmacenSQLite (@factura-hn/sqlite).
const almacen = new AlmacenFiscalMemoria();

// Una vez por resolución del SAR: el CAI, su rango y su fecha límite. Este es ficticio y de prueba: todo lo
// que emite dice «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL». Con el CAI de tu resolución, quita `prueba`.
await registrarAutorizacion(almacen, {
  cai: 'DEMO00-NO-VALIDO-0000-0000-0000-01',    // el de tu resolución del SAR
  prueba: true,
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
factura.modo;                   // "prueba": el HTML y el ticket llevan la leyenda
renderizarHTML(factura);        // HTML listo para imprimir o convertir a PDF
```

Los montos se pasan como texto (`'89.50'`) o número; el cálculo es exacto, sin punto flotante. La fecha de
emisión la pone el reloj en hora de Honduras; no se puede retrofechar. Guía completa:
[guía del SDK](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/guia-sdk.md).

## Avisos que verás

Los errores bloquean la emisión; los avisos (`AVISO_*`) no, pero conviene mostrarlos en caja. Todos vienen en
`documento.advertencias` con código, mensaje y campo. Cada error trae `solucion` y un enlace a la
[guía de errores](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/errores.md).

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
| `AVISO_EXONERADO_RTN` | Venta exonerada a un adquirente sin RTN |

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

Para Claude también hay una skill lista en
[`skills/facturacion-sar-hn/SKILL.md`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/skills/facturacion-sar-hn/SKILL.md)
y un [`llms.txt`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/llms.txt) con el resumen de la API.

## Qué hace

| | |
|---|---|
| **Numeración** | `000-001-01-00000001`: formatear, parsear, validar y comprobar que pertenece al rango del CAI |
| **CAI y rangos** | Bloquea emitir después de la fecha límite o fuera del rango; avisa cuando quedan pocos días o pocos números |
| **ISV** | 15%, 18%, gravado 0 % (exportaciones), exento y exonerado; base de crédito fiscal; precios con o sin ISV; descuentos por línea; aritmética en centavos |
| **Validación** | RTN, DNI, datos completos del emisor, consumidor final > L 10,000, adquirente exonerado, moneda extranjera, coherencia de notas de crédito/débito con el original, tipos que un sistema no puede emitir. Errores con código, mensaje, campo y solución |
| **Documentos** | Factura (01), Nota de Crédito (06), Nota de Débito (07) — códigos vigentes tras el Acuerdo 609-2017 |
| **Impresión** | HTML carta, HTML ticket 80 mm, texto plano de 32/42/48 columnas para térmicas y PDF |
| **Persistencia** | Emisión atómica sobre Postgres, SQLite o memoria; sin huecos ni repetidos con varias cajas |
| **Reportes** | Libro de ventas en CSV y resumen por tasa para la declaración mensual |
| **Modo de prueba** | CAI ficticio, leyenda en todo impreso y fuera del libro y de la exportación |

## API

Hay **un solo camino para emitir y uno para anular**: `emitir` y `anular` sobre un `AlmacenFiscal`.

### Emisión

- `registrarAutorizacion(almacen, autorizacion)` → guarda un CAI. Rechaza rangos solapados y CAI repetidos
  del mismo punto de emisión y tipo. Un punto puede acumular varias autorizaciones; la numeración continúa
  de una a la siguiente. `registrarAutorizacionConAvisos(almacen, autorizacion)` hace lo mismo y devuelve
  `{ autorizacion, advertencias }`, con avisos como `AVISO_VIGENCIA_MAYOR_1_ANIO`.
- `emitir(entrada, { almacen, establecimiento, puntoEmision, opciones?, alEmitir? })` → `Promise<DocumentoFiscal>`.
  Bloquea la serie, elige la autorización vigente, valida, construye y guarda en una transacción. Si algo
  falla, el número no se consume. `alEmitir(doc, tx)` corre dentro de la misma transacción (asiento contable,
  inventario).
- `anular(numero, { almacen, motivo })` → guarda el documento con `estado: 'ANULADO'` y la leyenda ANULADA
  (Art. 41). El número sigue consumido.
- `crearFacturador({ almacen, emisor, establecimiento, puntoEmision })` → la configuración del negocio una sola
  vez, con `emitir`, `notaCredito`, `notaDebito`, `anular` y `registrarAutorizacion`.
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
- `factura-hn/pruebas`: `ejecutarContratoAlmacen` para validar tu propio adaptador

### Modo de prueba (`factura-hn/demo`)

- `crearFacturadorDemo()`: facturador en memoria con CAI ficticios de factura, nota de crédito y nota de débito.
- `autorizacionDemo({ hoy? })` · `EMISOR_DEMO` · `LEYENDA_PRUEBA` · `esCAIDemo(cai)` ·
  `esDocumentoDePrueba(doc)`

### Autorizaciones

- `estadoAutorizacion(autorizacion, ultimoCorrelativo, { hoy?, diasAviso?, porcentajeAviso? })`: aviso de renovación desde dos meses antes de la fecha límite (Art. 59)
  → `{ vigente, diasRestantes, correlativosRestantes, siguienteCorrelativo, porcentajeUsado, alertas }`
- `documentosNoUtilizados(autorizaciones, ultimoCorrelativo, { hoy?, feriados?, evento? })` · `noUtilizadosDelAlmacen(almacen, identificador, …)`: rangos sin usar, causal y fecha límite para avisar al SAR (Art. 42)
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
- `@factura-hn/pdf` (`renderizarPDF(doc, { formato: 'carta' | 'ticket' })`): PDF sin navegador
  (`npm install @factura-hn/pdf`)
- `libroVentas(docs)` → `{ filas, resumen, excluidos }` · `filaLibroVentas(doc)` · `resumenVentas(filas)` · `libroVentasCSV(filas)`
- `exportarTexto(docs, { formato: 'jsonl' | 'csv' | 'txt' })` · `leerExportacionJSONL(texto)`: archivos de texto para respaldo y traslado (Art. 53 num. 5)
- `libroVentas` y `exportarTexto` dejan fuera los documentos de prueba; `separarDocumentosDePrueba(docs)` los separa si armas el archivo por partes.
- `libroContable` en `emitir`, `anular` y `corregirFechaAdelantada`: asiento contable o de inventario dentro de la misma transacción (Art. 53 num. 1)
- Papel térmico: antes de imprimir tickets en papel térmico hay que presentar al SAR la certificación del proveedor de que la impresión dura al menos 5 años (Reglamento Art. 38).

## API REST

Si tu POS no es JavaScript, o tienes varias cajas contra un servidor, usa la API (`packages/api`): Hono,
OpenAPI 3.1 y PostgreSQL, instalada en el local del negocio (Art. 47) o alojada para varios negocios.

```bash
docker compose up -d --build --wait    # API en http://127.0.0.1:8787/docs + Postgres, con un tenant demo (CAI ficticio)
docker compose exec api factura-hn-api llave crear local --rol admin --nombre Administración   # llave admin de tu negocio
docker compose exec api factura-hn-api ayuda                                                  # la consola del operador
```

Llaves con roles caja/admin, `Idempotency-Key` obligatoria en la emisión, PDF/HTML/TXT, libro de ventas,
exportación (Art. 53 num. 5), bitácora y webhooks firmados. Los errores traen `solucion` y `documentacion`, y
`GET /v1/sesion` dice qué falta para emitir. Detalle en la
[guía de la API](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/api.md) y en
[autoalojamiento](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/autoalojamiento.md).

Desde TypeScript, el cliente tipado
[`@factura-hn/cliente`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/cliente/README.md) se
genera de la especificación OpenAPI e incluye `verificarFirmaWebhook` (Web Crypto: Node, edge y navegador).

## Servidor MCP

Para que un agente de IA (Claude Desktop, Claude Code, Cursor) emita, consulte y anule:
[`@factura-hn/mcp`](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/mcp/README.md), con las
herramientas `emitir_factura`, `emitir_nota_credito`, `consultar_documento`, `anular_documento`, `estado_cai`,
`libro_ventas` y `registrar_cai`, vía la API o con el SDK local sobre SQLite. No apruebes automáticamente
`anular_documento` en tu cliente MCP.

- Prueba: `npx -y @factura-hn/mcp init --demo` (base `factura-demo.db`, CAI ficticio).
- Con tus datos: `npx -y @factura-hn/mcp init` (base `factura.db` y plantilla `emisor.json`), y luego
  `npx -y @factura-hn/mcp registrar-cai` con los datos de tu resolución.
- Vía la API: el bloque `mcpServers` con `FHN_API_URL` y `FHN_LLAVE` (una llave de caja).
- Remoto, por HTTP (conector de Claude o ChatGPT): `factura-hn-mcp http`, ver el
  [README del MCP](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/packages/mcp/README.md#mcp-remoto-streamable-http).

```json
{ "mcpServers": { "factura-hn": { "command": "npx", "args": ["-y", "@factura-hn/mcp@0.3.0"],
  "env": { "FHN_API_URL": "http://127.0.0.1:8787", "FHN_LLAVE": "fhn_…" } } } }
```

En Windows, `npx` es un `.cmd`: usa `"command": "cmd", "args": ["/c", "npx", "-y", "@factura-hn/mcp@0.3.0"]`.

## Ejemplos

| Ejemplo | Qué muestra |
|---|---|
| [`basico`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/basico) | Emitir y guardar HTML y ticket con el SDK |
| [`pos-offline`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/pos-offline) | Mini POS fuera de línea: SDK + SQLite, sin duplicados y con cola de sincronización |
| [`express`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/express) | Express 5 con la API: factura por pedido y receptor de webhooks |
| [`nextjs`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/nextjs) | Next.js 16: server action y webhooks en un route handler |
| [`playground`](https://github.com/AugustoMelara-Dev/factura-hn/tree/main/examples/playground) | El SDK en el navegador, sin servidor |

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
| `packages/core` | `factura-hn` (el SDK, sin dependencias) | npm |
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
pnpm humo         # instala los paquetes empaquetados en un proyecto vacío y emite por cada camino
pnpm verificar:dist  # empaqueta cada paquete y revisa lo que se publicaría
pnpm sitio        # sitio de documentación en sitio/ (GitHub Pages)
```

Qué más se mide (propiedades, contrato OpenAPI, fuzzing, mutación, carga, resiliencia y OWASP API Top 10), con
sus resultados y cómo repetirlo:
[calidad medida](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/calidad.md).

Guía para contribuir:
[CONTRIBUTING.md](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CONTRIBUTING.md). Seguridad:
[SECURITY.md](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/SECURITY.md). Cada cambio a un paquete
publicado lleva un changeset (`pnpm changeset`).

La documentación (README, AGENTS.md, llms.txt, skills, docs) vive en la raíz y se copia a
`packages/core` al empaquetar (`scripts/copiar-docs.mjs`).

## Hoja de ruta

- [x] Exportaciones a tasa cero (Art. 12)
- [x] Anulación (Art. 41)
- [x] Aviso de documentos no utilizados (Art. 42)
- [x] Generación de PDF sin navegador
- [x] API REST (alojada o instalada en el local del negocio)
- [x] Cliente tipado y servidor MCP
- [x] Modo de prueba con CAI ficticio
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
Detalle y citas en [normativa](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/normativa.md).

Las contribuciones son bienvenidas, sobre todo de contadores y de desarrolladores con sistemas ya autorizados.

## Licencia

MIT © Augusto Melara — VitoCode Technologies
