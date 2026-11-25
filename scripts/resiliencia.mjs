// Pruebas de resiliencia con un PostgreSQL que se puede reiniciar: `pnpm resiliencia` (versión corta, para el CI)
// o `pnpm resiliencia --larga` (nocturna: más reinicios, más tiempo sin base y más avisos acumulados).
//
// 1. Crea un clúster desechable con los binarios locales de PostgreSQL (scripts/pg-temporal.mjs) en
//    .pg-temporal/, en 127.0.0.1:55440 (otro puerto: FHN_PG_TEMPORAL_PUERTO).
// 2. Corre contra él, con FHN_PG_REINICIABLE=1, las pruebas que lo detienen y lo arrancan: reinicios y caídas
//    en medio de la emisión (packages/api/test/resiliencia/reinicio-pg.test.ts) y el cliente a través de cortes
//    (packages/cliente/test/resiliencia.test.ts). La versión larga corre además la de webhooks caídos con más
//    avisos y más rondas de fallas.
// 3. Detiene el clúster y borra la carpeta, también si algo falla.
// Nunca toca la base de Docker Compose ni la de `pnpm test:pg`.
import { spawnSync } from 'node:child_process';
import { borrar, crear } from './pg-temporal.mjs';

const larga = process.argv.includes('--larga');
let codigo = 1;
try {
  const url = crear();
  console.log(`PostgreSQL desechable en ${url}${larga ? ' (versión larga)' : ''}`);
  const env = { ...process.env, FHN_PG_URL: url, FHN_PG_REINICIABLE: '1', ...(larga ? { FHN_RESILIENCIA_LARGA: '1' } : {}) };
  const correr = (filtro, ...archivos) =>
    spawnSync('pnpm', ['--filter', filtro, 'exec', 'vitest', 'run', ...archivos], { stdio: 'inherit', env, shell: process.platform === 'win32' }).status;
  // Los webhooks caídos no necesitan reiniciar la base: la versión corta ya corre en `pnpm test:pg`.
  const api = correr('@factura-hn/api', larga ? 'test/resiliencia' : 'test/resiliencia/reinicio-pg.test.ts');
  const cliente = correr('@factura-hn/cliente', 'test/resiliencia.test.ts');
  codigo = api === 0 && cliente === 0 ? 0 : 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  borrar();
}
process.exit(codigo);
