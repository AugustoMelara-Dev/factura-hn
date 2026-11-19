# Análisis: experiencia del SDK (núcleo y adaptadores)

Fecha: 2026-11-19. Alcance: `packages/core` (`factura-hn`), `@factura-hn/sqlite`, `@factura-hn/postgres`,
`@factura-hn/pdf` y, para comparar la coherencia, `@factura-hn/cliente`, el backend local de `@factura-hn/mcp`, los
ejemplos y la documentación (README.md, AGENTS.md, llms.txt, docs/guia-sdk.md).

Método: leí el código, los tipos exportados, las pruebas y los ejemplos. Corrí `pnpm --filter factura-hn test`
(15 archivos, 207 pruebas en verde) y las pruebas de `@factura-hn/sqlite` (21) y `@factura-hn/pdf` (8). Además,
desde una carpeta temporal fuera del repositorio, corrí scripts contra `packages/*/dist` para ver los mensajes de
error reales, cargar los paquetes como CJS y medir el flujo mínimo «emitir y sacar el PDF». No modifiqué nada del
repositorio salvo este archivo.

Objetivo de referencia: que un desarrollador emita su **primera factura en 5 minutos**, como pasa con Afip SDK en
Argentina.

---

## 1. Resumen

- **El núcleo es sólido y honesto, pero se usa como una caja de piezas.** Las reglas, la atomicidad, la
  aritmética exacta y las citas de los artículos están bien resueltas, y los fragmentos de la documentación se
  compilan en las pruebas. Lo que falta es una capa de uso: hoy hacen falta **33 líneas y 3 paquetes** para emitir
  una factura de demostración y guardarla en PDF, y los siete datos del emisor, el establecimiento y el punto de
  emisión se repiten en cada llamada.
- **No existe un modo demo en el núcleo, y el ejemplo del README tiene fecha de caducidad.** El README, la guía y
  `examples/basico` fijan `fechaLimiteEmision: '2027-06-30'` (24 apariciones en el repositorio). Las pruebas
  congelan el reloj en 2026-11-18, así que la CI no se va a enterar: desde el 2027-07-01, quien copie el ejemplo
  recibirá `AUTORIZACION_VENCIDA`. El playground y la API ya tienen datos demo con una fecha relativa, pero cada
  uno tiene su propia copia.
- **Hay un riesgo real al leer montos:** `'89,50'` se lee como **8950** sin ningún aviso (`dinero.ts:40` borra
  todas las comas). En mi prueba, el resultado fue una factura de L 10,292.50 en lugar de L 102.93.
- **Los mensajes de error son buenos en la mitad de los casos.** Dicen qué pasó y muchos citan el artículo. Pero
  `SIN_AUTORIZACION` no dice de qué serie se trata ni qué hacer, `RANGO` no explica qué está mal, olvidar
  `almacen` termina en un `TypeError` de JavaScript, y el «qué hacer» vive en una tabla de AGENTS.md en lugar de
  venir en el error.
- **La coherencia entre paquetes es parcial.** `almacen` va como primer argumento en 5 funciones y dentro de la
  configuración en otras 2. `reloj` cambia de lugar entre `emitir` y `anular`. El cliente de la API devuelve
  `{ documento, repetida }` y fija el emisor; el SDK no. La idempotencia y el «estado del CAI» se reimplementan
  en el ejemplo POS, en el MCP local y en la API. La propuesta central es **una fachada compatible,
  `crearFacturador`, más el submódulo `factura-hn/demo`**: el caso común baja de 33 a 8 líneas, y como nada se
  ha publicado todavía en npm (CHANGELOG: «0.2.0 — sin publicar»), este es el momento barato para corregir lo
  incompatible.

---

## 2. Estado actual

### 2.1 Superficie pública

`packages/core/src/index.ts` exporta 87 nombres (contados al cargar `dist/index.cjs`). El flujo que se documenta
está en `index.ts:4-10`:

```ts
await registrarAutorizacion(almacen, autorizacion);          // una vez por resolución del SAR
const doc = await emitir(entrada, { almacen, establecimiento, puntoEmision });
const html = renderizarHTML(doc);
await anular(doc.numero, { almacen, motivo });                // Art. 41
```

Lo que está bien hecho y conviene conservar:

- **Un solo camino de emisión** (DEC-007): `emitir` bloquea la serie, elige la autorización, valida, construye,
  guarda y registra en la bitácora dentro de una sola transacción (`emision.ts:195-261`).
- **Dinero sin punto flotante en el cálculo:** `Monto = number | string`, se lee por su texto decimal y se
  calcula en `bigint` (`dinero.ts:1-22`). Un `0.1 + 0.2` como precio se rechaza en lugar de redondearse en
  silencio (comprobado: `LINEA_PRECIO … "0.30000000000000004"`).
- **La fecha la pone el reloj** en America/Tegucigalpa (`tipos.ts:157`, `documento.ts:175-183`).
- **Documentos congelados en profundidad** (`inmutable.ts:2`), tanto al emitir como al buscar.
- **Errores con forma estable:** `ErrorValidacion { errores: Problema[]; advertencias: Problema[] }` y
  `Problema { codigo, mensaje, campo? }` (`tipos.ts:273-277`, `documento.ts:121-126`).
- **La documentación es código:** `test/readme.test.ts` compila cada bloque `ts` de README, AGENTS.md y la guía,
  y comprueba que cada nombre citado exista.
- **ESM y CJS con tipos:** cada paquete publica `.js`, `.cjs`, `.d.ts` y `.d.cts` con `exports` condicionales.
  Comprobé que `require()` funciona en `core`, `sqlite` y `pdf`.
- **Un contrato de almacén con su batería de pruebas** (`factura-hn/pruebas`, `ejecutarContratoAlmacen`).

### 2.2 Forma de los datos de entrada

`DocumentoEntrada` (`tipos.ts:148-178`) pide:

