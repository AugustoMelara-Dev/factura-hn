# Changesets

Cada cambio que afecte a un paquete publicado lleva un changeset:

```bash
pnpm changeset          # elige los paquetes, el tipo (patch/minor/major) y describe el cambio en español
```

Los seis paquetes de npm (`factura-hn`, `@factura-hn/sqlite`, `postgres`, `pdf`, `cliente` y `mcp`) se
versionan juntos (`fixed`): siempre comparten número de versión. La API y los ejemplos no se publican.

Mientras la versión sea 0.x, un cambio incompatible es `minor` y va en su changeset bajo una línea `**Cambios
incompatibles:**` (en negrita, no un título `##`: el changeset queda dentro de una lista del `CHANGELOG.md` del
paquete). Cada changeset describe el cambio neto desde la última versión publicada: si un cambio posterior lo
corrige, se corrige también el changeset anterior. Al fusionar en `main`, el flujo «Release» abre un PR «Versión
de paquetes»; al fusionar ese PR, publica en npm con procedencia (ver `docs/lanzamiento.md`). `pnpm run version`
corre `changeset version` y después `scripts/fijar-versiones.mjs` (la API, `openapi.json`, los bloques
`mcpServers` y la sección del `CHANGELOG.md` de la raíz).
