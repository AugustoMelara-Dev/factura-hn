import { randomUUID } from 'node:crypto';
import { FormularioVenta } from './formulario-venta';

// Una clave nueva cada vez que se muestra el formulario.
export const dynamic = 'force-dynamic';

export default function Pagina() {
  return (
    <main>
      <h1>Caja</h1>
      <FormularioVenta clave={randomUUID()} />
    </main>
  );
}
