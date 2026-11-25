/**
 * Revisión de la numeración de un tenant contra la base, después de una medición de carga o de una prueba de
 * resiliencia. Corre como el dueño de las tablas (fija el tenant igual que la API, por si las políticas de RLS
 * también le aplican). Comprueba:
 * - correlativos duplicados en una serie (la restricción única de `fhn_documentos` ya lo impide: se revisa igual);
 * - huecos: en cada serie, los correlativos van de 1 al último sin saltos (los rangos de prueba empiezan en 1);
 * - `fhn_series.ultimo` igual al mayor correlativo emitido de la serie;
 * - idempotencia: una clave por documento y un documento por clave (cada fila de `api_idempotencia` apunta a un
 *   número distinto y existente, y no hay documentos sin clave).
 */
import type pg from 'pg';

export interface Serie {
  identificador: string;
  documentos: number;
  minimo: number;
  maximo: number;
  ultimoSerie: number | null;
}

export interface Integridad {
  documentos: number;
  claves: number;
  series: Serie[];
  duplicados: { identificador: string; correlativo: number; veces: number }[];
  huecos: { identificador: string; faltan: number; primero: number | null }[];
  seriesDesalineadas: Serie[];
  clavesSinDocumento: number;
  documentosConVariasClaves: number;
  documentosSinClave: number;
}

export async function revisarIntegridad(pool: pg.Pool, tenant: string): Promise<Integridad> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SELECT set_config('factura_hn.tenant', $1, true)", [tenant]);
    const series = (
      await c.query<Serie>(
        `SELECT d.identificador, count(*)::int AS documentos, min(d.correlativo)::int AS minimo, max(d.correlativo)::int AS maximo,
                (SELECT s.ultimo FROM fhn_series s WHERE s.tenant = $1 AND s.identificador = d.identificador) AS "ultimoSerie"
           FROM fhn_documentos d WHERE d.tenant = $1 GROUP BY d.identificador ORDER BY d.identificador`,
        [tenant],
      )
    ).rows;
    const duplicados = (
      await c.query<{ identificador: string; correlativo: number; veces: number }>(
        `SELECT identificador, correlativo, count(*)::int AS veces FROM fhn_documentos WHERE tenant = $1
          GROUP BY identificador, correlativo HAVING count(*) > 1`,
        [tenant],
      )
    ).rows;
    // El primer correlativo que falta de cada serie con huecos (entre 1 y el último emitido).
    const huecos = (
      await c.query<{ identificador: string; primero: number | null }>(
        `SELECT s.identificador,
                (SELECT min(g) FROM generate_series(1, s.maximo) g
                  WHERE NOT EXISTS (SELECT 1 FROM fhn_documentos d WHERE d.tenant = $1 AND d.identificador = s.identificador AND d.correlativo = g))::int AS primero
           FROM (SELECT identificador, max(correlativo) AS maximo, count(DISTINCT correlativo) AS n FROM fhn_documentos
                  WHERE tenant = $1 GROUP BY identificador) s
          WHERE s.n <> s.maximo`,
        [tenant],
      )
    ).rows.map((h) => ({ ...h, faltan: 0 }));
    for (const h of huecos) {
      const s = series.find((x) => x.identificador === h.identificador)!;
      h.faltan = s.maximo - s.documentos + duplicados.filter((d) => d.identificador === h.identificador).reduce((a, d) => a + d.veces - 1, 0);
    }
    const idem = (
      await c.query<{ claves: number; sin_documento: number; varias: number; sin_clave: number }>(
        `WITH k AS (SELECT clave, coalesce(respuesta->'documento'->>'numero', respuesta->>'numero') AS numero
                      FROM api_idempotencia WHERE tenant = $1)
         SELECT (SELECT count(*) FROM k)::int AS claves,
                (SELECT count(*) FROM k WHERE NOT EXISTS (SELECT 1 FROM fhn_documentos d WHERE d.tenant = $1 AND d.numero = k.numero))::int AS sin_documento,
                (SELECT count(*) FROM (SELECT numero FROM k GROUP BY numero HAVING count(*) > 1) v)::int AS varias,
                (SELECT count(*) FROM fhn_documentos d WHERE d.tenant = $1 AND NOT EXISTS (SELECT 1 FROM k WHERE k.numero = d.numero))::int AS sin_clave`,
        [tenant],
      )
    ).rows[0]!;
    await c.query('COMMIT');
    return {
      documentos: series.reduce((a, s) => a + s.documentos, 0),
      claves: idem.claves,
      series,
      duplicados,
      huecos,
      seriesDesalineadas: series.filter((s) => s.ultimoSerie !== s.maximo),
      clavesSinDocumento: idem.sin_documento,
      documentosConVariasClaves: idem.varias,
      documentosSinClave: idem.sin_clave,
    };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Los problemas encontrados, en texto; vacío si la numeración está íntegra. */
export function problemasDeIntegridad(i: Integridad): string[] {
  return [
    ...i.duplicados.map((d) => `correlativo ${d.correlativo} repetido ${d.veces} veces en ${d.identificador}`),
    ...i.huecos.map((h) => `${h.faltan} correlativo(s) faltante(s) en ${h.identificador} (el primero: ${h.primero})`),
    ...i.seriesDesalineadas.map((s) => `fhn_series.ultimo = ${s.ultimoSerie} y el mayor emitido es ${s.maximo} en ${s.identificador}`),
    ...(i.clavesSinDocumento ? [`${i.clavesSinDocumento} clave(s) de idempotencia sin su documento`] : []),
    ...(i.documentosConVariasClaves ? [`${i.documentosConVariasClaves} documento(s) con varias claves de idempotencia`] : []),
    ...(i.documentosSinClave ? [`${i.documentosSinClave} documento(s) sin clave de idempotencia`] : []),
  ];
}
