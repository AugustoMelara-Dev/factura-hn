# factura-hn

## 0.3.0

### Minor Changes

- 74a8eea: Un solo modo de prueba, y los documentos de prueba fuera de los reportes fiscales.
  
  - `crearFacturadorDemo` da `DEMO_SIN_NUMEROS` si una renovación pasaría del correlativo 99 999 999.
  - `registrarAutorizacion` bloquea todas las series del punto de emisión, en orden fijo: dos registros
    simultáneos de tipos distintos en el mismo punto ya no pueden mezclar prueba y real.
  - README: la primera factura en 3 pasos por el SDK (`npx factura-hn init` y `node emitir.mjs`), la API y el MCP;
    Next.js, cómo pasar a producción con el CAI real y enlaces absolutos al repositorio.
  
  **Cambios incompatibles:**
  
  - `exportarTexto` (CSV, TXT y JSONL) y `libroVentas` dejan fuera los documentos de prueba (`modo: 'prueba'` o CAI
    `DEMO00-NO-VALIDO-…`). El encabezado TXT cuenta solo los reales. `libroVentas` devuelve además `excluidos`.
    Quien sumaba esos reportes con documentos de prueba verá totales menores.
  - Reglas del modo de prueba: una autorización con CAI ficticio es de prueba, con `prueba: true` o sin él, y un
    punto de emisión pasa de prueba a real, nunca al revés: una autorización de prueba no entra en un punto que
    tiene o tuvo una real (`AUTORIZACION_MODO_MEZCLADO`). Al registrar el CAI real, la demo de ese punto queda
    retirada en todos los tipos, y un rango real no puede repetir números ya usados por documentos de prueba
    (`RANGO_USADO_EN_PRUEBA`). `prueba: true` con un CAI real da `AUTORIZACION_PRUEBA_CAI_REAL`; un `prueba` que
    no es booleano, `AUTORIZACION_PRUEBA_FORMATO`.
  - Los documentos con CAI `DEMO00-…` ya emitidos (por ejemplo, con la demo de la API o del MCP de la 0.2.0) se
    reconocen como de prueba: al reimprimirse llevan la leyenda «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL» y salen
    del libro de ventas y de la exportación. No se modifica ningún documento guardado.
  - `ErrorValidacion.message` cambia de formato: cada problema va como `[CODIGO] mensaje.`, seguido de
    `Solución: …` y `Más información: <enlace a docs/errores.md>` cuando el código los tiene. Quien comparaba el
    texto debe usar `errores[].codigo`.
  
  **Nota de migración desde la 0.2.0:**
  
  Una base de la 0.2.0 puede tener, en el mismo punto de emisión, CAI de demostración `DEMO00-…` (sin
  `prueba: true`, que entonces no existía) y CAI reales. Registrar CAI reales en ese punto sigue funcionando,
  venza o no la demostración. Desde que el punto tiene una autorización real, sus autorizaciones de demostración
  quedan retiradas: no se vuelven a usar para emitir, en ningún tipo. Los documentos ya emitidos con ellas quedan
  como de prueba (ver arriba). Un CAI real nuevo cuyo rango empiece en un número ya usado por documentos de prueba
  de su serie da `RANGO_USADO_EN_PRUEBA`: regístralo en una base nueva.
- cc2bbd0: Pendientes menores del núcleo:
  
  - `emitir` y `validarEntrada` rechazan con `TEXTO_CARACTER_NO_PERMITIDO` (sin consumir número) un texto de la
    entrada, o el nombre de uno de sus campos, a cualquier profundidad, con un carácter de control (categoría Cc: C0,
    DEL y C1), salvo el tabulador y los saltos de línea, o con la mitad suelta de un par sustituto UTF-16. `campo`
    dice cuál (p. ej. `lineas[0].descripcion`). `anular` y `corregirFechaAdelantada` rechazan igual el motivo. Antes,
    un NUL se guardaba y en PostgreSQL el listado sin líneas y la anulación fallaban (`jsonb`). Nueva:
    `problemasDeTexto`.
  - Nueva `registrarAutorizacionConAvisos(almacen, autorizacion, opciones?)`: igual que `registrarAutorizacion`, y
    devuelve `{ autorizacion, advertencias }`, p. ej. con `AVISO_VIGENCIA_MAYOR_1_ANIO` (Art. 62).
    `registrarAutorizacion` no cambia de firma.
  
  **Cambios incompatibles:**
  
  - **La configuración del emisor también se revisa.** Un emisor configurado con un carácter de control (en
    `crearFacturador({ emisor })`, en `emitir({ emisor })` o guardado en la API) hace fallar toda emisión con
    `TEXTO_CARACTER_NO_PERMITIDO` y `campo: 'emisor.…'`, aunque la venta no lo traiga. Antes se emitía. La
    `solucion` de esos problemas dice que se corrige la configuración (en la API, `PATCH /v1/emisores/{id}`).