- `emisor` con **7 campos obligatorios** (`tipos.ts:41-59`, Art. 10 num. 1 a-f). Se pasa **en cada emisión**.
- `lineas[]` con `descripcion`, `cantidad` y `precioUnitario` (`Monto`), y opcionalmente `isv` (por defecto
  `'ISV15'`), `descuento` (un monto, no un porcentaje), `codigo` y `unidad` (`tipos.ts:116-130`).
- `preciosIncluyenISV?` (por defecto `false`, `tipos.ts:161`). El README, la guía, AGENTS.md y todos los
  ejemplos lo ponen en `true`: el valor por defecto no coincide con el caso más común, que es un POS con precio
  de góndola. Aun así, **no conviene cambiarlo en `emitir`**: un cambio silencioso alteraría el ISV de quien ya
  integra (ver §5).
- `tipoDocumento?` como código del SAR: `'01' | '06' | '07'`.
- `operador?` **en la entrada**: se imprime como «Atendido por» (`tipos.ts:177`). **En la configuración** de
  `emitir`, el mismo nombre solo va a la bitácora (`emision.ts:173-177`). La API, en cambio, usa
  `imprimirOperador: true`. Es el mismo concepto con tres formas distintas.

`OpcionesEmision` (`emision.ts:154-186`) lleva `almacen`, `establecimiento`, `puntoEmision`, `actor`,
`operador`, `alEmitir`, `libroContable`, `saltoMaximoDias`, `confirmarSaltoDeFecha` y una **sub-opción anidada**
`opciones?: OpcionesDocumento` (`emision.ts:160`) que contiene `reloj`, `umbralIdentificacionConsumidorFinal` y
`caiEstricto`. Por eso el reloj de `emitir` se escribe `{ opciones: { reloj } }` (`emision.ts:202`), mientras
que `anular`, `registrarAutorizacion` y `corregirFechaAdelantada` lo reciben directo como `{ reloj }`
(`emision.ts:90, 272, 335`).

### 2.3 Dónde va el almacén

| Función | Firma |
|---|---|
| `registrarAutorizacion` | `(almacen, autorizacion, opciones?)` — `emision.ts:87` |
| `buscarDocumento` | `(almacen, numero)` — `emision.ts:466` |
| `eventosAuditoria` | `(almacen, filtro?)` — `emision.ts:389` |
| `corregirFechaAdelantada` | `(almacen, config)` — `emision.ts:333` |
| `noUtilizadosDelAlmacen` | `(almacen, identificador, …)` — `no-utilizados.ts:151` |
| `emitir` | `(entrada, { almacen, … })` — `emision.ts:195` |
| `anular` | `(numero, { almacen, motivo, … })` — `emision.ts:267` |

Además, **no hay funciones para listar documentos ni para leer el estado de una serie.** La guía hace que el
integrador abra una transacción a mano (`docs/guia-sdk.md:160`):

```ts
const docs = await almacen.transaccion((tx) => tx.documentos({ desde: '2026-11-01', hasta: '2026-11-30' }));
```

Y `estadoAutorizacion(aut, ultimoCorrelativo)` exige un `ultimoCorrelativo` que solo se obtiene con
`tx.bloquearSerie`. El ejemplo POS dedica 12 líneas a calcularlo (`examples/pos-offline/src/pos.ts:116-127`). El
MCP local tiene su propia versión (`packages/mcp/src/backend.ts`, `estadoCAI`) y el playground otra.

### 2.4 Salida

`DocumentoFiscal.totales` son `number` en lempiras: `{"subtotal":89.8,"isv15":13.47,"total":103.27,…}`
(comprobado). El cálculo es exacto y la conversión a `number` ocurre solo a la salida (`dinero.ts:115`,
`calculo.ts:237`). Pero un integrador que **sume** totales en JavaScript vuelve a usar punto flotante, y no hay
ninguna función que entregue los centavos de un documento ya emitido.

El tipo de `DocumentoFiscal` es mutable (`congelar<T>(v): T`), aunque el objeto real está congelado: una
asignación compila y falla en tiempo de ejecución.

### 2.5 Adaptadores

| | `@factura-hn/sqlite` | `@factura-hn/postgres` | `AlmacenFiscalMemoria` |
|---|---|---|---|
| Construcción | `new AlmacenSQLite(db)`: aplica el esquema **en el constructor** (síncrono) | `new AlmacenPostgres(pool)` + `await almacen.migrar()` | `new AlmacenFiscalMemoria()` |
| Driver | lo trae el integrador (`node:sqlite` desde Node 22.5, o `better-sqlite3`) | lo trae el integrador (`pg`) | — |
| `engines` | `>=18` (pero `node:sqlite` exige 22.5+; la guía dice 22.13+) | `>=18` | — |
| Extra | — | `paraTenant`, `TransaccionPostgres.consulta`, `esTransaccionPostgres` | — |

El nombre `AlmacenFiscalMemoria` no sigue el patrón `Almacen<Tecnología>` de los otros dos. Es una incoherencia
menor y **no recomiendo renombrarlo** (§5).

`@factura-hn/pdf` exporta `renderizarPDF(doc, { formato: 'carta' | 'ticket', leyenda? })`. La opción se llama
igual que en `renderizarHTML` (bien). Pero `renderizarTexto` recibe un tipo en línea `{ ancho?, leyenda? }`, sin
nombre exportado (`render.ts:213`), y el cliente de la API llama `papel` a lo mismo (`descargar(numero, 'pdf',
{ papel })`, `packages/cliente/src/index.ts:116`).

### 2.6 Cuántas líneas cuesta hoy

**Caso más común: factura demo con almacén (SQLite en memoria) y PDF.** El script que corrí
(`minimo-actual.mjs`, fuera del repositorio) produjo `000-001-01-00000001`, un total de 179 y un PDF de 3.5 KB:

