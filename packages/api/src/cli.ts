#!/usr/bin/env node
/**
 * Consola del operador.
 *   factura-hn-api migrar
 *   factura-hn-api tenant crear <tenant> --nombre "Mi Negocio" [--limite 1000]
 *   factura-hn-api llave crear <tenant> --rol admin|caja --nombre "Caja 2" [--caja 000-002]
 *   factura-hn-api openapi [archivo]
 * Usa DATABASE_URL y FHN_ROL. Las llaves se imprimen una sola vez.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { crearApp } from './app';
import { migrarApi, ROL_POR_DEFECTO } from './esquema';
import { crearLlaveOperador, crearTenant } from './operador';

function opcion(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function principal(args: string[]): Promise<void> {
  const [cmd, sub, objetivo] = args;
  if (cmd === 'openapi') {
    const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });
    const doc = await (await app.request('/openapi.json')).text();
    if (sub) writeFileSync(sub, `${JSON.stringify(JSON.parse(doc), null, 2)}\n`);
    else console.log(doc);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  const rol = process.env.FHN_ROL ?? ROL_POR_DEFECTO;
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await migrarApi(pool, rol);
    if (cmd === 'migrar') return console.log('Esquema al día.');
    if (cmd === 'tenant' && sub === 'crear' && objetivo) {
      const limite = opcion(args, 'limite');
      const r = await crearTenant(pool, { tenant: objetivo, nombre: opcion(args, 'nombre') ?? objetivo, limiteMensual: limite ? Number(limite) : null });
      console.log(`Tenant ${r.tenant} creado.\nLlave admin (solo se muestra ahora): ${r.llaveAdmin}`);
      return;
    }
    if (cmd === 'llave' && sub === 'crear' && objetivo) {
      const rolLlave = opcion(args, 'rol');
      if (rolLlave !== 'admin' && rolLlave !== 'caja') throw new Error('--rol admin|caja');
      const caja = opcion(args, 'caja')?.split('-');
      const llave = await crearLlaveOperador(pool, {
        tenant: objetivo, rol: rolLlave, nombre: opcion(args, 'nombre') ?? rolLlave,
        establecimiento: caja?.[0], puntoEmision: caja?.[1],
      });
      console.log(`Llave ${rolLlave} (solo se muestra ahora): ${llave}`);
      return;
    }
    throw new Error('Uso: migrar | tenant crear <tenant> --nombre … | llave crear <tenant> --rol admin|caja | openapi [archivo]');
  } finally {
    await pool.end();
  }
}

principal(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
