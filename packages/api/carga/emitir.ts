/**
 * Medición de carga de la emisión: `pnpm carga [ci|local|nocturno]` (perfiles en carga/perfiles.json).
 *
 * 1. Arranca la API en otro proceso (carga/servidor.ts) contra FHN_PG_URL y crea un tenant nuevo con varias
 *    cajas, varias llaves por caja y un webhook hacia un receptor local.
 * 2. Emite con autocannon durante `duracionS` con `conexiones` en paralelo, repartidas entre las llaves. Una parte
 *    (`repetidas`) reusa claves de un grupo chico por caja: la misma Idempotency-Key llega a la vez por varias
 *    conexiones. Además, `rafagas` ráfagas de 8 solicitudes simultáneas con la misma clave.
 * 3. Informa la latencia (p50, p95, p99) y el rendimiento, y revisa contra la base: sin correlativos repetidos
 *    ni faltantes en ninguna serie, una clave por documento, y cada clave con un solo número en todas sus
 *    respuestas. Espera a que los avisos de webhook se entreguen todos.
 * 4. Guarda el resultado en carga/resultados/ y termina con código 1 si algo no cumple los umbrales.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import pg from 'pg';
import { crearTenant } from '../src/operador';
import { problemasDeIntegridad, revisarIntegridad } from './integridad';

interface Perfil {
  duracionS: number;
  conexiones: number;
  cajas: number;
  llavesPorCaja: number;
  repetidas: number;
  rafagas: number;
  /** Solicitudes por segundo de la fase a tasa fija (la de la latencia). */
  tasa: number;
  /** 1: un webhook suscrito a documento.emitido, hacia un receptor local (cada emisión encola un aviso). 0: sin webhook. */
  webhook: number;
  umbrales: { p50Ms: number; p95Ms: number; p99Ms: number; minDocumentosPorS: number; maxErrores: number };
}

const DIR = fileURLToPath(new URL('.', import.meta.url));
const nombrePerfil = process.argv[2] ?? 'local';
const perfiles = JSON.parse(readFileSync(`${DIR}perfiles.json`, 'utf8')) as Record<string, Perfil>;
const base = perfiles[nombrePerfil];
if (!base || nombrePerfil.startsWith('$')) throw new Error(`Perfil desconocido: ${nombrePerfil}. Usa ci, local o nocturno.`);
// Ajustes del perfil por línea de órdenes, p. ej. `pnpm carga local cajas=16 conexiones=64` (solo los numéricos).
const perfil: Perfil = { ...base };
for (const arg of process.argv.slice(3)) {
  const [k, v] = arg.split('=');
  if (!k || v === undefined || !(k in perfil) || k === 'umbrales' || !Number.isFinite(Number(v))) throw new Error(`Ajuste no válido: ${arg}`);
  (perfil as unknown as Record<string, number>)[k] = Number(v);
}
const URL_PG = process.env.FHN_PG_URL;
if (!URL_PG) throw new Error('Define FHN_PG_URL (p. ej. postgres://postgres@127.0.0.1:54329/factura_hn_pruebas).');

const percentil = (ordenados: number[], p: number) => ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)] ?? NaN;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VENTA = JSON.stringify({ documento: { lineas: [{ descripcion: 'Martillo', cantidad: 2, precioUnitario: '115.00' }, { descripcion: 'Clavos', cantidad: 1, precioUnitario: '35.50' }] } });

// --- 1. La API en otro proceso ------------------------------------------------------------------------------
const tsx = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
// FHN_CARGA_PERFILAR=1 deja un perfil de CPU de la API en carga/resultados/ (se abre con las DevTools de Chrome).
const perfilar = process.env.FHN_CARGA_PERFILAR ? { NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${DIR}resultados` } : {};
const api = spawn(process.execPath, [tsx, `${DIR}servidor.ts`], {
  env: { ...process.env, ...perfilar, DATABASE_URL: URL_PG, PUERTO: '0', FHN_POOL: process.env.FHN_POOL ?? '20' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const puerto = await new Promise<number>((resolver, rechazar) => {
  let salida = '';
  api.stdout.on('data', (d) => {
    salida += d;
    const m = /LISTO (\d+)/.exec(salida);
    if (m) resolver(Number(m[1]));
  });
  api.once('exit', (c) => rechazar(new Error(`La API terminó al arrancar (código ${c}).`)));
});
const BASE = `http://127.0.0.1:${puerto}`;
const dueno = new pg.Pool({ connectionString: URL_PG, max: 2 });

const recibidos = new Set<string>();
const receptor = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    recibidos.add(String(req.headers['x-facturahn-entrega']));
    res.end('ok');
  });
});
await new Promise<void>((r) => receptor.listen(0, '127.0.0.1', r));

