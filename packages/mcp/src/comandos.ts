/**
 * Comandos de consola de `@factura-hn/mcp`, en español:
 * - sin comando: arranca el servidor MCP por stdio (lo hace el cliente MCP);
 * - `init` (o `iniciar`) [--demo] [--dir] [--forzar]: crea la base SQLite y el emisor, e imprime el bloque `mcpServers`;
 * - `registrar-cai`: registra el CAI de la resolución del SAR (en la base SQLite o vía la API);
 * - `ayuda`.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fechaHonduras, identificadorDe, registrarAutorizacion, validarNuevaAutorizacion, type AutorizacionCAI, type Problema } from 'factura-hn';
import { AlmacenSQLite } from '@factura-hn/sqlite';
import { BackendApi, caisDeBase, clavesSQLite, ErrorBackend, registrarCAIEnAlmacen, type ResultadoRegistroCAI } from './backend';
import { autorizacionesDemo, EMISOR_DEMO, esCAIDemo, LEYENDA_PRUEBA } from './demo';
import { plantillaEmisor } from './emisor';
import { conSolucion } from './soluciones';
import { versionPaquete } from './version';

export interface Salida {
  out(texto: string): void;
  err(texto: string): void;
}

export interface Contexto {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Plataforma para la que se arma el bloque `mcpServers` (por defecto, la de este equipo). */
  plataforma?: NodeJS.Platform;
  /** Reloj: la fecha de hoy para el CAI ficticio y el instante de la bitácora. Por defecto, la hora del equipo. */
  reloj?: () => Date;
  salida?: Salida;
}

const consola: Salida = { out: (t) => console.log(t), err: (t) => console.error(t) };

/** El paquete que se ejecuta con npx. */
const PAQUETE = '@factura-hn/mcp';


/** Abre (o crea) una base SQLite en archivo. node:sqlite se carga solo aquí, como en el servidor. */
export function abrirBase(ruta: string) {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  return new DatabaseSync(ruta);
}

class ErrorUso extends Error {}

/** Lee las opciones; un error de uso se explica en español. */
function opciones(args: string[], definicion: NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>['options']>): Record<string, string | boolean | undefined> {
  try {
    return parseArgs({ args, options: definicion, strict: true, allowPositionals: false }).values as Record<string, string | boolean | undefined>;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const opcion = /'([^']+)'/.exec(m)?.[1];
    if (/Unknown option/i.test(m)) throw new ErrorUso(`Opción desconocida: ${opcion ?? m}.`);
    if (/argument missing/i.test(m)) throw new ErrorUso(`Falta el valor de ${opcion ?? 'una opción'}.`);
    if (/does not take an argument/i.test(m)) throw new ErrorUso(`${opcion ?? 'Esa opción'} no lleva valor.`);
    if (/Unexpected argument/i.test(m)) throw new ErrorUso(`Argumento inesperado: ${opcion ?? m}. Las opciones van con «--».`);
    throw new ErrorUso(m);
  }
}

const codigo3 = (v: string, nombre: string) => {
  if (!/^\d{1,3}$/.test(v)) throw new ErrorUso(`${nombre} debe tener hasta 3 dígitos (p. ej. 000 o 001).`);
  return v.padStart(3, '0');
};

/**
 * Bloque `mcpServers` para pegar en el cliente MCP. En Windows, npx es un .cmd y se lanza con `cmd /c`. El paquete
 * va con la versión fija de quien lo imprime: el cliente MCP arranca siempre la misma, no la última publicada.
 */
export function bloqueMcpServers(env: Record<string, string>, plataforma: NodeJS.Platform = process.platform, version = versionPaquete()) {
  const paquete = version ? `${PAQUETE}@${version}` : PAQUETE;
  const comando = plataforma === 'win32' ? { command: 'cmd', args: ['/c', 'npx', '-y', paquete] } : { command: 'npx', args: ['-y', paquete] };
  return { mcpServers: { 'factura-hn': { ...comando, env } } };
}

