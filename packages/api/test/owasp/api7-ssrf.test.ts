/**
 * OWASP API7:2023 · Server Side Request Forgery.
 *
 * Cómo aplica: la URL de un webhook la elige el cliente y el servidor le hace POST. En modo alojado solo se permite
 * https hacia direcciones públicas: se valida al registrar (`problemaDeURL`), otra vez antes de cada entrega, y al
 * conectar (`lookupSeguro`, que resuelve el nombre, rechaza si alguna dirección es interna y conecta a la dirección
 * validada). No se siguen redirecciones. En modo local se permite la red del negocio.
 *
 * Ataque, solo con receptores locales: formas alternativas de escribir una dirección interna; un nombre con punto
 * final; un nombre que resuelve a la red interna; una URL guardada en modo local que se entrega en modo alojado; una
 * redirección hacia otro receptor.
 *
 * Hallazgo corregido: `https://localhost./`, `https://x.internal./` y `https://x.local./` (con el punto final del
 * nombre completo) pasaban la validación del registro. La conexión ya los frenaba (resuelven a 127.0.0.1), pero la
 * validación no decía la verdad. Ahora se quita el punto final antes de comparar.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { afterAll, expect, it } from 'vitest';
import { crearApp } from '../../src/app';
import { CofreSecretos, crearLookupSeguro, despacharWebhooks, problemaDeURL, type Resolver } from '../../src/webhooks';
import { cerrarPool, cliente, poolPrueba, ROL, tenantListo, venta } from '../ayuda';
import { comoDueno, conBase, emitir, json } from './comun';

afterAll(cerrarPool);

const INTERNAS = [
  // Nombres con punto final (FQDN): el hallazgo.
  'https://localhost./x', 'https://LOCALHOST./x', 'https://api.localhost./x', 'https://servicio.internal./x', 'https://impresora.local./x', 'https://./x',
  // Formas numéricas de 127.0.0.1 que la URL normaliza.
  'https://2130706433/x', 'https://0x7f.1/x', 'https://017700000001/x', 'https://127.1/x', 'https://0/x', 'https://127.0.0.1./x', 'https://127.0.0.1../x', 'https://10.0.0.1../x',
  // Metadatos de nubes y redes privadas.
  'https://169.254.169.254/latest/meta-data/', 'https://[fd00:ec2::254]/x', 'https://100.100.100.200/x', 'https://[fe80::1]/x',
  // IPv4 dentro de IPv6.
  'https://[::ffff:127.0.0.1]/x', 'https://[::127.0.0.1]/x', 'https://[::ffff:a9fe:a9fe]/x', 'https://[64:ff9b::7f00:1]/x',
  // Otros esquemas y credenciales.
  'http://hooks.ejemplo.example/x', 'gopher://hooks.ejemplo.example/x', 'file:///etc/passwd', 'https://u:p@hooks.ejemplo.example/x',
];

/** Un receptor TCP local que solo cuenta conexiones. */
async function contador() {
  let conexiones = 0;
  const srv = net.createServer((s) => {
    conexiones++;
    s.destroy();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { puerto: (srv.address() as net.AddressInfo).port, conexiones: () => conexiones, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

const despachar = async (tenant: string, permitirRedInterna: boolean, resolver?: Resolver) =>
  despacharWebhooks({ pool: await poolPrueba(), rol: ROL, cofre: new CofreSecretos(null), permitirRedInterna, soloTenants: [tenant], tiempoMaximo: 3000, resolver });

/** Un resolvedor de prueba que contesta siempre las mismas direcciones, sin DNS. */
const resolverFijo = (...direcciones: string[]): Resolver => (_host, _o, cb) =>
  cb(null, direcciones.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

/** El resultado de `lookupSeguro` con un resolvedor dado. */
const resolverSeguro = (resolver: Resolver, all = false) =>
  new Promise<{ error: string | null; dir: unknown }>((r) =>
    crearLookupSeguro(resolver)('hooks.ejemplo.example', all ? { all: true } : {}, (e, dir) => r({ error: e?.message ?? null, dir })),
  );

it('lookupSeguro: rechaza un nombre que resuelve a loopback, a ::1 o a una mezcla de pública e interna; acepta solo públicas', async () => {
  const interna = 'El nombre resuelve a una dirección interna.';
  for (const dirs of [['127.0.0.1'], ['::1'], ['93.184.215.14', '10.0.0.7'], ['2606:4700:4700::1111', 'fd00::1'], ['169.254.169.254']]) {
    expect((await resolverSeguro(resolverFijo(...dirs))).error, dirs.join(',')).toBe(interna);
  }
  // Sin direcciones también se rechaza; un error del resolvedor pasa tal cual.
  expect((await resolverSeguro(resolverFijo())).error).toBe(interna);
  const fallo: Resolver = (_h, _o, cb) => cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), []);
  expect((await resolverSeguro(fallo)).error).toBe('ENOTFOUND');
  // Solo públicas: la primera (o todas, con `all`), que es a la que se conecta.
  expect(await resolverSeguro(resolverFijo('93.184.215.14', '2606:4700:4700::1111'))).toEqual({ error: null, dir: '93.184.215.14' });
  expect((await resolverSeguro(resolverFijo('93.184.215.14'), true)).dir).toEqual([{ address: '93.184.215.14', family: 4 }]);
});

it('modo alojado: cada forma de escribir un destino interno se rechaza al validar', () => {
  for (const url of INTERNAS) expect(problemaDeURL(url, false), url).not.toBeNull();
  // Control: un destino público sí pasa, también con punto final.
  expect(problemaDeURL('https://hooks.ejemplo.example/x', false)).toBeNull();
  expect(problemaDeURL('https://hooks.ejemplo.example./x', false)).toBeNull();
});

conBase('API7 · SSRF en webhooks', () => {
  it('modo alojado: la API responde 422 WEBHOOK_URL a esos destinos y no guarda nada', async () => {
    const t = await tenantListo();
    const alojado = cliente(crearApp({ pool: t.pool, modo: 'alojado', rol: ROL, registrar: () => undefined }), t.llaveAdmin);
    for (const url of INTERNAS) {
      const r = await alojado('POST', '/v1/webhooks', { url, eventos: ['documento.emitido'] });
      // Las URL que ni siquiera son URL las rechaza la forma (400); las demás, la regla del destino (422).
      expect([400, 422], `${url}: ${r.status}`).toContain(r.status);
      if (r.status === 422) expect((await json(r)).error.codigo).toBe('WEBHOOK_URL');
    }
    expect((await json(await alojado('GET', '/v1/webhooks'))).webhooks).toEqual([]);
  });

  it('una URL interna guardada en modo local no se entrega en modo alojado: ninguna conexión llega al receptor', async () => {
    const receptor = await contador();
    try {
      const t = await tenantListo();
      expect((await t.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${receptor.puerto}/x`, eventos: ['documento.emitido'] })).status).toBe(201);
      await emitir(t.admin, venta());
      expect(await despachar(t.tenant, false)).toBe(1);
      expect(receptor.conexiones()).toBe(0);
      const e = (await comoDueno<{ ultimo_error: string }>(t.pool, t.tenant, 'SELECT ultimo_error FROM api_entregas WHERE tenant = $1', [t.tenant])).rows[0]!;
      expect(e.ultimo_error).toMatch(/https/);
    } finally {
      await receptor.cerrar();
    }
  });

  it('un nombre que resuelve a la red interna pasa la validación pero se frena al conectar: ninguna conexión al receptor', async () => {
    const receptor = await contador();
    try {
      const t = await tenantListo();
      // El nombre parece público; el resolvedor de la prueba lo lleva al receptor local (como un DNS hostil).
      const url = `https://hooks.ejemplo.example:${receptor.puerto}/x-${randomUUID()}`;
      expect(problemaDeURL(url, false)).toBeNull(); // el nombre no dice nada; lo dice la resolución
      const alojado = cliente(crearApp({ pool: t.pool, modo: 'alojado', rol: ROL, registrar: () => undefined }), t.llaveAdmin);
      expect((await alojado('POST', '/v1/webhooks', { url, eventos: ['documento.emitido'] })).status).toBe(201);
      await emitir(t.admin, venta());
      for (const dirs of [['127.0.0.1'], ['::1'], ['93.184.215.14', '127.0.0.1']]) {
        await comoDueno(t.pool, t.tenant, "UPDATE api_entregas SET estado = 'PENDIENTE', proximo = now() WHERE tenant = $1", [t.tenant]);
        expect(await despachar(t.tenant, false, resolverFijo(...dirs))).toBe(1);
        const e = (await comoDueno<{ ultimo_error: string; ultimo_codigo: number | null }>(t.pool, t.tenant, 'SELECT ultimo_error, ultimo_codigo FROM api_entregas WHERE tenant = $1', [t.tenant])).rows[0]!;
        expect(e, dirs.join(',')).toEqual({ ultimo_error: 'El nombre resuelve a una dirección interna.', ultimo_codigo: null });
      }
      expect(receptor.conexiones()).toBe(0);
    } finally {
      await receptor.cerrar();
    }
  });

  it('las redirecciones no se siguen: el receptor que redirige recibe el aviso y el destino de la redirección, nada', async () => {
    const destino = await contador();
    let redirigidas = 0;
    const redirige = http.createServer((req, res) => {
      redirigidas++;
      req.resume();
      res.writeHead(307, { location: `http://127.0.0.1:${destino.puerto}/robado` }).end();
    });
    await new Promise<void>((r) => redirige.listen(0, '127.0.0.1', r));
    try {
      const t = await tenantListo();
      const puerto = (redirige.address() as net.AddressInfo).port;
      await t.admin('POST', '/v1/webhooks', { url: `http://127.0.0.1:${puerto}/hook`, eventos: ['documento.emitido'] });
      await emitir(t.admin, venta());
      await despachar(t.tenant, true);
      expect(redirigidas).toBe(1);
      expect(destino.conexiones()).toBe(0);
      const e = (await comoDueno<{ estado: string; ultimo_codigo: number }>(t.pool, t.tenant, 'SELECT estado, ultimo_codigo FROM api_entregas WHERE tenant = $1', [t.tenant])).rows[0]!;
      expect(e).toEqual({ estado: 'PENDIENTE', ultimo_codigo: 307 });
    } finally {
      redirige.close();
      await destino.cerrar();
    }
  });
});

conBase('API7 · SSRF en la demostración pública (FHN_MODO=demo)', () => {
  it('no hay webhooks: ni a la red interna del proveedor ni a una URL pública; el despachador no corre', async () => {
    const { configDemo } = await import('../../src/demo');
    const pool = await poolPrueba();
    const app = crearApp({ pool, modo: 'demo', rol: ROL, demo: configDemo(), registrar: () => undefined });
    const e = (await (await app.request('/v1/demo/entornos', { method: 'POST' }, { incoming: { socket: { remoteAddress: '203.0.113.77' } } })).json()) as { llave: string };
    const c = cliente(app, e.llave);
    for (const url of ['http://postgres.internal:5432/', 'https://169.254.169.254/latest/meta-data/', 'https://hooks.ejemplo.example/x']) {
      const r = await c('POST', '/v1/webhooks', { url, eventos: ['documento.emitido'] });
      expect(r.status, url).toBe(403);
      expect((await json(r)).error.codigo).toBe('DEMO_NO_DISPONIBLE');
    }
  });
});