- 39072d8: Lo que encontraron las pruebas de propiedades y el fuzzing del núcleo:
  
  - `montoEnLetras` y `enteroALetras` escriben los billones (escala larga): 10^12 es «UN BILLÓN», no «UN MILLÓN
    MILLONES». Por debajo de 10^12 nada cambia.
  - `validarLineas` (y con ella `validarEntrada` y `calcularDocumento`) devuelve el problema `MONTO_FUERA_DE_RANGO`
    cuando el total del documento, con el ISV de cada grupo de tasa, pasaría de L 9,999,999,999,999.99
    (`MONTO_MAXIMO_CENTAVOS`, nueva exportación); `validarEntrada` también, cuando lo pasaría el total en lempiras de un
    documento en moneda extranjera. Es un tope técnico (el límite en que el total en `number` sigue exacto al
    centavo), no una regla fiscal. Antes, un total así lanzaba un `RangeError` a mitad del cálculo.
  - `leerExportacionJSONL` lanza `ErrorExportacion` (nueva exportación; sigue siendo `SyntaxError`) con el número de
    línea, también cuando una línea es JSON pero no un objeto (`5`, `null`, una lista). Antes, un `SyntaxError` sin línea o un
    documento que no lo era.
- Exportaciones nuevas del índice de `factura-hn` que no tenían entrada:
  
  - `esDocumentoDePrueba(doc)`: `true` si el documento es de prueba (`modo: 'prueba'` o CAI ficticio, también los
    emitidos antes de que existiera `modo`). `esAutorizacionDePrueba(autorizacion)`: `true` con `prueba: true` o un
    CAI ficticio. Son las que usan `exportarTexto`, `libroVentas` y `separarDocumentosDePrueba`.
  - El catálogo de soluciones de los errores: `SOLUCIONES` (código → qué hacer), `conSolucion(problema)` (completa
    `solucion` y `documentacion` si el código es del SDK, sin reemplazar las que ya trae), `enlaceError(codigo)`
    (enlace al código en `docs/errores.md`) y `URL_ERRORES` (la base de esos enlaces). Los usan la API y el MCP para
    dar la misma guía que el SDK.
  - `autorizacionesActivas(deSerie, puntoConReal)`: las autorizaciones de una serie que todavía pueden emitir (sin las
    de prueba si el punto ya tiene una real). La usa la API para listar las autorizaciones; es de bajo nivel y puede
    cambiar sin aviso mientras la versión sea 0.x.
- Node 20 o más reciente.
  
  **Cambios incompatibles:**
  
  - `factura-hn`, `@factura-hn/sqlite`, `@factura-hn/postgres` y `@factura-hn/pdf` piden Node 20 o más reciente
    (`engines: >=20`; antes, `>=18`). Node 18 dejó de recibir parches de seguridad en abril de 2025 y la CI ya no lo
    probaba. `@factura-hn/cliente` ya pedía Node 20 y `@factura-hn/mcp`, Node 22.13 (por `node:sqlite`).
    `@factura-hn/sqlite` sigue necesitando Node 22.13 si usas `node:sqlite` en lugar de `better-sqlite3`.
