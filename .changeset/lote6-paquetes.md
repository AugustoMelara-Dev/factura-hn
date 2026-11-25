---
'factura-hn': patch
'@factura-hn/sqlite': patch
'@factura-hn/postgres': patch
'@factura-hn/pdf': patch
'@factura-hn/cliente': patch
'@factura-hn/mcp': patch
---

Lo que viaja en cada paquete de npm:

- Cada paquete trae su `CHANGELOG.md` y exporta `./package.json` (`require('factura-hn/package.json')`).
- `factura-hn/demo` y `factura-hn/pruebas` tienen tipos también con `moduleResolution: node10` (`typesVersions`);
  antes, TypeScript daba TS2307 al importarlos.
- El ejecutable `npx factura-hn` usa el núcleo del mismo paquete en lugar de llevar otra copia (de 108 KB a 8 KB).
- `@factura-hn/mcp` acepta cualquier versión de parche de `factura-hn`, `@factura-hn/sqlite` y `@factura-hn/cliente`
  dentro de su versión menor (`^`), en lugar de una exacta: npm no instala dos copias del núcleo si ya tienes otra
  0.x.y. Sus tipos usan los de Node (`@types/node`, dependencia par opcional).
