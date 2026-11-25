import 'server-only';
import { ErrorFacturaHN, type crearCliente } from '@factura-hn/cliente';
import { enlacePDF } from './enlaces';

/**
 * `clave` es la clave de idempotencia que debe llevar el próximo envío del formulario:
 * - tras emitir, una nueva (la anterior ya tiene factura);
 * - tras un error fiscal (422), la misma: la API no la guardó, y al corregir se reintenta con ella.
 */
export type EstadoVenta =
  | { tipo: 'inicial' }
  | { tipo: 'emitida'; numero: string; total: number; repetida: boolean; pdf: string; clave: string }
  | { tipo: 'error'; mensajes: string[]; clave: string };

const CLAVE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Factura lo que se capturó en la caja. La clave viene del formulario: si la cajera pulsa dos veces o la red
 * reintenta, la API devuelve la misma factura.
 */
export async function facturarVenta(
  fhn: ReturnType<typeof crearCliente>,
  datos: FormData,
  nuevaClave: () => string,
): Promise<EstadoVenta> {
  const clave = String(datos.get('clave') ?? '');
  if (!CLAVE.test(clave)) return { tipo: 'error', mensajes: ['Formulario vencido: vuelve a intentar.'], clave: nuevaClave() };
  const texto = (k: string) => String(datos.get(k) ?? '').trim();
  const cliente = { ...(texto('cliente') && { nombre: texto('cliente') }), ...(texto('rtn') && { rtn: texto('rtn') }) };
  // Quién atiende queda en la bitácora junto a la llave; se imprime solo si se marca. En tu aplicación,
  // tómalo de la sesión del usuario, no de un campo editable.
  const operador = texto('operador') || undefined;
  const imprimirOperador = Boolean(operador) && datos.get('imprimirOperador') === 'on';
  try {
    const { documento, repetida } = await fhn.emitir(
      {
        ...(operador && { operador }),
        ...(imprimirOperador && { imprimirOperador }),
        documento: {
          cliente,
          preciosIncluyenISV: true,
          // Cantidad y precio como texto exacto: la API los lee sin pasar por punto flotante.
          lineas: [{ descripcion: texto('descripcion'), cantidad: texto('cantidad'), precioUnitario: texto('precio') }],
        },
      },
      { idempotencyKey: clave },
    );
    return { tipo: 'emitida', numero: documento.numero, total: documento.totales.total, repetida, pdf: enlacePDF(documento.numero), clave: nuevaClave() };
  } catch (e) {
    if (e instanceof ErrorFacturaHN && e.estado === 422) {
      // Misma clave con otra venta: la clave quedó usada; la siguiente venta lleva una nueva.
      const siguiente = e.codigo === 'IDEMPOTENCIA_CONFLICTO' ? nuevaClave() : clave;
      return { tipo: 'error', mensajes: e.errores.length ? e.errores.map((x) => x.mensaje) : [e.message], clave: siguiente };
    }
    throw e;
  }
}
