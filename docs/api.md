# API REST (Fase 2): especificación de partida

Fuente: la especificación del proyecto (2026-11-18) y el lote 2. Se actualiza a medida que se implementa.

## Stack

Hono + `@hono/zod-openapi` (Zod 4) + PostgreSQL (`@factura-hn/postgres`, compatible con Supabase), en Node y
en contenedor. OpenAPI generado desde el código y publicado en `/docs`.

## Recursos mínimos (especificación original)

- `POST /v1/emisores`, `GET/PATCH /v1/emisores/:id`
- `POST /v1/autorizaciones` (carga de CAI con validación), `GET /v1/autorizaciones/:id/estado`
- `POST /v1/documentos` (factura, NC o ND; con `Idempotency-Key`), `GET /v1/documentos/:numero`,
  `GET /v1/documentos/:numero.pdf|.html|.txt`, `POST /v1/documentos/:numero/anular`
- `GET /v1/libro-ventas?desde&hasta&formato=csv|json`
- Webhooks: `documento.emitido`, `documento.anulado`, `autorizacion.por_vencer`, `autorizacion.agotada`
- La emisión reserva el correlativo, guarda el documento y escribe la auditoría en una sola transacción.
- Exportación en archivo de texto por período (Art. 53 num. 5) y bitácora de auditoría (Art. 53 num. 2).
- Pruebas de punta a punta, incluida la emisión concurrente desde varias cajas.
- `docker compose up` levanta API + Postgres con datos de demostración (CAI ficticio y marcado como tal).

## Requisitos del lote 2

- Multi-tenant con RLS real (políticas probadas con un intento de cruce entre tenants).
- Dos modos con el mismo código: alojado multi-tenant y local single-tenant en el establecimiento (Art. 47).
- Llaves de API con hash y roles: `caja` emite y consulta; `admin` además registra CAI, anula, corrige
  fechas (`confirmarSaltoDeFecha`, `corregirFechaAdelantada`) y ve la bitácora.
- `Idempotency-Key` en la emisión, límites de uso, webhooks firmados con HMAC y reintentos.
- Exportación en texto (Art. 53 num. 5) y libro de ventas.
- Pruebas de punta a punta: emisión concurrente desde varias cajas e idempotencia ante reintentos.
