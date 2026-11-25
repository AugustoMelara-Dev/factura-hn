// Isla de /probar/: crea un entorno de prueba en la demostración pública con un clic y muestra la llave, la URL
// del MCP y los ejemplos. Es el único JavaScript propio del sitio.
//
// - La llave y la URL viven solo en la memoria de esta página: nunca en la URL ni en el almacenamiento del navegador.
// - POST {api}/v1/demo/entornos sin cuerpo, con CORS y sin credenciales, y un límite de 15 s.
// - Los errores de la API ({ error: { codigo, mensaje } }) se muestran tal cual; 429 y 503 traen Retry-After.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Theme } from '@astryxdesign/core/theme';
import esES from '@astryxdesign/core/locales/es-ES.generated.js';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

interface Entorno {
  entorno: {
    id: string;
    creado: string;
    expira: string;
    leyenda: string;
    establecimiento: string;
    puntoEmision: string;
    emisor: { rtn: string; razonSocial: string; nombreComercial?: string };
    limites: { documentos: number; solicitudesPorMinuto: number; solicitudesTotales: number };
  };
  llave: string;
  mcp: { url: string; prefijo: string } | null;
  api: { url: string };
  ejemplos: { curl: string; sdk: string; mcp: string };
  aviso: string;
}

type Estado =
  | { tipo: 'inicial' }
  | { tipo: 'creando' }
  | { tipo: 'listo'; datos: Entorno }
  | { tipo: 'limite'; mensaje: string; hasta: number }
  | { tipo: 'pausa'; mensaje: string; hasta: number }
  | { tipo: 'error'; titulo: string; detalle: string }
  | { tipo: 'sinRespuesta'; motivo: 'tiempo' | 'red' };

interface Props {
  /** URL base de la API de la demostración, sin barra final. */
  api: string;
  /** Base del sitio (`/factura-hn`), para los enlaces. */
  base: string;
}

const LIMITE_MS = 15_000;
const fecha = new Intl.DateTimeFormat('es-HN', { dateStyle: 'long', timeStyle: 'short' });

/** Retry-After en segundos o como fecha HTTP; entre 1 s y 24 h. */
function segundosDeEspera(valor: string | null, porDefecto: number): number {
  if (valor) {
    const n = Number(valor);
    const s = Number.isFinite(n) ? n : (Date.parse(valor) - Date.now()) / 1000;
    if (Number.isFinite(s)) return Math.min(Math.max(Math.ceil(s), 1), 86_400);
  }
  return porDefecto;
}

const reloj = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** El tema de la página (lo pone el selector de Starlight en <html data-theme>), para que Astryx lo siga. */
function useTemaDeLaPagina(): 'light' | 'dark' {
  const leer = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [tema, setTema] = useState(leer);
  useEffect(() => {
    const observador = new MutationObserver(() => setTema(leer()));
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observador.disconnect();
  }, []);
  return tema;
}

