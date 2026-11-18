'use client';

import { useActionState } from 'react';
import { emitirVenta } from './acciones';
import type { EstadoVenta } from '../lib/ventas';

export function FormularioVenta({ clave }: { clave: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoVenta, FormData>(emitirVenta, { tipo: 'inicial' });
  // Tras una venta emitida, el formulario se limpia y toma una clave nueva.
  const claveActual = estado.tipo === 'emitida' ? estado.siguienteClave : clave;
  return (
    <form action={accion} key={claveActual}>
      <input type="hidden" name="clave" value={claveActual} />
      <label>
        Cliente (opcional)
        <input name="cliente" autoComplete="off" />
      </label>
      <label>
        RTN (opcional)
        <input name="rtn" inputMode="numeric" maxLength={14} autoComplete="off" />
      </label>
      <label>
        Descripción
        <input name="descripcion" required />
      </label>
      <label>
        Cantidad
        <input name="cantidad" type="number" min="0.0001" step="any" defaultValue="1" required />
      </label>
      <label>
        Precio con ISV
        <input name="precio" inputMode="decimal" placeholder="0.00" required />
      </label>
      <button disabled={pendiente}>{pendiente ? 'Emitiendo…' : 'Emitir factura'}</button>
      <div role="status" aria-live="polite">
        {estado.tipo === 'emitida' && (
          <p>
            Emitida {estado.numero} por L {estado.total.toFixed(2)}
            {estado.repetida ? ' (ya estaba emitida)' : ''} · <a href={`/facturas/${estado.numero}`}>PDF</a>
          </p>
        )}
        {estado.tipo === 'error' && (
          <ul>
            {estado.mensajes.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
