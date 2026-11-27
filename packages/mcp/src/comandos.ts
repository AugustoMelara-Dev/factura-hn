/**
 * Comandos de consola de `@factura-hn/mcp`, en español:
 * - sin comando: arranca el servidor MCP por stdio (lo hace el cliente MCP);
 * - `init` (o `iniciar`) [--demo] [--dir] [--forzar]: crea la base SQLite y el emisor, e imprime el bloque `mcpServers`;
 * - `registrar-cai`: registra el CAI de la resolución del SAR (en la base SQLite o vía la API);
 * - `ayuda`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    // El nombre sin lo que agrega Node («--dir <value>»).
    const nombre = opcion?.split(' ')[0];
    if (/Unknown option/i.test(m)) throw new ErrorUso(`Opción desconocida: ${opcion ?? m}.${opcion === '--force' ? ' ¿Quisiste decir --forzar?' : ''}`);
    if (/argument missing/i.test(m)) throw new ErrorUso(`Falta el valor de ${nombre ?? 'una opción'}.`);
    // p. ej. «--desde -5»: parseArgs no sabe si -5 es el valor o otra opción.
    if (/argument is ambiguous/i.test(m)) throw new ErrorUso(`Falta el valor de ${nombre ?? 'una opción'}, o empieza con «-»: escríbelo como ${nombre ?? '--opcion'}=VALOR.`);
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
    'La primera vez que el cliente arranca el servidor, npx descarga esta versión del paquete: hace falta conexión a internet.',
  ].join('\n');

/** La ayuda de cada comando: va en la ayuda general y sola con `<comando> --help` o `ayuda <comando>`. */
const AYUDA_COMANDO: Record<'init' | 'http' | 'registrar-cai', string> = {
  init: `  init, iniciar    Crea la base SQLite y el archivo del emisor en esta carpeta e imprime el bloque mcpServers.
                     --demo              Modo de prueba: emisor y CAI ficticios (${LEYENDA_PRUEBA}).
                                         Usa factura-demo.db y emisor-demo.json, aparte de la base real.
                     --dir <carpeta>     Otra carpeta en vez de la actual.
                     --establecimiento   Código de establecimiento (por defecto 000).
                     --punto             Código de punto de emisión (por defecto 001).
                     --forzar            Reescribe el archivo del emisor (guarda antes una copia .bak del real,
                                         sin pisar otra). Con --demo, también recrea la base de prueba. Nunca
                                         borra la base real.`,
  http: `  http             Arranca el MCP por HTTP (Streamable HTTP) sobre tu propia API (FHN_API_URL). Cada
                     conexión llama a /mcp con su llave en la cabecera Authorization: Bearer, o a
                     /mcp/<token> (la URL que imprime «llave crear --rol caja --caja 000-001 --mcp»; solo de
                     una llave de caja). FHN_MCP_SOLO_URL=1 acepta solo /mcp/<token>, sin Bearer. Una llave
                     de caja emite en su propia caja.`,
  'registrar-cai': `  registrar-cai    Registra el CAI de la resolución del SAR (cópialo de la resolución; no lo inventes).
                     --cai --tipo (01, 06 o 07) --establecimiento --punto --desde --hasta
                     --fecha-limite AAAA-MM-DD  [--fecha-autorizacion AAAA-MM-DD]
                     --ultimo-emitido-antes N  Si ya emitiste con este CAI (talonario u otro sistema): el último
                                         número usado. La serie sigue desde el siguiente.
                     --base <factura.db>  Base SQLite (o FHN_SQLITE; por defecto ./factura.db).
                     --api-url --llave    Vía la API (o FHN_API_URL y FHN_LLAVE); requiere una llave admin.
                     Revisa la forma del CAI (6-6-6-6-6-2), el rango y que la fecha límite no haya pasado.`,
};

/** Nombre del comando en la ayuda (`iniciar` es `init`). */
const comandoDeAyuda = (c: string | undefined) => (c === 'iniciar' ? 'init' : c) as keyof typeof AYUDA_COMANDO;
const esAyuda = (a: string) => a === '--help' || a === '-h' || a === '--ayuda';

