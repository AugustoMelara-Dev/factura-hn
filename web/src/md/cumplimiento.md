factura-hn implementa el Reglamento del Régimen de Facturación (Acuerdo 481-2017) y la Ley del Impuesto Sobre
Ventas como reglas de código, y cada regla se puede revisar: su artículo, cómo la cumple factura-hn y la prueba
que la verifica.

## Cómo se verifica

1. **Cada requisito tiene su artículo.** La matriz cita el artículo y la línea del texto consolidado de donde sale
   cada regla.
2. **Cada requisito cubierto tiene su prueba.** La fila enlaza la prueba en GitHub, en la línea exacta.
3. **La construcción falla si una regla pierde su prueba.** La matriz se genera desde las pruebas al construir el
   sitio: si una fila cubierta cita una prueba que ya no existe, el sitio no se publica.
4. **Las pruebas del almacén corren en memoria, SQLite y PostgreSQL**, con la misma batería de contrato.

## Lo que no está cubierto también está dicho

Cada fila tiene un estado: cubierto y probado, cubierto en parte, no implementado, documental (se cumple con un
trámite o con documentación) o no aplica (obligación del contribuyente o de la operación). Donde el Reglamento no
es literal, la fila dice qué lectura aplica factura-hn, y el resumen está en el
[estado legal](/produccion/estado-legal/).

- [Matriz de cumplimiento completa](/referencia/cumplimiento/), fila por fila.
- [Normativa](/referencia/normativa/): de qué fuentes sale cada regla y qué queda fuera.

## Independencia

Proyecto independiente, no afiliado al SAR. factura-hn no es asesoría fiscal ni un sistema autorizado por el SAR:
quien emite sigue siendo responsable de cumplir el Reglamento. Revisa la configuración con tu contador.
