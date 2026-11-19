#!/usr/bin/env node
/**
 * Servidor MCP por stdio.
 *
 * Vía la API:
 *   FHN_API_URL=http://127.0.0.1:8787 FHN_LLAVE=fhn_… factura-hn-mcp
 * Vía el SDK local (SQLite en este equipo):
 *   FHN_SQLITE=./factura.db FHN_EMISOR=./emisor.json FHN_ESTABLECIMIENTO=000 FHN_PUNTO=001 factura-hn-mcp
 * `emisor.json` tiene los datos del Emisor (RTN, razón social, …). Las autorizaciones se registran antes
 * con el SDK o la API: el servidor MCP no registra CAI.
 * Opcional en ambos modos: FHN_OPERADOR=«nombre», la persona que opera, para la bitácora (DEC-031).
 */
import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BackendApi, BackendLocal, type Backend } from './backend';
import { leerEmisor } from './emisor';
import { crearServidorMCP } from './servidor';

function backendDesdeEntorno(env: NodeJS.ProcessEnv): Backend {
  if (env.FHN_API_URL) {
    if (!env.FHN_LLAVE) throw new Error('Falta FHN_LLAVE (llave de API).');
    return new BackendApi({
      url: env.FHN_API_URL, llave: env.FHN_LLAVE, establecimiento: env.FHN_ESTABLECIMIENTO, puntoEmision: env.FHN_PUNTO, operador: env.FHN_OPERADOR || undefined,
    });
  }
  if (env.FHN_SQLITE) {
    if (!env.FHN_EMISOR) throw new Error('Falta FHN_EMISOR (ruta al JSON con los datos del emisor).');
    if (env.FHN_SQLITE.trim() === ':memory:' || env.FHN_SQLITE.startsWith('file::memory:')) {
      throw new Error('FHN_SQLITE debe ser un archivo (p. ej. ./factura.db): en memoria se perderían los documentos al cerrar.');
    }
    // node:sqlite se carga solo aquí: el modo API funciona en cualquier Node, y el empaquetador no lo reescribe.
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(env.FHN_SQLITE);
    return new BackendLocal({
      db,
      operador: env.FHN_OPERADOR || undefined,
      emisor: leerEmisor(env.FHN_EMISOR),
      establecimiento: env.FHN_ESTABLECIMIENTO ?? '000',
      puntoEmision: env.FHN_PUNTO ?? '001',
    });
  }
  throw new Error('Configura FHN_API_URL + FHN_LLAVE, o FHN_SQLITE + FHN_EMISOR.');
}

try {
  const servidor = crearServidorMCP(backendDesdeEntorno(process.env));
  await servidor.connect(new StdioServerTransport());
} catch (e) {
  // stdout es el canal MCP: los mensajes van a stderr.
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
