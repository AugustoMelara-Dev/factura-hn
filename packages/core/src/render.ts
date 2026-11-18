/**
 * Representación impresa del documento: HTML (carta o ticket 80 mm) y texto plano
 * para impresoras térmicas. Incluye todos los campos de los Arts. 10 y 11.
 */
import { escaladoATexto, formatearMonto, parsearDecimal } from './dinero';
import { formatearDNI, formatearRTN } from './identificacion';
import type { DocumentoFiscal, TratamientoISV } from './tipos';

export interface OpcionesRender {
  /** 'carta' (por defecto) o 'ticket' (80 mm). */
  formato?: 'carta' | 'ticket';
  /** Leyenda opcional al pie, p. ej. "La factura es beneficio de todos, exíjala." (no la exige el reglamento). */
  leyenda?: string | null;
  /** URL o data URI de un logo. */
  logo?: string;
  /** Título de la pestaña. */
  titulo?: string;
}


const ETIQUETA_ISV: Record<TratamientoISV, string> = { ISV15: 'G', ISV18: 'G18', EXENTO: 'E' };

/** Precio unitario con 2 decimales, o hasta 4 si los trae (Art. 11 num. 1 lit. f: valor unitario). */
function formatearPrecio(precio: number): string {
  const [ent, dec = ''] = escaladoATexto(parsearDecimal(precio, 4), 4).split('.');
  if (dec.length <= 2) return formatearMonto(precio);
  return `${ent!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fechaLegible(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function filasTotales(doc: DocumentoFiscal): Array<[string, number, boolean?]> {
  const t = doc.totales;
  const filas: Array<[string, number, boolean?]> = [
    ['Descuentos y rebajas otorgados', t.descuentos],
    ['Sub-total', t.subtotal],
    ['Importe exonerado', t.importeExonerado],
    ['Importe exento', t.importeExento],
    ['Importe gravado 15%', t.importeGravado15],
    ['Importe gravado 18%', t.importeGravado18],
    ['I.S.V. 15%', t.isv15],
    ['I.S.V. 18%', t.isv18],
    ...(t.ajustePorRedondeo > 0
      ? [['Ajuste por redondeo del ISV (Ley ISV Art. 9)', -t.ajustePorRedondeo] as [string, number]]
      : []),
    ['TOTAL A PAGAR', t.total, true],
  ];
  return filas;
}

function identificacionCliente(doc: DocumentoFiscal): string {
  const c = doc.cliente;
  if (c.rtn) return `RTN: ${formatearRTN(c.rtn)}`;
  if (c.identificacion) {
    const n = c.identificacion.tipo === 'DNI' ? formatearDNI(c.identificacion.numero) : c.identificacion.numero;
    return `${c.identificacion.tipo}: ${n}`;
  }
  return '';
}

export function renderizarHTML(doc: DocumentoFiscal, opciones: OpcionesRender = {}): string {
  const ticket = opciones.formato === 'ticket';
  const leyenda = opciones.leyenda ?? null;
  const e = doc.emisor;
  const simbolo = doc.moneda === 'HNL' ? 'L' : '$';
  const idCliente = identificacionCliente(doc);

  const lineas = doc.lineas
    .map(
      (l) => `<tr>
        <td class="num">${esc(l.cantidad)}${l.unidad ? ' ' + esc(l.unidad) : ''}</td>
        <td>${l.codigo ? `<span class="cod">${esc(l.codigo)}</span> ` : ''}${esc(l.descripcion)}${
          l.descuento > 0 ? `<div class="desc">Descuento: ${formatearMonto(l.descuento)}</div>` : ''
        }</td>
        <td class="num">${formatearPrecio(l.precioUnitario)}</td>
        <td class="num">${formatearMonto(l.importe)} <span class="trat">${ETIQUETA_ISV[l.isv]}</span></td>
      </tr>`,
    )
    .join('');

  const totales = filasTotales(doc)
    .map(
      ([etq, monto, fuerte]) =>
        `<tr${fuerte ? ' class="total"' : ''}><td>${etq}</td><td class="num">${simbolo} ${formatearMonto(monto)}</td></tr>`,
    )
    .join('');

  const exo = doc.exoneracion
    ? `<section class="bloque"><h3>Datos del adquirente exonerado</h3>
        <div>N° Orden de Compra Exenta: <b>${esc(doc.exoneracion.ordenCompraExenta)}</b></div>
        <div>N° Constancia de Registro de Exonerados: <b>${esc(doc.exoneracion.constanciaRegistroExonerado)}</b></div>
        <div>N° Registro SAG: <b>${esc(doc.exoneracion.registroSAG ?? '—')}</b></div>
      </section>`
    : '';

  const ref = doc.referencia
    ? `<section class="bloque"><h3>Documento que modifica</h3>
        <div>N°: <b>${esc(doc.referencia.numero)}</b> · Fecha: ${fechaLegible(doc.referencia.fecha)}</div>
        <div>CAI: ${esc(doc.referencia.cai)}</div>
        ${doc.motivo ? `<div>Motivo: ${esc(doc.motivo)}</div>` : ''}
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opciones.titulo ?? `${doc.nombreDocumento} ${doc.numero}`)}</title>
<style>
  :root { --tinta:#111; --suave:#555; --linea:#ccc; }
  * { box-sizing: border-box; }
  body { margin:0; font: ${ticket ? '11px/1.35' : '12px/1.45'} ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; color:var(--tinta); background:#fff; }
  .hoja { ${ticket ? 'width:80mm; padding:4mm;' : 'max-width:210mm; padding:14mm;'} margin:0 auto; }
  header { display:flex; ${ticket ? 'flex-direction:column; align-items:center; text-align:center;' : 'justify-content:space-between; gap:16px;'} }
  header img { max-height:56px; max-width:160px; }
  h1 { font-size:${ticket ? '13px' : '16px'}; margin:0 0 2px; }
  h2 { font-size:${ticket ? '13px' : '18px'}; margin:0; letter-spacing:.04em; text-transform:uppercase; }
  h3 { font-size:11px; margin:0 0 4px; text-transform:uppercase; color:var(--suave); }
  .doc { ${ticket ? 'margin-top:6px;' : 'text-align:right;'} }
  .bloque { border-top:1px dashed var(--linea); padding-top:6px; margin-top:8px; }
  .fiscal div, .bloque div { overflow-wrap: anywhere; }
  ${ticket ? '.fiscal { font-size:10px; }' : ''}
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th { text-align:left; font-size:10px; text-transform:uppercase; color:var(--suave); border-bottom:1px solid var(--tinta); padding:3px 2px; }
  td { padding:3px 2px; vertical-align:top; border-bottom:1px dotted var(--linea); }
  .num { text-align:right; white-space:nowrap; }
  .cod, .trat, .desc { color:var(--suave); font-size:10px; }
  .totales { ${ticket ? '' : 'width:60%; margin-left:auto;'} }
  .totales td { border:none; padding:1px 2px; }
  .totales .total td { font-weight:700; font-size:${ticket ? '13px' : '14px'}; border-top:1px solid var(--tinta); padding-top:4px; }
  .letras { margin-top:6px; font-weight:600; }
  footer { margin-top:12px; text-align:center; color:var(--suave); font-size:10px; }
  @media print { .hoja { padding:${ticket ? '0' : '10mm'}; } @page { ${ticket ? 'size:80mm auto; margin:2mm;' : 'size:letter; margin:8mm;'} } }
</style></head>
<body><div class="hoja">
<header>
  <div>
    ${opciones.logo ? `<img src="${esc(opciones.logo)}" alt="">` : ''}
    <h1>${esc(e.nombreComercial ?? e.razonSocial)}</h1>
    ${e.nombreComercial ? `<div>${esc(e.razonSocial)}</div>` : ''}
    <div>RTN: ${formatearRTN(e.rtn)}</div>
    <div>Casa matriz: ${esc(e.direccionCasaMatriz)}</div>
    ${e.direccionEstablecimiento ? `<div>Establecimiento: ${esc(e.direccionEstablecimiento)}</div>` : ''}
    ${e.telefono ? `<div>Tel.: ${esc(e.telefono)}</div>` : ''}
    ${e.correo ? `<div>${esc(e.correo)}</div>` : ''}
  </div>
  <div class="doc">
    <h2>${esc(doc.nombreDocumento)}</h2>
    <div><b>N° ${esc(doc.numero)}</b></div>
    <div>Fecha: ${fechaLegible(doc.fechaEmision)}${doc.horaEmision ? ' ' + esc(doc.horaEmision) : ''}</div>
    ${doc.condicionPago ? `<div>Condición: ${esc(doc.condicionPago)}</div>` : ''}
  </div>
</header>

<section class="bloque fiscal">
  <div>CAI: ${esc(doc.cai)}</div>
  <div>Rango autorizado: ${esc(doc.rangoAutorizado)}</div>
  <div>Fecha límite de emisión: ${fechaLegible(doc.fechaLimiteEmision)}</div>
</section>

<section class="bloque">
  <h3>Cliente</h3>
  <div><b>${esc(doc.cliente.nombreImpreso)}</b></div>
  ${idCliente ? `<div>${esc(idCliente)}</div>` : ''}
  ${doc.cliente.direccion ? `<div>${esc(doc.cliente.direccion)}</div>` : ''}
</section>
${exo}${ref}
<table>
  <thead><tr><th class="num">Cant.</th><th>Descripción</th><th class="num">P. unit.</th><th class="num">Importe</th></tr></thead>
  <tbody>${lineas}</tbody>
</table>
${doc.preciosIncluyenISV ? '<div class="desc">Precios incluyen ISV. G = gravado 15%, G18 = gravado 18%, E = exento.</div>' : '<div class="desc">G = gravado 15%, G18 = gravado 18%, E = exento.</div>'}

<table class="totales"><tbody>${totales}</tbody></table>
<div class="letras">${esc(doc.totales.totalEnLetras)}</div>
${doc.moneda !== 'HNL' && doc.tipoCambio ? `<div>Tipo de cambio: L ${esc(doc.tipoCambio)} por ${doc.moneda}</div>` : ''}
${doc.observaciones ? `<div class="bloque">${esc(doc.observaciones)}</div>` : ''}
${doc.tipoDocumento === '06' ? `<section class="bloque"><h3>Recibido por (Art. 26 num. 7)</h3>
  <div>Nombre: ______________________________</div>
  <div>Identidad: ___________________________</div>
  <div>Firma: _______________________________</div></section>` : ''}

<footer>
  <div>${esc(doc.destinoEjemplares)}</div>
  ${leyenda ? `<div>${esc(leyenda)}</div>` : ''}
</footer>
</div></body></html>`;
}

/** Texto plano para impresoras térmicas (ESC/POS en modo texto). Ancho típico: 32, 42 o 48 columnas. */
export function renderizarTexto(doc: DocumentoFiscal, opciones: { ancho?: number; leyenda?: string | null } = {}): string {
  const W = opciones.ancho ?? 42;
  const leyenda = opciones.leyenda ?? null;
  const out: string[] = [];
  const sep = '-'.repeat(W);
  const centro = (s: string) => {
    for (const t of envolver(s, W)) out.push(' '.repeat(Math.max(0, Math.floor((W - t.length) / 2))) + t);
  };
  const izq = (s: string) => out.push(...envolver(s, W));
  const par = (a: string, b: string) => {
    const espacio = W - a.length - b.length;
    if (espacio >= 1) out.push(a + ' '.repeat(espacio) + b);
    else {
      out.push(...envolver(a, W));
      out.push(b.padStart(W));
    }
  };
  const e = doc.emisor;
  const sim = doc.moneda === 'HNL' ? 'L' : '$';

  centro(e.nombreComercial ?? e.razonSocial);
  if (e.nombreComercial) centro(e.razonSocial);
  centro(`RTN: ${formatearRTN(e.rtn)}`);
  centro(e.direccionEstablecimiento ?? e.direccionCasaMatriz);
  if (e.direccionEstablecimiento) centro(`Casa matriz: ${e.direccionCasaMatriz}`);
  if (e.telefono) centro(`Tel.: ${e.telefono}`);
  if (e.correo) centro(e.correo);
  out.push(sep);
  centro(doc.nombreDocumento.toUpperCase());
  centro(`N° ${doc.numero}`);
  izq(`CAI: ${doc.cai}`);
  izq(`Rango: ${doc.rangoAutorizado}`);
  izq(`Fecha límite de emisión: ${fechaLegible(doc.fechaLimiteEmision)}`);
  izq(`Fecha: ${fechaLegible(doc.fechaEmision)}${doc.horaEmision ? ' ' + doc.horaEmision : ''}`);
  out.push(sep);
  izq(`Cliente: ${doc.cliente.nombreImpreso}`);
  const id = identificacionCliente(doc);
  if (id) izq(id);
  if (doc.exoneracion) {
    izq(`OCE: ${doc.exoneracion.ordenCompraExenta}`);
    izq(`Const. exonerado: ${doc.exoneracion.constanciaRegistroExonerado}`);
    izq(`Reg. SAG: ${doc.exoneracion.registroSAG ?? '-'}`);
  }
  if (doc.referencia) {
    izq(`Modifica: ${doc.referencia.numero} (${fechaLegible(doc.referencia.fecha)})`);
    izq(`CAI ref.: ${doc.referencia.cai}`);
    if (doc.motivo) izq(`Motivo: ${doc.motivo}`);
  }
  out.push(sep);
  for (const l of doc.lineas) {
    izq(l.descripcion);
    par(`  ${l.cantidad} x ${formatearPrecio(l.precioUnitario)}`, `${formatearMonto(l.importe)} ${ETIQUETA_ISV[l.isv]}`);
    if (l.descuento > 0) par('  Descuento', `-${formatearMonto(l.descuento)}`);
  }
  out.push(sep);
  for (const [etq, monto] of filasTotales(doc)) par(etq, `${sim} ${formatearMonto(monto)}`);
  out.push(sep);
  izq(doc.totales.totalEnLetras);
  if (doc.moneda !== 'HNL' && doc.tipoCambio) izq(`Tipo de cambio: L ${doc.tipoCambio}`);
  if (doc.preciosIncluyenISV) izq('Precios incluyen ISV.');
  if (doc.tipoDocumento === '06') {
    out.push(sep);
    izq('Recibido por:');
    izq('Nombre: ' + '_'.repeat(Math.max(4, W - 8)));
    izq('Identidad: ' + '_'.repeat(Math.max(4, W - 11)));
    izq('Firma: ' + '_'.repeat(Math.max(4, W - 7)));
  }
  izq('G=gravado 15% G18=gravado 18% E=exento');
  out.push(sep);
  centro(doc.destinoEjemplares);
  if (leyenda) centro(leyenda);
  return out.join('\n') + '\n';
}

function envolver(texto: string, ancho: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas: string[] = [];
  let actual = '';
  for (const p of palabras) {
    if (p.length > ancho) {
      if (actual) lineas.push(actual);
      for (let i = 0; i < p.length; i += ancho) lineas.push(p.slice(i, i + ancho));
      actual = '';
      continue;
    }
    if (!actual) actual = p;
    else if (actual.length + 1 + p.length <= ancho) actual += ' ' + p;
    else {
      lineas.push(actual);
      actual = p;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}
