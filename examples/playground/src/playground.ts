/**
 * Playground del SDK en el navegador: sin servidor, sin red. El almacén vive en memoria y se pierde al
 * recargar. Los CAI son FICTICIOS: nada de lo que se emite aquí tiene validez fiscal.
 */
import {
  AlmacenFiscalMemoria,
  anular,
  emitir,
  ErrorValidacion,
  estadoAutorizacion,
  fechaHonduras,
  identificadorDe,
  registrarAutorizacion,
  renderizarHTML,
  renderizarTexto,
  type DocumentoEntrada,
  type DocumentoFiscal,
  type Problema,
} from 'factura-hn';

export const CAI_FICTICIO = 'DEMO00-NO-VALIDO-0000-0000-0000-';

const EMISOR = {
  rtn: '99990000000000',
  razonSocial: 'NEGOCIO DE DEMOSTRACIÓN (CAI FICTICIO, NO VÁLIDO)',
  nombreComercial: 'Pulpería Demostración',
  direccionCasaMatriz: 'Barrio El Centro, Tegucigalpa, M.D.C.',
  direccionEstablecimiento: 'Barrio El Centro, Tegucigalpa, M.D.C.',
  telefono: '0000-0000',
  correo: 'demo@ejemplo.example',
};

/**
 * Entradas de ejemplo. `{{numero}}`, `{{cai}}`, `{{fecha}}`, `{{nombre}}` y `{{rtn}}` toman los datos de la
 * última factura emitida a un cliente con RTN (las notas exigen nombre y RTN del adquirente, Arts. 26 y 28).
 */
export const EJEMPLOS: Record<string, { titulo: string; entrada: unknown }> = {
  simple: {
    titulo: 'Consumidor final',
    entrada: { emisor: EMISOR, preciosIncluyenISV: true, operador: 'Cajera de prueba', lineas: [{ descripcion: 'Café 1 lb', cantidad: 2, precioUnitario: '120.00' }] },
  },
  rtn: {
    titulo: 'Cliente con RTN, exento y 18 %',
    entrada: {
      emisor: EMISOR,
      cliente: { nombre: 'Ferretería Pérez S. de R.L.', rtn: '99990000000002' },
      lineas: [
        { descripcion: 'Cemento 42.5 kg', cantidad: 3, precioUnitario: '213.04', isv: 'ISV15' },
        { descripcion: 'Libro de texto', cantidad: 1, precioUnitario: '350.00', isv: 'EXENTO' },
        { descripcion: 'Cerveza 12 oz', cantidad: 6, precioUnitario: '25.00', isv: 'ISV18' },
      ],
    },
  },
  descuento: {
    titulo: 'Con descuento',
    entrada: { emisor: EMISOR, lineas: [{ descripcion: 'Zapatos', cantidad: 1, precioUnitario: '1500.00', descuento: '150.00' }] },
  },
  invalida: {
    titulo: 'Inválida (para ver los errores)',
    entrada: { emisor: { ...EMISOR, rtn: '123' }, lineas: [{ descripcion: '', cantidad: 0, precioUnitario: '-5' }] },
  },
  notaCredito: {
    titulo: 'Nota de crédito (emite antes la del cliente con RTN)',
    entrada: {
      emisor: EMISOR,
      tipoDocumento: '06',
      cliente: { nombre: '{{nombre}}', rtn: '{{rtn}}' },
      referencia: { cai: '{{cai}}', numero: '{{numero}}', fecha: '{{fecha}}' },
      motivo: 'Devolución de un saco de cemento',
      lineas: [{ descripcion: 'Cemento 42.5 kg', cantidad: 1, precioUnitario: '213.04', isv: 'ISV15' }],
    },
  },
};

export type Resultado =
  | { ok: true; documento: DocumentoFiscal; html: string; texto: string; advertencias: Problema[] }
  | { ok: false; mensaje: string; errores: Problema[]; advertencias: Problema[] };

export interface EstadoSerie { serie: string; cai: string; restantes: number; vence: string; alertas: string[] }

