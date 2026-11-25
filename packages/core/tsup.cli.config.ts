import { defineConfig } from 'tsup';

/**
 * El ejecutable `factura-hn` (dist/cli.js). Importa el núcleo ya compilado (`./index.js` y `./demo.js`, los mismos
 * módulos que usa quien instala el paquete) en lugar de llevar otra copia dentro: los imports relativos de
 * src/cli.ts se reescriben a esos archivos y quedan externos.
 */
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  dts: false,
  clean: false,
  esbuildPlugins: [
    {
      name: 'nucleo-compilado',
      setup(build) {
        build.onResolve({ filter: /^\.\// }, (args) => {
          if (!/[\\/]src[\\/]cli\.ts$/.test(args.importer)) return undefined;
          return { path: args.path === './demo' ? './demo.js' : './index.js', external: true };
        });
      },
    },
  ],
});
