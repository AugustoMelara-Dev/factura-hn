/**
 * Control del PostgreSQL desechable de las pruebas de resiliencia (`scripts/pg-temporal.mjs`). Solo existe
 * cuando las corre `pnpm resiliencia`, que lo crea, define FHN_PG_REINICIABLE=1 y FHN_PG_URL, y lo borra al
 * terminar. Sin esa variable, estas pruebas se omiten: nunca se reinicia la base compartida de `pnpm test:pg`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

export const REINICIABLE = process.env.FHN_PG_REINICIABLE === '1' && !!process.env.FHN_PG_URL;
/** Versión larga (nocturna): más reinicios y más tiempo de tráfico. */
export const LARGA = process.env.FHN_RESILIENCIA_LARGA === '1';

const SCRIPT = fileURLToPath(new URL('../../../../scripts/pg-temporal.mjs', import.meta.url));

/** Sin bloquear el proceso: la API de la prueba corre en él y debe seguir atendiendo mientras tanto. */
function pgTemporal(...args: string[]): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    p.stdout.on('data', (d) => (salida += d));
    p.stderr.on('data', (d) => (salida += d));
    p.once('error', rechazar);
    p.once('close', (codigo) => (codigo === 0 ? resolver() : rechazar(new Error(`pg-temporal ${args.join(' ')}: ${salida}`))));
  });
}

/** `fast`: Postgres cierra las sesiones (57P01). `immediate`: como una caída del servidor (recupera al arrancar). */
export const detenerPg = (modo: 'fast' | 'immediate' = 'fast') => pgTemporal('detener', modo);
export const arrancarPg = () => pgTemporal('arrancar');

/** Un puerto TCP libre de 127.0.0.1. */
export function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const s = createServer();
    s.once('error', rechazar);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolver(port));
    });
  });
}

export const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