const AYUDA = `factura-hn MCP: facturación SAR Honduras desde un asistente de IA.

Uso: npx -y ${PAQUETE} [comando] [opciones]

Comandos:
  (ninguno)        Arranca el servidor MCP por stdio. Lo hace tu cliente MCP con el bloque que imprime «init».
${AYUDA_COMANDO.init}
${AYUDA_COMANDO.http}
${AYUDA_COMANDO['registrar-cai']}
  version          La versión de este paquete (también --version).
  ayuda [comando]  Esta ayuda, o la de un comando (también <comando> --help).

Variables del servidor:
  FHN_SQLITE, FHN_EMISOR             Modo SQLite: la base y el JSON del emisor.
  FHN_API_URL, FHN_LLAVE             Modo API.
  FHN_ESTABLECIMIENTO, FHN_PUNTO     Dónde emite (por defecto 000 y 001). Por HTTP, solo con llaves sin caja.
  FHN_OPERADOR                       Persona que opera, para la bitácora (opcional).
  FHN_MCP_PUERTO, FHN_MCP_ORIGENES   Comando http: puerto (por defecto PORT u 8788) y orígenes de navegador
                                     aceptados. Las demás variables FHN_MCP_* están en la guía.

Guía: https://github.com/AugustoMelara-Dev/factura-hn/tree/main/packages/mcp#readme`;

/** Lista de problemas con qué hacer y su enlace, para la consola. */
function listaProblemas(e: ErrorBackend): string {
  const problemas: Problema[] = e.errores.length ? e.errores : [{ codigo: e.codigo, mensaje: e.message }];
  return problemas
    .map(conSolucion)
    .map((p) => `- [${p.codigo}] ${p.mensaje}${p.campo ? ` (${p.campo})` : ''}\n  Qué hacer: ${p.solucion}\n  Guía: ${p.guia}`)
    .join('\n');
}

/** El error de SQLite cuando el archivo no es una base (dañado o de otra cosa). */
const esBaseDanada = (e: unknown) => e instanceof Error && /file is not a database|database disk image is malformed/i.test(e.message);

/** Qué decir de un archivo que no es una base SQLite: nunca se borra una base real. */
const errorBaseDanada = (ruta: string, demo: boolean) =>
  new ErrorUso(
    `${ruta} no es una base SQLite de factura-hn (está dañada o es otro archivo). ` +
      (demo
        ? `Para recrear la base de prueba: npx -y ${PAQUETE} init --demo --forzar`
        : 'Revisa la ruta (FHN_SQLITE o --base). Si es la base del negocio, restaura tu respaldo; si es otro archivo, muévelo y corre init de nuevo.'),
  );

/** Si la base tiene algún CAI real (en autorizaciones o documentos), no es de prueba: no se toca. */
function exigirBasePrueba(db: Parameters<typeof caisDeBase>[0], ruta: string) {
  const { reales } = caisDeBase(db);
  if (reales.length) {
    throw new ErrorUso(
      `${ruta} tiene un CAI real (${reales[0]}): no es una base de prueba, así que no se modifica ni se borra. ` +
        `Para probar, crea la base de prueba en otra carpeta: npx -y ${PAQUETE} init --demo --dir ./prueba`,
    );
  }
}

/**
 * Crea la base (con sus tablas) y, con `demo`, registra los CAI ficticios que falten. Antes de registrar el
 * primero, comprueba que la base sea de prueba y valida los tres: o entran todos o ninguno.
 */
async function prepararBase(ruta: string, o: { demo: boolean; establecimiento: string; puntoEmision: string; reloj?: () => Date }) {
  try {
    return await prepararBaseAbierta(ruta, o);
  } catch (e) {
    if (esBaseDanada(e)) throw errorBaseDanada(ruta, o.demo);
    throw e;
  }
}

