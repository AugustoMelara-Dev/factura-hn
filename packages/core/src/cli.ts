#!/usr/bin/env node
/**
 * `npx factura-hn`: la primera factura de prueba en un minuto, sin CAI real ni base de datos.
 *
 *   npx factura-hn demo     emite una factura de prueba y escribe factura-demo.html
 *   npx factura-hn init     crea emitir.mjs y emisor.json en el directorio actual
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
                    ticket y escribe factura-demo.html en este directorio.
  init, iniciar     Crea emitir.mjs (un ejemplo que emite y guarda factura.html) y emisor.json (datos
                    ficticios del negocio) en este directorio. No sobrescribe nada salvo con --forzar.
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
import { readFileSync, writeFileSync } from 'node:fs';
import { AlmacenFiscalMemoria, crearFacturador, formatearMonto, renderizarHTML, renderizarTexto } from 'factura-hn';
import { autorizacionDemo } from 'factura-hn/demo';

// 1. Los datos de tu negocio (Reglamento Art. 10 num. 1). Cámbialos en emisor.json; las claves con _ no se leen.
const datos = JSON.parse(readFileSync(new URL('./emisor.json', import.meta.url), 'utf8'));
const emisor = Object.fromEntries(Object.entries(datos).filter(([clave]) => !clave.startsWith('_')));

// 2. El almacén fiscal: reserva cada número y guarda los documentos. En memoria para probar;
//    en producción, AlmacenSQLite (@factura-hn/sqlite) o AlmacenPostgres (@factura-hn/postgres).
const facturador = crearFacturador({ almacen: new AlmacenFiscalMemoria(), emisor, establecimiento: '000', puntoEmision: '001' });

// 3. La autorización (CAI). Esta es FICTICIA y de prueba: cada documento sale con la leyenda
//    «${LEYENDA_PRUEBA}». En producción, registra una vez la de tu resolución del SAR.
await facturador.registrarAutorizacion(autorizacionDemo());

// 4. Una venta. Los montos van como texto, con punto decimal.
const factura = await facturador.emitir({
  preciosIncluyenISV: true,
  lineas: [{ descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' }],
});

writeFileSync('factura.html', renderizarHTML(factura));
console.log(renderizarTexto(factura));
console.log(\`\${factura.nombreDocumento} \${factura.numero} por L \${formatearMonto(factura.totales.total)}: abre factura.html en el navegador.\`);
`;

async function demo(dir: string): Promise<void> {
  const facturador = await crearFacturadorDemo();
  const factura = await facturador.emitir({
    preciosIncluyenISV: true,
    lineas: [
      { descripcion: 'Café molido 1 lb', cantidad: '2', precioUnitario: '115.00' },
      { descripcion: 'Pan dulce', cantidad: '3', precioUnitario: '23.00' },
    ],
  });
  const ruta = join(dir, 'factura-demo.html');
  writeFileSync(ruta, renderizarHTML(factura));
  console.log(renderizarTexto(factura));
  console.log(`Emitida la ${factura.nombreDocumento} de prueba ${factura.numero} por L ${formatearMonto(factura.totales.total)}.`);
  console.log(`Se escribió ${ruta}: ábrelo en el navegador para verla o imprimirla.`);
  console.log(`
Siguientes pasos:
  1. npx factura-hn init     crea emitir.mjs y emisor.json en este directorio
  2. node emitir.mjs         emite con tus datos (en emisor.json) y escribe factura.html
  3. Para emitir de verdad: registra el CAI de tu resolución del SAR y usa un almacén que guarde
     (@factura-hn/sqlite o @factura-hn/postgres). Guía: ${GUIA}`);
}

function init(dir: string, forzar: boolean): number {
  const archivos: Array<[string, string]> = [
    ['emitir.mjs', EMITIR_MJS],
    ['emisor.json', JSON.stringify(EMISOR_PLANTILLA, null, 2) + '\n'],
  ];
  const existentes = archivos.filter(([nombre]) => existsSync(join(dir, nombre))).map(([nombre]) => nombre);
  if (existentes.length && !forzar) {
    console.error(`Ya existe ${existentes.join(' y ')} en ${dir}: no se tocó nada. Para reemplazarlos, usa: npx factura-hn init --forzar`);
    return 1;
  }
  for (const [nombre, contenido] of archivos) writeFileSync(join(dir, nombre), contenido);
  console.log(`Se crearon emitir.mjs y emisor.json en ${dir}.

Siguientes pasos:
  1. npm install factura-hn          si aún no está instalado en este directorio
  2. node emitir.mjs                 emite una factura de prueba y escribe factura.html
  3. Cambia emisor.json por los datos de tu negocio. Para emitir de verdad, registra el CAI de tu
     resolución del SAR y usa un almacén que guarde. Guía: ${GUIA}`);
  return 0;
}

export async function principal(args: string[], dir = process.cwd()): Promise<number> {
  const [comando = 'ayuda', ...resto] = args;
  const opciones = new Set(resto);
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
    if (esErrorValidacion(e)) console.error(e.message);
    else console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  },
);
