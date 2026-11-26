#!/usr/bin/env node
/**
 * Corre los curl de lib/ejemplos-openapi.mjs, tal cual y en orden, contra una API recién levantada con
 * `docker compose up -d --build --wait` (desde la raíz del repositorio), y guarda cada respuesta real en
 * lib/ejemplos-openapi.json. La referencia de la API (/referencia/openapi/) muestra esas respuestas.
 *
 *   docker compose -p fhn-ejemplos up -d --build --wait
 *   COMPOSE_PROJECT_NAME=fhn-ejemplos node web/scripts/capturar-ejemplos-openapi.mjs
 *   docker compose -p fhn-ejemplos down -v
 *
 * Con otro puerto: FHN_PUERTO=8811 en los tres comandos. Falla si un ejemplo no responde 2xx (salvo los que
 * declaran su código en `esperado`) o si queda una ruta del OpenAPI sin ejemplo.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAIZ } from '../sitio.config.mjs';
import { EJEMPLOS, PREAMBULO, VARIABLES, variablesDe } from './lib/ejemplos-openapi.mjs';
import { operacionesPublicadas, ocultarSecretos } from './lib/openapi.mjs';

const PUERTO = process.env.FHN_PUERTO || '8787';
const ESPERADO = { 'POST /v1/emisores': 409, 'POST /v1/series/{identificador}/corregir-fecha': 422 };
const spec = JSON.parse(readFileSync(join(RAIZ, 'packages/api/openapi.json'), 'utf8'));
const faltan = operacionesPublicadas(spec).filter((o) => !EJEMPLOS.some((e) => e.op === o)).sort();
if (faltan.length) throw new Error(`Rutas sin ejemplo en lib/ejemplos-openapi.mjs: ${faltan.join(', ')}`);

const bash = (script, env = process.env) => execFileSync('bash', ['-c', `set -eo pipefail\n${script}`], { cwd: RAIZ, env, encoding: 'utf8' });
// El preámbulo, tal cual; solo el puerto cambia si la API no está en el 8787.
const valores = Object.fromEntries(
  bash(`${PREAMBULO.replace('127.0.0.1:8787', `127.0.0.1:${PUERTO}`)}\nprintf '%s\\n' "$API" "$LLAVE" "$ADMIN" "$HOY"`)
    .trim()
    .split('\n')
    .map((v, i) => [['API', 'LLAVE', 'ADMIN', 'HOY'][i], v]),
);
if (!/^fhn_test_/.test(valores.LLAVE) || !/^fhn_test_/.test(valores.ADMIN)) throw new Error('El preámbulo no dio llaves del demo.');

const dir = mkdtempSync(join(tmpdir(), 'fhn-ejemplos-'));
const resultado = {};
try {
  for (const ejemplo of EJEMPLOS) {
    for (const v of variablesDe(ejemplo.curl)) if (valores[v] === undefined) throw new Error(`${ejemplo.op}: falta ${v} (sale de ${VARIABLES[v].de}).`);
    const cuerpo = join(dir, 'cuerpo');
    const cabeceras = join(dir, 'cabeceras');
    // `curl` se envuelve en una función solo para guardar el código, las cabeceras y el cuerpo: el texto del
    // ejemplo corre sin cambios.
    const script = `curl() { command curl -sS -o "$FHN_CUERPO" -D "$FHN_CABECERAS" -w '%{http_code}' "$@"; }\n${ejemplo.curl}`;
    const codigo = Number(bash(script, { ...process.env, ...valores, FHN_CUERPO: cuerpo, FHN_CABECERAS: cabeceras }).trim());
    const tipo = /^content-type:\s*([^;\r\n]+)/im.exec(readFileSync(cabeceras, 'utf8'))?.[1].trim() ?? '';
    const texto = readFileSync(cuerpo, 'utf8');
    const esperado = ESPERADO[ejemplo.op];
    if (esperado ? codigo !== esperado : codigo < 200 || codigo > 299) {
      throw new Error(`${ejemplo.op}: respondió ${codigo}${esperado ? ` (se esperaba ${esperado})` : ''}\n${texto.slice(0, 600)}`);
    }
    const datos = tipo === 'application/json' ? JSON.parse(texto) : null;
    for (const [v, def] of Object.entries(VARIABLES)) {
      if (def.de === ejemplo.op) valores[v] = def.ruta.reduce((x, k) => x?.[k], datos);
    }
    resultado[ejemplo.op] = { codigo, tipo, cuerpo: ocultarSecretos(datos ?? texto) };
    console.log(`${codigo}  ${ejemplo.op}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const salida = join(RAIZ, 'web/scripts/lib/ejemplos-openapi.json');
writeFileSync(salida, `${JSON.stringify(resultado, null, 2)}\n`);
console.log(`\n${Object.keys(resultado).length} respuestas en ${salida}`);
