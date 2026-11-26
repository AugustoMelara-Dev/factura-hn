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

/** Fecha (YYYY-MM-DD) a `dias` de hoy: el servidor corre en otro proceso, con el reloj del equipo. */
const aDiasDeHoy = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

const EMISOR = {
  rtn: '99990000000001', razonSocial: 'Pulpería Ejemplo', nombreComercial: 'Pulpería Ejemplo', direccionCasaMatriz: 'Ciudad Ejemplo',
  direccionEstablecimiento: 'Ciudad Ejemplo', telefono: '0000-0001', correo: 'v@ejemplo.example',
};

// node:sqlite se carga con require para que el empaquetador de las pruebas no intente resolverlo.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('factura-hn-mcp por stdio', () => {
  it('el ejecutable compilado arranca en modo API y en modo SQLite', async () => {
    const paquete = fileURLToPath(new URL('..', import.meta.url));
    const raiz = fileURLToPath(new URL('../../../', import.meta.url));
    // Se compila aparte, sin tocar dist/ (que lleva los tipos y es lo que verifica verificar-dist). La carpeta va
    // dentro de node_modules del paquete para que el ejecutable resuelva sus dependencias como en dist/.
    const salidaPrueba = join(paquete, 'node_modules', '.cache', 'dist-prueba-stdio');
    execFileSync(process.execPath, [join(raiz, 'node_modules', 'tsup', 'dist', 'cli-default.js'), 'src/index.ts', 'src/cli.ts', '--format', 'esm', '--target', 'node22', '--clean', '--out-dir', salidaPrueba], { cwd: paquete, stdio: 'pipe' });
    const cli = join(salidaPrueba, 'cli.js');
    const dir = mkdtempSync(join(tmpdir(), 'fhn-dist-'));
    const emisorJson = join(dir, 'emisor.json');
    writeFileSync(emisorJson, JSON.stringify(EMISOR));
    for (const env of [{ FHN_API_URL: 'http://127.0.0.1:9', FHN_LLAVE: 'fhn_x' }, { FHN_SQLITE: join(dir, 'f.db'), FHN_EMISOR: emisorJson }]) {
      const cliente = new Client({ name: 'prueba', version: '1.0.0' });
      await cliente.connect(new StdioClientTransport({ command: process.execPath, args: [cli], env: { ...process.env, ...env } as unknown as Record<string, string>, stderr: 'pipe' }));
      expect((await cliente.listTools()).tools).toHaveLength(7);
      await cliente.close();
    }
    // Modo local sin archivo: no arranca (no hay almacén en memoria).
    let salida = '';
    try {
      execFileSync(process.execPath, [cli], { env: { ...process.env, FHN_SQLITE: ':memory:', FHN_EMISOR: join(paquete, 'package.json') }, stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
      salida = String((e as { stderr: string }).stderr);
    }
    expect(salida).toMatch(/debe ser la ruta de un archivo .*Cambia FHN_SQLITE en la configuración de tu cliente MCP/);
    // Un emisor.json que falta o está incompleto se informa al arrancar, con qué corregir.
    const arrancar = (emisor: string) => {
      try {
        execFileSync(process.execPath, [cli], { env: { ...process.env, FHN_SQLITE: join(dir, 'g.db'), FHN_EMISOR: emisor }, stdio: 'pipe', encoding: 'utf8' });
        return '';
      } catch (e) {
        return String((e as { stderr: string }).stderr);
      }
    };
    expect(arrancar(join(dir, 'no-existe.json'))).toMatch(/No se encontró el archivo del emisor/);
    expect(arrancar(join(paquete, 'package.json'))).toMatch(/El archivo del emisor tiene 7 errores \(.*package\.json\):\r?\n- rtn: falta/);
    // Sin configuración: dice cómo empezar.
    expect(arrancar('')).toMatch(/Falta FHN_EMISOR/);
  }, 120_000);

  it('arranca con FHN_SQLITE y FHN_EMISOR y emite una factura en la base del equipo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-mcp-'));
    const db = join(dir, 'factura.db');
    const emisor = join(dir, 'emisor.json');
    writeFileSync(emisor, JSON.stringify(EMISOR));
    const base = new DatabaseSync(db);
    await registrarAutorizacion(new AlmacenSQLite(base), {
      cai: 'A1B2C3-D4E5F6-A1B2C3-D4E5F6-A1B2C3-01', tipoDocumento: '01', establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 50, fechaLimiteEmision: aDiasDeHoy(365),
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
