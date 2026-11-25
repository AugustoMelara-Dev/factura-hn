// La URL de la API de la demostración pública, que la página /probar/ llama desde el navegador. Sale de
// PUBLIC_FHN_DEMO_API al construir (en GitHub Pages, de la variable del repositorio FHN_DEMO_API). Sin ella, o con
// el marcador, la página dice que la demo en línea aún no está publicada y no carga JavaScript.

/** Marcador para los ejemplos cuando la demo no está publicada. */
export const MARCADOR_API = 'https://API_DE_LA_DEMO';

/** HTTPS, o HTTP solo en el propio equipo (para probar la página con una API local). */
export function urlDemoValida(valor: string | undefined): string | null {
  const crudo = (valor ?? '').trim();
  if (!crudo || crudo === MARCADOR_API) return null;
  try {
    const url = new URL(crudo);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.search || url.hash || url.username || url.password) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export const API_DEMO = urlDemoValida(import.meta.env.PUBLIC_FHN_DEMO_API);
