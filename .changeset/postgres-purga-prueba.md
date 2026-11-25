---
"@factura-hn/postgres": minor
---

Esquema 4: los datos de un tenant solo de prueba se pueden borrar, y solo así. Dentro de una transacción que fija
`factura_hn.purga_prueba` con ese tenant, y solo si el tenant no tiene ninguna autorización con CAI real, la base
deja borrar sus documentos y autorizaciones con CAI ficticio (`DEMO00-NO-VALIDO-…`), sus series y su bitácora. Todo
lo demás sigue siendo imborrable, como antes. Lo usa la limpieza de la demostración pública de la API. La migración
es automática al arrancar.