| Pieza | Líneas |
|---|---|
| Imports (`node:fs`, `node:sqlite`, `factura-hn`, `@factura-hn/sqlite`, `@factura-hn/pdf`) | 5 |
| Abrir el almacén | 1 |
| Registrar el CAI (con formato de una propiedad por línea, como en la documentación) | 9 |
| Emitir (de ellas, 9 son para el emisor) | 16 |
| Guardar el PDF | 1 |
| Imprimir el número | 1 |
| **Total** | **33** |

**Ejemplos y fragmentos actuales** (código = líneas sin las vacías ni los comentarios):

| Archivo | Total | Código | Qué hace |
|---|---|---|---|
| README «En 30 segundos» (`README.md:28-70`) | 43 | 36 | Memoria, CAI, emitir, HTML. **No hay PDF.** |
| `docs/guia-sdk.md` pasos 2 a 4 | ~55 | 39 | SQLite, CAI, emitir con try/catch, ticket |
| `examples/basico/basico.ts` | 60 | 49 | Memoria, emitir, HTML y texto. **No hay PDF.** |
| `examples/pos-offline/src/pos.ts` | 218 | 172 | ~25 líneas de idempotencia propia, 12 de estado del CAI y 3 de búsqueda por transacción |
| `examples/pos-offline/src/servidor.ts` + `pagina.ts` | 166 | 143 | servidor HTTP y página |
| `examples/express/src/app.ts` (vía API) | 103 | 67 | pedido → factura, PDF y webhooks |
| `examples/nextjs/lib/ventas.ts` + `fhn.ts` (vía API) | 69 | 49 | server action |
| `examples/playground/src/playground.ts` | 215 | 187 | navegador, con sus propios datos demo |

Ningún ejemplo del SDK recorre de punta a punta «emitir → PDF». Solo hay un fragmento suelto en la guía
(`docs/guia-sdk.md:107-116`).

### 2.7 Mensajes de error reales

Los obtuve corriendo contra `packages/core/dist`. El prefijo `ErrorValidacion.message` es siempre
`"Documento inválido: "` (`documento.ts:123`), **aunque lo que falle sea registrar un CAI o anular**.

| # | Situación | Código y mensaje real | ¿Qué pasó? | ¿Artículo? | ¿Qué hacer? |
|---|---|---|---|---|---|
| 1 | Emitir sin un CAI registrado | `SIN_AUTORIZACION`: «No hay autorización (CAI) registrada para este punto de emisión y tipo de documento (Arts. 59-61).» | Sí, pero no dice **cuál** serie (`000-001-06`) | Sí | **No** |
| 2 | Emisor con 2 de 7 campos | 5 errores `EMISOR_*`, uno por campo, con su literal del Art. 10 num. 1 | Sí | Sí | Sí, en `NOMBRE_COMERCIAL` («repite la razón social») |
| 3 | Precio `0.1 + 0.2` | `LINEA_PRECIO`: «Línea 1: El precio unitario admite como máximo 4 decimales: "0.30000000000000004"» | Sí | No aplica | A medias: no sugiere pasarlo como texto |
| 4 | `isv: 'isv15'` | `LINEA_ISV`: «tratamiento ISV inválido "isv15"» | Sí | — | **No** lista los valores válidos |
| 5 | Venta mayor de L 10,000 sin identificar | `CONSUMIDOR_FINAL_IDENTIFICACION`: «… requieren nombre e identificación del cliente (Art. 11).» | Sí | Sí | Sí |
| 6 | RTN de 13 dígitos | `CLIENTE_RTN`: «RTN del cliente inválido (14 dígitos).» | Sí | Base: DEC-024 | Sí |
| 7 | `fechaEmision` de ayer | `FECHA_EMISION_NO_ES_HOY`: «… No se puede retrofechar ni adelantar (Arts. 14 y 43).» | Sí | Sí | No dice «omite el campo» (AGENTS.md sí) |
| 8 | Nota de crédito sin datos | `REFERENCIA`, `MOTIVO`, `CLIENTE_NOMBRE`, `NOTA_CLIENTE_RTN` | Sí | Sí, en 2 de 4 | Sí |
| 9 | Anular con motivo vacío | `ANULACION_MOTIVO`: «La anulación requiere un motivo.» | Sí | **No** (DEC-001) | Sí |
| 10 | Anular dos veces | `YA_ANULADO`: «… (Art. 41). No se puede anular dos veces ni reactivar.» | Sí | Sí | Sí |
| 11 | Registrar un CAI con rango 10–5 | `RANGO`: «Rango autorizado inválido.» | **No dice por qué** | — | **No** |
| 12 | Registrar un CAI **ya vencido** | Se registra **sin aviso** (`validarAutorizacion` no mira la fecha). Falla después, al emitir | **No** | — | **No** |
| 13 | `emitir(…, { establecimiento, puntoEmision })` sin `almacen` | `TypeError: Cannot read properties of undefined (reading 'transaccion')` | **No** | — | **No** |
| 14 | Precio `'89,50'` | **Sin error.** Se lee 8950; la factura sube a L 10,292.50 y falla por `CONSUMIDOR_FINAL_IDENTIFICACION`, un error que despista. Con un precio menor, **se emite** con el monto ×100 | **No** | — | **No** |
| 15 | Precio `'L 89.50'` | `ErrorCalculo`: «Monto inválido: "L 89.50"» | Sí | — | No |

Con un recuento aproximado sobre el código fuente, unos 26 de los 71 códigos de `packages/core/src` citan un
artículo literalmente en el mensaje, y unos pocos más lo citan a través de una variable (`TIPO_NO_EMITIBLE`,
`EXONERACION_*`). La columna «qué hacer» está completa solo en la tabla de AGENTS.md («Referencia rápida de
errores»), no en el objeto de error. Además, `Problema.codigo` es un `string` libre: no hay una unión de tipos
para tratar los errores de forma exhaustiva.

