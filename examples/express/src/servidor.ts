/**
 * FHN_API_URL=http://127.0.0.1:8787 FHN_LLAVE=fhn_… FHN_SECRETO_WEBHOOK=… pnpm start
 * Con `docker compose up` usa la llave de caja demo del log.
 */
import { crearCliente } from '@factura-hn/cliente';
import { crearTienda, type Pedido } from './app';

const env = process.env;
if (!env.FHN_LLAVE) throw new Error('Falta FHN_LLAVE (llave de caja de la API).');

// Pedidos de ejemplo; en tu tienda vienen de la base de datos.
const pedidos = new Map<string, Pedido>([
  ['1001', { id: '1001', cliente: { nombre: 'Ferretería Pérez', rtn: '08019005123456' }, articulos: [{ descripcion: 'Cemento 42.5 kg', cantidad: 3, precioConISV: '245.00' }] }],
  ['1002', { id: '1002', articulos: [{ descripcion: 'Clavos 2" (lb)', cantidad: 2, precioConISV: '32.50' }] }],
]);

const app = crearTienda({
  fhn: crearCliente({ url: env.FHN_API_URL ?? 'http://127.0.0.1:8787', llave: env.FHN_LLAVE }),
  buscarPedido: async (id) => pedidos.get(id) ?? null,
  guardarFactura: async (id, numero) => void (pedidos.get(id)!.numeroFactura = numero),
  secretoWebhook: env.FHN_SECRETO_WEBHOOK ?? '',
  alRecibirAviso: async (a) => console.log('Aviso', a.evento, JSON.stringify(a.datos)),
});
app.listen(Number(env.PUERTO ?? 3001), '127.0.0.1', () => console.log(`Tienda en http://127.0.0.1:${env.PUERTO ?? 3001}  ·  prueba: curl -X POST http://127.0.0.1:${env.PUERTO ?? 3001}/pedidos/1001/factura`));
