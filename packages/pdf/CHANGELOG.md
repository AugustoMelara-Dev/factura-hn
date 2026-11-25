# @factura-hn/pdf

## 0.4.0

### Patch Changes

- Updated dependencies [f9fbe7c]
- Updated dependencies [c683c6c]
  - factura-hn@0.4.0

## 0.3.0

### Minor Changes

- Node 20 o más reciente.
  
  **Cambios incompatibles:**
  
  - `factura-hn`, `@factura-hn/sqlite`, `@factura-hn/postgres` y `@factura-hn/pdf` piden Node 20 o más reciente
    (`engines: >=20`; antes, `>=18`). Node 18 dejó de recibir parches de seguridad en abril de 2025 y la CI ya no lo
    probaba. `@factura-hn/cliente` ya pedía Node 20 y `@factura-hn/mcp`, Node 22.13 (por `node:sqlite`).
    `@factura-hn/sqlite` sigue necesitando Node 22.13 si usas `node:sqlite` en lugar de `better-sqlite3`.
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
- Lo que viaja en cada paquete de npm:
  
  - Cada paquete trae su `CHANGELOG.md` y exporta `./package.json` (`require('factura-hn/package.json')`).
  - `factura-hn/demo` y `factura-hn/pruebas` tienen tipos también con `moduleResolution: node10` (`typesVersions`);
    antes, TypeScript daba TS2307 al importarlos.
  - El ejecutable `npx factura-hn` usa el núcleo del mismo paquete en lugar de llevar otra copia (de 108 KB a 8 KB).
  - `@factura-hn/mcp` acepta cualquier versión de parche de `factura-hn`, `@factura-hn/sqlite` y `@factura-hn/cliente`
    dentro de su versión menor (`^`), en lugar de una exacta: npm no instala dos copias del núcleo si ya tienes otra
    0.x.y. Sus tipos usan los de Node (`@types/node`, dependencia par opcional).
- Updated dependencies [74a8eea]
- Updated dependencies [74a8eea]
- Updated dependencies [cc2bbd0]
- Updated dependencies [39072d8]
- Updated dependencies [39072d8]
- Updated dependencies [74a8eea]
  - factura-hn@0.3.0

## 0.2.0 y anteriores

La historia hasta la 0.2.0 está en el [CHANGELOG del repositorio](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CHANGELOG.md).