### 2.8 ESM, CJS y tipos

- La compilación dual es correcta (tsup `--format esm,cjs --dts`) y los paquetes cargan como CJS.
- **Riesgo de paquete dual:** si una aplicación ESM carga una dependencia que hace `require('factura-hn')`,
  existen dos clases `ErrorValidacion` y `e instanceof ErrorValidacion` falla. El nombre se fija
  (`this.name = 'ErrorValidacion'`), pero no hay una función como `esErrorValidacion(e)`.
- `factura-hn/pruebas` solo se resuelve con `moduleResolution` `node16` o `bundler`: no hay `typesVersions`
  para `node10`. Es un detalle menor.
- `@factura-hn/cliente` exporta `ClienteFacturaHN` (`packages/cliente/src/index.ts:155`), pero los ejemplos de
  Express y Next.js escriben `ReturnType<typeof crearCliente>`.

---

## 3. Problemas, de mayor a menor impacto

1. **El primer contacto exige demasiado.** Para la primera factura hay que saber qué es un CAI, inventar uno
   ficticio, escribir 7 campos de emisor, repetir el establecimiento y el punto de emisión en dos llamadas,
   decidir `preciosIncluyenISV` e instalar 3 paquetes: 33 líneas. Afip SDK resuelve ese momento con un entorno
   de prueba listo; aquí el playground y la API tienen datos demo, pero el SDK no.
2. **El ejemplo del README y la guía caduca el 2027-06-30**, y la CI no lo detecta porque las pruebas fijan la
   fecha (`test/setup.ts:6`). Para alguien que llega nuevo, es el peor error posible: el primer copiar y pegar
   falla.
3. **`'89,50'` se lee como 8950** (`dinero.ts:40`). En Honduras, la coma decimal la teclea con frecuencia quien
   tiene el teclado en español. El SDK rechaza `0.1 + 0.2` para no redondear en silencio (CHANGELOG, B-17), pero
   aquí multiplica por 100 en silencio. Es incoherente con esa misma filosofía y puede producir un documento
   fiscal con un monto equivocado.
4. **Los errores de configuración no guían.** `SIN_AUTORIZACION` sin la serie (sobre todo al emitir la primera
   nota de crédito, que necesita su propio CAI 06), `RANGO` sin explicación, el `TypeError` cuando falta
   `almacen` y el CAI vencido que se registra sin aviso. Estos son justamente los errores de los primeros
   5 minutos.
5. **Las piezas que todos necesitan están reimplementadas fuera del núcleo:** la idempotencia por venta (POS,
   MCP local y API), el estado del CAI de la caja (POS, MCP, playground y API), los datos demo (playground y API)
   y el listado de documentos (con transacciones a mano). Cada copia es una ocasión de divergir; de hecho, el POS
   y el MCP ya eligen la autorización «actual» de forma distinta.
6. **La notas de crédito son tediosas y fáciles de equivocar.** El integrador copia a mano el cliente, el CAI, el
   número, la fecha y `preciosIncluyenISV` del original (`docs/guia-sdk.md:137-148`), aunque `emitir` ya lee el
   original del almacén para validarlo (`emision.ts:244-245`, `problemasDeReferencia`).
7. **Las firmas no son coherentes:** el almacén va como primer argumento o dentro de la configuración, el reloj
   va anidado o directo, el `operador` tiene tres formas y el SDK devuelve `DocumentoFiscal` donde el cliente
   devuelve `{ documento, repetida }`. Pasar del SDK a la API (o al revés) obliga a reescribir.
8. **Los totales salen en punto flotante**, sin una función que dé los centavos para sumar o conciliar.
9. **Faltan tipos:** `Problema.codigo` es `string`, `DocumentoFiscal` aparece mutable aunque está congelado,
   no hay constantes para los tipos de documento y `renderizarTexto` no tiene un tipo de opciones con nombre.
10. **Detalles de los paquetes:** `engines` de `@factura-hn/sqlite` en `>=18` frente a `node:sqlite` 22.5+,
    `typesVersions` para `pruebas` y los ejemplos que no usan `ClienteFacturaHN`.

---

## 4. API ideal

Hay tres principios:

- **No crear un segundo camino de emisión.** La fachada llama a `emitir` y `anular` por dentro: misma
  transacción, mismas validaciones y misma bitácora. DEC-007 se respeta, porque sigue sin existir otra forma de
  construir un documento. Conviene dejarlo escrito en una DEC nueva.
- **Configurar una vez lo que es del negocio** (emisor, caja, política de precios) y pasar en cada venta solo lo
  que es de la venta.
- **La misma forma que `@factura-hn/cliente`** (`{ documento, repetida }`, `idempotencyKey`,
  `anular(numero, motivo, opciones)`), para pasar del SDK a la API cambiando una sola línea.

### 4.1 Tipos propuestos (todos son adiciones)

