/**
 * Herramientas MCP de factura-hn. Las reglas fiscales las aplica el SDK o la API: las herramientas solo
 * pasan los datos y devuelven los errores tal cual, para que el agente se los muestre al usuario.
 */
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { renderizarTexto, type DocumentoFiscal } from 'factura-hn';
import { ErrorBackend, type Backend, type EntradaSinEmisor } from './backend';

const Monto = z.union([z.string(), z.number()]).describe('Decimal; mejor como texto, p. ej. "57.50".');
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const Numero = z.string().regex(/^\d{3}-\d{3}-\d{2}-\d{8}$/).describe('Número de 16 dígitos, p. ej. 000-001-01-00000001');
const Linea = z.object({
  descripcion: z.string().min(1),
  cantidad: Monto,
  precioUnitario: Monto,
  isv: z.enum(['ISV15', 'ISV18', 'GRAVADO0', 'EXENTO']).optional().describe('Por defecto ISV15. ISV18: bebidas alcohólicas, tabaco, boletos aéreos de primera.'),
  descuento: Monto.optional(),
  codigo: z.string().optional(),
  unidad: z.string().optional(),
});
const Cliente = z
  .object({
    nombre: z.string().optional(),
    rtn: z.string().optional().describe('14 dígitos, si el comprador lo pide (crédito fiscal).'),
    direccion: z.string().optional(),
  })
  .optional()
  .describe('Sin cliente se emite a CONSUMIDOR FINAL (hasta L 10,000; más requiere identificar al comprador).');
const Clave = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe('Clave de idempotencia estable por venta. Si reintentas la misma venta, usa la misma clave.');

const ok = (texto: string, datos: Record<string, unknown>): CallToolResult => ({ content: [{ type: 'text', text: texto }], structuredContent: datos });

function fallo(e: unknown): CallToolResult {
  if (e instanceof ErrorBackend) {
    const lista = e.errores.map((p) => `- [${p.codigo}] ${p.mensaje}${p.campo ? ` (${p.campo})` : ''}`).join('\n');
    return {
      isError: true,
      content: [{ type: 'text', text: `No se pudo completar (${e.codigo}). Muestra estos mensajes al usuario sin reinterpretarlos:\n${lista || e.message}` }],
      structuredContent: { codigo: e.codigo, errores: e.errores },
    };
  }
  throw e;
}

const resumen = (d: DocumentoFiscal) =>
  `${d.nombreDocumento} ${d.numero} (${d.estado}) · CAI ${d.cai} · ${d.fechaEmision} · total L ${d.totales.total.toFixed(2)}` +
  (d.advertencias.length ? `\nAvisos:\n${d.advertencias.map((a) => `- [${a.codigo}] ${a.mensaje}`).join('\n')}` : '');

