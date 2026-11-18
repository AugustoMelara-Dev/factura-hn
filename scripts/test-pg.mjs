// Levanta Postgres (docker-compose.yml + docker-compose.dev.yml) y corre contra él todas las pruebas que lo
// usan: almacén, API, cliente, MCP y los ejemplos Express y Next.js.
import { spawnSync } from 'node:child_process';

const correr = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

correr('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait', 'db']);
const filtros = ['@factura-hn/postgres', '@factura-hn/api', '@factura-hn/cliente', '@factura-hn/mcp', '@factura-hn/ejemplo-express', '@factura-hn/ejemplo-nextjs'];
correr('pnpm', [...filtros.flatMap((f) => ['--filter', f]), 'test'], {
  FHN_PG_URL: process.env.FHN_PG_URL ?? 'postgres://postgres@127.0.0.1:54329/factura_hn',
});
