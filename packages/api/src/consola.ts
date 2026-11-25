/**
 * Consola del operador (`factura-hn-api`). Se conecta como dueño de las tablas: FHN_MIGRAR_URL si está definida,
 * si no DATABASE_URL (y FHN_ROL). Con FHN_MIGRAR_URL, `migrar` también prepara el rol LOGIN de DATABASE_URL. Las
 * llaves se imprimen una sola vez, solo en esta terminal.
 */
import { writeFileSync } from 'node:fs';
import type pg from 'pg';
import { crearApp } from './app';
import { migrarApi, ROL_POR_DEFECTO } from './esquema';
import { bloqueLlavesDemo, consolaDe, crearLlaveDemo, crearLlaveOperador, crearTenant, errorTenantEnModoLocal, LEYENDA_PRUEBA, TENANTS_RESERVADOS } from './operador';
import { crearPool, urlDueno, usuarioDeUrl } from './pool';

export interface SalidaConsola {
  log: (texto: string) => void;
  error: (texto: string) => void;
}

interface Comando {
  /** Palabras del comando, p. ej. `['llave', 'crear']`. */
  nombre: string[];
  uso: string;
  descripcion: string;
  /** Argumentos posicionales obligatorios y opcionales. */
  posicionales: { obligatorios: string[]; opcionales?: string[] };
  /** Opciones con valor (`--rol caja`) y banderas (`--solo-llave`). */
  opciones?: string[];
  banderas?: string[];
  usaBase: boolean;
}

const COMANDOS: Comando[] = [
  {
    nombre: ['migrar'],
    uso: 'migrar',
    descripcion: 'Crea o actualiza las tablas de la API. El servidor también migra al arrancar.',
    posicionales: { obligatorios: [] },
    usaBase: true,
  },
  {
    nombre: ['tenant', 'crear'],
    uso: 'tenant crear <tenant> [--nombre "Mi Negocio"] [--limite 1000] [--modo produccion|prueba]',
    descripcion:
      'Crea un tenant y su primera llave admin. Solo en modo alojado (FHN_MODO=alojado): en modo local se niega. <tenant>: minúsculas, dígitos, «-» o «_». --modo (por defecto ' +
      'produccion) no cambia después: un tenant de prueba solo acepta CAI ficticios y sus llaves empiezan con fhn_test_; ' +
      'uno de producción no acepta CAI ficticios y sus llaves empiezan con fhn_live_.',
    posicionales: { obligatorios: ['tenant'] },
    opciones: ['nombre', 'limite', 'modo'],
    usaBase: true,
  },
  {
    nombre: ['llave', 'crear'],
    uso: 'llave crear <tenant> --rol admin|caja [--nombre "Caja 2"] [--caja 000-002]',
    descripcion: 'Crea una llave. Con --rol caja, --caja es obligatorio (establecimiento-punto de emisión). Empieza con fhn_live_ en un tenant de producción y con fhn_test_ en uno de prueba. Así se crea la llave admin del negocio: llave crear local --rol admin --nombre Administración.',
    posicionales: { obligatorios: ['tenant'] },
    opciones: ['rol', 'nombre', 'caja'],
    usaBase: true,
  },
  {
    nombre: ['demo', 'llave'],
    uso: 'demo llave [--rol caja|admin] [--solo-llave]',
    descripcion: 'Crea otra llave (fhn_test_…) del tenant de demostración (CAI ficticio, sin validez fiscal); por defecto, de caja en 000-001. Con --solo-llave imprime solo la llave en la salida estándar (el aviso va a la de errores).',
    posicionales: { obligatorios: [] },
    opciones: ['rol'],
    banderas: ['solo-llave'],
    usaBase: true,
  },
  {
    nombre: ['openapi'],
    uso: 'openapi [archivo]',
    descripcion: 'Imprime la especificación OpenAPI, o la escribe en el archivo indicado. No usa la base.',
    posicionales: { obligatorios: [], opcionales: ['archivo'] },
    usaBase: false,
  },
];

const AYUDA = new Set(['ayuda', '--ayuda', '--help', '-h', 'help']);

function ayudaGeneral(consola: string): string {
  return [
    'Consola del operador de la API de factura-hn.',
    '',
    `Uso: ${consola} <comando> [opciones]`,
    '',
    'Comandos:',
    ...COMANDOS.map((c) => `  ${c.uso}\n      ${c.descripcion}`),
    '  ayuda [comando]',
    '      Muestra esta ayuda o la de un comando (también --help).',
    '',
    'Conexión: FHN_MIGRAR_URL (dueño de las tablas) si está definida; si no, DATABASE_URL.',
    'Las llaves se muestran una sola vez, solo en esta terminal.',
  ].join('\n');
}

