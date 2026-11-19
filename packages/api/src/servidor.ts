/**
 * Arranque del servidor. Variables de entorno:
 * - DATABASE_URL (obligatoria)
 * - FHN_MODO: `local` (por defecto) o `alojado`
 * - PUERTO: por defecto 8787; FHN_HOST: por defecto 0.0.0.0
 * - FHN_ROL: rol de base de datos de la aplicación (por defecto fhn_app)
 * - FHN_CLAVE_CIFRADO: 32 bytes en base64 para cifrar los secretos de webhooks (obligatoria en `alojado`)
 * - FHN_DEMO=1: en modo local, carga datos de demostración con CAI ficticio
 */
import { serve } from '@hono/node-server';
import { crearApp } from './app';
import { migrarApi, ROL_POR_DEFECTO } from './esquema';
import { iniciarLocal } from './operador';
import { crearPool } from './pool';
import { CofreSecretos, despacharWebhooks } from './webhooks';

export async function arrancar(env: NodeJS.ProcessEnv = process.env): Promise<{ cerrar: () => Promise<void> }> {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  // Falla cerrado: un valor mal escrito no debe arrancar en modo local (webhooks a la red interna).
  const modoTexto = env.FHN_MODO ?? 'local';
  if (modoTexto !== 'local' && modoTexto !== 'alojado') throw new Error(`FHN_MODO debe ser "local" o "alojado" (no "${modoTexto}").`);
  const modo = modoTexto;
  const rol = env.FHN_ROL ?? ROL_POR_DEFECTO;
  if (modo === 'alojado' && !env.FHN_CLAVE_CIFRADO) throw new Error('El modo alojado requiere FHN_CLAVE_CIFRADO (32 bytes en base64).');
  const cofre = new CofreSecretos(env.FHN_CLAVE_CIFRADO);
  const pool = crearPool(url, Number(env.FHN_POOL ?? 20));

  await migrarApi(pool, rol);
  if (modo === 'local') {
    const r = await iniciarLocal(pool, { demo: env.FHN_DEMO === '1', rol });
    // Única vez que se muestran: no se guardan en claro en ningún lado. Bórralas del log después de copiarlas.
    if (r.llaveAdmin) {
      console.log('\n=== factura-hn: instalación nueva (tenant «local») ===');
      console.log(`Llave admin: ${r.llaveAdmin}`);
      console.log('Con ella registra el emisor (POST /v1/emisores) y el CAI de tu resolución (POST /v1/autorizaciones).');
    }
    if (r.demo) {
      console.log('\n=== Demostración (tenant «demo», CAI FICTICIO: sin validez fiscal) ===');
      console.log(`Llave admin demo: ${r.demo.llaveAdmin}`);
      console.log(`Llave caja demo 000-001: ${r.demo.llaveCaja}`);
    }
    if (r.llaveAdmin || r.demo) console.log('Guárdalas ahora: no se vuelven a mostrar.\n');
  }

  const app = crearApp({ pool, modo, rol, cofre });
  const puerto = Number(env.PUERTO ?? 8787);
  const servidor = serve({ fetch: app.fetch, port: puerto, hostname: env.FHN_HOST ?? '0.0.0.0' });
  console.log(`factura-hn API (${modo}) en http://localhost:${puerto} · documentación en /docs`);

  let ocupado = false;
  const intervalo = setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      await despacharWebhooks({ pool, rol, cofre, permitirRedInterna: modo === 'local' });
    } catch (e) {
      console.error('Despacho de webhooks', e);
    } finally {
      ocupado = false;
    }
  }, 5000);

  return {
    async cerrar() {
      clearInterval(intervalo);
      await new Promise<void>((r) => servidor.close(() => r()));
      await pool.end();
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
