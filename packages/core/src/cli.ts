#!/usr/bin/env node
/**
 * `npx factura-hn`: la primera factura de prueba en un minuto, sin CAI real ni base de datos.
 *
 *   npx factura-hn demo     emite una factura de prueba y escribe factura-demo.html
 *   npx factura-hn init     crea emitir.mjs y emisor.json en el directorio actual
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crearFacturadorDemo, LEYENDA_PRUEBA } from './demo';
import { esErrorValidacion } from './documento';
import { formatearMonto } from './dinero';
import { renderizarHTML, renderizarTexto } from './render';

const GUIA = 'https://github.com/AugustoMelara-Dev/factura-hn/blob/main/docs/guia-sdk.md';

function version(): string {
  try {
    const j = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return j.version ?? 'desconocida';
  } catch {
    return 'desconocida';
  }
}

const AYUDA = `factura-hn: facturación para Honduras (Acuerdo 481-2017). Proyecto independiente, no afiliado al SAR.

Uso: npx factura-hn <comando>

Comandos:
  demo              Emite al instante una factura de prueba (CAI ficticio, en memoria), imprime el
                    ticket y escribe factura-demo.html en este directorio (si ya existe,
                    factura-demo-2.html, y así: nunca sobrescribe).
  init, iniciar     Crea emitir.mjs (un ejemplo que emite y guarda factura.html) y emisor.json (datos
                    ficticios del negocio) en este directorio, sin preguntas. Si ya existen con otro
                    contenido, no toca nada; --forzar los reemplaza.
  ayuda, --help     Muestra esta ayuda.
  version           Muestra la versión.

Los documentos de prueba llevan la leyenda «${LEYENDA_PRUEBA}».
Guía: ${GUIA}
`;

const EMISOR_PLANTILLA = {
  _instrucciones:
    'Datos FICTICIOS de ejemplo. Antes de emitir de verdad, cámbialos por los de tu negocio tal como están en tu RTN ' +
    'y en tu contrato de adhesión (Reglamento Art. 10 num. 1). Las claves que empiezan con _ no se leen.',
  rtn: '99990000000001',
  razonSocial: 'Mi Negocio de Ejemplo S. de R.L.',
  nombreComercial: 'Mi Negocio',
  direccionCasaMatriz: 'Barrio El Centro, Ciudad Ejemplo',
  direccionEstablecimiento: 'Barrio El Centro, Ciudad Ejemplo',
  telefono: '0000-0001',
  correo: 'ventas@ejemplo.example',
};

const EMITIR_MJS = `// Emite una factura DE PRUEBA con factura-hn y la guarda en factura.html.
// Ejecuta: node emitir.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AlmacenFiscalMemoria, crearFacturador, formatearMonto, renderizarHTML, renderizarTexto } from 'factura-hn';
import { autorizacionDemo } from 'factura-hn/demo';

// 1. Los datos de tu negocio (Reglamento Art. 10 num. 1). Cámbialos en emisor.json; las claves con _ no se leen.
let datos;
try {
  datos = JSON.parse(readFileSync(new URL('./emisor.json', import.meta.url), 'utf8'));
} catch (e) {
  if (!(e instanceof SyntaxError)) throw e;
  console.error(\`emisor.json no es JSON válido (\${e.message}). Revisa las comillas dobles, las comas entre campos (sin coma después del último) y las llaves; o bórralo y vuelve a crearlo con: npx factura-hn init --forzar\`);
  process.exit(1);
}
const emisor = Object.fromEntries(Object.entries(datos).filter(([clave]) => !clave.startsWith('_')));

// 2. El almacén fiscal: reserva cada número y guarda los documentos. En memoria para probar: se pierde al terminar,
//    así que cada vez que corres este archivo la numeración empieza otra vez en 00000001. En producción,
//    AlmacenSQLite (@factura-hn/sqlite) o AlmacenPostgres (@factura-hn/postgres), que guardan la serie.
const facturador = crearFacturador({ almacen: new AlmacenFiscalMemoria(), emisor, establecimiento: '000', puntoEmision: '001' });

// 3. La autorización (CAI). Esta es FICTICIA y de prueba: cada documento sale con la leyenda
//    «${LEYENDA_PRUEBA}». En producción, registra una vez la de tu resolución del SAR.
await facturador.registrarAutorizacion(autorizacionDemo());

// 4. Una venta. Los montos van como texto, con punto decimal.
const factura = await facturador.emitir({
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
});

// No sobrescribe: si factura.html ya existe, usa factura-2.html, factura-3.html…
let archivo = 'factura.html';
for (let n = 2; existsSync(archivo); n++) archivo = \`factura-\${n}.html\`;
writeFileSync(archivo, renderizarHTML(factura));
console.log(renderizarTexto(factura));
console.log(\`\${factura.nombreDocumento} \${factura.numero} por L \${formatearMonto(factura.totales.total)}: abre \${archivo} en el navegador.\`);
console.log('El almacén es en memoria: cada vez que corres este archivo la numeración empieza otra vez en 00000001.');
`;

/** `base.html` en `dir`, o `base-2.html`, `base-3.html`… si ya existe: nunca sobrescribe. */
function rutaLibre(dir: string, base: string): string {
  let ruta = join(dir, `${base}.html`);
  for (let n = 2; existsSync(ruta); n++) ruta = join(dir, `${base}-${n}.html`);
  return ruta;
}