// Se indica el camino del menú: la ruta del archivo cambia según la instalación (p. ej. la de Microsoft Store).
const DONDE_PEGAR = () =>
  [
    'Dónde pegarlo:',
    '- Claude Desktop: Settings > Developer > Edit Config (Configuración > Desarrollador > Editar configuración) abre ' +
      'claude_desktop_config.json. Guarda y reinicia Claude Desktop.',
    '- Claude Code: en .mcp.json, en la raíz del proyecto (o con «claude mcp add-json factura-hn» y el objeto de "factura-hn").',
    '- Cursor: en ~/.cursor/mcp.json (para todos los proyectos) o en .cursor/mcp.json (solo este).',
    '- VS Code: en .vscode/mcp.json, pero la clave se llama "servers" en vez de "mcpServers".',
    'Si el archivo ya tiene otros servidores, agrega "factura-hn" dentro de su "mcpServers".',
  ].join('\n');

const AYUDA = `factura-hn MCP: facturación SAR Honduras desde un asistente de IA.

Uso: npx -y ${PAQUETE} [comando] [opciones]

Comandos:
  (ninguno)        Arranca el servidor MCP por stdio. Lo hace tu cliente MCP con el bloque que imprime «init».
  init, iniciar    Crea la base SQLite y el archivo del emisor en esta carpeta e imprime el bloque mcpServers.
                     --demo              Modo de prueba: emisor y CAI ficticios (${LEYENDA_PRUEBA}).
                                         Usa factura-demo.db y emisor-demo.json, aparte de la base real.
                     --dir <carpeta>     Otra carpeta en vez de la actual.
                     --establecimiento   Código de establecimiento (por defecto 000).
                     --punto             Código de punto de emisión (por defecto 001).
                     --forzar            Reescribe el archivo del emisor (guarda antes una copia .bak del real).
                                         Con --demo, también recrea la base de prueba. Nunca borra la base real.
  registrar-cai    Registra el CAI de la resolución del SAR (cópialo de la resolución; no lo inventes).
                     --cai --tipo (01, 06 o 07) --establecimiento --punto --desde --hasta
                     --fecha-limite AAAA-MM-DD  [--fecha-autorizacion AAAA-MM-DD]
                     --ultimo-emitido-antes N  Si ya emitiste con este CAI (talonario u otro sistema): el último
                                         número usado. La serie sigue desde el siguiente.
                     --base <factura.db>  Base SQLite (o FHN_SQLITE; por defecto ./factura.db).
                     --api-url --llave    Vía la API (o FHN_API_URL y FHN_LLAVE); requiere una llave admin.
  ayuda            Esta ayuda.

Variables del servidor:
  FHN_SQLITE, FHN_EMISOR             Modo SQLite: la base y el JSON del emisor.
  FHN_API_URL, FHN_LLAVE             Modo API.
  FHN_ESTABLECIMIENTO, FHN_PUNTO     Dónde emite (por defecto 000 y 001).
  FHN_OPERADOR                       Persona que opera, para la bitácora (opcional).

Guía: https://github.com/AugustoMelara-Dev/factura-hn/tree/main/packages/mcp#readme`;

/** Lista de problemas con qué hacer y su enlace, para la consola. */
function listaProblemas(e: ErrorBackend): string {
  const problemas: Problema[] = e.errores.length ? e.errores : [{ codigo: e.codigo, mensaje: e.message }];
  return problemas
    .map(conSolucion)
    .map((p) => `- [${p.codigo}] ${p.mensaje}${p.campo ? ` (${p.campo})` : ''}\n  Qué hacer: ${p.solucion}\n  Guía: ${p.guia}`)
    .join('\n');
}

/** Si la base tiene algún CAI real (en autorizaciones o documentos), no es de prueba: no se toca. */
function exigirBasePrueba(db: Parameters<typeof caisDeBase>[0], ruta: string) {
  const { reales } = caisDeBase(db);
  if (reales.length) {
    throw new ErrorUso(`${ruta} tiene un CAI real (${reales[0]}): no es una base de prueba. No se modifica ni se borra.`);
  }
}

/**
 * Crea la base (con sus tablas) y, con `demo`, registra los CAI ficticios que falten. Antes de registrar el
 * primero, comprueba que la base sea de prueba y valida los tres: o entran todos o ninguno.
 */
