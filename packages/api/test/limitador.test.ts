/**
 * Límite de solicitudes (revisión de la 0.2.0, MEDIO): el límite por llave cuenta solo solicitudes con el secreto
 * correcto, y los intentos no autenticados tienen su propio límite, por dirección y global.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { exigirEsquemaApi, migrarApi, VERSION_ESQUEMA_API } from '../src/esquema';
import { agrupar, ipDeSolicitud, leerProxiesDeConfianza, LimitadorSolicitudes, normalizarIp, Semaforo, SemaforoSaturado } from '../src/errores';
import { cerrarPool, cliente, crearCaja, poolPrueba, ROL, tenantListo, URL_PG } from './ayuda';

const conBase = describe.skipIf(!URL_PG);
afterAll(cerrarPool);

const llaveFalsa = (prefijo = randomBytes(6).toString('hex')) => `fhn_${prefijo}_${randomBytes(32).toString('base64url')}`;

describe('LimitadorSolicitudes', () => {
  it('espera consulta sin gastar fichas', () => {
    let t = 0;
    const l = new LimitadorSolicitudes(1, 2, () => t);
    expect(l.espera('a')).toBe(0);
    expect(l.tomar('a')).toBe(0);
    expect(l.espera('a')).toBe(0);
    expect(l.espera('a')).toBe(0);
    expect(l.tomar('a')).toBe(0);
    expect(l.espera('a')).toBe(1);
    t = 1000;
    expect(l.espera('a')).toBe(0);
    expect(l.tomar('a')).toBe(0);
    expect(l.espera('a')).toBe(1);
  });
  it('espera descuenta las fichas reservadas por intentos en curso', () => {
    const l = new LimitadorSolicitudes(1, 3, () => 0);
    expect(l.espera('a', 2)).toBe(0);
    expect(l.espera('a', 3)).toBe(1);
    l.tomar('a');
    expect(l.espera('a', 1)).toBe(0);
    expect(l.espera('a', 2)).toBe(1);
  });
  it('con 10 000 cubetas desaloja primero las llenas; sin llenas, la más antigua', () => {
    let t = 0;
    const m = new LimitadorSolicitudes(1000, 2, () => t);
    // La primera cubeta en entrar es la de quien ataca.
    m.tomar('atacante');
    for (let i = 0; i < LimitadorSolicitudes.MAX_CUBETAS - 1; i++) m.tomar(`x${i}`);
    // Pasa el tiempo: todas se llenan; quien ataca vuelve a gastar y su cubeta queda vacía.
    t = 10_000;
    m.tomar('atacante');
    m.tomar('atacante');
    m.tomar('nueva');
    expect(m.tiene('atacante')).toBe(true);
    expect(m.tiene('nueva')).toBe(true);
    expect(m.tiene('x0')).toBe(false);
    expect(m.espera('atacante')).toBeGreaterThan(0);
    // Sin cubetas llenas (nadie recupera fichas), sale la más antigua.
    const l = new LimitadorSolicitudes(0.000001, 2, () => 0);
    for (let i = 0; i < LimitadorSolicitudes.MAX_CUBETAS; i++) l.tomar(`y${i}`);
    l.tomar('otra');
    expect(l.tiene('y0')).toBe(false);
    expect(l.tiene('y1')).toBe(true);
    expect(l.tiene('otra')).toBe(true);
  });

  it('al desalojar solo mira las primeras 64 cubetas; más allá no busca llenas', () => {
    let t = 0;
    const m = new LimitadorSolicitudes(1, 2, () => t);
    const vaciar = (k: string) => {
      m.tomar(k);
      m.tomar(k);
    };
    // Las 64 más antiguas quedan vacías; la 65.ª gasta una sola ficha y se llena antes.
    for (let i = 0; i < LimitadorSolicitudes.REVISAR_AL_DESALOJAR; i++) vaciar(`y${i}`);
    m.tomar('llena');
    for (let i = LimitadorSolicitudes.REVISAR_AL_DESALOJAR + 1; i < LimitadorSolicitudes.MAX_CUBETAS; i++) vaciar(`w${i}`);
    t = 1500;
    m.tomar('nueva');
    // Ninguna de las 64 revisadas está llena: sale la más antigua y la llena queda fuera del recorrido.
    expect(m.tiene('y0')).toBe(false);
    expect(m.tiene('y1')).toBe(true);
    expect(m.tiene('llena')).toBe(true);
    expect(m.tiene('nueva')).toBe(true);
  });
});

describe('Semaforo', () => {
  it('deja pasar a lo sumo N a la vez y atiende la cola en orden', async () => {
    const s = new Semaforo(2);
    let activas = 0;
    let maximo = 0;
    const orden: number[] = [];
    const tarea = (i: number) =>
      s.con(async () => {
        activas++;
        maximo = Math.max(maximo, activas);
        await new Promise((r) => setTimeout(r, 5));
        orden.push(i);
        activas--;
        return i;
      });
    expect(await Promise.all([0, 1, 2, 3, 4, 5].map(tarea))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maximo).toBe(2);
    expect(s.ocupacion).toEqual({ activas: 0, enCola: 0 });
    // Una tarea que falla libera su lugar.
    await expect(s.con(async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(s.ocupacion).toEqual({ activas: 0, enCola: 0 });
  });
  it('la cola tiene tope y tiempo máximo de espera', async () => {
    const s = new Semaforo(1, 1, 30);
    let soltar!: () => void;
    const larga = s.con(() => new Promise<void>((r) => (soltar = r)));
    expect(s.saturado).toBe(true);
    const enCola = s.con(async () => 'tarde');
    // Cola llena: falla de inmediato, sin correr la tarea.
    await expect(s.con(async () => 'nunca')).rejects.toEqual(new SemaforoSaturado('cola-llena'));
    // La que espera se rinde a los 30 ms y deja su lugar en la cola.
    await expect(enCola).rejects.toEqual(new SemaforoSaturado('espera-agotada'));
    expect(s.ocupacion).toEqual({ activas: 1, enCola: 0 });
    soltar();
    await larga;
    expect(s.ocupacion).toEqual({ activas: 0, enCola: 0 });
    expect(s.saturado).toBe(false);
  });
});

describe('ipDeSolicitud', () => {
  const sol = (remota: string | undefined, xff?: string) => ({
    env: remota ? { incoming: { socket: { remoteAddress: remota } } } : undefined,
    req: { header: (n: string) => (n === 'x-forwarded-for' ? xff : undefined) },
  });
  it('sin proxies de confianza ignora X-Forwarded-For', () => {
    expect(ipDeSolicitud(sol('10.0.0.5', '1.2.3.4'), 0)).toBe('10.0.0.5');
  });
  it('con N proxies toma la N-ésima dirección desde la derecha', () => {
    expect(ipDeSolicitud(sol('10.0.0.5', 'falsa, 1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(ipDeSolicitud(sol('10.0.0.5', 'falsa, 1.2.3.4, 10.0.0.9'), 2)).toBe('1.2.3.4');
    // Menos saltos que proxies declarados: la dirección del socket, no algo que mandó el cliente.
    expect(ipDeSolicitud(sol('10.0.0.5', '1.2.3.4'), 2)).toBe('10.0.0.5');
  });
  it('IPv6: agrupa por /64 con los grupos expandidos; sin socket: una sola cubeta', () => {
    expect(ipDeSolicitud(sol('2001:db8:1:2:aaaa::1'), 0)).toBe(ipDeSolicitud(sol('2001:db8:1:2:bbbb::9'), 0));
    expect(agrupar('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(agrupar('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(agrupar('2001:db8:0:0:5::')).toBe(agrupar('2001:0db8::5:0:0:0'));
    expect(agrupar('[2001:db8::1]')).toBe('2001:db8:0:0::/64');
    expect(agrupar('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(ipDeSolicitud(sol('::ffff:10.0.0.5'), 0)).toBe('10.0.0.5');
    expect(agrupar('::FFFF:0a00:0005')).toBe('10.0.0.5');
    expect(agrupar('0:0:0:0:0:ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(normalizarIp('2001:db8::')).toBe('2001:db8:0:0:0:0:0:0');
    expect(normalizarIp('::1')).toBe('0:0:0:0:0:0:0:1');
    expect(ipDeSolicitud(sol(undefined), 0)).toBe('desconocida');
  });
  it('con una lista de proxies, X-Forwarded-For solo se cree si la solicitud llega de uno de ellos', () => {
    const lista = ['10.0.0.9', '2001:db8::10'];
    // Desde el proxy: la primera dirección desde la derecha que no es un proxy.
    expect(ipDeSolicitud(sol('10.0.0.9', 'falsa, 1.2.3.4'), lista)).toBe('1.2.3.4');
    expect(ipDeSolicitud(sol('::ffff:10.0.0.9', '1.2.3.4, 2001:0db8:0:0::10'), lista)).toBe('1.2.3.4');
    // Directa (no desde un proxy de la lista): la cabecera no elige la cubeta.
    expect(ipDeSolicitud(sol('203.0.113.5', '1.2.3.4'), lista)).toBe('203.0.113.5');
    // Solo proxies en la cabecera: la del socket.
    expect(ipDeSolicitud(sol('10.0.0.9', '10.0.0.9'), lista)).toBe('10.0.0.9');
  });
  it('FHN_PROXIES_DE_CONFIANZA: número o lista de direcciones', () => {
    expect(leerProxiesDeConfianza(undefined)).toBe(0);
    expect(leerProxiesDeConfianza('')).toBe(0);
    expect(leerProxiesDeConfianza('2')).toBe(2);
    expect(leerProxiesDeConfianza('10.0.0.9, 2001:db8::10')).toEqual(['10.0.0.9', '2001:db8::10']);
    expect(() => leerProxiesDeConfianza('uno')).toThrow(/FHN_PROXIES_DE_CONFIANZA/);
    expect(() => leerProxiesDeConfianza('10.0.0.9, proxy.local')).toThrow(/FHN_PROXIES_DE_CONFIANZA/);
  });
});

conBase('límite de solicitudes', () => {
  it('quien conoce el prefijo de una llave no la deja en 429 (los fallos se cobran al prefijo, no a la dirección)', async () => {
    const { app, admin } = await tenantListo({ limiteSolicitudes: { porSegundo: 1, rafaga: 5 }, limiteIntentos: { porSegundo: 0.01, rafaga: 20 } });
    const caja = await crearCaja(admin, '001');
    const prefijo = caja.split('_')[1]!;
    const estados: number[] = [];
    for (let i = 0; i < 30; i++) estados.push((await cliente(app, llaveFalsa(prefijo), { ip: '198.51.100.7' })('GET', '/v1/autorizaciones')).status);
    // Quien ataca se queda sin intentos; la caja, incluso desde la misma dirección, sigue entrando.
    expect(estados.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(estados.slice(20).every((s) => s === 429)).toBe(true);
    expect((await cliente(app, caja, { ip: '198.51.100.7' })('GET', '/v1/autorizaciones')).status).toBe(200);
  });

  it('intentos concurrentes desde una dirección no se saltan el límite; cajas nuevas en paralelo no reciben 429', async () => {
    const { app, admin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 20 } }, { cajas: ['001', '002', '003'] });
    const cajas = await Promise.all(['001', '002', '003'].map((p) => crearCaja(admin, p)));
    const ataque = Array.from({ length: 100 }, () => cliente(app, llaveFalsa(), { ip: '198.51.100.20' })('GET', '/v1/autorizaciones'));
    // Al mismo tiempo, desde otra dirección, tres cajas que el proceso no ha visto mandan 15 solicitudes cada una.
    const ventas = cajas.flatMap((llave) => Array.from({ length: 15 }, () => cliente(app, llave, { ip: '198.51.100.21' })('GET', '/v1/sesion')));
    const [a, v] = await Promise.all([Promise.all(ataque), Promise.all(ventas)]);
    const estados = a.map((r) => r.status);
    expect(estados.filter((s) => s === 401)).toHaveLength(20);
    expect(estados.filter((s) => s === 429)).toHaveLength(80);
    expect(v.map((r) => r.status).every((s) => s === 200)).toBe(true);
  });

  it('cajas nuevas en paralelo desde una sola dirección no gastan fichas (una consulta por llave)', async () => {
    const { app, admin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 3, consultasSimultaneas: 1 } }, { cajas: ['001', '002', '003'] });
    const cajas = await Promise.all(['001', '002', '003'].map((p) => crearCaja(admin, p)));
    const v = await Promise.all(cajas.flatMap((llave) => Array.from({ length: 15 }, () => cliente(app, llave, { ip: '198.51.100.22' })('GET', '/v1/sesion'))));
    const st = await Promise.all(v.map(async (r) => (r.status === 200 ? 200 : `${r.status} ${await r.text()}`)));
    expect(st.filter((s) => s !== 200)).toEqual([]);
    // Las tres fichas siguen libres: con un solo lugar, una consulta corre y dos esperan en cola.
    const f = await Promise.all(Array.from({ length: 6 }, () => cliente(app, llaveFalsa(), { ip: '198.51.100.22' })('GET', '/v1/sesion')));
    expect(f.map((r) => r.status)).toEqual([401, 401, 401, 429, 429, 429]);
  });

  it('con lugares libres en el semáforo, una dirección sin fichas no recibe 429 (cajas tras la puerta de enlace de Docker)', async () => {
    const { app, admin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 2 } });
    const ip = '198.51.100.23';
    const estados: number[] = [];
    for (let i = 0; i < 5; i++) estados.push((await cliente(app, llaveFalsa(), { ip })('GET', '/v1/sesion')).status);
    expect(estados).toEqual([401, 401, 401, 401, 401]);
    // Una caja nueva para el proceso, desde la misma dirección, entra.
    expect((await cliente(app, await crearCaja(admin, '001'), { ip })('GET', '/v1/sesion')).status).toBe(200);
  });

  it('una dirección con muchos prefijos conocidos no llena la cola: con el semáforo saturado, a lo sumo «rafaga» consultas en curso', async () => {
    const { app, admin } = await tenantListo({ limiteIntentos: { consultasSimultaneas: 1, maxEnCola: 8, rafaga: 2, porSegundo: 0.01 } });
    const llaves = [];
    for (let i = 0; i < 20; i++) llaves.push(await crearCaja(admin, null, 'admin'));
    const caja = await crearCaja(admin, '001');
    // Se «queman» una vez con un secreto equivocado: quedan como prefijos conocidos.
    const ip = '198.51.100.60';
    for (const l of llaves) expect((await cliente(app, llaveFalsa(l.split('_')[1]), { ip })('GET', '/v1/sesion')).status).toBe(401);
    const ataque = llaves.map((l) => cliente(app, llaveFalsa(l.split('_')[1]), { ip })('GET', '/v1/sesion'));
    const legitima = cliente(app, caja, { ip: '198.51.100.61' })('GET', '/v1/sesion');
    const [a, v] = await Promise.all([Promise.all(ataque), legitima]);
    expect(v.status).toBe(200);
    const estados = a.map((r) => r.status);
    expect(estados.filter((s) => s === 401)).toHaveLength(2);
    expect(estados.filter((s) => s === 429)).toHaveLength(18);
  });

  it('cola llena o espera agotada: 429 DEMASIADOS_INTENTOS con Retry-After', async () => {
    const p = await poolPrueba();
    const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { consultasSimultaneas: 1, maxEnCola: 2, esperaMaxMs: 2000 } });
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => cliente(app, llaveFalsa(), { ip: `203.0.113.${50 + i}` })('GET', '/v1/sesion')));
    expect(r.map((x) => x.status)).toEqual([401, 401, 401, 429, 429, 429]);
    expect(r[3]!.headers.get('retry-after')).toBe('2');
    expect(((await r[3]!.json()) as { error: { codigo: string } }).error.codigo).toBe('DEMASIADOS_INTENTOS');
  });

  it('un secreto equivocado no saca de memoria la llave válida', async () => {
    const { app, admin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 2, consultasSimultaneas: 1, maxEnCola: 0 } });
    const caja = await crearCaja(admin, '001');
    const prefijo = caja.split('_')[1]!;
    const ip = '198.51.100.30';
    expect((await cliente(app, caja, { ip })('GET', '/v1/sesion')).status).toBe(200);
    expect((await cliente(app, llaveFalsa(prefijo), { ip: '198.51.100.31' })('GET', '/v1/sesion')).status).toBe(401);
    // Con el único lugar ocupado y la cola en 0, una llave que hubiera que consultar recibiría 429. La caja no
    // se consulta: sigue en memoria.
    const [falsa, buena] = await Promise.all([
      cliente(app, llaveFalsa(), { ip: '198.51.100.32' })('GET', '/v1/sesion'),
      cliente(app, caja, { ip })('GET', '/v1/sesion'),
    ]);
    expect([falsa.status, buena.status]).toEqual([401, 200]);
  });

  it('una caja que reintenta con su llave revocada se frena sola, sin dejar en 429 a las demás de su dirección', async () => {
    const { app, admin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 5 } }, { cajas: ['001', '002'] });
    const vieja = await crearCaja(admin, '001');
    const nueva = await crearCaja(admin, '002');
    const ip = '198.51.100.40'; // la puerta de enlace de Docker, compartida por todas las cajas de la instalación
    expect((await cliente(app, vieja, { ip })('GET', '/v1/sesion')).status).toBe(200);
    expect((await admin('DELETE', `/v1/llaves/${vieja.split('_')[1]}`)).status).toBe(200);
    const estados: number[] = [];
    for (let i = 0; i < 8; i++) estados.push((await cliente(app, vieja, { ip })('GET', '/v1/sesion')).status);
    expect(estados).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
    // La otra caja, nueva para el proceso y desde la misma dirección, entra.
    expect((await cliente(app, nueva, { ip })('GET', '/v1/sesion')).status).toBe(200);
  });

  it('un prefijo registrado sin llave activa se recuerda: no consulta la base; el tenant reactivado entra al pasar el tiempo', async () => {
    const p = await poolPrueba();
    const { llaveAdmin } = await tenantListo();
    const tenant = (await p.query('SELECT tenant FROM api_llaves WHERE prefijo = $1', [llaveAdmin.split('_')[1]])).rows[0].tenant as string;
    let conexiones = 0;
    const contado = new Proxy(p, {
      get(o, k) {
        const v = Reflect.get(o, k) as unknown;
        if (k === 'connect') conexiones++;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(o) : v;
      },
    });
    const app = crearApp({ pool: contado, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { memoriaInactivaMs: 400, rafaga: 50 } });
    await p.query('UPDATE api_tenants SET activo = false WHERE tenant = $1', [tenant]);
    try {
      expect((await cliente(app, llaveAdmin)('GET', '/v1/sesion')).status).toBe(401);
      const antes = conexiones;
      for (let i = 0; i < 5; i++) expect((await cliente(app, llaveAdmin)('GET', '/v1/sesion')).status).toBe(401);
      expect(conexiones).toBe(antes);
      await p.query('UPDATE api_tenants SET activo = true WHERE tenant = $1', [tenant]);
      expect((await cliente(app, llaveAdmin)('GET', '/v1/sesion')).status).toBe(401);
      await new Promise((r) => setTimeout(r, 450));
      expect((await cliente(app, llaveAdmin)('GET', '/v1/sesion')).status).toBe(200);
    } finally {
      await p.query('UPDATE api_tenants SET activo = true WHERE tenant = $1', [tenant]);
    }
  });

  it('el 401 de una llave revocada es idéntico al de un prefijo que no existe', async () => {
    const { app, admin } = await tenantListo();
    const vieja = await crearCaja(admin, '001');
    expect((await admin('DELETE', `/v1/llaves/${vieja.split('_')[1]}`)).status).toBe(200);
    // El mismo Solicitud-Id en las dos: el cuerpo no puede diferir en nada.
    const r1 = await cliente(app, vieja, { ip: '198.51.100.41' })('GET', '/v1/sesion', undefined, { 'solicitud-id': 'igual' });
    const r2 = await cliente(app, llaveFalsa(), { ip: '198.51.100.42' })('GET', '/v1/sesion', undefined, { 'solicitud-id': 'igual' });
    expect([r1.status, r2.status]).toEqual([401, 401]);
    expect(await r1.json()).toEqual(await r2.json());
    const nombres = (r: Response) => {
      const n: string[] = [];
      r.headers.forEach((_, k) => n.push(k));
      return n.sort();
    };
    expect(nombres(r1)).toEqual(nombres(r2));
  });

  it('muchas direcciones con prefijos aleatorios no dejan a nadie en 429: las consultas esperan en cola', async () => {
    const p = await poolPrueba();
    const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { porSegundo: 0.01, rafaga: 1, consultasSimultaneas: 2 } });
    const { llaveAdmin } = await tenantListo();
    const ataque = Array.from({ length: 40 }, (_, i) => cliente(app, llaveFalsa(), { ip: `203.0.113.${i}` })('GET', '/v1/autorizaciones'));
    const valida = cliente(app, llaveAdmin, { ip: '203.0.113.200' })('GET', '/v1/autorizaciones');
    const [a, v] = await Promise.all([Promise.all(ataque), valida]);
    expect(a.map((r) => r.status).every((s) => s === 401)).toBe(true);
    expect(v.status).toBe(200);
  });

  it('migración v7: una base en v6 recibe fhn_api_prefijo_registrado, solo para el rol de la aplicación', async () => {
    const p = await poolPrueba();
    const esquema = `prueba_v7_${randomBytes(4).toString('hex')}`;
    await p.query(`CREATE SCHEMA ${esquema}`);
    const u = new URL(URL_PG!);
    u.searchParams.set('options', `-c search_path=${esquema}`);
    const propio = new pg.Pool({ connectionString: u.toString(), max: 2 });
    try {
      await migrarApi(propio, ROL);
      // Como quedó una base en v6: sin la función y sin la marca de v7.
      await propio.query('DROP FUNCTION fhn_api_prefijo_registrado(text)');
      await propio.query('DELETE FROM fhn_migraciones WHERE clave = $1', [`api-v${VERSION_ESQUEMA_API}-${ROL}`]);
      await propio.query("INSERT INTO api_tenants (tenant, nombre) VALUES ('t', 't')");
      await propio.query(
        "INSERT INTO api_llaves (prefijo, tenant, hash, rol, nombre, revocada) VALUES ('aaaaaaaaaaaa', 't', '\\x00', 'admin', 'vieja', now())",
      );
      await expect(exigirEsquemaApi(propio, ROL)).rejects.toThrow(/versión anterior a la 7[\s\S]*migrar/);
      await migrarApi(propio, ROL);
      await exigirEsquemaApi(propio, ROL);
      const c = await propio.connect();
      try {
        await c.query(`SET ROLE ${ROL}`);
        const r = await c.query("SELECT fhn_api_prefijo_registrado('aaaaaaaaaaaa') AS si, fhn_api_prefijo_registrado('bbbbbbbbbbbb') AS no");
        expect(r.rows[0]).toEqual({ si: true, no: false });
      } finally {
        await c.query('RESET ROLE').catch(() => undefined);
        c.release();
      }
      const acl = (await propio.query("SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'fhn_api_prefijo_registrado' AND pronamespace = current_schema()::regnamespace")).rows[0].acl as string;
      expect(acl).toContain(`${ROL}=X/`);
      expect(acl).not.toMatch(/[{,]=X/); // PUBLIC
    } finally {
      await propio.end();
      await p.query(`DROP SCHEMA ${esquema} CASCADE`);
    }
  });

  it('X-Forwarded-For se ignora salvo con proxiesDeConfianza', async () => {
    const p = await poolPrueba();
    const falsa = (app: ReturnType<typeof crearApp>, xff: string) =>
      cliente(app, llaveFalsa(), { ip: '10.0.0.1' })('GET', '/v1/autorizaciones', undefined, { 'x-forwarded-for': xff });
    const li = { porSegundo: 0.01, rafaga: 2, consultasSimultaneas: 1 };
    const sinProxy = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: li });
    // Cambiar la cabecera en cada intento no da intentos nuevos: cuenta la dirección del socket.
    const a = await Promise.all([0, 1, 2].map((i) => falsa(sinProxy, `1.1.1.${i}`)));
    expect(a.map((r) => r.status)).toEqual([401, 401, 429]);
    // Detrás de un proxy de confianza, cada cliente (la dirección que anotó el proxy) tiene su cubeta.
    const conProxy = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: li, proxiesDeConfianza: 1 });
    const b = await Promise.all([0, 1, 2].map((i) => falsa(conProxy, `1.1.1.${i}`)));
    expect(b.map((r) => r.status)).toEqual([401, 401, 401]);
  });

  it('con el semáforo saturado, prefijos aleatorios terminan en 429 sin consultar la base cada vez', async () => {
    const p = await poolPrueba();
    const app = crearApp({ pool: p, modo: 'local', rol: ROL, registrar: () => undefined, limiteIntentos: { porSegundo: 0.01, rafaga: 5, consultasSimultaneas: 1 } });
    const estados = (await Promise.all(Array.from({ length: 10 }, () => cliente(app, llaveFalsa())('GET', '/v1/autorizaciones')))).map((r) => r.status);
    expect(estados.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(estados.slice(5).every((s) => s === 429)).toBe(true);
    const [, r] = await Promise.all([cliente(app, llaveFalsa())('GET', '/v1/autorizaciones'), cliente(app, llaveFalsa())('GET', '/v1/autorizaciones')]);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toMatch(/^\d+$/);
    const cuerpo = (await r.json()) as { error: { codigo: string; solucion: string; documentacion: string } };
    expect(cuerpo.error.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(cuerpo.error.documentacion).toMatch(/docs\/errores\.md#demasiados_intentos$/);
  });

  it('una llave válida ya vista sigue entrando aunque su dirección agote los intentos', async () => {
    const { app, llaveAdmin } = await tenantListo({ limiteIntentos: { porSegundo: 0.01, rafaga: 3, consultasSimultaneas: 1 } });
    // `tenantListo` ya autenticó la llave admin: queda reconocida.
    const r = await Promise.all([
      ...Array.from({ length: 6 }, () => cliente(app, llaveFalsa())('GET', '/v1/autorizaciones')),
      cliente(app, llaveAdmin)('GET', '/v1/autorizaciones'),
    ]);
    expect(r.map((x) => x.status)).toEqual([401, 401, 401, 429, 429, 429, 200]);
  });

  it('el límite por llave sigue aplicando a la llave válida', async () => {
    const { admin } = await tenantListo();
    const caja = await crearCaja(admin, '001');
    const app2 = crearApp({ pool: await poolPrueba(), modo: 'local', rol: ROL, registrar: () => undefined, limiteSolicitudes: { porSegundo: 0.01, rafaga: 2 } });
    const c = cliente(app2, caja);
    expect((await c('GET', '/v1/autorizaciones')).status).toBe(200);
    expect((await c('GET', '/v1/autorizaciones')).status).toBe(200);
    const r = await c('GET', '/v1/autorizaciones');
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: { codigo: string } }).error.codigo).toBe('DEMASIADAS_SOLICITUDES');
  });
});