export function crearServidorMCP(backend: Backend): McpServer {
  const s = new McpServer(
    { name: 'factura-hn', version: '0.2.0' },
    {
      instructions:
        'Facturación SAR Honduras (Acuerdo 481-2017). No inventes reglas fiscales: si una herramienta devuelve errores, ' +
        'muéstralos al usuario tal cual. Un documento emitido no se borra ni se edita: se anula (Art. 41) o se corrige ' +
        'con nota de crédito. Pide confirmación al usuario antes de emitir o anular.',
    },
  );

  s.registerTool(
    'emitir_factura',
    {
      title: 'Emitir factura',
      description: 'Emite una factura (tipo 01) con el siguiente número autorizado. Pide confirmación al usuario antes de llamarla.',
      inputSchema: {
        lineas: z.array(Linea).min(1),
        cliente: Cliente,
        preciosIncluyenISV: z.boolean().optional().describe('true si los precios ya incluyen el ISV (lo usual en un POS).'),
        condicionPago: z.enum(['CONTADO', 'CREDITO']).optional(),
        observaciones: z.string().optional(),
        idempotencyKey: Clave,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) => {
      try {
        const { idempotencyKey, ...entrada } = a;
        const doc = await backend.emitir({ ...entrada, tipoDocumento: '01' } as EntradaSinEmisor, idempotencyKey ?? randomUUID());
        return ok(`Emitida: ${resumen(doc)}`, { documento: doc });
      } catch (e) {
        return fallo(e);
      }
    },
  );

  s.registerTool(
    'emitir_nota_credito',
    {
      title: 'Emitir nota de crédito',
      description:
        'Emite una Nota de Crédito (06) que corrige o devuelve parte de un documento emitido. Las líneas son lo que se ' +
        'acredita. Si el original está en dólares, escribe las líneas en dólares: la nota sale en lempiras con el tipo ' +
        'de cambio del original.',
      inputSchema: {
        numeroOriginal: Numero,
        motivo: z.string().min(1).describe('Por qué se emite (devolución, descuento, error…).'),
        lineas: z.array(Linea).min(1),
        preciosIncluyenISV: z.boolean().optional(),
        idempotencyKey: Clave,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (a) => {
      try {
        const original = await backend.consultar(a.numeroOriginal);
        if (!original) throw new ErrorBackend('NO_ENCONTRADO', `No existe el documento ${a.numeroOriginal}.`, [{ codigo: 'NO_ENCONTRADO', mensaje: `No existe el documento ${a.numeroOriginal}.` }]);
        const { nombreImpreso: _n, ...cliente } = original.cliente;
        const doc = await backend.emitir(
          {
            tipoDocumento: '06',
            motivo: a.motivo,
            cliente,
            lineas: a.lineas,
            preciosIncluyenISV: a.preciosIncluyenISV,
            referencia: { cai: original.cai, numero: original.numero, fecha: original.fechaEmision },
          } as EntradaSinEmisor,
          a.idempotencyKey ?? randomUUID(),
        );
        return ok(`Emitida: ${resumen(doc)}\nModifica: ${original.numero}`, { documento: doc });
      } catch (e) {
        return fallo(e);
      }
    },
  );

  s.registerTool(
    'consultar_documento',
    {
      title: 'Consultar documento',
      description: 'Devuelve un documento por su número, con su estado. formato "texto" da la representación impresa (ticket).',
      inputSchema: { numero: Numero, formato: z.enum(['resumen', 'texto', 'json']).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ numero, formato }) => {
      const doc = await backend.consultar(numero);
      if (!doc) return fallo(new ErrorBackend('NO_ENCONTRADO', `No existe el documento ${numero}.`));
      const texto = formato === 'texto' ? renderizarTexto(doc) : formato === 'json' ? JSON.stringify(doc, null, 2) : resumen(doc);
      return ok(texto, { documento: doc });
    },
  );

  s.registerTool(
    'anular_documento',
    {
      title: 'Anular documento',
      description:
        'Anula un documento emitido (Art. 41): conserva número y contenido y lo marca ANULADO. No se puede deshacer. ' +
        'Confirma con el usuario el número y el motivo antes de llamarla. Para devolver solo una parte, usa emitir_nota_credito.',
      inputSchema: { numero: Numero, motivo: z.string().min(1) },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ numero, motivo }) => {
      try {
        const doc = await backend.anular(numero, motivo);
        return ok(`Anulado: ${resumen(doc)}\nMotivo: ${doc.anulacion?.motivo ?? motivo}`, { documento: doc });
      } catch (e) {
        return fallo(e);
      }
    },
  );

  s.registerTool(
    'estado_cai',
    {
      title: 'Estado de las autorizaciones (CAI)',
      description: 'Vigencia, números restantes y alertas de cada autorización. Avisa si hay que pedir un CAI nuevo (Art. 59).',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const lista = await backend.estadoCAI();
      const texto = lista.length
        ? lista
            .map((e) => `${e.serie} · CAI ${e.cai} · ${e.vigente ? 'vigente' : 'NO VIGENTE'} · quedan ${e.correlativosRestantes} · vence ${e.fechaLimiteEmision}` +
              (e.alertas.length ? `\n  ${e.alertas.map((a) => `[${a.codigo}] ${a.mensaje}`).join('\n  ')}` : ''))
            .join('\n')
        : 'No hay autorizaciones registradas.';
      return ok(texto, { autorizaciones: lista });
    },
  );

  s.registerTool(
    'libro_ventas',
    {
      title: 'Libro de ventas',
      description: 'Ventas de un período con totales por tarifa e ISV. Las notas de crédito restan; los anulados van en cero.',
      inputSchema: { desde: Fecha, hasta: Fecha },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ desde, hasta }) => {
      const libro = await backend.libroVentas(desde, hasta);
      return ok(`Libro de ventas ${desde} a ${hasta}: ${libro.filas.length} documentos.\nResumen: ${JSON.stringify(libro.resumen)}`, libro as Record<string, unknown>);
    },
  );

  return s;
}