const ayudaDe = (c: Comando, consola: string) => `Uso: ${consola} ${c.uso}\n\n${c.descripcion}`;

class ErrorUso extends Error {
  constructor(mensaje: string, readonly comando?: Comando) {
    super(mensaje);
  }
}

function buscar(args: string[]): { comando: Comando; resto: string[] } | null {
  for (const c of COMANDOS) {
    if (c.nombre.every((p, i) => args[i] === p)) return { comando: c, resto: args.slice(c.nombre.length) };
  }
  return null;
}

function leerArgumentos(c: Comando, resto: string[]) {
  const posicionales: string[] = [];
  const opciones: Record<string, string> = {};
  const banderas = new Set<string>();
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i]!;
    if (a.startsWith('--')) {
      const nombre = a.slice(2);
      if (c.banderas?.includes(nombre)) banderas.add(nombre);
      else if (c.opciones?.includes(nombre)) {
        const valor = resto[i + 1];
        if (valor === undefined || valor.startsWith('--')) throw new ErrorUso(`Falta el valor de --${nombre}.`, c);
        opciones[nombre] = valor;
        i++;
      } else throw new ErrorUso(`Opción desconocida: ${a}.`, c);
    } else posicionales.push(a);
  }
  const { obligatorios, opcionales = [] } = c.posicionales;
  if (posicionales.length < obligatorios.length) throw new ErrorUso(`Falta <${obligatorios[posicionales.length]}>.`, c);
  if (posicionales.length > obligatorios.length + opcionales.length) throw new ErrorUso(`Sobra el argumento «${posicionales.at(-1)}».`, c);
  return { posicionales, opciones, banderas };
}

