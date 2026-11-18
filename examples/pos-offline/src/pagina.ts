/** Página de la caja: un formulario, el ticket y el estado del CAI. Sin dependencias ni CDN (funciona sin internet). */
export const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caja · factura-hn</title>
<style>
  :root { --fondo: #f6f5f2; --texto: #1d1d1b; --borde: #d8d5ce; --acento: #1f5f8b; --aviso: #8a5a00; --error: #a32020; }
  @media (prefers-color-scheme: dark) { :root { --fondo: #1a1a19; --texto: #ecebe7; --borde: #3a3936; --acento: #7fb6dc; --aviso: #e0b050; --error: #f08080; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, sans-serif; background: var(--fondo); color: var(--texto); }
  main { max-width: 960px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 760px) { main { grid-template-columns: 1fr 1fr; } }
  h1 { font-size: 18px; margin: 0 0 8px; }
  section { border: 1px solid var(--borde); border-radius: 8px; padding: 14px; }
  label { display: block; font-size: 13px; margin: 8px 0 2px; }
  input { width: 100%; padding: 8px; border: 1px solid var(--borde); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
  .fila { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px; }
  button { margin-top: 12px; padding: 10px 14px; border: 0; border-radius: 6px; background: var(--acento); color: #fff; font: inherit; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: progress; }
  pre { white-space: pre; overflow-x: auto; font: 13px/1.35 ui-monospace, monospace; margin: 0; }
  .aviso { color: var(--aviso); } .error { color: var(--error); }
  ul { margin: 6px 0 0; padding-left: 18px; }
</style>
</head>
<body>
<main>
  <section>
    <h1>Nueva venta</h1>
    <form id="venta">
      <label for="cliente">Cliente (opcional)</label>
      <input id="cliente" autocomplete="off" placeholder="Consumidor final">
      <label for="rtn">RTN del cliente (opcional)</label>
      <input id="rtn" inputmode="numeric" autocomplete="off" maxlength="14">
      <div class="fila">
        <div><label for="desc">Descripción</label><input id="desc" required></div>
        <div><label for="cant">Cantidad</label><input id="cant" type="number" min="0.0001" step="any" value="1" required></div>
        <div><label for="precio">Precio con ISV</label><input id="precio" inputmode="decimal" required placeholder="0.00"></div>
      </div>
      <button id="cobrar" type="submit">Cobrar y emitir factura</button>
    </form>
    <div id="mensaje" role="status" aria-live="polite"></div>
  </section>
  <section>
    <h1>Ticket</h1>
    <pre id="ticket">—</pre>
  </section>
  <section>
    <h1>Autorización</h1>
    <div id="estado">Cargando…</div>
  </section>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  // La clave sobrevive a una recarga hasta que la venta se confirma: reintentar nunca duplica la factura.
  const nuevaClave = () => { const c = crypto.randomUUID(); try { localStorage.setItem('clave', c); } catch {} return c; };
  let clave = (() => { try { return localStorage.getItem('clave'); } catch { return null; } })() || nuevaClave();

  function mostrar(el, texto, clase) { el.className = clase || ''; el.textContent = texto; }

  async function cargarEstado() {
    try {
      const r = await (await fetch('/api/estado')).json();
      const el = $('estado'); el.textContent = '';
      if (!r.autorizacion) return mostrar(el, 'No hay autorización (CAI) registrada para ' + r.serie + '.', 'error');
      const a = r.autorizacion;
      const p = document.createElement('p');
      p.textContent = 'CAI ' + a.cai + ' · vence ' + a.fechaLimiteEmision + ' · quedan ' + a.correlativosRestantes + ' números · ' + r.pendientesDeEnviar + ' por sincronizar';
      el.append(p);
      if (a.alertas.length) {
        const ul = document.createElement('ul'); ul.className = 'aviso';
        for (const x of a.alertas) { const li = document.createElement('li'); li.textContent = x.mensaje; ul.append(li); }
        el.append(ul);
      }
    } catch { mostrar($('estado'), 'No se pudo leer el estado.', 'error'); }
  }

  $('venta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('cobrar').disabled = true;
    const cliente = {};
    if ($('cliente').value.trim()) cliente.nombre = $('cliente').value.trim();
    if ($('rtn').value.trim()) cliente.rtn = $('rtn').value.trim();
    const cuerpo = { clave, cliente, lineas: [{ descripcion: $('desc').value, cantidad: Number($('cant').value), precioUnitario: $('precio').value.trim() }] };
    try {
      const r = await fetch('/api/ventas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      const d = await r.json();
      if (r.ok) {
        mostrar($('ticket'), d.ticket);
        mostrar($('mensaje'), 'Emitida ' + d.documento.numero + (d.repetida ? ' (ya estaba emitida)' : ''));
        clave = nuevaClave();
        $('desc').value = ''; $('precio').value = ''; $('cant').value = '1';
      } else if (d.errores) {
        mostrar($('mensaje'), d.errores.map((e) => e.mensaje).join(' · '), 'error');
        clave = nuevaClave();
      } else mostrar($('mensaje'), d.error || 'No se pudo emitir.', 'error');
    } catch {
      // Sin respuesta: se conserva la clave para reintentar sin duplicar.
      mostrar($('mensaje'), 'Sin respuesta del POS. Vuelve a intentar: no se duplicará la factura.', 'error');
    } finally {
      $('cobrar').disabled = false;
      cargarEstado();
    }
  });
  cargarEstado();
</script>
</body>
</html>`;
