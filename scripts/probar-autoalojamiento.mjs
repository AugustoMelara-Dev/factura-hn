#!/usr/bin/env node
// Corre, tal como están escritos, los bloques de docs/autoalojamiento.md con Docker Compose, de punta a punta:
//   1. «Probar en 5 minutos»: levanta todo y emite con la llave del demo (factura.pdf).
//   2. «Respaldos»: respalda, borra todo (down -v) y restaura en una instalación nueva; la API debe arrancar con
//      los documentos y la llave de antes.
//   3. «Poner en marcha un negocio» con contraseñas (.env + override): sobre un volumen nuevo, `up --wait db` debe
//      dejar la base aceptando conexiones, y la API debe correr como fhn_api con su contraseña.
// Usa un proyecto Compose propio y lo baja con `down -v` al terminar (pase o falle). Necesita Docker y bash.
//   node scripts/probar-autoalojamiento.mjs            (proyecto fhn-prueba-autoalojamiento, puerto 8787)
//   COMPOSE_PROJECT_NAME=fhn-otro FHN_PUERTO=8811 node scripts/probar-autoalojamiento.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROYECTO = process.env.COMPOSE_PROJECT_NAME || 'fhn-prueba-autoalojamiento';
const PUERTO = process.env.FHN_PUERTO || '8787';
const env = { ...process.env, COMPOSE_PROJECT_NAME: PROYECTO, FHN_PUERTO: PUERTO };
const ENV_ARCHIVO = join(RAIZ, '.env');
const OVERRIDE = join(RAIZ, 'docker-compose.override.yml');
for (const f of [ENV_ARCHIVO, OVERRIDE]) {
  if (existsSync(f)) throw new Error(`Ya existe ${f}: esta prueba lo escribiría. Muévelo antes.`);
}

/** Bloques ```bash y ```yaml de la guía, en orden. */
export function bloquesDe(texto) {
  return [...texto.replace(/\r\n/g, '\n').matchAll(/^( *)```(bash|yaml)\n([\s\S]*?)^ *```/gm)].map((m) => ({
    lenguaje: m[2],
    codigo: m[3].split('\n').map((l) => l.slice(m[1].length)).join('\n'),
  }));
}
const bloques = bloquesDe(readFileSync(join(RAIZ, 'docs', 'autoalojamiento.md'), 'utf8'));
const bloque = (lenguaje, prueba, nombre) => {
  const b = bloques.find((x) => x.lenguaje === lenguaje && prueba(x.codigo));
  if (!b) throw new Error(`No encuentro en docs/autoalojamiento.md el bloque «${nombre}».`);
  return b.codigo;
};

const sh = (codigo, { capturar = false } = {}) => {
  // Solo cambia lo que depende del equipo: el puerto publicado.
  const script = `set -eo pipefail\n${codigo.replaceAll('127.0.0.1:8787', `127.0.0.1:${PUERTO}`)}`;
  console.log(`\n$ ${codigo.trim().split('\n').join('\n$ ')}`);
  return execFileSync('bash', ['-c', script], { cwd: RAIZ, env, encoding: 'utf8', stdio: capturar ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
};
const sql = (consulta) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'factura_hn', '-tAc', consulta], { cwd: RAIZ, env, encoding: 'utf8' }).trim();
const esperar = (cond, msg) => {
  if (!cond) throw new Error(msg);
  console.log(`ok: ${msg}`);
};
const http = async (ruta, llave) => {
  // Docker Desktop puede tardar un momento en abrir el puerto publicado después de `up --wait`.
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`http://127.0.0.1:${PUERTO}/salud`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const r = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, { headers: llave ? { authorization: `Bearer ${llave}` } : {} });
  return { estado: r.status, cuerpo: await r.text() };
};

const probar = bloque('bash', (c) => c.includes('git clone'), 'Probar en 5 minutos');
const emitir = bloque('bash', (c) => c.includes('--data-binary @packages/api/ejemplos/factura.json'), 'los tres pasos');
const respaldar = bloque('bash', (c) => c.includes('pg_dump'), 'respaldo diario');
const restaurar = bloque('bash', (c) => c.includes('pg_restore'), 'restaurar en una instalación nueva');
const dotenv = bloque('bash', (c) => c.includes('POSTGRES_PASSWORD='), '.env');
const rolApi = bloque('bash', (c) => c.includes('10-rol-api.sh'), 'crear fhn_api a mano (actualizar)')
  .split('\n')
  .find((l) => l.includes('10-rol-api.sh'));
