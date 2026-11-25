/**
 * Los 3 pasos del README, de punta a punta:
 * 1. `init --demo` en una carpeta vacía (el ejecutable real, por consola);
 * 2. el bloque `mcpServers` impreso, tal cual, salvo el comando (aquí el código fuente en vez de npx);
 * 3. el cliente MCP del SDK arranca el servidor por stdio y emite una factura, que sale marcada como de prueba.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const raiz = fileURLToPath(new URL('../../../', import.meta.url));
const paquete = fileURLToPath(new URL('..', import.meta.url));
const tsx = join(raiz, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

describe('punta a punta: init --demo → bloque mcpServers → «emite una factura de prueba»', () => {
  it('emite por stdio con la configuración que imprime init y advierte que es de prueba', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fhn-p2p-'));
    // Paso 1.
    const salida = execFileSync(process.execPath, [tsx, cli, 'init', '--demo'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    const bloque = JSON.parse(/\{\n  "mcpServers"[\s\S]*?\n\}/.exec(salida.replace(/\r\n/g, '\n'))![0]) as {
      mcpServers: { 'factura-hn': { command: string; args: string[]; env: Record<string, string> } };
    };
    const servidor = bloque.mcpServers['factura-hn'];
    expect(servidor.args.slice(-2)).toEqual(['-y', expect.stringMatching(/^@factura-hn\/mcp@\d+\.\d+\.\d+/)]);
    expect(servidor.env.FHN_SQLITE).toBe(join(dir, 'factura-demo.db'));

    // Paso 2: el mismo env del bloque; el comando es el código fuente (npx bajaría el paquete publicado).
    const transporte = new StdioClientTransport({
      command: process.execPath,
      args: [tsx, cli],
      env: { ...(process.env as Record<string, string>), ...servidor.env },
      cwd: paquete,
      stderr: 'pipe',
    });
    let log = '';
    transporte.stderr?.on('data', (d) => (log += String(d)));
    const cliente = new Client({ name: 'asistente', version: '1.0.0' });
    await cliente.connect(transporte);
    try {
      // Paso 3: lo que haría el asistente con «emite una factura de prueba».
      const r = (await cliente.callTool({
        name: 'emitir_factura',
        arguments: { lineas: [{ descripcion: 'Producto de prueba', cantidad: 1, precioUnitario: '100.00' }], idempotencyKey: 'p2p-venta-0001' },
      })) as unknown as { isError?: boolean; content: { text: string }[]; structuredContent: { prueba: boolean; leyenda: string; repetido: boolean; documento: { numero: string; cai: string } } };
      expect(r.isError).toBeFalsy();
      expect(r.content[0]!.text).toMatch(/^Emitida: Factura 000-001-01-00000001 /);
      expect(r.content[0]!.text).toContain('DOCUMENTO DE PRUEBA — SIN VALOR FISCAL');
      expect(r.structuredContent).toMatchObject({ prueba: true, leyenda: 'DOCUMENTO DE PRUEBA — SIN VALOR FISCAL', repetido: false });
      expect(r.structuredContent.documento.cai).toMatch(/^DEMO00-NO-VALIDO-/);
      // El servidor orientó al arrancar, en el log del cliente.
      expect(log).toMatch(/modo SQLite .*emite en 000-001[\s\S]*Modo de prueba/);
    } finally {
      await cliente.close();
    }
  }, 120_000);
});