- Notas, anulación y exportación coherentes con el original:
  
  - `anular` rechaza con `DOCUMENTO_CON_NOTAS` (sin anular nada) un documento que tiene notas de crédito o débito
    vigentes: hay que anular primero las notas. Antes se anulaba y el libro de ventas quedaba en negativo.
  - Nota de crédito: además del total, la suma de las notas vigentes no puede superar, a cada tasa (15 % y 18 %), el
    importe gravado ni el ISV del original (`NOTA_SUPERA_ORIGINAL`, con el saldo de esa tasa en el mensaje).
  - Nota de crédito sobre un original en dólares: el saldo se calcula pasando las líneas del original por la misma
    conversión que la nota, así la devolución total de un documento en USD ya no da `NOTA_SUPERA_ORIGINAL` por
    redondeo.
  - Nuevo aviso `AVISO_NOTA_EXONERACION_DISTINTA` (con `solucion`) cuando el original es exonerado y la nota no, o al
    revés.
  - `emitir` bloquea la serie del original antes de leerlo al emitir una nota 06/07: una anulación y una nota
    simultáneas no dejan una nota vigente sobre un original anulado.
  - **Exportación versión 2** (`VERSION_EXPORTACION = 2`): el CSV y el TXT agregan al final las columnas
    `tipoCambio` y `fechaAnulacion`; el encabezado TXT pasa a `#factura-hn|v2|N`. Las 21 columnas de la versión 1 no
    cambian de nombre ni de orden. El JSONL no cambia.
  - El HTML explica «G0 = gravado 0%» cuando hay líneas `GRAVADO0`, como el ticket.
  - `estadoAutorizacion` con el último correlativo antes del rango (serie que viene de un CAI anterior) ya no da
    números restantes de más ni un porcentaje usado negativo.
  - `crearFacturadorDemo({ caiEstricto: true })` funciona: `caiEstricto` no exige la forma hexadecimal al CAI
    ficticio `DEMO00-NO-VALIDO-…`.
  - `npx factura-hn init`: `emitir.mjs` avisa que cada corrida empieza en 00000001 (almacén en memoria) y, si
    `emisor.json` no es JSON válido, lo dice en español y cómo arreglarlo, en lugar de un `SyntaxError`.
  - La batería `ejecutarContratoAlmacen` agrega una prueba de anulación con notas vigentes, también con anulación y
    nota a la vez.
  
  **Cambios incompatibles:**
  
  - `anular` (y `POST /v1/documentos/{numero}/anular` y la herramienta `anular_documento`) rechaza con
    `DOCUMENTO_CON_NOTAS` un documento con notas vigentes. Si tu sistema anulaba la factura sin anular antes sus
    notas, ahora debe anular primero las notas.
  - Una nota de crédito que superaba el gravado o el ISV del original a una tasa, aunque no superara el total, ahora
    da `NOTA_SUPERA_ORIGINAL`.
  - La exportación CSV y TXT es la versión 2: dos columnas más al final y el encabezado TXT `#factura-hn|v2|N`. Si
    validas el encabezado `v1` o el número exacto de columnas, actualízalo.
- 74a8eea: La primera factura en un minuto, sin CAI real:
  
  - `npx factura-hn demo` emite una factura de prueba e imprime su ticket; `npx factura-hn init` crea `emitir.mjs` y
    `emisor.json` para emitir con `node emitir.mjs`.
  - Submódulo `factura-hn/demo`: `crearFacturadorDemo()`, `autorizacionDemo()`, `EMISOR_DEMO`, `LEYENDA_PRUEBA` y
    `esCAIDemo(cai)` (también en el índice), que reconoce un CAI ficticio (prefijo `DEMO00-NO-VALIDO-`).
  - Modo de prueba: una autorización con CAI ficticio es de prueba, con `prueba: true` o sin él. Cada documento
    lleva `modo: 'prueba'`, y el HTML, el texto y el PDF imprimen «DOCUMENTO DE PRUEBA — SIN VALOR FISCAL».
    `prueba: true` con un CAI real se rechaza (`AUTORIZACION_PRUEBA_CAI_REAL`). Un punto de emisión pasa de prueba a real,
    nunca al revés (`AUTORIZACION_MODO_MEZCLADO`), y una nota no cruza de modo (`REFERENCIA_MODO_MEZCLADO`).
  - `exportarTexto` deja fuera los documentos de prueba. Nuevas: `libroVentas(docs)` (filas, resumen y cuántos
    quedaron fuera) y `separarDocumentosDePrueba(docs)`.
  - `crearFacturador({ almacen, emisor, establecimiento, puntoEmision })`: la configuración del negocio una vez, con
    `emitir`, `notaCredito`, `notaDebito`, `anular`, `documento`, `documentos`, `cotizar` y `registrarAutorizacion`.
    Por dentro usa `emitir` y `anular`.
  - Errores que dicen qué hacer: cada problema del SDK trae `solucion` y `documentacion` (enlace al nuevo catálogo
    `docs/errores.md`), y el `message` los incluye. Sin almacén, el error es `ALMACEN_REQUERIDO` en lugar de un
    `TypeError`. Nuevas: `validarEmisor` y `esErrorValidacion`.
  - Documentos en USD: al emitir se guarda `equivalenteLempiras` (ISV y total en lempiras con el tipo de cambio) y
    el impreso lo muestra. Un documento guardado antes, sin ese campo, se reimprime igual que se emitió.
  - `crearFacturadorDemo` sobre un almacén con la demo vencida registra otra demo. `autorizacionDemo` con una fecha
    inválida da `FECHA_DEMO`.
  - `npx factura-hn`: no sobrescribe los HTML que ya existen y rechaza opciones desconocidas.
  - En CJS, `factura-hn/demo` y `factura-hn/pruebas` comparten las clases con el índice (`instanceof ErrorValidacion`
    funciona entre ellos).

