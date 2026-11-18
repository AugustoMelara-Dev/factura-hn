import { defineConfig } from 'tsup';

// Un solo archivo por punto de entrada, con todas las dependencias: la imagen de Docker no necesita node_modules.
export default defineConfig({
  entry: ['src/servidor.ts', 'src/cli.ts'],
  format: ['cjs'],
  outDir: 'dist-docker',
  target: 'node22',
  platform: 'node',
  clean: true,
  splitting: false,
  dts: false,
  noExternal: [/.*/],
  external: ['pg-native'],
});
