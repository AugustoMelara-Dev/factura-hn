# @factura-hn/api

API REST de factura-hn: alojada multi-tenant o instalada en el local del negocio con Docker (Art. 47).

- Primera factura en 3 pasos, recursos, errores y seguridad: [`docs/api.md`](../../docs/api.md).
- Instalación en el negocio, respaldos y llaves: [`docs/autoalojamiento.md`](../../docs/autoalojamiento.md).

## Consola del operador

La consola del operador se invoca así:

| Dónde | Cómo |
|---|---|
| Docker Compose | `docker compose exec api factura-hn-api <comando>` |
| Tu propio servidor, con el repositorio compilado (`pnpm build`), desde su raíz | `node packages/api/dist/cli.js <comando>` |

El paquete es privado: fuera de Docker, `factura-hn-api` no queda en el PATH.

```bash
docker compose exec api factura-hn-api ayuda       # comandos: migrar, tenant crear, llave crear, demo llave, openapi
docker compose exec api factura-hn-api demo llave  # otra llave de caja del demo (CAI ficticio)
```
