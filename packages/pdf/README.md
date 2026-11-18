# @factura-hn/pdf

PDF de un documento de [factura-hn](../core), en tamaño carta o ticket de 80 mm. Usa `pdf-lib`: no necesita
navegador ni dependencias nativas, así que funciona en Node, en funciones serverless y en el navegador.

```ts
import { renderizarPDF } from '@factura-hn/pdf';

const bytes = await renderizarPDF(documento);                         // carta
const ticket = await renderizarPDF(documento, { formato: 'ticket' }); // 80 mm, alto según el contenido
```

- El contenido es el mismo de `renderizarTexto`: todos los datos de los Arts. 10 y 11 del Reglamento, y la
  copia es idéntica al original (Art. 38).
- Un documento ANULADO lleva la leyenda al inicio y al final y una marca de agua (Art. 41).
- La salida es determinista: el mismo documento produce los mismos bytes.
- Las fuentes estándar de PDF solo dibujan Latin-1 (WinAnsi): los acentos y la ñ salen bien; un emoji u
  otro carácter fuera de esa tabla se reemplaza por «?» (`aWinAnsi`).
- Papel térmico: antes de imprimir en papel térmico hay que presentar al SAR la certificación del
  proveedor de que la impresión dura al menos 5 años (Art. 38).
