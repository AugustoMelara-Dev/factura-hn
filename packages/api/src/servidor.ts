/**
 * Arranque del servidor. Variables de entorno:
 * - DATABASE_URL (obligatoria): conexión con la que corre la API. Con FHN_MIGRAR_URL, un rol LOGIN que no es
 *   dueño de las tablas (la migración lo crea si no existe y le concede el rol de la aplicación).
 * - FHN_MIGRAR_URL: conexión del dueño de las tablas, solo para migrar y preparar el modo local al arrancar.
 *   Sin ella, la API usa DATABASE_URL también para eso y corre como dueño de las tablas (se avisa en el log).
 * - FHN_MODO: `local` (por defecto, con aviso en el log), `alojado` o `demo` (la demostración pública: solo entornos
 *   de prueba que crea cualquiera y que se borran a las 24 h; variables FHN_DEMO_*, ver docs/demo.md)
 * - FHN_IP_CLIENTE_CABECERA: cabecera con la dirección del cliente que pone el proxy de confianza (p. ej.
 *   Fly-Client-IP en Fly.io). Sin definir, ninguna se cree.
 * - PUERTO: por defecto 8787; FHN_HOST: por defecto 0.0.0.0
 * - FHN_ROL: rol de base de datos de la aplicación (por defecto fhn_app)
 * - FHN_CLAVE_CIFRADO: 32 bytes en base64 para cifrar los secretos de webhooks (obligatoria en `alojado`)
 * - FHN_RETENCION_DIAS: días que se guarda la respuesta completa de una clave de idempotencia y una entrega
 *   terminada (por defecto 30, mínimo efectivo 7)
 * - FHN_DEMO=1: en modo local, carga datos de demostración con CAI ficticio
 * - FHN_PROXIES_DE_CONFIANZA: proxies delante de la API (por defecto 0). Con 0, el límite de intentos fallidos
 *   usa la dirección del socket e ignora X-Forwarded-For. Con N, la N-ésima de X-Forwarded-For desde la
 *   derecha: solo si a la API se llega únicamente por esos proxies. Con una lista de direcciones separadas por
 *   comas, X-Forwarded-For se cree solo si la solicitud llega desde una de ellas.
 * - FHN_CONSOLA: cómo se invoca la consola en los mensajes (la imagen de Docker la define)
 */
import { serve } from '@hono/node-server';
import type pg from 'pg';
import { crearApp } from './app';
import { leerConfigDemo } from './demo';
import { leerCabeceraIpCliente, leerProxiesDeConfianza } from './errores';
import { exigirEsquemaApi, mantenimientoApi, migrarApi, RETENCION_POR_DEFECTO, ROL_POR_DEFECTO } from './esquema';
import {
  bloqueLlavesDemo,
  comandoLlaveAdminLocal,
  comandoLlaveDemo,
  consolaDe,
  datosRealesEnBase,
  errorDatosRealesEnDemo,
  errorTenantsAjenos,
  purgarEntornosDemo,
  iniciarLocal,
  tenantsAjenosAlModoLocal,
} from './operador';
import { crearPool, esperarBase, usuarioDeUrl, usuarioDeUrlSiHay } from './pool';
import { CofreSecretos, despacharWebhooks } from './webhooks';

const UNA_HORA = 3_600_000;

/**
 * Por qué la conexión es demasiado poderosa para la API: `[usuario, ...motivos]`, o `[]` si no lo es. Recorre
 * el rol de la conexión y **todos** los roles de los que es miembro (aun con NOINHERIT, puede pasar a ellos con
 * `SET ROLE`): ninguno puede ser superusuario, tener BYPASSRLS, ser `pg_write_all_data` o `pg_read_all_data`,
 * ni ser dueño de una tabla `fhn_*` o `api_*` del esquema.
 */
