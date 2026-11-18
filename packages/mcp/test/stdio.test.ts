/** El ejecutable por stdio, como lo arranca un cliente MCP (Claude Desktop, Claude Code), con SQLite local. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { registrarAutorizacion } from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';

// node:sqlite se carga con require para que el empaquetador de las pruebas no intente resolverlo.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('factura-hn-mcp por stdio', () => {
  it('el ejecutable compilado (dist/cli.js) arranca en modo API y en modo SQLite', async () => {
    const paquete = fileURLToPath(new URL('..', import.meta.url));
    const raiz = fileURLToPath(new URL('../../../', import.meta.url));
    execFileSync(process.execPath, [join(raiz, 'node_modules', 'tsup', 'dist', 'cli-default.js'), 'src/index.ts', 'src/cli.ts', '--format', 'esm', '--target', 'node22', '--clean'], { cwd: paquete, stdio: 'pipe' });
    const cli = join(paquete, 'dist', 'cli.js');
    for (const env of [{ FHN_API_URL: 'http://127.0.0.1:9', FHN_LLAVE: 'fhn_x' }, { FHN_SQLITE: join(mkdtempSync(join(tmpdir(), 'fhn-dist-')), 'f.db'), FHN_EMISOR: join(paquete, 'package.json') }]) {
      const cliente = new Client({ name: 'prueba', version: '1.0.0' });
      await cliente.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env: { ...process.env, ...env } as unknown as Record<string, string>, stderr: 'pipe' }));
      expect((await cliente.listTools()).tools).toHaveLength(6);
      await cliente.close();
    }
    // Modo local sin archivo: no arranca (no hay almacén en memoria).
    let salida = '';
    try {
      execFileSync(process.execPath, [cli], { env: { ...process.env, FHN_SQLITE: ':memory:', FHN_EMISOR: join(paquete, 'package.json') }, stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
      salida = String((e as { stderr: string }).stderr);
    }
    expect(salida).toMatch(/debe ser un archivo/);
  }, 120_000);

  it('arranca con FHN_SQLITE y FHN_EMISOR y emite una factura en la base del equipo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-mcp-'));
    const db = join(dir, 'factura.db');
    const emisor = join(dir, 'emisor.json');
    writeFileSync(emisor, JSON.stringify({
      rtn: '99990000000001', razonSocial: 'Pulpería Ejemplo', nombreComercial: 'Pulpería Ejemplo', direccionCasaMatriz: 'Ciudad Ejemplo',
      direccionEstablecimiento: 'Ciudad Ejemplo', telefono: '0000-0001', correo: 'v@ejemplo.example',
    }));
    const base = new DatabaseSync(db);
    await registrarAutorizacion(new AlmacenSQLite(base), {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 50, fechaLimiteEmision: '2027-10-31',
    });
    base.close();

    const raiz = fileURLToPath(new URL('../../../', import.meta.url));
    const transporte = new StdioClientTransport({
      command: process.execPath,
      args: [join(raiz, 'node_modules', 'tsx', 'dist', 'cli.mjs'), fileURLToPath(new URL('../src/cli.ts', import.meta.url))],
      env: { ...process.env, FHN_SQLITE: db, FHN_EMISOR: emisor, FHN_PUNTO: '001' } as Record<string, string>,
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stderr: 'pipe',
    });
    const cliente = new Client({ name: 'prueba', version: '1.0.0' });
    await cliente.connect(transporte);
    try {
      const r = (await cliente.callTool({ name: 'emitir_factura', arguments: { lineas: [{ descripcion: 'Café', cantidad: 1, precioUnitario: '50.00' }], idempotencyKey: 'stdio-venta-1' } })) as { content: { text: string }[] };
      expect(r.content[0]!.text).toMatch(/^Emitida: Factura 000-001-01-00000001/);
    } finally {
      await cliente.close();
    }
    const fila = new DatabaseSync(db).prepare('SELECT count(*) AS n FROM fhn_documentos').get() as { n: number };
    expect(fila.n).toBe(1);
  }, 60_000);
});
