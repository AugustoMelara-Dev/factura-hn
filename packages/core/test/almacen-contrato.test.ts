import { describe, it } from 'vitest';
import { AlmacenFiscalMemoria } from '../src';
import { ejecutarContratoAlmacen } from '../src/pruebas';

ejecutarContratoAlmacen({ describe, it }, {
  nombre: 'memoria',
  crear: async () => new AlmacenFiscalMemoria(),
  // Una instancia en memoria se comparte entre «cajas» del mismo proceso.
  otraConexion: async (a) => a,
});
