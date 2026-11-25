# @factura-hn/postgres

## 0.3.0

### Minor Changes

- Node 20 o más reciente.
  
  **Cambios incompatibles:**
  
  - `factura-hn`, `@factura-hn/sqlite`, `@factura-hn/postgres` y `@factura-hn/pdf` piden Node 20 o más reciente
    (`engines: >=20`; antes, `>=18`). Node 18 dejó de recibir parches de seguridad en abril de 2025 y la CI ya no lo
    probaba. `@factura-hn/cliente` ya pedía Node 20 y `@factura-hn/mcp`, Node 22.13 (por `node:sqlite`).
    `@factura-hn/sqlite` sigue necesitando Node 22.13 si usas `node:sqlite` en lugar de `better-sqlite3`.

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
- Updated dependencies [9b5f92f]
- Updated dependencies [9b5f92f]
- Updated dependencies [0c0f2e6]
- Updated dependencies [6552753]
- Updated dependencies [74a8eea]
  - factura-hn@0.3.0

## 0.2.0 y anteriores

La historia hasta la 0.2.0 está en el [CHANGELOG del repositorio](https://github.com/AugustoMelara-Dev/factura-hn/blob/main/CHANGELOG.md).
