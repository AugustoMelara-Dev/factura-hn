// Levanta Postgres de docker-compose.yml y corre las pruebas de @factura-hn/postgres contra él.
import { spawnSync } from 'node:child_process';

const correr = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

correr('docker', ['compose', 'up', '-d', '--wait', 'db']);
correr('pnpm', ['--filter', '@factura-hn/postgres', 'test'], {
  FHN_PG_URL: process.env.FHN_PG_URL ?? 'postgres://postgres@127.0.0.1:54329/factura_hn',
});