```ts
// factura-hn
export interface ConfigFacturador {
  almacen: AlmacenFiscal;
  emisor: Emisor;                       // los 7 datos del Art. 10 num. 1, una sola vez
  establecimiento: string | number;
  puntoEmision: string | number;
  /** Obligatorio aquí, a propósito: elegir mal cambia el ISV de cada línea. */
  preciosIncluyenISV: boolean;
  actor?: string;                       // bitácora
  reloj?: () => Date;
  umbralIdentificacionConsumidorFinal?: Monto;
  libroContable?: LibroContable;        // Art. 53 num. 1
}

/** Lo de la venta: sin emisor, tipo, referencia ni fecha (la pone el reloj). */
export type Venta = Omit<DocumentoEntrada, 'emisor' | 'tipoDocumento' | 'referencia' | 'motivo' | 'fechaEmision'>;

export interface NotaEntrada {
  /** Número del documento original. Si está en el almacén, de él se toman el cliente, la referencia, la moneda
   *  y preciosIncluyenISV (B-13). Si no está (DEC-004), pasa `referencia` y `cliente` completos. */
  original: string;
  motivo: string;                       // Arts. 26 y 28
  lineas: LineaEntrada[];
  cliente?: Cliente;
  referencia?: Partial<ReferenciaDocumento>;
}

export interface OpcionesOperacion {
  /** Igual que en @factura-hn/cliente: la misma clave devuelve el mismo documento, y una clave usada con
   *  otra venta da IDEMPOTENCIA_CONFLICTO. */
  idempotencyKey?: string;
  operador?: string;                    // bitácora (DEC-031)
  imprimirOperador?: boolean;           // como en la API: imprime «Atendido por»
  confirmarSaltoDeFecha?: boolean;
  alEmitir?: (doc: DocumentoFiscal, tx: TransaccionFiscal) => Promise<void>;
}

export interface ResultadoEmision {
  documento: DocumentoFiscal;
  repetida: boolean;
  advertencias: Problema[];             // atajo de documento.advertencias
}

export interface Facturador {
  registrarAutorizacion(a: Omit<AutorizacionCAI, 'establecimiento' | 'puntoEmision'>):
    Promise<{ autorizacion: AutorizacionCAI; advertencias: Problema[] }>;
  cotizar(venta: Venta): ReturnType<typeof calcularDocumento>;   // lo que se cobrará, antes de emitir
  factura(venta: Venta, o?: OpcionesOperacion): Promise<ResultadoEmision>;
  notaCredito(nota: NotaEntrada, o?: OpcionesOperacion): Promise<ResultadoEmision>;
  notaDebito(nota: NotaEntrada, o?: OpcionesOperacion): Promise<ResultadoEmision>;
  anular(numero: string, motivo: string, o?: { operador?: string }): Promise<DocumentoFiscal>;
  documento(numero: string): Promise<DocumentoFiscal | null>;
  documentos(desde: string, hasta: string): Promise<DocumentoFiscal[]>;
  /** Estado de cada serie de esta caja (01, 06, 07) con sus alertas (Arts. 59 y 62). */
  estado(): Promise<EstadoCaja>;
}

export function crearFacturador(config: ConfigFacturador): Facturador;
```

```ts
// factura-hn/demo — un submódulo aparte para que el nombre ya diga «no es producción»
export const EMISOR_DEMO: Emisor;       // razón social «NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)»
export const CAI_DEMO: string;          // 'DEMO00-NO-VALIDO-0000-0000-0000-00', el mismo de la API
/** Registra CAI ficticios 01, 06 y 07 en 000-001 con fecha límite = hoy en Honduras + 180 días.
 *  Es idempotente: si ya están registrados, no repite. Almacén en memoria por defecto. */
export function crearFacturadorDemo(o?: { almacen?: AlmacenFiscal; reloj?: () => Date }): Promise<Facturador>;
```

```ts
// @factura-hn/sqlite
/** Abre (o crea) el archivo con node:sqlite (Node 22.5+). Para better-sqlite3 sigue usando `new AlmacenSQLite(db)`. */
export function abrirAlmacenSQLite(ruta: string, opciones?: OpcionesAlmacenSQLite): Promise<AlmacenSQLite>;
```

Estas son las funciones libres que se agregan al núcleo, y que la fachada usa por dentro:
`listarDocumentos(almacen, filtro)`, `estadoSeries(almacen, { establecimiento, puntoEmision, reloj? })`,
`totalesEnCentavos(doc)` y `esErrorValidacion(e)`.

### 4.2 Caso más común: la primera factura en PDF

```ts
import { writeFile } from 'node:fs/promises';
import { crearFacturadorDemo } from 'factura-hn/demo';
import { renderizarPDF } from '@factura-hn/pdf';

const fhn = await crearFacturadorDemo();
const { documento } = await fhn.factura({
  lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '2', precioUnitario: '89.50' }],
});
await writeFile('factura.pdf', await renderizarPDF(documento));
```

Son **8 líneas, frente a 33**, y 2 paquetes (`npm i factura-hn @factura-hn/pdf`). No hay fecha fija en el
código, así que no caduca. El PDF lleva «NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)» como razón social,
igual que la demo de la API (`packages/api/src/operador.ts:66-79`).

Para pasar a datos reales con SQLite, solo cambian la configuración y el registro del CAI:

```ts
import { crearFacturador } from 'factura-hn';
import { abrirAlmacenSQLite } from '@factura-hn/sqlite';

const fhn = crearFacturador({
  almacen: await abrirAlmacenSQLite('fiscal.db'),
  emisor,                                   // los 7 datos de la configuración del negocio
  establecimiento: '000',
  puntoEmision: '001',
  preciosIncluyenISV: true,
});
// Una vez, desde la pantalla de configuración, con los datos de la resolución del SAR:
await fhn.registrarAutorizacion(datosDeLaResolucion);
```

### 4.3 POS (una caja, fuera de línea)

```ts
import { crearFacturador, esErrorValidacion, renderizarTexto, type LineaEntrada } from 'factura-hn';
import { abrirAlmacenSQLite } from '@factura-hn/sqlite';

const caja = crearFacturador({
  almacen: await abrirAlmacenSQLite('caja1.db'),
  emisor: await cargarEmisor(),
  establecimiento: '000',
  puntoEmision: '001',                      // cada caja con su propio punto de emisión y CAI
  preciosIncluyenISV: true,                 // precio de góndola
  actor: 'caja-1',
});

// Banner de la caja: vencimiento cercano o rango casi agotado (Arts. 59 y 62).
const { alertas } = await caja.estado();
mostrarAvisos(alertas.map((a) => a.mensaje));

// Antes de cobrar: el total exacto que se imprimirá (D-01, puede quedar 1 centavo abajo).
const { totales } = caja.cotizar({ lineas: carrito });
cobrar(totales.total);

// Al confirmar el pago. `venta.id` lo genera la caja: si la red o la impresora fallan y se reintenta,
// devuelve el mismo documento en lugar de emitir otro.
try {
  const { documento, repetida, advertencias } = await caja.factura(
    { cliente: venta.cliente, lineas: carrito as LineaEntrada[] },
    { idempotencyKey: venta.id, operador: sesion.cajero, imprimirOperador: true },
  );
  imprimir(renderizarTexto(documento, { ancho: 42 }));
  if (advertencias.length) mostrarAvisos(advertencias.map((a) => a.mensaje));
} catch (e) {
  if (esErrorValidacion(e)) mostrarErrores(e.errores);  // código, mensaje, artículo y qué hacer
  else throw e;
}

// Anulación (Art. 41): el número sigue consumido.
await caja.anular('000-001-01-00000042', 'Cantidad equivocada', { operador: sesion.supervisor });
```

