---
"factura-hn": patch
"@factura-hn/pdf": patch
"@factura-hn/postgres": patch
"@factura-hn/sqlite": patch
"@factura-hn/cliente": patch
---

Documentación publicada: los README de `@factura-hn/pdf`, `@factura-hn/postgres`, `@factura-hn/sqlite` y
`@factura-hn/cliente` enlazan con URL absolutas (los enlaces relativos no existen en npm ni en `node_modules`).
El ejemplo del cliente crea una clave de idempotencia por venta en lugar de fijarla. La skill
`facturacion-sar-hn` manda leer, en el camino de la API, el `AGENTS.md` y `docs/api.md` que trae
`@factura-hn/cliente`, nombra `GRAVADO0` y `renderizarPDF`, y pide tomar el número de la respuesta.
`verificar-dist` falla si un `.md` publicado enlaza a algo que no viaja en su paquete, y `pnpm humo` instala los
tarballs en un proyecto vacío y corre el ejemplo mínimo del README.