async function prepararBase(ruta: string, o: { demo: boolean; establecimiento: string; puntoEmision: string; reloj?: () => Date }) {
  const db = abrirBase(ruta);
  try {
    const almacen = new AlmacenSQLite(db);
    clavesSQLite(db);
    const registrados: AutorizacionCAI[] = [];
    const vencidos: AutorizacionCAI[] = [];
    if (o.demo) {
      exigirBasePrueba(db, ruta);
      const ahora = (o.reloj ?? (() => new Date()))();
      const hoy = fechaHonduras(ahora);
      const pendientes: AutorizacionCAI[] = [];
      for (const a of autorizacionesDemo({ hoy: ahora, establecimiento: o.establecimiento, puntoEmision: o.puntoEmision })) {
        const existentes = await almacen.transaccion((tx) => tx.autorizaciones(identificadorDe(a)));
        const previo = existentes.find((x) => esCAIDemo(x.cai));
        if (previo) {
          if (previo.fechaLimiteEmision < hoy) vencidos.push(previo);
          continue;
        }
        const problemas = validarNuevaAutorizacion(existentes, a);
        if (problemas.length) throw new ErrorUso(`No se pudo registrar el CAI ficticio en ${identificadorDe(a)}: ${problemas.map((p) => p.mensaje).join(' ')}`);
        pendientes.push(a);
      }
      for (const a of pendientes) registrados.push(await registrarAutorizacion(almacen, a, { actor: 'mcp:init-demo', reloj: o.reloj }));
    }
    return { registrados, vencidos };
  } finally {
    db.close();
  }
}