async function prepararBaseAbierta(ruta: string, o: { demo: boolean; establecimiento: string; puntoEmision: string; reloj?: () => Date }) {
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
        if (problemas.length) throw new ErrorUso(
            `No se pudo registrar el CAI ficticio en ${identificadorDe(a)}: ${problemas.map((p) => p.mensaje).join(' ')} ` +
              `Recrea la base de prueba con: npx -y ${PAQUETE} init --demo --forzar`,
          );
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
    const nuevo = `${JSON.stringify(datos, null, 2)}\n`;
    if (existiaEmisor && !demo) {
      const actual = readFileSync(emisor, 'utf8');
      // Si ya es la plantilla, no hay datos que guardar. Una copia anterior nunca se pisa: va a .bak-2, .bak-3…
      if (actual !== nuevo) {
        const copias = [`${emisor}.bak`, ...Array.from({ length: 998 }, (_, i) => `${emisor}.bak-${i + 2}`)];
        const igual = copias.find((r) => existsSync(r) && readFileSync(r, 'utf8') === actual);
        const destino = igual ?? copias.find((r) => !existsSync(r));
        if (!destino) throw new ErrorUso(`Hay demasiadas copias de ${emisor}: borra las .bak que no necesites y vuelve a intentarlo.`);
        if (!igual) copyFileSync(emisor, destino);
        hechos.push(`Copia del emisor anterior en ${destino}.`);
      }
    }
    writeFileSync(emisor, nuevo, 'utf8');
    hechos.push(`${existiaEmisor ? 'Reescrito' : 'Creado'} ${emisor}${demo ? ' (emisor ficticio).' : ' (plantilla: llénala con los datos de tu negocio).'}`);
  }

  const existiaBase = existsSync(base);
  if (existiaBase && forzar && demo) {
    // Solo una base de prueba se recrea: antes de borrarla se comprueba que no tenga ningún CAI real.
    // Un archivo que ni siquiera es una base SQLite no puede tener CAI reales: se recrea igual.
    const db = abrirBase(base);
    try {
      exigirBasePrueba(db, base);
    } catch (e) {
      if (!esBaseDanada(e)) throw e;
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
  for (const a of vencidos) hechos.push(`Aviso: el CAI ficticio de ${identificadorDe(a)} venció el ${a.fechaLimiteEmision}. Para recrear la base de prueba, corre: npx -y ${PAQUETE} init --demo --forzar`);

  const bloque = bloqueMcpServers({ FHN_SQLITE: base, FHN_EMISOR: emisor, FHN_ESTABLECIMIENTO: establecimiento, FHN_PUNTO: puntoEmision }, plataforma);
  const pasos = demo
    ? [
        `Listo: modo de prueba en ${dir}. Cada documento sale con la leyenda «${LEYENDA_PRUEBA}».`,
        '',
        'Pega este bloque en la configuración de tu cliente MCP:',
      ]
    : [
        `¿Solo quieres probar? Corre: npx -y ${PAQUETE} init --demo (emisor y CAI ficticios, listo para emitir).`,
        '',
        'Para emitir de verdad, antes de arrancar el servidor:',
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
    demo ? 'Después, reinicia el cliente y pídele al asistente: «emite una factura de prueba».' : 'Después, reinicia el cliente y pídele al asistente que emita una factura.',
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
      if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
        throw new ErrorUso(`--api-url (o FHN_API_URL) debe ser una URL completa, p. ej. http://127.0.0.1:8787 (no «${url}»).`);
      }
      const llave = v.llave ?? c.env.FHN_LLAVE;
      if (!llave) throw new ErrorUso('Falta la llave de API: pásala con --llave o en FHN_LLAVE. Tiene que ser una llave admin.');
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
      } catch (e) {
        if (esBaseDanada(e)) throw errorBaseDanada(base, false);
        throw e;
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
 * arrancar el servidor MCP por stdio, o `'http'` para el MCP remoto.
 */
export async function ejecutarComando(args: string[], c: Contexto): Promise<number | 'servidor' | 'http'> {
  const s = c.salida ?? consola;
  const [comando, ...resto] = args;
  // `<comando> --help`: la ayuda de ese comando, sin ejecutarlo.
  const deAyuda = comandoDeAyuda(comando);
  if (AYUDA_COMANDO[deAyuda] && resto.some(esAyuda)) {
    s.out(`Uso: npx -y ${PAQUETE} ${comando} [opciones]\n\n${AYUDA_COMANDO[deAyuda]}`);
    return 0;
  }
  try {
    switch (comando) {
      case undefined:
        return 'servidor';
      case 'http':
        if (resto.length) throw new ErrorUso('El comando http no lleva argumentos: se configura con variables de entorno (FHN_API_URL, FHN_MCP_*).');
        return 'http';
      case 'init':
      case 'iniciar':
        return await init(resto, c, s);
      case 'registrar-cai':
        return await registrarCai(resto, c, s);
      case 'ayuda':
      case 'help':
      case '--help':
      case '--ayuda':
      case '-h': {
        if (!resto.length) {
          s.out(AYUDA);
          return 0;
        }
        const tema = AYUDA_COMANDO[comandoDeAyuda(resto[0])];
        if (!tema || resto.length > 1) throw new ErrorUso(`No hay ayuda para «${resto.join(' ')}»: los comandos son init, http y registrar-cai.`);
        s.out(`Uso: npx -y ${PAQUETE} ${resto[0]} [opciones]\n\n${tema}`);
        return 0;
      }
      case 'version':
      case '--version':
      case '-v':
        if (resto.length) throw new ErrorUso('El comando version no lleva argumentos.');
        s.out(versionPaquete() ?? 'desconocida');
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
