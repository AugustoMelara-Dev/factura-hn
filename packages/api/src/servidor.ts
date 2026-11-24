/**
 * Arranque del servidor. Variables de entorno:
 * - DATABASE_URL (obligatoria): conexión con la que corre la API. Con FHN_MIGRAR_URL, un rol LOGIN que no es
 *   dueño de las tablas (la migración lo crea si no existe y le concede el rol de la aplicación).
 * - FHN_MIGRAR_URL: conexión del dueño de las tablas, solo para migrar y preparar el modo local al arrancar.
 *   Sin ella, la API usa DATABASE_URL también para eso y corre como dueño de las tablas (se avisa en el log).
 * - FHN_MODO: `local` (por defecto, con aviso en el log) o `alojado`
 * - PUERTO: por defecto 8787; FHN_HOST: por defecto 0.0.0.0
 * - FHN_ROL: rol de base de datos de la aplicación (por defecto fhn_app)
 * - FHN_CLAVE_CIFRADO: 32 bytes en base64 para cifrar los secretos de webhooks (obligatoria en `alojado`)
 * - FHN_RETENCION_DIAS: días que se guarda la respuesta completa de una clave de idempotencia y una entrega
 *   terminada (por defecto 30, mínimo efectivo 7)
 * - FHN_DEMO=1: en modo local, carga datos de demostración con CAI ficticio
 */
import { serve } from '@hono/node-server';
import type pg from 'pg';
import { crearApp } from './app';
import { mantenimientoApi, migrarApi, RETENCION_POR_DEFECTO, ROL_POR_DEFECTO } from './esquema';
import { COMANDO_LLAVE_ADMIN_LOCAL, iniciarLocal, tenantsAjenosAlModoLocal } from './operador';
import { crearPool, esperarBase, usuarioDeUrl } from './pool';
import { CofreSecretos, despacharWebhooks } from './webhooks';

const UNA_HORA = 3_600_000;

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
  if (modoTexto !== 'local' && modoTexto !== 'alojado') throw new Error(`FHN_MODO debe ser "local" o "alojado" (no "${modoTexto}").`);
  const modo = modoTexto;
  const rol = env.FHN_ROL ?? ROL_POR_DEFECTO;
  if (modo === 'alojado' && !env.FHN_CLAVE_CIFRADO) throw new Error('El modo alojado requiere FHN_CLAVE_CIFRADO (32 bytes en base64).');
  const retencionTexto = env.FHN_RETENCION_DIAS ?? String(RETENCION_POR_DEFECTO);
  if (!/^\d{1,5}$/.test(retencionTexto)) throw new Error(`FHN_RETENCION_DIAS debe ser un número entero de días (no "${retencionTexto}").`);
  const retencion = Number(retencionTexto);
  const cofre = new CofreSecretos(env.FHN_CLAVE_CIFRADO);
  const urlMigrar = env.FHN_MIGRAR_URL || null;
  const login = urlMigrar ? usuarioDeUrl(url) : undefined;

  if (env.FHN_MODO === undefined) {
    console.warn(
      'AVISO: FHN_MODO no está definida; la API corre en modo local: un solo negocio, webhooks que pueden llegar a la red interna ' +
        'y sin bóveda de secretos. Un servicio con varios negocios debe usar FHN_MODO=alojado.',
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
  try {
    await esperarBase(poolDueno);
    await migrarApi(poolDueno, rol, { login });
    if (modo === 'local') {
      const ajenos = await tenantsAjenosAlModoLocal(poolDueno);
      if (ajenos.length) {
        throw new Error(
          `La base tiene tenants de otros negocios (${ajenos.join(', ')}…): el modo local es para un solo negocio. ` +
            'Arranca con FHN_MODO=alojado (y FHN_CLAVE_CIFRADO).',
        );
      }
      const r = await iniciarLocal(poolDueno, { demo: env.FHN_DEMO === '1', rol });
      localSinLlaveAdmin = r.localSinLlaveAdmin;
      demo = r.demo;
    }
  } catch (e) {
    if (!urlMigrar) await poolDueno.end().catch(() => undefined);
    throw e;
  } finally {
    if (urlMigrar) await poolDueno.end().catch(() => undefined);
  }
  if (!pool) {
    pool = crearPool(url, Number(env.FHN_POOL ?? 20));
    await esperarBase(pool);
  }
  const poolApi = pool;

  if (localSinLlaveAdmin) {
    // La llave del negocio no pasa por este log: la consola la imprime solo en la terminal de quien la crea.
    console.log(`factura-hn: el tenant «local» no tiene llave admin. Créala en tu terminal con: ${COMANDO_LLAVE_ADMIN_LOCAL}`);
  }
  if (demo) {
    console.log('\n=== Demostración (tenant «demo», CAI FICTICIO: sin validez fiscal) ===');
    console.log('Estas llaves son de una demostración sin validez fiscal: no sirven para el negocio.');
    console.log(`Llave admin demo: ${demo.llaveAdmin}`);
    console.log(`Llave caja demo 000-001: ${demo.llaveCaja}`);
    console.log('Solo se muestran ahora.\n');
  }

  const mantener = () =>
    mantenimientoApi(poolApi, rol, retencion).catch((e) => console.error('Mantenimiento de retención', e));
  await mantener();

  const app = crearApp({ pool: poolApi, modo, rol, cofre });
  const puerto = Number(env.PUERTO ?? 8787);
  const servidor = serve({ fetch: app.fetch, port: puerto, hostname: env.FHN_HOST ?? '0.0.0.0' });
  console.log(`factura-hn API (${modo}) en http://localhost:${puerto} · documentación en /docs`);

  // Cada 5 s, sin esperar a la pasada anterior: los tenants que siguen entregando se omiten (enCurso), así que
  // un receptor lento solo retrasa los avisos de su propio tenant.
  const enCurso = new Set<string>();
  const intervalo = setInterval(() => {
    despacharWebhooks({ pool: poolApi, rol, cofre, permitirRedInterna: modo === 'local', enCurso }).catch((e) => console.error('Despacho de webhooks', e));
  }, 5000);
  const intervaloMantenimiento = setInterval(() => void mantener(), UNA_HORA);

  return {
    app,
    async cerrar() {
      clearInterval(intervalo);
      clearInterval(intervaloMantenimiento);
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