async function init(args: string[], c: Contexto, s: Salida): Promise<number> {
  const v = opciones(args, {
    demo: { type: 'boolean' },
    dir: { type: 'string' },
    forzar: { type: 'boolean' },
    establecimiento: { type: 'string' },
    punto: { type: 'string' },
  });
  const demo = Boolean(v.demo);
  const forzar = Boolean(v.forzar);
  const plataforma = c.plataforma ?? process.platform;
  const establecimiento = codigo3((v.establecimiento as string | undefined) ?? '000', '--establecimiento');
  const puntoEmision = codigo3((v.punto as string | undefined) ?? '001', '--punto');
  const dir = resolve(c.cwd, (v.dir as string | undefined) ?? '.');
  mkdirSync(dir, { recursive: true });
  const base = resolve(dir, demo ? 'factura-demo.db' : 'factura.db');
  const emisor = resolve(dir, demo ? 'emisor-demo.json' : 'emisor.json');
  const hechos: string[] = [];

  const existiaEmisor = existsSync(emisor);
  if (existiaEmisor && !forzar) {
    hechos.push(`Se conserva ${emisor} (ya existía; usa --forzar para reescribirlo).`);
  } else {
    const datos = demo
      ? { _aviso: `Emisor FICTICIO de demostración: ${LEYENDA_PRUEBA}.`, ...EMISOR_DEMO }
      : plantillaEmisor();
    // El emisor real puede tener los datos del negocio: se guarda una copia antes de reescribirlo.
    if (existiaEmisor && !demo) {
      copyFileSync(emisor, `${emisor}.bak`);
      hechos.push(`Copia del emisor anterior en ${emisor}.bak.`);
    }
    writeFileSync(emisor, `${JSON.stringify(datos, null, 2)}\n`, 'utf8');
    hechos.push(`${existiaEmisor ? 'Reescrito' : 'Creado'} ${emisor}${demo ? ' (emisor ficticio).' : ' (plantilla: llénala con los datos de tu negocio).'}`);
  }

  const existiaBase = existsSync(base);
  if (existiaBase && forzar && demo) {
    // Solo una base de prueba se recrea: antes de borrarla se comprueba que no tenga ningún CAI real.
    const db = abrirBase(base);
    try {
      exigirBasePrueba(db, base);
    } finally {
      db.close();
    }
    try {
      for (const sufijo of ['', '-wal', '-shm']) rmSync(`${base}${sufijo}`, { force: true });
    } catch {
      throw new ErrorUso(`No se pudo borrar ${base}: ciérrala primero (cierra el asistente que usa el servidor MCP).`);
    }
    hechos.push(`Recreada la base de prueba ${base}.`);
  } else if (existiaBase) {
    hechos.push(`Se conserva la base ${base}${forzar ? ': --forzar nunca borra la base real, que guarda documentos fiscales.' : '.'}`);
  } else {
    hechos.push(`Creada la base ${base}.`);
  }
  const { registrados, vencidos } = await prepararBase(base, { demo, establecimiento, puntoEmision, reloj: c.reloj });
  for (const a of registrados) {
    hechos.push(`Registrado el CAI ficticio ${a.cai} (${identificadorDe(a)}, rango ${a.rangoInicial}–${a.rangoFinal}, fecha límite ${a.fechaLimiteEmision}).`);
  }
  if (demo && !registrados.length && !vencidos.length) hechos.push('El CAI ficticio ya estaba registrado.');
  for (const a of vencidos) hechos.push(`Aviso: el CAI ficticio de ${identificadorDe(a)} venció el ${a.fechaLimiteEmision}. Usa «init --demo --forzar» para recrear la base de prueba.`);

  const bloque = bloqueMcpServers({ FHN_SQLITE: base, FHN_EMISOR: emisor, FHN_ESTABLECIMIENTO: establecimiento, FHN_PUNTO: puntoEmision }, plataforma);
  const pasos = demo
    ? [
        `Modo de prueba: el asistente marcará cada documento como «${LEYENDA_PRUEBA}».`,
        '',
        'Paso 2. Pega este bloque en la configuración de tu cliente MCP:',
      ]
    : [
        'Antes de emitir:',
        `1. Llena ${emisor} con los datos de tu negocio. El servidor los valida al arrancar y dice qué falta.`,
        '2. Registra el CAI de tu resolución del SAR, una vez por tipo de documento, copiando los datos de la resolución:',
        `   npx -y ${PAQUETE} registrar-cai --base "${base}" --cai CAI_DE_LA_RESOLUCION --tipo 01 --establecimiento ${establecimiento} --punto ${puntoEmision} --desde PRIMER_NUMERO --hasta ULTIMO_NUMERO --fecha-limite AAAA-MM-DD`,
        '   Si ya emitiste documentos con ese CAI (talonario u otro sistema), agrega --ultimo-emitido-antes ULTIMO_NUMERO_USADO.',
        '   (O pídele al asistente que lo registre con registrar_cai, dándole los datos de la resolución.)',
        '3. Pega este bloque en la configuración de tu cliente MCP:',
      ];
  s.out([
    ...hechos,
    '',
    ...pasos,
    '',
    JSON.stringify(bloque, null, 2),
    '',
    DONDE_PEGAR(),
    '',
    demo ? 'Paso 3. Reinicia el cliente y pídele al asistente: «emite una factura de prueba».' : 'Después, reinicia el cliente y pídele al asistente que emita una factura.',
  ].join('\n'));
  return 0;
}