async function demo(dir: string): Promise<void> {
  const facturador = await crearFacturadorDemo();
  const factura = await facturador.emitir({
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' },
      { descripcion: 'Pan dulce', cantidad: '3', precioUnitario: '23.00' },
    ],
  });
  const ruta = rutaLibre(dir, 'factura-demo');
  writeFileSync(ruta, renderizarHTML(factura));
  console.log(renderizarTexto(factura));
  console.log(`Emitida la ${factura.nombreDocumento} de prueba ${factura.numero} por L ${formatearMonto(factura.totales.total)}.`);
  console.log(`Se escribió ${ruta}: ábrelo en el navegador para verla o imprimirla.`);
  console.log(`
Siguientes pasos:
  1. npm install factura-hn  instala el SDK en este proyecto (emitir.mjs lo importa)
  2. npx factura-hn init     crea emitir.mjs y emisor.json en este directorio
  3. node emitir.mjs         emite con tus datos (en emisor.json) y escribe factura.html
  4. Para emitir de verdad: registra el CAI de tu resolución del SAR y usa un almacén que guarde
     (@factura-hn/sqlite o @factura-hn/postgres). Guía: ${GUIA}`);
}

/**
 * Si `node emitir.mjs` encontrará `factura-hn` desde `dir`: un `import` de ESM lo busca en `node_modules` de la
 * carpeta y de las de arriba (no en NODE_PATH, como `require`).
 */
function instaladoEn(dir: string): boolean {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules', 'factura-hn', 'package.json'))) return true;
    if (dirname(d) === d) return false;
  }
}

/** El comando que instala factura-hn con el gestor de paquetes que ya usa el proyecto (npm si no hay otro). */
function comandoInstalar(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, 'pnpm-lock.yaml'))) return 'pnpm add factura-hn';
    if (existsSync(join(d, 'yarn.lock'))) return 'yarn add factura-hn';
    if (existsSync(join(d, 'bun.lock')) || existsSync(join(d, 'bun.lockb'))) return 'bun add factura-hn';
    if (existsSync(join(d, 'package-lock.json')) || dirname(d) === d) return 'npm install factura-hn';
  }
}

