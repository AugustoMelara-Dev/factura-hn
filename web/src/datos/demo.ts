// La URL de la API de la demostración pública, que la página /probar/ llama desde el navegador. Sale de
// PUBLIC_FHN_DEMO_API al construir (ver sitio.config.mjs, la única fuente). Sin ella, el sitio dice que la
// demostración aún no está en línea y lleva al playground.
import { API_DEMO as api, MARCADOR_API } from '../../sitio.config.mjs';
import type { Enlace } from './navegacion';

export { MARCADOR_API };
export const API_DEMO: string | null = api;

/** El botón principal de prueba: la demostración si está en línea; si no, el playground, que corre en el navegador. */
export const PRUEBA: Enlace = API_DEMO
  ? { texto: 'Pruébalo ahora', ruta: '/probar/' }
  : { texto: 'Pruébalo en el navegador', ruta: '/empezar/playground/' };