export async function privilegiosDeConexion(pool: pg.Pool): Promise<string[]> {
  const f = (await pool.query<{ usuario: string; superusuario: boolean; bypassrls: boolean; todos_los_datos: boolean; dueno: boolean }>(
    `SELECT current_user AS usuario,
            coalesce(bool_or(m.rolsuper), false) AS superusuario,
            coalesce(bool_or(m.rolbypassrls), false) AS bypassrls,
            coalesce(bool_or(m.rolname IN ('pg_write_all_data', 'pg_read_all_data')), false) AS todos_los_datos,
            EXISTS (SELECT 1 FROM pg_class c
                     WHERE c.relnamespace = current_schema()::regnamespace
                       AND (c.relname LIKE 'fhn\\_%' OR c.relname LIKE 'api\\_%')
                       AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS dueno
       FROM pg_roles m WHERE pg_has_role(current_user, m.oid, 'MEMBER')`,
  )).rows[0]!;
  const motivos = [
    ...(f.superusuario ? ['es superusuario o miembro de un rol superusuario'] : []),
    ...(f.bypassrls ? ['tiene BYPASSRLS o es miembro de un rol con BYPASSRLS'] : []),
    ...(f.todos_los_datos ? ['es miembro de pg_write_all_data o pg_read_all_data'] : []),
    ...(f.dueno ? ['es dueño de las tablas o miembro del dueño'] : []),
  ];
  return motivos.length ? [f.usuario, ...motivos] : [];
}

export interface ServidorEnMarcha {
  cerrar: () => Promise<void>;
  /** La app de Hono, sobre el pool de la API (para pruebas). */
  app: ReturnType<typeof crearApp>;
}