### Patch Changes

- 74a8eea: Documentación publicada: los README de `@factura-hn/pdf`, `@factura-hn/postgres`, `@factura-hn/sqlite` y
  `@factura-hn/cliente` enlazan con URL absolutas (los enlaces relativos no existen en npm ni en `node_modules`).
  El ejemplo del cliente crea una clave de idempotencia por venta en lugar de fijarla. La skill
  `facturacion-sar-hn` manda leer, en el camino de la API, el `AGENTS.md` y `docs/api.md` que trae
  `@factura-hn/cliente`, nombra `GRAVADO0` y `renderizarPDF`, y pide tomar el número de la respuesta.
  `verificar-dist` falla si un `.md` publicado enlaza a algo que no viaja en su paquete, y `pnpm humo` instala los
  tarballs en un proyecto vacío y corre el ejemplo mínimo del README.
- 39072d8: Resiliencia de la API REST, medida con carga y con PostgreSQL reiniciándose en medio de la emisión.
  
  - Con la base reiniciándose, caída o sin conexiones libres, la API responde 503 `BASE_NO_DISPONIBLE` con
    `Retry-After` (antes, 500 `ERROR_INTERNO`). Reintenta con la misma `Idempotency-Key`: si el documento alcanzó a
    emitirse recibes el mismo, y si no, se emite una sola vez. El cliente lo entrega como `ErrorFacturaHN` con
    `estado: 503`; los tipos generados incluyen el 503 en cada operación.
  - Los avisos de webhook acumulados (por ejemplo, mientras el receptor estaba caído) salen en una sola pasada del
    despacho, al ritmo del receptor; antes salían de a 20 cada 5 s por negocio.
  - `fechaHonduras` y `horaHonduras` reusan su formateador: la emisión gasta menos CPU.
- Lo que viaja en cada paquete de npm:
  
  - Cada paquete trae su `CHANGELOG.md` y exporta `./package.json` (`require('factura-hn/package.json')`).
  - `factura-hn/demo` y `factura-hn/pruebas` tienen tipos también con `moduleResolution: node10` (`typesVersions`);
    antes, TypeScript daba TS2307 al importarlos.
  - El ejecutable `npx factura-hn` usa el núcleo del mismo paquete en lugar de llevar otra copia (de 108 KB a 8 KB).
  - `@factura-hn/mcp` acepta cualquier versión de parche de `factura-hn`, `@factura-hn/sqlite` y `@factura-hn/cliente`
    dentro de su versión menor (`^`), en lugar de una exacta: npm no instala dos copias del núcleo si ya tienes otra
    0.x.y. Sus tipos usan los de Node (`@types/node`, dependencia par opcional).

## 0.2.0 y anteriores

La historia hasta la 0.2.0 está en el [CHANGELOG del repositorio](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CHANGELOG.md).
