# @factura-hn/postgres

`AlmacenFiscal` de [factura-hn](../core) sobre PostgreSQL 13 o superior con `pg`. Es el almacén de la API
y de instalaciones con varias cajas.

```ts
import pg from 'pg';
import { emitir } from 'factura-hn';
import { AlmacenPostgres } from '@factura-hn/postgres';

const almacen = new AlmacenPostgres(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
await almacen.migrar(); // idempotente; seguro en cada arranque y entre réplicas
const doc = await emitir(entrada, { almacen, establecimiento: '000', puntoEmision: '001' });
```

## Qué garantiza

- **Sin huecos ni repetidos.** La serie de cada identificador (`NNN-NNN-TT`) se bloquea con
  `SELECT … FOR UPDATE`. Las cajas y réplicas se serializan por serie, no globalmente.
- **Todo o nada.** Si algo falla dentro de la transacción, `ROLLBACK` y el número no se consume.
- **La base se protege sola.** Hay disparadores que impiden borrar documentos o autorizaciones, cambiar un
  documento emitido salvo para anularlo (Art. 41) y hacer retroceder la serie.
- **Multi-tenant listo.** Cada fila lleva `tenant` (por defecto `''`, un solo negocio). Cada transacción
  fija `factura_hn.tenant` con `set_config(…, true)`, que dura solo esa transacción. Las políticas RLS de la
  API alojada se apoyan en ese valor (Fase 2). `almacen.paraTenant(id)` da el almacén de otro inquilino sobre
  el mismo pool.

El documento se guarda como `json`, no `jsonb`, para que se lea exactamente como se emitió.

## Pruebas

```bash
pnpm test:pg   # docker compose up -d --wait db + batería de contrato
```

Sin `FHN_PG_URL`, `pnpm test` omite estas pruebas y lo avisa. La batería incluye 50 emisiones concurrentes
desde 5 pools distintos. Si quitas el `FOR UPDATE`, esa prueba falla.