Frente a `examples/pos-offline/src/pos.ts`, desaparecen la tabla `pos_ventas` con su huella (unas 25 líneas),
el cálculo del estado del CAI (12 líneas) y la búsqueda por transacción (3 líneas). La cola de sincronización
sigue en el ejemplo, dentro de `alEmitir`, porque es propia del POS y no del núcleo.

### 4.4 Tienda en línea (servidor con PostgreSQL)

```ts
import pg from 'pg';
import { crearFacturador, esErrorValidacion } from 'factura-hn';
import { AlmacenPostgres, esTransaccionPostgres } from '@factura-hn/postgres';
import { renderizarPDF } from '@factura-hn/pdf';

const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await almacen.migrar();
const tienda = crearFacturador({
  almacen,
  emisor: await cargarEmisor(),
  establecimiento: '000',
  puntoEmision: '002',                      // la tienda web es su propio punto de emisión
  preciosIncluyenISV: true,
  actor: 'tienda-web',
});

export async function facturarPedido(pedido: Pedido) {
  const { documento } = await tienda.factura(
    {
      // Más de L 10,000 a consumidor final exige nombre e identificación (Art. 11): se pide en el checkout.
      cliente: pedido.rtn
        ? { nombre: pedido.razonSocial, rtn: pedido.rtn }
        : pedido.dni ? { nombre: pedido.nombre, identificacion: { tipo: 'DNI', numero: pedido.dni } } : undefined,
      lineas: pedido.articulos.map((a) => ({
        codigo: a.sku, descripcion: a.nombre, cantidad: a.cantidad, precioUnitario: a.precio, isv: a.isv,
      })),
    },
    {
      idempotencyKey: `pedido-${pedido.id}`,      // el reintento del webhook de pago no duplica
      // En la misma transacción fiscal: si falla, no se consume el número.
      alEmitir: async (doc, tx) => {
        if (esTransaccionPostgres(tx)) await tx.consulta('UPDATE pedidos SET factura = $1 WHERE id = $2', [doc.numero, pedido.id]);
      },
    },
  );
  // Si el cliente no está presente, el emisor le hace llegar el original (AGENTS.md, «Momento de emisión (Art. 14)»).
  await enviarCorreo(pedido.correo, await renderizarPDF(documento), documento.numero);
  return documento.numero;
}
```

Si mañana la tienda decide usar la API alojada, el cambio es `crearCliente({ url, llave })` en lugar de
`crearFacturador(…)`. Con la misma forma de resultado, el resto del código no cambia (salvo `alEmitir`, que no
existe al otro lado de HTTP; ahí se usa el webhook).

### 4.5 Nota de crédito

```ts
// Devolución parcial de la factura 000-001-01-00000042.
const { documento: nota, advertencias } = await caja.notaCredito(
  {
    original: '000-001-01-00000042',
    motivo: 'Devolución de 1 bolsa de arroz',
    lineas: [{ descripcion: 'Arroz 5 lb', cantidad: '1', precioUnitario: '89.50' }],
  },
  { idempotencyKey: `devolucion-${devolucion.id}` },
);
```

Lo que hace la fachada, y todo ya está respaldado en el código:

- Lee el original **dentro de la misma transacción** y copia el cliente (nombre y RTN), la referencia (CAI,
  número y fecha), la moneda y el tipo de cambio (DEC-018), y `preciosIncluyenISV`. Los mismos datos se siguen
  validando (B-13, `emision.ts:402-454`).
- Si el original no está en el almacén (talonario u otro sistema), exige `referencia` y `cliente` completos y
  deja `AVISO_ORIGINAL_EXTERNO` (DEC-004).
- Si el original se emitió a CONSUMIDOR FINAL, sin RTN, la nota no puede tomarlo de él. El error es el de
  siempre, `NOTA_CLIENTE_RTN` (Arts. 26 y 28 num. 1-2), pero con un «qué hacer» concreto: «La factura original
  no tiene RTN del adquirente; pasa `cliente: { nombre, rtn }`». Con eso, la emisión sigue con
  `AVISO_ORIGINAL_SIN_RTN`.
- Si no hay un CAI 06 registrado, `SIN_AUTORIZACION` nombra la serie `000-001-06` y la llamada que falta.
- **Por confirmar:** si una nota de crédito puede superar el monto del original o el saldo pendiente tras otras
  notas. No hay ningún artículo citado en el código ni en docs/, así que **no propongo validarlo** hasta que
  exista una fuente.

### 4.6 Errores ideales

`Problema` gana dos campos opcionales. Es compatible: el JSON actual sigue siendo válido.

```ts
export interface Problema {
  codigo: CodigoProblema | (string & {});   // unión exportada, sin cerrar la puerta a códigos nuevos
  mensaje: string;
  campo?: string;
  /** Fuente, si existe: 'Reglamento Art. 10 num. 1 c', 'Ley del ISV Art. 9', 'DEC-024'. */
  fuente?: string;
  /** Qué hacer, en una frase. Hoy está en la tabla «Referencia rápida de errores» de AGENTS.md. */
  solucion?: string;
}
```