export async function arrancar(env: NodeJS.ProcessEnv = process.env): Promise<ServidorEnMarcha> {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  // Falla cerrado: un valor mal escrito no debe arrancar en modo local (webhooks a la red interna).
  const modoTexto = env.FHN_MODO ?? 'local';
  if (modoTexto !== 'local' && modoTexto !== 'alojado' && modoTexto !== 'demo') {
    throw new Error(`FHN_MODO debe ser "local", "alojado" o "demo" (no "${modoTexto}").`);
  }
  const modo = modoTexto;
  // La demostración pública: la base debe ser solo suya y los límites por dirección deben ver la del cliente.
  const configDemo = modo === 'demo' ? leerConfigDemo(env) : undefined;
  if (modo === 'demo') {
    if (env.FHN_DEMO === '1') throw new Error('FHN_DEMO=1 es la demostración del modo local; con FHN_MODO=demo no se usa. Quítala.');
    if (env.FHN_PROXIES_DE_CONFIANZA === undefined && env.FHN_IP_CLIENTE_CABECERA === undefined) {
      throw new Error(
        'FHN_MODO=demo necesita saber la dirección de cada visitante para sus límites: define FHN_PROXIES_DE_CONFIANZA ' +
          '(0 si los clientes llegan directo) o FHN_IP_CLIENTE_CABECERA (p. ej. Fly-Client-IP en Fly.io). Ver docs/demo.md.',
      );
    }
  }
  const cabeceraIpCliente = leerCabeceraIpCliente(env.FHN_IP_CLIENTE_CABECERA);
  const rol = env.FHN_ROL ?? ROL_POR_DEFECTO;
  if (modo === 'alojado' && !env.FHN_CLAVE_CIFRADO) throw new Error('El modo alojado requiere FHN_CLAVE_CIFRADO (32 bytes en base64).');
  const retencionTexto = env.FHN_RETENCION_DIAS ?? String(RETENCION_POR_DEFECTO);
  if (!/^\d{1,5}$/.test(retencionTexto)) throw new Error(`FHN_RETENCION_DIAS debe ser un número entero de días (no "${retencionTexto}").`);
  const retencion = Number(retencionTexto);
  const proxiesDeConfianza = leerProxiesDeConfianza(env.FHN_PROXIES_DE_CONFIANZA);
  const consola = consolaDe(env);
  const cofre = new CofreSecretos(env.FHN_CLAVE_CIFRADO);
  const urlMigrar = env.FHN_MIGRAR_URL || null;
  const login = urlMigrar ? usuarioDeUrl(url) : undefined;
  if (urlMigrar && login === usuarioDeUrlSiHay(urlMigrar)) {
    throw new Error(
      `DATABASE_URL y FHN_MIGRAR_URL usan el mismo usuario («${login}»): la API correría como dueño de las tablas. ` +
        'Pon en DATABASE_URL el rol LOGIN propio de la API (p. ej. fhn_api) y deja el dueño solo en FHN_MIGRAR_URL, ' +
        'o, para seguir como antes, deja FHN_MIGRAR_URL vacía (en Compose, FHN_MIGRAR_URL: "" en docker-compose.override.yml).',
    );
  }

  if (env.FHN_MODO === undefined) {
    console.warn(
      'AVISO: FHN_MODO no está definida; la API corre en modo local: un solo negocio, webhooks que pueden llegar a la red interna ' +
        'y sin bóveda de secretos. Un servicio con varios negocios debe usar FHN_MODO=alojado.',
    );
  }
  if (modo === 'alojado' && env.FHN_PROXIES_DE_CONFIANZA === undefined) {
    console.warn(
      'AVISO: modo alojado sin FHN_PROXIES_DE_CONFIANZA. Si la API está detrás de un proxy o balanceador, todas las ' +
        'solicitudes cuentan como una sola dirección para el límite de intentos. Define cuántos proxies hay o sus direcciones ' +
        '(0 si los clientes llegan directo).',
    );
  }
  if (!urlMigrar) {
    console.warn(
      'AVISO: sin FHN_MIGRAR_URL la API corre como dueño de las tablas (DATABASE_URL). Define FHN_MIGRAR_URL con el dueño y ' +
        'DATABASE_URL con un rol LOGIN propio de la API.',
    );
  }

  // Migración y preparación con el dueño de las tablas. Con FHN_MIGRAR_URL, un pool corto que se cierra antes
  // de atender solicitudes: la API no conserva ninguna conexión con permisos de dueño.
  const poolDueno = crearPool(urlMigrar ?? url, urlMigrar ? 2 : Number(env.FHN_POOL ?? 20));
  let pool: pg.Pool | null = urlMigrar ? null : poolDueno;
  let demo: { llaveAdmin: string; llaveCaja: string } | undefined;
  let localSinLlaveAdmin = false;
  let hayDemo = false;
  try {
    await esperarBase(poolDueno);
    await migrarApi(poolDueno, rol, { login });
    if (modo === 'demo') {
      const reales = await datosRealesEnBase(poolDueno);
      if (reales.length) throw new Error(errorDatosRealesEnDemo(reales));
    }
    if (modo === 'local') {
      const ajenos = await tenantsAjenosAlModoLocal(poolDueno);
      if (ajenos.length) throw new Error(errorTenantsAjenos(ajenos));
      const r = await iniciarLocal(poolDueno, { demo: env.FHN_DEMO === '1', rol });
      localSinLlaveAdmin = r.localSinLlaveAdmin;
      hayDemo = r.hayDemo;
      demo = r.demo;
    }
  } catch (e) {
    if (!urlMigrar) await poolDueno.end().catch(() => undefined);
    throw e;
  } finally {
    if (urlMigrar) await poolDueno.end().catch(() => undefined);
  }
  if (!pool) {
    const nuevo = crearPool(url, Number(env.FHN_POOL ?? 20));
    try {
      await esperarBase(nuevo);
      // Con FHN_MIGRAR_URL, la API no arranca con una conexión que salte RLS o tenga permisos de dueño: sería
      // un despliegue que cree estar protegido y no lo está.
      const p = await privilegiosDeConexion(nuevo);
      if (p.length) {
        throw new Error(
          `DATABASE_URL se conecta como «${p[0]}», que ${p.slice(1).join(', ')}. Con FHN_MIGRAR_URL, DATABASE_URL debe ser un ` +
            'rol LOGIN propio de la API, que no sea ni pueda volverse superusuario, BYPASSRLS ni dueño de las tablas (p. ej. ' +
            'postgres://fhn_api:<contraseña>@host/base; ver la nota de actualización de docs/autoalojamiento.md), ' +
            'o, para seguir como antes, deja FHN_MIGRAR_URL vacía (en Compose, FHN_MIGRAR_URL: "" en docker-compose.override.yml).',
        );
      }
    } catch (e) {
      await nuevo.end().catch(() => undefined);
      throw e;
    }
    pool = nuevo;
  }
  const poolApi = pool;
  try {
    await exigirEsquemaApi(poolApi, rol, consola);
  } catch (e) {
    await poolApi.end().catch(() => undefined);
    throw e;
  }

  if (localSinLlaveAdmin) {
    // La llave del negocio no pasa por este log: la consola la imprime solo en la terminal de quien la crea.
    console.log(`factura-hn: el tenant «local» no tiene llave admin. Créala en tu terminal con: ${comandoLlaveAdminLocal(consola)}`);
  }
  if (demo) console.log(bloqueLlavesDemo({ caja: demo.llaveCaja, admin: demo.llaveAdmin }, consola));
  else if (hayDemo) {
    console.log(`factura-hn: demostración activa (tenant «demo», CAI ficticio, sin validez fiscal). Otra llave de caja: ${comandoLlaveDemo(consola)}`);
  }

  const mantener = () =>
    mantenimientoApi(poolApi, rol, retencion).catch((e) => console.error('Mantenimiento de retención', e));
  await mantener();

  const app = crearApp({ pool: poolApi, modo, rol, cofre, consola, proxiesDeConfianza, cabeceraIpCliente, hayDemo, soloTenantsLocales: modo === 'local', demo: configDemo });
  const puerto = Number(env.PUERTO ?? 8787);
  const servidor = serve({ fetch: app.fetch, port: puerto, hostname: env.FHN_HOST ?? '0.0.0.0' });
  console.log(`factura-hn API (${modo}) en http://localhost:${puerto} · documentación en /docs`);

  // Cada 5 s, sin esperar a la pasada anterior: los tenants que siguen entregando se omiten (enCurso), así que
  // un receptor lento solo retrasa los avisos de su propio tenant.
  const enCurso = new Set<string>();
  // En modo demo no hay webhooks (la ruta se niega): no hay nada que despachar.
  const intervalo = modo === 'demo' ? undefined : setInterval(() => {
    despacharWebhooks({ pool: poolApi, rol, cofre, permitirRedInterna: modo === 'local', enCurso }).catch((e) => console.error('Despacho de webhooks', e));
  }, 5000);
  const intervaloMantenimiento = setInterval(() => void mantener(), UNA_HORA);
  // Modo demo: cada minuto se borran los entornos vencidos con todos sus datos. La consola tiene el mismo paso
  // («demo limpiar») para una tarea programada aparte.
  let purgando = false;
  const purgar = async () => {
    if (purgando) return;
    purgando = true;
    try {
      const n = await purgarEntornosDemo(poolApi, { rol });
      if (n) console.log(`factura-hn demo: ${n} entorno${n === 1 ? '' : 's'} vencido${n === 1 ? '' : 's'} borrado${n === 1 ? '' : 's'}.`);
    } catch (e) {
      console.error('Limpieza de entornos de demostración', e);
    } finally {
      purgando = false;
    }
  };
  if (modo === 'demo') await purgar();
  const intervaloDemo = modo === 'demo' ? setInterval(() => void purgar(), 60_000) : undefined;

  return {
    app,
    async cerrar() {
      clearInterval(intervalo);
      clearInterval(intervaloMantenimiento);
      clearInterval(intervaloDemo);
      await new Promise<void>((r) => servidor.close(() => r()));
      await poolApi.end();
    },
  };
}

const esPrincipal = process.argv[1] && /servidor\.(c?js|ts)$/.test(process.argv[1]);
if (esPrincipal) {
  arrancar().then(
    (s) => {
      for (const senal of ['SIGINT', 'SIGTERM'] as const) process.once(senal, () => void s.cerrar().then(() => process.exit(0)));
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
