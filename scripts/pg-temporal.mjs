// Un PostgreSQL desechable que se puede reiniciar, para las pruebas de resiliencia (no es el de Docker Compose,
// que comparten otras pruebas y no se reinicia). Usa los binarios locales de PostgreSQL (initdb, pg_ctl):
// FHN_PG_BIN si está definida; si no, los busca en las rutas habituales de Windows, Linux (también en los
// runners de GitHub, que los traen instalados) y macOS.
//
// Uso:  node scripts/pg-temporal.mjs crear|arrancar|detener [fast|immediate]|borrar|url
// El clúster queda en .pg-temporal/ (ignorada por git), escucha solo en 127.0.0.1 y usa trust: solo para pruebas.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CARPETA = process.env.FHN_PG_TEMPORAL_DIR ?? join(RAIZ, '.pg-temporal');
export const DATOS = join(CARPETA, 'datos');
export const REGISTRO = join(CARPETA, 'postgres.log');
export const PUERTO = Number(process.env.FHN_PG_TEMPORAL_PUERTO ?? 55440);
export const BASE = 'factura_hn_resiliencia';
export const URL = `postgres://postgres@127.0.0.1:${PUERTO}/${BASE}`;

const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n);

/** La carpeta de binarios de PostgreSQL con initdb y pg_ctl, o un error que dice cómo indicarla. */
export function binarios() {
  const candidatas = [];
  if (process.env.FHN_PG_BIN) candidatas.push(process.env.FHN_PG_BIN);
  const versiones = (base, sufijo = '') => {
    try {
      return readdirSync(base)
        .filter((v) => /^\d+/.test(v))
        .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a))
        .map((v) => join(base, v, sufijo));
    } catch {
      return [];
    }
  };
  if (process.platform === 'win32') candidatas.push(...versiones('C:\\Program Files\\PostgreSQL', 'bin'));
  else {
    candidatas.push(...versiones('/usr/lib/postgresql', 'bin'));
    candidatas.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  const bin = candidatas.find((c) => existsSync(join(c, exe('initdb'))) && existsSync(join(c, exe('pg_ctl'))));
  if (!bin) throw new Error('No encontré initdb y pg_ctl de PostgreSQL. Indica su carpeta con FHN_PG_BIN.');
  return bin;
}

const correr = (bin, programa, args, { tolerar = false, sinSalida = false } = {}) => {
  // `pg_ctl start` deja al servidor con las tuberías heredadas (en Windows, spawnSync esperaría a que el servidor
  // termine): sin salida capturada, lo que diga queda en el registro del clúster.
  const r = spawnSync(join(bin, exe(programa)), args, { encoding: 'utf8', ...(sinSalida ? { stdio: 'ignore' } : {}) });
  if (r.status !== 0 && !tolerar) {
    const registro = sinSalida && existsSync(REGISTRO) ? readFileSync(REGISTRO, 'utf8').split('\n').slice(-15).join('\n') : '';
    throw new Error(`${programa} ${args.join(' ')} terminó con ${r.status}:\n${r.stdout ?? ''}${r.stderr ?? ''}${r.error ?? ''}${registro}`);
  }
  return r;
};

/** Opciones del servidor: solo TCP en 127.0.0.1 (sin socket Unix, que en Linux pide /var/run/postgresql). */
const opcionesServidor = () => `-p ${PUERTO} -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c max_connections=200 -c fsync=off`;

export function arrancar(bin = binarios()) {
  correr(bin, 'pg_ctl', ['start', '-w', '-t', '60', '-D', DATOS, '-l', REGISTRO, '-o', opcionesServidor()], { sinSalida: true });
}

/** true si el servidor del clúster está en marcha (`pg_ctl status`). */
export function enMarcha(bin = binarios()) {
  return correr(bin, 'pg_ctl', ['status', '-D', DATOS], { tolerar: true }).status === 0;
}

/** `fast`: cierra las sesiones con 57P01 y hace checkpoint. `immediate`: como una caída (recuperación al arrancar). */
export function detener(modo = 'fast', bin = binarios()) {
  correr(bin, 'pg_ctl', ['stop', '-w', '-t', '60', '-m', modo, '-D', DATOS], { tolerar: modo === 'immediate' });
}

export function borrar(bin) {
  if (existsSync(join(DATOS, 'postmaster.pid'))) {
    try {
      detener('immediate', bin ?? binarios());
    } catch {
      /* ya estaba detenido */
    }
  }
  rmSync(CARPETA, { recursive: true, force: true });
}

/** Crea el clúster desde cero, lo arranca y crea la base de pruebas. Devuelve la URL. */
export function crear() {
  const bin = binarios();
  borrar(bin);
  mkdirSync(CARPETA, { recursive: true });
  correr(bin, 'initdb', ['-D', DATOS, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
  arrancar(bin);
  correr(bin, 'createdb', ['-h', '127.0.0.1', '-p', String(PUERTO), '-U', 'postgres', BASE]);
  return URL;
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const [orden, arg] = process.argv.slice(2);
  try {
    if (orden === 'crear') console.log(crear());
    else if (orden === 'arrancar') arrancar();
    else if (orden === 'detener') detener(arg ?? 'fast');
    else if (orden === 'borrar') borrar();
    else if (orden === 'url') console.log(URL);
    else {
      console.error('Uso: node scripts/pg-temporal.mjs crear|arrancar|detener [fast|immediate]|borrar|url');
      process.exit(2);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
