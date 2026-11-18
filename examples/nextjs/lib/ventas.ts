import { ErrorFacturaHN, type crearCliente } from '@factura-hn/cliente';

export type EstadoVenta =
  | { tipo: 'inicial' }
  | { tipo: 'emitida'; numero: string; total: number; repetida: boolean; siguienteClave: string }
  | { tipo: 'error'; mensajes: string[] };

const CLAVE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Factura lo que se capturó en la caja. La clave viene del formulario (generada al mostrarlo): si la cajera
 * pulsa dos veces o la red reintenta, la API devuelve la misma factura.
 */
export async function facturarVenta(
  fhn: ReturnType<typeof crearCliente>,
  datos: FormData,
  nuevaClave: () => string,
): Promise<EstadoVenta> {
  const clave = String(datos.get('clave') ?? '');
  if (!CLAVE.test(clave)) return { tipo: 'error', mensajes: ['Formulario vencido: recarga la página.'] };
  const texto = (k: string) => String(datos.get(k) ?? '').trim();
  const cliente = { ...(texto('cliente') && { nombre: texto('cliente') }), ...(texto('rtn') && { rtn: texto('rtn') }) };
  try {
    const { documento, repetida } = await fhn.emitir(
      {
        documento: {
          cliente,
          preciosIncluyenISV: true,
          lineas: [{ descripcion: texto('descripcion'), cantidad: Number(texto('cantidad')), precioUnitario: texto('precio') }],
        },
      },
      { idempotencyKey: clave },
    );
    return { tipo: 'emitida', numero: documento.numero, total: documento.totales.total, repetida, siguienteClave: nuevaClave() };
  } catch (e) {
    // Errores fiscales (422): se muestran tal cual a la cajera.
    if (e instanceof ErrorFacturaHN) return { tipo: 'error', mensajes: e.errores.length ? e.errores.map((x) => x.mensaje) : [e.message] };
    throw e;
  }
}
