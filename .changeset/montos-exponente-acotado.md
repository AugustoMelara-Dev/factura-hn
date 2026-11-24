---
"factura-hn": patch
---

Los montos en notación científica rechazan exponentes de más de ±30 o más de 40 dígitos con `ErrorMonto`, antes de calcular nada: «1e10000000» bloqueaba el proceso varios segundos (DEC-052).
