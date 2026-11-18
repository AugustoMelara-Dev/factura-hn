// Levanta Postgres (docker-compose.yml + docker-compose.dev.yml) y corre contra él todas las pruebas que lo
// usan: almacén, API, cliente, MCP y los ejemplos Express y Next.js.
// Con FHN_PG_URL ya definida (p. ej. el servicio de Postgres del CI), no toca Docker: usa esa base.
import { spawnSync } from 'node:child_process';

const correr = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!process.env.FHN_PG_URL) {
  const compose = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
  correr('docker', [...compose, 'up', '-d', '--wait', 'db']);
  // Las pruebas usan su propia base: la de la API (factura_hn) queda limpia para probar a mano.
  const existe = spawnSync('docker', [...compose, 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'factura_hn_pruebas'"], { encoding: 'utf8' });
  if (existe.stdout.trim() !== '1') correr('docker', [...compose, 'exec', '-T', 'db', 'createdb', '-U', 'postgres', 'factura_hn_pruebas']);
}
const filtros = ['@factura-hn/postgres', '@factura-hn/api', '@factura-hn/cliente', '@factura-hn/mcp', '@factura-hn/ejemplo-express', '@factura-hn/ejemplo-nextjs'];
correr('pnpm', [...filtros.flatMap((f) => ['--filter', f]), 'test'], {
  FHN_PG_URL: process.env.FHN_PG_URL ?? 'postgres://postgres@127.0.0.1:54329/factura_hn_pruebas',
});
