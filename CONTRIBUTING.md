# Cómo contribuir

¡Gracias por venir! Toda ayuda cuenta: un error reportado, un ejemplo, una prueba o una regla fiscal mejor
explicada. Si es tu primer aporte, busca los issues con la etiqueta
[`good first issue`](https://github.com/AugustoMelara-Dev/factura-hn/labels/good%20first%20issue).

## Levantar el proyecto

Necesitas Node 22 o más reciente y pnpm (`corepack enable`).

```bash
pnpm install
pnpm build
pnpm test
```

## Dónde está cada cosa

- `packages/core`: el SDK `factura-hn` y la CLI (`npx factura-hn`). Aquí viven las reglas fiscales.
- `packages/sqlite`, `packages/postgres`: dónde se guardan los documentos. `packages/pdf`: el PDF.
- `packages/api`: la API REST. `packages/cliente`: su cliente tipado. `packages/mcp`: el servidor MCP.
- `examples/`: proyectos de ejemplo. `docs/` y `web/`: la documentación y el sitio.

## Proponer un cambio

1. Si es grande, abre primero un issue o una [discusión](https://github.com/AugustoMelara-Dev/factura-hn/discussions) y lo conversamos.
2. Haz tu cambio con su prueba. Una regla fiscal cita su artículo (por ejemplo, Art. 41) en un comentario.
3. Si afecta a un paquete publicado, corre `pnpm changeset` y describe el cambio en español, para quien lo usa.
4. Abre el PR. Te respondemos pronto.

Dinero siempre como texto decimal (`'115.00'`), nunca con punto flotante. Fechas en America/Tegucigalpa.
En ejemplos y pruebas, solo datos ficticios: RTN `99990000000001`, DNI `9999000000001`, CAI
`DEMO00-NO-VALIDO-…`, correo `algo@ejemplo.example`, teléfono `0000-0001`. `pnpm auditar:datos` lo revisa.

## Tono

Escribimos en español, de tú, claro y amable. Aquí nadie sabe todo: preguntar está bien. Al participar aceptas
el [código de conducta](CODE_OF_CONDUCT.md). Para una vulnerabilidad, sigue [SECURITY.md](SECURITY.md).
