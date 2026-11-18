# Persistencia de correlativos y documentos

`factura-hn` no trae base de datos. Tú implementas `AlmacenCorrelativos` sobre la tuya.
Lo único que **tiene** que cumplir: reservar el siguiente correlativo de forma **atómica**
(dos cajas facturando al mismo tiempo nunca pueden recibir el mismo número).

## Reglas que el sistema debe respetar

1. **Un correlativo por documento, sin huecos ni repetidos.** `crearDocumento` valida antes de reservar
   el número; si algo falla después de reservarlo (se cae la impresora, se cancela la venta), el documento
   se guarda como **anulado**, no se borra ni se reutiliza el número.
2. **Guarda el documento completo** (el JSON que devuelve `crearDocumento`) y no lo modifiques después.
   Para corregir una factura emitida se usa una Nota de Crédito (06) o de Débito (07).
3. **Una fila de autorización por CAI.** Cuando el SAR te dé un nuevo CAI, se crea otra fila; la vieja queda
   como historial.
4. Conserva los documentos por el plazo que exige la ley (5 años es lo usual; confírmalo con tu contador).

## PostgreSQL / Supabase

```sql
create table autorizaciones_cai (
  cai                 text primary key,
  tipo_documento      char(2)  not null,
  establecimiento     char(3)  not null,
  punto_emision       char(3)  not null,
  rango_inicial       integer  not null,
  rango_final         integer  not null,
  fecha_limite        date     not null,
  ultimo_correlativo  integer,              -- null = aún no se emite ninguno
  activa              boolean  not null default true,
  check (rango_inicial between 1 and 99999999),
  check (rango_final between rango_inicial and 99999999)
);

create table documentos_fiscales (
  numero        char(19) primary key,       -- 000-001-01-00000001
  cai           text not null references autorizaciones_cai(cai),
  tipo          char(2) not null,
  fecha_emision date not null,
  total         numeric(14,2) not null,
  anulado       boolean not null default false,
  motivo_anulacion text,
  documento     jsonb not null,             -- DocumentoFiscal completo
  creado_en     timestamptz not null default now()
);

-- Reserva atómica: una sola sentencia UPDATE ... RETURNING.
create or replace function siguiente_correlativo(p_cai text)
returns integer language plpgsql as $$
declare v integer;
begin
  update autorizaciones_cai
     set ultimo_correlativo = coalesce(ultimo_correlativo, rango_inicial - 1) + 1
   where cai = p_cai
     and coalesce(ultimo_correlativo, rango_inicial - 1) + 1 <= rango_final
  returning ultimo_correlativo into v;
  if v is null then
    raise exception 'RANGO_AGOTADO' using hint = p_cai;
  end if;
  return v;
end $$;
```

Con Supabase, ejecuta la función desde el servidor (route handler / edge function con la service key),
nunca desde el navegador, y protege ambas tablas con RLS por tenant.

```ts
import { RangoAgotadoError, type AlmacenCorrelativos } from 'factura-hn';

export const almacenSupabase = (supabase: SupabaseClient): AlmacenCorrelativos => ({
  async siguiente(aut) {
    const { data, error } = await supabase.rpc('siguiente_correlativo', { p_cai: aut.cai });
    if (error?.message.includes('RANGO_AGOTADO')) throw new RangoAgotadoError(aut.cai);
    if (error) throw error;
    return data as number;
  },
});
```

Para que el número no se pierda si falla el `insert` del documento, haz las dos cosas en la misma
transacción (una función SQL que reserve e inserte), o inserta el documento como anulado en el `catch`.

## MySQL / MariaDB

```sql
START TRANSACTION;
SELECT COALESCE(ultimo_correlativo, rango_inicial - 1) + 1 AS siguiente, rango_final
  FROM autorizaciones_cai WHERE cai = ? FOR UPDATE;
-- si siguiente > rango_final -> ROLLBACK y error RANGO_AGOTADO
UPDATE autorizaciones_cai SET ultimo_correlativo = ? WHERE cai = ?;
INSERT INTO documentos_fiscales (...) VALUES (...);
COMMIT;
```

## SQLite (POS offline)

SQLite serializa las escrituras; usa `BEGIN IMMEDIATE` y el mismo `UPDATE ... RETURNING` (SQLite ≥ 3.35).
Cada caja offline debe tener **su propio punto de emisión y su propio CAI**: nunca compartas un rango
entre dispositivos que no están conectados, porque se duplicarían números.