async function registrarCai(args: string[], c: Contexto, s: Salida): Promise<number> {
  const v = opciones(args, {
    cai: { type: 'string' },
    tipo: { type: 'string' },
    establecimiento: { type: 'string' },
    punto: { type: 'string' },
    desde: { type: 'string' },
    hasta: { type: 'string' },
    'fecha-limite': { type: 'string' },
    'fecha-autorizacion': { type: 'string' },
    'ultimo-emitido-antes': { type: 'string' },
    base: { type: 'string' },
    'api-url': { type: 'string' },
    llave: { type: 'string' },
  }) as Record<string, string | undefined>;
  const obligatorias = ['cai', 'tipo', 'establecimiento', 'punto', 'desde', 'hasta', 'fecha-limite'];
  const faltan = obligatorias.filter((k) => !v[k]?.trim());
  if (faltan.length) {
    throw new ErrorUso(`Faltan datos de la resolución del SAR: ${faltan.map((k) => `--${k}`).join(', ')}. Cópialos de la resolución; no los inventes.`);
  }
  const entero = (k: 'desde' | 'hasta' | 'ultimo-emitido-antes', que: string) => {
    if (!/^\d+$/.test(v[k]!.trim())) throw new ErrorUso(`--${k} debe ser un número entero (${que}).`);
    return Number(v[k]);
  };
  const autorizacion: AutorizacionCAI = {
    cai: v.cai!.trim(),
    tipoDocumento: v.tipo!.trim() as AutorizacionCAI['tipoDocumento'],
    establecimiento: v.establecimiento!.trim(),
    puntoEmision: v.punto!.trim(),
    rangoInicial: entero('desde', 'el correlativo inicial del rango'),
    rangoFinal: entero('hasta', 'el correlativo final del rango'),
    fechaLimiteEmision: v['fecha-limite']!.trim(),
    ...(v['fecha-autorizacion'] ? { fechaAutorizacion: v['fecha-autorizacion'].trim() } : {}),
    ...(v['ultimo-emitido-antes'] !== undefined ? { ultimoEmitidoAntes: entero('ultimo-emitido-antes', 'el último número ya usado con este CAI') } : {}),
  };
  const operador = c.env.FHN_OPERADOR || undefined;
  const url = v['api-url'] ?? c.env.FHN_API_URL;
  let r: ResultadoRegistroCAI;
  let donde: string;
  try {
    if (url) {
      const llave = v.llave ?? c.env.FHN_LLAVE;
      if (!llave) throw new ErrorUso('Falta la llave de API: --llave o FHN_LLAVE (debe ser una llave admin).');
      r = await new BackendApi({ url, llave, operador }).registrarCAI(autorizacion);
      donde = `la API (${url})`;
    } else {
      const base = resolve(c.cwd, v.base ?? c.env.FHN_SQLITE ?? 'factura.db');
      // No se crea una base nueva aquí: una ruta mal escrita dejaría el CAI en un archivo que el servidor no usa.
      if (!existsSync(base)) {
        throw new ErrorUso(`No existe la base ${base}. Indica la de FHN_SQLITE con --base, o créala con «npx -y ${PAQUETE} init».`);
      }
      const db = abrirBase(base);
      try {
        r = await registrarCAIEnAlmacen(new AlmacenSQLite(db), db, autorizacion, { actor: 'mcp:registrar-cai', operador, reloj: c.reloj });
      } finally {
        db.close();
      }
      donde = base;
    }
  } catch (e) {
    if (e instanceof ErrorBackend) {
      s.err(`No se registró el CAI (${e.codigo}):\n${listaProblemas(e)}`);
      return 1;
    }
    throw e;
  }
  const a = r.autorizacion;
  s.out(
    `CAI registrado en ${donde}: ${a.cai} · serie ${identificadorDe(a)} · rango ${a.rangoInicial}–${a.rangoFinal} · fecha límite ${a.fechaLimiteEmision}` +
      (r.advertencias.length ? `\nAvisos:\n${r.advertencias.map((p) => `- [${p.codigo}] ${p.mensaje}`).join('\n')}` : ''),
  );
  return 0;
}

/**
 * Ejecuta un comando de consola. Devuelve el código de salida, o `'servidor'` si no hay comando y hay que
 * arrancar el servidor MCP.
 */
export async function ejecutarComando(args: string[], c: Contexto): Promise<number | 'servidor'> {
  const s = c.salida ?? consola;
  const [comando, ...resto] = args;
  try {
    switch (comando) {
      case undefined:
        return 'servidor';
      case 'init':
      case 'iniciar':
        return await init(resto, c, s);
      case 'registrar-cai':
        return await registrarCai(resto, c, s);
      case 'ayuda':
      case 'help':
      case '--help':
      case '-h':
        s.out(AYUDA);
        return 0;
      default:
        s.err(`Comando desconocido: ${comando}.\n\n${AYUDA}`);
        return 1;
    }
  } catch (e) {
    if (e instanceof ErrorUso) {
      s.err(`${e.message}\nAyuda: npx -y ${PAQUETE} ayuda`);
      return 1;
    }
    throw e;
  }
}