/** Una sesión: almacén en memoria con CAI ficticios para facturas, notas de crédito y de débito en 000-001. */
export async function crearSesion(reloj: () => Date = () => new Date()) {
  const almacen = new AlmacenFiscalMemoria();
  const limite = new Date(reloj().getTime() + 180 * 86_400_000).toISOString().slice(0, 10);
  for (const tipoDocumento of ['01', '06', '07'] as const) {
    await registrarAutorizacion(almacen, {
      cai: `${CAI_FICTICIO}${tipoDocumento}`, tipoDocumento, establecimiento: '000', puntoEmision: '001',
      rangoInicial: 1, rangoFinal: 50, fechaLimiteEmision: limite,
    }, { reloj });
  }
  const emitidos: DocumentoFiscal[] = [];
  const config = { almacen, establecimiento: '000', puntoEmision: '001', opciones: { reloj }, actor: 'playground' };

  const resultado = (doc: DocumentoFiscal, advertencias: Problema[] = []): Resultado => ({
    ok: true,
    documento: doc,
    html: renderizarHTML(doc),
    texto: renderizarTexto(doc, { ancho: 42 }),
    advertencias,
  });
  const fallo = (e: unknown): Resultado => {
    if (e instanceof ErrorValidacion) return { ok: false, mensaje: 'El documento no cumple las reglas fiscales.', errores: e.errores, advertencias: e.advertencias };
    return { ok: false, mensaje: e instanceof Error ? e.message : String(e), errores: [], advertencias: [] };
  };

  return {
    /** Emite desde el texto JSON de un `DocumentoEntrada`. Nunca lanza. */
    async emitir(json: string): Promise<Resultado> {
      let entrada: DocumentoEntrada;
      try {
        const u = emitidos.filter((d) => d.tipoDocumento === '01' && d.cliente.rtn).at(-1);
        const datos: Record<string, string> = {
          numero: u?.numero ?? '', cai: u?.cai ?? '', fecha: u?.fechaEmision ?? '', nombre: u?.cliente.nombreImpreso ?? '', rtn: u?.cliente.rtn ?? '',
        };
        // JSON.stringify(...).slice(1, -1): el valor queda escapado dentro de las comillas del JSON.
        entrada = JSON.parse(json.replace(/\{\{(numero|cai|fecha|nombre|rtn)\}\}/g, (_, k: string) => JSON.stringify(datos[k]!).slice(1, -1))) as DocumentoEntrada;
      } catch (e) {
        return { ok: false, mensaje: `JSON inválido: ${(e as Error).message}`, errores: [], advertencias: [] };
      }
      try {
        const doc = await emitir(entrada, config);
        emitidos.push(doc);
        return resultado(doc);
      } catch (e) {
        return fallo(e);
      }
    },
    async anular(numero: string, motivo: string): Promise<Resultado> {
      try {
        const doc = await anular(numero, { almacen, motivo, reloj, actor: 'playground' });
        emitidos[emitidos.findIndex((d) => d.numero === numero)] = doc;
        return resultado(doc);
      } catch (e) {
        return fallo(e);
      }
    },
    emitidos: () => [...emitidos],
    async estado(): Promise<EstadoSerie[]> {
      const hoy = fechaHonduras(reloj());
      return almacen.transaccion(async (tx) => {
        const r: EstadoSerie[] = [];
        for (const tipoDocumento of ['01', '06', '07'] as const) {
          const id = identificadorDe({ establecimiento: '000', puntoEmision: '001', tipoDocumento });
          const [a] = await tx.autorizaciones(id);
          const { ultimo } = await tx.bloquearSerie(id);
          const e = estadoAutorizacion(a!, ultimo, { hoy });
          r.push({ serie: id, cai: a!.cai, restantes: e.correlativosRestantes, vence: a!.fechaLimiteEmision, alertas: e.alertas.map((x) => x.mensaje) });
        }
        return r;
      });
    },
  };
}

// --- Página -------------------------------------------------------------------------------------------

/** Conecta la sesión con la página (`index.html`). Todo el texto entra con `textContent`, nunca como HTML. */
export async function iniciar(doc: Document): Promise<void> {
  const sesion = await crearSesion();
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const editor = $<HTMLTextAreaElement>('entrada');
  const ejemplos = $<HTMLSelectElement>('ejemplos');
  const vista = $<HTMLIFrameElement>('vista');
  const elemento = (tag: string, texto: string, clase?: string) => {
    const e = doc.createElement(tag);
    e.textContent = texto;
    if (clase) e.className = clase;
    return e;
  };

  for (const [clave, { titulo }] of Object.entries(EJEMPLOS)) ejemplos.append(new Option(titulo, clave));
  const cargar = () => (editor.value = JSON.stringify(EJEMPLOS[ejemplos.value]!.entrada, null, 2));
  ejemplos.addEventListener('change', cargar);
  cargar();

  async function pintarEstado() {
    const lista = $('estado');
    lista.replaceChildren(...(await sesion.estado()).map((s) => elemento('li', `${s.serie} · quedan ${s.restantes} · vence ${s.vence}${s.alertas.length ? ' · ' + s.alertas.join(' ') : ''}`)));
    const emitidos = $('emitidos');
    emitidos.replaceChildren(
      ...sesion.emitidos().reverse().map((d) => {
        const li = elemento('li', `${d.numero} · L ${d.totales.total.toFixed(2)} · ${d.estado} `);
        if (d.estado === 'EMITIDO') {
          const b = elemento('button', 'Anular') as HTMLButtonElement;
          b.type = 'button';
          b.addEventListener('click', async () => mostrar(await sesion.anular(d.numero, 'Anulado desde el playground')));
          li.append(b);
        }
        return li;
      }),
    );
  }

  function mostrar(r: Resultado) {
    const msg = $('mensajes');
    msg.replaceChildren();
    if (r.ok) {
      msg.append(elemento('p', `${r.documento.estado === 'ANULADO' ? 'Anulado' : 'Emitido'}: ${r.documento.numero}`, 'ok'));
      // El documento se muestra en un iframe sin permisos (sandbox vacío): no ejecuta nada.
      vista.srcdoc = r.html;
      $('ticket').textContent = r.texto;
      $('json').textContent = JSON.stringify(r.documento, null, 2);
    } else {
      msg.append(elemento('p', r.mensaje, 'error'));
      const ul = doc.createElement('ul');
      ul.append(...r.errores.map((e) => elemento('li', `${e.mensaje}${e.campo ? ` (${e.campo})` : ''} [${e.codigo}]`, 'error')));
      ul.append(...r.advertencias.map((e) => elemento('li', `${e.mensaje} [${e.codigo}]`, 'aviso')));
      msg.append(ul);
    }
    void pintarEstado();
  }

  $('emitir').addEventListener('click', async () => mostrar(await sesion.emitir(editor.value)));
  void pintarEstado();
}
