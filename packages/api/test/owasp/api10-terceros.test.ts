/**
 * OWASP API10:2023 · Unsafe Consumption of APIs.
 *
 * Cómo aplica: la API consume dos cosas de terceros. (1) Las respuestas de los receptores de webhooks: de ellas solo
 * usa el código de estado; no lee el cuerpo, no sigue redirecciones (API7) y corta toda la entrega a los 10 s. (2) La
 * Swagger UI de `/docs`, que viene de un CDN: versión exacta, Subresource Integrity y CSP.
 *
 * Ataque, con receptores locales: un cuerpo enorme, un cuerpo y cabeceras con contenido malicioso, una conexión que
 * se corta a media respuesta y códigos de estado raros. Nada de eso debe entrar a la base ni a las respuestas de la
 * API más allá del código de estado.
 */
import http from 'node:http';
import type net from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { CABECERAS_DOCS, HTML_DOCS } from '../../src/docs';
import { CofreSecretos, despacharWebhooks } from '../../src/webhooks';
import { cerrarPool, poolPrueba, ROL, tenantListo, venta } from '../ayuda';
import { conBase, emitir, json } from './comun';

afterAll(cerrarPool);

type Manejador = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/** Monta un receptor local, registra el webhook, emite, despacha y devuelve la entrega como la ve la API. */
async function entregarA(manejador: Manejador, tiempoMaximo = 3000) {
  const srv = http.createServer(manejador);
  const sockets = new Set<net.Socket>();
  srv.on('connection', (s) => sockets.add(s));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const t = await tenantListo();
    const puerto = (srv.address() as net.AddressInfo).port;
    const w = (await json(await t.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${puerto}/hook`, eventos: ['documento.emitido'] }))).webhook;
    await emitir(t.admin, venta());
    const inicio = Date.now();
    await despacharWebhooks({ pool: await poolPrueba(), rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna: true, soloTenants: [t.tenant], tiempoMaximo });
    const ms = Date.now() - inicio;
    const texto = await (await t.admin('GET', `/v1/webhooks/${w.id}/entregas`)).text();
    return { ms, texto, entrega: JSON.parse(texto).entregas[0] };
  } finally {
    for (const s of sockets) s.destroy();
    srv.close();
  }
}

conBase('API10 · consumo de APIs de terceros (receptores de webhooks)', () => {
  it('un receptor que responde 200 con un cuerpo sin fin: la entrega termina en el acto y no lee el cuerpo', async () => {
    let escritos = 0;
    const { ms, entrega } = await entregarA((req, res) => {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      const bloque = Buffer.alloc(1024 * 1024, 0x41);
      const escribir = () => {
        while (escritos < 200 * 1024 * 1024 && res.write(bloque)) escritos += bloque.length;
      };
      res.on('drain', escribir);
      escribir();
    }, 30_000);
    expect(entrega).toMatchObject({ estado: 'ENTREGADA', ultimoCodigo: 200, ultimoError: null });
    // Con 30 s de tiempo máximo, terminar muy antes prueba que no esperó el cuerpo (holgura para una CI lenta).
    expect(ms).toBeLessThan(20_000);
    // Se cortó la conexión mucho antes de los 200 MB.
    expect(escritos).toBeLessThan(200 * 1024 * 1024);
  });

  it('el cuerpo y las cabeceras de un receptor malicioso no llegan a la base ni a la API: solo el código', async () => {
    const veneno = '<script>alert(1)</script>\'; DROP TABLE api_entregas; -- {{7*7}} ${process.env}';
    const { texto, entrega } = await entregarA((req, res) => {
      req.resume();
      res.writeHead(500, { 'x-inyectada': 'veneno-en-cabecera', 'set-cookie': 'sesion=robada', location: 'https://atacante.example' });
      res.end(veneno.repeat(1000));
    });
    expect(entrega).toMatchObject({ estado: 'PENDIENTE', ultimoCodigo: 500, ultimoError: 'HTTP 500' });
    for (const s of ['script', 'DROP', 'veneno', 'robada', 'atacante']) expect(texto).not.toContain(s);
  });

  it('una conexión cortada a media respuesta y un código fuera de lo normal: error genérico, sin detalles de la red', async () => {
    const cortada = await entregarA((req) => {
      req.resume();
      req.socket.end('HTTP/1.1 200 OK\r\nContent-Le');
    });
    expect(cortada.entrega.estado).toBe('PENDIENTE');
    expect(cortada.entrega.ultimoError).toBe('Error de red');
    expect(cortada.texto).not.toMatch(/ECONN|127\.0\.0\.1|socket/i);

    const raro = await entregarA((req, res) => {
      req.resume();
      res.writeHead(299).end();
    });
    // 2xx es entregado; el código se guarda tal cual, como número.
    expect(raro.entrega).toMatchObject({ estado: 'ENTREGADA', ultimoCodigo: 299 });
  });
});

describe('API10 · recursos de terceros en /docs', () => {
  it('cada recurso externo de /docs lleva versión exacta, integridad SHA-256 y crossorigin, y la CSP solo permite esos archivos', () => {
    const externos = [...HTML_DOCS.matchAll(/<(script|link)\b[^>]*(?:src|href)="(https?:[^"]+)"[^>]*>/g)];
    expect(externos).toHaveLength(2);
    for (const [etiqueta, , url] of externos) {
      expect(url, url).toMatch(/swagger-ui-dist@\d+\.\d+\.\d+\//); // sin rangos ni «latest»
      expect(etiqueta, url).toMatch(/integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/);
      expect(etiqueta, url).toContain('crossorigin="anonymous"');
    }
    const csp = CABECERAS_DOCS['Content-Security-Policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*(\*|'unsafe-inline'|'unsafe-eval'|https:(?!\/\/))/);
    // La propia /docs no llama a terceros: «Try it out» va al mismo origen y no hay validador externo.
    expect(csp).toContain("connect-src 'self'");
    expect(HTML_DOCS).toContain('validatorUrl: null');
  });
});
