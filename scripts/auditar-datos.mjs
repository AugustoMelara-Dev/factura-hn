#!/usr/bin/env node
/**
 * Auditoría de datos de ejemplo: nada del repositorio puede parecer un dato real.
 *
 * - RTN (14 dígitos) y DNI (13): solo con el prefijo 9999 (no existe el departamento 99) o en ceros.
 * - Correos: solo dominios reservados (`*.example`, RFC 2606) o el patrón genérico `algo@dominio.tld`.
 * - CAI con forma real (6-6-6-6-6-2 hexadecimal): solo los patrones ficticios conocidos.
 * - Nada de rutas de una máquina (C:\Users\…, /home/…, /Users/…).
 *
 * Uso: node scripts/auditar-datos.mjs   (sale con 1 y lista los hallazgos si hay alguno)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const archivos = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const OMITIR = new Set(['pnpm-lock.yaml', 'LICENSE', 'scripts/auditar-datos.mjs']);
const BINARIO = /\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|db|sqlite)$/i;

const CAI_FICTICIOS = [/^[0-9A-F]{6}-D4E5F6-A1B2C3-D4E5F6-A1B2C3-[0-9A-F]{2}$/, /^DEMO00-/, /^0{6}-/, /^F{6}-/];
const reglas = [
  { nombre: 'RTN o DNI con forma real', patron: /(?<![\w-])(\d{13,14}|\d{4}-\d{4}-\d{5,6})(?![\w-])/g, permitido: (m) => /^(9999|0000)/.test(m) || /^\d{4}-\d{4}-\d{5,6}$/.test(m) && /^(9999|0000)-/.test(m) },
  { nombre: 'correo con un dominio que podría existir', patron: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, permitido: (m) => /\.example$/i.test(m) || m === 'algo@dominio.tld' || /@users\.noreply\.github\.com$/.test(m) || /^noreply@anthropic\.com$/.test(m) },
  { nombre: 'CAI con forma real', patron: /\b[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{2}\b/g, permitido: (m) => CAI_FICTICIOS.some((r) => r.test(m)) },
  { nombre: 'ruta de una máquina', patron: /([A-Za-z]:\\Users\\[^\s\\'"`]+|\/home\/[a-z][\w-]*|\/Users\/[A-Z][\w-]*)/g, permitido: () => false },
];

const hallazgos = [];
for (const archivo of archivos) {
  if (OMITIR.has(archivo) || BINARIO.test(archivo)) continue;
  let texto;
  try {
    texto = readFileSync(archivo, 'utf8');
  } catch {
    continue;
  }
  // Números largos que no son identificaciones: marcas de tiempo, versiones, hashes del lockfile, etc.
  const lineas = texto.split('\n');
  lineas.forEach((linea, i) => {
    for (const r of reglas) {
      for (const m of linea.matchAll(r.patron)) {
        const valor = m[0];
        if (r.permitido(valor)) continue;
        if (r.nombre.startsWith('RTN') && /(sha|integrity|"version"|Date\.|1\d{12}\b)/.test(linea)) continue;
        hallazgos.push(`${archivo}:${i + 1}: ${r.nombre}: ${valor}`);
      }
    }
  });
}

if (hallazgos.length) {
  console.error(`Datos que podrían ser reales (usa los ficticios de CONTRIBUTING.md):\n${hallazgos.join('\n')}`);
  process.exit(1);
}
console.log(`Auditoría de datos: ${archivos.length} archivos, sin datos que parezcan reales.`);
