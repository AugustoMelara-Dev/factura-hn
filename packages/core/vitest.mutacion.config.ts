import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

// Pruebas que corre Stryker (pnpm mutacion). Quedan fuera las que no prueban el comportamiento del núcleo y
// no funcionan en la copia aislada de Stryker (sandbox) o sobre el código instrumentado:
// - readme.test.ts: compila los fragmentos de la documentación con tsc (40 s por corrida);
// - lote2-cli.test.ts: lanza el CLI desde dist/ en un proceso aparte;
// - sin-flotante.test.ts, lote2-errores.test.ts: leen el texto de src/ o de docs/ del repositorio.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [
        '**/node_modules/**',
        'test/readme.test.ts',
        'test/lote2-cli.test.ts',
        'test/sin-flotante.test.ts',
        'test/lote2-errores.test.ts',
      ],
    },
  }),
);
