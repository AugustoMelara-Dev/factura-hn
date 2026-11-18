import type { ReactNode } from 'react';

export const metadata = { title: 'Caja · factura-hn' };

const estilos = `
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 16px; }
  label { display: block; margin: 8px 0; }
  input { display: block; width: 100%; padding: 6px; box-sizing: border-box; }
  button { margin-top: 12px; padding: 8px 14px; }
`;

export default function Raiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <style>{estilos}</style>
        {children}
      </body>
    </html>
  );
}
