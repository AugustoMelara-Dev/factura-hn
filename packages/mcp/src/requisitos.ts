/**
 * Versión de Node para los caminos que usan SQLite (`node:sqlite` sin bandera experimental: Node 22.13 o más
 * reciente). Sin esta revisión, Node más viejo falla con su propio mensaje en inglés al abrir la base.
 */

export const NODE_MINIMO = [22, 13] as const;

/** Si la versión de Node (p. ej. `22.12.0`) es anterior a 22.13. */
export function nodeAnterior(version: string): boolean {
  const [mayor = 0, menor = 0] = version.split('.').map((n) => Number.parseInt(n, 10));
  return mayor < NODE_MINIMO[0] || (mayor === NODE_MINIMO[0] && menor < NODE_MINIMO[1]);
}

/**
 * Si el comando usa SQLite en este equipo: el servidor sin `FHN_API_URL` (modo SQLite), `init`/`iniciar` y
 * `registrar-cai` sin `--api-url` ni `FHN_API_URL`. `ayuda` y el modo API no lo necesitan.
 */
export function usaSQLite(args: string[], env: NodeJS.ProcessEnv): boolean {
  const comando = args[0];
  if (comando === undefined) return !env.FHN_API_URL;
  if (comando === 'init' || comando === 'iniciar') return true;
  if (comando === 'registrar-cai') return !env.FHN_API_URL && !args.some((a) => a === '--api-url' || a.startsWith('--api-url='));
  return false;
}

/** El mensaje para quien corre un camino con SQLite en un Node anterior a 22.13, o null si no hace falta. */
export function problemaDeNode(args: string[], env: NodeJS.ProcessEnv, version: string): string | null {
  if (!usaSQLite(args, env) || !nodeAnterior(version)) return null;
  return (
    `Necesitas Node ${NODE_MINIMO.join('.')} o más reciente (tienes ${version}): factura-hn guarda los documentos con ` +
    'SQLite (node:sqlite), que llega en esa versión. Instala la versión LTS de https://nodejs.org y vuelve a correr el ' +
    'comando. El modo API (FHN_API_URL y FHN_LLAVE) no usa SQLite.'
  );
}