const override = bloque('yaml', (c) => c.includes('POSTGRES_HOST_AUTH_METHOD: scram-sha-256'), 'docker-compose.override.yml');
const borrarTemporales = () => {
  for (const f of readdirSync(RAIZ)) if (/^respaldo-.*\.dump$/.test(f) || f === 'factura.pdf') rmSync(join(RAIZ, f));
};

let fallo = null;
try {
  sh('docker compose down -v --remove-orphans');

  // --- 1. Probar ---
  sh(probar.split('\n').filter((l) => !/^(git clone|cd )/.test(l)).join('\n'));
  const llave = sh(`${emitir}\necho "$LLAVE"`, { capturar: true }).trim().split('\n').at(-1);
  esperar(readFileSync(join(RAIZ, 'factura.pdf')).subarray(0, 5).toString() === '%PDF-', 'los tres pasos dejan factura.pdf');
  const log = execFileSync('docker', ['compose', 'logs', 'api'], { cwd: RAIZ, env, encoding: 'utf8' });
  esperar(log.includes(`en http://localhost:${PUERTO} `), `el log de la API da la URL de tu equipo (http://localhost:${PUERTO})`);
  const documentos = Number(sql('SELECT count(*) FROM fhn_documentos'));
  esperar(documentos >= 1, `hay ${documentos} documento(s) emitidos`);

  // --- 2. Respaldo y restauración en una instalación nueva ---
  sh(respaldar);
  const respaldo = readdirSync(RAIZ).find((f) => /^respaldo-\d{4}-\d{2}-\d{2}\.dump$/.test(f));
  esperar(Boolean(respaldo), `el respaldo quedó en ${respaldo}`);
  sh('docker compose down -v');
  sh(restaurar.replaceAll('respaldo-AAAA-MM-DD.dump', respaldo));
  esperar((await http('/salud')).estado === 200, 'tras restaurar, /salud responde 200');
  esperar(Number(sql('SELECT count(*) FROM fhn_documentos')) === documentos, 'los documentos restaurados son los mismos');
  esperar((await http('/v1/sesion', llave)).estado === 200, 'la llave de antes sigue valiendo');
  sh(`${emitir}`);
  esperar(Number(sql('SELECT count(*) FROM fhn_documentos')) === documentos + 1, 'después de restaurar se sigue emitiendo');

  // --- 3. Con contraseñas, sobre un volumen nuevo ---
  sh('docker compose down -v');
  const claves = { POSTGRES_PASSWORD: randomBytes(18).toString('base64url'), FHN_API_PASSWORD: randomBytes(18).toString('base64url') };
  writeFileSync(ENV_ARCHIVO, dotenv.replace(/^(\w+)=.*$/gm, (_, k) => `${k}=${claves[k]}`));
  writeFileSync(OVERRIDE, override);
  sh('docker compose up -d --wait db\ndocker compose exec -T db psql -U postgres -d factura_hn -c "SELECT 1"');
  esperar(true, 'tras `up -d --wait db` en un volumen nuevo, la base ya acepta conexiones');
  esperar(sql("SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname = 'fhn_api'") === 't', 'el script de inicio creó fhn_api con contraseña');
  sh('docker compose up -d --build --wait');
  esperar((await http('/salud')).estado === 200, 'con contraseñas, /salud responde 200');
  esperar(sql("SELECT count(*) FROM pg_stat_activity WHERE usename = 'fhn_api'") !== '0', 'la API está conectada como fhn_api');
  sh(rolApi);
  esperar(true, 'el script de inicio se puede correr otra vez a mano (actualizar)');
  sh(emitir);
  esperar(Number(sql('SELECT count(*) FROM fhn_documentos')) >= 1, 'con contraseñas se emite');
} catch (e) {
  fallo = e;
  try {
    sh('docker compose logs --tail 40 api');
  } catch {}
} finally {
  try {
    sh('docker compose down -v --remove-orphans');
  } catch (e) {
    fallo ??= e;
  }
  for (const f of [ENV_ARCHIVO, OVERRIDE]) rmSync(f, { force: true });
  borrarTemporales();
}
if (fallo) {
  console.error(`\nFALLÓ: ${fallo.message}`);
  process.exit(1);
}
console.log('\nautoalojamiento: todos los bloques corren tal cual.');
