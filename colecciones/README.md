# Colecciones de Bruno y Postman

Generadas de `packages/api/openapi.json` con `pnpm colecciones` (script `generar.mjs`; los cuerpos de ejemplo,
con datos ficticios, están en `ejemplos.mjs`). No edites `bruno/` ni `postman/` a mano: la CI las regenera y falla
si no coinciden con las versionadas.

- `bruno/`: colección de Bruno (formato `.bru`), un archivo `<operationId>.bru` por operación, la carpeta
  `primera-factura` (sesión, emitir y PDF, con pruebas) y el entorno `demo`.
- `postman/`: la misma colección en formato Postman v2.1 y el entorno `demo`.

Cómo usarlas, y cómo generar un cliente en Python u otro lenguaje: sección «Colecciones de Bruno y Postman, y
clientes en otros lenguajes» de [docs/api.md](../docs/api.md).

Correr la primera factura con la CLI de Bruno, con la API en marcha y una llave de caja del demo en `FHN_LLAVE`
(el entorno `demo` la lee de ahí, o de `bruno/.env`, que git ignora; así no pasa por la línea de órdenes):

```bash
export FHN_LLAVE=$(docker compose exec -T api factura-hn-api demo llave --solo-llave)
pnpm --filter @factura-hn/colecciones bruno
```

Al regenerar, `generar.mjs` reemplaza y borra solo lo suyo: los `.bru` de las carpetas, `bruno.json`,
`environments/demo.bru` y los dos archivos de `postman/`. Tus otros entornos (`bruno/environments/*.bru`), tu
`bruno/.env` y otros archivos de `postman/` se conservan. Una solicitud propia guardada dentro de `bruno/` sí se
borra: guárdala en otra colección.
