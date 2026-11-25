---
"factura-hn": patch
---

Montos en letras desde un billón (10^12): `enteroALetras`, `montoEnLetras` y el `totalEnLetras` de los documentos
dicen «UN BILLÓN», «DOS BILLONES DE LEMPIRAS» (escala larga del español) en lugar de repetir «MILLONES»
(«UN MILLÓN MILLONES»). Los montos menores de 10^12 no cambian. Lo encontraron las pruebas de mutación.
