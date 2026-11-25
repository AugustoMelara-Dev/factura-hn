#!/usr/bin/env node
/**
 * Ejecutable de `@factura-hn/mcp`. Sin comando, arranca el servidor MCP por stdio:
 *
 * Vía el SDK local (SQLite en este equipo); `npx -y @factura-hn/mcp init` crea la base y el emisor:
 *   FHN_SQLITE=./factura.db FHN_EMISOR=./emisor.json FHN_ESTABLECIMIENTO=000 FHN_PUNTO=001 factura-hn-mcp
 * Vía la API:
 *   FHN_API_URL=http://127.0.0.1:8787 FHN_LLAVE=fhn_… factura-hn-mcp
 * Opcional en ambos modos: FHN_OPERADOR=«nombre», la persona que opera, para la bitácora, y
 * FHN_MCP_PERMITIR_DESTRUCTIVAS=1 para anular y registrar CAI con un cliente que no ofrece elicitación.
 *
 * Con comando: `init` (o `iniciar`), `registrar-cai`, `http` (el MCP remoto, ver `http.ts`) y `ayuda` (ver `comandos.ts`).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BackendApi, BackendLocal, type Backend } from './backend';
import { abrirBase, ejecutarComando } from './comandos';
import { esCAIDemo, LEYENDA_PRUEBA } from './demo';
import { leerEmisor } from './emisor';
import { opcionesMcpHttpDesdeEntorno, servirMcpHttp } from './http';
import { problemaDeNode } from './requisitos';
import { crearServidorMCP } from './servidor';

function backendDesdeEntorno(env: NodeJS.ProcessEnv): { backend: Backend; descripcion: string } {
  if (env.FHN_API_URL) {
    if (!env.FHN_LLAVE) throw new Error('Falta FHN_LLAVE (llave de API).');
    return {
      backend: new BackendApi({
        url: env.FHN_API_URL, llave: env.FHN_LLAVE, establecimiento: env.FHN_ESTABLECIMIENTO, puntoEmision: env.FHN_PUNTO, operador: env.FHN_OPERADOR || undefined,
      }),
      descripcion: `modo API (${env.FHN_API_URL})`,
    };
  }
  if (env.FHN_SQLITE) {
    if (!env.FHN_EMISOR) throw new Error('Falta FHN_EMISOR (ruta al JSON con los datos del emisor). Créalo con `npx -y @factura-hn/mcp init`.');
    if (env.FHN_SQLITE.trim() === ':memory:' || env.FHN_SQLITE.startsWith('file::memory:')) {
      throw new Error('FHN_SQLITE debe ser un archivo (p. ej. ./factura.db): en memoria se perderían los documentos al cerrar.');
    }
    const emisor = leerEmisor(env.FHN_EMISOR);
    const establecimiento = env.FHN_ESTABLECIMIENTO ?? '000';
    const puntoEmision = env.FHN_PUNTO ?? '001';
    return {
      backend: new BackendLocal({ db: abrirBase(env.FHN_SQLITE), operador: env.FHN_OPERADOR || undefined, emisor, establecimiento, puntoEmision }),
      descripcion: `modo SQLite (${env.FHN_SQLITE}), emite en ${establecimiento}-${puntoEmision}`,
    };
  }
  throw new Error(
    'Configura FHN_SQLITE + FHN_EMISOR (modo local) o FHN_API_URL + FHN_LLAVE (modo API).\n' +
      'Para empezar: `npx -y @factura-hn/mcp init --demo` crea todo e imprime la configuración. Ayuda: `npx -y @factura-hn/mcp ayuda`.',
  );
}

/** Orientación al arrancar, en el log del cliente MCP (stderr): modo, punto de emisión y si falta el CAI. */
async function orientar(backend: Backend, descripcion: string) {
  const lineas = [`factura-hn MCP: ${descripcion}.`];
  try {
    const cais = await backend.estadoCAI();
    if (!cais.length) {
      lineas.push('Aviso: no hay CAI registrado; no se puede emitir. Regístralo con `npx -y @factura-hn/mcp registrar-cai` o con la herramienta registrar_cai.');
    } else if (cais.some((e) => esCAIDemo(e.cai))) {
      lineas.push(`Modo de prueba (CAI ficticio): ${LEYENDA_PRUEBA}.`);
    }
  } catch {
    // En modo API, la API puede no estar arriba todavía: lo dirán las herramientas.
  }
  console.error(lineas.join('\n'));
}

// Antes que nada: en Node < 22.13, los caminos con SQLite fallarían con el mensaje de Node, en inglés.
const node = problemaDeNode(process.argv.slice(2), process.env, process.versions.node);
if (node) {
  console.error(node);
  process.exit(1);
}

try {
  const r = await ejecutarComando(process.argv.slice(2), { cwd: process.cwd(), env: process.env });
  if (r === 'servidor') {
    const { backend, descripcion } = backendDesdeEntorno(process.env);
    // Anular y registrar CAI piden confirmación al usuario por elicitación; sin ella en el cliente, se niegan salvo
    // con FHN_MCP_PERMITIR_DESTRUCTIVAS=1 (ver el README).
    const permitirDestructivas = process.env.FHN_MCP_PERMITIR_DESTRUCTIVAS === '1';
    await crearServidorMCP(backend, { permitirDestructivas }).connect(new StdioServerTransport());
    await orientar(backend, descripcion);
  } else if (r === 'http') {
    const opciones = opcionesMcpHttpDesdeEntorno(process.env);
    const { cerrar } = await servirMcpHttp(opciones);
    console.error(`factura-hn MCP remoto: escucha en ${opciones.host}:${opciones.puerto}, rutas /mcp/<token> y /mcp; API en ${opciones.urlApi}.`);
    const salir = () => void cerrar().finally(() => process.exit(0));
    process.once('SIGTERM', salir);
    process.once('SIGINT', salir);
  } else {
    process.exitCode = r;
  }
} catch (e) {
  // stdout es el canal MCP: los mensajes van a stderr.
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
