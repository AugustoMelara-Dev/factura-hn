// Prueba de humo de la demostración pública en línea: crea un entorno de prueba, emite un documento por la API y lista
// las herramientas por el MCP remoto. Falla (código 1) con un mensaje claro en el primer paso que no responde lo
// esperado. No imprime la llave ni la URL del MCP del entorno (son credenciales, aunque de prueba).
//
// Uso:  FHN_DEMO_API=https://factura-hn-demo-api.fly.dev node scripts/humo-demo.mjs
// Sin FHN_DEMO_API, no hay nada que probar: avisa y termina con 0. El entorno que crea vence solo a las 24 horas.

const base = (process.env.FHN_DEMO_API ?? '').trim().replace(/\/+$/, '');
if (!base) {
  console.log('FHN_DEMO_API no está definida: no hay demostración en línea que probar.');
  process.exit(0);
}
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base)) {
  console.error(`FHN_DEMO_API debe ser una URL https:// (no "${base}").`);
  process.exit(1);
}

const LIMITE_MS = 20_000;
let paso = '';
const fallar = (mensaje) => {
  console.error(`FALLÓ «${paso}»: ${mensaje}`);
  process.exit(1);
};
const pedir = async (url, init = {}) => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(LIMITE_MS) });
  } catch (e) {
    return fallar(`sin respuesta de ${new URL(url).origin} (${e instanceof Error ? e.message : e})`);
  }
};
const esperar = async (r, estado) => {
  const texto = await r.text();
  if (r.status !== estado) fallar(`esperaba ${estado} y llegó ${r.status}: ${texto.slice(0, 400)}`);
  return texto;
};
/** Un mensaje JSON-RPC de la respuesta del MCP, en JSON o en un flujo SSE. */
const mensajeMcp = (r, texto) => {
  const tipo = r.headers.get('content-type') ?? '';
  const crudo = tipo.includes('text/event-stream')
    ? texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).find(Boolean)
    : texto;
  try {
    return JSON.parse(crudo ?? '');
  } catch {
    return fallar(`respuesta del MCP que no es JSON-RPC: ${texto.slice(0, 200)}`);
  }
};

paso = 'salud de la API';
const salud = JSON.parse(await esperar(await pedir(`${base}/salud`), 200));
if (salud.ok !== true || salud.modo !== 'demo') fallar(`esperaba { ok: true, modo: "demo" } y llegó ${JSON.stringify(salud)}`);
console.log(`API ${salud.version} en modo demo.`);

paso = 'crear un entorno de prueba';
const entorno = JSON.parse(await esperar(await pedir(`${base}/v1/demo/entornos`, { method: 'POST' }), 201));
if (!/^fhn_test_/.test(entorno.llave ?? '')) fallar('la respuesta no trae una llave fhn_test_.');
if (!entorno.mcp?.url) fallar('la respuesta no trae mcp.url (¿falta FHN_DEMO_URL_MCP en la API?).');
console.log(`Entorno ${entorno.entorno?.id} creado; vence ${entorno.entorno?.expira ?? 'en 24 h'}.`);

paso = 'emitir una factura por la API';
const doc = JSON.parse(await esperar(await pedir(`${base}/v1/documentos`, {
  method: 'POST',
  headers: { authorization: `Bearer ${entorno.llave}`, 'content-type': 'application/json', 'idempotency-key': `humo-${Date.now()}` },
  body: JSON.stringify({
    establecimiento: '000', puntoEmision: '001',
    documento: { tipoDocumento: '01', lineas: [{ descripcion: 'Prueba de humo', cantidad: 1, precioUnitario: '57.50' }] },
  }),
}), 201)).documento;
if (!String(doc?.cai ?? '').startsWith('DEMO00-NO-VALIDO-')) fallar(`el documento no tiene un CAI ficticio: ${doc?.cai}`);
console.log(`Factura ${doc.numero} emitida (CAI ficticio).`);

const urlMcp = entorno.mcp.url;
paso = 'salud del MCP remoto';
const saludMcp = JSON.parse(await esperar(await pedir(new URL('/salud', urlMcp)), 200));
if (saludMcp.ok !== true) fallar(`esperaba { ok: true } y llegó ${JSON.stringify(saludMcp)}`);

const cabeceras = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
paso = 'abrir una sesión en el MCP remoto';
const ini = await pedir(urlMcp, {
  method: 'POST', headers: cabeceras,
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'humo-demo', version: '1' } } }),
});
const mIni = mensajeMcp(ini, await esperar(ini, 200));
if (!mIni.result?.serverInfo) fallar(`initialize sin serverInfo: ${JSON.stringify(mIni).slice(0, 300)}`);
const sesion = ini.headers.get('mcp-session-id');
if (!sesion) fallar('initialize no devolvió Mcp-Session-Id.');
const enSesion = { ...cabeceras, 'mcp-session-id': sesion, 'mcp-protocol-version': mIni.result.protocolVersion ?? '2025-06-18' };
await esperar(await pedir(urlMcp, { method: 'POST', headers: enSesion, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), 202);

paso = 'listar las herramientas del MCP remoto';
const lista = await pedir(urlMcp, { method: 'POST', headers: enSesion, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
const herramientas = (mensajeMcp(lista, await esperar(lista, 200)).result?.tools ?? []).map((t) => t.name);
if (!herramientas.includes('emitir_factura')) fallar(`no está emitir_factura entre las herramientas: ${herramientas.join(', ')}`);
console.log(`MCP remoto: ${herramientas.length} herramientas (${herramientas.join(', ')}).`);

paso = 'cerrar la sesión del MCP';
const cierre = await pedir(urlMcp, { method: 'DELETE', headers: enSesion });
await cierre.text();
console.log('Demostración en línea: todo responde.');
