import { createRequire } from 'node:module';

/** Versión de este paquete (de su package.json), o null si no se puede leer. */
export function versionPaquete(): string | null {
  try {
    const v = (createRequire(import.meta.url)('../package.json') as { version?: unknown }).version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}
