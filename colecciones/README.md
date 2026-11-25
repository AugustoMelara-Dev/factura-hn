# Colecciones de Bruno y Postman

Generadas de `packages/api/openapi.json` con `pnpm colecciones` (script `generar.mjs`; los cuerpos de ejemplo,
con datos ficticios, están en `ejemplos.mjs`). No edites `bruno/` ni `postman/` a mano: la CI las regenera y falla
si no coinciden con las versionadas.

- `bruno/`: colección de Bruno (formato `.bru`), un archivo `<operationId>.bru` por operación, la carpeta
  `primera-factura` (sesión, emitir y PDF, con pruebas) y el entorno `demo`.
- `postman/`: la misma colección en formato Postman v2.1 y el entorno `demo`.

Cómo usarlas, y cómo generar un cliente en Python u otro lenguaje: sección «Colecciones de Bruno y Postman, y
clientes en otros lenguajes» de [docs/api.md](../docs/api.md).

Correr la primera factura con la CLI de Bruno, con la API en marcha y una llave de caja del demo:

```bash
pnpm --filter @factura-hn/colecciones bruno --env-var "llave=$LLAVE"
```