/** Segundos que faltan hasta `hasta` (0 si no hay espera), actualizados cada segundo. */
function useCuentaAtras(hasta: number | null): number {
  const calcular = () => (hasta ? Math.max(0, Math.ceil((hasta - Date.now()) / 1000)) : 0);
  const [faltan, setFaltan] = useState(calcular);
  useEffect(() => {
    setFaltan(calcular());
    if (!hasta) return;
    const id = setInterval(() => {
      const s = calcular();
      setFaltan(s);
      if (s === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [hasta]);
  return faltan;
}

async function crearEntorno(api: string): Promise<Estado> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), LIMITE_MS);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${api}/v1/demo/entornos`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
      signal: control.signal,
    });
  } catch {
    return { tipo: 'sinRespuesta', motivo: control.signal.aborted ? 'tiempo' : 'red' };
  } finally {
    clearTimeout(temporizador);
  }

  let cuerpo: unknown = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    // Un proxy o una página de error que no es JSON: se trata abajo como error sin detalle.
  }
  if (respuesta.status === 201 && cuerpo && typeof (cuerpo as Entorno).llave === 'string' && (cuerpo as Entorno).entorno) {
    return { tipo: 'listo', datos: cuerpo as Entorno };
  }
  const error = (cuerpo as { error?: { codigo?: string; mensaje?: string; solicitud?: string } } | null)?.error;
  const mensaje = error?.mensaje ?? '';
  if (respuesta.status === 429) {
    const espera = segundosDeEspera(respuesta.headers.get('retry-after'), 60);
    return { tipo: 'limite', mensaje: mensaje || 'Se alcanzó el límite de entornos de prueba.', hasta: Date.now() + espera * 1000 };
  }
  if (respuesta.status === 503 && error?.codigo === 'DEMO_PAUSADO') {
    const espera = segundosDeEspera(respuesta.headers.get('retry-after'), 600);
    return { tipo: 'pausa', mensaje, hasta: Date.now() + espera * 1000 };
  }
  if (error?.codigo) {
    const detalle = [`Código ${error.codigo}`, error.solicitud && `solicitud ${error.solicitud}`].filter(Boolean).join(' · ');
    return { tipo: 'error', titulo: mensaje || 'La demostración respondió con un error.', detalle };
  }
  return {
    tipo: 'error',
    titulo: 'La demostración respondió algo inesperado.',
    detalle: `Estado HTTP ${respuesta.status}. Vuelve a intentarlo en unos minutos.`,
  };
}

function Campo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="probar-campo">
      <h3>{titulo}</h3>
      {children}
    </div>
  );
}

function Resultado({ datos, onLimpiar }: { datos: Entorno; onLimpiar: () => void }) {
  const [ejemplo, setEjemplo] = useState<'curl' | 'sdk' | 'mcp'>('curl');
  const { entorno } = datos;
  const expira = useMemo(() => {
    const d = new Date(entorno.expira);
    return Number.isNaN(d.getTime()) ? entorno.expira : fecha.format(d);
  }, [entorno.expira]);
  const lenguaje = { curl: 'bash', sdk: 'ts', mcp: 'text' }[ejemplo];

  return (
    <div className="probar-resultado">
      <Banner
        status="success"
        title="Tu entorno de prueba está listo"
        description="Guarda la llave y la URL del MCP ahora: no se vuelven a mostrar. A las 24 horas el entorno se borra con sus documentos y su llave."
      />

      <Campo titulo="Tu llave de la API">
        <p>Para curl y el SDK, en la cabecera <code>Authorization: Bearer</code>. Es de este entorno de prueba y de nadie más.</p>
        <CodeBlock code={datos.llave} hasCopyButton isWrapped size="sm" />
      </Campo>

      <Campo titulo="Tu URL del MCP">
        {datos.mcp ? (
          <>
            <p>
              Pégala como conector personalizado en Claude o ChatGPT, sin autenticación. Es una credencial: quien la tenga usa
              tu entorno hasta que venza.
            </p>
            <CodeBlock code={datos.mcp.url} hasCopyButton isWrapped size="sm" />
          </>
        ) : (
          <p>Este servidor de la demostración no tiene MCP remoto. La llave sirve igual con curl y el SDK.</p>
        )}
      </Campo>

      <Campo titulo="Tu entorno">
        <dl className="probar-datos">
          <div>
            <dt>Emisor ficticio</dt>
            <dd>
              {entorno.emisor.razonSocial} · RTN <code>{entorno.emisor.rtn}</code>
            </dd>
          </div>
          <div>
            <dt>Punto de emisión</dt>
            <dd>
              <code>
                {entorno.establecimiento}-{entorno.puntoEmision}
              </code>
            </dd>
          </div>
          <div>
            <dt>Se borra</dt>
            <dd>{expira}</dd>
          </div>
          <div>
            <dt>Límites</dt>
            <dd>
              {entorno.limites.documentos} documentos · {entorno.limites.solicitudesPorMinuto} solicitudes por minuto
            </dd>
          </div>
        </dl>
        <p className="probar-leyenda">Todo lo que emitas lleva la leyenda «{entorno.leyenda}».</p>
      </Campo>

      <Campo titulo="Ejemplos para copiar">
        <TabList value={ejemplo} onChange={(v) => setEjemplo(v as typeof ejemplo)} size="sm" hasDivider>
          <Tab value="curl" label="curl" panelId="probar-ejemplo" />
          <Tab value="sdk" label="SDK" panelId="probar-ejemplo" />
          <Tab value="mcp" label="Conector MCP" panelId="probar-ejemplo" />
        </TabList>
        <div id="probar-ejemplo" role="tabpanel" className="probar-ejemplo">
          <CodeBlock code={datos.ejemplos[ejemplo]} language={lenguaje} hasCopyButton isWrapped={ejemplo === 'mcp'} size="sm" />
        </div>
      </Campo>

      {datos.aviso && <p className="probar-aviso">{datos.aviso}</p>}

      <div className="probar-limpiar">
        <Button label="Quitar de la pantalla" variant="ghost" onClick={onLimpiar} />
        <span>Borra la llave y la URL de esta página. El entorno sigue vigente hasta que venza.</span>
      </div>
    </div>
  );
}

function Contenido({ api, base }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });
  const hasta = estado.tipo === 'limite' || estado.tipo === 'pausa' ? estado.hasta : null;
  const faltan = useCuentaAtras(hasta);
  const esperando = faltan > 0;

  if (estado.tipo === 'listo') {
    return <Resultado datos={estado.datos} onLimpiar={() => setEstado({ tipo: 'inicial' })} />;
  }

  const crear = async () => {
    setEstado({ tipo: 'creando' });
    setEstado(await crearEntorno(api));
  };

  const enlaces = (
    <>
      Mientras tanto, prueba el SDK en el <a href={`${base}/empezar/playground/`}>playground</a> o{' '}
      <a href={`${base}/guias/autoalojar/`}>instala la API en tu equipo</a>.
    </>
  );

  return (
    <div className="probar-inicio">
      {estado.tipo === 'limite' && (
        <Banner
          status="warning"
          title={estado.mensaje}
          description={esperando ? `Puedes volver a intentarlo en ${reloj(faltan)}.` : 'Ya puedes volver a intentarlo.'}
        />
      )}
      {estado.tipo === 'pausa' && (
        <Banner
          status="info"
          title="La demostración está en pausa"
          description={
            <>
              {estado.mensaje || 'El servicio está en mantenimiento.'} {enlaces}
            </>
          }
        />
      )}
      {estado.tipo === 'error' && <Banner status="error" title={estado.titulo} description={estado.detalle} />}
      {estado.tipo === 'sinRespuesta' && (
        <Banner
          status="error"
          title="El entorno de prueba no responde"
          description={
            <>
              {estado.motivo === 'tiempo' ? 'No respondió en 15 segundos.' : 'No se pudo conectar con la demostración.'} {enlaces}
            </>
          }
        />
      )}

      <Button
        label={esperando ? `Espera ${reloj(faltan)}` : 'Crear mi entorno de prueba'}
        variant="primary"
        size="lg"
        isDisabled={esperando}
        isLoading={estado.tipo === 'creando'}
        clickAction={crear}
      />
      <p className="probar-nota">Sin cuenta. Es solo para pruebas: no pongas datos reales de clientes.</p>
    </div>
  );
}

export default function Probar(props: Props) {
  const tema = useTemaDeLaPagina();
  return (
    <InternationalizationProvider locale="es-ES" messages={{ 'es-ES': esES }}>
      <Theme theme={neutralTheme} mode={tema}>
        <Contenido {...props} />
      </Theme>
    </InternationalizationProvider>
  );
}