/** Ejecuta la consola y devuelve el código de salida (0 bien, 1 error). */
export async function ejecutarConsola(
  args: string[],
  o: { env?: NodeJS.ProcessEnv; salida?: SalidaConsola } = {},
): Promise<number> {
  const env = o.env ?? process.env;
  const salida = o.salida ?? { log: (t) => console.log(t), error: (t) => console.error(t) };
  const consola = consolaDe(env);

  if (args.length === 0) {
    salida.error(ayudaGeneral(consola));
    return 1;
  }
  if (AYUDA.has(args[0]!)) {
    const tema = args.slice(1);
    const c = tema.length ? buscar(tema)?.comando : undefined;
    if (tema.length && !c) {
      salida.error(`Error: no existe el comando «${tema.join(' ')}».\n\n${ayudaGeneral(consola)}`);
      return 1;
    }
    salida.log(c ? ayudaDe(c, consola) : ayudaGeneral(consola));
    return 0;
  }
  const encontrado = buscar(args);
  if (!encontrado) {
    salida.error(`Error: no existe el comando «${args.join(' ')}».\n\n${ayudaGeneral(consola)}`);
    return 1;
  }
  const { comando, resto } = encontrado;
  if (resto.some((a) => AYUDA.has(a))) {
    salida.log(ayudaDe(comando, consola));
    return 0;
  }

  let pool: pg.Pool | null = null;
  try {
    const { posicionales, opciones, banderas } = leerArgumentos(comando, resto);
    const clave = comando.nombre.join(' ');
    if (clave === 'openapi') {
      const app = crearApp({ pool: {} as pg.Pool, modo: 'alojado' });
      const doc = await (await app.request('/openapi.json')).text();
      if (posicionales[0]) writeFileSync(posicionales[0], `${JSON.stringify(JSON.parse(doc), null, 2)}\n`);
      else salida.log(doc);
      return 0;
    }

    // Validaciones que no necesitan la base, antes de conectarse.
    let limite: number | null = null;
    if (opciones.limite !== undefined) {
      if (!/^\d{1,9}$/.test(opciones.limite)) throw new ErrorUso('--limite debe ser un número entero de documentos por mes.', comando);
      limite = Number(opciones.limite);
    }
    if (opciones.modo !== undefined && opciones.modo !== 'produccion' && opciones.modo !== 'prueba') {
      throw new ErrorUso('--modo debe ser produccion o prueba.', comando);
    }
    if (clave === 'llave crear') {
      if (opciones.rol !== 'admin' && opciones.rol !== 'caja') throw new ErrorUso('--rol debe ser admin o caja.', comando);
      if (opciones.rol === 'caja' && !opciones.caja) throw new ErrorUso('Una llave de caja se ata a su punto de emisión: agrega --caja 000-001.', comando);
      if (opciones.caja && !/^\d{3}-\d{3}$/.test(opciones.caja)) throw new ErrorUso('--caja va como establecimiento-punto de emisión, p. ej. 000-001.', comando);
    }
    if (clave === 'demo llave' && opciones.rol !== undefined && opciones.rol !== 'admin' && opciones.rol !== 'caja') {
      throw new ErrorUso('--rol debe ser admin o caja.', comando);
    }

    // El modo local es de un solo negocio: otro tenant tendría webhooks sin el filtro de la red interna hasta el
    // próximo arranque, que se negaría a seguir. Los nombres reservados siguen al error de `crearTenant`.
    if (clave === 'tenant crear' && (env.FHN_MODO ?? 'local') !== 'alojado' && !TENANTS_RESERVADOS.includes(posicionales[0]!)) {
      throw new Error(errorTenantEnModoLocal(posicionales[0]!));
    }

    let url: string;
    try {
      url = urlDueno(env);
    } catch {
      throw new Error('Falta la conexión a la base: define FHN_MIGRAR_URL (dueño de las tablas) o DATABASE_URL.');
    }
    const rol = env.FHN_ROL ?? ROL_POR_DEFECTO;
    // El rol LOGIN solo se prepara con `migrar`: los demás comandos no dependen de cómo se llame el usuario de
    // DATABASE_URL (p. ej. «usuario@servidor» o con mayúsculas).
    const login = clave === 'migrar' && env.FHN_MIGRAR_URL && env.DATABASE_URL ? usuarioDeUrl(env.DATABASE_URL) : undefined;
    pool = crearPool(url, 2);
    await migrarApi(pool, rol, { login });

    switch (clave) {
      case 'migrar':
        salida.log('Esquema al día.');
        return 0;
      case 'tenant crear': {
        const r = await crearTenant(pool, {
          tenant: posicionales[0]!, nombre: opciones.nombre ?? posicionales[0]!, limiteMensual: limite,
          modo: opciones.modo as 'produccion' | 'prueba' | undefined,
        });
        const aviso = r.modo === 'prueba' ? ' Es de prueba: solo acepta CAI ficticios y nada de lo que emita tiene validez fiscal.' : '';
        salida.log(`Tenant ${r.tenant} creado (modo ${r.modo}).${aviso}\nLlave admin (solo se muestra ahora): ${r.llaveAdmin}`);
        return 0;
      }
      case 'llave crear': {
        const rolLlave = opciones.rol as 'admin' | 'caja';
        const caja = opciones.caja?.split('-');
        const llave = await crearLlaveOperador(pool, {
          tenant: posicionales[0]!, rol: rolLlave, nombre: opciones.nombre ?? rolLlave,
          establecimiento: caja?.[0], puntoEmision: caja?.[1],
        });
        salida.log(`Llave ${rolLlave} (solo se muestra ahora): ${llave}`);
        return 0;
      }
      case 'demo llave': {
        const rolLlave = (opciones.rol ?? 'caja') as 'admin' | 'caja';
        const llave = await crearLlaveDemo(pool, { rol: rolLlave });
        const bloque = bloqueLlavesDemo(rolLlave === 'caja' ? { caja: llave } : { admin: llave }, consola);
        if (banderas.has('solo-llave')) {
          const donde = rolLlave === 'caja' ? 'tenant «demo», caja 000-001' : 'tenant «demo»';
          salida.error(`Llave ${rolLlave} del demo (${donde}): CAI FICTICIO · ${LEYENDA_PRUEBA}. Se muestra solo esta vez.`);
          salida.log(llave);
        } else salida.log(bloque);
        return 0;
      }
    }
    throw new Error(`Comando sin implementar: ${clave}`);
  } catch (e) {
    if (e instanceof ErrorUso) {
      salida.error(`Error: ${e.message}${e.comando ? `\n\n${ayudaDe(e.comando, consola)}` : ''}`);
    } else {
      const codigo = (e as { code?: string }).code;
      const sinConexion = codigo === 'ECONNREFUSED' || codigo === 'ENOTFOUND' || codigo === 'ETIMEDOUT';
      salida.error(sinConexion
        ? `Error: no se pudo conectar a la base (${codigo}). Revisa FHN_MIGRAR_URL o DATABASE_URL y que Postgres esté en marcha.`
        : `Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}