let codigoSalida = 0;
try {
  // --- Tenant, cajas y llaves -------------------------------------------------------------------------------
  const tenant = `carga-${Date.now().toString(36)}`;
  const { llaveAdmin } = await crearTenant(dueno, { tenant, nombre: tenant });
  const pedir = async (llave: string, metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}) => {
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { authorization: `Bearer ${llave}`, 'content-type': 'application/json', ...cabeceras },
      body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });
    return { estado: r.status, cuerpo: (await r.json().catch(() => ({}))) as Record<string, any>, replay: r.headers.get('idempotency-replayed') === 'true' };
  };
  const exigir = async (p: ReturnType<typeof pedir>, estado: number) => {
    const r = await p;
    if (r.estado !== estado) throw new Error(`Preparación: ${r.estado} ${JSON.stringify(r.cuerpo)}`);
    return r.cuerpo;
  };
  await exigir(pedir(llaveAdmin, 'POST', '/v1/emisores', {
    rtn: '99990000000001', razonSocial: 'Ferretería Ejemplo S. de R.L.', nombreComercial: 'Ferretería Ejemplo',
    direccionCasaMatriz: 'Tegucigalpa, M.D.C.', direccionEstablecimiento: 'Tegucigalpa, M.D.C.', telefono: '0000-0003', correo: 'carga@ejemplo.example',
  }), 201);
  if (perfil.webhook) await exigir(pedir(llaveAdmin, 'POST', '/v1/webhooks', { url: `http://127.0.0.1:${(receptor.address() as { port: number }).port}/hook`, eventos: ['documento.emitido'] }), 201);
  const limite = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
  const cajas = Array.from({ length: perfil.cajas }, (_, i) => String(i + 1).padStart(3, '0'));
  const llaves: { caja: string; llave: string }[] = [];
  for (const [i, caja] of cajas.entries()) {
    const hex = (i + 1).toString(16).toUpperCase().padStart(6, '0');
    await exigir(pedir(llaveAdmin, 'POST', '/v1/autorizaciones', {
      cai: `C4C4C4-${hex}-C4C4C4-${hex}-C4C4C4-${Date.now().toString(16).slice(-2).toUpperCase()}`,
      tipoDocumento: '01', establecimiento: '000', puntoEmision: caja, rangoInicial: 1, rangoFinal: 99_999_999, fechaLimiteEmision: limite,
    }), 201);
    for (let k = 0; k < perfil.llavesPorCaja; k++) {
      llaves.push({ caja, llave: (await exigir(pedir(llaveAdmin, 'POST', '/v1/llaves', { nombre: `caja ${caja}-${k}`, rol: 'caja', establecimiento: '000', puntoEmision: caja }), 201)).secreto });
    }
  }

  // Lo que vio el cliente: los números de cada clave (deben ser uno solo por clave).
  const numerosPorClave = new Map<string, Set<string>>();
  const anotar = (clave: string, numero: string | undefined) => {
    if (!numero) return;
    const s = numerosPorClave.get(clave) ?? new Set();
    s.add(numero);
    numerosPorClave.set(clave, s);
  };
  const estados = new Map<number, number>();
  let repeticiones = 0;

  // Cada llave se valida una vez, de a 4 a la vez (las `consultasSimultaneas` de la API): son llaves que el proceso
  // nunca vio y llegan todas desde la misma dirección. Con 32 a la vez, el límite de intentos por dirección
  // respondería 429 DEMASIADOS_INTENTOS a las que pasan de la ráfaga, aunque sean válidas (es la protección contra
  // fuerza bruta: ver «Límites» en docs/api.md). Ya validadas, no pasan por ese límite.
  const porValidar = [...llaves];
  await Promise.all(Array.from({ length: Math.min(4, porValidar.length) }, async () => {
    for (let l = porValidar.shift(); l; l = porValidar.shift()) await exigir(pedir(l.llave, 'GET', '/v1/sesion'), 200);
  }));

  // Calentamiento: unas emisiones por caja (abre conexiones, compila consultas). No se mide.
  await Promise.all(llaves.map(async ({ llave }, i) => {
    for (let k = 0; k < 5; k++) {
      const clave = `calentar-${i}-${k}`;
      anotar(clave, (await exigir(pedir(llave, 'POST', '/v1/documentos', VENTA, { 'idempotency-key': clave }), 201)).documento?.numero);
    }
  }));

  // --- 2. Carga con autocannon, en dos fases -------------------------------------------------------------
  // a) A tasa fija (`tasa` solicitudes por segundo, por debajo de la saturación): la latencia de una emisión
  //    sin cola. Es un generador de lazo abierto (una solicitud cada 1000/tasa ms, sin esperar las anteriores):
  //    el `overallRate` de autocannon manda las de cada segundo de golpe y mide su propia cola.
  //    Con la API saturada, la latencia solo dice cuántas conexiones esperan (ley de Little).
  // b) Saturación: autocannon con todas las conexiones emitiendo sin pausa; da el rendimiento máximo.
  const repetibles = (caja: string) => Array.from({ length: 10 }, (_, i) => `rep-${caja}-${i}`);
  let siguienteLlave = 0;
  let erroresDeRed = 0;
  let agotadas = 0;
  type Ctx = { llave?: { caja: string; llave: string }; clave?: string };
  console.log(
    `Carga «${nombrePerfil}»: ${perfil.cajas} cajas × ${perfil.llavesPorCaja} llaves, ${perfil.repetidas * 100} % de claves repetidas, ` +
      `${perfil.rafagas} ráfagas; ${perfil.duracionS} s a ${perfil.tasa}/s y ${perfil.duracionS} s con ${perfil.conexiones} conexiones sin pausa.`,
  );
  const claveNueva = (caja: string) =>
    Math.random() < perfil.repetidas ? repetibles(caja)[Math.floor(Math.random() * 10)]! : `${caja}-${crypto.randomUUID()}`;
  /** Lazo abierto a `tasa` por segundo durante `duracionS`. Devuelve los tiempos y la duración real. */
  const lazoAbierto = async (tasa: number, tiempos: number[]) => {
    const inicio = performance.now();
    const enVuelo: Promise<void>[] = [];
    for (let i = 0; performance.now() - inicio < perfil.duracionS * 1000; i++) {
      const espera = inicio + (i * 1000) / tasa - performance.now();
      if (espera > 0) await esperar(espera);
      const { caja, llave } = llaves[i % llaves.length]!;
      const clave = claveNueva(caja);
      enVuelo.push((async () => {
        const t = performance.now();
        try {
          const r = await pedir(llave, 'POST', '/v1/documentos', VENTA, { 'idempotency-key': clave });
          tiempos.push(performance.now() - t);
          estados.set(r.estado, (estados.get(r.estado) ?? 0) + 1);
          anotar(clave, r.cuerpo.documento?.numero);
          if (r.replay) repeticiones++;
        } catch {
          erroresDeRed++;
        }
      })());
    }
    await Promise.all(enVuelo);
    return { duration: (performance.now() - inicio) / 1000, requests: { average: tiempos.length / ((performance.now() - inicio) / 1000) }, errors: 0, timeouts: 0 };
  };
  const fase = async (tasa: number | null) => {
    const tiempos: number[] = [];
    const docsAntes = (await revisarIntegridad(dueno, tenant)).documentos;
    // Las ráfagas van solo en la fase de saturación: en la fase fija sumarían solicitudes a la tasa medida.
    if (tasa) return resumen(tiempos, await lazoAbierto(tasa, tiempos), docsAntes);
    let terminar!: (r: autocannon.Result) => void;
    let fallar!: (e: unknown) => void;
    const terminada = new Promise<autocannon.Result>((r, f) => ((terminar = r), (fallar = f)));
    const instancia = autocannon({
      url: BASE,
      connections: perfil.conexiones,
      duration: perfil.duracionS,
      requests: [
        {
          method: 'POST',
          path: '/v1/documentos',
          setupRequest: (req: any, ctx: Ctx) => {
            ctx.llave ??= llaves[siguienteLlave++ % llaves.length]!;
            const clave = claveNueva(ctx.llave.caja);
            ctx.clave = clave;
            return { ...req, headers: { authorization: `Bearer ${ctx.llave.llave}`, 'content-type': 'application/json', 'idempotency-key': clave }, body: VENTA };
          },
          onResponse: (estado: number, cuerpo: string, ctx: Ctx, cabeceras: Record<string, string>) => {
            estados.set(estado, (estados.get(estado) ?? 0) + 1);
            if (estado === 201) {
              anotar(ctx.clave!, (JSON.parse(cuerpo) as { documento: { numero: string } }).documento.numero);
              if (cabeceras['idempotency-replayed'] === 'true') repeticiones++;
            }
          },
        } as any,
      ],
    }, (e, r) => (e ? fallar(e) : terminar(r)));
    instancia.on('response', (_c: unknown, _estado: number, _bytes: number, ms: number) => tiempos.push(ms));
    const rafagas = rafagasDe('max');
    const resultado = await terminada;
    await rafagas;
    erroresDeRed += resultado.errors;
    agotadas += resultado.timeouts;
    return resumen(tiempos, resultado, docsAntes);
  };
  /** Ráfagas: 8 solicitudes simultáneas con la misma clave, repartidas durante la fase. */
  const rafagasDe = async (fase: number | string) => {
    for (let i = 0; i < perfil.rafagas; i++) {
      await esperar((perfil.duracionS * 1000 * 0.8) / perfil.rafagas);
      const { llave } = llaves[i % llaves.length]!;
      const clave = `rafaga-${fase}-${i}`;
      const rs = await Promise.all(
        Array.from({ length: 8 }, () => pedir(llave, 'POST', '/v1/documentos', VENTA, { 'idempotency-key': clave }).catch(() => null)),
      );
      for (const r of rs) {
        if (!r) {
          erroresDeRed++;
          continue;
        }
        estados.set(r.estado, (estados.get(r.estado) ?? 0) + 1);
        anotar(clave, r.cuerpo.documento?.numero);
        if (r.replay) repeticiones++;
      }
    }
  };
  const resumen = async (tiempos: number[], r: { duration: number; requests: { average: number } }, docsAntes: number) => {
    tiempos.sort((a, b) => a - b);
    const redondear = (v: number) => Math.round(v * 10) / 10;
    return {
      solicitudes: tiempos.length,
      solicitudesPorS: Math.round(r.requests.average),
      documentosPorS: Math.round(((await revisarIntegridad(dueno, tenant)).documentos - docsAntes) / r.duration),
      latenciaMs: { p50: redondear(percentil(tiempos, 50)), p95: redondear(percentil(tiempos, 95)), p99: redondear(percentil(tiempos, 99)), max: redondear(tiempos.at(-1) ?? NaN) },
    };
  };
  const noCreadas = () => [...estados].filter(([e]) => e !== 201).reduce((a, [, n]) => a + n, 0);
  const aTasa = await fase(perfil.tasa);
  // Lo que falló a tasa fija se exige aparte: ahí no hay cola y cualquier error es un error.
  const noCreadasATasa = noCreadas();
  const sinRespuestaATasa = erroresDeRed;
  const erroresATasa = noCreadasATasa + sinRespuestaATasa;
  const saturada = await fase(null);
  // En saturación se toleran los tiempos agotados y los errores de red (en un runner de 4 vCPU que comparten la
  // API, autocannon, PostgreSQL y el receptor, una solicitud puede esperar más de 10 s en la cola) mientras la
  // integridad se cumpla; una respuesta que no es 201 sigue siendo un error.
  const noCreadasSaturada = noCreadas() - noCreadasATasa;
  const sinRespuestaSaturada = erroresDeRed + agotadas - sinRespuestaATasa;

  // --- 3. Revisión contra la base --------------------------------------------------------------------------
  const integridad = await revisarIntegridad(dueno, tenant);
  const clavesConVariosNumeros = [...numerosPorClave].filter(([, s]) => s.size > 1);
  // Lo que vio el cliente coincide con lo que guarda la base para cada clave.
  const enBase = new Map(
    (await dueno.query<{ clave: string; numero: string }>(
      "SELECT clave, coalesce(respuesta->'documento'->>'numero', respuesta->>'numero') AS numero FROM api_idempotencia WHERE tenant = $1",
      [tenant],
    )).rows.map((f) => [f.clave, f.numero]),
  );
  const clavesQueNoCoinciden = [...numerosPorClave].filter(([k, s]) => s.size !== 1 || enBase.get(k) !== [...s][0]).map(([k]) => k);

  // Los avisos de webhook: uno por documento, todos entregados (el despacho corre cada 5 s).
  const filasEntregas = async () => (await dueno.query<{ estado: string; n: number }>(
    "SELECT estado, count(*)::int AS n FROM api_entregas WHERE tenant = $1 AND evento = 'documento.emitido' GROUP BY estado", [tenant],
  )).rows;
  const inicioEntregas = Date.now();
  let entregas = await filasEntregas();
  while (perfil.webhook && entregas.some((f) => f.estado !== 'ENTREGADA') && Date.now() < inicioEntregas + 120_000) {
    await esperar(500);
    entregas = await filasEntregas();
  }
  const entregadas = entregas.find((f) => f.estado === 'ENTREGADA')?.n ?? 0;
  const totalEntregas = entregas.reduce((a, f) => a + f.n, 0);

  const informe = {
    perfil: nombrePerfil,
    fecha: new Date().toISOString(),
    equipo: { plataforma: process.platform, node: process.version, cpus: (await import('node:os')).cpus().length },
    configuracion: perfil,
    aTasa,
    saturada,
    documentos: integridad.documentos,
    estados: Object.fromEntries(estados),
    erroresDeRed,
    tiemposAgotados: agotadas,
    erroresATasa,
    noCreadasEnSaturacion: noCreadasSaturada,
    sinRespuestaEnSaturacion: sinRespuestaSaturada,
    repeticionesConLaMismaClave: repeticiones,
    clavesConVariosNumeros: clavesConVariosNumeros.length,
    series: integridad.series.length,
    duplicados: integridad.duplicados.length,
    huecos: integridad.huecos.length,
    problemasDeIntegridad: problemasDeIntegridad(integridad),
    webhooks: { entregadas, total: totalEntregas, segundosParaVaciarDespuesDeLaCarga: Math.round((Date.now() - inicioEntregas) / 1000) },
  };
  const u = perfil.umbrales;
  const fallas = [
    ...informe.problemasDeIntegridad,
    ...(clavesConVariosNumeros.length ? [`${clavesConVariosNumeros.length} clave(s) recibieron más de un número`] : []),
    ...clavesQueNoCoinciden.slice(0, 10).map((k) => `la clave ${k} dio al cliente otro número que el que guarda la base`),
    // Al vencer el tiempo de cada fase, autocannon descarta las respuestas en vuelo (a lo sumo una por conexión):
    // esas emisiones existen (con su clave, revisado arriba) pero el cliente no vio su número.
    // Una solicitud agotada en saturación también pudo emitir sin que el cliente viera el número.
    ...(integridad.documentos < numerosPorClave.size || integridad.documentos > numerosPorClave.size + 2 * perfil.conexiones + sinRespuestaSaturada
      ? [`${integridad.documentos} documentos para ${numerosPorClave.size} claves vistas por el cliente`]
      : []),
    ...(erroresATasa > u.maxErrores ? [`${erroresATasa} respuestas no 201 o errores de red a ${perfil.tasa}/s (máximo ${u.maxErrores})`] : []),
    ...(noCreadasSaturada > u.maxErrores ? [`${noCreadasSaturada} respuestas no 201 en saturación (máximo ${u.maxErrores})`] : []),
    ...(aTasa.latenciaMs.p50 > u.p50Ms ? [`p50 a ${perfil.tasa}/s: ${aTasa.latenciaMs.p50} ms > ${u.p50Ms} ms`] : []),
    ...(aTasa.latenciaMs.p95 > u.p95Ms ? [`p95 a ${perfil.tasa}/s: ${aTasa.latenciaMs.p95} ms > ${u.p95Ms} ms`] : []),
    ...(aTasa.latenciaMs.p99 > u.p99Ms ? [`p99 a ${perfil.tasa}/s: ${aTasa.latenciaMs.p99} ms > ${u.p99Ms} ms`] : []),
    ...(saturada.documentosPorS < u.minDocumentosPorS ? [`${saturada.documentosPorS} documentos/s en saturación < ${u.minDocumentosPorS}`] : []),
    ...(perfil.webhook && (entregadas !== integridad.documentos || totalEntregas !== integridad.documentos)
      ? [`webhooks: ${entregadas} entregadas de ${totalEntregas} encoladas para ${integridad.documentos} documentos`]
      : []),
    ...(perfil.webhook && recibidos.size !== integridad.documentos ? [`el receptor vio ${recibidos.size} avisos distintos para ${integridad.documentos} documentos`] : []),
  ];
  mkdirSync(`${DIR}resultados`, { recursive: true });
  const archivo = `${DIR}resultados/${nombrePerfil}-${informe.fecha.replace(/[:.]/g, '-')}.json`;
  writeFileSync(archivo, `${JSON.stringify({ ...informe, fallas }, null, 2)}\n`);

  const lat = (l: typeof aTasa.latenciaMs) => `p50 ${l.p50} · p95 ${l.p95} · p99 ${l.p99} · máx ${l.max}`;
  console.log(`
A ${perfil.tasa}/s:       ${lat(aTasa.latenciaMs)} ms · ${aTasa.documentosPorS} documentos/s
Saturada:       ${lat(saturada.latenciaMs)} ms · ${saturada.solicitudesPorS} solicitudes/s · ${saturada.documentosPorS} documentos/s
Documentos:     ${informe.documentos} en ${informe.series} series
Respuestas:     ${JSON.stringify(informe.estados)} · errores de red ${erroresDeRed} · agotadas ${agotadas} (a tasa fija ${erroresATasa}; en saturación ${noCreadasSaturada} no 201 y ${sinRespuestaSaturada} sin respuesta, estas toleradas)
Idempotencia:   ${repeticiones} repeticiones con la misma clave · ${clavesConVariosNumeros.length} claves con más de un número
Numeración:     ${informe.duplicados} duplicados · ${informe.huecos} series con huecos
Webhooks:       ${entregadas} de ${totalEntregas} entregados (${informe.webhooks.segundosParaVaciarDespuesDeLaCarga} s después de la carga) · el receptor vio ${recibidos.size}
Resultado:      ${archivo}`);
  // En GitHub Actions, el resumen también va a la página de la ejecución.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Carga «${nombrePerfil}» (${perfil.cajas} cajas, ${perfil.conexiones} conexiones, 2 × ${perfil.duracionS} s)`,
      '',
      '| Medida | Valor | Umbral |',
      '|---|---|---|',
      `| p50 a ${perfil.tasa}/s | ${aTasa.latenciaMs.p50} ms | ≤ ${u.p50Ms} ms |`,
      `| p95 a ${perfil.tasa}/s | ${aTasa.latenciaMs.p95} ms | ≤ ${u.p95Ms} ms |`,
      `| p99 a ${perfil.tasa}/s | ${aTasa.latenciaMs.p99} ms | ≤ ${u.p99Ms} ms |`,
      `| Documentos por segundo en saturación | ${saturada.documentosPorS} | ≥ ${u.minDocumentosPorS} |`,
      `| p50 / p95 / p99 en saturación | ${saturada.latenciaMs.p50} / ${saturada.latenciaMs.p95} / ${saturada.latenciaMs.p99} ms | |`,
      `| Documentos emitidos | ${informe.documentos} | |`,
      `| Respuestas que no son 201 y errores de red a tasa fija | ${erroresATasa} | ≤ ${u.maxErrores} |`,
      `| Respuestas que no son 201 en saturación | ${noCreadasSaturada} | ≤ ${u.maxErrores} |`,
      `| Tiempos agotados y errores de red en saturación | ${sinRespuestaSaturada} | tolerados si la integridad se cumple |`,
      `| Correlativos repetidos / series con huecos | ${informe.duplicados} / ${informe.huecos} | 0 / 0 |`,
      `| Claves con más de un número | ${clavesConVariosNumeros.length} | 0 |`,
      `| Avisos de webhook entregados | ${entregadas} de ${totalEntregas} | todos |`,
      '',
      fallas.length ? `**No cumple:** ${fallas.join('; ')}` : 'Cumple los umbrales.',
      '',
    ].join('\n'));
  }
  if (fallas.length) {
    console.error(`\nNO CUMPLE:\n- ${fallas.join('\n- ')}`);
    codigoSalida = 1;
  } else console.log('\nCumple los umbrales del perfil.');
} catch (e) {
  console.error(e);
  codigoSalida = 1;
} finally {
  api.stdin.end();
  receptor.close();
  await dueno.end();
  await new Promise((r) => api.once('exit', r).once('error', r));
}
process.exit(codigoSalida);