Así se verían los mensajes de los casos que hoy fallan (el texto de la «fuente» sale de lo que ya cita el
código):

| Código | Mensaje propuesto | `solucion` |
|---|---|---|
| `SIN_AUTORIZACION` | «No hay CAI registrado para Nota de Crédito en la serie 000-001-06.» (Arts. 59-61) | «Registra la autorización con `registrarAutorizacion({ tipoDocumento: '06', establecimiento: '000', puntoEmision: '001', … })`.» |
| `AUTORIZACION_VENCIDA` | «La última autorización de 000-001-01 venció el 2027-06-30.» (Art. 62) | «Solicita un nuevo CAI y regístralo.» |
| `RANGO` | «El rango inicial (10) es mayor que el final (5).» / «… debe estar entre 1 y 99999999» (D-07) | «Cópialo tal como viene en la resolución.» |
| `LINEA_ISV` | «Línea 1: tratamiento ISV inválido "isv15".» | «Usa 'ISV15', 'ISV18', 'GRAVADO0' o 'EXENTO'.» |
| `LINEA_PRECIO` | «Línea 1: el precio "89,50" usa coma decimal.» | «Usa punto decimal: '89.50'.» |
| `CONFIGURACION` (nuevo, sin carácter fiscal) | «emitir: falta `almacen` en la configuración.» | «Pasa un AlmacenFiscal (AlmacenSQLite, AlmacenPostgres o AlmacenFiscalMemoria).» |
| `AVISO_AUTORIZACION_VENCIDA` (aviso nuevo, al registrar) | «La fecha límite 2025-01-01 ya pasó: esta autorización no servirá para emitir (Art. 62).» | «Si la registras para el reporte de no utilizados (Art. 42), ignora este aviso.» |

`ErrorValidacion.message` debería decir qué operación falló («No se pudo emitir en 000-001-01: …», «No se pudo
registrar la autorización: …») en lugar de «Documento inválido:».

---

## 5. Cambios compatibles e incompatibles

**Contexto de versiones:** ni la 0.1.0 ni la 0.2.0 se han publicado en npm (CHANGELOG; DEC-042), y D-02 permite
cambios incompatibles en versión menor mientras sea 0.x. Hoy un cambio incompatible no le cuesta nada a ningún
usuario externo. Después de la primera publicación, cada uno exigirá una nota de migración.

### 5.1 Compatibles (solo agregan)

| # | Cambio | Paquete |
|---|---|---|
| C1 | `crearFacturador` (§4.1), una fachada sobre `emitir` y `anular`. Necesita una DEC que la distinga de un «segundo camino» (DEC-007) | core |
| C2 | Submódulo `factura-hn/demo` con `EMISOR_DEMO`, `CAI_DEMO` y `crearFacturadorDemo`. El playground y la API lo importan en lugar de mantener sus copias. La fecha límite se calcula con `fechaHonduras` (hoy usan `toISOString().slice(0, 10)`, que es la fecha UTC) | core, api, playground |
| C3 | Idempotencia en el núcleo: métodos **opcionales** en `TransaccionFiscal` (`buscarClave`, `guardarClave`), implementados en memoria, SQLite y Postgres, con casos en `ejecutarContratoAlmacen`. Un almacén de terceros sin esos métodos sigue funcionando; solo falla, con un mensaje claro, si se pide `idempotencyKey`. La lógica sale de `packages/mcp/src/backend.ts` y del POS | core, sqlite, postgres |
| C4 | `listarDocumentos(almacen, filtro)` y `estadoSeries(almacen, { establecimiento, puntoEmision })`. Se acaba el `almacen.transaccion(tx => …)` en la documentación | core |
| C5 | `Problema.fuente?` y `Problema.solucion?`, el tipo `CodigoProblema` y `esErrorValidacion(e)` | core |
| C6 | Mensajes más completos para `SIN_AUTORIZACION`, `AUTORIZACION_VENCIDA`, `RANGO`, `LINEA_ISV` y `LINEA_PRECIO`, y un error claro cuando falta `almacen`. Los códigos no cambian; solo el texto | core |
| C7 | `reloj`, `umbralIdentificacionConsumidorFinal` y `caiEstricto` también al primer nivel de `OpcionesEmision`; `opciones` anidado queda como obsoleto. `imprimirOperador?: boolean` en `OpcionesEmision`, igual que en la API | core |
| C8 | `totalesEnCentavos(doc)`, que da los enteros a partir de los `number` de salida, de forma exacta porque `deCentavos` produce la representación más corta | core |
| C9 | Constantes `TIPO_FACTURA = '01'`, `TIPO_NOTA_CREDITO = '06'` y `TIPO_NOTA_DEBITO = '07'`, y el tipo exportado `OpcionesTexto` para `renderizarTexto` | core |
| C10 | `abrirAlmacenSQLite(ruta)`; `engines` o documentación que aclaren que `node:sqlite` exige Node 22.5+ | sqlite |
| C11 | `typesVersions` para `factura-hn/pruebas` | core |
| C12 | Documentación: el README empieza con §4.2 y su PDF; `examples/basico` emite y guarda el PDF; el README y la guía calculan la fecha límite en lugar de fijar `2027-06-30`; Express y Next.js usan `ClienteFacturaHN`; y una prueba que corra el ejemplo del README **con el reloj real** para detectar la caducidad | docs, examples |

### 5.2 Incompatibles, cada uno con su justificación

