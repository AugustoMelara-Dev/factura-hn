# Changesets

Cada cambio que afecte a un paquete publicado lleva un changeset:

```bash
pnpm changeset          # elige los paquetes, el tipo (patch/minor/major) y describe el cambio en español
```

Los seis paquetes de npm (`factura-hn`, `@factura-hn/sqlite`, `postgres`, `pdf`, `cliente` y `mcp`) se
versionan juntos (`fixed`): siempre comparten número de versión. La API y los ejemplos no se publican.

Mientras la versión sea 0.x, un cambio incompatible es `minor` y lleva su entrada en `CHANGELOG.md`
(regla del proyecto). Al fusionar en `main`, el flujo «Release» abre un PR «Versión de paquetes»; al
fusionar ese PR, publica en npm con procedencia (ver `docs/lanzamiento.md`).