function init(dir: string, forzar: boolean): number {
  const archivos: Array<[string, string]> = [
    ['emitir.mjs', EMITIR_MJS],
    ['emisor.json', JSON.stringify(EMISOR_PLANTILLA, null, 2) + '\n'],
  ];
  // Un archivo igual al que se crearía no estorba: init se puede correr dos veces.
  const estado = archivos.map(([nombre, contenido]) => {
    const ruta = join(dir, nombre);
    if (!existsSync(ruta)) return 'nuevo';
    return readFileSync(ruta, 'utf8') === contenido ? 'igual' : 'distinto';
  });
  const conEstado = (e: string) => archivos.filter((_, i) => estado[i] === e).map(([nombre]) => nombre);
  const distintos = conEstado('distinto');
  if (distintos.length && !forzar) {
    const verbo = distintos.length > 1 ? 'existen' : 'existe';
    console.error(
      `Ya ${verbo} ${distintos.join(' y ')} en ${dir}, con otro contenido: no se tocó nada.\n` +
        '--forzar reemplaza emitir.mjs y emisor.json con el ejemplo: npx factura-hn init --forzar\n' +
        'O corre init en una carpeta vacía.',
    );
    return 1;
  }
  for (const [nombre, contenido] of archivos) writeFileSync(join(dir, nombre), contenido);
  const nuevos = conEstado('nuevo');
  const iguales = conEstado('igual');
  if (!nuevos.length && !distintos.length) {
    console.log(`Ya estaban emitir.mjs y emisor.json en ${dir} (sin cambios).`);
  } else {
    const hecho = [
      ...(nuevos.length ? [`creé ${nuevos.join(' y ')}`] : []),
      ...(distintos.length ? [`reemplacé ${distintos.join(' y ')} con el ejemplo`] : []),
    ].join(' y ');
    const sinCambios = iguales.length ? `; ${iguales.join(' y ')} ya estaba igual` : '';
    console.log(`Listo: ${hecho} en ${dir}${sinCambios} (modo de prueba, CAI ficticio).`);
  }
  if (instaladoEn(dir)) {
    console.log('Ahora corre: node emitir.mjs');
    console.log(`Para emitir de verdad, cambia emisor.json por los datos de tu negocio y registra tu CAI. Guía: ${GUIA}`);
  } else {
    // npx trae factura-hn solo para este comando: emitir.mjs lo importa, así que se instala en el proyecto.
    console.log(`Ahora corre: ${comandoInstalar(dir)}`);
    console.log('Y después:   node emitir.mjs');
  }
  return 0;
}

/** Versión mínima de Node (la de `engines` del paquete). */
const NODE_MINIMO = 20;

/** El mensaje para quien corre la CLI en un Node anterior al mínimo, o null. */
function problemaDeNode(version: string): string | null {
  const mayor = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (!(mayor < NODE_MINIMO)) return null;
  return `factura-hn necesita Node ${NODE_MINIMO} o más reciente, y tienes ${version}. Instala la versión LTS de https://nodejs.org y vuelve a correr el comando.`;
}

const COMANDOS = new Set(['demo', 'init', 'iniciar', 'ayuda', '--help', '-h', 'help', 'version', '--version', '-v']);

export async function principal(args: string[], dir = process.cwd()): Promise<number> {
  const node = problemaDeNode(process.versions.node);
  if (node) {
    console.error(node);
    return 1;
  }
  const [comando = 'ayuda', ...resto] = args;
  const opciones = new Set(resto);
  // Solo init acepta una opción (--forzar). Cualquier otra, o una errata, es un error: no se adivina.
  const validas = comando === 'init' || comando === 'iniciar' ? ['--forzar'] : [];
  const desconocida = resto.find((o) => !validas.includes(o));
  if (desconocida !== undefined && COMANDOS.has(comando)) {
    const pista = desconocida === '--force' ? ' ¿Quisiste decir --forzar?' : '';
    console.error(
      `Opción desconocida para ${comando}: «${desconocida}».${pista} ` +
        (validas.length ? `La única opción es ${validas.join(', ')}.` : 'Este comando no lleva opciones.') + '\n',
    );
    console.error(AYUDA);
    return 1;
  }
  switch (comando) {
    case 'demo':
      await demo(dir);
      return 0;
    case 'init':
    case 'iniciar':
      return init(dir, opciones.has('--forzar'));
    case 'ayuda':
    case '--help':
    case '-h':
    case 'help':
      console.log(AYUDA);
      return 0;
    case 'version':
    case '--version':
    case '-v':
      console.log(version());
      return 0;
    default:
      console.error(`Comando desconocido: «${comando}». Los comandos son demo, init (o iniciar), ayuda y version.\n`);
      console.error(AYUDA);
      return 1;
  }
}

principal(process.argv.slice(2)).then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (e: unknown) => {
    const codigo = (e as { code?: unknown } | null)?.code;
    if (esErrorValidacion(e)) console.error(e.message);
    else if (codigo === 'EACCES' || codigo === 'EPERM' || codigo === 'EROFS') {
      const ruta = (e as { path?: unknown }).path;
      console.error(
        `No se pudo escribir ${typeof ruta === 'string' ? ruta : 'en esta carpeta'}: no hay permiso. ` +
          'Corre el comando en una carpeta tuya (p. ej. una carpeta nueva en tu escritorio), o cierra el programa que tenga abierto el archivo.',
      );
    } else console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