| # | Cambio | Qué se rompe | Por qué vale la pena |
|---|---|---|---|
| I1 | **`parsearDecimal` solo acepta comas como separador de miles en grupos de 3** (`1,000.50` sigue valiendo; `89,50` y `8,9,5` dan `ErrorMonto`) | Entradas mal formadas que hoy pasan | Hoy `'89,50'` se convierte en 8950 en silencio, y un documento fiscal puede salir con el monto multiplicado por 100. Es la misma razón con la que la 0.2.0 dejó de redondear `0.1 + 0.2` en silencio (B-17). Ninguna entrada correcta deja de funcionar. De paso conviene decidir si se mantiene la notación exponencial en texto (`'1e2'` hoy se lee como 100); no la propongo como cambio, solo como pregunta |
| I2 | **`Problema.campo` más preciso en las líneas:** `lineas[0].precioUnitario` en lugar de `lineas[0]` | Interfaces que comparan `campo` de forma exacta | Permite marcar el campo exacto del formulario. Es la promesa de «errores con código, mensaje y campo» del README. Hay que actualizar OpenAPI y la API a la vez |
| I3 | **Tipos de solo lectura en profundidad** para lo que devuelven `emitir`, `anular`, `buscarDocumento` y la fachada (`Readonly` recursivo de `DocumentoFiscal`) | Código que asigna sobre el documento (deja de compilar) | Ese código **ya falla en tiempo de ejecución**, porque el objeto está congelado (`inmutable.ts`). El cambio adelanta el error a la compilación. La regla viene del Art. 41: un documento emitido no se edita |
| I4 | **Quitar `OpcionesEmision.opciones` anidado** (después de C7) | Llamadas con `{ opciones: { reloj } }` | Hay una sola forma de pasar el reloj en todo el SDK. Propongo quitarlo **en la 1.0.0**, no antes: C7 ya resuelve la incoherencia sin romper nada |
| I5 | **`ErrorValidacion.message` con el contexto de la operación** en lugar de «Documento inválido:» | Quien compare el texto de `message` | El contrato son los `codigo`, no el texto, pero lo dejo aquí por si alguna prueba de la API compara mensajes. Hoy el texto miente en `anular` y en `registrarAutorizacion` |

**Lo que no recomiendo cambiar:**

- El valor por defecto de `preciosIncluyenISV` en `emitir`. Cambiarlo alteraría en silencio el ISV de quien no
  lo pasa. La fachada lo resuelve haciéndolo obligatorio en su configuración.
- El nombre `AlmacenFiscalMemoria`. El nombre «natural», `AlmacenMemoria`, ya existió con otra semántica en la
  0.1.0 (CHANGELOG), y la confusión costaría más que la incoherencia.
- El orden de los argumentos de las funciones libres. La fachada esconde el almacén, y reordenar rompería todo
  sin ganar nada para quien use `crearFacturador`.
- Que los totales sean `number`. Pasarlos a texto o a centavos cambiaría el JSON que ya se guarda (y que los
  disparadores de SQLite comparan). C8 da la vía exacta sin romper nada.

---

## 6. Recomendaciones por impacto y esfuerzo

| Prioridad | Recomendación | Impacto | Esfuerzo | Cambios |
|---|---|---|---|---|
| 1 | Corregir la lectura de `'89,50'`, con una prueba | Alto (riesgo de un monto fiscal equivocado) | Bajo | I1 |
| 2 | Fecha límite relativa en los ejemplos, el README y la guía, y una prueba con el reloj real | Alto (el primer ejemplo caduca el 2027-07-01) | Bajo | C12 |
| 3 | `factura-hn/demo` y unificar los datos demo de la API y el playground | Alto (el «5 minutos») | Bajo | C2 |
| 4 | Mensajes de configuración: `SIN_AUTORIZACION` con la serie, `RANGO` con el motivo, error claro sin `almacen` y aviso al registrar un CAI vencido | Alto (son los errores de los primeros 5 minutos) | Bajo | C6 |
| 5 | `crearFacturador` con `factura`, `notaCredito`, `notaDebito`, `anular`, `documento`, `documentos`, `estado` y `cotizar`, más su DEC | Alto | Medio | C1 |
| 6 | README y `examples/basico` reescritos sobre §4.2, con PDF | Alto | Bajo (después del 3 y el 5) | C12 |
| 7 | `fuente` y `solucion` en `Problema`, a partir de la tabla de AGENTS.md; `CodigoProblema`; `esErrorValidacion` | Medio-alto | Medio (71 códigos que revisar) | C5 |
| 8 | Idempotencia en el núcleo y en los tres almacenes; el POS y el MCP pasan a usarla | Medio-alto (POS y tienda) | Medio-alto (contrato y 3 adaptadores) | C3 |
| 9 | `listarDocumentos` y `estadoSeries`; quitar las transacciones a mano de la guía y los ejemplos | Medio | Bajo | C4 |
| 10 | `abrirAlmacenSQLite` y la versión de Node bien documentada | Medio | Bajo | C10 |
| 11 | Opciones planas en `emitir` e `imprimirOperador` | Medio | Bajo | C7 |
| 12 | `totalesEnCentavos`, constantes de tipo, `OpcionesTexto` y `typesVersions` | Bajo-medio | Bajo | C8, C9, C11 |
| 13 | Tipos de solo lectura y `campo` preciso, ambos **antes de la primera publicación** | Bajo-medio | Bajo | I2, I3 |
| 14 | Mensaje con el contexto de la operación | Bajo | Bajo | I5 |

**Orden sugerido:** del 1 al 4 en un primer lote (correcciones pequeñas, sin diseño nuevo). Después el 5 y el 6
juntos, para que el README estrene la fachada. Luego el 7, el 8 y el 9. Lo incompatible (I1, I2, I3 y I5)
conviene cerrarlo antes de activar la publicación en npm (DEC-042). Ninguna de estas recomendaciones cambia la
interpretación fiscal: la fachada de notas de crédito aplica B-13, DEC-004 y DEC-018 tal como están, y lo que no
tiene fuente (el tope de monto de una nota de crédito y si la hora de emisión debe llenarse sola) queda
**por confirmar**. Aun así, C1, C2 y C3 son decisiones de diseño y deben registrarse en `docs/decisiones.md`.
